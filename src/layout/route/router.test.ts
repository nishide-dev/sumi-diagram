import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { stringify } from "yaml";
import { type LayoutFigureOptions, layoutStructuredFigure } from "../index";
import type { EdgeLayout, LayoutIR, Point, Rect } from "../ir";
import type { TextMeasurer } from "../text";
import { checkRoutes, type RouteCheckReport, routeProblemCount } from "./check";
import { arrowheadLength, mergeSegments, routeEdges, simplify } from "./router";

const fixtures = `${import.meta.dir}/../../../tests/fixtures`;
const goldens = `${fixtures}/layout`;
// Set SUMI_UPDATE_GOLDEN=1 to rewrite the expected Layout IR JSON.
const update = process.env.SUMI_UPDATE_GOLDEN === "1";

/** Every character is half an em wide; ascender 0.8 em, descender 0.2 em. */
const FAKE: TextMeasurer = {
  lineWidth: (text, _font, size) => ([...text].length * size) / 2,
  verticalMetrics: (_font, size) => ({ ascent: 0.8 * size, descent: 0.2 * size }),
};

function run(text: string, options: LayoutFigureOptions = {}) {
  const result = layoutStructuredFigure(text, { measurer: FAKE, ...options });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  return result.value;
}

/** A structured figure in the minimal theme (1-unit strokes: 8-unit arrowheads). */
function figure(arrange: unknown, nodes: unknown[], edges: unknown[], groups: unknown[] = []) {
  return stringify({
    version: 1,
    figure: { id: "t", theme: "academic", layout: { arrange } },
    groups,
    nodes,
    edges,
  });
}

const box = (id: string, props?: object) => ({
  id,
  component: "box",
  label: id,
  ...(props !== undefined && { props }),
});
const junction = (id: string) => ({ id, component: "junction" });

const edgeOf = (layout: LayoutIR, index: number): EdgeLayout => {
  const edge = layout.edges[index];
  if (edge === undefined) throw new Error(`no edge ${index}`);
  return edge;
};
const pointsOf = (layout: LayoutIR, index: number): readonly Point[] =>
  edgeOf(layout, index).route?.points ?? [];
const rectOf = (layout: LayoutIR, id: string): Rect => {
  const element =
    layout.nodes.find((n) => n.key === `n:${id}`) ?? layout.groups.find((g) => g.key === `g:${id}`);
  if (element === undefined) throw new Error(`no ${id}`);
  return element.rect;
};

/** Expects a clean routing; returns the report for further checks. */
function expectClean(value: ReturnType<typeof run>): RouteCheckReport {
  const report = checkRoutes(value.ir, value.layout);
  expect(Object.entries(report).filter(([, list]) => list.length > 0)).toEqual([]);
  return report;
}

describe("single edges", () => {
  test("stacked boxes: a straight line from side to side", () => {
    const value = run(
      figure({ stack: { items: ["a", "b"] } }, [box("a"), box("b")], [{ from: "a", to: "b" }]),
    );
    const { layout } = value;
    const a = rectOf(layout, "a");
    const b = rectOf(layout, "b");
    expect(pointsOf(layout, 0)).toEqual([
      { x: a.x + a.width / 2, y: a.y + a.height },
      { x: b.x + b.width / 2, y: b.y },
    ]);
    expect(edgeOf(layout, 0).route).toMatchObject({ net: 0, fromSide: "south", toSide: "north" });
    expect(layout.nets).toEqual([
      { id: 0, edges: ["e:#0"], segments: [pointsOf(layout, 0) as [Point, Point]] },
    ]);
    expectClean(value);
  });

  test("anchors give the side and the position on it; ends are perpendicular", () => {
    const value = run(
      figure(
        { row: { items: ["a", "b"] } },
        [box("a"), box("b", { height: "40pt" })],
        [{ from: "a", to: "b", fromAnchor: "north:0.25", toAnchor: "south:0.75" }],
      ),
    );
    const { layout } = value;
    const a = rectOf(layout, "a");
    const b = rectOf(layout, "b");
    const points = pointsOf(layout, 0);
    expect(points[0]).toEqual({ x: a.x + a.width * 0.25, y: a.y });
    expect(points.at(-1)).toEqual({ x: b.x + b.width * 0.75, y: b.y + b.height });
    // Up from a, over, down past b and back up into its bottom side.
    expect((points[1] as Point).x).toBe((points[0] as Point).x);
    expect((points.at(-2) as Point).x).toBe((points.at(-1) as Point).x);
    expect((points.at(-2) as Point).y).toBeGreaterThan(b.y + b.height);
    expectClean(value);
  });

  test("a circle's end is on the circle, not on its bounding box", () => {
    const value = run(
      figure(
        { stack: { items: ["a", "c"] } },
        [box("a", { width: "60pt" }), { id: "c", component: "circle", label: "C" }],
        [{ from: "a", to: "c", toAnchor: "north:0.2" }],
      ),
    );
    const c = rectOf(value.layout, "c");
    const end = pointsOf(value.layout, 0).at(-1) as Point;
    expect(end.x).toBeCloseTo(c.x + c.width * 0.2, 3);
    expect(end.y).toBeGreaterThan(c.y + 1);
    expectClean(value);
  });

  test("the last segment before an arrowhead is at least the arrowhead long", () => {
    const value = run(
      figure(
        { row: { items: ["a", "b"] } },
        [box("a"), box("b")],
        [{ from: "a", to: "b", fromAnchor: "south", toAnchor: "west:0.2" }],
      ),
    );
    const points = pointsOf(value.layout, 0);
    const [p, q] = points.slice(-2) as [Point, Point];
    expect(q.x - p.x).toBeGreaterThanOrEqual(arrowheadLength(1));
    expectClean(value);
  });
});

