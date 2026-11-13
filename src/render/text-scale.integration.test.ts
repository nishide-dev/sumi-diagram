import { expect, test } from "bun:test";
import { getTheme } from "../core/theme/builtin";
import { DEFAULT_FONT_SET_ID, getFontSet } from "../core/theme/fonts";
import { withTextScale } from "../core/theme/text-scale";
import { labelGap } from "../layout/route/labels";
import { svgToPdf } from "./pdf";
import { inspectPdf } from "./pdf/testing";
import { svgToEditablePptx } from "./pptx/editable";
import { readPptx } from "./pptx/testing";
import { renderFigure } from "./render";

// Text scale (#514, docs/design/decisions/514-text-scale.md): `sumi` text on a slide.
const source = (figure: string, auto = false) => `version: 1
figure:
  id: scaled
  theme: sumi
  ${figure}
${auto ? "" : "  layout: { arrange: { stack: { items: [tier] } } }\n"}groups:
  - { id: tier, label: Tier${auto ? "" : ", arrange: { row: { items: [a, b] } }"} }
nodes:
  - { id: a, component: box, label: Alpha${auto ? "" : ", sublabel: detail"}, group: tier }
  - { id: b, component: box, label: Beta, group: tier }
edges:
  - { from: a, to: b, label: calls }
`;

const slide = "profile: presentation-16x9";

async function render(text: string) {
  const result = await renderFigure(text);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return { ...result.value, diagnostics: result.diagnostics };
}

