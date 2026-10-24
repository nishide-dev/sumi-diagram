/** #74 migration gate: browser SVG reference vs old/new PDF at 144 dpi.
 * Requires agent-browser, Poppler and ImageMagick 7; no production dependency.
 * Results, reference screenshots and both PDFs remain in .sumi/pdf-svg/.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DEFAULT_FONT_SET_ID, getFontSet } from "../src/core/theme/fonts";
import { PDF_WASM_SHA256, runEngine } from "../src/render/pdf/engine";
import { resolveSvgFonts } from "../src/render/pdf/fonts";
import { svgToPdf } from "../src/render/pdf/pdf";

const out = resolve(".sumi/pdf-svg");
if (Bun.argv.slice(2).some((arg) => arg !== "--record")) {
  throw new Error("Usage: bun scripts/check-pdf-svg.ts [--record]");
}
mkdirSync(out, { recursive: true });
function command(args: string[]): Buffer {
  const r = Bun.spawnSync(args);
  if (r.exitCode !== 0) throw new Error(`${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}
const hash = (bytes: Uint8Array) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const baselineBytes = command(["git", "show", "2073ccc:assets/wasm/sumi-svg2pdf.wasm"]);
if (hash(baselineBytes) !== "7a8ea73e55d113facda46ed261f6dd144d1fee341ab02d96bccd3bc128e7e71d")
  throw new Error("Wrong baseline");
const baseline = new WebAssembly.Module(new Uint8Array(baselineBytes));
const fontSet = getFontSet(DEFAULT_FONT_SET_ID);
if (!fontSet) throw new Error("Missing font set");
const paths = [
  ...new Bun.Glob("examples/*/*.svg").scanSync("."),
  ...new Bun.Glob("docs/gallery/components/*.svg").scanSync("."),
  "tests/fixtures/pdf/japanese-mask.svg",
].sort();
const browser = (...args: string[]) => command(["agent-browser", "--session", "sumi74", ...args]);
const rows = [];
function difference(a: Buffer, b: Buffer, width: number, height: number) {
  if (a.length !== width * height * 3 || b.length !== a.length)
    throw new Error("Unexpected raster size");
  let changed = 0;
  let filteredChanged = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const delta = [0, 0, 0];
      let count = 0;
      const i = (y * width + x) * 3;
      if ([0, 1, 2].some((c) => Math.abs((a[i + c] ?? 0) - (b[i + c] ?? 0)) > 64)) changed++;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const j = (ny * width + nx) * 3;
          for (let c = 0; c < 3; c++)
            delta[c] = (delta[c] ?? 0) + (a[j + c] ?? 0) - (b[j + c] ?? 0);
          count++;
        }
      if (delta.some((d) => Math.abs(d / count) > 64)) filteredChanged++;
    }
  return { raw: changed / (width * height), filtered: filteredChanged / (width * height) };
}
try {
  browser("open", "about:blank");
  const browserVersion = browser("eval", "navigator.userAgent").toString().trim();
  for (const [i, path] of paths.entries()) {
    const svg = readFileSync(path, "utf8");
    const w = Number(/<svg[^>]* width="([\d.]+)pt"/.exec(svg)?.[1]);
    const h = Number(/<svg[^>]* height="([\d.]+)pt"/.exec(svg)?.[1]);
    if (!(w > 0 && h > 0)) throw new Error(`Bad dimensions: ${path}`);
    const width = Math.ceil(w * 2);
    const height = Math.ceil(h * 2);
    const stem = `${out}/${i}-${basename(path, ".svg")}`;
    // Inline SVG preserves its embedded @font-face rules. A screenshot uses
    // CSS px; scaling to 2 px/pt matches Poppler's 144 dpi without print rounding.
    const fontCss =
      path === "tests/fixtures/pdf/japanese-mask.svg"
        ? [
            `@font-face{font-family:"BIZ UDPGothic";font-weight:400;src:url(data:font/ttf;base64,${readFileSync(fontSet.regular).toString("base64")})}`,
            `@font-face{font-family:"BIZ UDPGothic";font-weight:700;src:url(data:font/ttf;base64,${readFileSync(fontSet.bold).toString("base64")})}`,
          ].join("")
        : "";
    writeFileSync(
      `${stem}.html`,
      `<!doctype html><meta charset="utf-8"><style>${fontCss}html,body{margin:0;padding:0;background:white;overflow:hidden}body>svg{display:block;width:${w * 2}px;height:${h * 2}px}</style>${svg.replace(/^<\?xml[^>]*\?>/, "")}`,
    );
    browser("set", "viewport", String(width), String(height));
    browser("open", pathToFileURL(`${stem}.html`).href);
    browser("eval", "document.fonts.ready.then(() => document.fonts.status)");
    browser("screenshot", `${stem}-svg.png`);
    const resolved = resolveSvgFonts(svg, fontSet);
    if (!resolved.ok) throw new Error(JSON.stringify(resolved.diagnostics));
    const old = runEngine(
      baseline,
      new TextEncoder().encode(resolved.value.svg),
      resolved.value.fonts,
    );
    const current = svgToPdf(svg, { fontSet });
    if (!old.ok || !current.ok) throw new Error(`Conversion failed: ${path}`);
    const reference = command(["magick", `${stem}-svg.png`, "-depth", "8", "rgb:-"]);
    const metrics = [];
    for (const [engine, bytes] of [
      ["svg2pdf", old.pdf],
      ["krilla", current.value],
    ] as const) {
      writeFileSync(`${stem}-${engine}.pdf`, bytes);
      command([
        "pdftoppm",
        "-r",
        "144",
        "-singlefile",
        "-png",
        `${stem}-${engine}.pdf`,
        `${stem}-${engine}`,
      ]);
      const pixels = command(["magick", `${stem}-${engine}.png`, "-depth", "8", "rgb:-"]);
      metrics.push({
        engine,
        sha256: hash(bytes),
        ...difference(reference, pixels, width, height),
      });
    }
    rows.push({ path, width, height, metrics });
    console.log(`${path}: ${JSON.stringify(metrics)}`);
  }
  const report = {
    platform: process.platform,
    arch: process.arch,
    bun: Bun.version,
    browserVersion,
    poppler: Bun.spawnSync(["pdfinfo", "-v"]).stderr.toString().split("\n")[0],
    imageMagick: command(["magick", "-version"]).toString().split("\n")[0],
    wasmSha256: PDF_WASM_SHA256,
    dpi: 144,
    pixelThreshold: 64,
    filter: "3x3 box",
    maxFilteredFraction: 0.03,
    maxRegressionFraction: 0.005,
    rows,
  };
  writeFileSync(`${out}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
  // Bounding boxes and embedded/searchable text are independently tested.
  // This catches missing ink/fills while tolerating subpixel edge AA changes.
  for (const row of rows) {
    const [old, current] = row.metrics;
    if (!old || !current || current.filtered > 0.03 || current.filtered > old.filtered + 0.005)
      throw new Error(`Appearance regression: ${row.path}`);
  }
  if (Bun.argv.includes("--record")) {
    writeFileSync("docs/verification/74-pdf-svg.json", `${JSON.stringify(report, null, 2)}\n`);
  }
} finally {
  browser("close");
}
