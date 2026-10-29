import { describe, expect, test } from "bun:test";
import { checkFigure } from "../core/check";
import { parseLabel } from "../core/label/math";
import { BUILTIN_THEMES } from "../core/theme/builtin";
import { getFontSet } from "../core/theme/fonts";
import { measureLabel } from "../lint/geometry/measure";
import { svgToPdf } from "./pdf";
import { inspectPdf } from "./pdf/testing";
import { svgToEditablePptx, svgToPptx } from "./pptx";
import { readPptx } from "./pptx/testing";
import { type RenderedStructuredFigure, renderFigure } from "./render";

const source = (label: string, fields = "", theme = "paper") => `version: 1
figure:
  id: color-spans
  theme: ${theme}
  profile: paper-double
  layout:
    arrange: { stack: { items: [a] } }
nodes:
  - id: a
    component: box
    label: ${JSON.stringify(label)}
    ${fields}
edges: []
`;
async function render(yaml: string) {
  const result = await renderFigure(yaml);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.value as RenderedStructuredFigure;
}
const prompt = String.raw`The character $\textcolor{orange}{\text{\{stands still\}}}$, camera $\textcolor{blue}{\text{\{holds steady\}}}$`;

describe("structured text colors (#186)", () => {
  test("tone boundaries survive merging, font fallback, nested colors, scripts and accents", async () => {
    const parsed = parseLabel(String.raw`$\textcolor{orange}{x_i+\textcolor{blue}{\hat y}}$`);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(
      parsed.value.lines[0]?.filter((r) => r.text.trim()).map((r) => [r.text.trim(), r.tone]),
    ).toEqual([
      ["x", "orange"],
      ["i", "orange"],
      ["+", "orange"],
      ["y", "blue"],
    ]);
    const rendered = await render(
      source("$\\textcolor{orange}{\\text{入力ABC}}\\textcolor{blue}{\\text{XYZ}}$"),
    );
    const runs = rendered.inspection.elements[0]?.labels[0]?.runs?.flat() ?? [];
    expect(runs.map((r) => r.text).join("")).toBe("入力ABCXYZ");
    expect(runs.filter((r) => r.text.includes("XYZ"))[0]?.fill).toBe(
      BUILTIN_THEMES.get("paper")?.toneLines.get("blue")?.fontColor,
    );
    expect(
      runs
        .filter((r) => !r.text.includes("XYZ"))
        .every((r) => r.fill === BUILTIN_THEMES.get("paper")?.toneLines.get("orange")?.fontColor),
    ).toBe(true);
  });

  test("SVG, PDF glyphs and editable PPTX keep each theme's toneLines text colors", async () => {
    for (const [id, theme] of BUILTIN_THEMES) {
      const rendered = await render(source(prompt, "textAlign: left", id));
      const expected = (tone: "orange" | "blue") => theme.toneLines.get(tone)?.fontColor ?? "";
      const runs = rendered.inspection.elements[0]?.labels[0]?.runs?.flat() ?? [];
      expect(runs.find((r) => r.text.includes("stands still"))?.fill).toBe(expected("orange"));
      expect(runs.find((r) => r.text.includes("holds steady"))?.fill).toBe(expected("blue"));
      const pdf = svgToPdf(rendered.svg);
      expect(pdf.ok).toBe(true);
      if (!pdf.ok) continue;
      const glyphs = inspectPdf(pdf.value).glyphs;
      expect(glyphs.map((g) => g.text).join("")).toBe(
        "The character {stands still}, camera {holds steady}",
      );
      for (const [phrase, tone] of [
        ["{stands still}", "orange"],
        ["{holds steady}", "blue"],
      ] as const) {
        const start = glyphs
          .map((g) => g.text)
          .join("")
          .indexOf(phrase);
        const rgb =
          expected(tone)
            .slice(1)
            .match(/../g)
            ?.map((c) => Number.parseInt(c, 16) / 255) ?? [];
        for (const glyph of glyphs.slice(start, start + phrase.length)) {
          expect(glyph.color?.length).toBe(3);
          for (let c = 0; c < 3; c++) expect(glyph.color?.[c]).toBeCloseTo(rgb[c] ?? -1, 3);
        }
      }
      const pptx = svgToEditablePptx(rendered.svg, rendered.compiled.ir);
      expect(pptx.ok).toBe(true);
      if (pptx.ok) {
        const xml = new TextDecoder().decode(readPptx(pptx.value).get("ppt/slides/slide1.xml"));
        expect(xml).toContain('algn="l"');
        for (const tone of ["orange", "blue"] as const)
          expect(xml).toContain(`val="${expected(tone).slice(1).toUpperCase()}"`);
        expect(xml).toContain("{stands still}");
        expect(xml).toContain("{holds steady}");
      }
      expect(svgToPptx(rendered.svg).ok).toBe(true);
    }
  });

  test("literal text and auto math retain their existing behavior", () => {
    expect(parseLabel(String.raw`literal \textcolor{orange}{text}`)).toEqual({
      ok: true,
      value: {
        hasMath: false,
        lines: [
          [{ text: String.raw`literal \textcolor{orange}{text}`, font: "text", script: "base" }],
        ],
      },
    });
    const escaped = parseLabel(String.raw`$\text{\\textcolor{orange}{literal}}$`);
    expect(escaped.ok && escaped.value.lines[0]?.[0]?.text).toBe(
      String.raw`\textcolor{orange}{literal}`,
    );
    expect(parseLabel(String.raw`$\text{\textcolor{orange}{literal}}$`).ok).toBe(false);
    const auto = source(prompt).replace("  layout:\n    arrange: { stack: { items: [a] } }\n", "");
    expect(checkFigure(auto).state.diagnostics.map((d) => [d.code, d.severity])).toEqual([
      ["component/unsupported-in-auto", "warning"],
    ]);
  });

  test("malformed colors use invalid-math and alignment is structured-only", () => {
    for (const label of [
      String.raw`$\textcolor{#ff0000}{x}$`,
      String.raw`$\textcolor{unknown}{x}$`,
      String.raw`$\textcolor{orange}x$`,
      String.raw`$\textcolor{orange}{x$`,
    ]) {
      expect(checkFigure(source(label)).state.diagnostics.map((d) => d.code)).toEqual([
        "component/invalid-math",
      ]);
    }
    const auto = source("Plain", "textAlign: left").replace(
      "  layout:\n    arrange: { stack: { items: [a] } }\n",
      "",
    );
    expect(checkFigure(auto).state.diagnostics.map((d) => [d.code, d.path])).toEqual([
      ["layout/structured-only", ["nodes", 0, "textAlign"]],
    ]);
    expect(checkFigure(source("Plain", "textAlign: justify")).state.diagnostics[0]?.code).toBe(
      "schema/invalid-value",
    );
  });

  test("left/right alignment, with sublabels and turned accent chunks, measures correctly", async () => {
    for (const align of ["left", "right"] as const) {
      for (const rotation of [undefined, 90, -90]) {
        for (const label of [
          "A long first line\nshort",
          String.raw`$\textcolor{orange}{\hat x_i}+y$`,
        ]) {
          const rendered = await render(
            source(
              label,
              `textAlign: ${align}\n    sublabel: 'small'${rotation === undefined ? "" : `\n    labelRotation: ${rotation}`}`,
            ),
          );
          const fonts = getFontSet(rendered.compiled.fontSet.id);
          if (!fonts) throw new Error("missing fonts");
          for (const inspected of rendered.inspection.elements[0]?.labels ?? []) {
            expect(inspected.textAlign).toBe(align);
            const measured = measureLabel(inspected, fonts);
            expect(measured.box).toBeDefined();
            if (rotation === undefined) {
              for (const line of measured.lines) {
                expect(align === "left" ? line.x : line.x + line.width).toBeCloseTo(
                  inspected.anchor.x,
                  4,
                );
              }
            }
          }
          expect(svgToEditablePptx(rendered.svg, rendered.compiled.ir).ok).toBe(true);
        }
      }
    }
  });

  test("omitting alignment and explicit center give identical SVG", async () => {
    const drawing = (svg: string) => svg.replace(/input-sha256="[^"]*"/, "");
    expect(drawing((await render(source(prompt))).svg)).toBe(
      drawing((await render(source(prompt, "textAlign: center"))).svg),
    );
  });

  test("inherited dim overrides colored label, sublabel and internal edge runs", async () => {
    const yaml = `version: 1
figure:
  id: dim-colors
  theme: paper
  profile: paper-double
  layout: { arrange: { stack: { items: [g] } } }
groups:
  - id: g
    dim: true
    label: '$\\textcolor{orange}{G}$'
    arrange: { stack: { gap: 8mm, items: [a, b] } }
nodes:
  - { id: a, component: box, label: '$\\textcolor{orange}{A}$', sublabel: '$\\textcolor{blue}{a}$' }
  - { id: b, component: box, label: '$\\textcolor{blue}{B}$' }
edges:
  - { from: a, to: b, label: '$\\textcolor{orange}{e}$' }
`;
    const rendered = await render(yaml);
    const fills = rendered.inspection.elements.flatMap((e) =>
      e.labels.flatMap((l) => l.runs?.flat().map((r) => r.fill) ?? []),
    );
    expect(fills.length).toBe(5);
    expect(fills.every((fill) => fill === BUILTIN_THEMES.get("paper")?.dim?.fontColor)).toBe(true);
  });
});
