/**
 * Crossing-reduction benchmark (#124 §8).
 *
 *   bun research/124-stage-b/route/bench.ts                 # all figures × strategies
 *   bun research/124-stage-b/route/bench.ts --record        # also write results/route.json
 *   bun research/124-stage-b/route/bench.ts --only serving  # figures whose name contains it
 *   bun research/124-stage-b/route/bench.ts --svg           # also write out/route/<figure>.<strategy>.{svg,pdf,png}
 *                                                          # (PNG: Poppler's pdftoppm at 150dpi)
 *
 * Times are the median of several runs of the whole strategy (routing and,
 * for iterative strategies, the checks between passes) on this machine.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { svgToPdf } from "../../../src/render/pdf/pdf";
import { writeStructuredSvg } from "../../../src/render/structured";
import { lower } from "../lower";
import { type LoadedFigure, loadFile, loadText } from "./load";
import { type RouteMetrics, routeMetrics } from "./metrics";
import { STRATEGIES } from "./strategies";
import { synthetic } from "./synthetic";
import { loadVariantRouter } from "./variant";

const ROOT = join(import.meta.dir, "../../..");
const DOG = join(ROOT, "research/109-dogfood-v0.4/figures");
const DRAFTS = join(import.meta.dir, "../figures");
const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : undefined;
const writeSvg = args.includes("--svg");

/** The dogfooding figure without any `fromAnchor` / `toAnchor` (as first written). */
function withoutAnchors(path: string): string {
  const doc = parse(readFileSync(path, "utf8")) as { edges: Record<string, unknown>[] };
  for (const e of doc.edges) {
    delete e.fromAnchor;
    delete e.toAnchor;
  }
  return stringify(doc);
}

const FIGURES: [string, () => LoadedFigure, number][] = [
  ["serving-architecture", () => loadFile(join(DOG, "serving-architecture.sumi.yaml")), 9],
  [
    "serving-architecture (no anchors)",
    () => loadText(withoutAnchors(join(DOG, "serving-architecture.sumi.yaml")), DOG),
    9,
  ],
  [
    "stage-B draft serving-architecture",
    () =>
      loadText(
        lower(readFileSync(join(DRAFTS, "serving-architecture.sumi.yaml"), "utf8")).text,
        DRAFTS,
      ),
    9,
  ],
  ["training-pipeline", () => loadFile(join(DOG, "training-pipeline.sumi.yaml")), 9],
  ["seq2seq-attention", () => loadFile(join(DOG, "seq2seq-attention.sumi.yaml")), 9],
  ["unet-small", () => loadFile(join(DOG, "unet-small.sumi.yaml")), 9],
  [
    "examples/transformer",
    () => loadFile(join(ROOT, "examples/transformer/transformer.sumi.yaml")),
    9,
  ],
  ["examples/dit-block", () => loadFile(join(ROOT, "examples/dit-block/dit-block.sumi.yaml")), 9],
  ["synthetic columns", () => loadText(synthetic("columns")), 3],
  ["synthetic grid", () => loadText(synthetic("grid")), 3],
];

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] as number;
};

interface Row extends RouteMetrics {
  figure: string;
  strategy: string;
  passes: number;
  ms: number;
}

const v = await loadVariantRouter();
const rows: Row[] = [];
for (const [name, load, runs] of FIGURES) {
  if (only !== undefined && !name.includes(only)) continue;
  const fig = load();
  let product: string | undefined;
  for (const [strategy, run] of Object.entries(STRATEGIES)) {
    const outcome = run(fig.ir, fig.placed, v);
    const json = JSON.stringify(outcome.layout);
    if (strategy === "product") product = json;
    if (strategy === "variant-identity" && json !== product) {
      throw new Error(`${name}: the unpatched variant differs from the product router`);
    }
    // Deterministic: a second run gives the same layout.
    if (JSON.stringify(run(fig.ir, fig.placed, v).layout) !== json) {
      throw new Error(`${name} / ${strategy}: not deterministic`);
    }
    const times: number[] = [];
    // Iterative strategies on the 100-node figures are slow: fewer runs.
    const n = outcome.passes > 1 && runs < 9 ? 1 : runs;
    for (let i = 0; i < n; i++) {
      const start = performance.now();
      run(fig.ir, fig.placed, v);
      times.push(performance.now() - start);
    }
    const metrics = routeMetrics(outcome.ir, outcome.layout);
    rows.push({
      figure: name,
      strategy,
      passes: outcome.passes,
      ms: Math.round(median(times) * 10) / 10,
      ...metrics,
    });
    if (writeSvg) {
      const dir = join(import.meta.dir, "../out/route");
      mkdirSync(dir, { recursive: true });
      const file = `${name.replace(/[^a-z0-9]+/gi, "-")}.${strategy}.svg`;
      const svg = writeStructuredSvg(outcome.ir, outcome.layout, fig.fonts, fig.assets);
      writeFileSync(join(dir, file), svg);
      const pdf = svgToPdf(svg, { fontSet: fig.fonts });
      if (!pdf.ok) throw new Error(JSON.stringify(pdf.diagnostics));
      const pdfPath = join(dir, file.replace(/\.svg$/, ".pdf"));
      writeFileSync(pdfPath, pdf.value);
      const png = Bun.spawnSync([
        "pdftoppm",
        "-r",
        "150",
        "-png",
        "-singlefile",
        pdfPath,
        pdfPath.replace(/\.pdf$/, ""),
      ]);
      if (png.exitCode !== 0) throw new Error(`pdftoppm failed: ${png.stderr}`);
    }
    console.error(`${name} / ${strategy}: ${metrics.crossings} crossings, ${rows.at(-1)?.ms}ms`);
  }
}

const cols: (keyof Row)[] = [
  "figure",
  "strategy",
  "crossings",
  "crossingPoints",
  "contacts",
  "overlaps",
  "labelCollisions",
  "otherProblems",
  "unrouted",
  "bends",
  "length",
  "excess",
  "detours",
  "passes",
  "ms",
];
console.log(`| ${cols.join(" | ")} |`);
console.log(`|${cols.map(() => " --- ").join("|")}|`);
for (const row of rows) console.log(`| ${cols.map((c) => row[c]).join(" | ")} |`);

if (args.includes("--record")) {
  const dir = join(import.meta.dir, "../results");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "route.json"),
    `${JSON.stringify(
      {
        note: "Times are machine-dependent (see README); counts are deterministic.",
        environment: {
          bun: Bun.version,
          platform: `${process.platform}-${process.arch}`,
        },
        rows,
      },
      null,
      1,
    )}\n`,
  );
}
