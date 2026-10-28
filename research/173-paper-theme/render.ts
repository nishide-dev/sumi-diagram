/**
 * Renders the three #173 figures with the theme they are written with
 * (`paper`) and, for comparison, with `--theme color`:
 *   render (PDF) -> PNG at 200dpi (pdftoppm) -> 64-colour preview (magick).
 *
 * Usage (from the repository root): bun research/173-paper-theme/render.ts
 *
 * Writes PDFs and full PNGs under research/173-paper-theme/out/ (ignored) and
 * the committed previews previews/<figure>.png (paper) and
 * previews/<figure>.color.png (each < 150KB). Needs pdftoppm (Poppler) and
 * magick (ImageMagick).
 */

import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const here = import.meta.dir;
const root = join(here, "../..");
const out = join(here, "out");
const previews = join(here, "previews");
mkdirSync(out, { recursive: true });
mkdirSync(previews, { recursive: true });

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

/**
 * Renders `figure` to `pdf` with `sumi render --json`. The old PDF is deleted
 * first, so a failed render never leaves a stale one behind. Exit 1 (geometry
 * errors, the output is still written) is accepted only where `allowErrors`
 * says so: the `color` comparison renders have expected errors (#183's B);
 * the paper renders must be free of errors. Anything else throws.
 */
function render(figure: string, theme: string, pdf: string, allowErrors: boolean): RenderReport {
  rmSync(pdf, { force: true });
  const args = ["bun", "src/cli/index.ts", "render", figure, "--theme", theme, "--json", "-o", pdf];
  const result = Bun.spawnSync(args, { cwd: root, stdout: "pipe", stderr: "pipe" });
  const fail = (why: string): never => {
    throw new Error(`${args.join(" ")}: ${why}\n${result.stdout}${result.stderr}`);
  };
  if (result.exitCode !== 0 && result.exitCode !== 1) fail(`exit ${result.exitCode}`);
  let report: RenderReport;
  try {
    report = JSON.parse(result.stdout.toString()) as RenderReport;
  } catch {
    return fail("no JSON report");
  }
  const errors = report.diagnostics.filter((d) => d.severity === "error");
  if (result.exitCode === 1 && errors.length === 0) fail("exit 1 without an error diagnostic");
  if (errors.length > 0 && !allowErrors) {
    fail(`unexpected errors: ${errors.map((d) => `${d.code}: ${d.message}`).join("; ")}`);
  }
  if (!existsSync(pdf)) fail("no PDF written");
  return report;
}

for (const name of ["a-transformer", "b-dit", "c-h3world"]) {
  const figure = join(here, "figures", `${name}.sumi.yaml`);
  for (const theme of ["paper", "color"]) {
    const base = theme === "paper" ? name : `${name}.${theme}`;
    const pdf = join(out, `${base}.pdf`);
    const report = render(figure, theme, pdf, theme !== "paper");
    const counts = new Map<string, number>();
    for (const d of report.diagnostics) {
      const key = `${d.severity} ${d.code}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const size = report.size;
    console.log(
      `${base}: ${size?.widthMm} × ${size?.heightMm}mm, scale ${size?.scale ?? 1}; ` +
        ([...counts].map(([key, n]) => `${key} ×${n}`).join(", ") || "no diagnostics"),
    );
    rmSync(join(out, `${base}.png`), { force: true });
    run(["pdftoppm", "-r", "200", "-png", "-singlefile", pdf, join(out, base)]);
    const preview = join(previews, `${base}.png`);
    run(["magick", join(out, `${base}.png`), "-colors", "64", preview]);
    console.log(`  ${preview.slice(root.length + 1)}: ${statSync(preview).size} bytes`);
  }
}