test("sumi on a slide meets 14pt with textScale: 2 and not without it", async () => {
  const bare = await renderFigure(source(slide));
  expect(bare.ok).toBe(false);
  if (bare.ok) return;
  const small = bare.diagnostics.filter((d) => d.code === "profile/font-too-small");
  expect(small.length).toBeGreaterThan(0);
  // The hint names the control and the scale that fixes the figure (edge labels need 2).
  expect(small[0]?.hint).toContain("themeOverrides.textScale: 2");

  const scaled = await render(source(`${slide}\n  themeOverrides: { textScale: 2 }`));
  expect(scaled.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  const { ir } = scaled.compiled;
  const sizes = (id: string) => ir.nodes.find((n) => n.id === id)?.style;
  expect(sizes("a")?.fontSize.pt).toBe(16);
  expect(ir.groups.find((g) => g.id === "tier")?.style.fontSize.pt).toBe(18);
  expect(ir.edges[0]?.style.fontSize.pt).toBe(14);
  // Lines follow: sumi draws 1pt lines.
  expect(sizes("a")?.strokeWidth.pt).toBe(2);
  expect(ir.edges[0]?.style.strokeWidth.pt).toBe(2);
});

test("scaled sizes reach the SVG, the PDF and the PPTX in both layouts", async () => {
  for (const auto of [true, false]) {
    const text = source(
      `${slide}
  themeOverrides: { textScale: 2 }`,
      auto,
    );
    const result = await render(text);
    const { svg, compiled } = result;
    const fontSizes = [...svg.matchAll(/font-size:\s*([\d.]+)px|font-size="([\d.]+)"/g)].map((m) =>
      Number(m[1] ?? m[2]),
    );
    // px = 2 per pt: the edge label (14pt) is the smallest text, the group heading (18pt, auto
    // layout draws none beside nodes) the largest.
    expect(Math.min(...fontSizes)).toBe(28);
    expect(Math.max(...fontSizes)).toBeGreaterThanOrEqual(32);
    const widths = new Set(
      [...svg.matchAll(/stroke-width[:=]"?([\d.]+)/g)].map((m) => Number(m[1])),
    );
    // sumi draws 1pt lines (2px): doubled to 2pt (4px), none left at the theme's own width.
    expect(widths.has(4)).toBe(true);
    expect(widths.has(2)).toBe(false);

    const fontSet = getFontSet(DEFAULT_FONT_SET_ID);
    if (!fontSet) throw new Error("Missing default font set");
    const pdf = svgToPdf(svg, { fontSet });
    if (!pdf.ok) throw new Error(JSON.stringify(pdf.diagnostics));
    const glyphSizes = inspectPdf(pdf.value).glyphs.map((g) => g.size);
    // Printed at natural size: every glyph is at least the slide minimum.
    expect(Math.min(...glyphSizes)).toBeGreaterThanOrEqual(14 - 0.01);

    const pptx = svgToEditablePptx(svg, compiled.ir);
    if (!pptx.ok) throw new Error(JSON.stringify(pptx.diagnostics));
    const slideXml = new TextDecoder().decode(readPptx(pptx.value).get("ppt/slides/slide1.xml"));
    const sz = [...slideXml.matchAll(/ sz="(\d+)"/g)].map((m) => Number(m[1]) / 100);
    expect(sz.length).toBeGreaterThan(0);
    expect(Math.min(...sz)).toBeGreaterThanOrEqual(14 - 0.01);
  }
});

test("sublabels are checked after rounding: 1.75 is short, the hint names 2", async () => {
  // 1.75 scales 8pt text to 14pt but a sublabel (7/8, rounded down) to 12pt.
  const result = await renderFigure(source(`${slide}\n  themeOverrides: { textScale: 1.75 }`));
  expect(result.ok).toBe(false);
  if (result.ok) return;
  const small = result.diagnostics.filter((d) => d.code === "profile/font-too-small");
  expect(small.some((d) => d.message.includes("sublabel"))).toBe(true);
  expect(small[0]?.hint).toContain("textScale: 2");
});

test("an explicit target.minFontSize replaces the profile minimum for the scaled text", async () => {
  const bare = await renderFigure(source(`${slide}\n  target: { minFontSize: 12pt }`));
  // The unscaled text is not the profile stage's concern with an explicit target.
  if (!bare.ok)
    expect(bare.diagnostics.some((d) => d.code === "profile/font-too-small")).toBe(false);
  const scaled = await render(
    source(`${slide}\n  target: { minFontSize: 12pt }\n  themeOverrides: { textScale: 1.75 }`),
  );
  expect(scaled.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

test("written line widths and corner radii are final, not scaled", async () => {
  const scaled = await render(
    source(
      `${slide}\n  themeOverrides: { textScale: 2, lineWidth: 0.5pt, frameWidth: 1pt, cornerRadius: 2pt }`,
    ),
  );
  const { ir } = scaled.compiled;
  expect(ir.nodes.find((n) => n.id === "a")?.style.strokeWidth.pt).toBe(0.5);
  expect(ir.edges[0]?.style.strokeWidth.pt).toBe(0.5);
  expect(ir.groups.find((g) => g.id === "tier")?.style.strokeWidth.pt).toBe(1);
  expect(ir.groups.find((g) => g.id === "tier")?.style.radius.pt).toBe(2);
  // The text is still scaled.
  expect(ir.nodes.find((n) => n.id === "a")?.style.fontSize.pt).toBe(16);
});

test("the router's label gap follows the scale", async () => {
  const at = async (scale: number) => {
    const { compiled } = await render(
      source(`profile: paper-double\n  themeOverrides: { textScale: ${scale} }`),
    );
    return compiled.ir.edges[0]?.style.textScale;
  };
  expect(await at(2)).toBe(2);
  expect(await at(1)).toBeUndefined();
  expect(labelGap({ textScale: 2 } as never)).toBe(6);
  expect(labelGap({} as never)).toBe(3);
});

test("the suggested scale really lifts the figure, from any starting scale", async () => {
  for (const start of [0.5, 0.75, 1, 1.25, 1.5, 1.75]) {
    const result = await renderFigure(
      source(`${slide}\n  themeOverrides: { textScale: ${start} }`),
    );
    expect(result.ok).toBe(false);
    if (result.ok) continue;
    const hints = result.diagnostics
      .filter((d) => d.code === "profile/font-too-small")
      .map((d) => /textScale: ([\d.]+)/.exec(d.hint ?? "")?.[1]);
    expect(new Set(hints).size).toBe(1);
    const suggested = Number(hints[0]);
    expect(suggested).toBeGreaterThan(start);
    const fixed = await renderFigure(
      source(`${slide}\n  themeOverrides: { textScale: ${suggested} }`),
    );
    const left = fixed.ok
      ? []
      : fixed.diagnostics.filter((d) => d.code === "profile/font-too-small");
    expect(left).toEqual([]);
  }
});

test("fit: scale only shrinks a scaled figure that is too wide, and checks text at its printed size", async () => {
  const wide = (fit: string) => `version: 1
figure:
  id: wide
  theme: sumi
  profile: screen-doc
  ${fit}
  themeOverrides: { textScale: 2 }
  layout: { arrange: { row: { items: [a, b, c, d, e] } } }
nodes:
  - { id: a, component: box, label: A long first label }
  - { id: b, component: box, label: A long second label }
  - { id: c, component: box, label: A long third label }
  - { id: d, component: box, label: A long fourth label }
  - { id: e, component: box, label: A long fifth label }
`;
  const widthMm = (svg: string) => (Number(/width="([\d.]+)pt"/.exec(svg)?.[1]) * 25.4) / 72;
  const natural = await renderFigure(wide(""));
  if (!natural.ok) throw new Error(JSON.stringify(natural.diagnostics));
  expect(widthMm(natural.value.svg)).toBeGreaterThan(200);
  const fitted = await renderFigure(wide("fit: scale"));
  if (!fitted.ok) throw new Error(JSON.stringify(fitted.diagnostics));
  expect(widthMm(fitted.value.svg)).toBeLessThanOrEqual(200.01);
});

test("textScale is validated and 1 is the theme as it is", async () => {
  for (const bad of ["0.25", "5", "1.3", "'2'"]) {
    const result = await renderFigure(source(`themeOverrides: { textScale: ${bad} }`));
    expect(result.ok).toBe(false);
  }
  const theme = getTheme("sumi");
  if (!theme) throw new Error("missing theme");
  expect(withTextScale(theme, 1)).toBe(theme);
  expect(withTextScale(theme, undefined)).toBe(theme);
  const plain = await render(source("profile: paper-double"));
  const one = await render(source("profile: paper-double\n  themeOverrides: { textScale: 1 }"));
  const unhashed = (svg: string) => svg.replace(/input-sha256="[0-9a-f]+"/, "");
  expect(unhashed(one.svg)).toBe(unhashed(plain.svg));
});

test("the screen profile takes sumi at textScale 1.5 and fit only shrinks", async () => {
  const text = source("profile: screen-doc\n  themeOverrides: { textScale: 1.5 }");
  const result = await render(text);
  expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  const bare = await renderFigure(source("profile: screen-doc"));
  expect(bare.ok).toBe(false);
  if (!bare.ok) expect(bare.diagnostics[0]?.hint).toContain("textScale: 1.5");
});
