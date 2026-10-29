/** Rasterize every changed paper figure and make labelled review sheets. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { renderFigure } from "../../src/render";
import { svgToPdf } from "../../src/render/pdf";

const root = join(import.meta.dir, "../..");
const out = join(import.meta.dir, "out");
const previews = join(import.meta.dir, "previews");
mkdirSync(previews, { recursive: true });
function run(args: string[]) {
  const result = Bun.spawnSync(args, { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode) throw new Error(result.stderr.toString());
}
const changed = readFileSync(join(out, "changed.txt"), "utf8").trim().split("\n");
const files = [...new Set(changed.map((line) => line.split(" @ ")[0]))];
const tiles: string[] = [];
for (const [i, file] of files.entries()) {
  if (!file) continue;
  const target = file.startsWith("research/185-acceptance/figures/")
    ? join(out, "figures", file.split("/").at(-1) ?? "")
    : join(root, file);
  const result = await renderFigure(readFileSync(target, "utf8"), {
    file,
    assetBase: dirname(target),
    overrides: { theme: "paper" },
  });
  if (!result.ok) throw new Error(file);
  const pdf = svgToPdf(result.value.svg);
  if (!pdf.ok) throw new Error(file);
  const stem = join(out, `review-${i}`);
  writeFileSync(`${stem}.pdf`, pdf.value);
  run(["pdftoppm", "-r", "100", "-png", "-singlefile", `${stem}.pdf`, stem]);
  const tile = `${stem}-tile.png`;
  run([
    "magick",
    `${stem}.png`,
    "-resize",
    "420x320",
    "-background",
    "white",
    "-gravity",
    "center",
    "-extent",
    "440x340",
    "-gravity",
    "south",
    "-splice",
    "0x35",
    "-font",
    join(root, "assets/fonts/inter/Inter-Regular.ttf"),
    "-pointsize",
    "11",
    "-annotate",
    "+0+2",
    `${i}: ${file.replace(".sumi.yaml", "")}`,
    tile,
  ]);
  tiles.push(tile);
}
for (let i = 0; i < tiles.length; i += 12)
  run([
    "magick",
    "montage",
    "-font",
    join(root, "assets/fonts/inter/Inter-Regular.ttf"),
    ...tiles.slice(i, i + 12),
    "-tile",
    "3x",
    "-geometry",
    "+5+5",
    join(out, `sheet-${i / 12}.png`),
  ]);
for (const name of ["a-transformer", "b-dit", "c-h3world"]) {
  for (const phase of ["before", "after"]) {
    const stem = join(out, `${phase}-${name}`);
    const svg = readFileSync(`${stem}.svg`, "utf8");
    const width = Number(/\bwidth="([\d.]+)pt"/.exec(svg)?.[1]);
    const height = Number(/\bheight="([\d.]+)pt"/.exec(svg)?.[1]);
    console.log(
      `${phase} ${name}: ${((width * 25.4) / 72).toFixed(4)} × ${((height * 25.4) / 72).toFixed(4)}mm; at 170mm: ${((170 * height) / width).toFixed(4)}mm`,
    );
    run(["pdftoppm", "-r", "200", "-png", "-singlefile", `${stem}.pdf`, stem]);
  }
}
run([
  "magick",
  join(out, "after-c-h3world.png"),
  "+dither",
  "-colors",
  "64",
  "-strip",
  join(previews, "c-h3world.png"),
]);
console.log(
  `${files.length} changed paper figures rasterized; ${Math.ceil(tiles.length / 12)} sheets`,
);
for (const relative of ["components/sumi-operator", "tones/tones", "dim/dim"]) {
  const pdf = svgToPdf(readFileSync(join(root, "docs/gallery", `${relative}.paper.svg`), "utf8"));
  if (!pdf.ok) throw new Error(relative);
  const stem = join(out, relative.replaceAll("/", "-"));
  writeFileSync(`${stem}.pdf`, pdf.value);
  run(["pdftoppm", "-r", "150", "-png", "-singlefile", `${stem}.pdf`, stem]);
}
