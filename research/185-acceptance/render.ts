/**
 * Renders the three #185 acceptance figures (figures/*.sumi.yaml, all
 * `requires: ">=0.6.0"`, theme `paper`) and prints each one's printed size,
 * scale and diagnostics:
 *   lint (the figure as written) -> render (PDF, `--json`) -> PNG at 200dpi
 *   (pdftoppm) -> 64-colour preview previews/<figure>.png (< 150KB).
 *
 * Usage (from the repository root): bun research/185-acceptance/render.ts
 *
 * While package.json still says 0.5.x (main before the v0.6.0 release bump),
 * `requires: ">=0.6.0"` stops the CLI with exactly one
 * `schema/unsatisfied-requires`. The script then checks that this is the only
 * diagnostic of `sumi lint`, and renders a copy of figures/ under out/ with the
 * `requires` line removed. From 0.6.0 on it renders the figures as written.
 * Every render must be free of errors and warnings (infos are listed).
 * Needs pdftoppm (Poppler) and magick (ImageMagick).
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const here = import.meta.dir;
const root = join(here, "../..");
const out = join(here, "out");
const previews = join(here, "previews");
const FIGURES = ["a-transformer", "b-dit", "c-h3world"];

interface Diagnostic {
  code: string;
  severity: string;
  message: string;
}
interface Report {
  diagnostics: Diagnostic[];
  size?: { widthMm: number; heightMm: number; scale?: number } | null;
}

function cli(args: string[]): { exitCode: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync(["bun", "src/cli/index.ts", ...args], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

function run(args: string[]): void {
  const result = Bun.spawnSync(args, { cwd: root, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0)
    throw new Error(`${args.join(" ")} failed:\n${result.stderr.toString()}`);
}

function diagnosticsOf(stdout: string): Diagnostic[] {
  const parsed = JSON.parse(stdout) as { results?: Report[] } & Report;
  return parsed.results ? parsed.results.flatMap((r) => r.diagnostics) : parsed.diagnostics;
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
mkdirSync(previews, { recursive: true });
// The copy that is rendered: the same files, `requires` removed only if this Sumi predates it.
const copy = join(out, "figures");
cpSync(join(here, "figures"), copy, { recursive: true });

let failed = false;
for (const name of FIGURES) {
  const written = join(here, "figures", `${name}.sumi.yaml`);
  const source = readFileSync(written, "utf8");
  if (!/^requires: ">=0\.6\.0"$/m.test(source))
    throw new Error(`${name}: missing requires: ">=0.6.0"`);

  const lint = cli(["lint", "--json", written]);
  const lintDiagnostics = diagnosticsOf(lint.stdout);
  let target = written;
  if (lintDiagnostics.some((d) => d.code === "schema/unsatisfied-requires")) {
    if (lintDiagnostics.length !== 1) {
      throw new Error(`${name}: lint reports more than the version gate:\n${lint.stdout}`);
    }
    target = join(copy, `${name}.sumi.yaml`);
    writeFileSync(target, source.replace(/^requires: .*\n/m, ""));
    console.log(
      `${name}: this Sumi predates 0.6.0 — lint reports only schema/unsatisfied-requires; rendering a copy without it`,
    );
  }

  const pdf = join(out, `${name}.pdf`);
  const svg = join(out, `${name}.svg`);
  const render = cli(["render", "--json", target, "-o", pdf]);
  cli(["render", target, "-o", svg]);
  const report = JSON.parse(render.stdout) as Report;
  // `render` skips the structural lint/* rules: `lint --geometry` runs them all.
  const full = diagnosticsOf(cli(["lint", "--geometry", "--json", target]).stdout);
  const extra = full.filter(
    (d) => !report.diagnostics.some((r) => r.code === d.code && r.message === d.message),
  );
  report.diagnostics.push(...extra);
  const bad = report.diagnostics.filter((d) => d.severity !== "info");
  const counts = new Map<string, number>();
  for (const d of report.diagnostics) counts.set(d.code, (counts.get(d.code) ?? 0) + 1);
  const listed = [...counts].map(([code, n]) => `${code} ×${n}`).join(", ") || "no diagnostics";
  const size = report.size;
  console.log(
    `${name}: ${size?.widthMm} × ${size?.heightMm}mm, scale ${size?.scale ?? 1}; exit ${render.exitCode}; ${listed}`,
  );
  for (const d of report.diagnostics) console.log(`  ${d.severity} ${d.code}: ${d.message}`);
  if (bad.length > 0 || render.exitCode !== 0 || !existsSync(pdf)) {
    failed = true;
    continue;
  }
  rmSync(join(out, `${name}.png`), { force: true });
  run(["pdftoppm", "-r", "200", "-png", "-singlefile", pdf, join(out, name)]);
  const preview = join(previews, `${name}.png`);
  run(["magick", join(out, `${name}.png`), "+dither", "-colors", "64", "-strip", preview]);
  const bytes = statSync(preview).size;
  console.log(`  ${preview.slice(root.length + 1)}: ${bytes} bytes`);
  if (bytes >= 150_000) failed = true;
}
if (failed) {
  console.error("errors, warnings or an oversized preview: see above");
  process.exit(1);
}
