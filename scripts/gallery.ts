/**
 * Generates the component gallery (#17) and re-renders the examples.
 *
 *   bun run gallery          # write docs/gallery/ and examples/<name>/<name>.{svg,pdf}
 *   bun run gallery:check    # fail if any of them differs from what would be written
 *
 * Renders, with the pinned D2 CLI (`bun run d2:install`) and the shared
 * pipeline (`renderFigure()` + geometry lint, as `sumi render`):
 *
 * - every catalog component × every built-in theme (one figure per component
 *   showing all its variants) → docs/gallery/components/
 * - every `examples/<name>/<name>.sumi.yaml` as written → the SVG next to it,
 *   and that SVG converted to PDF (`svgToPdf()`, as `sumi render -o x.pdf`;
 *   #59) → the PDF next to it
 * - `examples/pipeline` under every theme × profile via overrides →
 *   docs/gallery/compare/
 * - every tone under every built-in theme (#92) → docs/gallery/tones/, and
 *   every tone as an outline and on edges (#177) → docs/gallery/tones/outlined.*
 * - a dimmed group under every built-in theme (#175) → docs/gallery/dim/
 * - `examples/transformer` (structured layout) under every built-in theme →
 *   docs/gallery/themes/ (#264)
 *
 * and writes docs/gallery/index.html (everything on one page) and the Markdown pages
 * (#264): docs/gallery/README.md (a short index), components/<name>.md and the
 * topic pages. Component
 * samples and examples must render without errors or warnings (infos allowed); comparison cells
 * may fail (a profile can reject a theme's font sizes) and show why.
 *
 * Output is byte-deterministic: D2's SVG is deterministic for a given D2
 * version, font set and source, the PDF engine is one pinned WASM module, and
 * the pages contain no dates or absolute paths. Files under docs/gallery/ and
 * example SVGs / PDFs without a matching source that the generator no longer
 * produces are deleted (reported as stale by --check).
 */

import { mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parse } from "yaml";
import { layoutStructuredFigure } from "../src/layout";
import { formatLintJson, formatLintText, lintFigure } from "../src/lint";
import { svgToPdf } from "../src/render/pdf";
import { type GalleryModel, galleryHtml, galleryMarkdownPages } from "./gallery/page";
import { type RenderJob, type RenderOutcome, renderAll } from "./gallery/render";
import {
  COMPARISON_EXAMPLE,
  comparison,
  componentSamples,
  dimSample,
  filledToneSample,
  GALLERY_DIR,
  outlinedToneSample,
  THEME_COMPARISON_EXAMPLE,
  themeComparison,
  toneSample,
} from "./gallery/samples";

const ROOT = join(import.meta.dir, "..");
const args = process.argv.slice(2);
const check = args.includes("--check");
if (args.some((a) => a !== "--check")) {
  console.error("Usage: bun scripts/gallery.ts [--check]");
  process.exit(2);
}

const read = (path: string) => Bun.file(join(ROOT, path)).text();
/** `examples/<name>/<name>.sumi.yaml` → `examples/<name>/<name>.pdf`. */
const examplePdf = (source: string) => source.replace(/\.sumi\.yaml$/, ".pdf");
const sameBytes = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((byte, i) => byte === b[i]);

const samples = componentSamples();
const exampleSources = [...new Bun.Glob("examples/*/*.sumi.yaml").scanSync(ROOT)]
  .map((p) => p.split("\\").join("/"))
  .sort();
const compare = comparison();
const themeCompare = themeComparison();
const tones = toneSample();
const dim = dimSample();
const outlinedTones = outlinedToneSample();
const filledTones = filledToneSample();

