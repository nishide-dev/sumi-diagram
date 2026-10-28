/**
 * `straight` anchors (#179, design doc §6.47): the end sits in line with the
 * other end on the side facing it, and falls back to a default end with
 * `layout/straight-off-side` where there is no such side. Needs no D2.
 */

import { describe, expect, test } from "bun:test";
import { stringify } from "yaml";
import type { Diagnostic } from "../../core/diagnostics";
import { type LayoutFigureOptions, layoutStructuredFigure } from "../index";
import { type LayoutIR, type Point, type Rect, roundUnits } from "../ir";
import { placeStructured } from "../structured/engine";
import type { TextMeasurer } from "../text";
import { checkRoutes } from "./check";
import {
  STRAIGHT_MARGIN,
  straightMarginDistance,
  straightOffset,
  straightPlacement,
} from "./ports";
import { routeEdges } from "./router";

/** Every character is half an em wide; ascender 0.8 em, descender 0.2 em. */
const FAKE: TextMeasurer = {
  lineWidth: (text, _font, size) => ([...text].length * size) / 2,
  verticalMetrics: (_font, size) => ({ ascent: 0.8 * size, descent: 0.2 * size }),
};

function layout(text: string, options: LayoutFigureOptions = {}) {
  const result = layoutStructuredFigure(text, { measurer: FAKE, ...options });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  return { ...result.value, diagnostics: result.diagnostics };
}

function figure(
  arrange: unknown,
  nodes: unknown[],
  edges: unknown[],
  extra: { groups?: unknown[]; fanIn?: string } = {},
) {
  return stringify({
    version: 1,
    figure: {
      id: "t",
      theme: "academic",
      layout: { arrange, ...(extra.fanIn !== undefined && { fanIn: extra.fanIn }) },
    },
    groups: extra.groups ?? [],
    nodes,
    edges,
  });
}

const box = (id: string, width = "40pt", height = "20pt") => ({
  id,
  component: "box",
  label: id,
  props: { width, height },
});

const rectOf = (l: LayoutIR, id: string): Rect => {
  const element =
    l.nodes.find((n) => n.key === `n:${id}`) ?? l.groups.find((g) => g.key === `g:${id}`);
  if (element === undefined) throw new Error(`no ${id}`);
  return element.rect;
};
const pointsOf = (l: LayoutIR, index: number): readonly Point[] =>
  l.edges[index]?.route?.points ?? [];
const netOf = (l: LayoutIR, index: number) => l.edges[index]?.route?.net;
const centreX = (r: Rect) => roundUnits(r.x + r.width / 2);
const codes = (diagnostics: readonly Diagnostic[]) => diagnostics.map((d) => d.code);

/** No problems in the routed layout, and the A* lower bound is admissible on it. */
function expectClean(value: ReturnType<typeof layout>) {
  const report = checkRoutes(value.ir, value.layout);
  expect(Object.entries(report).filter(([, list]) => list.length > 0)).toEqual([]);
  const placed = placeStructured(value.ir, { measurer: FAKE }).layout;
  expect(() => routeEdges(value.ir, placed, { verifyLowerBound: true })).not.toThrow();
}

/** A straight vertical segment at `x`. */
function expectVertical(points: readonly Point[], x: number) {
  expect(points.length).toBe(2);
  expect(points.map((p) => p.x)).toEqual([x, x]);
}

