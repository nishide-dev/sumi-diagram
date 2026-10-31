/** Throwaway investigation only. Run from the worktree root with Bun. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { importSvg } from "../../src/assets/svg-import";
import { lintGeometry } from "../../src/lint";
import { inspectSvg } from "../../src/render/inspect";
import { svgToPdf } from "../../src/render/pdf";
import { loadEngine, runEngine } from "../../src/render/pdf/engine";
import { inspectPdf } from "../../src/render/pdf/testing";
import { svgToEditablePptx, svgToPptx } from "../../src/render/pptx";
import { readPptx } from "../../src/render/pptx/testing";
import { renderFigure } from "../../src/render/render";

const base = dirname(fileURLToPath(import.meta.url));
const out = join(base, "out");
mkdirSync(out, { recursive: true });
mkdirSync(join(base, "previews"), { recursive: true });
const hash = (value: string | Uint8Array) =>
  new Bun.CryptoHasher("sha256").update(value).digest("hex");
const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="176" viewBox="0 0 320 176">${body}</svg>`;
function sanitize(input: string): string {
  const result = importSvg(input);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return svg(result.value.markup);
}
function picture(input: string, fonts: Uint8Array[] = []) {
  const result = runEngine(loadEngine(), new TextEncoder().encode(input), fonts, "picture");
  if (!result.ok) throw new Error(result.message);
  const n = new DataView(result.pdf.buffer).getUint32(0, true);
  return {
    png: result.pdf.subarray(4, n + 4),
    outlined: new TextDecoder().decode(result.pdf.subarray(n + 4)),
  };
}

// Explicit integer samples: a schematic envelope, not measured audio.
let seed = 272;
const samples = Array.from({ length: 72 }, (_, i) => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  const envelope = i < 12 || i > 60 ? 14 : 50;
  return 3 + (seed % envelope);
});
const wave = sanitize(
  svg(
    '<rect width="320" height="176" fill="#f4f1fb"/><line x1="16" y1="88" x2="304" y2="88" stroke="#beb2d0"/>' +
      samples
        .map(
          (v, i) =>
            `<line x1="${18 + i * 4}" y1="${88 - v}" x2="${18 + i * 4}" y2="${88 + v}" stroke="#7252a3" stroke-width="2"/>`,
        )
        .join(""),
  ),
);
writeFileSync(join(out, "waveform.svg"), wave);

// Manually classified syntax runs: no highlighter dependency or code execution.
const runs = [
  [
    { text: "def ", color: "#8b4bb0" },
    { text: "embed(text):", color: "#155778" },
  ],
  [{ text: "  tokens = encode(text)", color: "#155778" }],
  [
    { text: "  return ", color: "#8b4bb0" },
    { text: "pool(tokens)", color: "#217148" },
  ],
];
const codeSource = svg(
  '<rect width="320" height="176" rx="8" fill="#f7f7fa"/><rect width="320" height="28" rx="8" fill="#e2e2e8"/>' +
    ["#cf5360", "#d59b35", "#4f9a70"]
      .map((color, i) => `<circle cx="${15 + i * 16}" cy="14" r="4" fill="${color}"/>`)
      .join("") +
    runs
      .map((line, i) => {
        let x = 16;
        return line
          .map((run) => {
            const text = `<text x="${x}" y="${65 + i * 32}" font-family="BIZ UDGothic" font-size="18" fill="${run.color}" xml:space="preserve">${run.text}</text>`;
            x += run.text.length * 9;
            return text;
          })
          .join("");
      })
      .join(""),
);
const font = readFileSync(join(base, "../../assets/fonts/biz-ud-gothic/BIZUDGothic-Regular.ttf"));
const codeOutlined = picture(codeSource, [font]).outlined;
// usvg emits an empty defs; it has no visual effect. All remaining content must
// pass the real importer, including its rejection of nonempty defs/references.
const code = sanitize(codeOutlined.replace(/<defs\s*\/>|<defs>\s*<\/defs>/g, ""));
writeFileSync(join(out, "code-window.svg"), code);
writeFileSync(join(out, "code-window-text.svg"), codeSource);

const probes = {
  text: importSvg(codeSource),
  foreignObject: importSvg(
    svg(
      '<foreignObject width="320" height="176"><div xmlns="http://www.w3.org/1999/xhtml">HTML</div></foreignObject>',
    ),
  ),
  overflow: importSvg(svg('<rect x="500" width="30" height="30" fill="red"/>')),
};
// An engine can succeed while silently omitting HTML. Importer rejection is
// therefore part of the contract, rather than a renderer capability check.
const foreignOnly = svg(
  '<foreignObject width="320" height="176"><div xmlns="http://www.w3.org/1999/xhtml" style="width:320px;height:176px;background:red">HTML</div></foreignObject>',
);
const foreignPng = picture(foreignOnly, [font]).png;
const emptyPng = picture(svg(""), [font]).png;
const foreignPdf = runEngine(loadEngine(), new TextEncoder().encode(foreignOnly), [font]);
if (!foreignPdf.ok) throw new Error(foreignPdf.message);
writeFileSync(join(out, "foreign-object.pdf"), foreignPdf.pdf);
const source = readFileSync(join(base, "prototype.sumi.yaml"), "utf8");
const rendered = await renderFigure(source, { assetBase: base });
const again = await renderFigure(source, { assetBase: base });
if (!rendered.ok || !again.ok) throw new Error(JSON.stringify(rendered.diagnostics));
if (rendered.value.svg !== again.value.svg) throw new Error("Nondeterministic SVG");
const assets = [wave, code].map((s) => {
  const result = importSvg(s);
  if (!result.ok) throw new Error("Invalid generated asset");
  return result.value;
});
let index = 0;
// Simulate an inline writer at the same content slot (outside g.shape).
// No new public YAML syntax is claimed, and no generated file is hand-edited.
const inline = rendered.value.svg.replace(/<image\b[^>]*\/>/g, (tag) => {
  const asset = assets[index++];
  if (!asset) throw new Error("Unexpected image");
  const number = (name: string) => Number(new RegExp(`\\b${name}="([^"]+)"`).exec(tag)?.[1]);
  const [x, y, w, h] = ["x", "y", "width", "height"].map(number) as [
    number,
    number,
    number,
    number,
  ];
  return `<g transform="translate(${x} ${y}) scale(${w / 320} ${h / 176})">${asset.markup}</g>`;
});
if (index !== 2) throw new Error(`Expected two images, got ${index}`);
const results: Record<string, unknown> = {
  samples,
  probes,
  foreignObjectEngine: {
    pngEqualsEmpty: hash(foreignPng) === hash(emptyPng),
    pdfGlyphs: inspectPdf(foreignPdf.pdf).glyphs.length,
    pdfImages: inspectPdf(foreignPdf.pdf).images,
  },
  renderDiagnostics: rendered.diagnostics,
};
for (const [name, drawing] of [
  ["image", rendered.value.svg],
  ["inline", inline],
] as const) {
  const inspection = inspectSvg(drawing, rendered.value.compiled.ir);
  if (!inspection.ok) throw new Error(JSON.stringify(inspection.diagnostics));
  const geometry = lintGeometry({ ...rendered.value, inspection: inspection.value }, { source });
  const pdf = svgToPdf(drawing);
  const pdfAgain = svgToPdf(drawing);
  const pptx = svgToPptx(drawing);
  const pptxAgain = svgToPptx(drawing);
  if (!pdf.ok || !pdfAgain.ok || !pptx.ok || !pptxAgain.ok) throw new Error("Export failed");
  if (hash(pdf.value) !== hash(pdfAgain.value) || hash(pptx.value) !== hash(pptxAgain.value))
    throw new Error("Nondeterministic export");
  const editable = svgToEditablePptx(drawing, rendered.value.compiled.ir);
  writeFileSync(join(out, `${name}.svg`), drawing);
  writeFileSync(join(out, `${name}.pdf`), pdf.value);
  writeFileSync(join(out, `${name}.pptx`), pptx.value);
  const png = readPptx(pptx.value).get("ppt/media/figure.png");
  if (!png) throw new Error("No PPTX fallback");
  writeFileSync(join(base, `previews/${name}-svg.png`), png);
  const inspected = inspectPdf(pdf.value);
  results[name] = {
    geometry,
    svgSha256: hash(drawing),
    pdfSha256: hash(pdf.value),
    pptxSha256: hash(pptx.value),
    pdfImages: inspected.images,
    pdfText: inspected.glyphs.map((g) => g.text).join(""),
    pages: inspected.pages,
    editableDiagnostics: editable.diagnostics,
  };
}
writeFileSync(join(base, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
console.log("Generated sanitized assets, image/inline SVG, PDF, picture PPTX and results.json.");
