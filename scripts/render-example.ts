/**
 * Renders a `*.sumi.yaml` figure to SVG — a thin alias of `sumi render` (#14)
 * kept for `bun run example:render`, so examples and the CLI share one path
 * (`renderFigure()`, #11).
 *
 *   bun run example:render <figure.sumi.yaml> [out.svg]
 *
 * The output defaults to the input path with `.sumi.yaml` replaced by `.svg`.
 * Diagnostics go to stderr; exit status as `sumi render` (1 on errors).
 */

import { run } from "../src/cli/program";

const [input, output, ...rest] = process.argv.slice(2);
if (!input || rest.length > 0) {
  console.error("Usage: bun run example:render <figure.sumi.yaml> [out.svg]");
  process.exit(2);
}

process.exitCode = await run(["render", input, ...(output === undefined ? [] : ["-o", output])]);
