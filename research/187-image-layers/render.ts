import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { lintGeometry } from "../../src/lint";
import { svgToPdf } from "../../src/render/pdf";
import { inspectPdf } from "../../src/render/pdf/testing";
import { svgToEditablePptx, svgToPptx } from "../../src/render/pptx";
import { readPptx } from "../../src/render/pptx/testing";
import { renderFigure } from "../../src/render/render";

const base = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(base, "h3-world-frames.sumi.yaml"), "utf8");
const result = await renderFigure(source, { assetBase: base });
if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
const diagnostics = [...result.diagnostics, ...lintGeometry(result.value, { source })];
if (diagnostics.length) throw new Error(JSON.stringify(diagnostics));
const { svg, compiled } = result.value;
const pdf = svgToPdf(svg);
// Rasterize a smaller diagram preview; source image bytes remain unchanged.
const previewSvg = svg.replace(
  /\b(width|height)="([\d.]+)pt"/g,
  (_, side, value) => `${side}="${Number(value) * 0.75}pt"`,
);
const pptx = svgToPptx(previewSvg);
if (!pdf.ok || !pptx.ok) throw new Error("Export failed");
const png = readPptx(pptx.value).get("ppt/media/figure.png");
if (!png || png.length >= 150_000) throw new Error(`Preview too large: ${png?.length}`);
const out = join(base, "out");
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "h3-world-frames.svg"), svg);
writeFileSync(join(out, "h3-world-frames.pdf"), pdf.value);
writeFileSync(join(out, "h3-world-frames.png"), png);
console.log(
  JSON.stringify(
    {
      diagnostics,
      previewBytes: png.length,
      pdfImageXObjects: inspectPdf(pdf.value).images,
      svgImageDefinitions: (svg.match(/data:image\/jpeg;base64,/g) ?? []).length,
      footprints: compiled.ir.nodes
        .filter((n) => n.image !== undefined)
        .map((n) => ({
          id: n.id,
          widthPt: n.width?.pt,
          heightPt: n.height?.pt,
          copies: n.image?.layers?.count ?? 1,
        })),
      editableDiagnostics: svgToEditablePptx(svg, compiled.ir).diagnostics.map((d) => d.code),
    },
    null,
    2,
  ),
);
