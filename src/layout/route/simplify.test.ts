/**
 * The post-routing simplification (#604, `simplify.ts`) on hand-made
 * scenes: each simpler shape, and each reason not to take one.
 */
import { describe, expect, test } from "bun:test";
import type { ElementKey } from "../../core/check-state";
import type { Side } from "../../core/figure/schema";
import type { Point, Rect } from "../ir";
import { SIDE_DIR } from "./ports";
import {
  bendCount,
  jogLengths,
  type SimplifyEdge,
  type SimplifyEnd,
  type SimplifyScene,
  simplifyRoutes,
  type Terminal,
  TINY_JOG,
} from "./simplify";

const key = (k: string) => k as ElementKey;

const sidePoint = (r: Rect, side: Side, along: number): Point =>
  side === "east"
    ? { x: r.x + r.width, y: along }
    : side === "west"
      ? { x: r.x, y: along }
      : side === "north"
        ? { x: along, y: r.y }
        : { x: along, y: r.y + r.height };

const terminal = (r: Rect, side: Side, along: number): Terminal => {
  const p = sidePoint(r, side, along);
  return { port: p, outline: p, dir: SIDE_DIR[side], side };
};

/** An end at `along` on `side`; `free` lists the sides it may use (the current one first). */
function end(
  name: string,
  rect: Rect,
  side: Side,
  along: number,
  free?: Side[],
  room = 0,
): SimplifyEnd {
  return {
    key: key(name),
    rect,
    current: terminal(rect, side, along),
    lane: 6,
    room,
    ...(free !== undefined && {
      free: {
        sides: free.map((s) => {
          const vertical = s === "north" || s === "south";
          const lo = (vertical ? rect.x : rect.y) + 6;
          const hi = (vertical ? rect.x + rect.width : rect.y + rect.height) - 6;
          return { side: s, lo, hi };
        }),
        at: (s: Side, at: number) => terminal(rect, s, at),
      },
    }),
  };
}

function scene(
  routes: Record<string, Point[]>,
  nodes: Record<string, Rect>,
  extra: Partial<SimplifyScene> = {},
): SimplifyScene {
  return {
    nodes: Object.entries(nodes).map(([k, rect]) => ({ key: key(k), rect })),
    boxes: [],
    groups: [],
    routes: new Map(Object.entries(routes).map(([k, p]) => [key(k), p])),
    rooms: new Map(),
    shares: (a, b) => a === b,
    inside: () => false,
    ...extra,
  };
}

const A: Rect = { x: 0, y: 0, width: 60, height: 40 };
const B: Rect = { x: 120, y: 25, width: 60, height: 40 };

