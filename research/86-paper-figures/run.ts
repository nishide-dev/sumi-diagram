/**
 * Reproduces the #86 measurements (docs/research/86-paper-figures.md).
 *
 *   bun research/86-paper-figures/run.ts             # everything, prints a summary
 *   bun research/86-paper-figures/run.ts --offline   # skip npm / GitHub downloads
 *   bun research/86-paper-figures/run.ts --record    # also rewrite results/report.json
 *   bun research/86-paper-figures/run.ts --only proto
 *
 * Outputs (SVG / PDF / PNG / D2) go to out/ (gitignored); downloads to .tools/.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { checkFigure } from "../../src/core/check";
import { lintGeometry } from "../../src/lint/geometry/lint";
import { renderFigure } from "../../src/render/render";
import { measureBundles } from "./measure/bundles";
import { runD2Probes } from "./measure/d2-probes";
import { runEngineImageProbes } from "./measure/engine-images";
import { exportSvg } from "./measure/export";
import { measureGlyphs } from "./measure/glyphs";
import { emojiSamples, measureIconSets, simpleIconsLicenses } from "./measure/icons";
import { measureMathJax } from "./measure/mathjax";
import { allPackageFacts } from "./measure/packages";
import { runPrototype } from "./proto";

const DIR = import.meta.dir;
const OUT = join(DIR, "out");
const args = new Set(process.argv.slice(2));
const only = process.argv.includes("--only")
  ? process.argv[process.argv.indexOf("--only") + 1]
  : undefined;
const want = (name: string) => only === undefined || only === name;
const offline = args.has("--offline");
const sha256 = (s: string) => new Bun.CryptoHasher("sha256").update(s).digest("hex");

const report: Record<string, unknown> = {
  environment: {
    date: new Date().toLocaleDateString("sv"),
    platform: `${process.platform}-${process.arch}`,
    bun: Bun.version,
  },
};
await mkdir(OUT, { recursive: true });

const IDEAL = ["a-transformer", "b-dit", "c-h3world"];
const PROTO = ["a-transformer", "b-adaln-panel"];

if (want("proto")) {
  const proto: Record<string, unknown> = {};
  for (const name of PROTO) {
    const text = await readFile(join(DIR, "figures", "ideal", `${name}.sumi.yaml`), "utf8");
    const first = runPrototype(text);
    const second = runPrototype(text);
    // Warm timing: median of 5 further runs.
    const times = [0, 1, 2, 3, 4].map(() => {
      const t = runPrototype(text).timing;
      return t.parseMs + t.layoutMs + t.routeMs + t.svgMs;
    });
    times.sort((a, b) => a - b);
    await writeFile(join(OUT, `${name}.svg`), first.svg);
    const exported = await exportSvg(first.svg, join(OUT, name));
    proto[name] = {
      sizeUnits: [first.layout.width, first.layout.height],
      sizeMm: [first.layout.width, first.layout.height].map(
        (u) => Math.round(((u / 2) * 25.4 * 100) / 72) / 100,
      ),
      checks: first.checks,
      svgBytes: first.svg.length,
      svgSha256: sha256(first.svg),
      deterministic: first.svg === second.svg,
      medianMs: Math.round((times[2] ?? 0) * 100) / 100,
      export: exported,
    };
  }
  report.prototype = proto;
}

if (want("schema")) {
  // How today's Sumi (schema v1) reacts to the proposed drafts.
  const schema: Record<string, unknown> = {};
  for (const name of IDEAL) {
    const text = await readFile(join(DIR, "figures", "ideal", `${name}.sumi.yaml`), "utf8");
    const gated = checkFigure(text).state.diagnostics.map((d) => d.code);
    // Without the `requires` gate: which fields v1 does not know.
    const check = checkFigure(text.replace(/^requires: .*\n/m, ""));
    const byCode: Record<string, number> = {};
    for (const d of check.state.diagnostics) byCode[d.code] = (byCode[d.code] ?? 0) + 1;
    const fields = new Set<string>();
    for (const d of check.state.diagnostics)
      if (d.code === "schema/unknown-field" && d.path !== undefined) {
        const last = d.path.at(-1);
        if (typeof last === "string") fields.add(last);
      }
    schema[name] = {
      withRequires: gated,
      withoutRequires: byCode,
      unknownFields: [...fields].sort(),
    };
  }
  report.currentSchema = schema;
}

if (want("v1")) {
  // Best-effort approximation of figure A within today's schema, rendered by D2.
  const text = await readFile(join(DIR, "figures", "v1", "a-transformer.sumi.yaml"), "utf8");
  const rendered = await renderFigure(text);
  if (!rendered.ok) throw new Error(JSON.stringify(rendered.diagnostics, null, 2));
  await writeFile(join(OUT, "a-transformer.v1.svg"), rendered.value.svg);
  const geometry = lintGeometry(rendered.value);
  const boxes = new Map<string, { x: number; y: number; width: number; height: number }>();
  for (const el of rendered.value.inspection.elements)
    if (el.bbox !== undefined) boxes.set(el.key, el.bbox);
  const pick = (k: string) => boxes.get(`n:${k}`);
  const centers = ["enc-mha", "enc-norm1", "enc-ff", "enc-norm2"].map((k) => {
    const b = pick(k);
    return b === undefined ? null : b.x + b.width / 2;
  });
  const gap = (lower: string, upper: string) => {
    const a = pick(lower);
    const b = pick(upper);
    return a === undefined || b === undefined ? null : a.y - (b.y + b.height);
  };
  report.v1Approximation = {
    sizeMm: [rendered.value.inspection.canvas.width.mm, rendered.value.inspection.canvas.height.mm],
    diagnostics: [...rendered.diagnostics, ...geometry].map((d) => `${d.code}: ${d.message}`),
    encoderCentersX: centers,
    gapMhaToNormUnits: gap("enc-mha", "enc-norm1"),
    gapFfToNormUnits: gap("enc-ff", "enc-norm2"),
  };
  await exportSvg(rendered.value.svg, join(OUT, "a-transformer.v1"));
}

if (want("d2")) report.d2Probes = await runD2Probes();
if (want("engine")) report.engineImages = await runEngineImageProbes();
if (want("glyphs")) report.glyphs = measureGlyphs();
if (!offline && want("packages")) report.packages = await allPackageFacts();
if (!offline && want("icons")) {
  report.iconSets = await measureIconSets();
  report.simpleIconsLicenses = await simpleIconsLicenses();
  report.emojiSamples = await emojiSamples();
}
if (!offline && want("bundles")) report.bundles = await measureBundles();
if (!offline && want("mathjax")) report.mathjax = await measureMathJax();

const json = `${JSON.stringify(report, null, 2)}\n`;
await writeFile(join(OUT, "report.json"), json);
if (args.has("--record")) await writeFile(join(DIR, "results", "report.json"), json);
console.log(json.length > 4000 ? `${json.slice(0, 4000)}\n… (see out/report.json)` : json);