describe("straightPlacement", () => {
  const r = (x: number, y: number, width: number, height: number): Rect => ({
    x,
    y,
    width,
    height,
  });
  test("the side facing the other element, at the projection of its centre", () => {
    const wide = r(0, 100, 400, 40);
    expect(straightPlacement(wide, r(30, 0, 80, 40))).toEqual({ side: "north", offset: 70 / 400 });
    expect(straightPlacement(wide, r(30, 200, 80, 40))).toEqual({
      side: "south",
      offset: 70 / 400,
    });
    const tall = r(100, 0, 40, 400);
    expect(straightPlacement(tall, r(0, 10, 40, 20))).toEqual({ side: "west", offset: 20 / 400 });
    expect(straightPlacement(tall, r(200, 10, 40, 20))).toEqual({ side: "east", offset: 20 / 400 });
  });
  test("the exact projection, not rounded", () => {
    const at = straightPlacement(r(0, 100, 300, 40), r(0.0007, 0, 33.3331, 40));
    expect(at).toEqual({ side: "north", offset: (0.0007 + 33.3331 / 2) / 300 });
  });
  test("at least the margin inside the corners", () => {
    const wide = r(0, 100, 400, 40);
    // Centre at x = 6: on the margin, accepted; 5.999: beyond.
    expect(straightPlacement(wide, r(0, 0, 12, 40))).toEqual({ side: "north", offset: 6 / 400 });
    expect(straightPlacement(wide, r(-0.002, 0, 12, 40))).toEqual({ off: "beyond", side: "north" });
    expect(straightPlacement(wide, r(388, 0, 12, 40))).toEqual({
      side: "north",
      offset: 394 / 400,
    });
    expect(straightPlacement(wide, r(388.002, 0, 12, 40))).toEqual({
      off: "beyond",
      side: "north",
    });
    expect(STRAIGHT_MARGIN).toBe(6);
    // A side shorter than twice the margin takes only its middle.
    expect(straightOffset(r(0, 0, 8, 8), "north", 4)).toBe(0.5);
    expect(straightOffset(r(0, 0, 8, 8), "north", 4.01)).toBeUndefined();
  });
  test("apart diagonally, overlapping, nested", () => {
    expect(straightPlacement(r(0, 0, 40, 40), r(100, 100, 40, 40))).toEqual({ off: "diagonal" });
    expect(straightPlacement(r(0, 0, 40, 40), r(20, 20, 40, 40))).toEqual({ off: "overlap" });
    expect(straightPlacement(r(0, 0, 400, 400), r(20, 20, 40, 40))).toEqual({ off: "overlap" });
    expect(straightPlacement(r(0, 0, 40, 40), r(0, 0, 40, 40))).toEqual({ off: "overlap" });
  });
});

/** Three narrow boxes above a wide one (#151 C1, the ViT patches). */
const fanIn = (anchor: string | undefined, extra: { fanIn?: string } = {}) =>
  figure(
    {
      stack: {
        gap: "20pt",
        items: [{ row: { gap: "10pt", items: ["a", "b", "c"] } }, "t"],
      },
    },
    [box("a"), box("b", "30pt"), box("c", "50pt"), box("t", "300pt")],
    ["a", "b", "c"].map((from) => ({
      from,
      to: "t",
      ...(anchor !== undefined && { toAnchor: anchor }),
    })),
    extra,
  );

describe("toAnchor: straight", () => {
  test("each edge enters straight below its source, on a point and net of its own", () => {
    const value = layout(fanIn("straight"));
    const l = value.layout;
    for (const [index, id] of ["a", "b", "c"].entries()) {
      expectVertical(pointsOf(l, index), centreX(rectOf(l, id)));
      expect(l.edges[index]?.route).toMatchObject({ fromSide: "south", toSide: "north" });
    }
    expect(new Set([0, 1, 2].map((i) => netOf(l, i))).size).toBe(3);
    expect(codes(value.diagnostics)).toEqual([]);
    expectClean(value);
  });

  test("without it, the edges merge at the target's centre and bend", () => {
    const l = layout(fanIn(undefined)).layout;
    expect([0, 1, 2].filter((i) => pointsOf(l, i).length > 2).length).toBeGreaterThanOrEqual(2);
    expect(netOf(l, 0)).toBe(netOf(l, 2));
  });

  test("the Layout IR keeps the anchor as written", () => {
    const l = layout(fanIn("straight")).layout;
    expect(l.edges.map((e) => e.toAnchor)).toEqual(["straight", "straight", "straight"]);
  });

  test("horizontal: a row enters a tall box from the west", () => {
    const value = layout(
      figure(
        {
          row: {
            gap: "20pt",
            items: [{ stack: { gap: "10pt", items: ["a", "b"] } }, "t"],
          },
        },
        [box("a", "30pt", "14pt"), box("b", "30pt", "26pt"), box("t", "40pt", "200pt")],
        [
          { from: "a", to: "t", toAnchor: "straight" },
          { from: "b", to: "t", toAnchor: "straight" },
        ],
      ),
    );
    const l = value.layout;
    for (const [index, id] of ["a", "b"].entries()) {
      const r = rectOf(l, id);
      const points = pointsOf(l, index);
      expect(points.length).toBe(2);
      expect(points.map((p) => p.y)).toEqual([
        roundUnits(r.y + r.height / 2),
        roundUnits(r.y + r.height / 2),
      ]);
      expect(l.edges[index]?.route).toMatchObject({ fromSide: "east", toSide: "west" });
    }
    expectClean(value);
  });
});

