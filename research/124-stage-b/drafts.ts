/**
 * The four #109 figures rewritten in the proposed stage-B syntax
 * (`figures/*.sumi.yaml`, docs/research/124-stage-b.md §9).
 *
 *   bun research/124-stage-b/drafts.ts            # table + out/drafts/*.{svg,pdf,png}
 *   bun research/124-stage-b/drafts.ts --record   # also write results/drafts.json
 *
 * For each draft:
 * - how v0.4.1 reacts to it as written (`checkFigure`: the codes and the
 *   unknown fields, as #86 §2.5 did);
 * - the draft lowered (`lower.ts`: captions and legends expanded, alignment
 *   solved by `align/solve.ts`, top-left / top-right group labels and edge
 *   `labelAt` applied by `labels.ts`, `labelSide`, bottom group labels and
 *   accents dropped) and rendered with the product router and with the
 *   router changes proposed in §8 (`sides-tree+ports-fan-in`); diagnostics
 *   of the lowered figure, the same without the label positions, and the
 *   label collisions of other positions tried (`ALTERNATIVES`),
 *   its size, and its route metrics; the product pipeline's render and
 *   geometry-lint diagnostics on the lowered text as v0.4.1 renders it
 *   (`renderAndGeometry`: no alignment, default label positions), and the
 *   geometry lint of each prototype drawing itself (`geometryLint`);
 * - the #109 original (v0.4.1) for comparison.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compileFigure } from "../../src/compiler/compile";
import type { FigureIR } from "../../src/compiler/ir";
import { checkFigure } from "../../src/core/check";
import type { LayoutIR } from "../../src/layout/ir";
import { checkRoutes } from "../../src/layout/route/check";
import { lintGeometry } from "../../src/lint/geometry/lint";
import { withImageSizes } from "../../src/render/compose-assets";
import { finalizeStructuredSvg } from "../../src/render/finalize";
import { inspectSvg } from "../../src/render/inspect";
import { svgToPdf } from "../../src/render/pdf/pdf";
import { renderFigure } from "../../src/render/render";
import { writeStructuredSvg } from "../../src/render/structured";
import { solveAlignment } from "./align/solve";
import { applyGroupLabelAt, labelEdgeFor } from "./labels";
import { lower } from "./lower";
import { type LoadedFigure, loadFile, loadText } from "./route/load";
import { routeMetrics } from "./route/metrics";
import { STRATEGIES } from "./route/strategies";
import { loadVariantRouter } from "./route/variant";

const FIG = join(import.meta.dir, "figures");
const DOG = join(import.meta.dir, "../109-dogfood-v0.4/figures");
const OUT = join(import.meta.dir, "out/drafts");
mkdirSync(OUT, { recursive: true });
const MM_PER_UNIT = 0.5 * (25.4 / 72);
const size = (l: LayoutIR) =>
  `${(l.canvas.width * MM_PER_UNIT).toFixed(1)} × ${(l.canvas.height * MM_PER_UNIT).toFixed(1)}`;

const DRAFTS: [draft: string, original: string][] = [
  ["seq2seq-attention", "seq2seq-attention"],
  ["seq2seq-attention.side-kv", "seq2seq-attention"],
  ["training-pipeline", "training-pipeline"],
  ["serving-architecture", "serving-architecture"],
  ["unet-small", "unet-small"],
];

const v = await loadVariantRouter();

/** Label positions tried instead of the draft's (keys: `g:<id>`, `e:#<index>`). */
const ALTERNATIVES: Record<
  string,
  { note: string; groups?: Record<string, string>; edges?: Record<string, string> }[]
> = {
  "training-pipeline": [
    {
      note: "Training step top-left (the draft: top-right)",
      groups: { "g:train-step": "top-left" },
    },
    { note: "update θ labelAt: middle (the draft: default end)", edges: { "e:#7": "middle" } },
  ],
};

function png(fig: LoadedFigure, layout: LayoutIR, name: string) {
  const svg = writeStructuredSvg(fig.ir, layout, fig.fonts, fig.assets);
  writeFileSync(join(OUT, `${name}.svg`), svg);
  const pdf = svgToPdf(svg, { fontSet: fig.fonts });
  if (!pdf.ok) throw new Error(JSON.stringify(pdf.diagnostics));
  writeFileSync(join(OUT, `${name}.pdf`), pdf.value);
  Bun.spawnSync([
    "pdftoppm",
    "-r",
    "150",
    "-png",
    "-singlefile",
    join(OUT, `${name}.pdf`),
    join(OUT, name),
  ]);
}

/**
 * The geometry lint of a prototype drawing itself (aligned, labels placed,
 * the proposed router): its SVG goes through the product's finalize and
 * inspect like a rendered figure, with the compiled figure of the lowered
 * text (and the IR the routes were made for).
 */
function prototypeLint(text: string, ir: FigureIR, layout: LayoutIR, fig: LoadedFigure): string[] {
  const compiled = compileFigure(text);
  if (!compiled.ok || compiled.value.engine !== "structured") throw new Error("not structured");
  const base =
    fig.assets === undefined ? compiled.value : withImageSizes(compiled.value, fig.assets);
  if (base.engine !== "structured") throw new Error("not structured");
  const figure = { ...base, ir };
  const svg = writeStructuredSvg(ir, layout, fig.fonts, fig.assets);
  const finalized = finalizeStructuredSvg(svg, figure, {
    source: text,
    ...(fig.assets !== undefined && { assets: fig.assets }),
  });
  if (!finalized.ok) return finalized.diagnostics.map((d) => `${d.severity} ${d.code}`);
  const inspected = inspectSvg(finalized.value.svg, ir);
  if (!inspected.ok) return inspected.diagnostics.map((d) => `${d.severity} ${d.code}`);
  return lintGeometry({ compiled: figure, inspection: inspected.value }, { source: text }).map(
    (d) => `${d.severity} ${d.code}: ${d.message.slice(0, 160)}`,
  );
}

