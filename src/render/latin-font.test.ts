/**
 * The Latin slots of a font set (#172, design doc §6.44) end to end: a
 * structured figure rendered with `sumi/inter-biz-ud-gothic` measures, embeds,
 * re-measures and exports its Latin text in Inter and its Japanese text in
 * BIZ UDPGothic. No built-in theme uses that font set yet (the paper theme,
 * #173, will), so the test renders the compiled figure with the font set
 * swapped in, as a theme choosing it would compile.
 */

import { describe, expect, test } from "bun:test";
import { basename } from "node:path";
import type { DiagramBackend } from "../backends/types";
import { compileFigure } from "../compiler/compile";
import { checkFigure } from "../core/check";
import { getTheme } from "../core/theme/builtin";
import {
  DEFAULT_FONT_SET_ID,
  type FontSet,
  fontSetArgs,
  getFontSet,
  LATIN_FONT_SET_ID,
} from "../core/theme/fonts";
import type { TextLayout } from "../layout/ir";
import { lintGeometry } from "../lint/geometry/lint";
import { fontFileFor, measureLabel } from "../lint/geometry/measure";
import { loadFontMetrics } from "../lint/metrics";
import { createLintContext } from "../lint/rule";
import { missingGlyph } from "../lint/rules/labels";
import { svgToPdf } from "./pdf";
import { readFontFace } from "./pdf/fonts";
import { inspectPdf, textLines } from "./pdf/testing";
import { svgToEditablePptx, svgToPptx } from "./pptx";
import { readPptx } from "./pptx/testing";
import { type RenderedStructuredFigure, renderCompiledFigure, renderFigure } from "./render";

const SOURCE = `version: 1
figure:
  id: latin-font
  theme: minimal
  profile: paper-single
  layout:
    arrange:
      stack: { gap: 6mm, items: [encoder, scale, marks] }
groups:
  - id: encoder
    label: Encoder Block
    arrange: { stack: { gap: 8mm, items: [attention, embedding] } }
nodes:
  - { id: attention, component: box, label: Multi-Head Attention, group: encoder }
  - { id: embedding, component: box, label: 入力 Embedding, group: encoder }
  - { id: scale, component: box, label: 'Scale $\\gamma_1$' }
  # Combining marks (#172 review): a base Inter lacks with a mark only Inter
  # has, and a base and mark both in Inter.
  - { id: marks, component: box, label: "か\\u0342 te\\u0301st" }
edges:
  - { from: embedding, to: attention, label: x2 }
`;

const fontSetOf = (id: string): FontSet => {
  const set = getFontSet(id);
  if (set === undefined) throw new Error(`no font set ${id}`);
  return set;
};
const latinSet = fontSetOf(LATIN_FONT_SET_ID);

const noD2: DiagramBackend = {
  name: "d2-cli",
  render: () => {
    throw new Error("a structured figure must not reach the D2 backend");
  },
};

/** Renders {@link SOURCE} with the given built-in font set in place of its theme's. */
async function renderWith(fontSet: FontSet, source = SOURCE): Promise<RenderedStructuredFigure> {
  const compiled = compileFigure(source);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics, null, 2));
  const { ir } = compiled.value;
  const swapped = {
    ...compiled.value,
    ir: { ...ir, meta: { ...ir.meta, fontSetId: fontSet.id } },
    fontSet: { id: fontSet.id, args: fontSetArgs(fontSet) },
  };
  const result = await renderCompiledFigure(
    source,
    { value: swapped, diagnostics: compiled.diagnostics },
    { backend: noD2 },
  );
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  return result.value as RenderedStructuredFigure;
}

let cached: RenderedStructuredFigure | undefined;
const rendered = async () => {
  cached ??= await renderWith(latinSet);
  return cached;
};

/** Every placed label of the layout by its first line. */
function layoutLabels(figure: RenderedStructuredFigure): Map<string, TextLayout> {
  const { layout } = figure;
  const labels = [
    ...layout.groups.map((g) => g.label),
    ...layout.nodes.map((n) => n.label),
    ...(layout.edges.map((e) => e.route?.label) ?? []),
  ].filter((l): l is TextLayout => l !== undefined);
  return new Map(labels.map((l) => [l.lines.join("\n"), l]));
}

