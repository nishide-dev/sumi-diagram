/**
 * Pipeline experiment: HTML subset -> (Takumi|Satori) SVG -> usvg normalization (Sumi's own PDF
 * engine) -> unchanged importSvg() -> existing `image` component -> SVG / PDF / picture PPTX.
 * Run from this folder: bun figure.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { importSvg } from "../../src/assets/svg-import";
import { lintGeometry } from "../../src/lint";
import { inspectSvg } from "../../src/render/inspect";
import { svgToPdf } from "../../src/render/pdf";
import { loadEngine, runEngine } from "../../src/render/pdf/engine";
import { inspectPdf } from "../../src/render/pdf/testing";
import { svgToEditablePptx, svgToPptx } from "../../src/render/pptx";
import { readPptx } from "../../src/render/pptx/testing";
import { renderFigure } from "../../src/render/render";
import { base, fontFiles, satoriSvg, sourceHtml, takumi } from "./gen";
import { usvg } from "./probe-lib";

const out = join(base, "out");
mkdirSync(join(out, "assets"), { recursive: true });
mkdirSync(join(base, "previews"), { recursive: true });
const sha = (v: string | Uint8Array) => new Bun.CryptoHasher("sha256").update(v).digest("hex");
const fonts = [fontFiles.mono, fontFiles.inter, fontFiles.interBold];
const pieces = ["code-window", "text-card", "film-strip", "token-strip", "waveform-bars"];
const results: Record<string, unknown> = {};

for (const lib of ["takumi", "satori"] as const) {
  const used: string[] = [];
  const skipped: Record<string, string> = {};
  for (const p of pieces) {
    const raw =
      lib === "takumi"
        ? await takumi(sourceHtml("html-safe", p))
        : await satoriSvg(sourceHtml("html-safe", p));
    const norm = usvg(raw);
    const r = importSvg(norm);
    if (r.ok) {
      writeFileSync(join(out, "assets", `${lib}-${p}.svg`), norm);
      used.push(p);
    } else skipped[p] = `${r.issues.length} importer issues, first: ${r.issues[0]?.message}`;
  }
  const item = (p: string) =>
    `{ component: image, id: ${p.replace("-bars", "")}, variant: framed, props: { src: assets/${lib}-${p}.svg, width: 150pt, height: 82.5pt } }`;
  const ids = used.map((p) => p.replace("-bars", ""));
  const yaml = `# Throwaway #277 probe (${lib}); synthetic content.
version: 1
figure:
  id: html-subset-${lib}
  theme: paper
  profile: paper-double
  layout:
    arrange:
      stack:
        gap: 10mm
        items:
          - row: { gap: 8mm, items: [ ${ids.slice(0, 3).join(", ")} ] }
          - row: { gap: 8mm, items: [ ${ids.slice(3).join(", ")}${ids.length > 3 ? ", " : ""}model ] }
nodes:
${used.map((p) => `  - id: ${p.replace("-bars", "")}\n    component: image\n    variant: framed\n    props: { src: assets/${lib}-${p}.svg, width: 150pt, height: 82.5pt }`).join("\n")}
  - id: model
    component: box
    label: Sumi components stay native
    tone: purple
edges:
${ids.map((i) => `  - { from: ${i}, to: model }`).join("\n")}
`;
  void item;
  writeFileSync(join(out, `${lib}.sumi.yaml`), yaml);
  const t0 = performance.now();
  const rendered = await renderFigure(yaml, { assetBase: out });
  const ms = performance.now() - t0;
  if (!rendered.ok) {
    results[lib] = { used, skipped, renderFailed: rendered.diagnostics.slice(0, 3) };
    console.log(lib, "render failed", JSON.stringify(rendered.diagnostics.slice(0, 3)));
    continue;
  }
  const again = await renderFigure(yaml, { assetBase: out });
  const svg = rendered.value.svg;
  const insp = inspectSvg(svg, rendered.value.compiled.ir);
  const geometry = insp.ok
    ? lintGeometry({ ...rendered.value, inspection: insp.value }, { source: yaml })
    : insp.diagnostics;
  const pdf = svgToPdf(svg);
  const pptx = svgToPptx(svg);
  const editable = svgToEditablePptx(svg, rendered.value.compiled.ir);
  if (!pdf.ok || !pptx.ok) throw new Error("export failed");
  writeFileSync(join(out, `${lib}.svg`), svg);
  writeFileSync(join(out, `${lib}.pdf`), pdf.value);
  writeFileSync(join(out, `${lib}.pptx`), pptx.value);
  const png = readPptx(pptx.value).get("ppt/media/figure.png");
  if (png) writeFileSync(join(out, `${lib}-pptx-fallback.png`), png);
  const ins = inspectPdf(pdf.value);
  results[lib] = {
    used,
    skipped,
    renderMs: Math.round(ms),
    svgBytes: svg.length,
    svgDeterministicTwice: again.ok && again.value.svg === svg,
    svgSha256: sha(svg),
    pdfBytes: pdf.value.length,
    pdfSha256: sha(pdf.value),
    pdfPages: ins.pages,
    pdfImages: ins.images,
    pdfText: ins.glyphs.map((g) => g.text).join(""),
    pptxBytes: pptx.value.length,
    pptxFallbackPngBytes: png?.length,
    renderDiagnostics: rendered.diagnostics,
    geometry,
    editableDiagnostics: (editable as { diagnostics?: unknown }).diagnostics,
  };
  console.log(
    lib,
    used.length,
    "pieces",
    Object.keys(skipped),
    "svg",
    svg.length,
    "pdf",
    pdf.value.length,
  );
}

// Raw (unrestricted) outputs: nested into one sheet to exercise the PDF engine directly.
const prefix = (svg: string, n: number) => {
  const idsFound = [...svg.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]!);
  let s = svg;
  for (const id of idsFound) {
    s = s
      .replaceAll(`id="${id}"`, `id="p${n}-${id}"`)
      .replaceAll(`url(#${id})`, `url(#p${n}-${id})`)
      .replaceAll(`href="#${id}"`, `href="#p${n}-${id}"`);
  }
  return s;
};
const rawPieces = ["code-window", "text-card", "film-strip", "token-strip", "waveform"];
const sheets: Record<string, unknown> = {};
for (const [name, gen] of [
  ["takumi", (s: string) => takumi(s)],
  ["satori-paths", (s: string) => satoriSvg(s, true)],
  ["satori-text", (s: string) => satoriSvg(s, false)],
] as const) {
  let body = "";
  for (let i = 0; i < rawPieces.length; i++) {
    const svg = prefix(await gen(sourceHtml("html", rawPieces[i]!)), i);
    const inner = svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
    body += `<svg x="${16 + (i % 3) * 336}" y="${16 + Math.floor(i / 3) * 192}" width="320" height="176" viewBox="0 0 320 176">${inner}</svg>`;
  }
  const sheet = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1024" height="400" viewBox="0 0 1024 400"><rect width="1024" height="400" fill="#ffffff"/>${body}</svg>`;
  writeFileSync(join(out, `sheet-${name}.svg`), sheet);
  const t0 = performance.now();
  const r = runEngine(loadEngine(), new TextEncoder().encode(sheet), fonts);
  const ms = performance.now() - t0;
  if (!r.ok) {
    sheets[name] = { failed: r.message };
    continue;
  }
  writeFileSync(join(out, `sheet-${name}.pdf`), r.pdf);
  const ins = inspectPdf(r.pdf);
  sheets[name] = {
    svgBytes: sheet.length,
    pdfBytes: r.pdf.length,
    pdfMs: Math.round(ms),
    pdfImages: ins.images,
    pdfText: ins.glyphs.map((g) => g.text).join(""),
    hasTextElement: /<text[\s>]/.test(sheet),
    importerOk: importSvg(sheet).ok,
  };
}
results.rawSheets = sheets;
writeFileSync(join(out, "figure-results.json"), `${JSON.stringify(results, null, 2)}\n`);
