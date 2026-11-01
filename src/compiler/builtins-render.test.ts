/**
 * The built-in primitives rendered with the real D2 CLI (#10): every component
 * × every variant × every built-in theme renders, and each element appears in
 * the SVG with its theme's colors and the arrowheads its component implies.
 * Also renders the examples under `examples/` (through the shared
 * `renderFigure()` pipeline, #11) and checks them against the committed SVGs
 * and their profile's page size.
 *
 * Skipped when the pinned `d2` is not installed locally (`bun run d2:install`);
 * required in CI (`CI` set), as in `d2-render.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkD2Version, findD2Binary } from "../backends/d2/binary";
import { D2_VERSION } from "../backends/d2/version";
import { getProfile } from "../core/profile/builtin";
import { BUILTIN_THEMES } from "../core/theme/builtin";
import { lintGeometry } from "../lint";
import { renderFigure } from "../render";
import { readSvgMetadata, sha256 } from "../render/finalize";
import { compileFigure } from "./compile";
import { elementClass } from "./d2";
import type { FigureIR } from "./ir";
import {
  ASSETS_DIR,
  edgeLook,
  primitivesFigure,
  structuredPrimitivesFigure,
  writtenComponentOf,
} from "./testing";

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

/** How a node's markup draws its shape: the attributes of its first shape element. */
function shapeLook(chunk: string) {
  const shape = /<g class="shape">(<(rect|circle|ellipse|path)[^>]*>)/.exec(chunk);
  const attr = (name: string) => new RegExp(` ${name}="([^"]*)"`).exec(shape?.[1] ?? "")?.[1];
  return {
    element: shape?.[2],
    fill: attr("fill"),
    stroke: attr("stroke"),
    width: attr("stroke-width"),
  };
}

/** The elements the author wrote (not expanded from a legend), by component, variant and tone. */
function writtenLike(ir: FigureIR, kind: "node" | "edge", component: string, variant: string) {
  return [...ir.elements.values()].filter(
    (e) =>
      e.legend === undefined &&
      e.kind === kind &&
      e.component === component &&
      e.variant === variant,
  );
}

test("the pinned d2 is installed in CI", () => {
  if (inCI) expect(available).toBe(true);
});

// #131: the components the auto engine cannot draw, in a structured figure
// (laid out by Sumi: no D2 needed, so never skipped). A legend's parts are
// traced back to the legend, and its samples are drawn like the author's edges
// and nodes with the same fields.
describe("structured-only built-in components render", () => {
  for (const theme of BUILTIN_THEMES.keys()) {
    test(
      `every structured-only component × variant (${theme})`,
      async () => {
        const rendered = await renderFigure(structuredPrimitivesFigure(theme));
        if (!rendered.ok) throw new Error(JSON.stringify(rendered.diagnostics, null, 2));
        expect(rendered.diagnostics).toEqual([]);
        expect(lintGeometry(rendered.value, {})).toEqual([]);
        const { ir } = rendered.value.compiled;
        expect(ir.meta.engine).toBe("structured");
        const markup = elementMarkup(rendered.value.svg);
        const legends = new Set<string>();
        for (const [key, element] of ir.elements) {
          const chunks = markup.get(elementClass(key)) ?? [];
          expect({ key, count: chunks.length }).toEqual({ key, count: 1 });
          const written = writtenComponentOf(ir, element);
          if (written.component === "sumi/legend") legends.add(written.variant);
          if (element.legend === undefined || element.legend.id === element.key.slice(2)) continue;
          const chunk = chunks[0] ?? "";
          if (element.kind === "edge") {
            const [real] = writtenLike(ir, "edge", element.component, element.variant);
            if (real === undefined) throw new Error(`no edge like ${key}`);
            const realChunk = markup.get(elementClass(real.key))?.[0] ?? "";
            expect({ key, look: edgeLook(rendered.value.svg, chunk) }).toEqual({
              key,
              look: edgeLook(rendered.value.svg, realChunk),
            });
            expect(edgeLook(rendered.value.svg, chunk).heads.length).toBe(
              (element.sourceArrowhead ? 1 : 0) + (element.targetArrowhead ? 1 : 0),
            );
          } else if (element.kind === "node" && element.component !== "sumi/label") {
            if (element.component === "sumi/junction") {
              expect(element.variant).toBe("hidden");
              continue;
            }
            const real = writtenLike(ir, "node", element.component, element.variant).find(
              (n) => JSON.stringify(n.style) === JSON.stringify(element.style),
            );
            if (real === undefined) throw new Error(`no node like ${key}`);
            const realChunk = markup.get(elementClass(real.key))?.[0] ?? "";
            expect({ key, look: shapeLook(chunk) }).toEqual({ key, look: shapeLook(realChunk) });
          }
        }
        expect([...legends].sort()).toEqual(["default", "plain"]);
      },
      TIMEOUT_MS,
    );
  }
});