describe("nets", () => {
  test("edges from one port share a trunk: one net, segments stroked once", () => {
    const value = run(
      figure(
        { stack: { items: ["s", { row: { items: ["a", "b", "c"] } }] } },
        [box("s"), box("a"), box("b"), box("c")],
        [
          { from: "s", to: "a", fromAnchor: "south" },
          { from: "s", to: "b", fromAnchor: "south" },
          { from: "s", to: "c", fromAnchor: "south" },
        ],
      ),
    );
    const { layout } = value;
    expect(layout.nets).toHaveLength(1);
    expect(layout.nets?.[0]?.edges).toEqual(["e:#0", "e:#1", "e:#2"]);
    // The first segment (the trunk) is common to all three.
    const firsts = [0, 1, 2].map((i) => pointsOf(layout, i).slice(0, 2) as [Point, Point]);
    for (const [start, next] of firsts) {
      expect(start).toEqual(firsts[0]?.[0] as Point);
      expect(next.x).toBe(start.x);
    }
    const total = [0, 1, 2].reduce((n, i) => n + pointsOf(layout, i).length - 1, 0);
    expect(layout.nets?.[0]?.segments.length).toBeLessThan(total);
    expectClean(value);
  });

  test("junctions merge transitively, through edges between junctions", () => {
    const value = run(
      figure(
        { stack: { items: ["x", "j1", "j2", { row: { items: ["a", "b"] } }] } },
        [box("x"), junction("j1"), junction("j2"), box("a"), box("b")],
        [
          { from: "x", to: "j1", component: "line" },
          { from: "j1", to: "j2", component: "line" },
          { from: "j2", to: "a" },
          { from: "j1", to: "b", toAnchor: "east" },
        ],
      ),
    );
    const { layout } = value;
    expect(layout.nets?.map((n) => n.edges)).toEqual([["e:#0", "e:#1", "e:#2", "e:#3"]]);
    // A junction end is its center.
    const j1 = rectOf(layout, "j1");
    expect(pointsOf(layout, 0).at(-1)).toEqual({ x: j1.x + j1.width / 2, y: j1.y + j1.height / 2 });
    expect(edgeOf(layout, 0).route?.toSide).toBeUndefined();
    expectClean(value);
  });

  test("edges between the same two elements are spread out, not drawn on each other", () => {
    const value = run(
      figure(
        { stack: { items: ["a", "b"] } },
        [box("a", { width: "80pt" }), box("b", { width: "80pt" })],
        [
          { from: "a", to: "b" },
          { from: "a", to: "b", component: "line" },
          { from: "b", to: "a" },
        ],
      ),
    );
    const { layout } = value;
    const a = rectOf(layout, "a");
    const xs = [0, 1].map((i) => (pointsOf(layout, i)[0] as Point).x);
    expect(xs).toEqual([a.x + a.width / 4, a.x + a.width / 2]);
    // The way back (a cycle) uses its own offsets too.
    expect((pointsOf(layout, 2).at(-1) as Point).x).toBe(a.x + (a.width * 3) / 4);
    expect(new Set(layout.edges.map((e) => e.route?.net)).size).toBe(3);
    expectClean(value);
  });

  test("a straight connector is recorded: a later edge goes around it rather than across", () => {
    const value = run(
      figure(
        { row: { items: ["x", { stack: { items: ["a", "b"] } }, "y"] } },
        [box("x"), box("a"), box("b"), box("y")],
        [
          { from: "a", to: "b" },
          { from: "x", to: "y", fromAnchor: "east", toAnchor: "west" },
        ],
      ),
    );
    expect(pointsOf(value.layout, 0)).toHaveLength(2);
    expect(pointsOf(value.layout, 1).length).toBeGreaterThan(2);
    expectClean(value);
  });
});

