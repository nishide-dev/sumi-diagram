/**
 * Label text styles (#519, docs/design/decisions/519-label-styles.md): a node's
 * `text` role, `weight` and `sublabelInk`, end to end in the structured engine.
 * The roles are the theme's: small is its small edge text, heading its group
 * title size, large 1.5 times the body; they follow `textScale`, reach the
 * SVG, the PDF and the editable PPTX, and the lints measure what is drawn.
 */

import { expect, test } from "bun:test";
import { checkFigure } from "../core/check";
import { checkFigureSource } from "../core/figure/check";
import { getFontSet } from "../core/theme/fonts";
import { svgToPdf } from "./pdf";
import { inspectPdf, textLines } from "./pdf/testing";
import { svgToEditablePptx } from "./pptx";
import { readPptx } from "./pptx/testing";
import { renderFigure } from "./render";

const source = (figureExtra: string, nodes: string, profile = "paper-double") => `version: 1
figure:
  id: label-styles
  theme: sumi
  profile: ${profile}
${figureExtra}  layout: { arrange: { row: { items: [a, b, c, d, e] } } }
nodes:
${nodes}`;

const NODES = `  - { id: a, component: box, label: Alpha, text: small }
  - { id: b, component: box, label: Beta }
  - { id: c, component: box, label: Gamma, text: heading }
  - { id: d, component: box, label: Delta, text: large, weight: bold }
  - { id: e, component: box, label: Eps, weight: bold, sublabel: detail, sublabelInk: muted }
`;

async function render(text: string) {
  const result = await renderFigure(text);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  if (result.value.compiled.engine !== "structured") throw new Error("not structured");
  return result.value;
}

test("the text roles are the theme's sizes", async () => {
  const { compiled } = await render(source("", NODES));
  const style = (id: string) => compiled.ir.nodes.find((n) => n.id === id)?.style;
  // sumi: size.text 8pt, size.small 7pt, size.heading 9pt.
  expect(style("a")?.fontSize.pt).toBe(7);
  expect(style("b")?.fontSize.pt).toBe(8);
  expect(style("c")?.fontSize.pt).toBe(9);
  expect(style("d")?.fontSize.pt).toBe(12);
  expect(style("d")?.bold).toBe(true);
  expect(style("b")?.bold).toBe(false);
});

test("a bold label keeps a regular, muted sublabel", async () => {
  const { compiled, svg } = await render(source("", NODES));
  const e = compiled.ir.nodes.find((n) => n.id === "e");
  expect(e?.style.bold).toBe(true);
  expect(e?.style.sublabel).toEqual({ bold: false, fontColor: "#4e566b" });
  const texts = [...svg.matchAll(/<text [^>]*>[^<]*/g)].map((m) => m[0]);
  const find = (t: string) => texts.find((x) => x.endsWith(`>${t}`)) ?? "";
  expect(find("Eps")).toContain("text-latin-bold");
  expect(find("Eps")).toContain('fill="#30364f"');
  expect(find("detail")).toContain('class="text-latin"');
  expect(find("detail")).toContain('fill="#4e566b"');
  // The sublabel is 7/8 of the label's size.
  expect(find("detail")).toContain("font-size:14px");
});

test("the roles follow textScale and the sizes reach the PDF and the editable PPTX", async () => {
  const text = source("  themeOverrides: { textScale: 2 }\n", NODES);
  const { compiled, svg } = await render(text);
  const style = (id: string) => compiled.ir.nodes.find((n) => n.id === id)?.style;
  expect(style("a")?.fontSize.pt).toBe(14);
  expect(style("c")?.fontSize.pt).toBe(18);
  expect(style("d")?.fontSize.pt).toBe(24);
  const fonts = getFontSet("sumi/biz-ud-gothic");
  if (fonts === undefined) throw new Error("bundled font set is missing");
  const pdf = svgToPdf(svg, { fontSet: fonts });
  if (!pdf.ok) throw new Error(JSON.stringify(pdf.diagnostics));
  const sizes = textLines(inspectPdf(pdf.value).glyphs).map((l) => [l.text, l.size]);
  expect(sizes.find(([t]) => t === "Delta")?.[1]).toBeCloseTo(24, 3);
  const pptx = svgToEditablePptx(svg, compiled.ir);
  if (!pptx.ok) throw new Error(JSON.stringify(pptx.diagnostics));
  const slideXml = new TextDecoder().decode(readPptx(pptx.value).get("ppt/slides/slide1.xml"));
  expect(slideXml).toMatch(/sz="2400"[^>]*b="1"/);
  expect(slideXml).toMatch(/sz="1400"/);
  // The styled sublabel (7/8 of 8pt x 2 = 14pt), regular and muted, in the PDF and the PPTX.
  const detail = textLines(inspectPdf(pdf.value).glyphs).find((l) => l.text === "detail");
  expect(detail?.size).toBeCloseTo(14, 3);
  const glyph = inspectPdf(pdf.value).glyphs.find((g) => g.text === "d" && g.size === 14);
  expect(glyph?.font).not.toMatch(/bold/i);
  expect(glyph?.color?.map((c) => Math.round(c * 255))).toEqual([0x4e, 0x56, 0x6b]);
  const run = /<a:r><a:rPr[^>]*>(?:(?!<\/a:r>).)*detail<\/a:t><\/a:r>/s.exec(slideXml)?.[0] ?? "";
  expect(run).toContain('sz="1400"');
  expect(run).not.toContain('b="1"');
  expect(run.toLowerCase()).toContain("4e566b");
});

