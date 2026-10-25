/**
 * What the product's committed export engine (assets/wasm/sumi-pdf.wasm:
 * krilla 0.8.2 + krilla-svg 0.8.1 + resvg 0.47.0) does with images embedded
 * in an SVG: raster formats as data URIs, nested SVG, an external file
 * reference, and active content (script, foreignObject, event handler).
 *
 * The test images are generated here (solid colors + a gradient), so nothing
 * copyrighted is involved. Output PDFs/PNGs go to out/engine/.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getFontSet } from "../../../src/core/theme/fonts";
import { loadEngine, runEngine } from "../../../src/render/pdf/engine";
import { countPdfImages, mustRun } from "./tools";

const OUT = join(import.meta.dir, "..", "out", "engine");

const NESTED_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#36c"/></svg>';
const HOSTILE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script><rect width="10" height="10" fill="#c63" onclick="alert(2)"/><foreignObject width="10" height="10"><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject><image href="https://example.com/x.png" width="10" height="10"/></svg>';

async function makeRasters(): Promise<Record<string, Uint8Array>> {
  const out: Record<string, Uint8Array> = {};
  for (const ext of ["png", "jpg", "webp", "gif"]) {
    const file = join(OUT, `sample.${ext}`);
    // Deterministic synthetic image: a 64x48 gradient. -strip drops timestamps.
    const r = await mustRun([
      "magick",
      "-size",
      "64x48",
      "gradient:#204080-#f0c040",
      "-strip",
      file,
    ]);
    if (r.exitCode !== 0) throw new Error(`magick ${ext}: ${r.stderr}`);
    out[ext] = new Uint8Array(await readFile(file));
  }
  return out;
}

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

export interface EngineImageCase {
  name: string;
  pdfOk: boolean;
  pdfMessage?: string;
  pdfBytes?: number;
  /** `pdfimages -list` rows (image + smask entries) */
  pdfImages?: number;
  pdfDeterministic?: boolean;
  pictureOk: boolean;
  /** Non-white pixels in the 192dpi PNG inside the probe's image box, as a fraction. */
  inkFraction?: number;
  outlinedSvgHasImage?: boolean;
}

function svgWith(inner: string): string {
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="60pt" height="60pt" viewBox="0 0 120 120">',
    '<rect x="0" y="0" width="120" height="120" fill="#ffffff"/>',
    inner,
    "</svg>",
  ].join("");
}

async function pngInk(png: Uint8Array, name: string): Promise<number> {
  const file = join(OUT, `${name}.png`);
  await writeFile(file, png);
  // Fraction of pixels in the central box that are not near-white.
  const r = await mustRun([
    "magick",
    file,
    "-gravity",
    "center",
    "-crop",
    "50%x50%+0+0",
    "-colorspace",
    "gray",
    "-threshold",
    "95%",
    "-negate",
    "-format",
    "%[fx:mean]",
    "info:",
  ]);
  const ink = Number(r.stdout.trim());
  if (r.stdout.trim() === "" || !Number.isFinite(ink)) throw new Error(`magick: ${r.stdout}`);
  return ink;
}

export async function runEngineImageProbes(): Promise<EngineImageCase[]> {
  await mkdir(OUT, { recursive: true });
  const rasters = await makeRasters();
  const fontSet = getFontSet("sumi/biz-ud-gothic");
  if (fontSet === undefined) throw new Error("font set");
  const fonts = [new Uint8Array(await readFile(fontSet.regular))];
  const module = loadEngine();
  const b64 = (bytes: Uint8Array | string) => Buffer.from(bytes).toString("base64");
  const box = 'x="30" y="30" width="60" height="60"';
  const cases: [string, string][] = [
    ...Object.entries(rasters).map(([ext, bytes]): [string, string] => [
      `data-${ext}`,
      `<image ${box} href="data:${MIME[ext]};base64,${b64(bytes)}"/>`,
    ]),
    ["data-svg", `<image ${box} href="data:image/svg+xml;base64,${b64(NESTED_SVG)}"/>`],
    [
      "xlink-href-png",
      `<image ${box} xlink:href="data:image/png;base64,${b64(rasters.png ?? "")}"/>`,
    ],
    ["external-file", `<image ${box} href="sample.png"/>`],
    ["external-url", `<image ${box} href="https://example.com/sample.png"/>`],
    ["hostile-svg", `<image ${box} href="data:image/svg+xml;base64,${b64(HOSTILE_SVG)}"/>`],
    [
      "inline-foreign-object",
      `<foreignObject ${box}><div xmlns="http://www.w3.org/1999/xhtml" style="background:#000;width:60px;height:60px">x</div></foreignObject>`,
    ],
  ];
  const results: EngineImageCase[] = [];
  for (const [name, inner] of cases) {
    const svg = new TextEncoder().encode(svgWith(inner));
    const pdf = runEngine(module, svg, fonts, "convert");
    const row: EngineImageCase = { name, pdfOk: pdf.ok, pictureOk: false };
    if (pdf.ok) {
      const file = join(OUT, `${name}.pdf`);
      await writeFile(file, pdf.pdf);
      row.pdfBytes = pdf.pdf.length;
      const again = runEngine(module, svg, fonts, "convert");
      row.pdfDeterministic = again.ok && Buffer.from(again.pdf).equals(Buffer.from(pdf.pdf));
      const list = await mustRun(["pdfimages", "-list", file]);
      row.pdfImages = countPdfImages(list.stdout);
    } else row.pdfMessage = pdf.message;
    const picture = runEngine(module, svg, fonts, "picture");
    if (picture.ok) {
      row.pictureOk = true;
      const bytes = picture.pdf;
      const pngLength = new DataView(bytes.buffer, bytes.byteOffset).getUint32(0, true);
      const png = bytes.slice(4, 4 + pngLength);
      const outlined = new TextDecoder().decode(bytes.slice(4 + pngLength));
      row.inkFraction = Number((await pngInk(png, name)).toFixed(4));
      row.outlinedSvgHasImage = outlined.includes("<image");
    }
    results.push(row);
  }
  return results;
}

if (import.meta.main) console.log(JSON.stringify(await runEngineImageProbes(), null, 2));
