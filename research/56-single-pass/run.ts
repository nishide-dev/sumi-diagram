/** Reproduce #56 measurements: bun research/56-single-pass/run.ts [--record]. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { stringify } from "yaml";
import { createD2CliBackend } from "../../src/backends/d2/backend";
import { compileFigure, expectD2Figure } from "../../src/compiler/compile";
import type { NodeIR } from "../../src/compiler/ir";
import { getOutlineRenderer } from "../../src/core/outline";
import { getTheme } from "../../src/core/theme/builtin";
import { BUNDLED_FONT_SHA256 } from "../../src/core/theme/fonts";
import { lintGeometry } from "../../src/lint/geometry/lint";
import { fontFileFor } from "../../src/lint/geometry/measure";
import { loadFontMetrics } from "../../src/lint/metrics";
import { composeOutlines } from "../../src/render/compose";
import { finalizeSvg } from "../../src/render/finalize";
import { inspectSvg } from "../../src/render/inspect";
import { type RenderedFigure, renderFigure } from "../../src/render/render";
import { approximateBox, type Candidate, estimateFigure } from "./estimate";

const OUT = join(import.meta.dir, "out");
const sha256 = (text: string) => new Bun.CryptoHasher("sha256").update(text).digest("hex");
const modes = ["two-pass", "d2-approx", "compact", "compact-aware"] as const;
type Mode = (typeof modes)[number];
const labels = {
  latin: "Filter",
  cjk: "入力データ",
  multiline: "Filter\n日本語",
  blanks: "\nmiddle\n",
  spaces: "A     B",
  tabs: "A\tB",
  empty: "",
};
interface Case {
  id: string;
  component: "trapezoid" | "stack";
  theme: string;
  variant: string;
  label: string;
  direction: string;
  degree: number;
  nested: boolean;
}
const cases: Case[] = [];
for (const theme of ["minimal", "academic", "slides"])
  for (const variant of ["default", "emphasis"])
    for (const component of ["trapezoid", "stack"] as const)
      for (const [name, label] of Object.entries(labels)) {
        cases.push({
          id: `${theme}-${variant}-${component}-${name}`,
          component,
          theme,
          variant,
          label,
          direction: "right",
          degree: 0,
          nested: false,
        });
      }
for (const component of ["trapezoid", "stack"] as const)
  for (const direction of ["right", "left", "down", "up"])
    for (const degree of [2, 6]) {
      cases.push({
        id: `degree-${component}-${direction}-${degree}`,
        component,
        theme: "academic",
        variant: "default",
        label: "Filter",
        direction,
        degree,
        nested: true,
      });
    }

function source(c: Case): string {
  return stringify({
    version: 1,
    figure: {
      id: c.id,
      theme: c.theme,
      profile: c.theme === "slides" ? "presentation-16x9" : "paper-double",
      layout: { direction: c.direction },
    },
    ...(c.nested && { groups: [{ id: "group", label: "G" }] }),
    nodes: [
      {
        id: "subject",
        component: c.component,
        label: c.label,
        variant: c.variant,
        ...(c.nested && { group: "group" }),
      },
      ...Array.from({ length: c.degree }, (_, i) => ({
        id: `p${i}`,
        component: "box",
        label: "P",
      })),
    ],
    edges: Array.from({ length: c.degree }, (_, i) => ({ from: `p${i}`, to: "subject" })),
  });
}

function requireOk<T>(
  result: { ok: true; value: T; diagnostics: unknown[] } | { ok: false; diagnostics: unknown[] },
): T {
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.value;
}
const backend = createD2CliBackend();
async function render(text: string, mode: Mode) {
  const start = performance.now();
  let calls = 0;
  let firstSvg: string | undefined;
  const counted = {
    ...backend,
    render: async (input: Parameters<typeof backend.render>[0]) => {
      calls++;
      const result = await backend.render(input);
      if (result.ok) firstSvg ??= result.value.svg;
      return result;
    },
  };
  let rendered: RenderedFigure;
  let diagnostics: { code: string; severity: string; message: string }[];
  if (mode === "two-pass") {
    const result = await renderFigure(text, { backend: counted });
    rendered = requireOk(result);
    diagnostics = result.diagnostics;
  } else {
    const compiled = estimateFigure(
      expectD2Figure(requireOk(compileFigure(text))),
      mode as Candidate,
    );
    const artifact = requireOk(
      await counted.render({
        d2Source: compiled.d2Source,
        layout: compiled.layout,
        fontSet: compiled.fontSet,
      }),
    );
    const finalized = requireOk(finalizeSvg(artifact, compiled, { source: text }));
    const inspected = requireOk(inspectSvg(finalized.svg, compiled.ir));
    const composed = composeOutlines(finalized.svg, compiled.ir, inspected);
    const svg = requireOk(composed);
    rendered = {
      compiled,
      artifact,
      svg,
      metadata: finalized.metadata,
      inspection: requireOk(inspectSvg(svg, compiled.ir)),
    };
    diagnostics = composed.diagnostics;
  }
  const elapsedMs = performance.now() - start;
  const lint = lintGeometry(rendered, { source: text });
  if (calls !== (mode === "two-pass" ? 2 : 1))
    throw new Error(`Unexpected backend call count ${calls}`);
  const subject = rendered.inspection.elements.find((e) => e.key === "n:subject");
  if (!subject?.bbox) throw new Error("missing subject geometry");
  const node = rendered.compiled.ir.elements.get("n:subject") as NodeIR;
  const renderer = node.render && getOutlineRenderer(node.render.renderer);
  if (!renderer) throw new Error("missing renderer");
  const safeArea = renderer.draw(subject.bbox, renderer.params.parse(node.render?.params)).safeArea;
  const first = firstSvg && inspectSvg(firstSvg, rendered.compiled.ir);
  const measured = first && requireOk(first).elements.find((e) => e.key === "n:subject")?.bbox;
  return {
    rendered,
    measurement: {
      calls,
      footprint: { width: subject.bbox.width, height: subject.bbox.height },
      safeArea: { width: safeArea.width, height: safeArea.height },
      canvas: {
        width: rendered.inspection.canvas.width.units,
        height: rendered.inspection.canvas.height.units,
      },
      ...(mode === "two-pass" &&
        measured && { firstPass: { width: measured.width, height: measured.height } }),
      diagnostics: [...diagnostics, ...lint].map((d) => ({ code: d.code, severity: d.severity })),
      svgSha256: sha256(rendered.svg),
      elapsedMs: Math.round(elapsedMs * 100) / 100,
    },
  };
}

async function main() {
  if (Bun.argv.slice(2).some((a) => a !== "--record"))
    throw new Error("Usage: bun research/56-single-pass/run.ts [--record]");
  await mkdir(OUT, { recursive: true });
  const fonts: Record<string, string> = {};
  for (const [path, expected] of BUNDLED_FONT_SHA256) {
    const actual = new Bun.CryptoHasher("sha256").update(await readFile(path)).digest("hex");
    if (actual !== expected) throw new Error("bundled font mismatch");
    fonts[path.split("/").at(-1) ?? "font"] = actual;
  }
  // Warm up the D2 subprocess path and the bundled font caches before timing.
  await render(source(cases[0] as Case), "two-pass");
  const results: (Case & {
    fontSizeUnits: number;
    paintedBold: boolean;
    advances: { regular: number; bold: number };
    approximateBox: { width: number; height: number };
    modes: Partial<Record<Mode, Awaited<ReturnType<typeof render>>["measurement"]>>;
  })[] = [];
  for (const c of cases) {
    const text = source(c);
    const compiled = expectD2Figure(requireOk(compileFigure(text)));
    const node = compiled.ir.elements.get("n:subject") as NodeIR;
    const theme = getTheme(c.theme);
    if (!theme) throw new Error("missing theme");
    const regular = loadFontMetrics(fontFileFor("regular", theme.fontSet));
    const bold = loadFontMetrics(fontFileFor("bold", theme.fontSet));
    const maxWidth = (font: typeof regular) =>
      Math.max(
        ...c.label.split("\n").map((line) => font.measureEm(line) * node.style.fontSize.units),
      );
    const entries: Partial<Record<Mode, Awaited<ReturnType<typeof render>>["measurement"]>> = {};
    await writeFile(join(OUT, `${c.id}.sumi.yaml`), text);
    let version = "";
    for (const mode of modes) {
      const result = await render(text, mode);
      entries[mode] = result.measurement;
      version = result.rendered.metadata.backend.version;
      await writeFile(join(OUT, `${c.id}.${mode}.svg`), result.rendered.svg);
      // Confirm byte determinism independently on the first case of each mode.
      if (c.id === cases[0]?.id) {
        const repeated = await render(text, mode);
        if (repeated.rendered.svg !== result.rendered.svg)
          throw new Error(`${mode} is not deterministic`);
      }
    }
    if (version !== "0.9.0") throw new Error(`unexpected D2 version ${version}`);
    results.push({
      ...c,
      fontSizeUnits: node.style.fontSize.units,
      paintedBold: node.style.bold,
      advances: { regular: maxWidth(regular), bold: maxWidth(bold) },
      approximateBox: approximateBox(node, compiled),
      modes: entries,
    });
    console.log(
      `${c.id}: ${modes.map((m) => `${m} ${JSON.stringify(entries[m]?.footprint)} [${entries[m]?.diagnostics.map((d) => d.code).join(",")}]`).join(" | ")}`,
    );
  }
  const benchmark: { repeat: number; mode: Mode; elapsedMs: number }[] = [];
  const benchmarkCase = cases[0] as Case;
  for (let repeat = 0; repeat < 5; repeat++)
    for (let i = 0; i < modes.length; i++) {
      const mode = modes[(i + repeat) % modes.length] as Mode;
      const result = await render(source(benchmarkCase), mode);
      benchmark.push({ repeat, mode, elapsedMs: result.measurement.elapsedMs });
    }
  const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return (
      ((sorted[Math.floor((sorted.length - 1) / 2)] ?? 0) +
        (sorted[Math.floor(sorted.length / 2)] ?? 0)) /
      2
    );
  };
  const summary = modes.map((mode) => {
    const ratios = [];
    const canvasRatios = [];
    let equalFootprints = 0;
    let equalSvgs = 0;
    let diagnosticCases = 0;
    const codes: Record<string, number> = {};
    for (const c of results) {
      const baseline = c.modes["two-pass"];
      const measured = c.modes[mode];
      if (!baseline || !measured) throw new Error("missing mode");
      ratios.push(
        (measured.footprint.width * measured.footprint.height) /
          (baseline.footprint.width * baseline.footprint.height),
      );
      canvasRatios.push(
        (measured.canvas.width * measured.canvas.height) /
          (baseline.canvas.width * baseline.canvas.height),
      );
      if (
        measured.footprint.width === baseline.footprint.width &&
        measured.footprint.height === baseline.footprint.height
      )
        equalFootprints++;
      if (measured.svgSha256 === baseline.svgSha256) equalSvgs++;
      if (measured.diagnostics.length) diagnosticCases++;
      for (const d of measured.diagnostics) codes[d.code] = (codes[d.code] ?? 0) + 1;
    }
    return {
      mode,
      cases: results.length,
      equalFootprints,
      equalSvgs,
      diagnosticCases,
      codes,
      medianAreaRatio: median(ratios),
      minAreaRatio: Math.min(...ratios),
      maxAreaRatio: Math.max(...ratios),
      medianCanvasAreaRatio: median(canvasRatios),
      benchmarkMedianMs: median(benchmark.filter((b) => b.mode === mode).map((b) => b.elapsedMs)),
    };
  });
  const report = {
    baseCommit: "da1b124",
    d2Version: "0.9.0",
    sourceCommit: "d5a51743b6d5c00f1ec6f8340003f5d5a6ba4eda",
    runtime: { bun: Bun.version, platform: process.platform, arch: process.arch },
    fonts,
    cases: results,
    benchmark,
    summary,
  };
  const json = `${JSON.stringify(report, null, 2)}\n`;
  await writeFile(join(OUT, "report.json"), json);
  if (Bun.argv.includes("--record")) {
    await mkdir(join(import.meta.dir, "results"), { recursive: true });
    await writeFile(join(import.meta.dir, "results", "report.json"), json);
  }
  console.log(`Completed ${results.length} cases; report: ${join(OUT, "report.json")}`);
  console.log(JSON.stringify(summary, null, 2));
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
