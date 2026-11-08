import { describe, expect, test } from "bun:test";
import { glyphRects } from "../assets/glyphs";
import { GLYPH_POSITIONS } from "../core/figure/schema";
import { lintGeometry } from "../lint";
import { svgToPdf } from "./pdf";
import { inspectPdf } from "./pdf/testing";
import { svgToEditablePptx, svgToPptx } from "./pptx";
import { readPptx } from "./pptx/testing";
import { renderFigure } from "./render";

const CODE = "geometry/glyph-collision";

for (const at of GLYPH_POSITIONS) {
  test(`${at}: a glyph reserves layout space, keeps the body, and edges attach to the body`, async () => {
    const source = `version: 1
figure: { id: corners, layout: { arrange: { row: { gap: 24pt, items: [a, b] } } } }
nodes:
  - { id: a, component: box, label: A, props: { width: 30pt, height: 20pt }, glyphs: [{ kind: vector, at: ${at}, tone: blue }] }
  - { id: b, component: box, label: B, props: { width: 30pt, height: 20pt } }
edges: [{ from: a, to: b }]
`;
    const rendered = await renderFigure(source);
    if (!rendered.ok || !("layout" in rendered.value))
      throw new Error(JSON.stringify(rendered.diagnostics));
    const { layout, compiled } = rendered.value;
    const a = layout.nodes.find((n) => n.key === "n:a");
    const b = layout.nodes.find((n) => n.key === "n:b");
    const node = compiled.ir.nodes[0];
    if (!a || !b || !node) throw new Error("missing nodes");
    // The body keeps its explicit size; the glyph only adds to the footprint.
    expect(a.rect.width).toBe(60);
    expect(a.rect.height).toBe(40);
    const [glyph] = glyphRects(node, a.rect);
    if (glyph === undefined) throw new Error("missing glyph footprint");
    expect(glyph.x).toBeGreaterThanOrEqual(0);
    expect(glyph.y).toBeGreaterThanOrEqual(0);
    expect(glyph.x + glyph.width).toBeLessThanOrEqual(layout.canvas.width);
    expect(glyph.y + glyph.height).toBeLessThanOrEqual(layout.canvas.height);
    // The neighbour is kept clear of the glyph, never of the body only.
    expect(b.rect.x).toBeGreaterThanOrEqual(
      Math.max(a.rect.x + a.rect.width, glyph.x + glyph.width),
    );
    // Edges leave the body: the route's first point is on the body's border.
    const first = layout.edges[0]?.route?.points[0];
    expect(first?.x).toBeCloseTo(a.rect.x + a.rect.width, 3);
    // The edge leaves the east side, through a glyph centered there: reported.
    expect(lintGeometry(rendered.value).filter((d) => d.code === CODE)).toHaveLength(
      at === "east" ? 1 : 0,
    );
  });
}

describe("render parity", () => {
  for (const [engine, theme] of [
    "minimal",
    "academic",
    "slides",
    "color",
    "paper",
    "llama",
  ].flatMap((theme) => ["auto", "structured"].map((engine) => [engine, theme] as const))) {
    test(`${engine}/${theme}: the same glyphs reach SVG, vector PDF, picture PPTX${engine === "structured" ? " and editable PPTX" : ""}`, async () => {
      const source = `version: 1
figure: { id: glyphs, theme: ${theme}, ${theme === "slides" ? "profile: presentation-16x9," : ""} ${engine === "structured" ? "layout: { arrange: { row: { gap: 8mm, items: [a, b] } } }" : ""} }
nodes:
  - { id: a, component: box, label: Paper, glyphs: [{ kind: vector, cells: 3, tones: [blue, orange, green] }, { kind: dot, at: south-west, tone: pink }] }
  - { id: b, component: box, label: Other, glyphs: [{ kind: vector, cells: 4, direction: right, at: south, tone: yellow }, { kind: pill, at: east }] }
edges: [{ from: a, to: b }]
`;
      const rendered = await renderFigure(source);
      if (!rendered.ok) throw new Error(JSON.stringify(rendered.diagnostics));
      const { svg, compiled } = rendered.value;
      expect(svg.match(/class="sumi-glyphs"/g)).toHaveLength(2);
      // 3 cells + dot + 4 cells + pill.
      const drawn = [...svg.matchAll(/<g class="sumi-glyphs">(.*?)<\/g><\/g>/gs)].flatMap(
        (m) => m[1]?.match(/<rect /g) ?? [],
      );
      expect(drawn).toHaveLength(9);
      const fills = compiled.ir.nodes.flatMap(
        (n) => n.glyphs?.flatMap((g) => g.parts.map((p) => p.fill)) ?? [],
      );
      for (const fill of fills) expect(svg).toContain(`fill="${fill}"`);
      expect(lintGeometry(rendered.value).filter((d) => d.code === CODE)).toEqual([]);
      const pdf = svgToPdf(svg);
      if (!pdf.ok) throw new Error(JSON.stringify(pdf.diagnostics));
      expect(inspectPdf(pdf.value).images).toBe(0);
      const pptx = svgToPptx(svg);
      if (!pptx.ok) throw new Error(JSON.stringify(pptx.diagnostics));
      const picture = [...readPptx(pptx.value).entries()].find(([name]) => name.endsWith(".svg"));
      const picked = new TextDecoder().decode(picture?.[1]).toLowerCase();
      for (const fill of fills) expect(picked).toContain(fill);
      if (engine === "structured") {
        const editable = svgToEditablePptx(svg, compiled.ir);
        if (!editable.ok) throw new Error(JSON.stringify(editable.diagnostics));
        const slide = new TextDecoder().decode(
          readPptx(editable.value).get("ppt/slides/slide1.xml"),
        );
        expect(slide.match(/name="n:[ab] glyph \d+"/g)).toHaveLength(9);
        for (const fill of new Set(fills))
          expect(slide.toUpperCase()).toContain(`<A:SRGBCLR VAL="${fill.slice(1).toUpperCase()}"`);
      }
    }, 30_000);
  }
});

