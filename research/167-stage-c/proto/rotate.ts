/**
 * #167 prototype P2: rotated labels (`labelRotation`, #86 §5.1) through the
 * product's output path, without changing the product.
 *
 * Takes figure C as rendered by the product (out/c-h3world.svg, written by
 * render.sh), replaces the three-line "Visual / VAE / Encoder" label by one
 * line rotated -90° about the box centre (`transform="rotate(-90 cx cy)"` on
 * the <text>), and checks:
 *   1. inspectSvg() — the inspect contract (§6.3) today rejects transforms;
 *   2. svgToPdf() — the PDF engine (krilla / usvg) draws it, and the text
 *      stays text (pdftotext finds the words, pdffonts lists no Type 3);
 *   3. a PNG preview (pdftoppm) to see the placement.
 * Usage: bun research/167-stage-c/proto/rotate.ts   (after render.sh on c-h3world)
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { compileFigure } from "../../../src/compiler/compile";
import { getFontSet } from "../../../src/core/theme/fonts";
import { inspectSvg } from "../../../src/render/inspect";
import { svgToPdf } from "../../../src/render/pdf/pdf";

const HERE = dirname(import.meta.dir);
const svg = readFileSync(join(HERE, "out/c-h3world.svg"), "utf8");
const start = svg.indexOf('<g class="sumi-k-n--vae');
if (start < 0) throw new Error("render c-h3world first (sh research/167-stage-c/render.sh …)");
const rect = /<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/.exec(
  svg.slice(start),
);
const textStart = svg.indexOf("<text", start);
const textEnd = svg.indexOf("</text>", textStart) + "</text>".length;
if (!rect || textStart < 0) throw new Error("no VAE rectangle or text");
const [x, y, w, h] = rect.slice(1).map(Number) as [number, number, number, number];
const cx = x + w / 2;
const cy = y + h / 2;
const old = svg.slice(textStart, textEnd);
const attrs = /<text ([^>]*)>/.exec(old)?.[1] ?? "";
// One line, centred on the box centre, baseline shifted by ~0.35em as the writer does.
const fontSize = Number(/font-size:(\d+(?:\.\d+)?)px/.exec(attrs)?.[1] ?? "16");
const rotated = `<text ${attrs.replace(/x="[^"]*"/, `x="${cx}"`).replace(/y="[^"]*"/, `y="${(cy + fontSize * 0.35).toFixed(3)}"`)} transform="rotate(-90 ${cx} ${cy})">Visual VAE Encoder</text>`;
const patched = svg.slice(0, textStart) + rotated + svg.slice(textEnd);
writeFileSync(join(HERE, "out/rotate.svg"), patched);

const compiled = compileFigure(readFileSync(join(HERE, "figures/c-h3world.sumi.yaml"), "utf8"));
if (!compiled.ok) throw new Error("figure C does not compile");
const inspected = inspectSvg(patched, compiled.value.ir);
const baseline = inspectSvg(svg, compiled.value.ir);
console.log("inspect (unpatched):", baseline.ok ? "accepted" : "rejected");
const inspectProblems = inspected.ok
  ? []
  : inspected.diagnostics.map((d) => `${d.code}: ${d.message}`);
console.log("inspect:", inspected.ok ? "accepted" : inspectProblems);

const fonts = getFontSet("sumi/biz-ud-gothic");
const pdf = svgToPdf(patched, fonts === undefined ? {} : { fontSet: fonts });
if (!pdf.ok) {
  console.log(
    "pdf:",
    pdf.diagnostics.map((d) => `${d.code}: ${d.message}`),
  );
} else {
  const out = join(HERE, "out/rotate.pdf");
  writeFileSync(out, pdf.value);
  const text = execFileSync("pdftotext", ["-raw", out, "-"], { encoding: "utf8" });
  const fontsList = execFileSync("pdffonts", [out], { encoding: "utf8" });
  console.log("pdf: bytes", pdf.value.length);
  console.log("pdftotext finds 'Visual VAE Encoder':", text.includes("Visual VAE Encoder"));
  console.log("Type 3 fonts:", fontsList.includes("Type 3"));
  execFileSync("pdftoppm", [
    "-r",
    "200",
    "-png",
    "-singlefile",
    "-x",
    "1480",
    "-y",
    "40",
    "-W",
    "260",
    "-H",
    "430",
    out,
    join(HERE, "out/rotate"),
  ]);
  writeFileSync(
    join(HERE, "results/rotate.json"),
    `${JSON.stringify({ inspect: inspected.ok ? "accepted" : inspectProblems, pdfBytes: pdf.value.length, extracted: text.includes("Visual VAE Encoder"), type3: fontsList.includes("Type 3") }, null, 2)}\n`,
  );
}
