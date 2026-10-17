/**
 * PoC for #18 (see README.md): renders figures that use two custom shapes
 * through Sumi's real pipeline with placeholder rectangles, then draws the
 * custom outlines in a post-processing step.
 *
 *   bun research/18-custom-svg/run.ts [--png]
 *
 * For each figure in `figures/` it writes to `out/`:
 * - `<id>.1-placeholder.svg`  Sumi's normal output (custom nodes are rectangles)
 * - `<id>.2-outline.svg`      outlines drawn, labels and edges untouched
 * - `<id>.3-composed.svg`     outlines + labels in the safe area + edges clipped
 * - `<id>.report.json`        footprints, edge gaps, inspect / geometry-lint results
 * - with `--png`, a PNG of each SVG (headless Chrome; skipped if not found)
 *
 * Needs the pinned D2 (`bun run d2:install`). Output is deterministic.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parseDocument } from "yaml";
import { z } from "zod";
import type { ElementKey } from "../../src/core/check-state";
import { createBuiltinRegistry } from "../../src/core/registry/builtins";
import { SizeLength } from "../../src/core/registry/length";
import type { NodeManifest } from "../../src/core/registry/manifest";
import type { Registry } from "../../src/core/registry/registry";
import { lintGeometry } from "../../src/lint/geometry/lint";
import type { Rect } from "../../src/render/geometry";
import { inspectSvg } from "../../src/render/inspect";
import { type RenderedFigure, renderFigure } from "../../src/render/render";
import { composeCustomShapes } from "./compose";
import { CUSTOM_SHAPES, type CustomShape } from "./shapes";

const HERE = import.meta.dir;
const OUT = join(HERE, "out");
const NAMESPACE = "research";

/** Manifests for the custom shapes: lowered to a placeholder `rectangle` (the footprint). */
function customManifest(name: string): NodeManifest {
  return {
    version: 1,
    kind: "node",
    namespace: NAMESPACE,
    name,
    description: `PoC custom shape ${name} (#18).`,
    variants: ["default", "emphasis", "muted"],
    props: z.strictObject({ width: SizeLength.optional(), height: SizeLength.optional() }),
    since: "0.1.0",
    shape: "rectangle",
    sizing: "auto",
  };
}

function createRegistry(): Registry {
  const registry = createBuiltinRegistry();
  for (const name of Object.keys(CUSTOM_SHAPES)) {
    const result = registry.register(customManifest(name));
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  }
  return registry;
}

async function render(text: string, registry: Registry): Promise<RenderedFigure> {
  const result = await renderFigure(text, { registry });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  return result.value;
}

function customShapes(rendered: RenderedFigure): Map<ElementKey, CustomShape> {
  const shapes = new Map<ElementKey, CustomShape>();
  for (const node of rendered.compiled.ir.nodes) {
    const [namespace, name = ""] = node.component.split("/");
    const shape = CUSTOM_SHAPES[name];
    if (namespace === NAMESPACE && shape !== undefined) shapes.set(node.key, shape);
  }
  return shapes;
}

const bboxOf = (rendered: RenderedFigure, key: ElementKey): Rect => {
  const bbox = rendered.inspection.elements.find((e) => e.key === key)?.bbox;
  if (bbox === undefined) throw new Error(`${key} has no bbox`);
  return bbox;
};

/**
 * Pass 2 source: every custom node gets an explicit width / height (in pt,
 * whole D2 units) so that its safe area holds D2's own padded label box
 * from pass 1. D2 then keeps the label inside (it moves labels outside
 * only when its own estimate does not fit).
 */
function withFootprints(
  text: string,
  pass1: RenderedFigure,
  shapes: Map<ElementKey, CustomShape>,
): { text: string; footprints: Record<string, unknown> } {
  const doc = parseDocument(text);
  const footprints: Record<string, unknown> = {};
  const nodes = pass1.compiled.ir.nodes;
  for (const [key, shape] of shapes) {
    const auto = bboxOf(pass1, key);
    const size = shape.footprintFor(auto);
    const width = Math.ceil(size.width);
    const height = Math.ceil(size.height);
    const index = nodes.findIndex((n) => n.key === key);
    doc.setIn(["nodes", index, "props", "width"], `${width / 2}pt`);
    doc.setIn(["nodes", index, "props", "height"], `${height / 2}pt`);
    footprints[key] = {
      shape: shape.name,
      d2AutoUnits: { width: auto.width, height: auto.height },
      footprintUnits: { width, height },
    };
  }
  return { text: doc.toString(), footprints };
}

