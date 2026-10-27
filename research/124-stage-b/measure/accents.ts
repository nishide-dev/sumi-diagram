/**
 * Math accents (`\hat` `\tilde` `\bar` `\dot` `\ddot` `\vec`) with the
 * bundled STIX Two fonts (#124 §5).
 *
 *   bun research/124-stage-b/measure/accents.ts            # facts + renders to out/accents/
 *   bun research/124-stage-b/measure/accents.ts --record   # also write results/accents.json
 *
 * 1. Font facts: which fonts map each combining accent (U+0302 …) and its
 *    spacing form, the advance, whether the font has a GPOS `mark` feature
 *    and a MATH table.
 * 2. Renders of the same accented letters three ways, each through the
 *    product's PDF engine (usvg / krilla, which the picture PPTX shares via
 *    resvg) and through headless Chrome (an SVG viewer), at 4× size:
 *      A. base + combining mark in one string, fonts WITHOUT GPOS: what Sumi
 *         outputs today would do (the SVG embeds subsets without GSUB/GPOS,
 *         §6.23; the PDF export strips both from the math fonts, §6.24);
 *      B. the same with the full fonts (GPOS mark positioning);
 *      C. Sumi positions the accent itself: the base as text, the accent as
 *         a separate glyph centred over the base's outline (glyf bbox) and
 *         shifted by the italic slant (post.italicAngle);
 *      D. as A (fonts without GPOS, the mark after its base in the same
 *         `<text>`), but the mark in its own `<tspan dy>` raised by how far
 *         the base's outline rises above the x-height (OS/2 sxHeight), then
 *         a `dy` back to the baseline: only what Sumi's run model (#93)
 *         already writes (vertical shifts, no `dx`).
 *    Chrome is optional (skipped if not found).
 * 3. Mode E: the representation proposed for the product (absolute-positioned
 *    chunks inside one middle-anchored `<text>`, mixed fonts, a Math-font
 *    base, a subscript after the accented base, Japanese), through both
 *    renderers, and the PDF text extraction (Poppler `pdftotext -raw`).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getFontSet } from "../../../src/core/theme/fonts";
import { parseGlyphCoverage } from "../../../src/lint/cmap";
import { parseFontMetrics } from "../../../src/lint/metrics";
import { readTables } from "../../../src/lint/sfnt";
import { withCodePoints, withFamily, withoutTables } from "../../../src/render/font-subset";
import { loadEngine, runEngine } from "../../../src/render/pdf/engine";

const OUT = join(import.meta.dir, "../out/accents");
mkdirSync(OUT, { recursive: true });

const fonts = getFontSet("sumi/biz-ud-gothic");
if (fonts?.math === undefined || fonts.mathItalic === undefined) throw new Error("no math fonts");
const FILES = {
  "STIX Two Text Italic": fonts.mathItalic,
  "STIX Two Math": fonts.math,
  "BIZ UDPGothic": fonts.regular,
};

const ACCENTS = [
  { command: "\\hat", combining: 0x0302, spacing: 0x02c6 },
  { command: "\\tilde", combining: 0x0303, spacing: 0x02dc },
  { command: "\\bar", combining: 0x0304, spacing: 0x00af },
  { command: "\\dot", combining: 0x0307, spacing: 0x02d9 },
  { command: "\\ddot", combining: 0x0308, spacing: 0x00a8 },
  { command: "\\vec", combining: 0x20d7, spacing: undefined },
];
const BASES = ["y", "x", "θ", "W"];
const PRECOMPOSED = ["ŷ", "ỹ", "ȳ", "ẏ", "ÿ"];

const hex = (cp: number) => `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;

/** GPOS feature tags and whether a MATH table exists. */
function layoutTables(bytes: Uint8Array) {
  const tables = readTables(bytes);
  const gpos = tables.get("GPOS");
  const features = new Set<string>();
  if (gpos !== undefined) {
    const list = gpos.u16(6);
    const count = gpos.u16(list);
    for (let i = 0; i < count; i++) {
      const t = gpos.u32(list + 2 + i * 6);
      features.add(String.fromCharCode(t >>> 24, (t >>> 16) & 255, (t >>> 8) & 255, t & 255));
    }
  }
  return { gposFeatures: [...features].sort(), math: tables.get("MATH") !== undefined };
}

