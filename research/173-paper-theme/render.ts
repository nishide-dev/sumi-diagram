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

import { mkdirSync, statSync } from "node:fs";
import { join } from "node:path";

const here = import.meta.dir;
const root = join(here, "../..");
const out = join(here, "out");
const previews = join(here, "previews");
mkdirSync(out, { recursive: true });
mkdirSync(previews, { recursive: true });

function run(args: string[]): string {
  const result = Bun.spawnSync(args, { cwd: root, stdout: "pipe", stderr: "pipe" });
  const text = `${result.stdout.toString()}${result.stderr.toString()}`;
  if (result.exitCode !== 0 && args[0] !== "bun") {
    throw new Error(`${args.join(" ")} failed:\n${text}`);
  }
  return text;
}

for (const name of ["a-transformer", "b-dit", "c-h3world"]) {
  const figure = join(here, "figures", `${name}.sumi.yaml`);
  for (const theme of ["paper", "color"]) {
    const base = theme === "paper" ? name : `${name}.${theme}`;
    const pdf = join(out, `${base}.pdf`);
    const report = run(["bun", "src/cli/index.ts", "render", figure, "--theme", theme, "-o", pdf]);
    console.log(
      report
        .split("\n")
        .filter((line) => line.startsWith("Wrote"))
        .join("\n"),
    );
    run(["pdftoppm", "-r", "200", "-png", "-singlefile", pdf, join(out, base)]);
    const preview = join(previews, `${base}.png`);
    run(["magick", join(out, `${base}.png`), "-colors", "64", preview]);
    console.log(`  ${preview.slice(root.length + 1)}: ${statSync(preview).size} bytes`);
  }
}
