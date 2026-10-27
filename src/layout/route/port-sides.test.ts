/**
 * Default sides from the arrange tree and fan-in spreading (#134, design doc
 * §6.33): an end without an anchor takes the side the separating arrange box
 * points to, and with `figure.layout.fanIn: spread` the edges from different
 * elements that would enter one port enter side by side instead.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parse, stringify } from "yaml";
import { layoutStructuredFigure } from "../index";
import type { LayoutIR, Point, Rect } from "../ir";
import type { TextMeasurer } from "../text";
import { checkRoutes } from "./check";

/** Every character is half an em wide; ascender 0.8 em, descender 0.2 em. */
const FAKE: TextMeasurer = {
  lineWidth: (text, _font, size) => ([...text].length * size) / 2,
  verticalMetrics: (_font, size) => ({ ascent: 0.8 * size, descent: 0.2 * size }),
};

function run(text: string) {
  const result = layoutStructuredFigure(text, { measurer: FAKE });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  return { ...result.value, diagnostics: result.diagnostics };
}

function figure(
  arrange: unknown,
  nodes: unknown[],
  edges: unknown[],
  fanIn?: string,
  groups: unknown[] = [],
) {
  return stringify({
    version: 1,
    figure: {
      id: "t",
      theme: "academic",
      layout: { arrange, ...(fanIn !== undefined && { fanIn }) },
    },
    groups,
    nodes,
    edges,
  });
}

const centerOf = (r: Rect) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
/** The side the centers alone pick (the rule before #134): the larger distance, vertical on ties. */
const facing = (from: Rect, to: Rect) => {
  const a = centerOf(from);
  const b = centerOf(to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dy) >= Math.abs(dx)) return dy < 0 ? "north" : "south";
  return dx < 0 ? "west" : "east";
};
const groupRectOf = (layout: LayoutIR, id: string): Rect => {
  const group = layout.groups.find((g) => g.key === `g:${id}`);
  if (group === undefined) throw new Error(`no group ${id}`);
  return group.rect;
};

const box = (id: string, props?: object) => ({
  id,
  component: "box",
  label: id,
  ...(props !== undefined && { props: { ...props } }),
});

const routeOf = (layout: LayoutIR, index: number) => {
  const route = layout.edges[index]?.route;
  if (route === undefined) throw new Error(`edge ${index} has no route`);
  return route;
};
const lastPoint = (layout: LayoutIR, index: number) =>
  routeOf(layout, index).points.at(-1) as Point;
const rectOf = (layout: LayoutIR, id: string): Rect => {
  const node = layout.nodes.find((n) => n.key === `n:${id}`);
  if (node === undefined) throw new Error(`no ${id}`);
  return node.rect;
};