describe.skipIf(!available)("built-in primitives render with D2", () => {
  for (const theme of BUILTIN_THEMES.keys()) {
    test(
      `every component × variant (${theme})`,
      async () => {
        const rendered = await renderFigure(primitivesFigure(theme), { assetBase: ASSETS_DIR });
        if (!rendered.ok) throw new Error(JSON.stringify(rendered.diagnostics, null, 2));
        expect(rendered.diagnostics).toEqual([]);
        const { ir } = rendered.value.compiled;
        const markup = elementMarkup(rendered.value.svg);
        expect(markup.size).toBe(ir.elements.size);

        for (const [key, element] of ir.elements) {
          const chunks = markup.get(elementClass(key)) ?? [];
          expect({ key, count: chunks.length }).toEqual({ key, count: 1 });
          const chunk = chunks[0] ?? "";
          expect(chunk).toContain(`sumi-kind-${element.kind}`);
          if (element.kind === "node" && element.mark?.type === "point") {
            // A point (#92) draws no text: a filled circle of the mark's size.
            expect(chunk).not.toContain("<text");
            expect(chunk).toContain(`fill="${element.style.fill}"`);
            expect(chunk).toContain(`rx="${(element.width?.units ?? 0) / 2}"`);
          } else if (element.kind === "node" && element.image !== undefined) {
            // An image (#94) draws no text: one embedded image in the placeholder's box.
            expect(chunk).not.toContain("<text");
            expect(count(chunk, /<image class="sumi-image"/g)).toBe(1);
            expect(chunk).toContain(
              `xlink:href="data:image/${element.image.html === undefined ? "png" : "svg+xml"};base64,`,
            );
          } else {
            expect(chunk).toContain(`>${element.label}<`);
            expect(chunk).toContain(`fill="${element.style.fontColor}"`);
          }
          if (element.kind === "node" && element.mark?.type === "glyph") {
            // A glyph mark draws its symbol in a circle of the mark's size.
            expect(chunk).toContain(`rx="${(element.width?.units ?? 0) / 2}"`);
          }
          // A text shape draws no outline.
          if (element.kind !== "node" || element.shape !== "text") {
            expect({ key, stroke: chunk.includes(`stroke="${element.style.stroke}"`) }).toEqual({
              key,
              stroke: true,
            });
          }
          if (element.kind === "node" && element.render !== undefined) {
            expect(count(chunk, /<path d="M/g)).toBe(
              element.render.renderer === "sumi/stack"
                ? 3
                : element.render.renderer === "sumi/waveform"
                  ? 3
                  : 1,
            );
            expect(count(chunk, /<rect\b/g)).toBe(0);
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

  // #36: a labeled figure renders on a slide with no diagnostic. The two wide
  // examples fit 16:9; the tall top-down ones (pipeline, decision-flow) do
  // not, by design (design doc §6.9).
  for (const example of [
    "examples/system-architecture/system-architecture.sumi.yaml",
    "examples/grouped/grouped.sumi.yaml",
  ]) {
    test(
      `${example} renders with theme slides and profile presentation-16x9`,
      async () => {
        const source = await Bun.file(join(ROOT, example)).text();
        const result = await renderFigure(source, {
          file: example,
          overrides: { theme: "slides", profile: "presentation-16x9" },
        });
        if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
        const diagnostics = [...result.diagnostics, ...lintGeometry(result.value, { source })];
        expect(diagnostics.map((d) => `${d.code}: ${d.message}`)).toEqual([]);
        expect(result.value.metadata).toMatchObject({
          theme: "slides",
          profile: "presentation-16x9",
        });
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
          const stderr = run.stderr.toString();
          expect(run.exitCode, stderr).toBe(0);
          if (example === "examples/dit-block/dit-block.sumi.yaml") {
            expect(stderr).toContain("0 errors, 0 warnings, 6 infos");
            expect(
              [...stderr.matchAll(/^examples\/.*:\d+:\d+ (\w+) ([\w/-]+)/gm)].map(
                ([, severity, code]) => [severity, code],
              ),
            ).toEqual([
              ["info", "geometry/script-too-small"],
              ["info", "geometry/group-empty-area"],
              ["info", "geometry/group-empty-area"],
              ["info", "geometry/arrowhead-cramped"],
              ["info", "geometry/arrowhead-cramped"],
              ["info", "geometry/arrowhead-cramped"],
            ]);
          } else expect(stderr).toBe("");
          const svg = await Bun.file(output).text();
          const committed = example.replace(/\.sumi\.yaml$/, ".svg");
          expect(svg).toBe(await Bun.file(join(ROOT, committed)).text());

          const source = await Bun.file(join(ROOT, example)).text();
          const metadata = readSvgMetadata(svg);
          if (!metadata.ok) throw new Error(JSON.stringify(metadata.diagnostics));
          expect(metadata.value?.inputSha256).toBe(sha256(source));

          const compiled = compileFigure(source);
          if (!compiled.ok) throw new Error("expected ok");
          expect(compiled.diagnostics).toEqual([]);
          // Check printed dimensions: fit: scale retains the natural viewBox.
          const { page } = getProfile(compiled.value.ir.meta.profileId) ?? {};
          const width = Number(/<svg[^>]* width="([\d.]+)pt"/.exec(svg)?.[1]);
          const height = Number(/<svg[^>]* height="([\d.]+)pt"/.exec(svg)?.[1]);
          expect(width).toBeGreaterThan(0);
          expect(height).toBeGreaterThan(0);
          if (page?.maxWidth) expect(width).toBeLessThanOrEqual(page.maxWidth.pt);
          if (page?.maxHeight) expect(height).toBeLessThanOrEqual(page.maxHeight.pt);
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
      },
      TIMEOUT_MS,
    );
  }
});