const jobs: RenderJob[] = [];
for (const sample of samples) {
  for (const rendering of sample.renderings) {
    jobs.push({
      file: sample.fileName,
      source: sample.source,
      rendering,
      ...(sample.assetBase !== undefined && { assetBase: join(ROOT, sample.assetBase) }),
    });
  }
}
const exampleTexts = new Map<string, string>();
for (const source of exampleSources) {
  const text = await read(source);
  exampleTexts.set(source, text);
  jobs.push({
    file: source,
    source: text,
    // Image paths (#94) are relative to the example's YAML file.
    assetBase: join(ROOT, dirname(source)),
    rendering: {
      output: source.replace(/\.sumi\.yaml$/, ".svg"),
      theme: "",
      profile: "",
      overrides: {},
    },
  });
}
const comparisonText = exampleTexts.get(COMPARISON_EXAMPLE) ?? (await read(COMPARISON_EXAMPLE));
for (const rendering of compare.renderings) {
  jobs.push({ file: COMPARISON_EXAMPLE, source: comparisonText, rendering });
}
const themeComparisonText =
  exampleTexts.get(THEME_COMPARISON_EXAMPLE) ?? (await read(THEME_COMPARISON_EXAMPLE));
for (const rendering of themeCompare.renderings) {
  jobs.push({
    file: THEME_COMPARISON_EXAMPLE,
    source: themeComparisonText,
    // Image paths (#94) are relative to the example's YAML file.
    assetBase: join(ROOT, dirname(THEME_COMPARISON_EXAMPLE)),
    rendering,
  });
}
for (const rendering of tones.renderings) {
  jobs.push({ file: tones.fileName, source: tones.source, rendering });
}
for (const rendering of dim.renderings) {
  jobs.push({ file: dim.fileName, source: dim.source, rendering });
}
for (const rendering of outlinedTones.renderings) {
  jobs.push({ file: outlinedTones.fileName, source: outlinedTones.source, rendering });
}
for (const rendering of filledTones.renderings) {
  jobs.push({ file: filledTones.fileName, source: filledTones.source, rendering });
}

const outcomes = await renderAll(jobs);
let cursor = 0;
const take = (n: number) => {
  const slice = outcomes.slice(cursor, cursor + n);
  cursor += n;
  return slice;
};

const model: GalleryModel = {
  components: samples.map((sample) => ({ sample, outcomes: take(sample.renderings.length) })),
  examples: take(exampleSources.length).map((outcome, i) => {
    const source = exampleSources[i] ?? "";
    const doc = parse(exampleTexts.get(source) ?? "") as { figure?: { title?: string } };
    return { source, title: doc.figure?.title ?? source, outcome, pdf: examplePdf(source) };
  }),
  comparison: { source: COMPARISON_EXAMPLE, outcomes: take(compare.renderings.length) },
  themeComparison: {
    source: THEME_COMPARISON_EXAMPLE,
    outcomes: take(themeCompare.renderings.length),
  },
  tones: { sample: tones, outcomes: take(tones.renderings.length) },
  dim: { sample: dim, outcomes: take(dim.renderings.length) },
  outlinedTones: { sample: outlinedTones, outcomes: take(outlinedTones.renderings.length) },
  filledTones: { sample: filledTones, outcomes: take(filledTones.renderings.length) },
};

// Component, tone and dim samples and examples allow infos, but no errors or warnings.
const problems: string[] = [];
const strict: [string, RenderOutcome][] = [
  ...model.components.flatMap(({ sample, outcomes }) =>
    outcomes.map((o): [string, RenderOutcome] => [`${sample.entry.id} (${o.theme})`, o]),
  ),
  ...model.examples.map(({ source, outcome }): [string, RenderOutcome] => [source, outcome]),
  ...model.tones.outcomes.map((o): [string, RenderOutcome] => [`tones (${o.theme})`, o]),
  ...model.dim.outcomes.map((o): [string, RenderOutcome] => [`dim (${o.theme})`, o]),
  ...model.filledTones.outcomes.map((o): [string, RenderOutcome] => [
    `filled tones (${o.theme})`,
    o,
  ]),
  ...model.outlinedTones.outcomes.map((o): [string, RenderOutcome] => [
    `outlined tones (${o.theme})`,
    o,
  ]),
];
for (const [name, outcome] of strict) {
  const blocking = outcome.diagnostics.filter((d) => d.severity !== "info");
  if (outcome.svg === undefined || blocking.length > 0) {
    problems.push(
      `${name}: ${outcome.svg === undefined ? "not rendered" : "rendered with errors or warnings"}`,
      ...blocking.map((d) => `  ${d.severity} ${d.code}: ${d.message}`),
    );
  }
}
if (problems.length > 0) {
  console.error(
    `Gallery samples and examples must render without errors or warnings (infos allowed):\n${problems.join("\n")}`,
  );
  process.exit(1);
}

