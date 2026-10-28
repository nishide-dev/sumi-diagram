/** #62 native compatibility corpus, plus minimal Mac connector controls. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { svgToEditablePptx } from "../src/render/pptx/editable";
import { editablePptx } from "../src/render/pptx/package";
import { renderFigure } from "../src/render/render";
import { editableCorpus } from "./pptx-validator/editable-corpus";

const args = Bun.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--out"))
  throw new Error("Usage: bun scripts/check-pptx-editable.ts [--out directory]");
const out = resolve(args[1] ?? ".sumi/pptx-editable");
mkdirSync(out, { recursive: true });
const report = [];
for (const item of editableCorpus())
  for (const connectors of ["freeform", "glued"] as const) {
    const result = svgToEditablePptx(item.svg, item.ir, { connectors });
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const name = `${item.id.replaceAll("/", "_")}.${connectors}.pptx`;
    writeFileSync(resolve(out, name), result.value);
    report.push({
      source: item.id,
      connectors,
      file: name,
      sha256: new Bun.CryptoHasher("sha256").update(result.value).digest("hex"),
      warnings: result.diagnostics.map((d) => d.code),
    });
  }
// Structured figures (no D2 needed). #183: a figure shrunk by
// `figure.fit: scale`, where every length, line width and text size is
// scaled. #184: sublabels, a second run of smaller paragraphs with space
// before them in a node's text.
for (const fixture of ["fit", "sublabel"]) {
  const dir = resolve(import.meta.dir, "../tests/fixtures/figures", fixture);
  const rendered = await renderFigure(readFileSync(resolve(dir, "b-dit.sumi.yaml"), "utf8"), {
    assetBase: dir,
  });
  if (!rendered.ok) throw new Error(JSON.stringify(rendered.diagnostics));
  if (fixture === "fit" && rendered.value.inspection.scale === undefined)
    throw new Error("fit fixture is not scaled");
  for (const connectors of ["freeform", "glued"] as const) {
    const result = svgToEditablePptx(rendered.value.svg, rendered.value.compiled.ir, {
      connectors,
    });
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const name = `${fixture}_b-dit.${connectors}.pptx`;
    writeFileSync(resolve(out, name), result.value);
    report.push({
      source: `tests/fixtures/figures/${fixture}/b-dit`,
      connectors,
      file: name,
      sha256: new Bun.CryptoHasher("sha256").update(result.value).digest("hex"),
      warnings: result.diagnostics.map((d) => d.code),
    });
  }
}
const xfrm = '<a:xfrm><a:off x="914400" y="457200"/><a:ext cx="914400" cy="1828800"/></a:xfrm>';
const free =
  '<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst><a:path w="914400" h="1828800" fill="none"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="0" y="914400"/></a:lnTo><a:lnTo><a:pt x="914400" y="914400"/></a:lnTo><a:lnTo><a:pt x="914400" y="1828800"/></a:lnTo></a:path></a:pathLst></a:custGeom>';
const line =
  '<a:ln w="12700"><a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:tailEnd type="triangle"/></a:ln>';
const connector = (geom: string) =>
  `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="2" name="edge"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr>${xfrm}${geom}${line}</p:spPr></p:cxnSp>`;
for (const [name, shapes] of Object.entries({
  "cxn-custom": connector(free),
  "cxn-line": connector('<a:prstGeom prst="line"><a:avLst/></a:prstGeom>'),
  "shape-custom": `<p:sp><p:nvSpPr><p:cNvPr id="2" name="edge"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm}${free}${line}</p:spPr></p:sp>`,
}))
  writeFileSync(
    resolve(out, `control.${name}.pptx`),
    editablePptx(shapes, 288, 216, undefined, "control"),
  );
writeFileSync(resolve(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
// Arrow-end calibration at .5/1/2pt line widths: independent sm/med/lg samples.
let calibrationId = 2;
const calibration = [0.5, 1, 2]
  .flatMap((width, row) =>
    ["sm", "med", "lg"].map(
      (size, col) =>
        `<p:sp><p:nvSpPr><p:cNvPr id="${calibrationId++}" name="w${width}-${size}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${12700 * (15 + col * 90)}" y="${12700 * (25 + row * 55)}"/><a:ext cx="889000" cy="1"/></a:xfrm><a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:ln w="${12700 * width}"><a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:tailEnd type="triangle" w="${size}" len="${size}"/></a:ln></p:spPr></p:sp>`,
    ),
  )
  .join("");
writeFileSync(
  resolve(out, "control.arrow-sizes.pptx"),
  editablePptx(calibration, 288, 180, undefined, "control"),
);
console.log(
  `Generated ${report.length} experimental editable PPTX (2 of them scaled by figure.fit, 2 with sublabels) plus 4 controls in ${out}`,
);
