/**
 * Renders the #182 figures (`figure.layout.density: compact`) and, as the
 * baseline, the #173 figures they were copied from (normal spacing), then
 * prints each one's printed size, the height it would have at the
 * reference's width, and its diagnostics:
 *   render (PDF, `--json`) -> PNG at 200dpi (pdftoppm) -> 64-colour preview.
 *
 * Usage (from the repository root): bun research/182-compact/render.ts
 *
 * Writes PDFs and full PNGs under research/182-compact/out/ (ignored) and the
 * committed previews previews/<figure>.png of the compact figures (each
 * < 150KB). Needs pdftoppm (Poppler) and magick (ImageMagick). Every render
 * must be free of errors and warnings (infos are listed).
 */

import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const here = import.meta.dir;
const root = join(here, "../..");
const out = join(here, "out");
const previews = join(here, "previews");
mkdirSync(out, { recursive: true });
mkdirSync(previews, { recursive: true });

/** Width of the reference figure (mm) the heights are compared at, and its height. */
const REFERENCE: Record<string, { widthMm: number; heightMm: number } | undefined> = {
  // arXiv 1706.03762v7 Fig. 1, printed size (docs/research/167-stage-c.md §1.1)
  "a-transformer": { widthMm: 77.2, heightMm: 113.7 },
  // arXiv 2212.09748v2 Fig. 3, about 170 × 68mm with the captions (§1.1)
  "b-dit": { widthMm: 170, heightMm: 68 },
  "b-dit-tight": { widthMm: 170, heightMm: 68 },
  // the user's raster figure: no printed size, only its aspect (1724 × 1428px)
  "c-h3world": undefined,
};

/** Runs a tool that must succeed (pdftoppm, magick). */
function run(args: string[]): void {
  const result = Bun.spawnSync(args, { cwd: root, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    throw new Error(`${args.join(" ")} failed:\n${result.stderr.toString()}`);
  }
}

interface RenderReport {
  diagnostics: { code: string; severity: string; message: string }[];
  size?: { widthMm: number; heightMm: number; scale?: number };
}

/** Renders `figure` to `pdf` with `sumi render --json`; errors and warnings throw. */
function render(figure: string, pdf: string): RenderReport {
  rmSync(pdf, { force: true });
  const args = ["bun", "src/cli/index.ts", "render", figure, "--json", "-o", pdf];
  const result = Bun.spawnSync(args, { cwd: root, stdout: "pipe", stderr: "pipe" });
  const fail = (why: string): never => {
    throw new Error(`${args.join(" ")}: ${why}\n${result.stdout}${result.stderr}`);
  };
  if (result.exitCode !== 0) fail(`exit ${result.exitCode}`);
  let report: RenderReport;
  try {
    report = JSON.parse(result.stdout.toString()) as RenderReport;
  } catch {
    return fail("no JSON report");
  }
  const bad = report.diagnostics.filter((d) => d.severity !== "info");
  if (bad.length > 0) fail(bad.map((d) => `${d.code}: ${d.message}`).join("; "));
  if (!existsSync(pdf)) fail("no PDF written");
  return report;
}

const round = (value: number, digits = 1) => Number(value.toFixed(digits));

for (const name of ["a-transformer", "b-dit", "b-dit-tight", "c-h3world"]) {
  const runs = [
    { label: "compact", figure: join(here, "figures", `${name}.sumi.yaml`) },
    ...(name === "b-dit-tight"
      ? []
      : [
          {
            label: "normal (#173)",
            figure: join(root, "research/173-paper-theme/figures", `${name}.sumi.yaml`),
          },
        ]),
  ];
  for (const { label, figure } of runs) {
    const base = label === "compact" ? name : `${name}.normal`;
    const pdf = join(out, `${base}.pdf`);
    const report = render(figure, pdf);
    const size = report.size;
    if (size === undefined) throw new Error(`${figure}: no size`);
    const ref = REFERENCE[name];
    const atRef = ref
      ? `, ${round((size.heightMm * ref.widthMm) / size.widthMm)}mm tall at ${ref.widthMm}mm wide (reference ${ref.heightMm}mm, ×${round(size.heightMm / size.widthMm / (ref.heightMm / ref.widthMm), 3)})`
      : `, height / width ${round(size.heightMm / size.widthMm, 3)} (reference ${round(1428 / 1724, 3)})`;
    const infos = report.diagnostics.map((d) => d.code).join(", ") || "no diagnostics";
    console.log(
      `${name} ${label}: ${size.widthMm} × ${size.heightMm}mm, scale ${size.scale ?? 1}${atRef}; ${infos}`,
    );
    if (label !== "compact") continue;
    rmSync(join(out, `${base}.png`), { force: true });
    run(["pdftoppm", "-r", "200", "-png", "-singlefile", pdf, join(out, base)]);
    const preview = join(previews, `${base}.png`);
    run(["magick", join(out, `${base}.png`), "-colors", "64", preview]);
    console.log(`  ${preview.slice(root.length + 1)}: ${statSync(preview).size} bytes`);
  }
}
