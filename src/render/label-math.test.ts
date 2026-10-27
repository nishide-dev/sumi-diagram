/**
 * Label math end to end (#93): the component stage's diagnostics and their
 * positions, layout → SVG → inspection with per-run geometry, the geometry
 * and structural lint, text extraction from the PDF, and the editable PPTX.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { checkFigure } from "../core/check";
import { ACCENT_COMMANDS } from "../core/label/symbols";
import { DEFAULT_FONT_SET_ID, getFontSet } from "../core/theme/fonts";
import { lintFigure } from "../lint";
import { parseGlyphCoverage } from "../lint/cmap";
import { lintGeometry } from "../lint/geometry";
import { fontFileFor, measureLabel } from "../lint/geometry/measure";
import { readTables } from "../lint/sfnt";
import { COMBINING_MARKS, inspectSvg } from "./inspect";
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
      const measuredRuns =
        measured.runs?.flat() ??
        measured.texts.map((text, i) => ({
          text,
          font: label.font,
          fontSizeUnits: label.fontSizeUnits,
          x: measured.lines[i]?.x ?? 0,
          width: measured.lines[i]?.width ?? 0,
          baseline: label.anchor.y + i * label.lineHeightUnits,
        }));
      // Expected runs that the PDF reader's `textLines()` joins into one line
      // (same font and size, same baseline, the next starting where the last
      // ends; #129: an accented base right after other math of its font) are
      // compared as one: text, origin, advance and font.
      const expected: typeof measuredRuns = [];
      for (const run of measuredRuns) {
        const last = expected.at(-1);
        const sizePt = run.fontSizeUnits * 0.5;
        if (
          last !== undefined &&
          last.font === run.font &&
          last.fontSizeUnits === run.fontSizeUnits &&
          Math.abs(last.baseline - run.baseline) * 0.5 < 0.01 &&
          Math.abs(last.x + last.width - run.x) * 0.5 < Math.max(0.01, sizePt * 0.05)
        ) {
          expected[expected.length - 1] = {
            ...last,
            text: last.text + run.text,
            width: run.x + run.width - last.x,
          };
        } else expected.push(run);
      }
      for (const run of expected) {
        const x0 = (run.x - vb.x) * 0.5;
        const baseline = pageHeight - (run.baseline - vb.y) * 0.5;
        const hit = [...lines].find(
          (l) =>
            l.text === run.text && Math.abs(l.x0 - x0) < 0.01 && Math.abs(l.y - baseline) < 0.01,
        );
        // Spaces alone (after an accent, #129, at a chunk's end): drawn, or not.
        if (run.text.trim() === "" && hit === undefined) continue;
        if (run.text.trim() !== "") runs++;
        expect(hit, `"${run.text}" at x ${x0}, baseline ${baseline}`).toBeDefined();
        if (hit === undefined) continue;
        lines.delete(hit);
        expect(Math.abs(hit.x1 - hit.x0 - run.width * 0.5)).toBeLessThan(0.01);
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

/** A glyph's outline box and the font's italic angle, read here from `glyf` / `post` directly. */
function outline(file: string, char: string) {
  const bytes = new Uint8Array(readFileSync(file));
  const tables = readTables(bytes);
  const glyph = parseGlyphCoverage(bytes).glyph(char.codePointAt(0) ?? 0);
  const long = tables.require("head").i16(50) === 1;
  const loca = tables.require("loca");
  const glyf = tables.require("glyf");
  const at = long ? loca.u32(glyph * 4) : loca.u16(glyph * 2) * 2;
  return {
    unitsPerEm: tables.require("head").u16(18),
    italicAngle: (tables.require("post").u32(4) | 0) / 65536,
    xMin: glyf.i16(at + 2),
    yMin: glyf.i16(at + 4),
    xMax: glyf.i16(at + 6),
    yMax: glyf.i16(at + 8),
  };
}

