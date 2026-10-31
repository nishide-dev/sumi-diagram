/** Full repository compatibility audit: bun research/248-fill/verify-270.ts before|after. */
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { BUILTIN_THEMES } from "../../src/core/theme/builtin";
import { svgToPdf } from "../../src/render/pdf/pdf";
import { svgToPptx } from "../../src/render/pptx/pptx";
import { renderFigure } from "../../src/render/render";

const mode = process.argv[2];
if (mode !== "before" && mode !== "after") throw new Error("Expected before|after");
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const previous = mode === "after" ? await Bun.file(".sumi/270-before.json").json() : undefined;
const files: string[] =
  previous?.files ??
  (await Array.fromAsync(new Bun.Glob("**/*.sumi.yaml").scan({ dot: false })))
    .filter((p) => !p.startsWith("node_modules/"))
    .sort();
const records: Record<string, unknown> = {};
for (const [index, file] of files.entries()) {
  const source = await Bun.file(file).text();
  for (const theme of [undefined, ...BUILTIN_THEMES.keys()]) {
    const key = `${file}|${theme ?? "own"}`;
    const result = await renderFigure(source, {
      file,
      assetBase: dirname(file),
      ...(theme === undefined ? {} : { overrides: { theme } }),
    });
    if (!result.ok) {
      records[key] = {
        errors: result.diagnostics.filter((d) => d.severity === "error").map((d) => d.code),
      };
      continue;
    }
    const { svg, compiled } = result.value;
    if (theme !== undefined && compiled.ir.meta.themeId !== theme)
      throw new Error(`Theme override was not applied: ${key}`);
    const pdf = svgToPdf(svg);
    const pptx = svgToPptx(svg);
    records[key] = {
      svg: hash(svg),
      d2: compiled.engine === "auto" ? hash(compiled.d2Source) : null,
      pdf: pdf.ok ? hash(pdf.value) : pdf.diagnostics.map((d) => d.code),
      pptx: pptx.ok ? hash(pptx.value) : pptx.diagnostics.map((d) => d.code),
    };
  }
  console.log(`${index + 1}/${files.length} ${file}`);
}
await Bun.write(`.sumi/270-${mode}.json`, JSON.stringify({ files, records }, null, 2));
if (previous) {
  const changed = Object.keys(records).filter(
    (key) => JSON.stringify(records[key]) !== JSON.stringify(previous.records[key]),
  );
  console.log(
    JSON.stringify({ figures: files.length, cases: Object.keys(records).length, changed }, null, 2),
  );
  if (changed.some((key) => !key.startsWith("research/248-fill/c-h3world.sumi.yaml|")))
    throw new Error("Unexpected compatibility changes outside the redrawn H3-World figure");
}