describe("fromAnchor: straight", () => {
  test("a wide source leaves straight above a narrow target", () => {
    const value = layout(
      figure(
        {
          stack: {
            gap: "20pt",
            align: "start",
            items: ["s", { row: { gap: "100pt", items: ["x", "y"] } }],
          },
        },
        [box("s", "300pt"), box("x"), box("y")],
        [{ from: "s", to: "y", fromAnchor: "straight" }],
      ),
    );
    const l = value.layout;
    expectVertical(pointsOf(l, 0), centreX(rectOf(l, "y")));
    expect(codes(value.diagnostics)).toEqual([]);
    expectClean(value);
  });

  test("it follows a spread target end (fanIn: spread)", () => {
    // s and t are left-aligned and as wide; x also enters t's north side,
    // so the two target ends spread to 1/3 and 2/3 and s's end follows.
    const text = (fanInMode: string) =>
      figure(
        {
          stack: {
            gap: "20pt",
            align: "start",
            items: [{ row: { gap: "20pt", items: ["s", "x"] } }, "t"],
          },
        },
        [box("s", "100pt"), box("x"), box("t", "100pt")],
        [
          { from: "s", to: "t", fromAnchor: "straight" },
          { from: "x", to: "t" },
        ],
        { fanIn: fanInMode },
      );
    const spread = layout(text("spread"));
    const t = rectOf(spread.layout, "t");
    expectVertical(pointsOf(spread.layout, 0), roundUnits(t.x + t.width / 3));
    expect(netOf(spread.layout, 0)).not.toBe(netOf(spread.layout, 1));
    expectClean(spread);
    // Merged, both enter t's centre, and s's end is in line with it.
    const merged = layout(text("merge"));
    expectVertical(pointsOf(merged.layout, 0), centreX(rectOf(merged.layout, "t")));
    expectClean(merged);
  });
});

