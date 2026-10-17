/**
 * #19 research: converts the rendered SVGs (run render-inputs.ts first) to PDF
 * with every available tool, twice each, and records for each PDF
 *   - determinism (sha256 of two runs, plus a run with SOURCE_DATE_EPOCH=0)
 *   - page size vs the SVG's pt size (pdfinfo)
 *   - fonts: embedded? subset? type (pdffonts)
 *   - text positions: each label line found by `pdftotext -bbox-layout`
 *     vs the line box Sumi's geometry lint measures from the SVG
 *   - pixel difference vs Chrome's rendering of the original SVG (both 144 dpi)
 * and writes out/pdf/report.json + out/pdf/report.md.
 *
 *   bun research/19-pdf-pptx/scripts/pdf.ts
 *
 * Tools (skipped when missing): svg2pdf PoC (native + WASM, bundled TTFs
 * only), svg2pdf-cli 0.13 (system fonts), rsvg-convert, Inkscape, headless
 * Chrome. External binaries: poppler (pdfinfo, pdffonts, pdftotext, pdftoppm),
 * ImageMagick (magick). See the README for how they were installed.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { BUILTIN_FONT_SETS, DEFAULT_FONT_SET_ID } from "../../../src/core/theme/fonts";
import {
  DPI,
  pdfInfo,
  pixelDiff,
  rasterize,
  readInspection,
  run,
  textPositions,
} from "./lib/pdf-checks";
import { loadSvg2Pdf } from "./lib/svg2pdf-wasm";

const HERE = resolve(import.meta.dir, "..");
const ROOT = resolve(HERE, "..", "..");
const SVG_DIR = join(HERE, "out", "svg");
const OUT = join(HERE, "out", "pdf");
const TOOLS = join(HERE, ".tools");
const FIGURES = ["system-architecture", "decision-flow", "ja-review"];
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const fontSet = BUILTIN_FONT_SETS.get(DEFAULT_FONT_SET_ID);
if (fontSet === undefined) throw new Error("font set");
const fontFiles = [fontSet.regular, fontSet.bold, fontSet.mono ?? fontSet.regular];
const fontDir = join(ROOT, "assets", "fonts", "biz-ud-gothic");

// fontconfig that sees only the bundled fonts (rsvg-convert, Inkscape).
mkdirSync(TOOLS, { recursive: true });
const fontsConf = join(TOOLS, "fonts.conf");
writeFileSync(
  fontsConf,
  `<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "fonts.dtd">\n<fontconfig>\n  <dir>${fontDir}</dir>\n  <cachedir>${join(TOOLS, "fc-cache")}</cachedir>\n</fontconfig>\n`,
);
const isolatedFonts = { FONTCONFIG_FILE: fontsConf };

const has = (bin: string) => existsSync(bin) || run(["which", bin]).ok;
const sha = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

function chromeWrapper(
  id: string,
  svg: string,
  widthPt: number,
  heightPt: number,
  mode: "print" | "shot",
) {
  const body = svg.replace(/^<\?xml[^>]*\?>/, "");
  const style =
    mode === "print"
      ? `@page{size:${widthPt}pt ${heightPt}pt;margin:0}html,body{margin:0;padding:0;overflow:hidden}svg{display:block}`
      : `html,body{margin:0;padding:0;overflow:hidden}svg{display:block;width:${(widthPt * DPI) / 72}px;height:${(heightPt * DPI) / 72}px}`;
  const file = join(OUT, `${id}.chrome-${mode}.html`);
  writeFileSync(
    file,
    `<!doctype html><html><head><meta charset="utf-8"><style>${style}</style></head><body>${body}</body></html>`,
  );
  return file;
}

const chromeArgs = [
  "--headless",
  "--disable-gpu",
  "--hide-scrollbars",
  `--user-data-dir=${join(TOOLS, "chrome-profile")}`,
];

type Converter = {
  name: string;
  available: boolean;
  /** Converts figure `id` to `out`; `env` is added for the determinism run. */
  convert(
    id: string,
    out: string,
    env?: Record<string, string>,
  ): Promise<{ ok: boolean; out: string }>;
};

const wasmPath = join(TOOLS, "sumi_svg2pdf_poc.wasm");
const wasmConvert = existsSync(wasmPath)
  ? await loadSvg2Pdf(
      wasmPath,
      fontFiles.map((f) => readFileSync(f)),
    )
  : undefined;
const nativePoc = join(TOOLS, "bin", "sumi-svg2pdf");
const svg2pdfCli = join(TOOLS, "bin", "svg2pdf");
const resolved = (id: string) => join(SVG_DIR, `${id}.resolved.svg`);
const original = (id: string) => join(SVG_DIR, `${id}.svg`);

