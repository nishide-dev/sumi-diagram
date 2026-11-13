import { expect, test } from "bun:test";
import { getTheme } from "../core/theme/builtin";
import { DEFAULT_FONT_SET_ID, getFontSet } from "../core/theme/fonts";
import { withTextScale } from "../core/theme/text-scale";
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
    expect(fontSizes.length).toBeGreaterThan(0);
    expect(Math.min(...fontSizes)).toBeGreaterThan(0);

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

test("text lint minima follow the scale: sublabels and a target override", async () => {
  // 1.75 scales 8pt text to 14pt but a sublabel (7/8, rounded down) to 12pt.
  const text = source(`${slide}\n  themeOverrides: { textScale: 1.75 }`);
  const result = await renderFigure(text);
  expect(result.ok).toBe(false);
  if (result.ok) return;
  const small = result.diagnostics.filter((d) => d.code === "profile/font-too-small");
  expect(small.some((d) => d.message.includes("sublabel"))).toBe(true);
  expect(small[0]?.hint).toContain("textScale: 2");
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