describe("layout/straight-off-side", () => {
  const offSide = (diagnostics: readonly Diagnostic[]) =>
    diagnostics.filter((d) => d.code === "layout/straight-off-side");

  /** The routes of `text` and of `text` with `straight` removed are the same. */
  function expectDefault(text: string, plain: string) {
    const a = layout(text).layout;
    const b = layout(plain).layout;
    expect(a.edges.map((e) => e.route)).toEqual(b.edges.map((e) => e.route));
  }

  test("beyond the side: the source's centre is past the target's corner", () => {
    const text = (anchor: boolean) =>
      figure(
        { stack: { gap: "20pt", align: "start", items: ["a", "t"] } },
        [box("a", "200pt"), box("t")],
        [{ id: "in", from: "a", to: "t", ...(anchor && { toAnchor: "straight" }) }],
      );
    const value = layout(text(true));
    const [d, ...rest] = offSide(value.diagnostics);
    expect(rest).toEqual([]);
    expect(d).toMatchObject({
      severity: "warning",
      path: ["edges", 0, "toAnchor"],
      subject: { kind: "edge", id: "in" },
      message:
        'toAnchor "straight" of edge "in" has no effect: the centre of "a" is not in line with the north side of "t" (at least 3pt inside its corners); the edge enters "t" as if it had no anchor.',
    });
    expect(d?.hint).toContain('"north:0.5"');
    expect(d?.location).toBeDefined();
    expectDefault(text(true), text(false));
    expectClean(value);
  });

  test("diagonal", () => {
    const text = (anchor: boolean) =>
      figure(
        {
          stack: {
            gap: "20pt",
            align: "start",
            items: ["a", { row: { gap: "60pt", items: ["x", "b"] } }],
          },
        },
        [box("a"), box("x"), box("b")],
        [{ from: "a", to: "b", ...(anchor && { fromAnchor: "straight" }) }],
      );
    const value = layout(text(true));
    expect(offSide(value.diagnostics).map((d) => [d.path, d.message])).toEqual([
      [
        ["edges", 0, "fromAnchor"],
        'fromAnchor "straight" of edge edges[0] has no effect: "a" and "b" are apart diagonally, so no side of "a" faces "b" in line; the edge leaves "a" as if it had no anchor.',
      ],
    ]);
    expectDefault(text(true), text(false));
  });

  test("overlapping: a self-loop, and a group with an element inside it", () => {
    const value = layout(
      figure(
        { stack: { gap: "20pt", items: ["g", "z"] } },
        [{ ...box("n"), group: "g" }, box("z")],
        [
          { from: "z", to: "z", toAnchor: "straight" },
          { from: "n", to: "g", toAnchor: "straight" },
        ],
        { groups: [{ id: "g", arrange: { stack: { items: ["n"] } } }] },
      ),
    );
    expect(offSide(value.diagnostics).map((d) => d.message)).toEqual([
      'toAnchor "straight" of edge edges[0] has no effect: the edge is a self-loop, so no side of "z" faces its other end; the edge enters "z" as if it had no anchor.',
      'toAnchor "straight" of edge edges[1] has no effect: "g" and "n" overlap or one holds the other, so no side of "g" faces "n"; the edge enters "g" as if it had no anchor.',
    ]);
    // A self-loop keeps its default corner (east → north).
    expect(value.layout.edges[0]?.route).toMatchObject({ fromSide: "east", toSide: "north" });
  });

  test("a junction end is component/anchor-on-junction only", () => {
    const value = layout(
      figure(
        { stack: { gap: "20pt", items: ["a", "j", "t"] } },
        [box("a"), { id: "j", component: "junction" }, box("t")],
        [
          { from: "a", to: "j", toAnchor: "straight" },
          { from: "j", to: "t" },
        ],
      ),
    );
    expect(codes(value.diagnostics)).toEqual(["component/anchor-on-junction"]);
  });

  test("not for an end that resolves", () => {
    expect(offSide(layout(fanIn("straight")).diagnostics)).toEqual([]);
  });
});