/** The family, weight and font class of each `@font-face` subset in the SVG. */
function embeddedFaces(svg: string): Map<string, { family: string; weight: number }> {
  const faces = new Map<string, { family: string; weight: number }>();
  for (const match of svg.matchAll(
    /font-family: sumi-\d+-font-([a-z-]+);\s*src: url\("data:font\/ttf;base64,([^"]+)"\)/g,
  )) {
    const face = readFontFace(new Uint8Array(Buffer.from(match[2] ?? "", "base64")));
    faces.set(match[1] ?? "", { family: face.family, weight: face.weight });
  }
  return faces;
}

describe("the Latin font slots (#172)", () => {
  test("layout: Latin text is measured in Inter, Japanese text in BIZ UDPGothic", async () => {
    const labels = layoutLabels(await rendered());
    const inter = loadFontMetrics(fontFileFor("latin", latinSet));
    const interBold = loadFontMetrics(fontFileFor("latin-bold", latinSet));
    const attention = labels.get("Multi-Head Attention");
    expect(attention?.font).toBe("latin");
    expect(attention?.runs).toBeUndefined();
    expect(attention?.width).toBeCloseTo(
      inter.measureEm("Multi-Head Attention") * (attention?.fontSizeUnits ?? 0),
      9,
    );
    // The group's label is bold.
    const group = labels.get("Encoder Block");
    expect(group?.font).toBe("latin-bold");
    expect(group?.width).toBeCloseTo(
      interBold.measureEm("Encoder Block") * (group?.fontSizeUnits ?? 0),
      9,
    );
    expect(labels.get("x2")?.font).toBe("latin");
    expect(
      labels.get("入力 Embedding")?.runs?.map((line) => line.map((r) => [r.text, r.font])),
    ).toEqual([
      [
        ["入力", "regular"],
        [" Embedding", "latin"],
      ],
    ]);
    // Label math keeps the math fonts; the text around it is Latin.
    expect(labels.get("Scale γ1")?.runs?.[0]?.map((r) => r.font)).toEqual([
      "latin",
      "math-italic",
      "math",
    ]);
  });

  test("SVG: the @font-face subsets are Inter for the Latin classes", async () => {
    const { svg } = await rendered();
    const faces = embeddedFaces(svg);
    expect(faces.get("latin")).toEqual({ family: "Inter", weight: 400 });
    expect(faces.get("latin-bold")).toEqual({ family: "Inter", weight: 700 });
    expect(faces.get("regular")?.family).toBe("BIZ UDPGothic");
    expect(svg).toContain('class="text-latin"');
  });

  test("geometry lint re-measures the drawn labels exactly as laid out, and finds nothing", async () => {
    const figure = await rendered();
    const labels = layoutLabels(figure);
    let compared = 0;
    for (const element of figure.inspection.elements) {
      for (const label of element.labels) {
        const measured = measureLabel(label, latinSet);
        const laid = labels.get(measured.texts.join("\n"));
        if (laid === undefined) continue;
        expect(measured.lines.map((l) => l.width)).toEqual(
          laid.lineWidths.map((w) => expect.closeTo(w, 9)),
        );
        compared++;
      }
    }
    expect(compared).toBe(6);
    expect(lintGeometry(figure, { source: SOURCE })).toEqual([]);
  });

  test("PDF: each piece of text is drawn in the font it was measured with, at its width", async () => {
    const figure = await rendered();
    const pdf = svgToPdf(figure.svg);
    if (!pdf.ok) throw new Error(JSON.stringify(pdf.diagnostics));
    const inspected = inspectPdf(pdf.value);
    const fonts = inspected.fonts.map((f) => f.baseFont.replace(/^[A-Z]{6}\+/, "")).sort();
    expect(fonts).toEqual([
      "BIZUDPGothic-Regular",
      "Inter-Bold",
      "Inter-Regular",
      "STIXTwoMath-Regular",
      "STIXTwoText-Italic",
    ]);
    expect(inspected.fonts.every((f) => f.embedded && f.subset)).toBe(true);
    const lines = textLines(inspected.glyphs);
    for (const [text, font, file] of [
      ["Multi-Head Attention", "latin", "Inter-Regular"],
      ["Encoder Block", "latin-bold", "Inter-Bold"],
      ["入力", "regular", "BIZUDPGothic-Regular"],
      ["Embedding", "latin", "Inter-Regular"],
    ] as const) {
      const line = lines.find((l) => l.text.trim() === text);
      expect(line?.font.replace(/^[A-Z]{6}\+/, "")).toBe(file);
      expect(basename(fontFileFor(font, latinSet), ".ttf")).toBe(file);
      // As wide as measured (no kerning or shaping), in ems of the line's size.
      const width = loadFontMetrics(fontFileFor(font, latinSet)).measureEm(line?.text ?? "");
      expect(((line?.x1 ?? 0) - (line?.x0 ?? 0)) / (line?.size ?? 1)).toBeCloseTo(width, 3);
    }
    // Every glyph of the mixed label is where the lint measured it, the space
    // before "Embedding" included (usvg dropped it after a text node).
    const label = figure.inspection.elements
      .flatMap((e) => e.labels)
      .find((l) => l.text === "入力 Embedding");
    if (label === undefined) throw new Error("no mixed label");
    const runs = measureLabel(label, latinSet).runs?.[0] ?? [];
    expect(runs.map((r) => [r.text, r.font])).toEqual([
      ["入力", "regular"],
      [" Embedding", "latin"],
    ]);
    const vb = figure.inspection.canvas.viewBox;
    const scale = (inspected.pages[0]?.mediaBox[2] ?? 0) / vb.width;
    // The label's glyphs: on its baseline (PDF y is up from the page's bottom).
    const baseline = (inspected.pages[0]?.mediaBox[3] ?? 0) - (label.anchor.y - vb.y) * scale;
    const glyphX = (char: string) =>
      inspected.glyphs.find((g) => g.text === char && Math.abs(g.y - baseline) < 0.01)?.x ??
      Number.NaN;
    const inter = loadFontMetrics(fontFileFor("latin", latinSet));
    const space = (inter.advanceOf(0x20) / inter.unitsPerEm) * label.fontSizeUnits;
    expect(glyphX("入")).toBeCloseTo(((runs[0]?.x ?? 0) - vb.x) * scale, 2);
    expect(glyphX("E")).toBeCloseTo(((runs[1]?.x ?? 0) + space - vb.x) * scale, 2);
  });

  test("a base and its combining marks stay in one font, in the layout and in the PDF", async () => {
    const figure = await rendered();
    const label = figure.inspection.elements
      .flatMap((e) => e.labels)
      .find((l) => l.text === "か͂ tést");
    if (label === undefined) throw new Error("no label with marks");
    // `か` + U+0342 (only Inter has the mark, Inter lacks `か`): the cluster
    // stays in BIZ UDPGothic (lint/missing-glyph reports the mark); `é` as
    // `e` + U+0301 is wholly in Inter.
    const runs = measureLabel(label, latinSet).runs?.[0] ?? [];
    expect(runs.map((r) => [r.text, r.font])).toEqual([
      ["か͂", "regular"],
      [" tést", "latin"],
    ]);
    const pdf = svgToPdf(figure.svg);
    if (!pdf.ok) throw new Error(JSON.stringify(pdf.diagnostics));
    const inspected = inspectPdf(pdf.value);
    const vb = figure.inspection.canvas.viewBox;
    const scale = (inspected.pages[0]?.mediaBox[2] ?? 0) / vb.width;
    const baseline = (inspected.pages[0]?.mediaBox[3] ?? 0) - (label.anchor.y - vb.y) * scale;
    const glyphs = inspected.glyphs.filter((g) => Math.abs(g.y - baseline) < 0.01);
    const font = (g: { font: string } | undefined) => g?.font.replace(/^[A-Z]{6}\+/, "");
    // The cluster `か` + U+0342 is drawn as one glyph cluster of BIZ UDPGothic
    // (its missing mark as .notdef, which lint/missing-glyph reports; where a
    // missing glyph is drawn is up to the renderer). No copy of Inter takes
    // it over with blank glyphs (#112), which made the whole cluster vanish.
    expect(font(glyphs[0])).toBe("BIZUDPGothic-Regular");
    expect(glyphs[0]?.text.trim()).not.toBe("");
    // `e` + U+0301 is drawn by Inter with its mark, at Inter's advances.
    expect(glyphs.slice(1).map((g) => [g.text.normalize("NFC"), font(g)])).toEqual(
      [..." t\u00e9st"].map((c) => [c, "Inter-Regular"]),
    );
    const last = glyphs.at(-1);
    expect((last?.x ?? 0) + (last?.advance ?? 0) - (glyphs[1]?.x ?? 0)).toBeCloseTo(
      (runs[1]?.width ?? 0) * scale,
      2,
    );
  });

  test("a variation selector the font lacks keeps the PDF's fonts as laid out", async () => {
    // `漢` + U+E0100 (a variation selector BIZ UDPGothic does not map, which
    // draws nothing): the layout keeps `漢` in BIZ UDPGothic and " test" in
    // Inter; the PDF used to treat the selector as a missing glyph and draw
    // the whole label in BIZ UDPGothic.
    const source = `version: 1
figure: { id: vs, theme: minimal, layout: { arrange: { stack: { items: [n] } } } }
nodes:
  - { id: n, component: box, label: "漢\\U000E0100 test" }
`;
    const figure = await renderWith(latinSet, source);
    const label = figure.inspection.elements.flatMap((e) => e.labels)[0];
    if (label === undefined) throw new Error("no label");
    const runs = measureLabel(label, latinSet).runs?.[0] ?? [];
    expect(runs.map((r) => [r.text, r.font])).toEqual([
      ["漢\u{E0100}", "regular"],
      [" test", "latin"],
    ]);
    const pdf = svgToPdf(figure.svg);
    if (!pdf.ok) throw new Error(JSON.stringify(pdf.diagnostics));
    const inspected = inspectPdf(pdf.value);
    const scale = (inspected.pages[0]?.mediaBox[2] ?? 0) / figure.inspection.canvas.viewBox.width;
    const font = (char: string) =>
      inspected.glyphs.find((g) => g.text.startsWith(char))?.font.replace(/^[A-Z]{6}\+/, "");
    expect(font("漢")).toBe("BIZUDPGothic-Regular");
    for (const char of "test") expect(font(char)).toBe("Inter-Regular");
    // " test" is where the lint measured it (Inter's advances).
    const t = inspected.glyphs.find((g) => g.text === "t");
    const inter = loadFontMetrics(fontFileFor("latin", latinSet));
    const space = (inter.advanceOf(0x20) / inter.unitsPerEm) * label.fontSizeUnits;
    expect(t?.x).toBeCloseTo(
      ((runs[1]?.x ?? 0) + space - figure.inspection.canvas.viewBox.x) * scale,
      2,
    );
  });

  test("picture and editable PPTX use the same fonts", async () => {
    const figure = await rendered();
    const picture = svgToPptx(figure.svg);
    expect(picture.ok).toBe(true);
    const editable = svgToEditablePptx(figure.svg, figure.compiled.ir);
    if (!editable.ok) throw new Error(JSON.stringify(editable.diagnostics));
    const slide = new TextDecoder().decode(readPptx(editable.value).get("ppt/slides/slide1.xml"));
    const typeface = (text: string) =>
      new RegExp(`<a:latin typeface="([^"]+)"/>[^]*?<a:t xml:space="preserve">${text}</a:t>`).exec(
        slide.slice(slide.lastIndexOf("<a:r>", slide.indexOf(`>${text}</a:t>`))),
      )?.[1];
    expect(typeface("Multi-Head Attention")).toBe("Inter");
    expect(typeface("Encoder Block")).toBe("Inter");
    expect(typeface("入力")).toBe("BIZ UDPGothic");
    expect(typeface(" Embedding")).toBe("Inter");
  });

  test("the default font set draws the same figure without Inter, as before", async () => {
    const figure = await renderWith(fontSetOf(DEFAULT_FONT_SET_ID));
    expect(figure.svg).not.toContain("text-latin");
    expect(figure.svg).not.toContain("font-latin");
    expect([...embeddedFaces(figure.svg).values()].map((f) => f.family)).not.toContain("Inter");
    // Rendering through the theme gives the same bytes.
    const direct = await renderFigure(SOURCE, { backend: noD2 });
    if (!direct.ok) throw new Error(JSON.stringify(direct.diagnostics));
    expect(direct.value.svg).toBe(figure.svg);
  });

  test("lint/missing-glyph checks Latin text against Inter and Japanese text against BIZ UDPGothic", () => {
    const source = `version: 1
figure: { id: glyphs, layout: { arrange: { stack: { items: [a, b, c] } } } }
nodes:
  - { id: a, component: box, label: Attention 入力 → x₂ }
  - { id: b, component: box, label: Fire 🔥 }
  - { id: c, component: box, label: "か\\u0342 te\\u0301st" }
`;
    const check = checkFigure(source);
    const minimal = getTheme("minimal");
    if (minimal === undefined) throw new Error("no minimal theme");
    const findings = missingGlyph.run(
      createLintContext(check.state, { ...minimal, fontSet: latinSet }),
      undefined,
    );
    expect(findings.map((f) => f.message)).toEqual([
      `The label of node "b" has a character missing from the regular, Latin and math fonts of font set ${LATIN_FONT_SET_ID}: "🔥" (U+1F525).`,
      // The mark is in Inter, but its base \`か\` is not: the cluster stays in BIZ UDPGothic.
      `The label of node "c" has a character missing from the regular, Latin and math fonts of font set ${LATIN_FONT_SET_ID}: "\u0342" (U+0342).`,
    ]);
  });
});