describe("special ends", () => {
  test("a self-loop goes around a corner (east → north by default)", () => {
    const value = run(figure({ stack: { items: ["a"] } }, [box("a")], [{ from: "a", to: "a" }]));
    const route = edgeOf(value.layout, 0).route;
    expect(route).toMatchObject({ fromSide: "east", toSide: "north" });
    expect(route?.points.length).toBeGreaterThanOrEqual(4);
    expectClean(value);
  });

  test("edges to a group end on its border, from outside or from inside", () => {
    const value = run(
      figure(
        { stack: { items: ["x", "g"] } },
        [box("x"), box("a")],
        [
          { from: "x", to: "g" },
          { from: "a", to: "g", component: "line" },
        ],
        [{ id: "g", label: "G", arrange: { stack: { items: ["a"] } } }],
      ),
    );
    const g = rectOf(value.layout, "g");
    expect(pointsOf(value.layout, 0).at(-1)).toMatchObject({ y: g.y });
    // From the child to the nearest side of its group, inside the group.
    const inner = pointsOf(value.layout, 1);
    for (const p of inner) {
      expect(p.x).toBeGreaterThanOrEqual(g.x);
      expect(p.x).toBeLessThanOrEqual(g.x + g.width);
    }
    expectClean(value);
  });

  test("a route that leaves the content grows the content and the canvas", () => {
    const text = figure(
      { row: { items: ["a", "b", "c"] } },
      [box("a"), box("b", { height: "40pt" }), box("c")],
      [{ from: "a", to: "c", fromAnchor: "north", toAnchor: "north" }],
    );
    const before = run(text, { route: false }).layout;
    const value = run(text);
    const after = value.layout;
    expect(after.canvas.height).toBeGreaterThan(before.canvas.height);
    // Everything moved down together; the route stays inside the margins.
    const dy = rectOf(after, "a").y - rectOf(before, "a").y;
    expect(dy).toBeGreaterThan(0);
    expect(rectOf(after, "b").y - rectOf(before, "b").y).toBeCloseTo(dy, 3);
    expect(after.content.y).toBe(after.margin);
    expect(Math.min(...pointsOf(after, 0).map((p) => p.y))).toBe(after.margin);
    expectClean(value);
  });
});

