/**
 * Cross-tree alignment prototype (#124 §6) on the stage-B drafts.
 *
 *   bun research/124-stage-b/align/run.ts            # table + out/align/*.{svg,pdf,png}
 *   bun research/124-stage-b/align/run.ts --record   # also write results/align.json
 *
 * For each draft with `figure.layout.align`: the draft lowered to v0.4.1
 * (`lower.ts`) laid out by the product engine ("before"), and by the strut
 * solver (`solve.ts`, "after"), each routed by the product router. Also
 * checks that the patched engine without struts equals the product engine.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LayoutIR } from "../../../src/layout/ir";
import { routeEdges } from "../../../src/layout/route/router";
import { layoutStructured } from "../../../src/layout/structured/engine";
import { svgToPdf } from "../../../src/render/pdf/pdf";
import { writeStructuredSvg } from "../../../src/render/structured";
import { lower } from "../lower";
import { type LoadedFigure, loadText } from "../route/load";
import { routeMetrics } from "../route/metrics";
import { loadEngineCopy, solveAlignment } from "./solve";

const FIG = join(import.meta.dir, "../figures");
const OUT = join(import.meta.dir, "../out/align");
mkdirSync(OUT, { recursive: true });
const MM_PER_UNIT = 0.5 * (25.4 / 72);

const DRAFTS = ["unet-small", "seq2seq-attention.side-kv"];

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] as number;
const mm = (layout: LayoutIR) =>
  `${(layout.canvas.width * MM_PER_UNIT).toFixed(1)} × ${(layout.canvas.height * MM_PER_UNIT).toFixed(1)}`;

function render(fig: LoadedFigure, layout: LayoutIR, name: string) {
  const routed = routeEdges(fig.ir, layout);
  const svg = writeStructuredSvg(fig.ir, routed.layout, fig.fonts, fig.assets);
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
  return { routed: routed.layout, noRoute: routed.diagnostics.length };
}

const copy = await loadEngineCopy();
const rows = [];
for (const name of DRAFTS) {
  const draft = lower(readFileSync(join(FIG, `${name}.sumi.yaml`), "utf8"));
  const fig = loadText(draft.text, FIG);
  // The patched engine without struts is the product engine.
  copy.STRUTS.value = null;
  if (JSON.stringify(copy.layoutStructured(fig.ir)) !== JSON.stringify(layoutStructured(fig.ir))) {
    throw new Error(`${name}: the patched engine differs from the product engine`);
  }
  const before = render(fig, fig.placed, `${name}.before`);
  const solved = await solveAlignment(fig.ir, draft.align);
  const times: number[] = [];
  for (let i = 0; i < 9; i++) {
    const start = performance.now();
    await solveAlignment(fig.ir, draft.align);
    times.push(performance.now() - start);
  }
  const once: number[] = [];
  for (let i = 0; i < 9; i++) {
    const start = performance.now();
    layoutStructured(fig.ir);
    once.push(performance.now() - start);
  }
  const after = render(fig, solved.layout, `${name}.after`);
  const rb = routeMetrics(fig.ir, before.routed);
  const ra = routeMetrics(fig.ir, after.routed);
  rows.push({
    draft: name,
    constraints: draft.align.length,
    dropped: draft.dropped,
    before: { size: mm(before.routed), noRoute: before.noRoute, ...rb },
    after: { size: mm(after.routed), noRoute: after.noRoute, ...ra },
    rounds: solved.rounds,
    layouts: solved.layouts,
    residualUnits: solved.residual,
    struts: solved.struts,
    msLayoutOnce: Math.round(median(once) * 100) / 100,
    msSolve: Math.round(median(times) * 100) / 100,
  });
}
const report = `${JSON.stringify(rows, null, 1)}\n`;
if (process.argv.includes("--record")) {
  const dir = join(import.meta.dir, "../results");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "align.json"), report);
}
process.stdout.write(report);
