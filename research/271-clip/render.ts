/** Run from the repository root: bun research/271-clip/render.ts */
import { mkdirSync } from "node:fs";
import { svgToPptx } from "../../src/render/pptx";
import { readPptx } from "../../src/render/pptx/testing";

const base = new URL("./", import.meta.url);
const out = new URL("out/", base);
mkdirSync(out, { recursive: true });
const yaml = new URL("clip.sumi.yaml", base).pathname;
for (const args of [
  ["fmt", yaml],
  ["lint", "--geometry", "--json", yaml],
  ["render", "--json", yaml, "-o", new URL("clip.svg", out).pathname],
]) {
  const result = Bun.spawnSync(["bun", "src/cli/index.ts", ...args]);
  const stdout = result.stdout.toString();
  console.log(stdout);
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  if (args[0] !== "fmt") {
    const report = JSON.parse(stdout);
    if (report.summary.errors !== 0 || report.summary.warnings !== 0) {
      throw new Error("Figure must have zero errors and warnings");
    }
    await Bun.write(new URL(`${args[0]}.json`, out), stdout);
  }
}
// Use Sumi's existing resvg PNG fallback, retaining embedded fonts and images.
const pptx = svgToPptx(await Bun.file(new URL("clip.svg", out)).text());
if (!pptx.ok) throw new Error(JSON.stringify(pptx.diagnostics));
const png = readPptx(pptx.value).get("ppt/media/figure.png");
if (!png) throw new Error("Missing PNG fallback");
const preview = new URL("preview.png", base);
await Bun.write(preview, png);
const converted = Bun.spawnSync([
  "magick",
  preview.pathname,
  "-resize",
  "1500x",
  "-colors",
  "128",
  "-strip",
  `PNG8:${preview.pathname}`,
]);
if (converted.exitCode !== 0) throw new Error(converted.stderr.toString());
const bytes = Bun.file(preview).size;
if (bytes >= 150_000) throw new Error(`Preview too large: ${bytes} bytes`);
console.log(`Preview: ${bytes} bytes`);