/** Glyph bounding box (font units) from glyf / loca; `undefined` for an empty glyph. */
function glyphBox(bytes: Uint8Array, glyph: number) {
  const tables = readTables(bytes);
  const head = tables.require("head");
  const long = head.i16(50) === 1;
  const loca = tables.require("loca");
  const glyf = tables.require("glyf");
  const at = (i: number) => (long ? loca.u32(i * 4) : loca.u16(i * 2) * 2);
  const start = at(glyph);
  if (at(glyph + 1) === start) return undefined;
  return {
    xMin: glyf.i16(start + 2),
    yMin: glyf.i16(start + 4),
    xMax: glyf.i16(start + 6),
    yMax: glyf.i16(start + 8),
  };
}

/** post.italicAngle in degrees (Fixed 16.16). */
function italicAngle(bytes: Uint8Array): number {
  const post = readTables(bytes).require("post");
  const raw = post.u32(4) | 0;
  return raw / 65536;
}

// --- 1. Facts -------------------------------------------------------------------

const facts = Object.entries(FILES).map(([name, file]) => {
  const bytes = new Uint8Array(readFileSync(file));
  const metrics = parseFontMetrics(bytes);
  const coverage = parseGlyphCoverage(bytes);
  const em = (cp: number) =>
    coverage.has(cp)
      ? Math.round((metrics.advanceOf(cp) / metrics.unitsPerEm) * 1000) / 1000
      : null;
  return {
    font: name,
    ...layoutTables(bytes),
    italicAngle: italicAngle(bytes),
    accents: ACCENTS.map((a) => ({
      command: a.command,
      combining: hex(a.combining),
      combiningAdvanceEm: em(a.combining),
      spacing: a.spacing === undefined ? null : hex(a.spacing),
      spacingAdvanceEm: a.spacing === undefined ? null : em(a.spacing),
    })),
    precomposed: Object.fromEntries(
      PRECOMPOSED.map((c) => [c, [...c].every((ch) => coverage.has(ch.codePointAt(0) as number))]),
    ),
    bases: Object.fromEntries(BASES.map((b) => [b, coverage.has(b.codePointAt(0) as number)])),
  };
});

// --- 2. Renders -----------------------------------------------------------------

const textItalic = new Uint8Array(readFileSync(FILES["STIX Two Text Italic"]));
const math = new Uint8Array(readFileSync(FILES["STIX Two Math"]));
const italicMetrics = parseFontMetrics(textItalic);
const italicCoverage = parseGlyphCoverage(textItalic);
const mathCoverage = parseGlyphCoverage(math);
const mathMetrics = parseFontMetrics(math);
const SIZE = 48; // px (= 4× an 8pt label at 1 unit = 0.5pt … only the ratio matters)
const slant = Math.tan((-italicAngle(textItalic) * Math.PI) / 180);
/** OS/2 sxHeight of STIX Two Text Italic (font units). */
const xHeight = (() => {
  const os2 = readTables(textItalic).require("OS/2");
  return os2.i16(86);
})();

/** Which font a combining mark is drawn from: Text Italic if it maps it, else Math. */
const markFont = (cp: number) => (italicCoverage.has(cp) ? "italic" : "math");

