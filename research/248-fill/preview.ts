/** Reproduce the preview through Sumi's picture PPTX rasterizer. */
import { svgToPptx } from "../../src/render/pptx";
import { readPptx } from "../../src/render/pptx/testing";

const pptx = svgToPptx(await Bun.file(new URL("./c-h3world.svg", import.meta.url)).text());
if (!pptx.ok) throw new Error(JSON.stringify(pptx.diagnostics));
const png = readPptx(pptx.value).get("ppt/media/figure.png");
if (!png) throw new Error("Missing PNG fallback");
const output = new URL("./previews/c-h3world.png", import.meta.url);
await Bun.write(output, png);
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
if (Bun.file(output).size >= 150_000) throw new Error("Preview must be under 150KB");
console.log(`${output.pathname}: ${Bun.file(output).size} bytes`);