/** WCAG contrast of two #rrggbb colors. */
function ratio(a: string, b: string): number {
  const lum = (c: string) => {
    const v = [1, 3, 5].map((o) => {
      const x = Number.parseInt(c.slice(o, o + 2), 16) / 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * (v[0] ?? 0) + 0.7152 * (v[1] ?? 0) + 0.0722 * (v[2] ?? 0);
  };
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

test("a muted sublabel reads on solid, emphasis, tinted, overridden and dimmed fills", async () => {
  const nodes = [
    "  - { id: a, component: box, label: A, sublabel: s, sublabelInk: muted, variant: solid, tone: blue }",
    "  - { id: b, component: box, label: B, sublabel: s, sublabelInk: muted, variant: emphasis }",
    "  - { id: c, component: box, label: C, sublabel: s, sublabelInk: muted, variant: tinted, tone: orange }",
    "  - { id: d, component: box, label: D, sublabel: s, sublabelInk: muted, variant: tinted, tone: green }",
    "  - { id: e, component: box, label: E, sublabel: s, sublabelInk: muted, variant: filled, tone: gray }",
  ].join("\n");
  let checked = 0;
  for (const theme of ["sumi", "sumi-dark", "color", "paper"]) {
    for (const extra of ["", "  themeOverrides: { tones: { blue: { fill: '#1d3557' } } }\n"]) {
      const text = source(extra, `${nodes}\n`).replace("theme: sumi", `theme: ${theme}`);
      const result = await renderFigure(text);
      if (!result.ok) continue; // a theme without these variants is not this test's subject
      const { ir } = result.value.compiled;
      for (const node of ir.nodes) {
        const ink = node.style.sublabel?.fontColor;
        if (ink === undefined || !/^#[0-9a-f]{6}$/i.test(node.style.fill)) continue;
        checked++;
        expect(ratio(ink, node.style.fill), `${theme} ${node.id}`).toBeGreaterThanOrEqual(3);
      }
    }
  }
  expect(checked).toBeGreaterThanOrEqual(20);
  // Dimming: the sublabel follows the dim ink with its label.
  const dimmed = await render(
    `version: 1
figure: { id: d, theme: sumi, profile: paper-double, layout: { arrange: { stack: { items: [g] } } } }
groups:
  - { id: g, dim: true, arrange: { stack: { items: [a] } } }
nodes:
  - { id: a, component: box, label: A, sublabel: s, sublabelInk: muted }
`,
  );
  const a = dimmed.compiled.ir.nodes.find((n) => n.id === "a");
  expect(a?.style.sublabel?.fontColor).toBe(a?.style.fontColor);
});

test("text-too-small reads the role's size", async () => {
  const plain = await renderFigure(
    source("  themeOverrides: { textScale: 1.5 }\n", NODES, "screen-doc"),
  );
  expect(plain.ok).toBe(true);
  const small = await renderFigure(
    source(
      "  themeOverrides: { textScale: 1.25 }\n",
      "  - { id: a, component: box, label: A, text: small }\n  - { id: b, component: box, label: B }\n  - { id: c, component: box, label: C }\n  - { id: d, component: box, label: D }\n  - { id: e, component: box, label: E }\n",
      "screen-doc",
    ),
  );
  // 7pt x 1.25 = 8.75pt is under the profile's 10pt; the others (10pt) are not.
  expect(small.ok).toBe(false);
  if (small.ok) return;
  const paths = small.diagnostics
    .filter((d) => d.code === "profile/font-too-small")
    .map((d) => d.path);
  expect(paths).toEqual([["nodes", 0]]);
});

test("the styles need the structured layout engine", () => {
  const text = `version: 1
figure: { id: x, theme: sumi, profile: paper-double }
nodes:
  - { id: a, component: box, label: A, text: heading, weight: bold, sublabelInk: muted }
`;
  const { state } = checkFigureSource(text);
  const codes = state.diagnostics.map((d) => [d.code, (d.path ?? []).join(".")]);
  expect(codes).toEqual([
    ["layout/structured-only", "nodes.0.text"],
    ["layout/structured-only", "nodes.0.weight"],
    ["layout/structured-only", "nodes.0.sublabelInk"],
  ]);
});

test("sublabelInk without a sublabel is reported", () => {
  const text = source("", "  - { id: a, component: box, label: A, sublabelInk: muted }\n").replace(
    "items: [a, b, c, d, e]",
    "items: [a]",
  );
  const { state } = checkFigure(text);
  expect(state.diagnostics.map((d) => d.code)).toContain("component/sublabel-ink-without-sublabel");
});
