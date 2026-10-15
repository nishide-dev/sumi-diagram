/**
 * Renders a `*.sumi.yaml` figure to SVG with the pinned D2 CLI — a stopgap
 * until `sumi render` (#14) exists.
 *
 *   bun run example:render <figure.sumi.yaml> [out.svg]
 *
 * The output defaults to the input path with `.sumi.yaml` replaced by `.svg`.
 * Diagnostics go to stderr; any error exits with status 1.
 *
 * Uses the shared render pipeline (`renderFigure`, #11): the SVG is D2's
 * output finalized with `width`/`height` in pt (1 D2 unit = 0.5pt, design doc
 * §5.1) and Sumi's deterministic `<metadata>`, and every element is checked
 * by the inspection. The output width is printed and compared with the
 * profile's `page.maxWidth` (the geometry lint itself is #13).
 */

import { basename } from "node:path";
import type { Diagnostic } from "../src/core/diagnostics";
import { formatMm } from "../src/core/units";
import { renderFigure } from "../src/render";

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

const result = await renderFigure(await Bun.file(input).text(), {
  file: input,
  sourceName: `${basename(input)}.d2`,
});
report(result.diagnostics);
if (!result.ok) process.exit(1);

const { svg, inspection, compiled } = result.value;
await Bun.write(output, svg);

const { width, height } = inspection.canvas;
const { id: profileId, maxWidthPt } = inspection.profile;
const fits = maxWidthPt === undefined || width.pt <= maxWidthPt;
const limit = maxWidthPt === undefined ? "" : `, max width ${formatMm(maxWidthPt)}`;
console.log(
  `Wrote ${output}: ${formatMm(width.pt)} × ${formatMm(height.pt)} ` +
    `(${profileId}${limit}${fits ? "" : ", TOO WIDE"}; theme ${compiled.ir.meta.themeId}).`,
);
