import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { BUILTIN_FONT_SETS } from "../../src/core/theme/fonts";
import { runEngine } from "../../src/render/pdf/engine";
import { resolveSvgFonts } from "../../src/render/pdf/fonts";
import wasmPath from "./wasm/target/wasm32-unknown-unknown/release/sumi_krilla_poc.wasm" with {
  type: "file",
};

const hash = (bytes: Uint8Array) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const bytes = readFileSync(wasmPath);
const candidate = new WebAssembly.Module(bytes);
if (WebAssembly.Module.imports(candidate).length !== 0) throw new Error("WASM has host imports");
const fontSet = [...BUILTIN_FONT_SETS.values()][0];
if (!fontSet) throw new Error("Missing font set");
const out = resolve("research/60-krilla/out");
mkdirSync(out, { recursive: true });
function command(...args: string[]): string {
  const result = Bun.spawnSync(args);
  if (result.exitCode !== 0) throw new Error(`${args.join(" ")}: ${result.stderr}`);
  return result.stdout.toString();
}
function convert(module: WebAssembly.Module, svg: string, fonts: Uint8Array[]): Uint8Array {
  const result = runEngine(module, new TextEncoder().encode(svg), fonts);
  if (!result.ok) throw new Error(result.message);
  return result.pdf;
}
// Also exercises the embedded WASM in a compiled executable with explicit input fonts.
if (process.argv[2] === "--smoke") {
  const svg = readFileSync(process.argv[3] ?? "", "utf8");
  const fonts = process.argv.slice(4).map((p) => readFileSync(p));
  console.log(hash(convert(candidate, svg, fonts)));
  process.exit(0);
}
// Preserve the evaluated baseline even after the production engine migrates.
const baseline = Bun.spawnSync(["git", "show", "2073ccc:assets/wasm/sumi-svg2pdf.wasm"]);
if (baseline.exitCode !== 0) throw new Error("Fetch git history through 2073ccc to reproduce #60");
if (hash(baseline.stdout) !== "7a8ea73e55d113facda46ed261f6dd144d1fee341ab02d96bccd3bc128e7e71d")
  throw new Error("Wrong #60 baseline");
