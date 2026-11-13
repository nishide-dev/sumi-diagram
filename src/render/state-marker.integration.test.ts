import { expect, test } from "bun:test";
import type { Point } from "../core/geometry";
import { boundaryEntry } from "../layout/route/ports";
import { lintGeometry } from "../lint";
import { shapeOutline } from "../lint/geometry/shapes";
import { svgToPdf } from "./pdf";
import { svgToEditablePptx } from "./pptx";
import { renderFigure } from "./render";

const rendered = async (source: string) => {
  const result = await renderFigure(source);
  if (!result.ok || !("layout" in result.value)) throw new Error(JSON.stringify(result));
  return result;
};

const STATES = `version: 1
figure:
  id: states
  theme: sumi
  profile: paper-double
  layout:
    arrange: { row: { gap: 8mm, items: [start, idle, external, done] } }
nodes:
  - { id: start, component: initial }
  - { id: idle, component: box, label: Idle }
  - { id: api, component: box, label: API, variant: dashed, tone: blue }
  - { id: done, component: final }
groups:
  - id: external
    variant: filled-dashed
    label: External
    arrange: { stack: { items: [api] } }
edges:
  - { from: start, to: idle }
  - { from: idle, to: api }
  - { from: api, to: done }
`;

test("state markers are edge endpoints, a dashed box and a filled dashed group render, lint-free", async () => {
  for (const theme of ["sumi", "sumi-dark", "paper", "llama"]) {
    const result = await rendered(STATES.replace("theme: sumi", `theme: ${theme}`));
    expect(result.diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
    expect(lintGeometry(result.value).filter((d) => d.severity !== "info")).toEqual([]);
  }
  const { svg, layout } = (await rendered(STATES)).value as unknown as {
    svg: string;
    layout: { nodes: { key: string; rect: { width: number; height: number } }[] };
  };
  // The dashed box and the group's frame are dashed; the dot and the ring are not.
  expect(svg.match(/stroke-dasharray/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  expect(svg).toContain('class="sumi-wire"');
  const start = layout.nodes.find((n) => n.key === "n:start")?.rect;
  const done = layout.nodes.find((n) => n.key === "n:done")?.rect;
  // 1.25 em and 1.75 em of the 8pt text, in 0.5pt units.
  expect([start?.width, start?.height]).toEqual([20, 20]);
  expect([done?.width, done?.height]).toEqual([28, 28]);
});

test("a marker takes no label", async () => {
  const result = await renderFigure(
    STATES.replace(
      "{ id: start, component: initial }",
      "{ id: start, component: initial, label: S }",
    ),
  );
  expect(JSON.stringify(result)).toContain("component/unexpected-label");
});

const route = async (shape: string) => {
  const { value } = await rendered(`version: 1
figure:
  id: ends
  theme: sumi
  profile: paper-double
  layout: { arrange: { row: { gap: 14mm, items: [a, b] } } }
nodes:
  - { id: a, component: box, label: A }
  - { id: b, component: ${shape}, label: "Answer" }
edges:
  - { from: a, to: b }
`);
  const { layout } = value as unknown as {
    layout: {
      nodes: { key: string; rect: { x: number; y: number; width: number; height: number } }[];
      edges: { route?: { points?: Point[] } }[];
    };
  };
  return { value, layout };
};

for (const [component, shape] of [
  ["parallelogram", "parallelogram"],
  ["diamond", "diamond"],
  ["hexagon", "hexagon"],
  ["ellipse", "oval"],
] as const) {
  test(`an edge into a ${component} ends on its outline, not its bounding box (#519)`, async () => {
    const { value, layout } = await route(component);
    const target = layout.nodes.find((n) => n.key === "n:b")?.rect;
    if (!target) throw new Error("missing node");
    const svg = (value as unknown as { svg: string }).svg;
    const wire = /class="connection" d="M ([\d.]+) ([\d.]+) L ([\d.]+) ([\d.]+)"/.exec(svg);
    if (!wire) throw new Error("no straight connection");
    const end = { x: Number(wire[3]), y: Number(wire[4]) };
    const region = shapeOutline(shape, target);
    // On the outline: entering from just outside, the region is met right at the end.
    const hit = boundaryEntry({ x: end.x - 5, y: end.y }, end, region);
    expect(hit).toBeDefined();
    expect(hit ?? 0).toBeGreaterThan(0.99);
    expect(end.x).toBeGreaterThanOrEqual(target.x);
    // The arrowhead's base corners lie outside the shape, clear of the slanted boundary.
    const head = /<polygon points="([^"]*)" fill="#[0-9a-f]{6}" stroke="none"\/>/.exec(svg);
    if (!head?.[1]) throw new Error("no arrowhead");
    const corners = head[1].split(" ").map((pair) => {
      const [x, y] = pair.split(",").map(Number);
      return { x: x as number, y: y as number };
    });
    for (const corner of corners.slice(1)) {
      const entry = boundaryEntry(corner, { x: corner.x + 1000, y: corner.y }, region);
      // Not inside the shape: a ray to the right meets it only beyond the corner itself.
      expect(entry === undefined || entry > 0).toBe(true);
    }
  });
}

test("textAlign left on a fixed-width box and label moves the text to the left (#519)", async () => {
  const { svg } = (
    await rendered(`version: 1
figure:
  id: align
  theme: sumi
  profile: paper-double
  layout: { arrange: { stack: { gap: 3mm, items: [h, b, c] } } }
nodes:
  - { id: h, component: label, label: "RAG with\\nreranking", textAlign: left, props: { width: 113.5pt } }
  - { id: b, component: box, label: "Left", textAlign: left, props: { width: 113.5pt } }
  - { id: c, component: box, label: "Right", textAlign: right, props: { width: 113.5pt } }
`)
  ).value as unknown as { svg: string };
  const anchors = [...svg.matchAll(/<text x="([\d.]+)"[^>]*text-anchor:(\w+)/g)].map((m) => [
    Number(m[1]),
    m[2],
  ]);
  const rects = [...svg.matchAll(/<rect x="([\d.]+)" y="[\d.]+" width="227"/g)].map((m) =>
    Number(m[1]),
  );
  const [left, right] = rects as [number, number];
  expect(anchors[0]?.[1]).toBe("start");
  // The label's text starts at the node's left edge; the boxes' text sits inside the padding.
  expect(anchors[0]?.[0]).toBe(left);
  expect(anchors[1]?.[0] as number).toBeGreaterThan(left);
  expect(anchors[1]?.[0] as number).toBeLessThan(left + 20);
  expect(anchors[2]?.[1]).toBe("end");
  expect(anchors[2]?.[0] as number).toBeLessThan(right + 227);
  expect(anchors[2]?.[0] as number).toBeGreaterThan(right + 227 - 20);
});

test("a state marker is painted by its fill alone, at any size, in SVG, PDF and editable PPTX (#519)", async () => {
  for (const size of ["2pt", "6pt", "30pt"]) {
    const { value } = await rendered(`version: 1
figure:
  id: small
  theme: sumi
  profile: paper-double
  layout: { arrange: { row: { gap: 8mm, items: [a, f] } } }
nodes:
  - { id: a, component: initial, props: { size: ${size} } }
  - { id: f, component: final, props: { size: ${size} } }
`);
    const { svg, layout } = value as unknown as {
      svg: string;
      layout: { nodes: { key: string; rect: { width: number } }[] };
    };
    const paths = svg.match(/<path d="[^"]*" fill="[^"]*" stroke="none"\/>/g) ?? [];
    // One dot, plus two half rings and a dot.
    expect(paths).toHaveLength(4);
    const f = layout.nodes.find((n) => n.key === "n:f")?.rect.width ?? 0;
    expect(f).toBeGreaterThanOrEqual(12);
    expect(svgToPdf(svg).ok).toBe(true);
    expect(svgToEditablePptx(svg, value.compiled.ir).ok).toBe(true);
  }
});