function panelSvg(mode: "A" | "B" | "C" | "D", fontFaces: string): string {
  const rows: string[] = [];
  const cell = SIZE * 1.6;
  ACCENTS.forEach((a, r) => {
    const y = 20 + (r + 1) * cell;
    rows.push(
      `<text x="10" y="${y}" style="font-family:'Label';font-size:${SIZE / 2.5}px">${a.command.replace("\\", "\\\\").replace("\\\\", "\\")}</text>`,
    );
    BASES.forEach((b, c) => {
      const x = 140 + c * cell;
      const markIn = markFont(a.combining);
      if (mode === "A" || mode === "B") {
        // One string; the mark from whichever font maps it (one <text>, like a Sumi run).
        const family = markIn === "italic" ? "'SumiItalic'" : "'SumiItalic','SumiMath'";
        rows.push(
          `<text x="${x}" y="${y}" style="font-family:${family};font-size:${SIZE}px">${b}${String.fromCodePoint(a.combining)}</text>`,
        );
        return;
      }
      const gid = italicCoverage.glyph(b.codePointAt(0) as number);
      const box = glyphBox(textItalic, gid);
      const upm = italicMetrics.unitsPerEm;
      const markFile = markIn === "italic" ? textItalic : math;
      const markCov = markIn === "italic" ? italicCoverage : mathCoverage;
      const markUpm = markIn === "italic" ? upm : mathMetrics.unitsPerEm;
      const mbox = glyphBox(markFile, markCov.glyph(a.combining));
      if (box === undefined || mbox === undefined) return;
      const s = SIZE / upm;
      const ms = SIZE / markUpm;
      const markFamily = markIn === "italic" ? "'SumiItalic'" : "'SumiMath'";
      if (mode === "D") {
        // Raise the mark by how far the base rises above the x-height.
        const raise = Math.max(0, (box.yMax - xHeight) * s);
        rows.push(
          `<text x="${x}" y="${y}" style="font-family:'SumiItalic';font-size:${SIZE}px">${b}<tspan dy="${(-raise).toFixed(2)}" style="font-family:${markFamily}">${String.fromCodePoint(a.combining)}</tspan><tspan dy="${raise.toFixed(2)}"> </tspan></text>`,
        );
        return;
      }
      // C: the base, then the accent centred over the base's outline, slanted.
      const gap = SIZE * 0.04;
      const baseCenter = ((box.xMin + box.xMax) / 2) * s;
      const markCenter = ((mbox.xMin + mbox.xMax) / 2) * ms;
      const italicShift = slant * (box.yMax * s - ((box.yMin + box.yMax) / 2) * s);
      const ax = x + baseCenter + italicShift - markCenter;
      // The mark's bottom (mbox.yMin above its baseline) just over the base's top.
      const markBaseline = y - box.yMax * s - gap + mbox.yMin * ms;
      rows.push(
        `<text x="${x}" y="${y}" style="font-family:'SumiItalic';font-size:${SIZE}px">${b}</text>`,
        `<text x="${ax.toFixed(2)}" y="${markBaseline.toFixed(2)}" style="font-family:${markFamily};font-size:${SIZE}px">${String.fromCodePoint(a.combining)}</text>`,
      );
    });
  });
  const width = 140 + BASES.length * cell + 20;
  const height = 40 + (ACCENTS.length + 1) * cell;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><style>${fontFaces}</style><rect width="100%" height="100%" fill="white"/><text x="10" y="40" style="font-family:'Label';font-size:${SIZE / 2.5}px">mode ${mode}</text>${rows.join("")}</svg>`;
}

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const face = (family: string, bytes: Uint8Array) =>
  `@font-face{font-family:'${family}';src:url(data:font/ttf;base64,${b64(bytes)})}`;
const label = new Uint8Array(readFileSync(FILES["BIZ UDPGothic"]));

const renders: Record<string, unknown> = {};
const engine = loadEngine();
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
for (const mode of ["A", "B", "C", "D"] as const) {
  const shaped = mode === "B";
  const it = shaped ? textItalic : withoutTables(textItalic, ["GSUB", "GPOS"]);
  const ma = shaped ? math : withoutTables(math, ["GSUB", "GPOS"]);
  // For the PDF engine the families are the fonts' real names (it resolves
  // by name, like `resolveSvgFonts()`); for Chrome, @font-face data URIs.
  const engineSvg = panelSvg(mode, "")
    .replaceAll("'SumiItalic'", "'STIX Two Text'")
    .replaceAll("font-size:", "font-style:normal;font-size:")
    .replaceAll("font-family:'STIX Two Text'", "font-style:italic;font-family:'STIX Two Text'")
    .replaceAll("'SumiMath'", "'STIX Two Math'")
    .replaceAll("'Label'", "'BIZ UDPGothic'");
  writeFileSync(join(OUT, `${mode}.engine.svg`), engineSvg);
  const pdf = runEngine(engine, new TextEncoder().encode(engineSvg), [label, it, ma]);
  if (!pdf.ok) throw new Error(`engine: ${pdf.message}`);
  const pdfPath = join(OUT, `${mode}.pdf`);
  writeFileSync(pdfPath, pdf.pdf);
  const png = Bun.spawnSync([
    "pdftoppm",
    "-r",
    "72",
    "-png",
    "-singlefile",
    pdfPath,
    join(OUT, `${mode}.engine`),
  ]);
  renders[`${mode}.engine`] =
    png.exitCode === 0 ? `out/accents/${mode}.engine.png` : "pdftoppm failed";
  const browserSvg = panelSvg(
    mode,
    face("SumiItalic", it) + face("SumiMath", ma) + face("Label", label),
  );
  const svgPath = join(OUT, `${mode}.chrome.svg`);
  writeFileSync(svgPath, browserSvg);
  if (existsSync(chrome)) {
    const shot = Bun.spawnSync([
      chrome,
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      `--screenshot=${join(OUT, `${mode}.chrome.png`)}`,
      "--window-size=520,720",
      `file://${svgPath}`,
    ]);
    renders[`${mode}.chrome`] =
      shot.exitCode === 0 ? `out/accents/${mode}.chrome.png` : "chrome failed";
  }
}