describe("ends at one point and other rules", () => {
  test("parallel edges stay parallel lines: the straight ends follow the shared-out source ends", () => {
    const value = layout(
      figure(
        { stack: { gap: "20pt", items: ["a", "t"] } },
        [box("a", "60pt"), box("t", "200pt")],
        [
          { from: "a", to: "t", toAnchor: "straight", label: "1" },
          { from: "a", to: "t", toAnchor: "straight", label: "2" },
        ],
      ),
    );
    const l = value.layout;
    const a = rectOf(l, "a");
    expectVertical(pointsOf(l, 0), roundUnits(a.x + a.width / 3));
    expectVertical(pointsOf(l, 1), roundUnits(a.x + (2 * a.width) / 3));
    expect(netOf(l, 0)).not.toBe(netOf(l, 1));
    expectClean(value);
  });

  test("a two-way pair keeps both lines straight", () => {
    const value = layout(
      figure(
        { stack: { gap: "20pt", items: ["a", "t"] } },
        [box("a", "60pt"), box("t", "60pt")],
        [
          { from: "a", to: "t", toAnchor: "straight" },
          { from: "t", to: "a" },
        ],
      ),
    );
    const l = value.layout;
    const a = rectOf(l, "a");
    expectVertical(pointsOf(l, 0), roundUnits(a.x + a.width / 3));
    expectVertical(pointsOf(l, 1), roundUnits(a.x + (2 * a.width) / 3));
    expectClean(value);
  });

  test("two sources in line with one point merge there, as anchors at one point do (also with fanIn: spread)", () => {
    for (const mode of ["merge", "spread"]) {
      const value = layout(
        figure(
          { stack: { gap: "20pt", items: ["a", "b", "t"] } },
          [box("a"), box("b"), box("t", "200pt")],
          [
            { from: "a", to: "t", toAnchor: "straight" },
            { from: "b", to: "t", toAnchor: "straight" },
          ],
          { fanIn: mode },
        ),
      );
      const l = value.layout;
      expect(pointsOf(l, 0).at(-1)).toEqual(pointsOf(l, 1).at(-1));
      expect(netOf(l, 0)).toBe(netOf(l, 1));
      expectVertical(pointsOf(l, 1), centreX(rectOf(l, "t")));
      expectClean(value);
    }
  });

  test("fanIn: spread spreads the other ends around a straight one", () => {
    const value = layout(
      figure(
        {
          stack: {
            gap: "20pt",
            items: [{ row: { gap: "10pt", items: ["a", "b", "c"] } }, "t"],
          },
        },
        [box("a"), box("b", "30pt"), box("c", "50pt"), box("t", "300pt")],
        [
          { from: "a", to: "t", toAnchor: "straight" },
          { from: "b", to: "t" },
          { from: "c", to: "t" },
        ],
        { fanIn: "spread" },
      ),
    );
    const l = value.layout;
    expectVertical(pointsOf(l, 0), centreX(rectOf(l, "a")));
    const ends = [0, 1, 2].map((i) => JSON.stringify(pointsOf(l, i).at(-1)));
    expect(new Set(ends).size).toBe(3);
    expect(new Set([0, 1, 2].map((i) => netOf(l, i))).size).toBe(3);
    expectClean(value);
  });

  test("straight at both ends: the line runs through the source's position", () => {
    const text = (width: string) =>
      figure(
        { stack: { gap: "20pt", align: "start", items: ["a", "t"] } },
        [box("a", width), box("t", "200pt")],
        [{ from: "a", to: "t", fromAnchor: "straight", toAnchor: "straight" }],
      );
    const both = layout(text("120pt"));
    expectVertical(pointsOf(both.layout, 0), centreX(rectOf(both.layout, "a")));
    expect(codes(both.diagnostics)).toEqual([]);
    expectClean(both);
    // t's centre (100pt) is beyond a (60pt wide): the source end is a
    // default one (with a warning), and the target end lines up with it.
    const one = layout(text("60pt"));
    expectVertical(pointsOf(one.layout, 0), centreX(rectOf(one.layout, "a")));
    expect(codes(one.diagnostics)).toEqual(["layout/straight-off-side"]);
    expectClean(one);
  });

  test("the #113 split moves the other end, and the straight end follows it", () => {
    // u → a is anchored at a's south centre, where a → t leaves: a → t's
    // source end moves to a quarter, and t's straight end comes along.
    const value = layout(
      figure(
        {
          stack: { gap: "20pt", items: ["a", { row: { gap: "40pt", items: ["t", "u"] } }] },
        },
        [box("a", "100pt"), box("t", "100pt"), box("u")],
        [
          { from: "a", to: "t", toAnchor: "straight" },
          { from: "u", to: "a", toAnchor: "south" },
        ],
      ),
    );
    const l = value.layout;
    const a = rectOf(l, "a");
    expectVertical(pointsOf(l, 0), roundUnits(a.x + a.width / 4));
    expect(pointsOf(l, 1).at(-1)).toEqual({ x: centreX(a), y: roundUnits(a.y + a.height) });
    expectClean(value);
  });

  test("checkRoutes reports a straight end on another side", () => {
    const value = layout(fanIn("straight"));
    const edges = value.layout.edges.map((e, index) => {
      if (index !== 0 || e.route === undefined) return e;
      return { ...e, route: { ...e.route, toSide: "west" as const } };
    });
    const report = checkRoutes(value.ir, { ...value.layout, edges });
    expect(report.endpointMisses).toContain("e:#0 to n:t: not straight on the north side");
  });

  test("checkRoutes allows a one-segment line past the margin only as far as straighten() moves", () => {
    const value = layout(
      figure(
        { stack: { gap: "20pt", items: ["a", "t"] } },
        [box("a", "100pt"), box("t", "100pt")],
        [{ from: "a", to: "t", toAnchor: "straight" }],
      ),
    );
    const t = rectOf(value.layout, "t");
    const misses = (inset: number) => {
      const edges = value.layout.edges.map((e) => {
        const points = e.route?.points;
        if (e.route === undefined || points === undefined) return e;
        const x = roundUnits(t.x + inset);
        return { ...e, route: { ...e.route, points: points.map((p) => ({ ...p, x })) } };
      });
      return checkRoutes(value.ir, { ...value.layout, edges }).endpointMisses;
    };
    const miss = "e:#0 to n:t: not straight on the north side";
    expect(misses(6)).toEqual([]); // on the margin
    expect(misses(4)).toEqual([]); // 2 units past it: a straighten() move
    expect(misses(3.9)).toEqual([miss]);
    expect(misses(1)).toEqual([miss]);
  });
});