describe("layout/no-route", () => {
  test("touching boxes cannot be joined; the edge is located, the others are routed", () => {
    const text = figure(
      { stack: { gap: 0, items: ["a", "b", "c"] } },
      [box("a"), box("b"), box("c")],
      [
        { from: "a", to: "c", fromAnchor: "east", toAnchor: "east" },
        { from: "a", to: "b", fromAnchor: "south:0.3", toAnchor: "north:0.7" },
      ],
    );
    const result = layoutStructuredFigure(text, { measurer: FAKE });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((d) => [d.code, d.severity, d.path, d.location?.line])).toEqual([
      ["layout/no-route", "error", ["edges", 1], text.split("\n").lastIndexOf("  - from: a") + 1],
    ]);
    expect(result.diagnostics[0]?.message).toBe(
      'No route was found for edge edges[1] from "a" to "b": every path is blocked by nodes or too narrow for its stubs.',
    );
    // The router itself returns the partial layout.
    const placed = run(text, { route: false });
    const routed = routeEdges(placed.ir, placed.layout);
    expect(routed.layout.edges.map((e) => e.route !== undefined)).toEqual([true, false]);
    expect(routed.layout.nets?.map((n) => n.edges)).toEqual([["e:#0"]]);
  });

  test("both ends at the same point", () => {
    const text = figure(
      { stack: { items: ["a"] } },
      [box("a")],
      [{ from: "a", to: "a", fromAnchor: "south", toAnchor: "south" }],
    );
    const result = layoutStructuredFigure(text, { measurer: FAKE });
    expect(result.diagnostics.map((d) => d.message)).toEqual([
      'No route was found for edge edges[0] from "a" to "a": both ends are the same point of the element.',
    ]);
  });

  test("ends closer than the arrowhead: no room for it; a line is fine", () => {
    const text = (component: string) =>
      figure(
        { stack: { gap: "1pt", items: ["a", "b"] } },
        [box("a"), box("b")],
        [{ from: "a", to: "b", component }],
      );
    const result = layoutStructuredFigure(text("arrow"), { measurer: FAKE });
    expect(result.diagnostics.map((d) => d.message)).toEqual([
      'No route was found for edge edges[0] from "a" to "b": the ends are closer than its arrowhead at the target is long.',
    ]);
    const back = layoutStructuredFigure(
      figure(
        { stack: { gap: "1pt", items: ["a", "b"] } },
        [box("a"), box("b")],
        [{ from: "a", to: "b", component: "double-arrow" }],
      ),
      { measurer: FAKE },
    );
    expect(back.diagnostics.map((d) => d.message)).toEqual([
      'No route was found for edge edges[0] from "a" to "b": the ends are closer than its arrowhead at the source is long.',
    ]);
    const value = run(text("line"));
    expect(pointsOf(value.layout, 0)).toHaveLength(2);
    expectClean(value);
  });
});

describe("outlines", () => {
  test.each(["circle", "diamond"])(
    "%s: anchors at the ends of every side meet the outline",
    (component) => {
      const sides = ["north", "east", "south", "west"];
      const edges = sides.flatMap((side) =>
        ["0", "1"].map((offset) => ({
          from: side === "north" ? "n" : side === "south" ? "s" : side === "east" ? "e" : "w",
          to: "c",
          toAnchor: `${side}:${offset}`,
          component: "line",
        })),
      );
      const value = run(
        figure(
          {
            stack: {
              gap: "12mm",
              items: ["n", { row: { gap: "12mm", items: ["w", "c", "e"] } }, "s"],
            },
          },
          [
            box("n"),
            box("s"),
            box("e"),
            box("w"),
            { id: "c", component, label: "C", props: { width: "40pt", height: "40pt" } },
          ],
          edges,
        ),
      );
      const c = rectOf(value.layout, "c");
      const report = checkRoutes(value.ir, value.layout);
      expect(report.endpointMisses).toEqual([]);
      // At an end of a side, the outline is the shape's extreme point on the
      // perpendicular line: a circle's (and a diamond's) left / right / top / bottom.
      const north0 = pointsOf(value.layout, 0).at(-1) as Point;
      expect(north0.x).toBeCloseTo(c.x, 3);
      expect(north0.y).toBeCloseTo(c.y + c.height / 2, 3);
    },
  );
});

describe("checkRoutes catches what the router must not do", () => {
  const text = figure(
    { row: { items: ["a", "b"] } },
    [box("a"), box("b")],
    [{ from: "a", to: "b" }],
  );
  const value = run(text);
  const corrupt = (points: Point[]) => {
    const layout = structuredClone(value.layout) as LayoutIR;
    const edge = layout.edges[0] as EdgeLayout & { route: { points: Point[] } };
    edge.route.points = points;
    return checkRoutes(value.ir, layout);
  };
  const [start, end] = pointsOf(value.layout, 0) as [Point, Point];
  const a = rectOf(value.layout, "a");

  test("leaving a port inward and turning back inside the source", () => {
    const report = corrupt([start, { x: a.x + a.width / 2, y: start.y }, end]);
    expect(report.endpointMisses).toEqual(["e:#0 from n:a: not away from the element"]);
    expect(report.malformed).toEqual([
      `e:#0 straight or turning back at ${a.x + a.width / 2},${start.y}`,
    ]);
  });

  test("going back through its own source", () => {
    const report = corrupt([
      start,
      { x: start.x + 6, y: start.y },
      { x: start.x + 6, y: a.y - 10 },
      { x: a.x + 10, y: a.y - 10 },
      { x: a.x + 10, y: a.y + a.height + 10 },
      { x: end.x - 6, y: a.y + a.height + 10 },
      { x: end.x - 6, y: end.y },
      end,
    ]);
    expect(report.throughNode).toEqual(["e:#0 back through its end n:a"]);
  });

  test("repeated points", () => {
    expect(corrupt([start, start, end]).malformed).toEqual([
      `e:#0 repeats ${start.x},${start.y}`,
      `e:#0 straight or turning back at ${start.x},${start.y}`,
    ]);
  });
});

