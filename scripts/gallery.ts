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
 * - every tone under every built-in theme (#92) → docs/gallery/tones/
 *
 * and writes docs/gallery/index.html and docs/gallery/README.md. Component
 * samples and examples must render without any diagnostic; comparison cells
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
import { svgToPdf } from "../src/render/pdf";
import { type GalleryModel, galleryHtml, galleryMarkdown } from "./gallery/page";
import { type RenderJob, type RenderOutcome, renderAll } from "./gallery/render";
import {
  COMPARISON_EXAMPLE,
  comparison,
  componentSamples,
  GALLERY_DIR,
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
const tones = toneSample();

const jobs: RenderJob[] = [];
for (const sample of samples) {
  for (const rendering of sample.renderings) {
    jobs.push({ file: sample.fileName, source: sample.source, rendering });
  }
}
const exampleTexts = new Map<string, string>();
for (const source of exampleSources) {
  const text = await read(source);
  exampleTexts.set(source, text);
  jobs.push({
    file: source,
    source: text,
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
for (const rendering of tones.renderings) {
  jobs.push({ file: tones.fileName, source: tones.source, rendering });
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
  tones: { sample: tones, outcomes: take(tones.renderings.length) },
};

// Component and tone samples and examples must be clean.
const problems: string[] = [];
const strict: [string, RenderOutcome][] = [
  ...model.components.flatMap(({ sample, outcomes }) =>
    outcomes.map((o): [string, RenderOutcome] => [`${sample.entry.id} (${o.theme})`, o]),
  ),
  ...model.examples.map(({ source, outcome }): [string, RenderOutcome] => [source, outcome]),
  ...model.tones.outcomes.map((o): [string, RenderOutcome] => [`tones (${o.theme})`, o]),
];
for (const [name, outcome] of strict) {
  if (outcome.svg === undefined || outcome.diagnostics.length > 0) {
    problems.push(
      `${name}: ${outcome.svg === undefined ? "not rendered" : "rendered with diagnostics"}`,
      ...outcome.diagnostics.map((d) => `  ${d.severity} ${d.code}: ${d.message}`),
    );
  }
}
if (problems.length > 0) {
  console.error(
    `Gallery samples and examples must render without diagnostics:\n${problems.join("\n")}`,
  );
  process.exit(1);
}

// Everything the generator owns, by path relative to the repository root.
const files = new Map<string, string | Uint8Array>();
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
files.set(`${GALLERY_DIR}/README.md`, galleryMarkdown(model));

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