test("glyphs on an icon node are drawn over the icon's box and stay out of the lint", async () => {
  const rendered = await renderFigure(`version: 1
figure: { id: icon, layout: { arrange: { row: { items: [a] } } } }
nodes: [{ id: a, component: box, icon: tabler/file-text, glyphs: [{ kind: vector, cells: 3, tone: blue }] }]
`);
  if (!rendered.ok) throw new Error(JSON.stringify(rendered.diagnostics));
  expect(rendered.value.svg).toContain('class="sumi-icon"');
  expect(rendered.value.svg).toContain('class="sumi-glyphs"');
  expect(lintGeometry(rendered.value).filter((d) => d.code === CODE)).toEqual([]);
  // The editable PPTX cannot carry the icon, as before: glyphs do not change that.
  expect(
    svgToEditablePptx(rendered.value.svg, rendered.value.compiled.ir).diagnostics.map(
      (d) => d.code,
    ),
  ).toContain("pptx/unsupported-asset");
});

test("a glyph overlapping a foreign body is reported, but not over its own body", async () => {
  const source = `version: 1
figure: { id: collision, layout: { arrange: { row: { items: [a] } } } }
nodes:
  - { id: a, component: box, label: A, glyphs: [{ kind: dot }] }
  - { id: note, component: box, label: Other, attach: { to: a, side: north-east, gap: 0 } }
`;
  const result = await renderFigure(source);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  expect(lintGeometry(result.value, { source }).filter((d) => d.code === CODE)).toEqual([]);
  const a = result.value.inspection.elements.find((e) => e.key === "n:a");
  const node = result.value.compiled.ir.nodes[0];
  if (!a?.bbox || !node) throw new Error("missing glyph body");
  const [footprint] = glyphRects(node, a.bbox);
  if (!footprint) throw new Error("missing glyph");
  const inspection = {
    ...result.value.inspection,
    elements: result.value.inspection.elements.map((e) =>
      e.key === "n:note" ? { ...e, bbox: footprint } : e,
    ),
  };
  expect(
    lintGeometry({ ...result.value, inspection }, { source }).filter((d) => d.code === CODE),
  ).toEqual([
    expect.objectContaining({
      path: ["nodes", 0, "glyphs", 0],
      related: expect.arrayContaining([expect.objectContaining({ path: ["nodes", 1] })]),
    }),
  ]);
});

test("glyphs count in the page bounds and in fit: scale", async () => {
  const result = await renderFigure(`version: 1
figure: { id: scaled, fit: scale, layout: { arrange: { row: { items: [a] } } } }
nodes: [{ id: a, component: box, label: A, props: { width: 283.5pt, height: 20pt }, glyphs: [{ kind: vector, at: east, dx: 3 }] }]
`);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  expect(result.value.inspection.scale).toBeLessThan(1);
  const node = result.value.compiled.ir.nodes[0];
  const body = result.value.inspection.elements[0]?.bbox;
  if (!node || !body) throw new Error("missing node");
  const [glyph] = glyphRects(node, body);
  const canvas = result.value.inspection.canvas.viewBox;
  expect((glyph?.x ?? 0) + (glyph?.width ?? 0)).toBeLessThanOrEqual(canvas.x + canvas.width + 1e-6);
  expect(svgToPdf(result.value.svg).ok).toBe(true);
});