const converters: Converter[] = [
  {
    name: "svg2pdf-poc (native, bundled TTF)",
    available: existsSync(nativePoc),
    convert: async (id, out, env) => run([nativePoc, resolved(id), out, ...fontFiles], env),
  },
  {
    name: "svg2pdf-poc (WASM in Bun, bundled TTF)",
    available: wasmConvert !== undefined,
    convert: async (id, out) => {
      writeFileSync(out, wasmConvert?.(readFileSync(resolved(id))) ?? new Uint8Array());
      return { ok: true, out: "" };
    },
  },
  {
    name: "svg2pdf-cli 0.13 (system fonts, original SVG)",
    available: existsSync(svg2pdfCli),
    convert: async (id, out, env) => run([svg2pdfCli, original(id), out], env),
  },
  {
    name: "rsvg-convert (fontconfig: bundled TTF)",
    available: has("rsvg-convert"),
    convert: async (id, out, env) =>
      run(["rsvg-convert", "-f", "pdf", "-o", out, resolved(id)], { ...isolatedFonts, ...env }),
  },
  {
    name: "Inkscape (fontconfig: bundled TTF)",
    available: has("inkscape"),
    convert: async (id, out, env) =>
      run(["inkscape", resolved(id), "--export-type=pdf", `--export-filename=${out}`], {
        ...isolatedFonts,
        ...env,
      }),
  },
  {
    name: "Chrome headless (original SVG, @font-face)",
    available: existsSync(CHROME),
    convert: async (id, out, env) => {
      const inspection = readInspection(id);
      const html = chromeWrapper(
        id,
        readFileSync(original(id), "utf8"),
        inspection.canvas.width.pt,
        inspection.canvas.height.pt,
        "print",
      );
      return run(
        [
          CHROME,
          ...chromeArgs,
          "--no-pdf-header-footer",
          `--print-to-pdf=${out}`,
          `file://${html}`,
        ],
        env,
      );
    },
  },
];

function referencePng(id: string): string {
  const png = join(OUT, `${id}.reference.png`);
  const inspection = readInspection(id);
  const w = Math.ceil((inspection.canvas.width.pt * DPI) / 72);
  const h = Math.ceil((inspection.canvas.height.pt * DPI) / 72);
  const html = chromeWrapper(
    id,
    readFileSync(original(id), "utf8"),
    inspection.canvas.width.pt,
    inspection.canvas.height.pt,
    "shot",
  );
  run([CHROME, ...chromeArgs, `--window-size=${w},${h}`, `--screenshot=${png}`, `file://${html}`]);
  return png;
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const report: Record<string, unknown>[] = [];
for (const id of FIGURES) {
  const inspection = readInspection(id);
  const ref = existsSync(CHROME) ? referencePng(id) : undefined;
  for (const [index, conv] of converters.entries()) {
    if (!conv.available) continue;
    const base = join(OUT, `${id}.${index}`);
    // Runs are >1s apart so a second-resolution timestamp shows up as a difference.
    const a = await conv.convert(id, `${base}.pdf`);
    Bun.sleepSync(1100);
    await conv.convert(id, `${base}.run2.pdf`);
    const c = await conv.convert(id, `${base}.sde.pdf`, { SOURCE_DATE_EPOCH: "0" });
    Bun.sleepSync(1100);
    const d = await conv.convert(id, `${base}.sde2.pdf`, { SOURCE_DATE_EPOCH: "0" });
    if (!a.ok || !existsSync(`${base}.pdf`)) {
      report.push({ figure: id, tool: conv.name, ok: false, error: a.out.slice(0, 500) });
      continue;
    }
    const info = pdfInfo(`${base}.pdf`);
    rasterize(`${base}.pdf`, `${base}.png`);
    const result = {
      figure: id,
      tool: conv.name,
      ok: true,
      bytes: readFileSync(`${base}.pdf`).length,
      deterministic: sha(`${base}.pdf`) === sha(`${base}.run2.pdf`),
      deterministicWithSourceDateEpoch:
        c.ok && d.ok ? sha(`${base}.sde.pdf`) === sha(`${base}.sde2.pdf`) : null,
      expectedPagePt: [inspection.canvas.width.pt, inspection.canvas.height.pt],
      ...info,
      text: textPositions(id, `${base}.pdf`),
      pixelDiffPercent:
        ref === undefined ? null : pixelDiff(ref, `${base}.png`, `${base}.diff.png`),
    };
    report.push(result);
    console.log(
      `${id} | ${conv.name} | ${result.bytes}B | det=${result.deterministic}/${result.deterministicWithSourceDateEpoch} | ${info.widthPt}x${info.heightPt} | text ${result.text.matched}/${result.text.expected} dx=${result.text.maxDxPt} dw=${result.text.maxDwidthPt} | diff=${result.pixelDiffPercent}%`,
    );
  }
}
writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
