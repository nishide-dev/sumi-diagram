/**
 * #19 research: renders the PoC inputs with the normal Sumi pipeline
 * (`renderFigure()`), and writes for each figure
 *   out/svg/<id>.svg              the finalized SVG (byte-identical to `sumi render`)
 *   out/svg/<id>.inspection.json  `inspectSvg()` result (bboxes, labels, edge paths)
 *   out/svg/<id>.resolved.svg     the same SVG with D2's per-diagram font
 *                                 families rewritten to the real font names
 *                                 (see `resolveFontFamilies`), for converters
 *                                 that do not read `@font-face` data URLs
 *
 *   bun research/19-pdf-pptx/scripts/render-inputs.ts
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { renderFigure } from "../../../src/render";
import { INPUTS } from "./lib/inputs";
import { resolveFontFamilies } from "./lib/svg-fonts";

const ROOT = join(import.meta.dir, "..", "..", "..");
const OUT = join(import.meta.dir, "..", "out", "svg");

mkdirSync(OUT, { recursive: true });
for (const input of INPUTS) {
  const file = join(ROOT, input);
  const result = await renderFigure(readFileSync(file, "utf8"), { file: input });
  if (!result.ok) {
    console.error(input, JSON.stringify(result.diagnostics, null, 2));
    process.exit(1);
  }
  const id = basename(input, ".sumi.yaml");
  const { svg, inspection } = result.value;
  writeFileSync(join(OUT, `${id}.svg`), svg);
  writeFileSync(join(OUT, `${id}.resolved.svg`), resolveFontFamilies(svg));
  writeFileSync(join(OUT, `${id}.inspection.json`), `${JSON.stringify(inspection, null, 2)}\n`);
  console.log(
    `${id}: ${inspection.canvas.width.pt}pt x ${inspection.canvas.height.pt}pt, ${inspection.elements.length} elements`,
  );
}