describe("simpler shapes", () => {
  test("straight: a free end slides into line with an anchored one", () => {
    // a → b, b's west end anchored at y = 50 (outside a's centre 20, inside a's side).
    const route = [
      { x: 60, y: 20 },
      { x: 90, y: 20 },
      { x: 90, y: 30 },
      { x: 120, y: 30 },
    ];
    const edge: SimplifyEdge = {
      key: key("e"),
      from: end("a", A, "east", 20, ["east"]),
      to: end("b", B, "west", 30),
    };
    const s = scene({ e: route }, { a: A, b: B });
    const changed = simplifyRoutes([edge], s);
    expect(changed.get(key("e"))?.points).toEqual([
      { x: 60, y: 30 },
      { x: 120, y: 30 },
    ]);
    expect(changed.get(key("e"))?.from.port).toEqual({ x: 60, y: 30 });
  });

  test("straight: two free ends meet in the middle of the span they share", () => {
    const route = [
      { x: 60, y: 10 },
      { x: 90, y: 10 },
      { x: 90, y: 55 },
      { x: 120, y: 55 },
    ];
    const edge: SimplifyEdge = {
      key: key("e"),
      from: end("a", A, "east", 10, ["east"]),
      to: end("b", B, "west", 55, ["west"]),
    };
    const changed = simplifyRoutes([edge], scene({ e: route }, { a: A, b: B }));
    // Shared span with the 6-unit margins: 31 … 34.
    const points = changed.get(key("e"))?.points as Point[];
    expect(points).toHaveLength(2);
    expect((points[0] as Point).y).toBeCloseTo(32.5, 3);
  });

  test("L: a staircase becomes one bend when an end may take another side", () => {
    // a above-left of c; the route enters c's north side (anchored) by a staircase.
    const C: Rect = { x: 120, y: 100, width: 60, height: 40 };
    const route = [
      { x: 60, y: 20 },
      { x: 80, y: 20 },
      { x: 80, y: 60 },
      { x: 150, y: 60 },
      { x: 150, y: 100 },
    ];
    const edge: SimplifyEdge = {
      key: key("e"),
      from: end("a", A, "east", 20, ["east", "south"]),
      to: end("c", C, "north", 150),
    };
    const changed = simplifyRoutes([edge], scene({ e: route }, { a: A, c: C }));
    const points = changed.get(key("e"))?.points as Point[];
    expect(bendCount(points)).toBe(1);
    expect(points).toEqual([
      { x: 60, y: 20 },
      { x: 150, y: 20 },
      { x: 150, y: 100 },
    ]);
  });

  test("Z: a four-bend staircase between fixed facing ports becomes a Z in the clear", () => {
    const route = [
      { x: 60, y: 20 },
      { x: 70, y: 20 },
      { x: 70, y: 40 },
      { x: 100, y: 40 },
      { x: 100, y: 50 },
      { x: 120, y: 50 },
    ];
    const edge: SimplifyEdge = {
      key: key("e"),
      from: end("a", A, "east", 20),
      to: end("b", B, "west", 50),
    };
    const changed = simplifyRoutes([edge], scene({ e: route }, { a: A, b: B }));
    const points = changed.get(key("e"))?.points as Point[];
    expect(bendCount(points)).toBe(2);
    // The middle in the middle of the gap.
    expect((points[1] as Point).x).toBeCloseTo(90, 3);
  });

  test("a tiny jog is moved off when no simpler shape fits", () => {
    // Two blocks leave only a staircase; its steps are spread to 2mm or more.
    const route = [
      { x: 60, y: 20 },
      { x: 84, y: 20 },
      { x: 84, y: 36 },
      { x: 92, y: 36 },
      { x: 92, y: 55 },
      { x: 120, y: 55 },
    ];
    // One block above the target's level near it, one below the source's
    // level near it: every single column between the ends meets one.
    const upper: Rect = { x: 95, y: -10, width: 23, height: 38 };
    const lower: Rect = { x: 30, y: 46, width: 55, height: 34 };
    const edge: SimplifyEdge = {
      key: key("e"),
      from: end("a", A, "east", 20),
      to: end("b", B, "west", 55),
    };
    const before = jogLengths(route);
    expect(before.some((l) => l < TINY_JOG)).toBe(true);
    const s = scene({ e: route }, { a: A, b: B, upper, lower });
    const changed = simplifyRoutes([edge], s);
    const points = changed.get(key("e"))?.points as Point[];
    expect(points).toBeDefined();
    expect(bendCount(points)).toBe(4);
    expect(jogLengths(points).filter((l) => l < TINY_JOG)).toEqual([]);
  });
});

