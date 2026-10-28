import { describe, expect, test } from "bun:test";
import { HATCH, hatchSegments } from "./hatch";

const rect = { x: 10, y: 20, width: 24, height: 18 };

describe("hatchSegments (#180)", () => {
  test("45° lines rising to the right, `period` apart along x, centered in the rectangle", () => {
    const segments = hatchSegments(rect, 0, 0);
    // x + y runs over 24 + 18 = 42 units: 8 lines, the leftover 7 split evenly.
    expect(segments).toHaveLength(Math.floor(42 / HATCH.period));
    const sums = segments.map(([a]) => a.x + a.y);
    expect(sums[0]).toBe(30 + (42 - 7 * HATCH.period) / 2);
    for (const [i, [a, b]] of segments.entries()) {
      // From the lower-left end to the upper-right one, on one line x + y = k.
      expect(a.x).toBeLessThan(b.x);
      expect(a.y).toBeGreaterThan(b.y);
      expect(a.x + a.y).toBeCloseTo(b.x + b.y, 9);
      if (i > 0) expect(a.x + a.y - (sums[i - 1] as number)).toBeCloseTo(HATCH.period, 9);
      // Clipped to the rectangle.
      for (const p of [a, b]) {
        expect(p.x).toBeGreaterThanOrEqual(10);
        expect(p.x).toBeLessThanOrEqual(34);
        expect(p.y).toBeGreaterThanOrEqual(20);
        expect(p.y).toBeLessThanOrEqual(38);
      }
    }
  });

  test("equal rectangles get equal hatching wherever they are", () => {
    const moved = hatchSegments({ ...rect, x: 110.5, y: -3 }, 4, 1.5);
    const here = hatchSegments(rect, 4, 1.5);
    expect(moved.map(([a, b]) => [a.x - 110.5, a.y + 3, b.x - 110.5, b.y + 3])).toEqual(
      here.map(([a, b]) => [
        expect.closeTo(a.x - 10, 9),
        expect.closeTo(a.y - 20, 9),
        expect.closeTo(b.x - 10, 9),
        expect.closeTo(b.y - 20, 9),
      ]),
    );
  });

  test("the inset keeps the lines off the outline", () => {
    for (const [a, b] of hatchSegments(rect, 0, 2)) {
      for (const p of [a, b]) {
        expect(p.x).toBeGreaterThanOrEqual(12 - 1e-9);
        expect(p.x).toBeLessThanOrEqual(32 + 1e-9);
        expect(p.y).toBeGreaterThanOrEqual(22 - 1e-9);
        expect(p.y).toBeLessThanOrEqual(36 + 1e-9);
      }
    }
  });

  test("rounded corners: the ends lie on or inside the rounded outline", () => {
    const radius = 6;
    const inset = 1;
    const r = radius - inset;
    const inside = (x: number, y: number) => {
      const left = rect.x + inset;
      const top = rect.y + inset;
      const right = rect.x + rect.width - inset;
      const bottom = rect.y + rect.height - inset;
      const cx = Math.min(Math.max(x, left + r), right - r);
      const cy = Math.min(Math.max(y, top + r), bottom - r);
      return Math.hypot(x - cx, y - cy) <= r + 1e-9;
    };
    const segments = hatchSegments(rect, radius, inset);
    expect(segments.length).toBeGreaterThan(0);
    for (const [a, b] of segments) {
      expect(inside(a.x, a.y)).toBe(true);
      expect(inside(b.x, b.y)).toBe(true);
    }
    // The corner the lines cross diagonally (top-left) cuts the first line
    // shorter than in a square rectangle.
    const square = hatchSegments(rect, 0, inset);
    const length = ([a, b]: (typeof segments)[number]) => Math.hypot(b.x - a.x, b.y - a.y);
    expect(length(segments[0] as (typeof segments)[number])).toBeLessThan(
      length(square[0] as (typeof square)[number]),
    );
  });

  test("nothing for a rectangle the inset swallows", () => {
    expect(hatchSegments({ x: 0, y: 0, width: 2, height: 2 }, 0, 1)).toEqual([]);
    expect(hatchSegments({ x: 0, y: 0, width: 3, height: 1 }, 0, 0)).toEqual([]);
  });
});
