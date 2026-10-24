/** Hand-calculated mappings independent of generated XML goldens (#62 review). */
import { expect, test } from "bun:test";
import { compileFigure } from "../../compiler/compile";
import type { EdgeIR, FigureIR } from "../../compiler/ir";
import { attribute, descendants, parseXml } from "../xml";
import { svgToEditablePptx } from "./editable";
import { readPptx } from "./testing";

const compiled = compileFigure(`version: 1
figure: { id: mapping }
nodes:
  - { id: a, component: ellipse, label: "" }
  - { id: b, component: ellipse, label: "" }
edges:
  - { from: a, to: b }
`);
if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
const ir = compiled.value.ir;
function svg(bx: number, by: number, path: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="200pt" height="200pt" viewBox="0 0 400 400"><svg class="d2-svg" viewBox="0 0 400 400"><g class="sumi-k-n--a sumi-kind-node"><g class="shape"><ellipse cx="120" cy="120" rx="20" ry="20" fill="#ffffff" stroke="#000000"/></g></g><g class="sumi-k-n--b sumi-kind-node"><g class="shape"><ellipse cx="${bx + 20}" cy="${by + 20}" rx="20" ry="20" fill="#ffffff" stroke="#000000"/></g></g><g class="sumi-k-e--_0 sumi-kind-edge"><path class="connection" d="${path}" stroke="#000000" fill="none"/></g></svg></svg>`;
}
function elements(bytes: Uint8Array) {
  const parsed = parseXml(new TextDecoder().decode(readPptx(bytes).get("ppt/slides/slide1.xml")));
  if (!parsed.ok) throw new Error(parsed.message);
  return [...descendants(parsed.root)];
}
for (const c of [
  {
    name: "right",
    bx: 200,
    by: 100,
    path: "M140 120L200 120",
    source: 6,
    target: 2,
    x: 140,
    y: 120,
    w: 60,
    h: 0,
    flipH: undefined,
    flipV: undefined,
  },
  {
    name: "left",
    bx: 0,
    by: 100,
    path: "M100 120L40 120",
    source: 2,
    target: 6,
    x: 40,
    y: 120,
    w: 60,
    h: 0,
    flipH: "1",
    flipV: undefined,
  },
  {
    name: "down",
    bx: 100,
    by: 200,
    path: "M120 140L120 200",
    source: 4,
    target: 0,
    x: 120,
    y: 140,
    w: 0,
    h: 60,
    flipH: undefined,
    flipV: undefined,
  },
  {
    name: "up",
    bx: 100,
    by: 0,
    path: "M120 100L120 40",
    source: 0,
    target: 4,
    x: 120,
    y: 40,
    w: 0,
    h: 60,
    flipH: undefined,
    flipV: "1",
  },
])
  test(`glued ellipse sites and transform: ${c.name}`, () => {
    const result = svgToEditablePptx(svg(c.bx, c.by, c.path), ir, { connectors: "glued" });
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const shape = elements(result.value).find((e) => e.name === "p:cxnSp");
    if (!shape) throw new Error("No connector");
    const all = [...descendants(shape)];
    const find = (name: string) => {
      const el = all.find((e) => e.name === name);
      if (!el) throw new Error(`Missing ${name}`);
      return el;
    };
    expect(attribute(find("a:stCxn"), "idx")).toBe(String(c.source));
    expect(attribute(find("a:endCxn"), "idx")).toBe(String(c.target));
    const transform = find("a:xfrm"),
      off = find("a:off"),
      ext = find("a:ext");
    expect(attribute(transform, "flipH")).toBe(c.flipH);
    expect(attribute(transform, "flipV")).toBe(c.flipV);
    expect([
      attribute(off, "x"),
      attribute(off, "y"),
      attribute(ext, "cx"),
      attribute(ext, "cy"),
    ]).toEqual(
      [c.x * 6350, c.y * 6350, Math.max(1, c.w * 6350), Math.max(1, c.h * 6350)].map(String),
    );
  });
function withEdge(change: (edge: EdgeIR) => EdgeIR): FigureIR {
  const old = ir.edges[0];
  if (!old) throw new Error("No edge");
  const edge = change(old);
  const map = new Map(ir.elements);
  map.set(edge.key, edge);
  return { ...ir, edges: [edge], elements: map };
}
test("source and target arrowheads map independently", () => {
  const source = withEdge((edge) => {
    const { targetArrowhead: _target, ...rest } = edge;
    return { ...rest, direction: "backward", sourceArrowhead: "diamond" };
  });
  const target = withEdge((edge) => ({ ...edge, targetArrowhead: "circle" }));
  for (const [figure, expected] of [
    [source, ["a:headEnd", "diamond"]],
    [target, ["a:tailEnd", "oval"]],
  ] as const) {
    const result = svgToEditablePptx(svg(200, 100, "M140 120L200 120"), figure);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const heads = elements(result.value).filter((e) => ["a:headEnd", "a:tailEnd"].includes(e.name));
    expect(heads).toHaveLength(1);
    expect(heads[0]?.name).toBe(expected[0]);
    const head = heads[0];
    if (!head) throw new Error("Missing arrowhead");
    expect(attribute(head, "type")).toBe(expected[1]);
  }
});
test("unsupported arrowheads and glued self-loops fail with diagnostics", () => {
  for (const head of ["box", "cross"] as const) {
    const result = svgToEditablePptx(
      svg(200, 100, "M140 120L200 120"),
      withEdge((e) => ({ ...e, targetArrowhead: head })),
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toBe("pptx/unsupported-geometry");
  }
  const unfilled = withEdge((e) => ({ ...e, style: { ...e.style, filled: false } }));
  const unfilledResult = svgToEditablePptx(svg(200, 100, "M140 120L200 120"), unfilled);
  expect(unfilledResult.ok).toBe(false);
  expect(unfilledResult.diagnostics[0]?.code).toBe("pptx/unsupported-geometry");
  const loop = withEdge((e) => ({ ...e, to: e.from }));
  const rejected = svgToEditablePptx(svg(200, 100, "M140 120L200 120"), loop, {
    connectors: "glued",
  });
  expect(rejected.ok).toBe(false);
  expect(rejected.diagnostics[0]?.code).toBe("pptx/unsupported-geometry");
  expect(svgToEditablePptx(svg(200, 100, "M140 120L200 120"), loop).ok).toBe(true);
});
