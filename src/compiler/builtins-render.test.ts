/**
 * The built-in primitives rendered with the real D2 CLI (#10): every component
 * × every variant × both built-in themes renders, and each element appears in
 * the SVG with its theme's colors and the arrowheads its component implies.
 * Also renders the examples under `examples/` and checks them against the
 * committed SVGs and their profile's page width.
 *
 * Skipped when the pinned `d2` is not installed locally (`bun run d2:install`);
 * required in CI (`CI` set), as in `d2-render.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createD2CliBackend } from "../backends/d2/backend";
import { checkD2Version, findD2Binary } from "../backends/d2/binary";
import { D2_VERSION } from "../backends/d2/version";
import { getProfile } from "../core/profile/builtin";
import { d2UnitsToPt } from "../core/units";
import { compileFigure } from "./compile";
import { elementClass } from "./d2";
import { primitivesFigure } from "./testing";

const binary = findD2Binary();
const available = binary.ok && (await checkD2Version(binary.value.path)).ok;
const inCI = Boolean(process.env.CI);

if (!available && !inCI) {
  console.warn(
    `[builtins d2] D2 v${D2_VERSION} not found; skipping. Run \`bun run d2:install\` to enable.`,
  );
}

const TIMEOUT_MS = 30_000;
const ROOT = join(import.meta.dir, "..", "..");
const EXAMPLES = [...new Bun.Glob("examples/*/*.sumi.yaml").scanSync(ROOT)].sort();

/**
 * Splits D2's SVG into the markup of each element, keyed by its `sumi-k-*`
 * class. D2 writes one flat `<g>` per element (containers do not nest their
 * children), so an element's markup runs up to the next element's `<g>`.
 */
function elementMarkup(svg: string): Map<string, string[]> {
  const starts = [...svg.matchAll(/<g class="[^"]*?\b(sumi-k-[^" ]+)/g)];
  const markup = new Map<string, string[]>();
  starts.forEach((m, i) => {
    const cls = m[1] ?? "";
    const chunk = svg.slice(m.index, starts[i + 1]?.index ?? svg.length);
    markup.set(cls, [...(markup.get(cls) ?? []), chunk]);
  });
  return markup;
}

const count = (text: string, pattern: RegExp) => text.match(pattern)?.length ?? 0;

test("the pinned d2 is installed in CI", () => {
  if (inCI) expect(available).toBe(true);
});

describe.skipIf(!available)("built-in primitives render with D2", () => {
  for (const theme of ["minimal", "academic"]) {
    test(
      `every component × variant (${theme})`,
      async () => {
        const compiled = compileFigure(primitivesFigure(theme));
        if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics, null, 2));
        const { ir, d2Source, layout, fontSet } = compiled.value;
        const rendered = await createD2CliBackend().render({ d2Source, layout, fontSet });
        if (!rendered.ok) throw new Error(JSON.stringify(rendered.diagnostics, null, 2));
        const markup = elementMarkup(rendered.value.svg);
        expect(markup.size).toBe(ir.elements.size);

        for (const [key, element] of ir.elements) {
          const chunks = markup.get(elementClass(key)) ?? [];
          expect({ key, count: chunks.length }).toEqual({ key, count: 1 });
          const chunk = chunks[0] ?? "";
          expect(chunk).toContain(`sumi-kind-${element.kind}`);
          expect(chunk).toContain(`>${element.label}<`);
          expect(chunk).toContain(`fill="${element.style.fontColor}"`);
          // A text shape draws no outline.
          if (element.kind !== "node" || element.shape !== "text") {
            expect({ key, stroke: chunk.includes(`stroke="${element.style.stroke}"`) }).toEqual({
              key,
              stroke: true,
            });
          }
          if (element.kind === "edge") {
            expect({
              key,
              start: count(chunk, /marker-start=/g),
              end: count(chunk, /marker-end=/g),
            }).toEqual({
              key,
              start: element.sourceArrowhead ? 1 : 0,
              end: element.targetArrowhead ? 1 : 0,
            });
          }
        }
      },
      TIMEOUT_MS,
    );
  }

  test("the example list is not empty", () => {
    expect(EXAMPLES.length).toBeGreaterThanOrEqual(2);
  });

  for (const example of EXAMPLES) {
    test(
      `${example} matches its committed SVG and fits its profile`,
      async () => {
        const dir = await mkdtemp(join(tmpdir(), "sumi-example-"));
        try {
          const output = join(dir, "out.svg");
          const run = Bun.spawnSync(
            [process.execPath, join(ROOT, "scripts", "render-example.ts"), example, output],
            { cwd: ROOT, stderr: "pipe", stdout: "pipe" },
          );
          expect({ exitCode: run.exitCode, stderr: run.stderr.toString() }).toEqual({
            exitCode: 0,
            stderr: "",
          });
          const svg = await Bun.file(output).text();
          const committed = example.replace(/\.sumi\.yaml$/, ".svg");
          expect(svg).toBe(await Bun.file(join(ROOT, committed)).text());

          const compiled = compileFigure(await Bun.file(join(ROOT, example)).text());
          if (!compiled.ok) throw new Error("expected ok");
          expect(compiled.diagnostics).toEqual([]);
          const maxWidth = getProfile(compiled.value.ir.meta.profileId)?.page.maxWidth;
          const width = /viewBox="0 0 (\d+) \d+"/.exec(svg)?.[1];
          expect(width).toBeDefined();
          if (maxWidth) expect(d2UnitsToPt(Number(width))).toBeLessThanOrEqual(maxWidth.pt);
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
      },
      TIMEOUT_MS,
    );
  }
});
