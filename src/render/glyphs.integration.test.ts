import { describe, expect, test } from "bun:test";
import { glyphRects } from "../assets/glyphs";
import { GLYPH_POSITIONS } from "../core/figure/schema";
import { getTheme } from "../core/theme/builtin";
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
    // A glyph at the center covers the node's own label: reported too.
    expect(lintGeometry(rendered.value).filter((d) => d.code === CODE)).toHaveLength(
      at === "east" || at === "center" ? 1 : 0,
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

async function layoutOf(source: string) {
  const rendered = await renderFigure(source);
  if (!rendered.ok || !("layout" in rendered.value))
    throw new Error(JSON.stringify(rendered.diagnostics));
  return rendered.value;
}

test("a straight edge crossing the default north-east vector is diagnosed", async () => {
  const value = await layoutOf(`version: 1
figure: { id: crossing, layout: { arrange: { row: { align: center, items: [a, b] } } } }
nodes:
  - { id: a, component: label, icon: tabler/file-text, glyphs: [{ kind: vector, cells: 3 }] }
  - { id: b, component: label, icon: tabler/file-text }
edges: [{ from: a, to: b }]
`);
  const findings = lintGeometry(value).filter((d) => d.code === CODE);
  expect(findings).toHaveLength(1);
  expect(findings[0]?.hint).toContain("attach the edge elsewhere");
});

for (const kind of ["row", "stack", "grid"]) {
  for (const align of ["start", "end"]) {
    test(`${kind} ${align} aligns bodies while enclosing glyph overhang`, async () => {
      const at =
        kind === "row"
          ? align === "start"
            ? "north"
            : "south"
          : align === "start"
            ? "west"
            : "east";
      const items = kind === "grid" ? "columns: 1, items: [a, b]" : "items: [a, b]";
      const value = await layoutOf(`version: 1
figure: { id: align, layout: { arrange: { row: { items: [g] } } } }
groups: [{ id: g, arrange: { ${kind}: { align: ${align}, ${items} } } }]
nodes:
  - { id: a, group: g, component: box, props: { width: 30pt, height: 20pt }, glyphs: [{ kind: vector, at: ${at}, cells: 3 }] }
  - { id: b, group: g, component: box, props: { width: 30pt, height: 20pt } }
`);
      const a = value.layout.nodes.find((n) => n.key === "n:a")?.rect;
      const b = value.layout.nodes.find((n) => n.key === "n:b")?.rect;
      const group = value.layout.groups.find((n) => n.key === "g:g")?.rect;
      const node = value.compiled.ir.nodes[0];
      if (!a || !b || !group || !node) throw new Error("missing layout");
      const glyph = glyphRects(node, a)[0];
      if (!glyph) throw new Error("missing glyph");
      const axis = kind === "row" ? "y" : "x";
      expect(a[axis]).toBeCloseTo(b[axis], 3);
      expect(glyph.x).toBeGreaterThanOrEqual(group.x - 0.001);
      expect(glyph.y).toBeGreaterThanOrEqual(group.y - 0.001);
      expect(glyph.x + glyph.width).toBeLessThanOrEqual(group.x + group.width + 0.001);
      expect(glyph.y + glyph.height).toBeLessThanOrEqual(group.y + group.height + 0.001);
    });
  }
}

test("glyph overhang is reserved inside a stack and keeps the body size", async () => {
  const value = await layoutOf(`version: 1
figure: { id: stack, layout: { arrange: { stack: { gap: 0, items: [a, b] } } } }
nodes:
  - { id: a, component: box, label: A, props: { width: 30pt, height: 20pt }, glyphs: [{ kind: vector, at: south, dy: 1 }] }
  - { id: b, component: box, label: B, props: { width: 30pt, height: 20pt } }
`);
  const a = value.layout.nodes.find((n) => n.key === "n:a");
  const b = value.layout.nodes.find((n) => n.key === "n:b");
  const node = value.compiled.ir.nodes[0];
  if (!a || !b || !node) throw new Error("missing nodes");
  expect(a.rect.height).toBe(40);
  const [glyph] = glyphRects(node, a.rect);
  expect(glyph && glyph.y + glyph.height > a.rect.y + a.rect.height).toBe(true);
  expect(b.rect.y).toBeGreaterThanOrEqual((glyph?.y ?? 0) + (glyph?.height ?? 0));
});

test("glyph overhang is reserved inside a group, whose frame contains it", async () => {
  const value = await layoutOf(`version: 1
figure: { id: group, layout: { arrange: { row: { items: [g] } } } }
groups: [{ id: g, label: G, arrange: { row: { items: [a] } } }]
nodes:
  - { id: a, component: box, label: A, group: g, props: { width: 30pt, height: 20pt }, glyphs: [{ kind: vector, at: east, dx: 1 }] }
`);
  const a = value.layout.nodes.find((n) => n.key === "n:a");
  const group = value.layout.groups.find((n) => n.key === "g:g");
  const node = value.compiled.ir.nodes[0];
  if (!a || !group || !node) throw new Error("missing");
  const [glyph] = glyphRects(node, a.rect);
  if (!glyph) throw new Error("no glyph");
  expect(glyph.x + glyph.width).toBeLessThanOrEqual(group.rect.x + group.rect.width + 1e-6);
  expect(a.rect.width).toBe(60);
});

test("a dimmed node's glyphs take the theme's dim colors", async () => {
  const result = await renderFigure(`version: 1
figure: { id: dim, theme: color, layout: { arrange: { row: { items: [g, h] } } } }
groups:
  - { id: g, dim: true, arrange: { row: { items: [a] } } }
  - { id: h, arrange: { row: { items: [b] } } }
nodes:
  - { id: a, group: g, component: box, label: A, glyphs: [{ kind: dot, tone: blue, strength: solid }] }
  - { id: b, group: h, component: box, label: B, glyphs: [{ kind: dot, tone: blue, strength: solid }] }
`);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const [dimmed, plain] = result.value.compiled.ir.nodes.map((n) => n.glyphs?.[0]);
  const theme = getTheme("color");
  if (theme?.dim === undefined || dimmed === undefined || plain === undefined)
    throw new Error("missing");
  expect(dimmed.stroke).toBe(theme.dim.stroke);
  expect(dimmed.parts[0]?.fill).not.toBe(plain.parts[0]?.fill);
  expect(plain.stroke).not.toBe(theme.dim.stroke);
});

for (const at of GLYPH_POSITIONS) {
  for (const order of ["a, b", "b, a"]) {
    test(`${at}, row ${order}, gap 0: the neighbour is kept off the glyph`, async () => {
      const value = await layoutOf(`version: 1
figure: { id: clear, layout: { arrange: { row: { gap: 0, items: [${order}] } } } }
nodes:
  - { id: a, component: box, props: { width: 30pt, height: 20pt }, glyphs: [{ kind: vector, at: ${at}, dx: 0.5, dy: 0.5 }] }
  - { id: b, component: box, props: { width: 30pt, height: 20pt } }
`);
      const a = value.layout.nodes.find((n) => n.key === "n:a");
      const b = value.layout.nodes.find((n) => n.key === "n:b");
      const node = value.compiled.ir.nodes[0];
      if (!a || !b || !node) throw new Error("missing nodes");
      const [glyph] = glyphRects(node, a.rect);
      if (!glyph) throw new Error("no glyph");
      const apart =
        glyph.x + glyph.width <= b.rect.x + 1e-6 || b.rect.x + b.rect.width <= glyph.x + 1e-6;
      expect(apart).toBe(true);
    });
  }
}
