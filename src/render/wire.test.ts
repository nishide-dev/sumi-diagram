/** Rounded corners of structured wires (#101). */

import { describe, expect, test } from "bun:test";
import type { NodeIR } from "../compiler/ir";
import type { Point } from "../core/geometry";
import { type Arc, type CornerOptions, clearRadius, isHiddenJunction, roundCorners } from "./wire";

const options = (overrides: Partial<CornerOptions> = {}): CornerOptions => ({
  radius: 8,
  minRadius: 1,
  clearance: 1,
  obstacles: [],
  ...overrides,
});
const p = (x: number, y: number): Point => ({ x, y });

/** The point of a cubic at t = 1/2. */
const middle = (a: Arc): Point => ({
  x: (a.from.x + 3 * a.c1.x + 3 * a.c2.x + a.to.x) / 8,
  y: (a.from.y + 3 * a.c1.y + 3 * a.c2.y + a.to.y) / 8,
});

describe("turns of one route", () => {
  test("an L is cut back by the radius on both legs and joined by a quarter circle", () => {
    const { pieces, arcs } = roundCorners([{ points: [p(0, 0), p(40, 0), p(40, 40)] }], options());
    expect(pieces[0]).toEqual([
      [p(0, 0), p(32, 0)],
      [p(40, 8), p(40, 40)],
    ]);
    const [arc] = arcs[0] ?? [];
    expect(arc?.from).toEqual(p(32, 0));
    expect(arc?.to).toEqual(p(40, 8));
    // Tangent to both legs, and on the circle of radius 8 around (32, 8) at its middle.
    expect(arc?.c1.y).toBe(0);
    expect(arc?.c2.x).toBe(40);
    const m = middle(arc as Arc);
    expect(Math.hypot(m.x - 32, m.y - 8)).toBeCloseTo(8, 2);
  });

  test("the radius is at most half of each leg, so two turns never overlap", () => {
    const { pieces, arcs } = roundCorners(
      [{ points: [p(0, 0), p(40, 0), p(40, 6), p(80, 6)] }],
      options(),
    );
    expect(arcs[0]?.map((a) => [a.from, a.to])).toEqual([
      [p(37, 0), p(40, 3)],
      [p(40, 3), p(43, 6)],
    ]);
    // The middle leg is used up by the two arcs.
    expect(pieces[0]).toEqual([
      [p(0, 0), p(37, 0)],
      [p(43, 6), p(80, 6)],
    ]);
  });

  test("the part of an end leg under an arrowhead stays straight (#116)", () => {
    // The wire stops at the arrowhead's base; the last 4 units run under its
    // wings (an "arrow" head). Half the 10-unit leg would be 5.
    const end = roundCorners([{ points: [p(0, 0), p(40, 0), p(40, 10)], keepEnd: 4 }], options());
    expect(end.arcs[0]?.map((a) => [a.from, a.to])).toEqual([[p(35, 0), p(40, 5)]]);
    const tight = roundCorners([{ points: [p(0, 0), p(40, 0), p(40, 6)], keepEnd: 4 }], options());
    expect(tight.arcs[0]?.map((a) => [a.from, a.to])).toEqual([[p(38, 0), p(40, 2)]]);
    // At the start too; a leg shorter than what it keeps stays sharp.
    const start = roundCorners(
      [{ points: [p(40, 4), p(40, 0), p(0, 0)], keepStart: 4.5 }],
      options(),
    );
    expect(start.arcs[0]).toEqual([]);
  });

  test("an obstacle inside the turn shrinks the radius; a turn that cannot take the minimum stays sharp", () => {
    // A node whose corner is 4 units inside the turn at (40, 0) (going east, then south).
    const node = { x: 20, y: 4, width: 16, height: 30 };
    const shrunk = roundCorners(
      [{ points: [p(0, 0), p(40, 0), p(40, 40)] }],
      options({ obstacles: [node] }),
    );
    expect(shrunk.arcs[0]?.[0]?.from).toEqual(p(37, 0)); // 4 units away, 1 of clearance
    const sharp = roundCorners(
      [{ points: [p(0, 0), p(40, 0), p(40, 40)] }],
      options({ obstacles: [{ ...node, x: 20, y: 1, width: 19.5 }] }),
    );
    expect(sharp.arcs[0]).toEqual([]);
    expect(sharp.pieces[0]).toEqual([
      [p(0, 0), p(40, 0)],
      [p(40, 0), p(40, 40)],
    ]);
  });

  test("obstacles outside the turn's quadrant do not matter", () => {
    expect(clearRadius(p(40, 0), p(-1, 0), p(0, 1), 8, { clearance: 1, obstacles: [] })).toBe(8);
    // Above the corner (the turn goes west and south), and to the east.
    const obstacles = [
      { x: 0, y: -20, width: 80, height: 10 },
      { x: 45, y: -5, width: 10, height: 50 },
    ];
    expect(clearRadius(p(40, 0), p(-1, 0), p(0, 1), 8, { clearance: 1, obstacles })).toBe(8);
    // A line of another net crossing the inner square limits it.
    const line = { x: 34, y: -10, width: 0, height: 50 };
    expect(clearRadius(p(40, 0), p(-1, 0), p(0, 1), 8, { clearance: 1, obstacles: [line] })).toBe(
      5,
    );
  });

  test("a trunk that goes straight through the corner keeps it covered", () => {
    // Two routes share the trunk from (0, 0); one turns south at (40, 0), the other goes on.
    const { pieces, arcs } = roundCorners(
      [{ points: [p(0, 0), p(40, 0), p(40, 40)] }, { points: [p(0, 0), p(80, 0)] }],
      options(),
    );
    expect(pieces[1]).toEqual([[p(0, 0), p(80, 0)]]);
    expect(arcs[0]).toHaveLength(1);
  });
});

