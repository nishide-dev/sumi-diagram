/**
 * End-to-end check of the compiler with the real D2 CLI backend (#9):
 * `compileFigure()` output renders through `createD2CliBackend()` with the
 * profile's layout flags and the theme's fonts, every element appears in the
 * SVG exactly once under its `sumi-k-*` class, labels survive escaping, and
 * the source is already in `d2 fmt` form.
 *
 * Uses the backend's binary discovery. Skipped when the pinned `d2` is not
 * installed locally (`bun run d2:install`); required in CI (`CI` set).
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createD2CliBackend } from "../backends/d2/backend";
import { checkD2Version, findD2Binary } from "../backends/d2/binary";
import { D2_VERSION } from "../backends/d2/version";
import { runCommand } from "../core/subprocess";
import { type CompiledFigure, compileFigure } from "./compile";
import { elementClass, generateD2 } from "./d2";
import type { FigureIR } from "./ir";
import { extrasFigure, goldenCases } from "./testing";

const binary = findD2Binary();
const available = binary.ok && (await checkD2Version(binary.value.path)).ok;
const d2Path = binary.ok ? binary.value.path : "";
const inCI = Boolean(process.env.CI);

if (!available && !inCI) {
  console.warn(
    `[compiler d2] D2 v${D2_VERSION} not found; skipping. Run \`bun run d2:install\` to enable.`,
  );
}

const TIMEOUT_MS = 30_000;
const backend = createD2CliBackend();

async function inTempDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "sumi-d2-"));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Renders through the D2 CLI backend and returns the SVG. */
async function render(compiled: Pick<CompiledFigure, "d2Source" | "layout" | "fontSet">) {
  const result = await backend.render({
    d2Source: compiled.d2Source,
    layout: compiled.layout,
    fontSet: compiled.fontSet,
  });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  expect(result.value.fontSetId).toBe(compiled.fontSet.id);
  return result.value.svg;
}

/** Runs `d2 fmt` on the source and returns the formatted text. */
async function format(source: string) {
  return inTempDir(async (dir) => {
    const file = join(dir, "figure.d2");
    await Bun.write(file, source);
    const result = await runCommand([d2Path, "fmt", file], { timeoutMs: TIMEOUT_MS });
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

test("the pinned d2 is installed in CI", () => {
  if (inCI) expect(available).toBe(true);
});

describe.skipIf(!available)("D2 CLI validation", () => {
  for (const { name, input } of goldenCases()) {
    test(name, async () => {
      const result = compileFigure(await Bun.file(input).text());
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
      const compiled = result.value;
      // D2 v0.9.0 writes no SVG for an empty diagram (`backend/empty-output`, #9).
      if (compiled.ir.elements.size > 0) expectClasses(compiled.ir, await render(compiled));
      expect(await format(compiled.d2Source)).toBe(compiled.d2Source);
    });
  }

  test("labels render verbatim", async () => {
    const labels = goldenCases().find((c) => c.name === "labels");
    if (!labels) throw new Error("missing labels fixture");
    const result = compileFigure(await Bun.file(labels.input).text());
    if (!result.ok) throw new Error("expected ok");
    const svg = await render(result.value);
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
    const svg = await render(compiled);
    expectClasses(ir, svg);
    expect(svg.match(/marker-start=/g)).toHaveLength(2);
    expect(svg.match(/marker-end=/g)).toHaveLength(2);
    expect(await format(compiled.d2Source)).toBe(compiled.d2Source);
  });
});