// --- 3. Mode E: the representation proposed for the product (§3.6) -------------
//
// One middle-anchored `<text>` per label, like Sumi's writer: a line is split
// into chunks, each an absolutely positioned `<tspan x y>` whose x is the
// chunk's own centre (`text-anchor: middle` applies per chunk), with runs
// inside as `<tspan class/style dy>`. The accent is its own chunk, centred
// over its base (mode C's rule); the text after it is the next chunk. Labels
// mix BIZ UDPGothic, STIX Two Text Italic (variables), STIX Two Math (a Math
// base, ∇) and a subscript after the accented base.

const labelMetrics = parseFontMetrics(label);
const fontsE = {
  regular: { bytes: label, metrics: labelMetrics, family: "Label", engine: "'BIZ UDPGothic'" },
  italic: {
    bytes: textItalic,
    metrics: italicMetrics,
    family: "SumiItalic",
    engine: "'STIX Two Text';font-style:italic",
  },
  math: { bytes: math, metrics: mathMetrics, family: "SumiMath", engine: "'STIX Two Math'" },
} as const;
type FontKey = keyof typeof fontsE;
interface Run {
  text: string;
  font: FontKey;
  /** Accent over the run's (single) character. */
  accent?: number;
  sub?: boolean;
}
const SIZE_E = 40;
const LABELS_E: Run[][] = [
  [
    { text: "loss ", font: "regular" },
    { text: "θ", font: "italic", accent: 0x0302 },
    { text: "t", font: "italic", sub: true },
    { text: " = ", font: "regular" },
    { text: "y", font: "italic", accent: 0x0303 },
  ],
  [
    { text: "∇", font: "math", accent: 0x0302 },
    { text: "f", font: "italic" },
    { text: " ≤ ", font: "math" },
    { text: "W", font: "italic", accent: 0x20d7 },
  ],
  [
    { text: "予測 ", font: "regular" },
    { text: "y", font: "italic", accent: 0x0302 },
    { text: " と ", font: "regular" },
    { text: "x", font: "italic", accent: 0x0304 },
  ],
];

const widthOf = (r: Run) =>
  fontsE[r.font].metrics.measureEm(r.text) * SIZE_E * (r.sub === true ? 0.7 : 1);

