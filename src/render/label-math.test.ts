/**
 * Label math end to end (#93): the component stage's diagnostics and their
 * positions, layout → SVG → inspection with per-run geometry, the geometry
 * and structural lint, text extraction from the PDF, and the editable PPTX.
 */

import { describe, expect, test } from "bun:test";
import { basename } from "node:path";
import { checkFigure } from "../core/check";
import { DEFAULT_FONT_SET_ID, getFontSet } from "../core/theme/fonts";
import { lintFigure } from "../lint";
import { lintGeometry } from "../lint/geometry";
import { fontFileFor, measureLabel } from "../lint/geometry/measure";
import { inspectSvg } from "./inspect";
import { svgToPdf } from "./pdf";
import { inspectPdf, textLines } from "./pdf/testing";
import { svgToEditablePptx } from "./pptx";
import { readPptx } from "./pptx/testing";
import { type RenderedStructuredFigure, renderFigure } from "./render";

const fonts = getFontSet(DEFAULT_FONT_SET_ID);
if (fonts === undefined) throw new Error("no default font set");

async function render(source: string): Promise<RenderedStructuredFigure> {
  const result = await renderFigure(source, {
    backend: {
      name: "d2-cli",
      render: () => {
        throw new Error("a structured figure must not reach the D2 backend");
      },
    },
  });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  return result.value as RenderedStructuredFigure;
}

const figure = (nodes: string, edges = "", arrange = "[a, b]") => `version: 1
figure:
  id: math
  theme: minimal
  profile: paper-double
  layout:
    arrange:
      stack: { gap: 8mm, items: ${arrange} }
nodes:
${nodes}
edges:
${edges || "  []"}
`;

const MATH = figure(
  `  - { id: a, component: box, label: 'Scale, Shift $\\gamma_1,\\beta_1$' }
  - { id: b, component: box, label: "$x_i^2 + y^{n-1} \\\\leq \\\\sum_k w_k$\\nline two α₂", variant: emphasis }
  - { id: c, component: box, label: '$\\text{入力}_{t} \\times 32$' }`,
  "  - { from: a, to: b, label: $\\alpha_2$ }",
  "[a, b, c]",
);

describe("component stage", () => {
  test("invalid math in a structured figure is an error at its characters", () => {
    const source = figure(
      `  - { id: a, component: box, label: 'Total $\\frac{a}{b}$' }
  - { id: b, component: box, label: "x $y" }`,
    );
    const diagnostics = checkFigure(source).state.diagnostics;
    expect(diagnostics.map((d) => [d.code, d.severity])).toEqual([
      ["component/invalid-math", "error"],
      ["component/invalid-math", "error"],
    ]);
    const [frac, open] = diagnostics;
    expect(frac?.message).toContain('"\\frac" is not supported');
    expect(frac?.message).toContain('label characters 8–12: "\\frac"');
    const lines = source.split("\n");
    const row = lines.findIndex((l) => l.includes("\\frac"));
    const line = lines[row] ?? "";
    expect(frac?.location).toMatchObject({
      line: row + 1,
      column: line.indexOf("\\frac") + 1,
      endLine: row + 1,
      endColumn: line.indexOf("\\frac") + 6,
    });
    expect(frac?.path).toEqual(["nodes", 0, "label"]);
    expect(open?.hint).toContain("\\$");
    const second = lines[row + 1] ?? "";
    expect(open?.location).toMatchObject({ line: row + 2, column: second.indexOf("$y") + 1 });
  });

  test("positions map through YAML quoting and escapes; block scalars fall back to the label", () => {
    const source = figure(
      `  - { id: a, component: box, label: "\\u00e9\\t$\\\\sqrt{2}$" }
  - id: b
    component: box
    label: |
      two $\\bad$`,
    );
    const lines = source.split("\n");
    const [sqrt, bad] = checkFigure(source).state.diagnostics;
    const row = lines.findIndex((l) => l.includes("sqrt"));
    expect(sqrt?.message).toContain('label characters 4–8: "\\sqrt"');
    expect(sqrt?.location).toMatchObject({
      line: row + 1,
      column: (lines[row] ?? "").indexOf("\\\\sqrt") + 1,
      endColumn: (lines[row] ?? "").indexOf("\\\\sqrt") + 7,
    });
    // The block scalar: the whole label.
    const block = lines.findIndex((l) => l.includes("label: |"));
    expect(bad?.location).toMatchObject({ line: block + 1, endLine: block + 3 });
  });

  test("in an auto figure, math is drawn as written with a warning", () => {
    const auto = `version: 1
figure: { id: math, theme: minimal, profile: paper-double }
nodes:
  - { id: a, component: box, label: '$\\gamma_1$' }
  - { id: b, component: box, label: "$5 or $10" }
  - { id: c, component: box, label: "Cost \\\\$5" }
edges: []
`;
    const diagnostics = checkFigure(auto).state.diagnostics;
    expect(diagnostics.map((d) => [d.code, d.severity, d.path])).toEqual([
      ["component/unsupported-in-auto", "warning", ["nodes", 0, "label"]],
    ]);
  });

  test("valid math passes", () => {
    expect(checkFigure(MATH).state.diagnostics).toEqual([]);
  });
});

