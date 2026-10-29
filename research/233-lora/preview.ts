/** Reproduce the acceptance PNG through the same resvg engine as picture PPTX. */
import { svgToPptx } from "../../src/render/pptx";
import { readPptx } from "../../src/render/pptx/testing";

const source = new URL("./c-h3world.svg", import.meta.url);
const pptx = svgToPptx(await Bun.file(source).text());
if (!pptx.ok) throw new Error(JSON.stringify(pptx.diagnostics));
const png = readPptx(pptx.value).get("ppt/media/figure.png");
if (!png) throw new Error("Missing PNG fallback");
const output = new URL("./previews/c-h3world.png", import.meta.url);
await Bun.write(output, png);
// ImageMagick is used only for this small review artifact, not by Sumi.
const converted = Bun.spawn([
  "magick",
  output.pathname,
  "-resize",
  "1200x",
  "-colors",
  "128",
  "-strip",
  `PNG8:${output.pathname}`,
]);
if ((await converted.exited) !== 0) throw new Error(await new Response(converted.stderr).text());
const size = Bun.file(output).size;
if (size >= 150_000) throw new Error(`Preview is too large: ${size} bytes`);
console.log(`${output.pathname}: ${size} bytes`);