describe("edge labels", () => {
  test("next to the arrowhead: above a horizontal last segment, before the arrowhead", () => {
    const value = run(
      figure(
        { row: { items: ["a", "b"] } },
        [box("a"), box("b")],
        [{ from: "a", to: "b", label: "x" }],
      ),
    );
    const route = edgeOf(value.layout, 0).route;
    const label = route?.label;
    if (label === undefined || route === undefined) throw new Error("no label");
    const tip = route.points.at(-1) as Point;
    expect(label.box.y + label.box.height).toBeCloseTo(tip.y - 3, 3);
    expect(label.box.x + label.box.width).toBeCloseTo(tip.x - arrowheadLength(1) - 3, 3);
    expect(label.lines).toEqual(["x"]);
    expectClean(value);
  });
});

test("simplify and mergeSegments", () => {
  expect(
    simplify([
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 5 },
      { x: 0, y: 10 },
      { x: 5, y: 10 },
    ]),
  ).toEqual([
    { x: 0, y: 0 },
    { x: 0, y: 10 },
    { x: 5, y: 10 },
  ]);
  expect(
    mergeSegments([
      [
        { x: 0, y: 0 },
        { x: 0, y: 10 },
        { x: 5, y: 10 },
      ],
      [
        { x: 0, y: 0 },
        { x: 0, y: 10 },
        { x: -5, y: 10 },
      ],
    ]),
  ).toEqual([
    [
      { x: -5, y: 10 },
      { x: 5, y: 10 },
    ],
    [
      { x: 0, y: 0 },
      { x: 0, y: 10 },
    ],
  ]);
});

describe.each(["a-transformer", "b-adaln-panel"])("%s (bundled fonts)", (name) => {
  const text = readFileSync(`${fixtures}/figures/layout/${name}.sumi.yaml`, "utf8");
  const routed = () => {
    const result = layoutStructuredFigure(text);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    return result.value;
  };

  test("no edge through a node, no misplaced end, no crossing, touch or overlap of nets", () => {
    const value = routed();
    const report = checkRoutes(value.ir, value.layout);
    expect(report).toEqual({
      unrouted: [],
      nonOrthogonal: [],
      malformed: [],
      throughNode: [],
      endpointMisses: [],
      crossings: [],
      contacts: [],
      overlaps: [],
      shortArrowSegments: [],
      labelCollisions: [],
      outside: [],
    });
    expect(routeProblemCount(report)).toBe(0);
  });

  test("is byte-identical across runs and matches the golden routed Layout IR", () => {
    const first = `${JSON.stringify(routed().layout, null, 2)}\n`;
    expect(`${JSON.stringify(routed().layout, null, 2)}\n`).toBe(first);
    const golden = `${goldens}/${name}.routed.layout.json`;
    if (update) {
      mkdirSync(goldens, { recursive: true });
      writeFileSync(golden, first);
    }
    expect(first).toBe(readFileSync(golden, "utf8"));
  });
});

test("figure A: the fan-outs and the shared trunk of the encoder output", () => {
  const { layout } = (() => {
    const result = layoutStructuredFigure(
      readFileSync(`${fixtures}/figures/layout/a-transformer.sumi.yaml`, "utf8"),
    );
    if (!result.ok) throw new Error("A does not lay out");
    return result.value;
  })();
  const netOf = (index: number) => edgeOf(layout, index).route?.net;
  // enc-split1 → Q, K, V and the residual: one net.
  expect(new Set([4, 5, 6, 7].map(netOf)).size).toBe(1);
  // enc-add → enc-split1 joins it too (it ends at the junction).
  expect(netOf(3)).toBe(netOf(4));
  // The encoder output → K and V: one net, starting with a shared trunk.
  expect(netOf(22)).toBe(netOf(23));
  expect(pointsOf(layout, 22).slice(0, 3)).toEqual(pointsOf(layout, 23).slice(0, 3));
  // Different from the decoder's own query net.
  expect(netOf(22)).not.toBe(netOf(20));
});