describe("a run after a text node that starts with a space (all font sets)", () => {
  test("the default font set keeps the space of `a$_\\text{ b}$` in the PDF", async () => {
    // A subscript run in the label's font that starts with a space, right
    // after the text `a`: usvg dropped that space when `a` was a bare text
    // node, so the writer wraps `a` in a <tspan> of its own.
    const source = `version: 1
figure: { id: ws, theme: minimal, layout: { arrange: { stack: { items: [n] } } } }
nodes:
  - { id: n, component: box, label: 'a$_\\text{ b}$' }
`;
    const result = await renderFigure(source, { backend: noD2 });
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const { svg, inspection } = result.value;
    expect(svg).toMatch(
      /<tspan>a<\/tspan><tspan style="font-size:[\d.]+px" dy="[\d.]+"> b<\/tspan>/,
    );
    const label = inspection.elements.flatMap((e) => e.labels).find((l) => l.text === "a b");
    if (label === undefined) throw new Error("no label");
    const runs = measureLabel(label, fontSetOf(DEFAULT_FONT_SET_ID)).runs?.[0] ?? [];
    expect(runs.map((r) => r.text)).toEqual(["a", " b"]);
    const pdf = svgToPdf(svg);
    if (!pdf.ok) throw new Error(JSON.stringify(pdf.diagnostics));
    const inspected = inspectPdf(pdf.value);
    const scale = (inspected.pages[0]?.mediaBox[2] ?? 0) / inspection.canvas.viewBox.width;
    const b = inspected.glyphs.find((g) => g.text === "b");
    // `b` starts after the space, where the lint measured it.
    const regular = loadFontMetrics(fontSetOf(DEFAULT_FONT_SET_ID).regular);
    const space = (regular.advanceOf(0x20) / regular.unitsPerEm) * (runs[1]?.fontSizeUnits ?? 0);
    expect(b?.x).toBeCloseTo(((runs[1]?.x ?? 0) + space - inspection.canvas.viewBox.x) * scale, 2);
  });
});