const current = new WebAssembly.Module(new Uint8Array(baseline.stdout));
const paths = [
  ...new Bun.Glob("examples/*/*.svg").scanSync("."),
  ...new Bun.Glob("docs/gallery/components/*.svg").scanSync("."),
].sort();
const synthetic = `<svg xmlns="http://www.w3.org/2000/svg" width="240pt" height="120pt" viewBox="0 0 320 160"><defs><mask id="m"><rect width="320" height="160" fill="white"/><circle cx="160" cy="80" r="20" fill="black"/></mask></defs><path d="M0 0H320V160H0Z" fill="#eee" mask="url(#m)"/><text x="10" y="30" font-family="BIZ UDPGothic" font-size="18">日本語 ABC 123</text><text x="10" y="140" font-family="BIZ UDPGothic" font-weight="bold" font-size="18">決定性・埋め込み</text></svg>`;
writeFileSync(`${out}/synthetic.svg`, synthetic);
paths.push(`${out}/synthetic.svg`);
const rows = [];
for (const [index, path] of paths.entries()) {
  const source = readFileSync(path, "utf8");
  const resolved = resolveSvgFonts(source, fontSet);
  if (!resolved.ok) throw new Error(JSON.stringify(resolved.diagnostics));
  const { svg, fonts } = resolved.value;
  const stem = `${out}/${index}-${basename(path, ".svg")}`;
  const results = [];
  for (const [engine, module] of [
    ["current", current],
    ["krilla", candidate],
  ] as const) {
    const start = performance.now();
    const pdf = convert(module, svg, fonts);
    const milliseconds = performance.now() - start;
    if (engine === "krilla") {
      for (let n = 0; n < 4; n++) {
        if (hash(convert(module, svg, fonts)) !== hash(pdf)) throw new Error(`Unstable: ${path}`);
      }
    }
    const name = `${stem}-${engine}`;
    writeFileSync(`${name}.pdf`, pdf);
    const info = command("pdfinfo", `${name}.pdf`);
    const text = command("pdftotext", "-layout", `${name}.pdf`, "-").replace(/\s+/g, "").trim();
    const images = command("pdfimages", "-list", `${name}.pdf`).trim().split("\n").slice(2);
    const fontLines = command("pdffonts", `${name}.pdf`).trim().split("\n").slice(2);
    if (images.length !== 0) throw new Error(`Raster image: ${name}`);
    if (!fontLines.every((line) => /yes\s+yes\s+yes\s+\d+\s+\d+\s*$/.test(line))) {
      throw new Error(`Fonts not embedded/subset/Unicode: ${name}: ${fontLines}`);
    }
    if (/^(CreationDate|ModDate):/m.test(info)) throw new Error(`Timestamp: ${name}`);
    command("pdftoppm", "-r", "144", "-singlefile", "-png", `${name}.pdf`, name);
    results.push({
      engine,
      bytes: pdf.length,
      sha256: hash(pdf),
      milliseconds,
      page: /^Page size:\s*(.+)$/m.exec(info)?.[1],
      pages: /^Pages:\s*(.+)$/m.exec(info)?.[1],
      text,
      fonts: fontLines.length,
      boxes: [
        ...command("pdftotext", "-bbox-layout", `${name}.pdf`, "-").matchAll(
          /<word xMin="([^"]+)" yMin="([^"]+)" xMax="([^"]+)" yMax="([^"]+)">([^<]*)<\/word>/g,
        ),
      ].map((m) => ({ text: m[5], coordinates: m.slice(1, 5).map(Number) })),
    });
  }
  const [a, b] = results;
  if (!a || !b || a.page !== b.page || a.pages !== "1" || b.pages !== "1" || a.text !== b.text) {
    throw new Error(`Mismatch ${path}: ${JSON.stringify(results)}`);
  }
  let maxTextDeltaPt = 0;
  if (a.boxes.length !== b.boxes.length) throw new Error(`Word count mismatch: ${path}`);
  for (let i = 0; i < a.boxes.length; i++) {
    const aa = a.boxes[i];
    const bb = b.boxes[i];
    if (!aa || !bb || aa.text !== bb.text) throw new Error(`Word mismatch: ${path}`);
    for (let j = 0; j < 4; j++)
      maxTextDeltaPt = Math.max(
        maxTextDeltaPt,
        Math.abs((aa.coordinates[j] ?? 0) - (bb.coordinates[j] ?? 0)),
      );
  }
  if (maxTextDeltaPt > 0.01) throw new Error(`Text position mismatch: ${path}: ${maxTextDeltaPt}`);
  const pixels = ["current", "krilla"].map((engine) => {
    const result = Bun.spawnSync(["magick", `${stem}-${engine}.png`, "-depth", "8", "rgb:-"]);
    if (result.exitCode !== 0) throw new Error(result.stderr.toString());
    return result.stdout;
  });
  const [pa, pb] = pixels;
  if (!pa || !pb || pa.length !== pb.length) throw new Error(`Raster size mismatch: ${path}`);
  let squared = 0;
  let changed = 0;
  for (let i = 0; i < pa.length; i += 3) {
    let max = 0;
    for (let c = 0; c < 3; c++) {
      const delta = Math.abs((pa[i + c] ?? 0) - (pb[i + c] ?? 0));
      squared += delta * delta;
      max = Math.max(max, delta);
    }
    if (max > 255 * 0.25) changed++;
  }
  rows.push({
    path: path.startsWith(out) ? "synthetic.svg" : path,
    results,
    maxTextDeltaPt,
    rasterRmse: Math.sqrt(squared / pa.length) / 255,
    changedPixelFraction: changed / (pa.length / 3),
  });
}
const report = {
  environment: {
    platform: process.platform,
    arch: process.arch,
    bun: Bun.version,
    poppler: (() => {
      const result = Bun.spawnSync(["pdfinfo", "-v"]);
      if (result.exitCode !== 0) throw new Error(result.stderr.toString());
      return result.stderr.toString().trim().split("\n")[0];
    })(),
    imageMagick: command("magick", "-version").trim().split("\n")[0],
  },
  wasm: {
    bytes: bytes.length,
    sha256: hash(bytes),
    imports: WebAssembly.Module.imports(candidate),
    currentBytes: baseline.stdout.length,
  },
  rows,
};
writeFileSync(`${out}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
if (process.argv.includes("--record")) {
  const recorded = {
    ...report,
    rows: rows.map((row) => ({
      ...row,
      results: row.results.map(
        ({ boxes: _boxes, milliseconds: _milliseconds, text: _text, ...result }) => result,
      ),
    })),
  };
  writeFileSync(resolve(import.meta.dir, "results.json"), `${JSON.stringify(recorded, null, 2)}\n`);
  writeFileSync(resolve(import.meta.dir, "dependencies.json"), readFileSync(`${out}/build.json`));
}
console.log(JSON.stringify({ cases: rows.length, wasm: report.wasm }));