describe("rendering", () => {
  test("labels are drawn as runs that the inspection and the geometry lint read back", async () => {
    const rendered = await render(MATH);
    const { svg, layout, compiled, inspection } = rendered;
    expect(svg).toContain('class="text-math-italic"');
    expect(svg).toContain("font-kerning:none");
    expect(svg).toMatch(/@font-face \{\n\tfont-family: sumi-\d+-font-math;/);
    const byKey = new Map(inspection.elements.map((e) => [e.key, e]));
    const labels = [
      ...layout.nodes.map((n) => [n.key, n.label] as const),
      ...layout.edges.map((e) => [e.key, e.route?.label] as const),
    ];
    for (const [key, placed] of labels) {
      const label = byKey.get(key)?.labels[0];
      expect(placed?.runs).toBeDefined();
      expect(label?.anchor).toEqual(placed?.anchor);
      expect(label?.runs?.map((line) => line.map((r) => [r.text, r.font]))).toEqual(
        placed?.runs?.map((line) => line.map((r) => [r.text, r.font])),
      );
      for (const [i, line] of (label?.runs ?? []).entries()) {
        for (const [j, run] of line.entries()) {
          const expected = placed?.runs?.[i]?.[j];
          expect(run.fontSizeUnits).toBeCloseTo(expected?.fontSizeUnits ?? Number.NaN, 6);
          expect(run.shiftUnits).toBeCloseTo(expected?.shiftUnits ?? Number.NaN, 6);
        }
      }
      if (placed !== undefined && label !== undefined && placed.lines.length > 1) {
        expect(label.lineHeightUnits).toBeCloseTo(placed.lineHeightUnits, 6);
      }
      // The re-measured runs lie inside the layout's line box.
      const measured = label && measureLabel(label, fonts);
      const box = placed?.box;
      if (measured?.box === undefined || box === undefined) throw new Error("no box");
      expect(measured.box.x).toBeGreaterThanOrEqual(box.x - 1e-3);
      expect(measured.box.y).toBeGreaterThanOrEqual(box.y - 1e-3);
      expect(measured.box.x + measured.box.width).toBeLessThanOrEqual(box.x + box.width + 1e-3);
      expect(measured.box.y + measured.box.height).toBeLessThanOrEqual(box.y + box.height + 1e-3);
    }
    expect(lintGeometry(rendered, { source: MATH })).toEqual([]);
    expect(inspectSvg(svg, compiled.ir).ok).toBe(true);
    expect((await render(MATH)).svg).toBe(svg);
  });

  test("scripts are smaller and shifted; their line box grows to hold them", async () => {
    const { layout } = await render(MATH);
    const b = layout.nodes.find((n) => n.key === "n:b")?.label;
    const size = b?.fontSizeUnits ?? 0;
    const runs = b?.runs?.[0] ?? [];
    expect(runs.find((r) => r.text === "i")).toMatchObject({ fontSizeUnits: size * 0.7 });
    expect(runs.find((r) => r.text === "i")?.shiftUnits).toBeCloseTo(size * 0.21, 9);
    expect(runs.find((r) => r.text === "2")?.shiftUnits).toBeCloseTo(-size * 0.36, 9);
    expect(b?.lineHeightUnits).toBeGreaterThanOrEqual(size * 1.25);
    // The second line falls back to the math font for the subscript two.
    expect(b?.runs?.[1]?.map((r) => [r.text, r.font])).toEqual([
      ["line two α", b?.font ?? ""],
      ["₂", "math"],
    ]);
  });

  test("the PDF draws the runs as text that extracts in reading order", async () => {
    const { svg } = await render(MATH);
    const pdf = svgToPdf(svg);
    if (!pdf.ok) throw new Error(JSON.stringify(pdf.diagnostics));
    const inspected = inspectPdf(pdf.value);
    const text = inspected.glyphs.map((g) => g.text).join("");
    expect(text).toContain("Scale, Shift γ1,β1");
    expect(text).toContain("α2");
    // The emphasis label's text is bold. Before #112 its line `line two α₂` was
    // drawn in STIX Two Math as a whole: the bold font lacks the `₂` (a math run),
    // and the math font had every character of the line.
    expect(inspected.fonts.map((f) => f.baseFont.replace(/^[A-Z]{6}\+/, "")).sort()).toEqual([
      "BIZUDPGothic-Bold",
      "BIZUDPGothic-Regular",
      "STIXTwoMath-Regular",
      "STIXTwoText-Italic",
    ]);
    expect(inspected.images).toBe(0);
    await expectPdfMatchesMeasure(MATH);
  });

  test("the editable PPTX writes scripts as runs with a baseline offset", async () => {
    const { svg, compiled } = await render(MATH);
    const editable = svgToEditablePptx(svg, compiled.ir);
    if (!editable.ok) throw new Error(JSON.stringify(editable.diagnostics));
    const slide = new TextDecoder().decode(readPptx(editable.value).get("ppt/slides/slide1.xml"));
    expect(slide).toMatch(/baseline="-21000"[^>]*>.*?<a:latin typeface="STIX Two Math"\/>/);
    expect(slide).toMatch(/baseline="36000"/);
    expect(slide).toContain('<a:latin typeface="STIX Two Text"/>');
  });
});

/** Every run of every label is drawn in the PDF where `measureLabel()` puts it (0.01pt). */
async function expectPdfMatchesMeasure(source: string): Promise<void> {
  const { svg, inspection } = await render(source);
  const pdf = svgToPdf(svg);
  if (!pdf.ok) throw new Error(JSON.stringify(pdf.diagnostics));
  const inspected = inspectPdf(pdf.value);
  const pageHeight = inspected.pages[0]?.mediaBox[3] ?? 0;
  const vb = inspection.canvas.viewBox;
  const lines = new Set(textLines(inspected.glyphs));
  let runs = 0;
  for (const element of inspection.elements) {
    for (const label of element.labels) {
      const measured = measureLabel(label, fonts as NonNullable<typeof fonts>);
      const boxes =
        measured.runs?.flat() ??
        measured.texts.map((text, i) => ({
          text,
          font: label.font,
          box: measured.lines[i] ?? { x: 0, width: 0 },
          baseline: label.anchor.y + i * label.lineHeightUnits,
        }));
      for (const run of boxes) {
        if (run.text.trim() === "") continue;
        runs++;
        const x0 = (run.box.x - vb.x) * 0.5;
        const baseline = pageHeight - (run.baseline - vb.y) * 0.5;
        const hit = [...lines].find(
          (l) =>
            l.text === run.text && Math.abs(l.x0 - x0) < 0.01 && Math.abs(l.y - baseline) < 0.01,
        );
        expect(hit, `"${run.text}" at x ${x0}, baseline ${baseline}`).toBeDefined();
        if (hit === undefined) continue;
        lines.delete(hit);
        expect(Math.abs(hit.x1 - hit.x0 - run.box.width * 0.5)).toBeLessThan(0.01);
        // In the run's own font (#112): the bundled files are named by their PostScript names.
        expect(hit.font.replace(/^[A-Z]{6}\+/, "")).toBe(
          basename(fontFileFor(run.font, fonts as NonNullable<typeof fonts>), ".ttf"),
        );
      }
    }
  }
  expect(runs).toBeGreaterThan(0);
  expect([...lines].map((l) => l.text)).toEqual([]);
}

describe("edge cases", () => {
  test("a figure whose labels are only math or only fallback characters renders", async () => {
    for (const label of ["'$x_1$'", '"₂"', "'$\\alpha$'"]) {
      const source = figure(`  - { id: a, component: box, label: ${label} }`, "", "[a]");
      const rendered = await render(source);
      expect(lintGeometry(rendered, { source })).toEqual([]);
      await expectPdfMatchesMeasure(source);
    }
  });

  test("blank lines and lines ending in scripts keep every later line in place", async () => {
    const source = figure(
      `  - { id: a, component: box, label: "text $x^1$\\n\\n$x_2$\\nend" }
  - { id: b, component: box, label: "$y_1$\\n\\n\\nlast $z^2$" }`,
    );
    const { svg } = await render(source);
    expect(svg).toMatch(/<tspan x="[\d.]+" y="[\d.]+"><\/tspan>/);
    await expectPdfMatchesMeasure(source);
  });

  test("the PDF draws math with measured advances (no contextual alternates or kerning)", async () => {
    await expectPdfMatchesMeasure(
      figure(`  - { id: a, component: box, label: 'text $ffiffiffiffi AV fl$' }`, "", "[a]"),
    );
  });

  test("deeply nested groups are a diagnostic, not a crash", () => {
    const label = `$${"{".repeat(20000)}x${"}".repeat(20000)}$`;
    const diagnostics = checkFigure(
      figure(`  - { id: a, component: box, label: '${label}' }`, "", "[a]"),
    ).state.diagnostics;
    expect(diagnostics.map((d) => d.code)).toEqual(["component/invalid-math"]);
    expect(diagnostics[0]?.message).toContain("nests more than 32 groups");
  });
});

describe("lint/missing-glyph (#86 §5.3)", () => {
  // The characters #86 §5.3 found missing or full-width in BIZ UDPGothic,
  // except subscript letters (ₐₑₒₓₜ: write $x_a$) and emoji (not text).
  const characters = "αβγδεθλμσφωΣΔΓΘΩ ₀₁₂₃₄₅₆₇₈₉ ⁰¹²³⁴⁵⁶⁷⁸⁹ ⊕⊗×·∼≈≤≥∑∏∈→↔⋯… 𝑥𝑦𝑡𝛼𝛽𝛾";
  const missing = (source: string) =>
    lintFigure(source).diagnostics.filter((d) => d.code === "lint/missing-glyph");

  test("no character is missing in a structured figure, in text or in math", () => {
    const source = figure(
      `  - { id: a, component: box, label: "${characters}" }
  - { id: b, component: box, label: '$\\alpha_2 \\gamma_1,\\beta_1 \\oplus\\otimes\\times\\cdot\\sim\\approx\\leq\\geq\\sum\\prod\\in\\to\\leftrightarrow\\cdots\\ldots x^2$' }`,
    );
    expect(missing(source)).toEqual([]);
  });

  test("subscript letters and emoji are still reported", () => {
    const diagnostics = missing(
      figure(`  - { id: a, component: box, label: "xₐ 🔥" }
  - { id: b, component: box, label: b }`),
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("regular and math fonts");
    expect(diagnostics[0]?.message).toContain("U+2090");
  });

  test("an auto figure still reports what D2 cannot draw", () => {
    const auto = `version: 1
figure: { id: math, theme: minimal, profile: paper-double }
nodes:
  - { id: a, component: box, label: "α₂" }
edges: []
`;
    expect(missing(auto).map((d) => d.message)).toEqual([
      expect.stringContaining('"₂" (U+2082)') as unknown as string,
    ]);
  });
});
