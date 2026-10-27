/**
 * #129: the product PDF engine and headless Chrome draw label-math accents at
 * the same positions (outside CI: needs Google Chrome; Poppler and
 * ImageMagick only for the preview images).
 *
 *   bun research/129-math-accents/verify.ts            # report to stdout, files to out/
 *   bun research/129-math-accents/verify.ts --record   # also write results/verify.json
 *
 * 1. Renders `figure.sumi.yaml` (6 accents × lowercase, uppercase, Greek,
 *    subscripted and Math-font bases, next to math, text and CJK text) with
 *    the product pipeline to SVG and, through the product PDF engine
 *    (usvg / krilla, which the picture PPTX shares via resvg), to PDF.
 * 2. Reads every glyph's origin from the PDF (Sumi's PDF reader), and every
 *    character's start position from headless Chrome
 *    (`SVGTextContentElement.getStartPositionOfChar()` on the SVG inlined in
 *    an HTML page, after its fonts loaded), both in SVG units.
 * 3. Pairs them in drawing order (whitespace left out: the PDF may not draw
 *    a space) and reports the largest difference, overall and for the marks.
 * 4. Writes PNG previews of both renderers (`pdftoppm`, Chrome's screenshot)
 *    and a side-by-side image (ImageMagick), if the tools exist.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { svgToPdf } from "../../src/render/pdf";
import { inspectPdf } from "../../src/render/pdf/testing";
import { type RenderedStructuredFigure, renderFigure } from "../../src/render/render";

const DIR = import.meta.dir;
const OUT = join(DIR, "out");
mkdirSync(OUT, { recursive: true });
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
if (!existsSync(CHROME)) throw new Error(`Google Chrome not found at ${CHROME}`);

// --- 1. Render ------------------------------------------------------------------

const source = readFileSync(join(DIR, "figure.sumi.yaml"), "utf8");
const result = await renderFigure(source, {
  backend: {
    name: "d2-cli",
    render: () => {
      throw new Error("a structured figure must not reach the D2 backend");
    },
  },
});
if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
const rendered = result.value as RenderedStructuredFigure;
const { svg } = rendered;
writeFileSync(join(OUT, "figure.svg"), svg);
const pdf = svgToPdf(svg);
if (!pdf.ok) throw new Error(JSON.stringify(pdf.diagnostics));
writeFileSync(join(OUT, "figure.pdf"), pdf.value);

// --- 2. Positions ---------------------------------------------------------------

interface Glyph {
  text: string;
  x: number;
  y: number;
}

const vb = rendered.inspection.canvas.viewBox;
const inspected = inspectPdf(pdf.value);
const pageHeight = inspected.pages[0]?.mediaBox[3] ?? 0;
// The PDF is at 0.5pt per unit (the profile's scale), y up.
const engine: Glyph[] = inspected.glyphs.map((g) => ({
  text: g.text,
  x: g.x / 0.5 + vb.x,
  y: (pageHeight - g.y) / 0.5 + vb.y,
}));

const page = `<!doctype html><meta charset="utf-8"><body style="margin:0">${svg.replace(/^<\?xml[^>]*\?>/, "")}<pre id="out"></pre><script>
document.fonts.ready.then(() => {
  const out = [];
  for (const text of document.querySelectorAll("text")) {
    const chars = [...text.textContent];
    let i = 0;
    for (const char of chars) {
      const p = text.getStartPositionOfChar(i);
      out.push({ text: char, x: p.x, y: p.y });
      i += char.length;
    }
  }
  document.getElementById("out").textContent = JSON.stringify(out);
});
</script>`;
const pagePath = join(OUT, "figure.html");
writeFileSync(pagePath, page);
const dump = Bun.spawnSync([
  CHROME,
  "--headless=new",
  "--disable-gpu",
  "--virtual-time-budget=5000",
  "--dump-dom",
  `file://${pagePath}`,
]);
const json = /<pre id="out">(.*?)<\/pre>/s.exec(dump.stdout.toString())?.[1];
if (json === undefined || json === "") throw new Error("Chrome did not report positions");
const chrome: Glyph[] = JSON.parse(
  json
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&"),
);

// --- 3. Compare -----------------------------------------------------------------

const visible = (g: Glyph) => g.text.trim() !== "";
const a = engine.filter(visible);
const b = chrome.filter(visible);
if (a.length !== b.length) {
  throw new Error(`the PDF draws ${a.length} glyphs, Chrome ${b.length} characters`);
}
const MARK = /^\p{M}$/u;
let max = 0;
let maxMark = 0;
let marks = 0;
const worst: { text: string; engine: Glyph; chrome: Glyph; distance: number }[] = [];
for (const [i, g] of a.entries()) {
  const c = b[i] as Glyph;
  if (g.text !== c.text) throw new Error(`glyph ${i}: the PDF has "${g.text}", Chrome "${c.text}"`);
  const distance = Math.hypot(g.x - c.x, g.y - c.y);
  max = Math.max(max, distance);
  if (MARK.test(g.text)) {
    marks++;
    maxMark = Math.max(maxMark, distance);
  }
  worst.push({ text: g.text, engine: g, chrome: c, distance });
}
worst.sort((p, q) => q.distance - p.distance);

// --- 4. Previews ----------------------------------------------------------------

const previews: Record<string, string> = {};
const png = Bun.spawnSync([
  "pdftoppm",
  "-r",
  "288",
  "-png",
  "-singlefile",
  join(OUT, "figure.pdf"),
  join(OUT, "engine"),
]);
if (png.exitCode === 0) previews.engine = "out/engine.png";
const { width, height } = rendered.layout.canvas;
// The PDF at 288 dpi: 0.5pt per unit × 4 px per pt = 2 px per unit.
const shot = Bun.spawnSync([
  CHROME,
  "--headless=new",
  "--disable-gpu",
  "--hide-scrollbars",
  "--force-device-scale-factor=2",
  `--window-size=${Math.ceil(width)},${Math.ceil(height)}`,
  `--screenshot=${join(OUT, "chrome.png")}`,
  `file://${join(OUT, "figure.svg")}`,
]);
if (shot.exitCode === 0) previews.chrome = "out/chrome.png";
if (previews.engine !== undefined && previews.chrome !== undefined) {
  // Both trimmed to the drawing and scaled to the same width.
  const scaled = (file: string) => ["(", join(OUT, file), "-trim", "-resize", "560x", ")"];
  const side = Bun.spawnSync([
    "magick",
    ...scaled("engine.png"),
    ...scaled("chrome.png"),
    "-bordercolor",
    "white",
    "-border",
    "12",
    "+append",
    "-colors",
    "16",
    join(OUT, "side-by-side.png"),
  ]);
  if (side.exitCode === 0) previews.sideBySide = "out/side-by-side.png";
}

// Poppler's extraction of the PDF, if installed: each base, then its mark.
const extracted = Bun.spawnSync(["pdftotext", "-raw", join(OUT, "figure.pdf"), "-"]);
const pdftotext =
  extracted.exitCode === 0 ? extracted.stdout.toString().trim().split("\n") : "pdftotext failed";
const version = Bun.spawnSync([CHROME, "--version"]).stdout.toString().trim();

const round = (v: number) => Math.round(v * 1e4) / 1e4;
const report = {
  chrome: version,
  pdftotext,
  glyphs: a.length,
  marks,
  maxDistanceUnits: round(max),
  maxMarkDistanceUnits: round(maxMark),
  worst: worst.slice(0, 5).map((w) => ({
    text: w.text,
    engine: { x: round(w.engine.x), y: round(w.engine.y) },
    chrome: { x: round(w.chrome.x), y: round(w.chrome.y) },
    distance: round(w.distance),
  })),
  previews,
};
const text = `${JSON.stringify(report, null, 1)}\n`;
if (process.argv.includes("--record")) {
  mkdirSync(join(DIR, "results"), { recursive: true });
  writeFileSync(join(DIR, "results", "verify.json"), text);
}
process.stdout.write(text);
