/**
 * `figure.layout.straighten` (#618, design #618): shifting a node or group
 * within the free room of its box so an edge's ends line up.
 */

import { describe, expect, test } from "bun:test";
import { stringify } from "yaml";
import { buildFigureIR } from "../../compiler/ir";
import { checkFigure } from "../../core/check";
import { layoutStructuredFigure } from "../index";
import type { LayoutIR, Point, Rect } from "../ir";
import { resolveEnds } from "../route/ports";
import { routeEdges } from "../route/router";
import type { TextMeasurer } from "../text";
import { placeStructured } from "./engine";

const FAKE: TextMeasurer = {
  lineWidth: (text, _font, size) => ([...text].length * size) / 2,
  verticalMetrics: (_font, size) => ({ ascent: 0.8 * size, descent: 0.2 * size }),
};

function lay(doc: object): LayoutIR {
  const result = layoutStructuredFigure(stringify(doc), { measurer: FAKE });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  return result.value.layout;
}

/** The figure laid out as written and with `straighten: true`. */
function both(layout: object, nodes: object[], extra: object = {}) {
  const make = (straighten?: boolean) => ({
    version: 1,
    figure: {
      id: "t",
      theme: "paper",
      layout: { ...layout, ...(straighten !== undefined && { straighten }) },
    },
    nodes,
    ...extra,
  });
  return { plain: lay(make()), off: lay(make(false)), on: lay(make(true)) };
}

function rect(layout: LayoutIR, id: string): Rect {
  const found =
    layout.nodes.find((n) => n.key === `n:${id}`) ?? layout.groups.find((g) => g.key === `g:${id}`);
  if (found === undefined) throw new Error(`no ${id}`);
  return found.rect;
}

const box = (id: string, height = "20pt", extra: object = {}) => ({
  id,
  component: "box",
  label: id,
  props: { width: "40pt", height },
  ...extra,
});

function points(layout: LayoutIR, index: number): readonly Point[] {
  return layout.edges[index]?.route?.points ?? [];
}

const straight = (layout: LayoutIR, index: number) => points(layout, index).length === 2;
const centerY = (r: Rect) => r.y + r.height / 2;

/** `a` at the top of a stack, `b` alone in the row: `b` has 20pt of room above and below. */
const column = { stack: { gap: "20pt", items: ["a", "x"] } };