/**
 * Synthetic figures of 100 nodes (bundled fonts), for the time recorded in
 * the design doc (§6.22). Deterministic pseudo-random labels and edges.
 */
function synthetic(kind: "columns" | "grid"): string {
  let seed = kind === "columns" ? 12345 : 7;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const nodes: unknown[] = [];
  const edges: unknown[] = [];
  const label = (text: string, max: number) => `${text}${"x".repeat(Math.floor(rand() * max))}`;
  if (kind === "columns") {
    // 5 groups × 20 stacked boxes: chains, skip connections into the west
    // side, and links between neighbouring groups.
    const groups: { id: string; arrange: unknown }[] = [];
    for (let c = 0; c < 5; c++) {
      const items: string[] = [];
      for (let r = 0; r < 20; r++) {
        const id = `n${c}-${r}`;
        items.push(id);
        nodes.push({ id, component: "box", label: label(`Block ${c}.${r}`, 8) });
        if (r > 0) edges.push({ from: `n${c}-${r - 1}`, to: id });
        if (r > 2 && rand() < 0.2) edges.push({ from: `n${c}-${r - 3}`, to: id, toAnchor: "west" });
      }
      groups.push({ id: `g${c}`, arrange: { stack: { gap: "4mm", items } } });
      for (let k = 0; c > 0 && k < 4; k++) {
        const a = Math.floor(rand() * 20);
        const b = Math.floor(rand() * 20);
        edges.push({ from: `n${c - 1}-${a}`, to: `n${c}-${b}` });
      }
    }
    const arrange = { row: { gap: "8mm", items: groups.map((g) => g.id) } };
    return stringify({
      version: 1,
      figure: { id: "s", profile: "paper-double", layout: { arrange } },
      groups,
      nodes,
      edges,
    });
  }
  // 10 × 10 boxes without groups, 150 edges between random nodes.
  const stacks: unknown[] = [];
  for (let c = 0; c < 10; c++) {
    const items: string[] = [];
    for (let r = 0; r < 10; r++) {
      items.push(`n${c}-${r}`);
      nodes.push({ id: `n${c}-${r}`, component: "box", label: label(`B${c}.${r}`, 6) });
    }
    stacks.push({ stack: { gap: "6mm", items } });
  }
  for (let k = 0; k < 150; k++) {
    const a = `n${Math.floor(rand() * 10)}-${Math.floor(rand() * 10)}`;
    const b = `n${Math.floor(rand() * 10)}-${Math.floor(rand() * 10)}`;
    if (a !== b) edges.push({ from: a, to: b });
  }
  const arrange = { row: { gap: "6mm", items: stacks } };
  return stringify({
    version: 1,
    figure: { id: "s", profile: "paper-double", layout: { arrange } },
    nodes,
    edges,
  });
}

describe.each(["columns", "grid"] as const)("synthetic 100-node figure: %s", (kind) => {
  // The time is logged, not asserted (CI runners, with coverage, vary too
  // much for a bound that is useful and not flaky); the design doc records
  // it. The explicit timeout is only a safety margin.
  test("routes every edge cleanly (crossings aside) and deterministically", () => {
    const placed = layoutStructuredFigure(synthetic(kind), { route: false });
    if (!placed.ok) throw new Error(JSON.stringify(placed.diagnostics));
    const { ir, layout } = placed.value;
    const first = routeEdges(ir, layout);
    const start = performance.now();
    const result = routeEdges(ir, layout);
    const time = performance.now() - start;
    expect(JSON.stringify(result.layout)).toBe(JSON.stringify(first.layout));
    console.log(
      `router, synthetic ${kind}: ${layout.nodes.length} nodes, ${layout.edges.length} edges, ${time.toFixed(0)}ms`,
    );
    expect(result.diagnostics).toEqual([]);
    const report = checkRoutes(ir, result.layout);
    expect({ ...report, crossings: [] }).toEqual({
      unrouted: [],
      nonOrthogonal: [],
      malformed: [],
      throughNode: [],
      endpointMisses: [],
      crossings: [],
      contacts: [],
      overlaps: [],
      shortArrowSegments: [],
      labelCollisions: [],
      outside: [],
    });
  }, 60_000);
});
