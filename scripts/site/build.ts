import { copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { version } from "../../package.json";
import { getPalette, PALETTE_NAMES } from "../../src/core/theme/palette";
import { type RenderJob, renderAll } from "../gallery/render";
import {
  componentSamples,
  dimSample,
  glyphSample,
  legendSample,
  setsSample,
  strokeSample,
  THEMES,
  toneSample,
} from "../gallery/samples";
import { componentData, exampleMetadata, optionData, sampleSource } from "./data";

const out = "dist/site";
const components = componentSamples();
const options = [
  {
    sample: toneSample(),
    title: "Tones",
    description: "Semantic colors for nodes, groups and edges.",
  },
  {
    sample: dimSample(),
    title: "Dimmed group",
    description: "De-emphasize a group and its contents.",
  },
  {
    sample: glyphSample(),
    title: "Node glyphs",
    description: "Small marks and vectors attached to nodes.",
  },
  {
    sample: setsSample(),
    title: "Set enclosures",
    description: "Show overlapping and nested sets.",
  },
  {
    sample: strokeSample(),
    title: "Stroke options",
    description: "Line widths, arrowheads and frame styles.",
  },
  {
    sample: legendSample(),
    title: "Legends",
    description: "Explain the visual marks in a figure.",
  },
];
const examples = [];
const glob = new Bun.Glob("*/*.sumi.yaml");
for await (const path of glob.scan({ cwd: "examples", followSymlinks: true })) {
  const [slug, name] = path.split("/");
  if (!slug || name !== `${slug}.sumi.yaml` || slug.includes("c-h3world")) continue;
  const source = await Bun.file(`examples/${path}`).text();
  examples.push(exampleMetadata(slug, source));
}
examples.sort((a, b) => a.slug.localeCompare(b.slug));
await rm(out, { recursive: true, force: true });
await mkdir(`${out}/examples`, { recursive: true });
for (const example of examples)
  await copyFile(
    `examples/${example.slug}/${example.slug}.svg`,
    `${out}/examples/${example.slug}.svg`,
  );
const data = {
  version,
  themes: THEMES,
  palettes: PALETTE_NAMES.map((id) => ({ id, colors: getPalette(id)?.colors })),
  components: components.map(componentData),
  options: options.map(({ sample, title, description }) => optionData(sample, title, description)),
  examples,
};
await Bun.write(`${out}/data.json`, `${JSON.stringify(data, null, 2)}\n`);
const jobs: RenderJob[] = [];
for (const { sample, slug, assetBase } of [
  ...components.map((sample) => ({
    sample,
    slug: componentData(sample).slug,
    assetBase: sample.assetBase,
  })),
  ...options.map(({ sample, title, description }) => ({
    sample,
    slug: optionData(sample, title, description).slug,
    assetBase: undefined,
  })),
]) {
  for (const rendering of sample.renderings) {
    for (const palette of [undefined, ...PALETTE_NAMES]) {
      const output = `${out}/figures/${rendering.theme}/${palette ?? "base"}/${slug}.svg`;
      jobs.push({
        file: sample.fileName,
        source: sampleSource(sample.source, rendering.theme, rendering.profile, palette),
        rendering: { ...rendering, output },
        ...(assetBase && { assetBase: resolve(assetBase) }),
      });
    }
  }
}
console.log(`Rendering ${jobs.length} site figures...`);
const results = await renderAll(jobs);
for (const result of results) {
  const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  if (!result.svg || errors.length)
    throw new Error(`Failed to render ${result.rendering.output}: ${JSON.stringify(errors)}`);
  await mkdir(dirname(result.rendering.output), { recursive: true });
  await Bun.write(result.rendering.output, result.svg);
}
const bundle = await Bun.build({
  entrypoints: ["site/index.html"],
  outdir: out,
  minify: true,
  publicPath: "./",
});
if (!bundle.success) throw new AggregateError(bundle.logs, "Site bundle failed");
console.log(`Built ${jobs.length} figures and ${examples.length} examples in ${out}`);