/**
 * The product pipeline on the lowered text (v0.4.1 layout and router, no
 * alignment): render diagnostics and the geometry lint, as `sumi render` reports.
 */
async function productDiagnostics(text: string): Promise<string[]> {
  const rendered = await renderFigure(text, { assetBase: FIG });
  if (!rendered.ok) return rendered.diagnostics.map((d) => `${d.severity} ${d.code}`);
  return [...rendered.diagnostics, ...lintGeometry(rendered.value, { source: text })].map(
    (d) => `${d.severity} ${d.code}`,
  );
}

const rows = [];
for (const [name, original] of DRAFTS) {
  const source = readFileSync(join(FIG, `${name}.sumi.yaml`), "utf8");
  // 1. v0.4.1 on the draft as written (without `requires`, which stops at the first check).
  const raw = checkFigure(source.replace(/^requires: .*$/m, ""));
  const unknown = [
    ...new Set(
      raw.state.diagnostics
        .filter((d) => d.code === "schema/unknown-field")
        .map((d) => /"([^"]+)"/.exec(d.message)?.[1] ?? d.message),
    ),
  ].sort();
  const codes: Record<string, number> = {};
  for (const d of raw.state.diagnostics) codes[d.code] = (codes[d.code] ?? 0) + 1;

  // 2. Lowered.
  const lowered = lower(source);
  const check = checkFigure(lowered.text);
  const fig = loadText(lowered.text, FIG);
  const aligned =
    lowered.align.length > 0 ? (await solveAlignment(fig.ir, lowered.align)).layout : fig.placed;
  // Group label positions (top-left / top-right) move the label in its band;
  // edge `labelAt` goes to the label placement through the router variant.
  const placed = applyGroupLabelAt(aligned, lowered.groupLabelAt);
  v.HOOKS.labelEdge = labelEdgeFor(lowered.edgeLabelAt);
  // `variant-identity` is the product router (byte-identical without hooks).
  const product = STRATEGIES["variant-identity"]?.(fig.ir, placed, v) as { layout: LayoutIR };
  const proposed = STRATEGIES["sides-tree+ports-fan-in"]?.(fig.ir, placed, v) as {
    layout: LayoutIR;
    ir: typeof fig.ir;
  };
  v.HOOKS.labelEdge = null;
  // The same without the label positions (v0.4.1 places every label).
  const plain = STRATEGIES["variant-identity"]?.(fig.ir, aligned, v) as { layout: LayoutIR };
  // Other label positions tried on this draft (§1–§2 of the doc).
  const alternatives = (ALTERNATIVES[name] ?? []).map((alt) => {
    const groupAt = new Map([...lowered.groupLabelAt, ...Object.entries(alt.groups ?? {})]);
    const edgeAt = new Map([...lowered.edgeLabelAt, ...Object.entries(alt.edges ?? {})]);
    v.HOOKS.labelEdge = labelEdgeFor(edgeAt);
    const routed = STRATEGIES["variant-identity"]?.(
      fig.ir,
      applyGroupLabelAt(aligned, groupAt),
      v,
    ) as { layout: LayoutIR };
    v.HOOKS.labelEdge = null;
    return { ...alt, labelCollisions: checkRoutes(fig.ir, routed.layout).labelCollisions };
  });
  png(fig, product.layout, `${name}.lowered`);
  png({ ...fig, ir: proposed.ir }, proposed.layout, `${name}.lowered-router`);

  // 3. The #109 original, routed by v0.4.1.
  const orig = loadFile(join(DOG, `${original}.sumi.yaml`));
  const origRouted = STRATEGIES.product?.(orig.ir, orig.placed, v) as { layout: LayoutIR };

  rows.push({
    draft: name,
    asWritten: { codes, unknownFields: unknown },
    lowered: {
      dropped: lowered.dropped,
      checkDiagnostics: check.state.diagnostics.map((d) => `${d.severity} ${d.code}`),
      renderAndGeometry: await productDiagnostics(lowered.text),
      productRouter: {
        size: size(product.layout),
        geometryLint: prototypeLint(lowered.text, fig.ir, product.layout, fig),
        ...routeMetrics(fig.ir, product.layout),
      },
      withoutLabelPositions: {
        size: size(plain.layout),
        ...routeMetrics(fig.ir, plain.layout),
      },
      alternatives,
      proposedRouter: {
        size: size(proposed.layout),
        geometryLint: prototypeLint(lowered.text, proposed.ir, proposed.layout, fig),
        ...routeMetrics(proposed.ir, proposed.layout),
      },
    },
    original109: { size: size(origRouted.layout), ...routeMetrics(orig.ir, origRouted.layout) },
  });
}
const report = `${JSON.stringify(rows, null, 1)}\n`;
if (process.argv.includes("--record")) {
  const dir = join(import.meta.dir, "results");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "drafts.json"), report);
}
process.stdout.write(report);