function modeE(engineNames: boolean): string {
  const fam = (k: FontKey) => (engineNames ? fontsE[k].engine : `'${fontsE[k].family}'`);
  const texts: string[] = [];
  LABELS_E.forEach((runs, i) => {
    const total = runs.reduce((w, r) => w + widthOf(r), 0);
    const cx = 300;
    const y = 80 + i * 90;
    let x = cx - total / 2;
    // Chunks: text runs accumulate until an accented run closes a chunk; the
    // accent is a chunk of its own.
    const chunks: string[] = [];
    let open: { start: number; parts: string[]; width: number } | undefined;
    const flush = () => {
      if (open === undefined) return;
      chunks.push(
        `<tspan x="${(open.start + open.width / 2).toFixed(2)}" y="${y}">${open.parts.join("")}</tspan>`,
      );
      open = undefined;
    };
    for (const r of runs) {
      open ??= { start: x, parts: [], width: 0 };
      const w = widthOf(r);
      const style = `font-family:${fam(r.font)}${r.sub === true ? `;font-size:${SIZE_E * 0.7}px` : ""}`;
      const dy = r.sub === true ? SIZE_E * 0.21 : 0;
      open.parts.push(
        dy === 0
          ? `<tspan style="${style}">${r.text}</tspan>`
          : `<tspan style="${style}" dy="${dy}">${r.text}</tspan><tspan dy="${-dy}"></tspan>`,
      );
      open.width += w;
      if (r.accent !== undefined) {
        flush();
        const f = fontsE[r.font];
        const cov = parseGlyphCoverage(f.bytes);
        const box = glyphBox(f.bytes, cov.glyph(r.text.codePointAt(0) as number));
        const markFont: FontKey = r.font === "math" ? "math" : "italic";
        const mf = fontsE[markFont];
        const mbox = glyphBox(mf.bytes, parseGlyphCoverage(mf.bytes).glyph(r.accent));
        if (box !== undefined && mbox !== undefined) {
          const s = SIZE_E / f.metrics.unitsPerEm;
          const ms = SIZE_E / mf.metrics.unitsPerEm;
          const sl = r.font === "italic" ? slant : 0;
          const center =
            x +
            ((box.xMin + box.xMax) / 2) * s +
            sl * (box.yMax * s - ((box.yMin + box.yMax) / 2) * s);
          const ax = center - ((mbox.xMin + mbox.xMax) / 2) * ms;
          const base = y - box.yMax * s - SIZE_E * 0.04 + mbox.yMin * ms;
          // A zero-advance chunk: its anchor is its pen position.
          chunks.push(
            `<tspan x="${ax.toFixed(2)}" y="${base.toFixed(2)}" style="font-family:${fam(markFont)}">${String.fromCodePoint(r.accent)}</tspan>`,
          );
        }
      }
      x += w;
    }
    flush();
    texts.push(
      `<text x="${cx}" y="${y}" style="text-anchor:middle;font-kerning:none;font-family:${fam("regular")};font-size:${SIZE_E}px">${chunks.join("")}</text>`,
    );
  });
  const faces = engineNames
    ? ""
    : (Object.keys(fontsE) as FontKey[])
        .map((k) => face(fontsE[k].family, withoutTables(fontsE[k].bytes, ["GSUB", "GPOS"])))
        .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="330" viewBox="0 0 600 330"><style>${faces}</style><rect width="100%" height="100%" fill="white"/>${texts.join("")}</svg>`;
}

{
  // As the PDF export does since #112 (`resolveSvgFonts`): after the
  // unchanged files, a renamed copy of each font that maps the other runs'
  // characters to its space glyph, and the runs select the copies.
  const stripped = (b: Uint8Array) => withoutTables(b, ["GSUB", "GPOS"]);
  const chars = new Set<number>();
  for (const runs of LABELS_E) {
    for (const r of runs) {
      for (const c of r.text) chars.add(c.codePointAt(0) as number);
      if (r.accent !== undefined) chars.add(r.accent);
    }
  }
  const copies: Uint8Array[] = [];
  const copyFamily: Record<FontKey, string> = { regular: "", italic: "", math: "" };
  for (const k of Object.keys(fontsE) as FontKey[]) {
    const bytes = k === "regular" ? label : stripped(fontsE[k].bytes);
    const cov = parseGlyphCoverage(bytes);
    const blank = cov.glyph(0x20) || 1;
    const added = new Map([...chars].filter((cp) => !cov.has(cp)).map((cp) => [cp, blank]));
    copyFamily[k] = `Sumi Runs ${k}`;
    copies.push(withFamily(withCodePoints(bytes, added), copyFamily[k]));
  }
  let engineSvg = modeE(true);
  for (const k of Object.keys(fontsE) as FontKey[]) {
    engineSvg = engineSvg.replaceAll(
      `font-family:${fontsE[k].engine}`,
      `font-family:'${copyFamily[k]}'${k === "italic" ? ";font-style:italic" : ""}`,
    );
  }
  writeFileSync(join(OUT, "E.engine.svg"), engineSvg);
  const pdf = runEngine(engine, new TextEncoder().encode(engineSvg), [
    label,
    stripped(textItalic),
    stripped(math),
    ...copies,
  ]);
  if (!pdf.ok) throw new Error(`engine (E): ${pdf.message}`);
  const pdfPath = join(OUT, "E.pdf");
  writeFileSync(pdfPath, pdf.pdf);
  Bun.spawnSync(["pdftoppm", "-r", "72", "-png", "-singlefile", pdfPath, join(OUT, "E.engine")]);
  renders["E.engine"] = "out/accents/E.engine.png";
  const text = Bun.spawnSync(["pdftotext", "-raw", pdfPath, "-"]).stdout.toString().trim();
  renders["E.pdftotext"] = text.split("\n");
  renders["E.pdftotextCodePoints"] = text
    .split("\n")
    .map((l) =>
      [...l]
        .map((c) => `U+${(c.codePointAt(0) as number).toString(16).toUpperCase().padStart(4, "0")}`)
        .join(" "),
    );
  const browserSvg = modeE(false);
  const svgPath = join(OUT, "E.chrome.svg");
  writeFileSync(svgPath, browserSvg);
  if (existsSync(chrome)) {
    const shot = Bun.spawnSync([
      chrome,
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      `--screenshot=${join(OUT, "E.chrome.png")}`,
      "--window-size=600,330",
      `file://${svgPath}`,
    ]);
    renders["E.chrome"] = shot.exitCode === 0 ? "out/accents/E.chrome.png" : "chrome failed";
  }
}

const report = `${JSON.stringify({ slantFromItalicAngle: slant, xHeightUnits: xHeight, facts, renders }, null, 1)}\n`;
if (process.argv.includes("--record")) {
  const dir = join(import.meta.dir, "../results");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "accents.json"), report);
}
process.stdout.write(report);