describe("figure.layout.straighten", () => {
  test("shifts a node within the room of its row so the edge is straight", () => {
    const { plain, on } = both(
      { arrange: { row: { gap: "40pt", items: [column, "b"] } } },
      [box("a"), box("x"), box("b")],
      { edges: [{ from: "a", to: "b" }] },
    );
    expect(straight(plain, 0)).toBe(false);
    expect(straight(on, 0)).toBe(true);
    expect(centerY(rect(on, "b"))).toBeCloseTo(centerY(rect(on, "a")), 3);
    // b moved up by 20pt (40 units); nothing else moved, the figure kept its size.
    expect(rect(on, "b").y).toBeCloseTo(rect(plain, "b").y - 40, 3);
    expect(rect(on, "a")).toEqual(rect(plain, "a"));
    expect(rect(on, "x")).toEqual(rect(plain, "x"));
    expect(on.canvas).toEqual(plain.canvas);
  });

  test("off (or omitted) lays the figure out exactly as before", () => {
    const { plain, off } = both(
      { arrange: { row: { gap: "40pt", items: [column, "b"] } } },
      [box("a"), box("x"), box("b")],
      { edges: [{ from: "a", to: "b" }] },
    );
    expect(off).toEqual(plain);
  });

  test("does not move a node without room", () => {
    // b sits at the bottom of a stack as tall as a's: neither can move across the row.
    const { plain, on } = both(
      {
        arrange: {
          row: { gap: "40pt", items: [column, { stack: { gap: "20pt", items: ["y", "b"] } }] },
        },
      },
      [box("a"), box("x"), box("y"), box("b")],
      { edges: [{ from: "a", to: "b" }] },
    );
    expect(straight(on, 0)).toBe(false);
    for (const id of ["a", "x", "y", "b"]) expect(rect(on, id)).toEqual(rect(plain, id));
    expect(on.canvas).toEqual(plain.canvas);
  });

  test("keeps an edge that is straight: moves the other end instead", () => {
    // b → c is straight; moving b up for a → b would bend it, so a moves down in its place box.
    const { plain, on } = both(
      {
        arrange: {
          row: {
            gap: "40pt",
            items: [
              {
                place: {
                  unit: "1pt",
                  items: [
                    { item: "w", at: [0, 0] },
                    { item: "a", at: [0, 30] },
                    { item: "z", at: [0, 90] },
                  ],
                },
              },
              "b",
              "c",
            ],
          },
        },
      },
      [box("w"), box("a"), box("z"), box("b"), box("c")],
      {
        edges: [
          { from: "a", to: "b" },
          { from: "b", to: "c" },
        ],
      },
    );
    expect(straight(plain, 0)).toBe(false);
    expect(straight(plain, 1)).toBe(true);
    expect(straight(on, 0)).toBe(true);
    expect(straight(on, 1)).toBe(true);
    expect(rect(on, "b")).toEqual(rect(plain, "b"));
    // a moved down 15pt (30 units), off its written coordinate (no other item shares that y).
    expect(rect(on, "a").y).toBeCloseTo(rect(plain, "a").y + 30, 3);
  });

  test("keeps the items of a figure.layout.align constraint where they are", () => {
    const { plain, on } = both(
      {
        arrange: { row: { gap: "40pt", items: [column, "b", "c"] } },
        align: [{ y: ["b", "c"] }],
      },
      [box("a"), box("x"), box("b"), box("c")],
      { edges: [{ from: "a", to: "b" }] },
    );
    expect(rect(on, "b")).toEqual(rect(plain, "b"));
    expect(straight(on, 0)).toBe(false);
  });

  test("keeps a written start, end or stretch alignment", () => {
    for (const align of ["start", "end", "stretch"]) {
      const { plain, on } = both(
        { arrange: { row: { gap: "40pt", align, items: [column, "b"] } } },
        [box("a"), box("x"), box("b")],
        { edges: [{ from: "a", to: "b" }] },
      );
      expect(rect(on, "b")).toEqual(rect(plain, "b"));
    }
  });

  test("moves a group as a whole, with its attached label", () => {
    const { plain, on } = both(
      { arrange: { row: { gap: "40pt", items: [column, "g"] } } },
      [
        box("a", "60pt"),
        box("x"),
        box("b"),
        {
          id: "note",
          component: "label",
          label: "n",
          attach: { to: "b", side: "east", gap: "4pt" },
        },
      ],
      {
        groups: [{ id: "g", label: "G", arrange: { stack: { items: ["b"] } } }],
        edges: [{ from: "a", to: "b" }],
      },
    );
    expect(straight(on, 0)).toBe(true);
    const dy = rect(on, "b").y - rect(plain, "b").y;
    expect(dy).toBeLessThan(0);
    expect(rect(on, "g").y - rect(plain, "g").y).toBeCloseTo(dy, 3);
    expect(rect(on, "note").y - rect(plain, "note").y).toBeCloseTo(dy, 3);
    expect(rect(on, "g").height).toBe(rect(plain, "g").height);
    expect(on.canvas).toEqual(plain.canvas);
  });

  test("never moves a node into another one or out of the figure", () => {
    // A label attached above b leaves b no room upward: moving it would grow the figure.
    const { plain, on } = both(
      { arrange: { row: { gap: "40pt", items: [column, "b"] } } },
      [
        box("a"),
        box("x"),
        box("b"),
        {
          id: "over",
          component: "label",
          label: "over",
          attach: { to: "b", side: "north", gap: "4pt" },
        },
      ],
      { edges: [{ from: "a", to: "b" }] },
    );
    expect(on.canvas).toEqual(plain.canvas);
    const moved = rect(on, "b");
    const over = rect(on, "over");
    for (const other of ["a", "x"]) {
      const r = rect(on, other);
      const apart =
        r.x + r.width <= moved.x ||
        moved.x + moved.width <= r.x ||
        r.y + r.height <= moved.y ||
        moved.y + moved.height <= r.y;
      expect(apart).toBe(true);
    }
    expect(over.y).toBeGreaterThanOrEqual(0);
  });

  test("leaves the branches of a fan alike", () => {
    // h feeds b1 and b2 from one side: moving h onto either branch would make them differ.
    const { plain, on } = both(
      {
        arrange: {
          row: { gap: "40pt", items: ["h", { stack: { gap: "20pt", items: ["b1", "b2"] } }] },
        },
      },
      [box("h"), box("b1"), box("b2")],
      {
        edges: [
          { from: "h", to: "b1" },
          { from: "h", to: "b2" },
        ],
      },
    );
    for (const id of ["h", "b1", "b2"]) expect(rect(on, id)).toEqual(rect(plain, id));
  });

  test("a hub stays when one of its branches is drawn with route: straight", () => {
    // h feeds b1 (routed) and b2 (straight): moving h up for b1 would tilt h → b2.
    const { plain, on } = both(
      {
        arrange: {
          row: { gap: "40pt", items: ["h", { stack: { gap: "20pt", items: ["b1", "b2"] } }] },
        },
      },
      [box("h"), box("b1"), box("b2")],
      {
        edges: [
          { from: "h", to: "b1" },
          { from: "h", to: "b2", route: "straight" },
        ],
      },
    );
    for (const id of ["h", "b1", "b2"]) expect(rect(on, id)).toEqual(rect(plain, id));
    expect(points(on, 1)).toEqual(points(plain, 1));
  });

  test("lines the end up with a written anchor", () => {
    const { plain, on } = both(
      { arrange: { row: { gap: "40pt", items: [column, "b"] } } },
      [box("a"), box("x"), box("b", "60pt")],
      { edges: [{ from: "a", to: "b", toAnchor: "west:0.1" }] },
    );
    expect(straight(plain, 0)).toBe(false);
    expect(straight(on, 0)).toBe(true);
    const [start, end] = points(on, 0);
    expect(end?.y).toBeCloseTo(rect(on, "b").y + 0.1 * rect(on, "b").height, 2);
    expect(start?.y).toBeCloseTo(end?.y ?? 0, 3);
  });
});

