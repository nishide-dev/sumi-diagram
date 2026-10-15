/**
 * Validates generated D2 sources with the real D2 CLI: they compile with the
 * profile's layout flags and the theme's fonts, every element appears in the
 * SVG exactly once under its `sumi-k-*` class, labels survive escaping, and
 * the source is already in `d2 fmt` form.
 *
 * Needs the D2 binary in `SUMI_D2_PATH`; skipped otherwise.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "../core/subprocess";
import { type CompiledFigure, compileFigure } from "./compile";
import { elementClass, generateD2 } from "./d2";
import type { FigureIR } from "./ir";
import { extrasFigure, goldenCases } from "./testing";

const d2 = process.env.SUMI_D2_PATH;
if (!d2) console.warn("SUMI_D2_PATH is not set; skipping D2 CLI validation tests.");

const TIMEOUT_MS = 30_000;

async function inTempDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "sumi-d2-"));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Renders with D2 and returns the SVG. */
async function render(binary: string, compiled: Omit<CompiledFigure, "ir" | "sourceMap">) {
  return inTempDir(async (dir) => {
    const input = join(dir, "figure.d2");
    const output = join(dir, "figure.svg");
    await Bun.write(input, compiled.d2Source);
    const result = await runCommand(
      [
        binary,
        "--layout",
        "elk",
        ...compiled.layout.args,
        ...compiled.fontSet.args,
        "--omit-version",
        input,
        output,
      ],
      { timeoutMs: TIMEOUT_MS },
    );
    expect(result.stderr).not.toContain("err:");
    expect(result.exitCode).toBe(0);
    return Bun.file(output).text();
  });
}

/** Runs `d2 fmt` on the source and returns the formatted text. */
async function format(binary: string, source: string) {
  return inTempDir(async (dir) => {
    const file = join(dir, "figure.d2");
    await Bun.write(file, source);
    const result = await runCommand([binary, "fmt", file], { timeoutMs: TIMEOUT_MS });
    expect(result.exitCode).toBe(0);
    return Bun.file(file).text();
  });
}

/** Asserts each element's `sumi-k-*` class is on exactly one SVG group. */
function expectClasses(ir: FigureIR, svg: string) {
  const classes = [...svg.matchAll(/class="([^"]*)"/g)].map((m) => (m[1] ?? "").split(" "));
  for (const [key, element] of ir.elements) {
    const matching = classes.filter((list) => list.includes(elementClass(key)));
    expect({ key, count: matching.length }).toEqual({ key, count: 1 });
    expect(matching[0]).toContain(`sumi-kind-${element.kind}`);
  }
  const sumiClasses = classes.flat().filter((c) => c.startsWith("sumi-k-"));
  expect(sumiClasses).toHaveLength(ir.elements.size);
}

/** Decodes the XML character references D2 writes in text content. */
function xmlText(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

describe.skipIf(!d2)("D2 CLI validation", () => {
  const binary = d2 ?? "";

  for (const { name, input } of goldenCases()) {
    test(name, async () => {
      const result = compileFigure(await Bun.file(input).text());
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
      const compiled = result.value;
      // D2 v0.9.0 exits 0 without writing an SVG for an empty diagram (a backend concern, #9).
      if (compiled.ir.elements.size > 0) expectClasses(compiled.ir, await render(binary, compiled));
      expect(await format(binary, compiled.d2Source)).toBe(compiled.d2Source);
    });
  }

  test("labels render verbatim", async () => {
    const labels = goldenCases().find((c) => c.name === "labels");
    if (!labels) throw new Error("missing labels fixture");
    const result = compileFigure(await Bun.file(labels.input).text());
    if (!result.ok) throw new Error("expected ok");
    const svg = await render(binary, result.value);
    // Each label line is the content of a <text> (one line) or <tspan> (several).
    const lines = [...svg.matchAll(/<(?:text|tspan)\b[^>]*>([^<]*)(?=<)/g)].map((m) =>
      xmlText(m[1] ?? ""),
    );
    for (const element of result.value.ir.elements.values()) {
      for (const line of element.label.split(/\r\n?|\n/)) {
        if (line.trim() !== "") expect(lines).toContain(line);
      }
    }
  });

  test("custom edges and text styles", async () => {
    const ir = extrasFigure();
    const result = compileFigure("version: 1\nfigure: { id: extras }\n");
    if (!result.ok) throw new Error("expected ok");
    const compiled = { ...result.value, d2Source: generateD2(ir) };
    const svg = await render(binary, compiled);
    expectClasses(ir, svg);
    expect(svg.match(/marker-start=/g)).toHaveLength(2);
    expect(svg.match(/marker-end=/g)).toHaveLength(2);
    expect(await format(binary, compiled.d2Source)).toBe(compiled.d2Source);
  });
});
