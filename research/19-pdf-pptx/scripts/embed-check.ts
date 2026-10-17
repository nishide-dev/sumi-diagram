/**
 * #19 research: checks that the svg2pdf WASM module can live inside a
 * `bun build --compile` binary. Build and run:
 *
 *   bun build --compile research/19-pdf-pptx/scripts/embed-check.ts \
 *     --outfile research/19-pdf-pptx/.tools/embed-check
 *   research/19-pdf-pptx/.tools/embed-check <in.resolved.svg> <out.pdf> <font.ttf>...
 *
 * The WASM file is embedded (`with { type: "file" }` → a `/$bunfs/` path);
 * fonts stay real files, as in the release tarball (design doc §6.8).
 */

import { readFileSync, writeFileSync } from "node:fs";
import wasmPath from "../.tools/sumi_svg2pdf_poc.wasm" with { type: "file" };
import { loadSvg2Pdf } from "./lib/svg2pdf-wasm";

const [input, output, ...fonts] = process.argv.slice(2);
if (input === undefined || output === undefined || fonts.length === 0) {
  console.error("usage: embed-check <in.svg> <out.pdf> <font.ttf>...");
  process.exit(2);
}
const convert = await loadSvg2Pdf(
  wasmPath,
  fonts.map((f) => readFileSync(f)),
);
writeFileSync(output, convert(readFileSync(input)));
console.log(`wrote ${output} (wasm: ${wasmPath})`);
