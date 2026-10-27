import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { stringify } from "yaml";
import type { ElementKey } from "../../core/check-state";
import { type LayoutFigureOptions, layoutStructuredFigure } from "../index";
import type { EdgeLayout, LayoutIR, Point, Rect } from "../ir";
import type { TextMeasurer } from "../text";
import { checkRoutes, type RouteCheckReport, routeProblemCount } from "./check";
import { MAX_REPORTED_CROSSINGS } from "./crossings";
import { resolveEnds } from "./ports";
import {
  arrowheadLength,
  arrowRoom,
  mergeSegments,
  routeEdges,
  simplify,
  WIRE_CORNER_RADIUS,
} from "./router";

const fixtures = `${import.meta.dir}/../../../tests/fixtures`;
/** #113's reproduction (research/109-dogfood-v0.4, A2): `api → worker` + `worker → store` at one port. */
const sharedSegment = `${import.meta.dir}/../../../research/109-dogfood-v0.4/repro/shared-segment.sumi.yaml`;
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

/** Length of an axis-parallel segment. */
const span = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/**
 * For every edge with a target arrowhead: the length of its last segment and
 * the nearest point to its tip, on that segment, where another route of its
 * net turns off it or onto it (a fork), as distances from the tip.
 */
function arrowApproaches(layout: LayoutIR): { last: number; fork: number }[] {
  const routed = layout.edges.filter((e) => e.route !== undefined);
  return routed.map((edge) => {
    const points = edge.route?.points ?? [];
    const tip = points.at(-1) as Point;
    const corner = points.at(-2) as Point;
    let fork = Number.POSITIVE_INFINITY;
    for (const other of routed) {
      if (other === edge || other.route?.net !== edge.route?.net) continue;
      const theirs = other.route?.points ?? [];
      const end = theirs.at(-1) as Point;
      if (end.x === tip.x && end.y === tip.y) continue; // the same port
      for (const p of theirs) {
        const on =
          (corner.x === tip.x &&
            p.x === tip.x &&
            span(p, tip) + span(p, corner) === span(corner, tip)) ||
          (corner.y === tip.y &&
            p.y === tip.y &&
            span(p, tip) + span(p, corner) === span(corner, tip));
        if (on) fork = Math.min(fork, span(p, tip));
      }
    }
    return { last: span(corner, tip), fork };
  });
}