// Everything the generator owns, by path relative to the repository root.
const files = new Map<string, string | Uint8Array>();
// Catalog additions change unknown-component hints in diagnostic snapshots too.
for (const name of ["ancestor-edge", "no-cascade", "clean"]) {
  const file = `lint/${name}.sumi.yaml`;
  const report = lintFigure(
    await read(`tests/fixtures/figures/${file}`),
    name === "clean" ? {} : { file },
  );
  files.set(`tests/fixtures/lint-output/${name}.txt`, formatLintText(report));
  files.set(`tests/fixtures/lint-output/${name}.json`, formatLintJson(report));
}
// Keep the placement/routing snapshots affected by the Transformer gallery
// in the same canonical regeneration path as its SVG and export goldens.
for (const name of ["a-transformer", "align-side-kv"]) {
  const source = await read(`tests/fixtures/figures/layout/${name}.sumi.yaml`);
  for (const route of [false, true]) {
    const placed = layoutStructuredFigure(source, { route });
    if (!placed.ok) throw new Error(JSON.stringify(placed.diagnostics));
    files.set(
      `tests/fixtures/layout/${name}${route ? ".routed" : ""}.layout.json`,
      `${JSON.stringify(placed.value.layout, null, 2)}\n`,
    );
  }
}
for (const outcome of outcomes) {
  if (outcome.svg !== undefined) files.set(outcome.rendering.output, outcome.svg);
}
// The examples' PDFs, from the SVGs above (byte-identical goldens, #59).
for (const { source, outcome } of model.examples) {
  if (outcome.svg === undefined) continue;
  const pdf = svgToPdf(outcome.svg);
  if (!pdf.ok) {
    console.error(
      `${source}: PDF conversion failed:\n${pdf.diagnostics.map((d) => `  ${d.code}: ${d.message}`).join("\n")}`,
    );
    process.exit(1);
  }
  files.set(examplePdf(source), pdf.value);
}
files.set(`${GALLERY_DIR}/index.html`, galleryHtml(model));
for (const [path, text] of galleryMarkdownPages(model)) files.set(path, text);

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(join(ROOT, dir), { withFileTypes: true }).catch(() => []);
  const out: string[] = [];
  for (const entry of entries) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...(await listFiles(path)));
    else out.push(path);
  }
  return out;
}

// Stale: anything under docs/gallery/ and any example SVG or PDF
// (`examples/*/*.{svg,pdf}`) that this run did not produce, e.g. the output
// of a deleted or renamed example.
const exampleSvgs = [...new Bun.Glob("examples/*/*.{svg,pdf}").scanSync(ROOT)].map((p) =>
  p.split("\\").join("/"),
);
const stale = [...(await listFiles(GALLERY_DIR)), ...exampleSvgs]
  .filter((path) => !files.has(path))
  .sort();
const changed: string[] = [];
for (const [path, content] of [...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
  const file = Bun.file(join(ROOT, path));
  if (!(await file.exists())) changed.push(path);
  else if (
    typeof content === "string"
      ? (await file.text()) !== content
      : !sameBytes(new Uint8Array(await file.arrayBuffer()), content)
  ) {
    changed.push(path);
  }
}

if (check) {
  if (changed.length === 0 && stale.length === 0) {
    console.log(`Gallery and examples are up to date (${files.size} files).`);
    process.exit(0);
  }
  console.error(
    [
      "Gallery or examples are out of date. Run `bun run gallery` and commit the result.",
      ...changed.map((p) => `  changed: ${p}`),
      ...stale.map((p) => `  stale:   ${p}`),
    ].join("\n"),
  );
  process.exit(1);
}

for (const path of changed) {
  const target = join(ROOT, path);
  await mkdir(dirname(target), { recursive: true });
  await Bun.write(target, files.get(path) ?? "");
}
for (const path of stale) await rm(join(ROOT, path));
const total = [...files.values()].reduce(
  (n, c) => n + (typeof c === "string" ? Buffer.byteLength(c) : c.length),
  0,
);
console.log(
  `Wrote ${changed.length} of ${files.size} files, removed ${stale.length} (${Math.round(total / 1024)}KB in total, ${GALLERY_DIR}/ and examples/).`,
);