describe("not simpler", () => {
  const zRoute = [
    { x: 60, y: 20 },
    { x: 90, y: 20 },
    { x: 90, y: 50 },
    { x: 120, y: 50 },
  ];

  test("ends with written anchors keep their ports", () => {
    const edge: SimplifyEdge = {
      key: key("e"),
      from: end("a", A, "east", 20),
      to: end("b", B, "west", 50),
    };
    expect(simplifyRoutes([edge], scene({ e: zRoute }, { a: A, b: B })).size).toBe(0);
  });

  test("a straight line through a node is not taken", () => {
    const block: Rect = { x: 80, y: 40, width: 20, height: 20 };
    const edge: SimplifyEdge = {
      key: key("e"),
      from: end("a", A, "east", 20, ["east"]),
      to: end("b", B, "west", 50),
    };
    const route = [
      { x: 60, y: 20 },
      { x: 110, y: 20 },
      { x: 110, y: 50 },
      { x: 120, y: 50 },
    ];
    const changed = simplifyRoutes([edge], scene({ e: route }, { a: A, b: B, block }));
    expect(changed.size).toBe(0);
  });

  test("a straight line over a group title is not taken; a Z beside it is", () => {
    const edge: SimplifyEdge = {
      key: key("e"),
      from: end("a", A, "east", 20, ["east"]),
      to: end("b", B, "west", 40),
    };
    // Around the title, under it.
    const route = [
      { x: 60, y: 20 },
      { x: 70, y: 20 },
      { x: 70, y: 52 },
      { x: 110, y: 52 },
      { x: 110, y: 40 },
      { x: 120, y: 40 },
    ];
    const title: Rect = { x: 80, y: 30, width: 16, height: 10 };
    const s = scene({ e: route }, { a: A, b: B }, { boxes: [title] });
    const points = simplifyRoutes([edge], s).get(key("e"))?.points as Point[];
    expect(bendCount(points)).toBe(2);
    // Its column is past the title, and leaves the last leg room to round.
    expect((points[2] as Point).x).toBeGreaterThan(96);
    expect(120 - (points[2] as Point).x).toBeGreaterThanOrEqual(16);
  });

  test("a straight line across another net's line is not taken", () => {
    const edge: SimplifyEdge = {
      key: key("e"),
      from: end("a", A, "east", 20, ["east"]),
      to: end("b", B, "west", 34),
    };
    const route = [
      { x: 60, y: 20 },
      { x: 75, y: 20 },
      { x: 75, y: 34 },
      { x: 120, y: 34 },
    ];
    // Another line runs down at x = 100 from y = 30 to y = 80: the Z passes
    // it already, so crossing it once is no worse; a second crossing is.
    const other = [
      { x: 100, y: 26 },
      { x: 100, y: 80 },
    ];
    const blocker = [
      { x: 65, y: 25 },
      { x: 65, y: 40 },
    ];
    const s = scene({ e: route, o: other, p: blocker }, { a: A, b: B });
    expect(simplifyRoutes([edge], s).size).toBe(0);
  });

  test("a plain S keeps the sides the arrange tree gave it", () => {
    // a's east → c's north is an S; an L would need a's south side: not taken.
    const C: Rect = { x: 120, y: 100, width: 60, height: 40 };
    const route = [
      { x: 30, y: 40 },
      { x: 30, y: 70 },
      { x: 150, y: 70 },
      { x: 150, y: 100 },
    ];
    const edge: SimplifyEdge = {
      key: key("e"),
      from: end("a", A, "south", 30, ["south", "east"]),
      to: end("c", C, "north", 150),
    };
    expect(simplifyRoutes([edge], scene({ e: route }, { a: A, c: C })).size).toBe(0);
  });

  describe("held to the routed line thing by thing (review of #617)", () => {
    const L: Rect = { x: 0, y: 0, width: 60, height: 40 };
    const R: Rect = { x: 120, y: 25, width: 60, height: 40 };
    const route = [
      { x: 60, y: 20 },
      { x: 95, y: 20 },
      { x: 95, y: 30 },
      { x: 120, y: 30 },
    ];
    const edge: SimplifyEdge = {
      key: key("e"),
      from: end("l", L, "east", 20, ["east"]),
      to: end("r", R, "west", 30),
    };

    test("an obstacle the route kept clear of stays clear, whatever it already crossed", () => {
      // The routed line crosses A; B is clear of it. The straight line at
      // y = 30 would cross B: no worse in total, worse on B.
      const A: Rect = { x: 70, y: 15, width: 8, height: 10 };
      const B: Rect = { x: 80, y: 28, width: 6, height: 4 };
      const points = simplifyRoutes([edge], scene({ e: route }, { l: L, r: R, A, B })).get(
        key("e"),
      )?.points;
      if (points !== undefined) {
        expect(points).not.toHaveLength(2);
        // Every segment keeps B's clearance.
        for (let i = 1; i < points.length; i++) {
          const a = points[i - 1] as Point;
          const b = points[i] as Point;
          const x0 = Math.min(a.x, b.x);
          const x1 = Math.max(a.x, b.x);
          const y0 = Math.min(a.y, b.y);
          const y1 = Math.max(a.y, b.y);
          const dx = Math.max(B.x - x1, 0, x0 - (B.x + B.width));
          const dy = Math.max(B.y - y1, 0, y0 - (B.y + B.height));
          expect(Math.max(dx, dy)).toBeGreaterThanOrEqual(6);
        }
      }
    });

    test("a route of another net the line never met may not be crossed, though the total stays", () => {
      // The routed line crosses v; the straight line at y = 30 would cross w instead.
      const v = [
        { x: 75, y: 18 },
        { x: 75, y: 22 },
      ];
      const w = [
        { x: 80, y: 28 },
        { x: 80, y: 32 },
      ];
      const changed = simplifyRoutes([edge], scene({ e: route, v, w }, { l: L, r: R }));
      const points = changed.get(key("e"))?.points;
      if (points !== undefined) expect(points).not.toHaveLength(2);
    });
  });

  test("a side one edge takes is not free for the next (sides are read in turn)", () => {
    // Two sources above-left of t, each in a staircase into t's west side; an
    // L into t's free north side would mend either, but only one may take it.
    const T: Rect = { x: 200, y: 100, width: 80, height: 40 };
    const A1: Rect = { x: 0, y: 0, width: 40, height: 20 };
    const A2: Rect = { x: 60, y: 30, width: 40, height: 20 };
    const taken = new Map<string, number[]>(); // side → positions in use on t
    // Each would take its own stretch of the north side (kept apart, as the
    // router keeps ports spaced), so the two L's do not meet.
    const tEnd = (name: string, along: number, lo: number, hi: number): SimplifyEnd => ({
      ...end(name, T, "west", along),
      key: key("t"),
      free: {
        get sides() {
          const used = taken.get("north") ?? [];
          const sides: { side: Side; lo: number; hi: number }[] = [
            { side: "west", lo: along, hi: along },
          ];
          if (used.length === 0) sides.push({ side: "north", lo, hi });
          return sides;
        },
        at: (s: Side, at: number) => terminal(T, s, at),
      },
    });
    const stairs = (from: Rect, y: number): Point[] => [
      { x: from.x + from.width, y: from.y + 10 },
      { x: from.x + from.width + 10, y: from.y + 10 },
      { x: from.x + from.width + 10, y: y - 4 },
      { x: 150, y: y - 4 },
      { x: 150, y },
      { x: 200, y },
    ];
    const edges: SimplifyEdge[] = [
      { key: key("e1"), from: end("a1", A1, "east", 10), to: tEnd("t1", 110, 250, 274) },
      { key: key("e2"), from: end("a2", A2, "east", 40), to: tEnd("t2", 130, 206, 230) },
    ];
    const s = scene({ e1: stairs(A1, 110), e2: stairs(A2, 130) }, { a1: A1, a2: A2, t: T });
    const sidesTaken: string[] = [];
    const changed = simplifyRoutes(edges, s, (_k, result) => {
      if (result.to.side === "north") {
        sidesTaken.push(result.to.side);
        taken.set("north", [...(taken.get("north") ?? []), result.to.port.x]);
      }
    });
    expect(changed.size).toBeGreaterThan(0);
    // Only the first edge takes the north side.
    expect(sidesTaken).toEqual(["north"]);
    expect(changed.get(key("e1"))?.to.side).toBe("north");
    expect(changed.get(key("e2"))?.to.side ?? "west").toBe("west");
    // Without the update both would take it: the case is a real contest.
    taken.clear();
    const stale = simplifyRoutes(
      edges,
      scene({ e1: stairs(A1, 110), e2: stairs(A2, 130) }, { a1: A1, a2: A2, t: T }),
    );
    expect([...stale.values()].map((r) => r.to.side)).toEqual(["north", "north"]);
  });
});