describe("room before an arrowhead (#116)", () => {
  test("after a turn: the arrowhead's length plus the corner radius", () => {
    const value = run(
      figure(
        { row: { gap: "10mm", items: ["a", "b"] } },
        [box("a"), box("b")],
        [{ from: "a", to: "b", fromAnchor: "south", toAnchor: "west:0.2" }],
      ),
    );
    const [p, q] = pointsOf(value.layout, 0).slice(-2) as [Point, Point];
    expect(q.x - p.x).toBeGreaterThanOrEqual(arrowRoom(1));
    expect(arrowRoom(1)).toBe(arrowheadLength(1) + WIRE_CORNER_RADIUS);
    expectClean(value);
  });

  // The reproduction (research/109-dogfood-v0.4, A7): a gateway fanning out
  // to three services. The branches used to leave the shared trunk right
  // where the middle edge's arrowhead starts.
  test("a fan-out forks off the trunk no closer to an arrowhead than the room", () => {
    const value = run(
      figure(
        {
          row: {
            gap: "6mm",
            align: "center",
            items: ["gw", { stack: { gap: "4mm", items: ["x", "y", "z"] } }],
          },
        },
        [box("gw"), box("x"), box("y"), box("z")],
        [
          { from: "gw", to: "x" },
          { from: "gw", to: "y" },
          { from: "gw", to: "z" },
        ],
      ),
    );
    const approaches = arrowApproaches(value.layout);
    expect(approaches.map((a) => a.last >= arrowRoom(1))).toEqual([true, true, true]);
    for (const { fork } of approaches) expect(fork).toBeGreaterThanOrEqual(arrowRoom(1));
    expectClean(value);
  });

  test("a gap too narrow for the room still routes, with the arrowhead's stub", () => {
    // 3mm = 17 units between the boxes: the source stub (6) and the room (16)
    // do not fit, the stub (8) does.
    const value = run(
      figure(
        { stack: { gap: "3mm", items: ["a", "b"] } },
        [box("a"), box("b")],
        [{ from: "a", to: "b", fromAnchor: "south:0.2", toAnchor: "north:0.8" }],
      ),
    );
    const points = pointsOf(value.layout, 0);
    const [p, q] = points.slice(-2) as [Point, Point];
    expect(points).toHaveLength(4);
    expect(q.y - p.y).toBeGreaterThanOrEqual(arrowheadLength(1));
    expect(q.y - p.y).toBeLessThan(arrowRoom(1));
    expectClean(value);
  });

  test("where only the stub's end is free to turn at, the edge still routes (review of #116)", () => {
    // The grid has a line at the room's end, not the stub's. Here a wall
    // ends 9 units before the target's port: the stub (8) fits, the room
    // (16) does not, and no other line lies in between, so the figure is
    // routed again with lines at the stubs' ends as well.
    const placed = layoutStructuredFigure(
      figure(
        { row: { items: ["a", "b", "wall"] } },
        [box("a"), box("b"), box("wall")],
        [{ from: "a", to: "b", fromAnchor: "east", toAnchor: "west" }],
      ),
      { measurer: FAKE, route: false },
    );
    if (!placed.ok) throw new Error(JSON.stringify(placed.diagnostics));
    const rects = [
      { x: -60, y: 0, width: 20, height: 20 },
      { x: 0, y: 40, width: 20, height: 20 },
      { x: -29, y: 40, width: 20, height: 20 },
    ];
    const layout: LayoutIR = {
      ...placed.value.layout,
      // Labels dropped: they would be outside the moved boxes.
      nodes: placed.value.layout.nodes.map(({ label: _label, ...n }, i) => ({
        ...n,
        rect: rects[i] as Rect,
      })),
      content: { x: -60, y: 0, width: 100, height: 80 },
    };
    const result = routeEdges(placed.value.ir, layout, { verifyLowerBound: true });
    expect(result.diagnostics).toEqual([]);
    const [p, q] = (result.layout.edges[0]?.route?.points ?? []).slice(-2) as [Point, Point];
    expect(q.x - p.x).toBe(arrowheadLength(1));
  });

  test("inside a group too tight for the room, a route keeps to the group as before", () => {
    // Figure A's residuals: the encoder's padding (16) is no wider than the
    // room, and the route stays inside instead of going around the border.
    const value = run(readFileSync(`${fixtures}/figures/layout/a-transformer.sumi.yaml`, "utf8"));
    const encoder = rectOf(value.layout, "encoder");
    const residual = value.layout.edges.find(
      (e) => e.from === "n:enc-split1" && e.to === "n:enc-norm1",
    );
    for (const p of residual?.route?.points ?? []) {
      expect(p.x).toBeGreaterThan(encoder.x);
      expect(p.y).toBeLessThan(encoder.y + encoder.height);
    }
    // The attention inputs, which have the room, fork off with it.
    const inputs = arrowApproaches(value.layout).filter(
      (_, i) => value.layout.edges[i]?.to === "n:enc-mha",
    );
    expect(inputs.length).toBe(3);
    for (const { last, fork } of inputs) {
      expect(last).toBeGreaterThanOrEqual(arrowRoom(1));
      expect(fork).toBeGreaterThanOrEqual(arrowRoom(1));
    }
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

describe("edges into and out of one port (#113)", () => {
  test("the reproduction: two nets that share no line, one straight", () => {
    const result = layoutStructuredFigure(readFileSync(sharedSegment, "utf8"));
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const value = result.value;
    const { layout } = value;
    expect(layout.nets?.map((n) => n.edges)).toEqual([["e:#0"], ["e:#1"]]);
    const into = pointsOf(layout, 0);
    const out = pointsOf(layout, 1);
    const worker = rectOf(layout, "worker");
    // `worker → store` keeps its anchor (west, the middle); `api → worker`
    // has none, so it moves up (away from the store), and its end at api
    // moves with it: still one straight line.
    expect(out[0]).toEqual({ x: worker.x, y: worker.y + worker.height / 2 });
    expect(into).toHaveLength(2);
    expect((into[1] as Point).x).toBe(worker.x);
    expect((into[1] as Point).y).toBe(worker.y + worker.height / 4);
    expectClean(value);
  });

  test("edges leaving one port still share a trunk with each other, not with one entering it", () => {
    const value = run(
      figure(
        { stack: { items: [{ row: { items: ["a", "x"] } }, { row: { items: ["b", "c"] } }] } },
        [box("a"), box("x"), box("b"), box("c")],
        [
          { from: "a", to: "x" },
          { from: "x", to: "b", fromAnchor: "west" },
          { from: "x", to: "c", fromAnchor: "west" },
        ],
      ),
    );
    const { layout } = value;
    expect(layout.nets?.map((n) => n.edges)).toEqual([["e:#0"], ["e:#1", "e:#2"]]);
    expect(pointsOf(layout, 1).slice(0, 2)).toEqual(pointsOf(layout, 2).slice(0, 2));
    expectClean(value);
  });

  test("both directions anchored at one point: layout/no-route for the later one", () => {
    const text = figure(
      { stack: { items: [{ row: { items: ["a", "x"] } }, "b"] } },
      [box("a"), box("x"), box("b")],
      [
        { from: "a", to: "x", toAnchor: "west" },
        { from: "x", to: "b", fromAnchor: "west" },
      ],
    );
    const result = layoutStructuredFigure(text, { measurer: FAKE });
    expect(result.diagnostics.map((d) => [d.code, d.path])).toEqual([
      ["layout/no-route", ["edges", 1]],
    ]);
    expect(result.diagnostics[0]?.message).toBe(
      'No route was found for edge edges[1] from "x" to "b": an edge leaving and an edge entering the same element are anchored at the same point of it, so they would share a line.',
    );
  });

  test("a bridged net in a narrow gap: the branch leaves before the other edge's stub", () => {
    // The trunk a → b is free for a → c, but where d → b's stub starts it
    // would touch d → b (one net, not joined): that point still costs.
    const value = run(
      figure(
        { row: { items: ["d", { stack: { gap: "8pt", items: ["a", "b"] } }, "c"] } },
        [box("a"), box("b"), box("c"), box("d")],
        [
          { from: "a", to: "b" },
          { from: "a", to: "c", fromAnchor: "south" },
          { from: "d", to: "b", toAnchor: "north" },
        ],
      ),
    );
    const branch = pointsOf(value.layout, 1)[1] as Point;
    const merge = pointsOf(value.layout, 2).at(-2) as Point;
    expect(branch.y).toBeLessThan(merge.y);
    expectClean(value);
  });

  test("moves that keep meeting other ports end at the first free position", () => {
    // x's north side is taken at 1/2 + 1/4 + 1/8 … by edges leaving it: the
    // unanchored a → x cannot halve its way out, and takes 1/4.
    const edges = [
      ...Array.from({ length: 9 }, (_, i) => ({
        from: "x",
        to: "b",
        fromAnchor: `north:${1 - 2 ** -(i + 1)}`,
        component: "line",
      })),
      { from: "a", to: "x", component: "line" },
    ];
    const value = run(
      figure({ stack: { items: ["a", "x", "b"] } }, [box("a"), box("x"), box("b")], edges),
    );
    const x = rectOf(value.layout, "x");
    expect((pointsOf(value.layout, 9).at(-1) as Point).x).toBe(x.x + x.width / 4);
  });

  test("a side with no free position left: layout/no-route says so, not 'anchored'", () => {
    // Groups only (resolveEnds needs no nodes): x's north side holds an
    // anchored edge leaving at 1/2 and at every k/1024 the fallback tries.
    const offsets = [0.5];
    for (let d = 4; d <= 1024; d *= 2) for (let k = 1; k < d; k += 2) offsets.push(k / d);
    const edges = [
      ...offsets.map((offset, i) => ({
        key: `e:${i}`,
        from: "g:x",
        to: "g:b",
        fromAnchor: { side: "north", offset },
      })),
      { key: "e:in", from: "g:a", to: "g:x" },
    ];
    const rect = (y: number) => ({ x: 100, y, width: 100, height: 20 });
    const groups = [
      { key: "g:a", rect: rect(0) },
      { key: "g:x", rect: rect(100) },
      { key: "g:b", rect: rect(200) },
    ];
    const ends = resolveEnds(
      { nodes: [], edges } as unknown as Parameters<typeof resolveEnds>[0],
      { nodes: [], groups } as unknown as Parameters<typeof resolveEnds>[1],
    );
    expect(ends.at(-1)).toEqual({
      error:
        "an edge leaving and an edge entering the same element would share a point of it, and no free position is left on that side",
    });
  });

  test("checkRoutes: a group's side entered from outside and from inside is two ports", () => {
    const value = run(
      figure(
        { stack: { items: ["x", "g"] } },
        [box("x"), box("a")],
        [
          { from: "x", to: "g", toAnchor: "north", component: "line" },
          { from: "a", to: "g", toAnchor: "north", component: "line" },
        ],
        [{ id: "g", label: "g", arrange: { stack: { items: ["a"] } } }],
      ),
    );
    expect(new Set(value.layout.edges.map((e) => e.route?.net)).size).toBe(2);
    expect(checkRoutes(value.ir, value.layout).misjoinedNets).toEqual([]);
  });

  test("a net bridged by an edge that shares a port with each: the two others share no line", () => {
    // a → b shares a's south port with a → c and b's north port with d → b:
    // one net, but a → c and d → b may only meet, never run along each other.
    const value = run(
      figure(
        { row: { items: ["d", { stack: { gap: "12mm", items: ["a", "b"] } }, "c"] } },
        [box("a"), box("b"), box("c"), box("d")],
        [
          { from: "a", to: "b" },
          { from: "a", to: "c", fromAnchor: "south" },
          { from: "d", to: "b", toAnchor: "north" },
        ],
      ),
    );
    expect(value.layout.nets?.map((n) => n.edges)).toEqual([["e:#0", "e:#1", "e:#2"]]);
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

  test("names the nodes in the way, as related locations (#114)", () => {
    // research/109-dogfood-v0.4 A5: a note attached under `a` fills the gap
    // that a → b must leave through.
    const text = figure(
      { stack: { gap: "3mm", items: ["a", "b"] } },
      [
        box("a"),
        box("b"),
        { id: "note", component: "label", label: "n", attach: { to: "a", side: "south" } },
      ],
      [{ from: "a", to: "b", fromAnchor: "south", toAnchor: "north" }],
    );
    const result = layoutStructuredFigure(text, { measurer: FAKE });
    expect(result.diagnostics.map((d) => d.code)).toEqual(["layout/no-route"]);
    const [diagnostic] = result.diagnostics;
    expect(diagnostic?.message).toBe(
      'No route was found for edge edges[0] from "a" to "b": every path is blocked by nodes or too narrow for its stubs (in the way: "note").',
    );
    expect(diagnostic?.related).toEqual([
      {
        path: ["nodes", 2],
        location: expect.objectContaining({ line: text.split("\n").indexOf("  - id: note") + 1 }),
        message: 'Node "note" is in the way.',
      },
    ]);
    expect(diagnostic?.hint).toContain('"note" is attached to "a"');
    expect(diagnostic?.hint).toContain("takes no space in the arrange tree");
  });

  test("a junction that is not an end blocks too, and is named", () => {
    const text = figure(
      { stack: { gap: "3mm", items: ["a", "b"] } },
      [box("a"), box("b"), { ...junction("j"), attach: { to: "a", side: "south", gap: "0.5mm" } }],
      [{ from: "a", to: "b", fromAnchor: "south", toAnchor: "north" }],
    );
    const result = layoutStructuredFigure(text, { measurer: FAKE });
    const [diagnostic] = result.diagnostics;
    expect(diagnostic?.code).toBe("layout/no-route");
    expect(diagnostic?.message).toEndWith('(in the way: "j").');
    expect(diagnostic?.related?.map((r) => [r.path, r.message])).toEqual([
      [["nodes", 2], 'Node "j" is in the way.'],
    ]);
    expect(diagnostic?.hint).toContain('"j" is attached to "a"');
  });

  test("blockers on both stubs, in layout order; no attach advice for nodes in the tree", () => {
    // a and b face each other east → west across x (touching a) and y (touching b).
    const text = figure(
      { row: { gap: 0, items: ["a", "x", "y", "b"] } },
      [box("a"), box("x"), box("y"), box("b")],
      [{ from: "a", to: "b", fromAnchor: "east", toAnchor: "west" }],
    );
    const result = layoutStructuredFigure(text, { measurer: FAKE });
    const [diagnostic] = result.diagnostics;
    expect(diagnostic?.message).toBe(
      'No route was found for edge edges[0] from "a" to "b": every path is blocked by nodes or too narrow for its stubs (in the way: "x", "y").',
    );
    expect(diagnostic?.related?.map((r) => [r.path, r.message])).toEqual([
      [["nodes", 1], 'Node "x" is in the way.'],
      [["nodes", 2], 'Node "y" is in the way.'],
    ]);
    expect(diagnostic?.hint).not.toContain("attached");
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

describe("the A* lower bound", () => {
  // Edges into one target port share a trunk: the bound must not count the
  // target's stub as unreachable through the net (a reviewer's reproduction).
  const fanIn = () => {
    const xs = [3, 4, 1, 2, 3, 5, 3, 3, 1];
    const nodes = xs
      .map((_, i) => `n${i}`)
      .map((id, i) => ({
        id,
        component: "box",
        label: `${id}${"x".repeat(xs[i] as number)}`,
      }));
    const column = (k: number) => ({
      stack: { gap: "6mm", items: [0, 1, 2].map((r) => `n${3 * k + r}`) },
    });
    const ends: [string, string][] = [
      ["n8", "west"],
      ["n8", "north"],
      ["n7", "south"],
      ["n1", "north"],
      ["n6", "south"],
      ["n6", "west"],
    ];
    return stringify({
      version: 1,
      figure: {
        id: "t",
        theme: "academic",
        layout: { arrange: { row: { gap: "6mm", items: [0, 1, 2].map(column) } } },
      },
      nodes,
      edges: ends.map(([from, side]) => ({
        from,
        fromAnchor: side,
        to: "n5",
        toAnchor: "south",
      })),
    });
  };

  test.each([
    ["fan-in to one port", fanIn(), FAKE],
    [
      "figure A",
      readFileSync(`${fixtures}/figures/layout/a-transformer.sumi.yaml`, "utf8"),
      undefined,
    ],
    [
      "figure B",
      readFileSync(`${fixtures}/figures/layout/b-adaln-panel.sumi.yaml`, "utf8"),
      undefined,
    ],
    // Nets per direction (#113): the bound still only counts the net's points.
    ["#113's reproduction", readFileSync(sharedSegment, "utf8"), undefined],
    ["synthetic columns (bridged nets)", synthetic("columns"), undefined],
    ["synthetic grid", synthetic("grid"), undefined],
  ])("%s: the same route costs as without it (Dijkstra)", (_name, text, measurer) => {
    const placed = layoutStructuredFigure(text, {
      route: false,
      ...(measurer !== undefined && { measurer }),
    });
    if (!placed.ok) throw new Error(JSON.stringify(placed.diagnostics));
    const { ir, layout } = placed.value;
    // Every edge costs the same with Dijkstra on the same occupancy (#116:
    // routes of equal cost may differ, so whole layouts are not compared).
    const fast = routeEdges(ir, layout, { verifyLowerBound: true });
    expect(fast.diagnostics.filter((d) => d.code !== "layout/edge-crossing")).toEqual([]);
    expect(JSON.stringify(fast.layout)).toBe(JSON.stringify(routeEdges(ir, layout).layout));
  });
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

  /** The label keeps the gap from every segment of every route. */
  const expectLabelClear = (layout: LayoutIR, box: Rect) => {
    for (const edge of layout.edges) {
      for (const [a, b] of mergeSegments([edge.route?.points ?? []])) {
        const apart =
          Math.max(a.x, b.x) <= box.x - 3 + 1e-6 ||
          Math.min(a.x, b.x) >= box.x + box.width + 3 - 1e-6 ||
          Math.max(a.y, b.y) <= box.y - 3 + 1e-6 ||
          Math.min(a.y, b.y) >= box.y + box.height + 3 - 1e-6;
        expect(apart).toBe(true);
      }
    }
  };

  // The reproduction (research/109-dogfood-v0.4, A8): `update θ` from
  // AdamW's south side to the model's. The last segment is shorter than the
  // label, which covered the route's previous segment (a dashed stub that
  // looked like a dot).
  test("a short last segment: on the other side, clear of the route's own corner (#116)", () => {
    const value = run(
      figure(
        { row: { gap: "10mm", items: ["model", "optimizer"] } },
        [box("model"), box("optimizer")],
        [
          {
            from: "optimizer",
            to: "model",
            fromAnchor: "south",
            toAnchor: "south",
            label: "update θ",
          },
        ],
      ),
    );
    const route = edgeOf(value.layout, 0).route;
    const label = route?.label;
    if (label === undefined || route === undefined) throw new Error("no label");
    const [corner, tip] = route.points.slice(-2) as [Point, Point];
    // Up into the model; the segment before runs right, under the label's first place.
    expect(corner.x).toBe(tip.x);
    expect(corner.y - tip.y).toBeLessThan(label.box.height + arrowheadLength(1) + 3);
    // Left of the last segment, behind the arrowhead.
    expect(label.box.x + label.box.width).toBeCloseTo(tip.x - 3, 3);
    expect(label.box.y).toBeCloseTo(tip.y + arrowheadLength(1) + 3, 3);
    expectLabelClear(value.layout, label.box);
    expectClean(value);
  });

  test("a trunk that forks off right behind the arrowhead: the label goes past it (#116)", () => {
    // Figure B's bus: four taps from one port. Each tap's label sits beside
    // its last segment, past the bus rather than across it.
    const value = run(readFileSync(`${fixtures}/figures/layout/b-adaln-panel.sumi.yaml`, "utf8"));
    const labelled = value.layout.edges.filter((e) => e.route?.label !== undefined);
    expect(labelled.length).toBe(4);
    for (const edge of labelled) {
      const label = edge.route?.label;
      if (label === undefined) throw new Error("no label");
      expectLabelClear(value.layout, label.box);
    }
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

describe.each(["a-transformer", "b-adaln-panel", "group-label-at", "group-caption", "align-unet", "align-side-kv"])(
  "%s (bundled fonts)",
  (name) => {
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
        misjoinedNets: [],
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
  },
);

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
    // Only crossings (#133): 10 listed and a summary of the rest. The number
    // of crossing points is checked against checkRoutes' edge pairs (the
    // distinct net pairs and points among them).
    const total = { columns: 23, grid: 1233 }[kind];
    const netOf = new Map(result.layout.edges.map((e) => [e.key, e.route?.net]));
    const points = new Set(
      checkRoutes(ir, result.layout).crossings.map((c) => {
        const [, p, q, at] = c.match(/^(\S+) × (\S+) at (.+)$/) as RegExpMatchArray;
        const nets = [netOf.get(p as ElementKey), netOf.get(q as ElementKey)].sort();
        return `${nets.join(" ")} ${at}`;
      }),
    );
    expect(points.size).toBe(total);
    expect(result.diagnostics.map((d) => [d.code, d.severity])).toEqual(
      Array.from({ length: MAX_REPORTED_CROSSINGS + 1 }, () => ["layout/edge-crossing", "info"]),
    );
    expect(result.diagnostics[MAX_REPORTED_CROSSINGS]?.message).toBe(
      `${total - 10} more edge crossings are not listed (${total} in total).`,
    );
    const report = checkRoutes(ir, result.layout);
    // The grid (150 random edges among 100 boxes 6mm apart) is close to the
    // worst case: its gutters are too crowded for a greedy router to keep
    // every contact and overlap away. Until #113 it reported none only
    // because edges into and out of one port were joined into one net, which
    // hid 91 overlaps (design doc §6.22); the bound keeps it from
    // getting worse.
    const crowded = kind === "grid";
    if (crowded) {
      expect(report.contacts.length).toBeLessThanOrEqual(20);
      expect(report.overlaps.length).toBeLessThanOrEqual(7);
    }
    expect({
      ...report,
      crossings: [],
      ...(crowded && { contacts: [], overlaps: [] }),
    }).toEqual({
      unrouted: [],
      nonOrthogonal: [],
      malformed: [],
      throughNode: [],
      endpointMisses: [],
      misjoinedNets: [],
      crossings: [],
      contacts: [],
      overlaps: [],
      shortArrowSegments: [],
      labelCollisions: [],
      outside: [],
    });
  }, 60_000);
});