function findChrome(): string | undefined {
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ];
  return candidates.find((path) => existsSync(path));
}

async function toPng(chrome: string, svgPath: string, widthPt: number, heightPt: number) {
  const px = (pt: number) => Math.ceil((pt * 4) / 3);
  const proc = Bun.spawn(
    [
      chrome,
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--force-device-scale-factor=2",
      `--window-size=${px(widthPt)},${px(heightPt)}`,
      `--screenshot=${svgPath.replace(/\.svg$/, ".png")}`,
      `file://${svgPath}`,
    ],
    { stdout: "ignore", stderr: "ignore" },
  );
  await proc.exited;
}

async function main() {
  const png = process.argv.includes("--png");
  const chrome = png ? findChrome() : undefined;
  if (png && chrome === undefined) console.warn("Chrome not found; skipping PNGs.");
  mkdirSync(OUT, { recursive: true });
  const registry = createRegistry();

  const figures = readdirSync(join(HERE, "figures"))
    .filter((f) => f.endsWith(".sumi.yaml"))
    .sort();
  for (const file of figures) {
    const id = basename(file, ".sumi.yaml");
    const source = readFileSync(join(HERE, "figures", file), "utf8");

    // Pass 1: D2 sizes the placeholders to the labels. Pass 2: explicit footprints.
    const pass1 = await render(source, registry);
    const shapes = customShapes(pass1);
    const sized = withFootprints(source, pass1, shapes);
    const rendered = await render(sized.text, registry);
    const { ir } = rendered.compiled;

    const outlineOnly = composeCustomShapes(rendered.svg, ir, rendered.inspection, shapes, {
      drawOutlines: true,
      moveLabels: false,
      clipEdges: false,
    });
    const composed = composeCustomShapes(rendered.svg, ir, rendered.inspection, shapes, {
      drawOutlines: true,
      moveLabels: true,
      clipEdges: true,
    });

    // The composed SVG must still satisfy the §6 contract: inspect it again.
    const reinspected = inspectSvg(composed.svg, ir);
    if (!reinspected.ok) throw new Error(JSON.stringify(reinspected.diagnostics, null, 2));
    const bboxesKept = [...shapes.keys()].every((key) => {
      const before = bboxOf(rendered, key);
      const after = reinspected.value.elements.find((e) => e.key === key)?.bbox;
      return JSON.stringify(before) === JSON.stringify(after);
    });
    // Measure the composed SVG again: the clipped ends now keep D2's offset from the outline.
    const residual = composeCustomShapes(composed.svg, ir, reinspected.value, shapes, {
      drawOutlines: false,
      moveLabels: false,
      clipEdges: false,
    }).edgeEnds;
    const lint = (inspection: typeof rendered.inspection) =>
      lintGeometry({ compiled: rendered.compiled, inspection }, { source: sized.text }).map(
        (d) => `${d.severity} ${d.code}: ${d.message}`,
      );

    const outputs = {
      "1-placeholder": rendered.svg,
      "2-outline": outlineOnly.svg,
      "3-composed": composed.svg,
    };
    for (const [stage, svg] of Object.entries(outputs)) {
      const path = join(OUT, `${id}.${stage}.svg`);
      writeFileSync(path, svg);
      if (chrome !== undefined) {
        await toPng(chrome, path, widthPt(svg), heightPt(svg));
      }
    }
    const report = {
      figure: id,
      footprints: sized.footprints,
      edgeEnds: composed.edgeEnds.map((end) => ({
        ...end,
        gapPt: end.gapUnits / 2,
        // After clipping, the end must sit as far from the outline as D2 put it from the footprint.
        composedEndToOutlineUnits: residual.find((r) => r.edge === end.edge && r.end === end.end)
          ?.endToOutlineUnits,
      })),
      composedInspection: { ok: true, footprintBboxesUnchanged: bboxesKept },
      geometryLint: {
        placeholder: lint(rendered.inspection),
        composed: lint(reinspected.value),
      },
    };
    writeFileSync(join(OUT, `${id}.report.json`), `${JSON.stringify(report, null, 2)}\n`);
    console.log(`${id}: wrote ${Object.keys(outputs).length} SVGs and a report to ${OUT}`);
  }
}

const sizeAttribute = (svg: string, name: string): number => {
  const match = new RegExp(`<svg[^>]*\\s${name}="([0-9.]+)pt"`).exec(svg);
  return match ? Number(match[1]) : 0;
};
const widthPt = (svg: string) => sizeAttribute(svg, "width");
const heightPt = (svg: string) => sizeAttribute(svg, "height");

await main();
