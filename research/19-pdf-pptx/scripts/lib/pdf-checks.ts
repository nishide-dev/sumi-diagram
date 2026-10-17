/** PDF checks shared by pdf.ts and validate-pptx.ts (poppler + ImageMagick). */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { BUILTIN_FONT_SETS, DEFAULT_FONT_SET_ID } from "../../../../src/core/theme/fonts";
import { measureLabel, renderedLines } from "../../../../src/lint/geometry/measure";
import type { SvgInspection } from "../../../../src/render";

const SVG_DIR = join(resolve(import.meta.dir, "..", ".."), "out", "svg");
export const DPI = 144;
const fontSet = BUILTIN_FONT_SETS.get(DEFAULT_FONT_SET_ID);

export function run(cmd: string[], env: Record<string, string> = {}): { ok: boolean; out: string } {
  const p = Bun.spawnSync(cmd, { env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
  return { ok: p.exitCode === 0, out: `${p.stdout.toString()}${p.stderr.toString()}` };
}

export function readInspection(id: string): SvgInspection {
  return JSON.parse(readFileSync(join(SVG_DIR, `${id}.inspection.json`), "utf8"));
}

interface PdfLine {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

function pdfLines(pdf: string): PdfLine[] {
  const { out } = run(["pdftotext", "-bbox-layout", pdf, "-"]);
  const lines: PdfLine[] = [];
  for (const m of out.matchAll(
    /<line xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([\s\S]*?)<\/line>/g,
  )) {
    const words = [...(m[5] ?? "").matchAll(/>([^<]*)<\/word>/g)].map((w) => w[1] ?? "");
    const [x0, y0, x1, y1] = [m[1], m[2], m[3], m[4]].map(Number) as [
      number,
      number,
      number,
      number,
    ];
    lines.push({
      text: words.join(" ").replaceAll("&amp;", "&"),
      x: x0,
      y: y0,
      width: x1 - x0,
      height: y1 - y0,
    });
  }
  return lines;
}

/** Compares label line boxes: SVG (Sumi's measurement, pt) vs the PDF text layer. */
export function textPositions(id: string, pdf: string) {
  const inspection = readInspection(id);
  const vb = inspection.canvas.viewBox;
  const found = pdfLines(pdf);
  const norm = (s: string) => s.replace(/\s+/g, "");
  let matched = 0;
  let expected = 0;
  let maxDx = 0;
  let maxDw = 0;
  let maxDy = 0;
  for (const el of inspection.elements) {
    for (const label of el.labels) {
      const measured = measureLabel(label, fontSet as NonNullable<typeof fontSet>);
      renderedLines(label.text).forEach((text, i) => {
        const box = measured.lines[i];
        if (box === undefined || text.trim() === "") return;
        expected++;
        const ex = (box.x - vb.x) * 0.5;
        const ey = (box.y - vb.y) * 0.5;
        // The same text can occur twice ("yes"): take the nearest occurrence.
        const hit = found
          .filter((l) => norm(l.text) === norm(text))
          .sort((a, b) => Math.hypot(a.x - ex, a.y - ey) - Math.hypot(b.x - ex, b.y - ey))[0];
        if (hit === undefined) return;
        matched++;
        maxDx = Math.max(maxDx, Math.abs(hit.x - ex));
        maxDw = Math.max(maxDw, Math.abs(hit.width - box.width * 0.5));
        maxDy = Math.max(maxDy, Math.abs(hit.y - ey));
      });
    }
  }
  const r = (n: number) => Math.round(n * 100) / 100;
  return { expected, matched, maxDxPt: r(maxDx), maxDwidthPt: r(maxDw), maxDyTopPt: r(maxDy) };
}

export function pdfInfo(pdf: string) {
  const info = run(["pdfinfo", pdf]).out;
  const size = /Page size:\s+([\d.]+) x ([\d.]+) pts/.exec(info);
  const pages = Number(/Pages:\s+(\d+)/.exec(info)?.[1]);
  const fonts = run(["pdffonts", pdf])
    .out.split("\n")
    .slice(2)
    .filter((l) => l.trim() !== "")
    .map((l) => l.replace(/\s+/g, " ").trim());
  // `pdfimages -list`: every raster image (and soft mask) with its size and resolution.
  const images = run(["pdfimages", "-list", pdf])
    .out.split("\n")
    .slice(2)
    .map((l) => l.trim().split(/\s+/))
    .filter((c) => c.length >= 14)
    .map((c) => ({
      type: c[2],
      width: Number(c[3]),
      height: Number(c[4]),
      xPpi: Number(c[12]),
      yPpi: Number(c[13]),
    }));
  return {
    pages,
    widthPt: Number(size?.[1]),
    heightPt: Number(size?.[2]),
    producer: /Producer:\s+(.*)/.exec(info)?.[1]?.trim() ?? null,
    creationDate: /CreationDate:\s+(.*)/.exec(info)?.[1]?.trim() ?? null,
    fonts,
    rasterImages: {
      count: images.length,
      byType: Object.fromEntries(
        [...new Set(images.map((i) => i.type))].map((t) => [
          t,
          images.filter((i) => i.type === t).length,
        ]),
      ),
      ppi: [...new Set(images.map((i) => i.xPpi))].sort((a, b) => a - b),
      list: images,
    },
  };
}

export function rasterize(pdf: string, png: string) {
  run([
    "pdftoppm",
    "-r",
    String(DPI),
    "-png",
    "-singlefile",
    "-f",
    "1",
    "-l",
    "1",
    pdf,
    png.replace(/\.png$/, ""),
  ]);
}

/** Share of pixels differing by more than 25% (anti-aliasing tolerated), same canvas size. */
export function pixelDiff(ref: string, png: string, diffPng: string): number | null {
  const size = run(["magick", "identify", "-format", "%wx%h", ref]).out.trim();
  const sized = png.replace(/\.png$/, ".sized.png");
  run(["magick", png, "-background", "white", "-alpha", "remove", "-extent", size, sized]);
  const p = Bun.spawnSync(
    ["magick", "compare", "-metric", "AE", "-fuzz", "25%", ref, sized, diffPng],
    { stdout: "pipe", stderr: "pipe" },
  );
  const ae = Number(/^[\d.e+]+/.exec(p.stderr.toString().trim())?.[0]);
  const [w, h] = size.split("x").map(Number) as [number, number];
  return Number.isFinite(ae) ? Math.round((ae / (w * h)) * 100000) / 1000 : null;
}