/** Corners of a route. */
function bends(route: readonly Point[]): number {
  let n = 0;
  for (let i = 1; i + 1 < route.length; i++) {
    const [a, b, c] = [route[i - 1], route[i], route[i + 1]] as [Point, Point, Point];
    if (Math.abs((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)) > 1e-6) n++;
  }
  return n;
}

/** The Figure IR and the placed (unrouted) layout. */
function placed(doc: object) {
  const ir = buildFigureIR(checkFigure(stringify(doc)));
  return { ir, layout: placeStructured(ir, { measurer: FAKE }).layout };
}

/** The layout with `slide` forced on edge `index`, as if the straightening had accepted it. */
const forceSlide = (layout: LayoutIR, index: number): LayoutIR => ({
  ...layout,
  edges: layout.edges.map((e, i) => (i === index ? { ...e, slide: true as const } : e)),
});

describe("figure.layout.straighten: sliding an end along its side", () => {
  // b fills the row: nothing moves. Sliding b's end up to a's line would run into o.
  const obstructed = (straighten: boolean) => ({
    version: 1,
    figure: {
      id: "t",
      theme: "paper",
      layout: {
        straighten,
        arrange: {
          row: {
            gap: "30pt",
            items: [
              { stack: { gap: "20pt", items: ["a", "x"] } },
              { stack: { gap: "40pt", items: ["o", "p"] } },
              "b",
            ],
          },
        },
      },
    },
    nodes: [
      box("a"),
      box("x"),
      { ...box("o", "10pt"), props: { width: "20pt", height: "10pt" } },
      { ...box("p", "10pt"), props: { width: "20pt", height: "10pt" } },
      box("b", "60pt"),
    ],
    edges: [{ from: "a", to: "b" }],
  });

  test("an obstructed slide is not taken: no more bends, the route kept, the figure no larger", () => {
    const off = lay(obstructed(false));
    const on = lay(obstructed(true));
    const before = points(off, 0);
    const after = points(on, 0);
    expect(after.length).toBeGreaterThan(0);
    expect(bends(after)).toBeLessThanOrEqual(bends(before));
    expect(on.canvas.width).toBeLessThanOrEqual(off.canvas.width);
    expect(on.canvas.height).toBeLessThanOrEqual(off.canvas.height);
    expect(on.edges[0]?.slide).toBeUndefined();
    // The slide itself would have hurt: forced, its route is not straight.
    const { ir, layout } = placed(obstructed(true));
    const forced = routeEdges(ir, forceSlide(layout, 0), { hintTrials: false });
    expect(bends(forced.layout.edges[0]?.route?.points ?? [])).not.toBe(0);
  });

  test("never slides one branch of a fan, even with fanIn: spread", () => {
    // s1 and s2 both enter t's west side, spread apart; s1's line meets t's side.
    const fan = (straighten: boolean) => ({
      version: 1,
      figure: {
        id: "t",
        theme: "paper",
        layout: {
          straighten,
          fanIn: "spread",
          arrange: {
            row: { gap: "40pt", items: [{ stack: { gap: "20pt", items: ["s1", "s2"] } }, "t"] },
          },
        },
      },
      nodes: [box("s1"), box("s2"), box("t", "60pt")],
      edges: [
        { from: "s1", to: "t" },
        { from: "s2", to: "t" },
      ],
    });
    const off = lay(fan(false));
    const on = lay(fan(true));
    for (const index of [0, 1]) {
      expect(points(on, index)).toEqual(points(off, index));
      expect(on.edges[index]?.slide).toBeUndefined();
    }
    // Port level: even marked to slide, a fan's end stays where the spread put it.
    const { ir, layout } = placed(fan(true));
    const plain = resolveEnds(ir, layout);
    const marked = resolveEnds(ir, forceSlide(layout, 0));
    expect(marked[0]).toEqual(plain[0]);
  });
});

describe("figure.layout.straighten with the auto engine", () => {
  test("is layout/structured-only", () => {
    const doc = {
      version: 1,
      figure: { id: "t", layout: { straighten: true } },
      nodes: [box("a")],
    };
    const codes = checkFigure(stringify(doc)).state.diagnostics.map((d) => d.code);
    expect(codes).toContain("layout/structured-only");
  });
});
