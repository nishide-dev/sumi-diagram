import { expect, test } from "bun:test";
import { ASSETS_DIR } from "../compiler/testing";
import { BUILTIN_THEMES } from "../core/theme/builtin";
import { ALIGN_EPSILON } from "../layout/structured/align";
import { placeStructured } from "../layout/structured/engine";
import { lintGeometry } from "../lint/geometry/lint";
import { svgToPdf } from "./pdf";
import { svgToPptx } from "./pptx";
import { renderFigure } from "./render";

const source = `version: 1
figure:
  id: fill-render
  profile: paper-double
  fit: scale
  layout:
    density: compact
    arrange: { row: { gap: 12mm, align: stretch, items: [g, tall] } }
groups:
  - id: g
    caption: Column
    arrange:
      stack:
        gap: 6mm
        justify: stretch
        items: [a, b]
nodes:
  - { id: a, component: box, label: First, props: { width: 100pt }, badge: { icon: emoji/fire, corner: north-east } }
  - { id: b, component: box, label: Second }
  - { id: tall, component: box, label: Tall, props: { height: 100pt } }
edges: [{ from: a, to: b }]
`;

for (const theme of BUILTIN_THEMES.keys()) {
  test(`fill survives caption expansion, routing, SVG/PDF/PPTX with ${theme}`, async () => {
    const result = await renderFigure(source, { overrides: { theme } });
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const rendered = result.value;
    expect(lintGeometry(rendered)).toEqual([]);
    expect(svgToPdf(rendered.svg).ok).toBe(true);
    expect(svgToPptx(rendered.svg).ok).toBe(true);
    if (!("layout" in rendered)) throw new Error("Expected structured");
    const group = rendered.layout.groups[0];
    const a = rendered.layout.nodes.find((n) => n.key === "n:a")?.rect;
    const b = rendered.layout.nodes.find((n) => n.key === "n:b")?.rect;
    if (group === undefined || a === undefined || b === undefined)
      throw new Error("Missing fill geometry");
    expect(a.y).toBeGreaterThanOrEqual(group.content.y);
    // A fractional gap leaves less than one whole unit of centered padding.
    const bottomInset = group.content.y + group.content.height - (b.y + b.height);
    expect(bottomInset).toBeGreaterThanOrEqual(-0.001);
    expect(bottomInset).toBeLessThan(0.5);
    expect(a.height).toBeGreaterThan(30);
  });
}

test("mixed fill preserves protected components, grid cells, attachment gaps and final ports after alignment", async () => {
  const source = `version: 1
figure:
  id: mixed-fill
  fit: scale
  layout:
    arrange: { row: { gap: 40pt, align: stretch, items: [g, tall] } }
    align: [{ x: [a, b], at: start }]
groups:
  - id: g
    arrange:
      stack:
        gap: 12pt
        justify: stretch
        items: [{ row: { align: stretch, items: [a] } }, op, image, { grid: { columns: 2, columnGap: 12pt, items: [matrix, tokens] } }, b]
nodes:
  - { id: a, component: box, label: A, props: { width: 60pt } }
  - { id: b, component: box, label: B, props: { width: 30pt } }
  - { id: op, component: operator, props: { symbol: plus } }
  - { id: image, component: image, props: { src: gradient.png, width: 24pt } }
  - { id: matrix, component: matrix, props: { rows: [R], columns: [C], classes: { x: { tone: blue } }, cells: [x] } }
  - { id: tokens, component: tokens, props: { cells: [A, B] } }
  - { id: tag, component: operator, props: { symbol: times }, group: g, attach: { to: a, side: east, gap: 8pt } }
  - { id: tall, component: box, props: { height: 400pt } }
edges: [{ from: a, to: b, fromAnchor: south, toAnchor: north }]
`;
  const render = async (text: string) => {
    const result = await renderFigure(text, { assetBase: ASSETS_DIR });
    if (!result.ok || !("layout" in result.value))
      throw new Error(JSON.stringify(result.diagnostics));
    return result.value;
  };
  const filled = await render(source);
  const natural = await render(source.replace("justify: stretch", "justify: center"));
  const find = (rendered: typeof filled, key: string) => {
    const element = [...rendered.layout.nodes, ...rendered.layout.groups].find(
      (n) => n.key === key,
    );
    if (!element) throw new Error(`Missing ${key}`);
    return element.rect;
  };
  for (const key of ["n:op", "n:image", "g:matrix", "n:tokens-1", "n:tokens-2"]) {
    expect(find(filled, key).width).toBe(find(natural, key).width);
    expect(find(filled, key).height).toBe(find(natural, key).height);
  }
  // Compare every generated cell too: the grid must not distort component internals.
  for (const node of natural.layout.nodes.filter((n) => n.parent === "g:matrix")) {
    const actual = find(filled, node.key);
    const parent = find(filled, node.parent as string);
    const before = find(natural, node.parent as string);
    expect(actual.width).toBe(node.rect.width);
    expect(actual.height).toBe(node.rect.height);
    expect(actual.x - parent.x).toBeCloseTo(node.rect.x - before.x, 2);
    expect(actual.y - parent.y).toBeCloseTo(node.rect.y - before.y, 2);
  }
  const a = find(filled, "n:a");
  const b = find(filled, "n:b");
  const tag = find(filled, "n:tag");
  expect(a.height).toBeGreaterThan(find(natural, "n:a").height);
  expect(b.height).toBeGreaterThan(find(natural, "n:b").height);
  expect(Math.abs(a.x - b.x)).toBeLessThanOrEqual(ALIGN_EPSILON);
  const aligned = placeStructured(filled.compiled.ir);
  expect(Object.values(aligned.align?.struts ?? {}).some((size) => size > 0)).toBe(true);
  expect(tag.x - a.x - a.width).toBeCloseTo(16, 2);
  expect(tag.y + tag.height / 2).toBeCloseTo(a.y + a.height / 2, 2);
  const points = filled.layout.edges[0]?.route?.points;
  expect(points?.[0]).toEqual({ x: a.x + a.width / 2, y: a.y + a.height });
  expect(points?.at(-1)).toEqual({ x: b.x + b.width / 2, y: b.y });
  expect(lintGeometry(filled).filter((d) => d.severity !== "info")).toEqual([]);
});