describe("a short side narrower than the tolerance (re-review of #197)", () => {
  for (const width of ["4pt", "6.5pt"]) {
    test(`${width}: straighten() moves the end just past the margin, and checkRoutes accepts it`, () => {
      const node = (id: string) => ({ id, component: "box", props: { width, height: "10pt" } });
      const value = layout(
        figure(
          { stack: { gap: "20pt", items: ["a", "t"] } },
          [node("a"), node("t")],
          [{ from: "a", to: "t", fromAnchor: "south:0.375", toAnchor: "straight" }],
        ),
      );
      const a = rectOf(value.layout, "a");
      expectVertical(pointsOf(value.layout, 0), roundUnits(a.x + a.width * 0.375));
      expect(codes(value.diagnostics)).toEqual([]);
      expectClean(value);
    });
  }

  test("straightMarginDistance", () => {
    const rect = { x: 0, y: 0, width: 8, height: 8 };
    expect(straightMarginDistance(rect, "north", 4)).toBe(0);
    expect(straightMarginDistance(rect, "north", 3)).toBe(1);
    expect(straightMarginDistance(rect, "west", 6.5)).toBe(2.5);
    expect(straightMarginDistance({ ...rect, width: 100 }, "south", 50)).toBe(0);
    expect(straightMarginDistance({ ...rect, width: 100 }, "south", 95)).toBe(1);
  });
});

describe("parallel edges whose other ends are beyond the side (review of #197)", () => {
  // A wide source over a narrow target: the source's shared-out ends (1/3,
  // 2/3 of 200pt) are past the target's side, so the target ends cannot be
  // in line. They keep separate points, not one centre point.
  const text = figure(
    { stack: { gap: "20pt", items: ["a", "t"] } },
    [box("a", "200pt"), box("t", "20pt")],
    [
      { from: "a", to: "t", toAnchor: "straight" },
      { from: "a", to: "t", toAnchor: "straight" },
    ],
  );

  test("two points, two nets, each reported as not in line", () => {
    const value = layout(text);
    const l = value.layout;
    expect(pointsOf(l, 0).at(-1)).not.toEqual(pointsOf(l, 1).at(-1));
    expect(netOf(l, 0)).not.toBe(netOf(l, 1));
    const offSide = value.diagnostics.filter((d) => d.code === "layout/straight-off-side");
    expect(offSide.map((d) => d.path)).toEqual([
      ["edges", 0, "toAnchor"],
      ["edges", 1, "toAnchor"],
    ]);
    expect(offSide[0]?.message).toBe(
      'toAnchor "straight" of edge edges[0] could not be put in line: the other end\'s point on "a" is not over the north side of "t" (at least 3pt inside its corners): parallel edges between the two keep separate points, or another edge\'s end moved it; so the edge enters "t" at a point of its own and is not straight.',
    );
    expectClean(value);
  });

  test("a single edge is in line and not reported", () => {
    const value = layout(
      figure(
        { stack: { gap: "20pt", items: ["a", "t"] } },
        [box("a", "200pt"), box("t", "20pt")],
        [{ from: "a", to: "t", toAnchor: "straight" }],
      ),
    );
    expectVertical(pointsOf(value.layout, 0), centreX(rectOf(value.layout, "t")));
    expect(codes(value.diagnostics)).toEqual([]);
  });
});
