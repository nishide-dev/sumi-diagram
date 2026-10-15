/**
 * Renders a `*.sumi.yaml` figure to SVG with the pinned D2 CLI — a stopgap
 * until `sumi render` (#14) exists.
 *
 *   bun run example:render <figure.sumi.yaml> [out.svg]
 *
 * The output defaults to the input path with `.sumi.yaml` replaced by `.svg`.
 * Diagnostics go to stderr; any error exits with status 1.
 *
 * The SVG is D2's output with one addition: the root `<svg>` gets
 * `width`/`height` in pt from its viewBox (1 D2 unit = 0.5pt, design doc §5.1),
 * so viewers show the figure at its physical size. This stands in for the SVG
 * post-processing of #11 and does nothing else (no geometry lint yet); the
 * output width is printed and compared with the profile's `page.maxWidth`.
 */

import { basename } from "node:path";
import { createD2CliBackend } from "../src/backends";
import { compileFigure } from "../src/compiler";
import type { Diagnostic } from "../src/core/diagnostics";
import { getProfile } from "../src/core/profile/builtin";
import { d2UnitsToPt, formatMm } from "../src/core/units";

const [input, output = input?.replace(/(\.sumi)?\.ya?ml$/, ".svg")] = process.argv.slice(2);
if (!input || !output || output === input) {
  console.error("Usage: bun run example:render <figure.sumi.yaml> [out.svg]");
  process.exit(2);
}

function report(diagnostics: readonly Diagnostic[]): void {
  for (const d of diagnostics) {
    const at = d.location ? `${input}:${d.location.line}:${d.location.column}: ` : `${input}: `;
    console.error(`${at}${d.severity} ${d.code}: ${d.message}${d.hint ? ` (${d.hint})` : ""}`);
  }
}

const compiled = compileFigure(await Bun.file(input).text(), { file: input });
report(compiled.diagnostics);
if (!compiled.ok) process.exit(1);

const { d2Source, layout, fontSet, ir } = compiled.value;
const rendered = await createD2CliBackend().render({
  d2Source,
  layout,
  fontSet,
  sourceName: `${basename(input)}.d2`,
});
report(rendered.diagnostics);
if (!rendered.ok) process.exit(1);

// D2's root element: `<svg ... viewBox="0 0 W H">` before the nested `svg.d2-svg`.
const root = /^(<\?xml[^>]*>\s*)?<svg\b[^>]*?viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/;
const match = root.exec(rendered.value.svg);
if (!match) {
  console.error("Unexpected SVG: no viewBox on the root <svg>.");
  process.exit(1);
}
const widthPt = d2UnitsToPt(Number(match[2]));
const heightPt = d2UnitsToPt(Number(match[3]));
const svg = rendered.value.svg.replace(
  /<svg\b/,
  `<svg width="${widthPt}pt" height="${heightPt}pt"`,
);
await Bun.write(output, svg);

const profile = getProfile(ir.meta.profileId);
const maxWidth = profile?.page.maxWidth;
const fits = maxWidth === undefined || widthPt <= maxWidth.pt;
console.log(
  `Wrote ${output}: ${formatMm(widthPt)} × ${formatMm(heightPt)} ` +
    `(${ir.meta.profileId}${maxWidth ? `, max width ${formatMm(maxWidth.pt)}` : ""}` +
    `${fits ? "" : ", TOO WIDE"}; theme ${ir.meta.themeId}).`,
);