/** No problem of any kind but crossings (those are layout's, reported as info). */
function expectClean(value: ReturnType<typeof run>) {
  const { crossings: _, ...report } = checkRoutes(value.ir, value.layout);
  expect(Object.entries(report).filter(([, list]) => list.length > 0)).toEqual([]);
  expect(value.diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
}

describe("default sides from the arrange tree", () => {
  const wide = { width: "90pt" };
  const tall = { height: "90pt" };

  test("a stack separates the ends: south to north, although they are farther apart sideways", () => {
    const value = run(
      figure(
        {
          stack: {
            items: [{ row: { items: ["a", "p", "q"] } }, { row: { items: ["r", "s", "b"] } }],
          },
        },
        ["a", "p", "q", "r", "s", "b"].map((id) => box(id, wide)),
        [{ from: "a", to: "b" }],
      ),
    );
    const a = rectOf(value.layout, "a");
    const b = rectOf(value.layout, "b");
    // The centers are farther apart in x than in y: the old rule took east / west.
    expect(b.x - a.x).toBeGreaterThan(b.y - a.y);
    expect(routeOf(value.layout, 0)).toMatchObject({ fromSide: "south", toSide: "north" });
    expectClean(value);
  });

  test("a row separates the ends: east to west, although they are farther apart vertically", () => {
    const value = run(
      figure(
        {
          row: {
            items: [{ stack: { items: ["a", "p", "q"] } }, { stack: { items: ["r", "s", "b"] } }],
          },
        },
        ["a", "p", "q", "r", "s", "b"].map((id) => box(id, tall)),
        [{ from: "a", to: "b" }],
      ),
    );
    const a = rectOf(value.layout, "a");
    const b = rectOf(value.layout, "b");
    expect(b.y - a.y).toBeGreaterThan(b.x - a.x);
    expect(routeOf(value.layout, 0)).toMatchObject({ fromSide: "east", toSide: "west" });
    expectClean(value);
  });

  test("reversed boxes (stack up, row left) point the other way", () => {
    const up = run(
      figure(
        {
          stack: {
            direction: "up",
            items: [{ row: { items: ["a", "p", "q"] } }, { row: { items: ["r", "s", "b"] } }],
          },
        },
        ["a", "p", "q", "r", "s", "b"].map((id) => box(id, wide)),
        [{ from: "a", to: "b" }],
      ),
    );
    const [ua, ub] = [rectOf(up.layout, "a"), rectOf(up.layout, "b")];
    expect(ub.y).toBeLessThan(ua.y);
    expect(facing(ua, ub)).toBe("east");
    expect(routeOf(up.layout, 0)).toMatchObject({ fromSide: "north", toSide: "south" });
    expectClean(up);

    const left = run(
      figure(
        {
          row: {
            direction: "left",
            items: [{ stack: { items: ["a", "p", "q"] } }, { stack: { items: ["r", "s", "b"] } }],
          },
        },
        ["a", "p", "q", "r", "s", "b"].map((id) => box(id, tall)),
        [{ from: "a", to: "b" }],
      ),
    );
    const [la, lb] = [rectOf(left.layout, "a"), rectOf(left.layout, "b")];
    expect(lb.x).toBeLessThan(la.x);
    expect(facing(la, lb)).toBe("south");
    expect(routeOf(left.layout, 0)).toMatchObject({ fromSide: "west", toSide: "east" });
    expectClean(left);
  });

  test("an attached node takes its target's place in the tree", () => {
    // x hangs far east of a, b is below a: the centers say west, the stack south.
    const value = run(
      figure(
        { stack: { items: ["a", "b"] } },
        [box("a"), { ...box("x"), attach: { to: "a", side: "east", gap: "150pt" } }, box("b")],
        [{ from: "x", to: "b" }],
      ),
    );
    const x = rectOf(value.layout, "x");
    const b = rectOf(value.layout, "b");
    expect(facing(x, b)).toBe("west");
    expect(routeOf(value.layout, 0)).toMatchObject({ fromSide: "south", toSide: "north" });
    expectClean(value);
  });

  test("so does a chain of attachments", () => {
    // x → p → a: x uses a's place.
    const value = run(
      figure(
        { stack: { items: ["a", "b"] } },
        [
          box("a"),
          { ...box("p"), attach: { to: "a", side: "east", gap: "120pt" } },
          { ...box("x"), attach: { to: "p", side: "east", gap: "12pt" } },
          box("b"),
        ],
        [{ from: "b", to: "x" }],
      ),
    );
    const x = rectOf(value.layout, "x");
    const b = rectOf(value.layout, "b");
    expect(facing(b, x)).toBe("east");
    expect(routeOf(value.layout, 0)).toMatchObject({ fromSide: "north", toSide: "south" });
    expectClean(value);
  });

  test("an attached node level with the other end: not apart along the box, the centers decide", () => {
    // The review's case: stack [a, b]; p east of a, x below p, level with b.
    // The stack separates a's place from b, but x overlaps b vertically.
    const value = run(
      figure(
        { stack: { gap: "12pt", items: ["a", "b"] } },
        [
          box("a"),
          box("b"),
          { ...box("p"), attach: { to: "a", side: "east", gap: "60pt" } },
          { ...box("x"), attach: { to: "p", side: "south", gap: "12pt" } },
        ],
        [{ from: "x", to: "b" }],
      ),
    );
    const x = rectOf(value.layout, "x");
    const b = rectOf(value.layout, "b");
    expect(x.y < b.y + b.height && b.y < x.y + x.height).toBe(true);
    expect(routeOf(value.layout, 0)).toMatchObject({ fromSide: "west", toSide: "east" });
    // The reverse edge gets the same rule at both ends.
    const reverse = run(
      figure(
        { stack: { gap: "12pt", items: ["a", "b"] } },
        [
          box("a"),
          box("b"),
          { ...box("p"), attach: { to: "a", side: "east", gap: "60pt" } },
          { ...box("x"), attach: { to: "p", side: "south", gap: "12pt" } },
        ],
        [{ from: "b", to: "x" }],
      ),
    );
    expect(routeOf(reverse.layout, 0)).toMatchObject({ fromSide: "east", toSide: "west" });
    expectClean(value);
    expectClean(reverse);
  });

  test("elements in different groups: the box that separates the groups decides", () => {
    const value = run(
      figure(
        { row: { items: ["ga", "gb"] } },
        ["a1", "a2", "a3", "b1", "b2", "b3"].map((id) => box(id, tall)),
        [{ from: "a1", to: "b3" }],
        undefined,
        [
          { id: "ga", arrange: { stack: { items: ["a1", "a2", "a3"] } } },
          { id: "gb", arrange: { stack: { items: ["b1", "b2", "b3"] } } },
        ],
      ),
    );
    const a1 = rectOf(value.layout, "a1");
    const b3 = rectOf(value.layout, "b3");
    expect(facing(a1, b3)).toBe("south");
    expect(routeOf(value.layout, 0)).toMatchObject({ fromSide: "east", toSide: "west" });
    expectClean(value);
  });

  test("a group as an end: its place in the tree, like a node's", () => {
    const value = run(
      figure(
        {
          stack: {
            items: [{ row: { items: ["g", "p", "q"] } }, { row: { items: ["r", "s", "b"] } }],
          },
        },
        ["gi", "p", "q", "r", "s", "b"].map((id) => box(id, wide)),
        [{ from: "g", to: "b" }],
        undefined,
        [{ id: "g", arrange: { stack: { items: ["gi"] } } }],
      ),
    );
    const g = groupRectOf(value.layout, "g");
    const b = rectOf(value.layout, "b");
    expect(facing(g, b)).toBe("east");
    expect(routeOf(value.layout, 0)).toMatchObject({ fromSide: "south", toSide: "north" });
    expectClean(value);
  });

  test("with no separating box (a node and the node attached to it) the centers decide", () => {
    const value = run(
      figure(
        { stack: { items: ["a"] } },
        [box("a"), { ...box("x"), attach: { to: "a", side: "east", gap: "30pt" } }],
        [{ from: "a", to: "x" }],
      ),
    );
    expect(routeOf(value.layout, 0)).toMatchObject({ fromSide: "east", toSide: "west" });
    expectClean(value);
  });
});

describe("figure.layout.fanIn", () => {
  const sources = ["a", "b", "c"];
  // Written out of order: the spread follows the sources' places, not the YAML.
  const edges = [
    { from: "c", to: "t" },
    { from: "a", to: "t" },
    { from: "b", to: "t" },
  ];
  const fan = (
    fanIn?: string,
    more: { nodes?: unknown[]; edges?: unknown[]; row?: string[] } = {},
  ) =>
    run(
      figure(
        { stack: { items: [{ row: { items: [...sources, ...(more.row ?? [])] } }, "t"] } },
        [...sources.map((id) => box(id)), box("t", { width: "120pt" }), ...(more.nodes ?? [])],
        [...edges, ...(more.edges ?? [])],
        fanIn,
      ),
    );

  test("merge (the default): the edges from different sources join into one port and one net", () => {
    const value = fan();
    const t = rectOf(value.layout, "t");
    for (const index of [0, 1, 2]) {
      expect(lastPoint(value.layout, index)).toEqual({ x: t.x + t.width / 2, y: t.y });
    }
    expect(new Set([0, 1, 2].map((i) => routeOf(value.layout, i).net)).size).toBe(1);
    expectClean(value);
    // Written out, `merge` is the default.
    expect(JSON.stringify(fan("merge").layout)).toBe(JSON.stringify(value.layout));
  });

  test("spread: side by side at 1/4, 2/4, 3/4 in the order of the sources, each its own net", () => {
    const value = fan("spread");
    const t = rectOf(value.layout, "t");
    // Edges 1, 2, 0 come from a, b, c (left to right).
    expect([1, 2, 0].map((i) => lastPoint(value.layout, i))).toEqual(
      [1, 2, 3].map((k) => ({ x: t.x + (t.width * k) / 4, y: t.y })),
    );
    expect(new Set([0, 1, 2].map((i) => routeOf(value.layout, i).net)).size).toBe(3);
    expect([0, 1, 2].map((i) => routeOf(value.layout, i).toSide)).toEqual([
      "north",
      "north",
      "north",
    ]);
    expectClean(value);
  });

  test("an anchored end stays where it is written and keeps the slot nearest to it", () => {
    const value = fan("spread", {
      nodes: [box("d")],
      row: ["d"],
      edges: [{ from: "d", to: "t", toAnchor: "north:0.9" }],
    });
    const t = rectOf(value.layout, "t");
    // Four slots (1/5 … 4/5): 0.9 claims 4/5, the spread ends take the rest.
    expect([1, 2, 0].map((i) => lastPoint(value.layout, i).x)).toEqual(
      [1, 2, 3].map((k) => t.x + (t.width * k) / 5),
    );
    expect(lastPoint(value.layout, 3)).toEqual({ x: t.x + t.width * 0.9, y: t.y });
    expectClean(value);
  });

  test("an anchored end in the middle: no spread end lands on it", () => {
    const value = fan("spread", {
      nodes: [box("d")],
      row: ["d"],
      edges: [{ from: "d", to: "t", toAnchor: "north:0.5" }],
    });
    const t = rectOf(value.layout, "t");
    const points = [0, 1, 2, 3].map((i) => lastPoint(value.layout, i));
    expect(points[3]).toEqual({ x: t.x + t.width / 2, y: t.y });
    expect(new Set(points.map((p) => `${p.x} ${p.y}`)).size).toBe(4);
    expect(new Set([0, 1, 2, 3].map((i) => routeOf(value.layout, i).net)).size).toBe(4);
    expectClean(value);
  });

  test("multi-edges keep their positions; the spread ends take other slots (review case)", () => {
    // a → t twice share t's north side at 1/3 and 2/3; b, c would merge at 1/2.
    const value = run(
      figure(
        { stack: { items: [{ row: { items: ["a", "b", "c"] } }, "t"] } },
        [box("a"), box("b"), box("c"), box("t", { width: "120pt" })],
        [
          { from: "a", to: "t" },
          { from: "a", to: "t" },
          { from: "b", to: "t" },
          { from: "c", to: "t" },
        ],
        "spread",
      ),
    );
    const t = rectOf(value.layout, "t");
    const xs = [0, 1, 2, 3].map((i) => lastPoint(value.layout, i).x);
    expect(xs.slice(0, 2)).toEqual([t.x + t.width / 3, t.x + (t.width * 2) / 3]);
    // Five slots would be uneven: four (1/5 … 4/5), the multi-edges claim 2/5 and 3/5.
    expect(xs.slice(2)).toEqual([t.x + t.width / 5, t.x + (t.width * 4) / 5]);
    expect(new Set([0, 1, 2, 3].map((i) => routeOf(value.layout, i).net)).size).toBe(4);
    expectClean(value);
  });

  test("multi-edges of different sizes: the ends that stay keep their reserved slots (re-review case)", () => {
    // a → t twice (1/3, 2/3) and b → t five times (1/6 … 5/6): two of b's
    // ends meet a's at 1/3 and 2/3 and spread; the other three must not be
    // shared out again among themselves onto the spread ends' slots.
    const value = run(
      figure(
        { stack: { items: [{ row: { items: ["a", "b"] } }, "t"] } },
        [box("a", { width: "120pt" }), box("b", { width: "120pt" }), box("t", { width: "120pt" })],
        [
          ...Array.from({ length: 2 }, () => ({ from: "a", to: "t" })),
          ...Array.from({ length: 5 }, () => ({ from: "b", to: "t" })),
        ],
        "spread",
      ),
    );
    const indices = [0, 1, 2, 3, 4, 5, 6];
    const points = indices.map((i) => lastPoint(value.layout, i));
    expect(new Set(points.map((p) => `${p.x} ${p.y}`)).size).toBe(7);
    expect(new Set(indices.map((i) => routeOf(value.layout, i).net)).size).toBe(7);
    expectClean(value);
  });

  describe("the guard: spreading never puts together ends that merge mode keeps apart", () => {
    const big = { width: "120pt", height: "60pt" };
    const arrange = { row: { gap: "30pt", items: ["a", "b", "c"] } };
    const nodesWith = (d: object, e: object) => [
      box("a", big),
      box("b", big),
      box("c", big),
      { ...box("d", big), attach: { ...d, gap: "60pt" } },
      { ...box("e", big), attach: { ...e, gap: "60pt" } },
    ];
    const edgesOf = (pairs: string) =>
      pairs.split(" ").map((p) => ({ from: p[0] as string, to: p[1] as string }));
    /** Each end of each routed edge: its element, side and drawn end point. */
    const endPoints = (value: ReturnType<typeof run>) =>
      value.layout.edges.flatMap((e, i) => {
        const ir = value.ir.edges[i];
        const points = e.route?.points ?? [];
        return [
          [`${i} from`, `${ir?.from} ${e.route?.fromSide} ${JSON.stringify(points[0])}`],
          [`${i} to`, `${ir?.to} ${e.route?.toSide} ${JSON.stringify(points.at(-1))}`],
        ] as [string, string][];
      });
    /** Every point two ends share with spreading, they share in merge mode. */
    const expectNoNewCoincidence = (
      spread: ReturnType<typeof run>,
      merged: ReturnType<typeof run>,
    ) => {
      const before = new Map(endPoints(merged));
      const groups = new Map<string, string[]>();
      for (const [end, point] of endPoints(spread))
        groups.set(point, [...(groups.get(point) ?? []), end]);
      for (const members of groups.values()) {
        expect(new Set(members.map((m) => before.get(m))).size).toBe(1);
      }
      expect(spread.diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
    };

    test("a figure where the spread would join ends falls back to merge mode", () => {
      // Found by a seeded random search: without the guard, the #113 split
      // around the spread positions puts two ends of a on one point that
      // merge mode keeps apart.
      const nodes = nodesWith({ to: "a", side: "south" }, { to: "a", side: "north" });
      const edges = edgesOf("ca ad eb ab db eb ea eb ea");
      const spread = run(figure(arrange, nodes, edges, "spread"));
      const merged = run(figure(arrange, nodes, edges));
      expectNoNewCoincidence(spread, merged);
      expect(JSON.stringify(spread.layout)).toBe(JSON.stringify(merged.layout));
    });

    test("the re-review case: the two a → b edges are where merge mode puts them", () => {
      // Merge mode (unchanged since #113) already joins the two a → b edges
      // on one point of a (the split moves them onto it); the spread before
      // the guard did too. The guard keeps the spread from doing worse.
      const nodes = nodesWith({ to: "b", side: "south" }, { to: "c", side: "south" });
      const edges = edgesOf("dc ae cd ca ab ae ac ae ab");
      const spread = run(figure(arrange, nodes, edges, "spread"));
      const merged = run(figure(arrange, nodes, edges));
      expectNoNewCoincidence(spread, merged);
      const joined = (value: ReturnType<typeof run>) =>
        routeOf(value.layout, 4).net === routeOf(value.layout, 8).net;
      expect(joined(merged)).toBe(true);
      expect(joined(spread)).toBe(joined(merged));
    });
  });

  test("on an east / west side the ends are ordered top to bottom", () => {
    const value = run(
      figure(
        { row: { items: [{ stack: { items: ["a", "b", "c"] } }, "t"] } },
        [box("a"), box("b"), box("c"), box("t", { height: "120pt" })],
        [
          { from: "b", to: "t" },
          { from: "c", to: "t" },
          { from: "a", to: "t" },
        ],
        "spread",
      ),
    );
    const t = rectOf(value.layout, "t");
    expect([2, 0, 1].map((i) => lastPoint(value.layout, i))).toEqual(
      [1, 2, 3].map((k) => ({ x: t.x, y: t.y + (t.height * k) / 4 })),
    );
    expect([0, 1, 2].map((i) => routeOf(value.layout, i).toSide)).toEqual(["west", "west", "west"]);
    expectClean(value);
  });

  test("a tie in the other ends' places keeps the document order", () => {
    // a and b both above t at the same x: written b first, b gets the left slot.
    const value = run(
      figure(
        { stack: { items: ["a", "b", "t"] } },
        [box("a"), box("b"), box("t", { width: "120pt" })],
        [
          { from: "b", to: "t" },
          { from: "a", to: "t" },
        ],
        "spread",
      ),
    );
    const t = rectOf(value.layout, "t");
    expect([0, 1].map((i) => lastPoint(value.layout, i).x)).toEqual([
      t.x + t.width / 3,
      t.x + (t.width * 2) / 3,
    ]);
    expect(value.diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
  });

  test("a junction keeps the edges meeting at it", () => {
    const value = run(
      figure(
        { stack: { items: [{ row: { items: sources } }, "j"] } },
        [...sources.map((id) => box(id)), { id: "j", component: "junction" }],
        sources.map((from) => ({ from, to: "j" })),
        "spread",
      ),
    );
    expect(new Set([0, 1, 2].map((i) => routeOf(value.layout, i).net)).size).toBe(1);
    expectClean(value);
  });

  test("an edge leaving the same side is still split off from the spread ends (#113)", () => {
    const value = fan("spread", { nodes: [box("u")], row: ["u"], edges: [{ from: "t", to: "u" }] });
    const ends = [0, 1, 2].map((i) => lastPoint(value.layout, i));
    const leaving = routeOf(value.layout, 3).points[0] as Point;
    expect(routeOf(value.layout, 3).fromSide).toBe("north");
    expect(ends).not.toContainEqual(leaving);
    expect(new Set([...ends, leaving].map((p) => `${p.x} ${p.y}`)).size).toBe(4);
    expectClean(value);
  });
});

describe("#109's figure 3 without anchors (#124 §3.7)", () => {
  const path = `${import.meta.dir}/../../../research/109-dogfood-v0.4/figures/serving-architecture.sumi.yaml`;
  /** The figure as first written: no `fromAnchor` / `toAnchor` (#109 added 11 by hand). */
  const withoutAnchors = (fanIn?: string) => {
    const doc = parse(readFileSync(path, "utf8")) as {
      figure: { layout: Record<string, unknown> };
      edges: Record<string, unknown>[];
    };
    for (const edge of doc.edges) {
      delete edge.fromAnchor;
      delete edge.toAnchor;
    }
    if (fanIn !== undefined) doc.figure.layout.fanIn = fanIn;
    return stringify(doc);
  };
  /** 1 unit = 0.5pt. */
  const MM_PER_UNIT = 0.5 * (25.4 / 72);
  /** Per edge: route length − Manhattan distance between its ends, in mm. */
  const excessOf = (layout: LayoutIR) =>
    layout.edges.map((edge) => {
      const points = edge.route?.points ?? [];
      let length = 0;
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1] as Point;
        const b = points[i] as Point;
        length += Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      }
      const first = points[0] as Point;
      const last = points.at(-1) as Point;
      return (length - Math.abs(first.x - last.x) - Math.abs(first.y - last.y)) * MM_PER_UNIT;
    });

  test("spread: every edge routed, no detour over 10mm, 2mm of excess at most", () => {
    const result = layoutStructuredFigure(withoutAnchors("spread"));
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
    const { layout } = result.value;
    expect(layout.edges.every((e) => e.route !== undefined)).toBe(true);
    expect(result.diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
    const excess = excessOf(layout);
    expect(excess.filter((e) => e > 10)).toEqual([]);
    expect(excess.reduce((sum, e) => sum + e, 0)).toBeLessThanOrEqual(2);
    // The price (#124 §3.7): the workers' lines cross the others one by one
    // instead of as one merged line: 6 crossing points, not 3.
    expect(result.diagnostics.filter((d) => d.code === "layout/edge-crossing")).toHaveLength(6);
  });

  test("merge (the default) keeps the detours the spread removes", () => {
    const result = layoutStructuredFigure(withoutAnchors());
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
    expect(excessOf(result.value.layout).filter((e) => e > 10)).toHaveLength(3);
  });
});