/** The six accents over a lowercase, an uppercase, a Greek letter, a subscripted base and a Math symbol. */
const ACCENTS = figure(
  [...ACCENT_COMMANDS.keys()]
    .map(
      (name, i) =>
        `  - { id: a${i}, component: box, label: '$\\${name} y + \\${name}{W}\\, \\${name}\\theta \\${name}\\theta_t = \\${name}\\nabla$ と $\\${name} x$' }`,
    )
    .join("\n"),
  "",
  `[${[...ACCENT_COMMANDS.keys()].map((_, i) => `a${i}`).join(", ")}]`,
);

describe("accents (#129)", () => {
  test("each mark is centered over its base's outline, slanted, 0.04em above it", async () => {
    const rendered = await render(ACCENTS);
    const vb = rendered.inspection.canvas.viewBox;
    let marks = 0;
    for (const element of rendered.inspection.elements) {
      const label = element.labels[0];
      if (label === undefined) throw new Error("no label");
      const runs = measureLabel(label, fonts).runs?.flat() ?? [];
      for (const [j, run] of runs.entries()) {
        if (!COMBINING_MARKS.test(run.text)) continue;
        marks++;
        const base = runs[j - 1];
        if (base === undefined) throw new Error("no base");
        expect(run.font).toBe(base.font);
        expect(run.fontSizeUnits).toBe(base.fontSizeUnits);
        const file = fontFileFor(base.font, fonts);
        const b = outline(file, base.text);
        const m = outline(file, run.text);
        const s = base.fontSizeUnits / b.unitsPerEm;
        const slant = Math.tan((-b.italicAngle * Math.PI) / 180);
        const center = base.x + ((b.xMin + b.xMax) / 2 + (slant * (b.yMax - b.yMin)) / 2) * s;
        expect(run.x).toBeCloseTo(center - ((m.xMin + m.xMax) / 2) * s, 5);
        // The mark's bottom is 0.04em above the base's top.
        const top = base.baseline - b.yMax * s;
        expect(run.baseline - m.yMin * s).toBeCloseTo(top - 0.04 * base.fontSizeUnits, 5);
        expect(run.box.y + run.box.height).toBeCloseTo(top - 0.04 * base.fontSizeUnits, 5);
        expect(run.box.x).toBeGreaterThanOrEqual(vb.x);
      }
    }
    // 6 accents × (y, W, θ, θ_t, ∇, x).
    expect(marks).toBe(36);
    expect(lintGeometry(rendered, { source: ACCENTS })).toEqual([]);
    expect((await render(ACCENTS)).svg).toBe(rendered.svg);
  });

  test("only lines with accents are chunks, none starting with a space", async () => {
    const source = figure(
      `  - { id: a, component: box, label: "plain $x_1$\\n予測 $\\\\hat y$ と $\\\\bar x$\\nlast" }`,
      "",
      "[a]",
    );
    const { svg, layout, inspection } = await render(source);
    // The inspection reads the chunks back as one line.
    const label = inspection.elements[0]?.labels[0];
    expect(label?.text).toBe(layout.nodes[0]?.label?.lines.join("\n"));
    expect(label?.lines).toBe(3);
    expect(label?.runs?.[1]?.map((r) => [r.text, r.chunkX !== undefined, r.accent])).toEqual([
      ["予測 ", true, undefined],
      ["y", false, undefined],
      ["̂", true, true],
      [" ", false, undefined],
      ["と ", true, undefined],
      ["x", false, undefined],
      ["̄", true, true],
    ]);
    const text = /<text [^>]*>(.*?)<\/text>/.exec(svg)?.[1] ?? "";
    const spans = [...text.matchAll(/<tspan x="([\d.]+)" y="([\d.]+)">/g)];
    const anchor = layout.nodes[0]?.label?.anchor;
    // Lines 1 and 3: one tspan at the anchor; line 2: four chunks.
    expect(spans.map((s) => s[1] === String(anchor?.x))).toEqual([
      true,
      false,
      false,
      false,
      false,
      true,
    ]);
    const chunks = text.split(/<tspan x="[\d.]+" y="[\d.]+">/).slice(1);
    for (const chunk of chunks) expect(chunk.replace(/<[^>]*>/g, "")).not.toMatch(/^\s/);
    expect(chunks.map((c) => c.replace(/<[^>]*>/g, ""))).toEqual([
      "plain x1",
      "予測 y",
      "̂ ",
      "と x",
      "̄",
      "last",
    ]);
    // Whitespace-only runs after an accent (another font) do not let the next chunk start with a space.
    const spaced = figure(
      `  - { id: a, component: box, label: '$\\hat y\\,$ と $x$' }
  - { id: b, component: box, label: '$\\hat\\nabla\\; = x$' }`,
    );
    const drawn = (await render(spaced)).svg;
    const texts = [...drawn.matchAll(/<text [^>]*>(.*?)<\/text>/g)].map((m) =>
      (m[1] ?? "")
        .split(/<tspan x="[\d.]+" y="[\d.]+">/)
        .slice(1)
        .map((c) => c.replace(/<[^>]*>/g, "")),
    );
    expect(texts).toEqual([
      ["y", "̂  ", "と x"],
      ["∇", "̂  ", "= x"],
    ]);
    await expectPdfMatchesMeasure(spaced);
  });

  test("the PDF draws each mark where measured, after its base in reading order", async () => {
    await expectPdfMatchesMeasure(ACCENTS);
    const { svg } = await render(ACCENTS);
    const pdf = svgToPdf(svg);
    if (!pdf.ok) throw new Error(JSON.stringify(pdf.diagnostics));
    const text = inspectPdf(pdf.value)
      .glyphs.map((g) => g.text)
      .join("");
    // Decomposed: each base, then its combining mark.
    for (const mark of ACCENT_COMMANDS.values()) {
      expect(text).toContain(`y${mark} + W${mark} θ${mark}θ${mark}t = ∇${mark} と x${mark}`);
    }
  });

  test("the editable PPTX keeps each mark with its base", async () => {
    const { svg, compiled } = await render(ACCENTS);
    const editable = svgToEditablePptx(svg, compiled.ir);
    if (!editable.ok) throw new Error(JSON.stringify(editable.diagnostics));
    const slide = new TextDecoder().decode(readPptx(editable.value).get("ppt/slides/slide1.xml"));
    for (const mark of ACCENT_COMMANDS.values()) {
      expect(slide).toContain(`<a:t xml:space="preserve">y${mark}</a:t>`);
      expect(slide).toContain(`<a:t xml:space="preserve">∇${mark}</a:t>`);
    }
    // A mark is never a run of its own (nor raised by a baseline offset).
    expect(slide).not.toMatch(/<a:t xml:space="preserve">\p{M}/u);
  });

  test("accents need math fonts that have them; lint/missing-glyph stays quiet", () => {
    const result = lintFigure(ACCENTS);
    expect(result.diagnostics.filter((d) => d.code === "lint/missing-glyph")).toEqual([]);
  });

  test("a multi-character argument or a wide accent is a positioned error", () => {
    const source = figure(
      `  - { id: a, component: box, label: '$\\hat{xy}$' }
  - { id: b, component: box, label: '$\\widehat{y}$' }`,
    );
    const diagnostics = checkFigure(source).state.diagnostics;
    expect(diagnostics.map((d) => d.code)).toEqual([
      "component/invalid-math",
      "component/invalid-math",
    ]);
    const lines = source.split("\n");
    const row = lines.findIndex((l) => l.includes("{xy}"));
    expect(diagnostics[0]?.location).toMatchObject({
      line: row + 1,
      column: (lines[row] ?? "").indexOf("{xy}") + 1,
      endColumn: (lines[row] ?? "").indexOf("{xy}") + 5,
    });
    expect(diagnostics[1]?.location).toMatchObject({
      line: row + 2,
      column: (lines[row + 1] ?? "").indexOf("\\widehat") + 1,
    });
  });
});

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
