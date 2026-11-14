/** Hand-calculated mappings independent of generated XML goldens (#62 review). */
import { expect, test } from "bun:test";
import { compileFigure } from "../../compiler/compile";
import type { EdgeIR, FigureIR } from "../../compiler/ir";
import { attribute, descendants, parseXml } from "../xml";
import { alignDashPhase, dashOnPieces, splitMaskedPath, svgToEditablePptx } from "./editable";
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

test("parts after a label gap or a dash offset start at the SVG pattern's next period boundary", () => {
  const route = [
    { command: "M", to: { x: 0, y: 0 } },
    { command: "L", to: { x: 20, y: 0 } },
  ] as const;
  const xs = (parts: { part: { to: { x: number } }[] | undefined }[]) =>
    parts.map(({ part }) => part && [part[0]?.to.x, part.at(-1)?.to.x]);
  // 4 on / 2 off, period 6. A mask wholly inside the dash at 6-10 (7 to 9) leaves two parts:
  // the first runs to 7; the second starts at 9, 3 into the period, so at 12 (the dash at 9-10 goes).
  const masked = splitMaskedPath([...route], [{ x: 7, y: -1, width: 2, height: 2 }]);
  expect(xs(masked.map((part) => ({ part })))).toEqual([
    [0, 7],
    [9, 20],
  ]);
  expect(xs(alignDashPhase(route, masked, [4, 2], 0))).toEqual([
    [0, 7],
    [12, 20],
  ]);
  // An offset of 3 begins 3 into the period: the line starts at its next dash, at 3.
  expect(xs(alignDashPhase(route, [[...route]], [4, 2], 3))).toEqual([[3, 20]]);
  // A part already on a boundary stays; one shorter than the shift is dropped.
  expect(xs(alignDashPhase(route, [[...route]], [4, 2], 6))).toEqual([[0, 20]]);
  const short = [
    { command: "M", to: { x: 8, y: 0 } },
    { command: "L", to: { x: 9, y: 0 } },
  ] as const;
  expect(alignDashPhase(route, [[...short]], [4, 2], 0)[0]?.part).toBeUndefined();
});

test("a tail part too short to align draws only what the SVG pattern draws in it", () => {
  const route = [
    { command: "M", to: { x: 0, y: 0 } },
    { command: "L", to: { x: 20, y: 0 } },
  ] as const;
  const xs = (pieces: { x: number }[][]) => pieces.map((p) => [p[0]?.x, p.at(-1)?.x]);
  const line = (a: number, b: number) =>
    [
      { command: "M", to: { x: a, y: 0 } },
      { command: "L", to: { x: b, y: 0 } },
    ] as const;
  const pieces = (a: number, b: number) => {
    const [aligned] = alignDashPhase(route, [[...line(a, b)]], [4, 2], 0);
    expect(aligned?.part).toBeUndefined();
    return dashOnPieces(
      [
        { x: a, y: 0 },
        { x: b, y: 0 },
      ],
      [4, 2],
      aligned?.phase ?? 0,
    );
  };
  // 10 to 11 lies wholly in the gap (dashes 6-10, 12-16): nothing is drawn.
  expect(pieces(10, 11)).toEqual([]);
  // 9 to 11.5 starts in the dash 6-10: only 9 to 10 is drawn.
  expect(xs(pieces(9, 11.5))).toEqual([[9, 10]]);
  // 7 to 9 is wholly inside the dash 6-10: it is drawn whole and reaches the tip.
  expect(xs(pieces(7, 9))).toEqual([[7, 9]]);
  // A longer tail is trimmed to the boundary at 12 and keeps native dashes.
  const longer = alignDashPhase(route, [[...line(9, 20)]], [4, 2], 0)[0]?.part ?? [];
  expect([longer[0]?.to.x, longer.at(-1)?.to.x]).toEqual([12, 20]);
});

test("a dashed tail ending in a gap keeps its head as a shape: filled triangle and open chevron", () => {
  // 4 on / 2 off along 140..199; the label mask hides 130..197, leaving 197..199: the part
  // starts 3 into the period and ends at 59 (5 in, a gap), shorter than the shift to 12.
  const marker = (head: "triangle" | "open") =>
    `<marker id="mk" markerWidth="12" markerHeight="12" refX="10.5" refY="6" viewBox="0 0 12 12" orient="auto" markerUnits="userSpaceOnUse">${
      head === "triangle"
        ? '<polygon points="0,0 12,6 0,12" fill="#112233" class="connection" stroke-width="1"/>'
        : '<path d="M 0 0 L 12 6 L 0 12" fill="none" stroke="#112233" stroke-width="1"/>'
    }</marker>`;
  const source = (head: "triangle" | "open") =>
    svg(200, 100, "M140 120L199 120").replace(
      /<path class="connection"[^>]*\/>/,
      `<mask id="m"><rect x="0" y="0" width="400" height="400" fill="white"/><rect x="130" y="110" width="67" height="20" fill="black"/></mask>${marker(head)}<path class="connection" d="M140 120L199 120" stroke="#000000" fill="none" style="stroke-dasharray:4,2;" marker-end="url(#mk)" mask="url(#m)"/>`,
    );
  for (const head of ["triangle", "open"] as const) {
    const result = svgToEditablePptx(
      source(head),
      withEdge((e) => ({ ...e, targetArrowhead: head })),
    );
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const slide = new TextDecoder().decode(readPptx(result.value).get("ppt/slides/slide1.xml"));
    const shapes = (slide.match(/<p:sp>.*?<\/p:sp>/g) ?? []).filter((x) =>
      x.includes('name="e:#0"'),
    );
    // No native head on a line that would paint into the gap; the head is its own shape.
    expect(shapes.join("")).not.toMatch(/<a:(headEnd|tailEnd)/);
    const tip = shapes.find((x) =>
      head === "triangle"
        ? x.includes("<a:close/>")
        : /<a:lnTo>.*<a:lnTo>/.test(x) &&
          !x.includes("<a:close/>") &&
          x.includes('<a:path w="76200"'),
    );
    expect(tip).toBeDefined();
    if (head === "triangle") expect(tip).toContain('<a:srgbClr val="112233">');
    else expect(tip).toContain("<a:noFill/><a:ln");
  }
});