describe("hidden junctions", () => {
  const J = p(50, 50);

  test("a branch leaves a straight line along an arc; the straight line is not cut", () => {
    // In from the south, out to the north and to the west (a residual).
    const { pieces, arcs } = roundCorners(
      [
        { points: [p(50, 100), J], end: "j" },
        { points: [J, p(50, 0)], start: "j" },
        { points: [J, p(0, 50)], start: "j" },
      ],
      options(),
    );
    expect(pieces[0]).toEqual([[p(50, 100), J]]);
    expect(pieces[1]).toEqual([[J, p(50, 0)]]);
    expect(pieces[2]).toEqual([[p(42, 50), p(0, 50)]]);
    expect(arcs.flat().map((a) => [a.from, a.to])).toEqual([[p(50, 58), p(42, 50)]]);
  });

  test("two branches to either side fork off the incoming line", () => {
    const { pieces, arcs } = roundCorners(
      [
        { points: [p(50, 100), J], end: "j" },
        { points: [J, p(0, 50)], start: "j" },
        { points: [J, p(100, 50)], start: "j" },
      ],
      options(),
    );
    expect(pieces[0]).toEqual([[p(50, 100), p(50, 58)]]);
    expect(pieces[1]).toEqual([[p(42, 50), p(0, 50)]]);
    expect(pieces[2]).toEqual([[p(58, 50), p(100, 50)]]);
    expect(arcs.flat().map((a) => [a.from, a.to])).toEqual([
      [p(50, 58), p(42, 50)],
      [p(50, 58), p(58, 50)],
    ]);
  });

  test("an L through a junction is one smooth turn, and its leg may use the junction's side in full", () => {
    // In from the south; out to the east, turning north 6 units further.
    const { pieces, arcs } = roundCorners(
      [
        { points: [p(50, 100), J], end: "j" },
        { points: [J, p(56, 50), p(56, 0)], start: "j" },
      ],
      options(),
    );
    // The junction takes half of the 6-unit leg; the turn at (56, 50) takes the rest.
    expect(arcs.flat().map((a) => [a.from, a.to])).toEqual([
      [p(50, 53), p(53, 50)],
      [p(53, 50), p(56, 47)],
    ]);
    expect(pieces[1]).toEqual([[p(56, 47), p(56, 0)]]);
  });

  test("a leg from a junction that is not cut there may take its whole length at the next turn", () => {
    // Straight through the junction; the outgoing route turns 6 units further.
    const { arcs } = roundCorners(
      [
        { points: [p(50, 100), J], end: "j" },
        { points: [J, p(50, 44), p(0, 44)], start: "j" },
      ],
      options(),
    );
    expect(arcs.flat().map((a) => [a.from, a.to])).toEqual([[p(50, 50 - 0), p(44, 44)]]);
  });

  test("a turn next to a junction leaves the part of the straight leg a branch arc attaches to", () => {
    // In along y = 58, turning north 8 units below J; straight on to the north; a branch east.
    const { pieces, arcs } = roundCorners(
      [
        { points: [p(0, 58), p(50, 58), J], end: "j" },
        { points: [J, p(50, 0)], start: "j" },
        { points: [J, p(100, 50)], start: "j" },
      ],
      options(),
    );
    // The branch arc starts 4 units below J, where the incoming turn's arc ends.
    expect(arcs.flat().map((a) => [a.from, a.to])).toEqual([
      [p(50, 54), p(54, 50)],
      [p(46, 58), p(50, 54)],
    ]);
    expect(pieces[0]).toEqual([
      [p(0, 58), p(46, 58)],
      [p(50, 54), J],
    ]);
  });

  test("a junction that is only entered joins every perpendicular pair", () => {
    const { arcs } = roundCorners(
      [
        { points: [p(0, 50), J], end: "j" },
        { points: [p(50, 0), J], end: "j" },
      ],
      options(),
    );
    expect(arcs.flat().map((a) => [a.from, a.to])).toEqual([[p(42, 50), p(50, 42)]]);
  });

  describe("arrowheads next to the junction (#160)", () => {
    /** The radius of the junction's one arc (the arc's reach along the x axis). */
    const radius = (arcs: readonly Arc[][]): number => {
      const [arc] = arcs.flat();
      if (arc === undefined) throw new Error("expected an arc");
      return Math.abs(arc.to.x - arc.from.x);
    };

    test("an arc leaves the part of a short branch under its arrowhead straight", () => {
      // 10 units from J to the tip of an `arrow` head (8 long): the wire is
      // trimmed by its inset (4.8) to 5.2 and runs 3.2 under the head. Half
      // the leg (2.6) would reach into the head; 2 units are left before it.
      const { pieces, arcs } = roundCorners(
        [
          { points: [p(50, 100), J], end: "j" },
          { points: [J, p(55.2, 50)], start: "j", keepEnd: 3.2 },
        ],
        options(),
      );
      expect(radius(arcs)).toBeCloseTo(2, 9);
      const [[from, to]] = pieces[1] as [[Point, Point]];
      expect(to).toEqual(p(55.2, 50));
      expect(to.x - from.x).toBeCloseTo(3.2, 9);
    });

    test("an arrowhead at the source of a route into the junction counts too", () => {
      const { arcs } = roundCorners(
        [
          { points: [p(50, 60), J], end: "j", keepStart: 8 },
          { points: [J, p(100, 50)], start: "j" },
        ],
        options(),
      );
      expect(radius(arcs)).toBe(2);
    });

    test("too little room for the smallest radius leaves the junction sharp", () => {
      const { pieces, arcs } = roundCorners(
        [
          { points: [p(50, 100), J], end: "j" },
          { points: [J, p(55.2, 50)], start: "j", keepEnd: 4.5 },
        ],
        options(),
      );
      expect(arcs.flat()).toEqual([]);
      expect(pieces[0]).toEqual([[p(50, 100), J]]);
      expect(pieces[1]).toEqual([[J, p(55.2, 50)]]);
    });

    test("a route that turns before its arrowhead leaves the junction to the leg's half", () => {
      // The arrowhead is on the last segment, not the one at the junction.
      const { arcs } = roundCorners(
        [
          { points: [p(50, 100), J], end: "j" },
          { points: [J, p(56, 50), p(56, 0)], start: "j", keepEnd: 3.2 },
        ],
        options(),
      );
      expect(arcs.flat().map((a) => [a.from, a.to])).toEqual([
        [p(50, 53), p(53, 50)],
        [p(53, 50), p(56, 47)],
      ]);
    });

    test("a route in no turn still limits the arc on the leg it shares", () => {
      // Route 0 comes in from the south; its only outgoing partner (route 2,
      // also south) is parallel, so it is in no turn. The west → south turn
      // puts its arc on the same south leg.
      const shared = (keep: { keepStart?: number; keepEnd?: number }) =>
        roundCorners(
          [
            { points: [p(50, 60), J], end: "j", ...keep },
            { points: [p(0, 50), J], end: "j" },
            { points: [J, p(50, 100)], start: "j" },
          ],
          options(),
        ).arcs;
      // A `cross` at J on that leg: no arc.
      expect(shared({ keepEnd: 8 }).flat()).toEqual([]);
      // An arrowhead at the leg's far end: 10 − 8 = 2 units are left.
      expect(radius(shared({ keepStart: 8 }))).toBe(2);
      expect(radius(shared({}))).toBe(5);
    });

    test("an arrowhead at the junction end wins over one at the far end", () => {
      const { arcs } = roundCorners(
        [
          { points: [p(50, 100), J], end: "j" },
          { points: [J, p(100, 50)], start: "j", keepStart: 3, keepEnd: 4 },
        ],
        options(),
      );
      expect(arcs.flat()).toEqual([]);
    });

    test("an arrowhead as long as the leg, or longer, leaves no arc", () => {
      for (const keepEnd of [5, 7]) {
        const { pieces, arcs } = roundCorners(
          [
            { points: [p(50, 100), J], end: "j" },
            { points: [J, p(55, 50)], start: "j", keepEnd },
          ],
          options(),
        );
        expect(arcs.flat()).toEqual([]);
        expect(pieces[1]).toEqual([[J, p(55, 50)]]);
      }
    });

    test("the room is compared with the line width as the smallest radius", () => {
      const at = (keepEnd: number) =>
        roundCorners(
          [
            { points: [p(50, 100), J], end: "j" },
            { points: [J, p(60, 50)], start: "j", keepEnd },
          ],
          options({ minRadius: 1.5 }),
        ).arcs;
      expect(radius(at(8.5))).toBe(1.5);
      expect(at(8.6).flat()).toEqual([]);
    });

    test("an arrowhead the wire runs under at the junction itself keeps it sharp", () => {
      // A `cross` at the junction end: the wire reaches the center through it.
      const { arcs } = roundCorners(
        [
          { points: [p(50, 100), J], end: "j", keepEnd: 8 },
          { points: [J, p(100, 50)], start: "j" },
        ],
        options(),
      );
      expect(arcs.flat()).toEqual([]);
    });
  });

  test("a route ending at a junction alone (an open end) is left as it is", () => {
    const { pieces, arcs } = roundCorners([{ points: [p(50, 100), J], end: "j" }], options());
    expect(pieces[0]).toEqual([[p(50, 100), J]]);
    expect(arcs.flat()).toEqual([]);
  });
});

test("only the hidden variant painted with nothing is a hidden junction", () => {
  const junction = (variant: string, fill: string, stroke: string, width: number) =>
    ({
      mark: { type: "point", size: 3 },
      variant,
      style: { fill, stroke, strokeWidth: { pt: width / 2, units: width } },
    }) as unknown as NodeIR;
  expect(isHiddenJunction(junction("hidden", "transparent", "transparent", 0))).toBe(true);
  expect(isHiddenJunction(junction("hidden", "transparent", "#000000", 0))).toBe(true);
  // A hollow dot from a custom theme is still a visible mark.
  expect(isHiddenJunction(junction("default", "transparent", "#000000", 1))).toBe(false);
  expect(isHiddenJunction(junction("hidden", "transparent", "#000000", 1))).toBe(false);
  // A theme without the variant falls back to the dot.
  expect(isHiddenJunction(junction("hidden", "#000000", "#000000", 1))).toBe(false);
});
