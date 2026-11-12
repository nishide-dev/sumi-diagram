import { describe, expect, test } from "bun:test";
import type { Point } from "../core/geometry";
import { clipConvex, SET_OVERLAP_BUDGET, setOverlaps } from "./set-overlap";

const square = (x: number, y: number, size: number): Point[] => [
  { x, y },
  { x: x + size, y },
  { x: x + size, y: y + size },
  { x, y: y + size },
];

const area = (polygon: readonly Point[]): number => {
  let sum = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i] as Point;
    const b = polygon[(i + 1) % polygon.length] as Point;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum / 2);
};

describe("setOverlaps (#440)", () => {
  test("collapses identical outlines, preserving all members", () => {
    const start = performance.now();
    const found = setOverlaps(
      Array.from({ length: 18 }, (_, i) => (i % 2 ? square(0, 0, 10).reverse() : square(0, 0, 10))),
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.members).toEqual(Array.from({ length: 18 }, (_, i) => i));
    expect(performance.now() - start).toBeLessThan(5000);
  });

  test("prunes a chain with only pairwise intersections", () => {
    const found = setOverlaps(Array.from({ length: 20 }, (_, i) => square(i * 6, 0, 10)));
    expect(found).toHaveLength(19);
    expect(found.every((region) => region.members.length === 2)).toBe(true);
  });

  test("bounds dense intersections and signals truncation", () => {
    let exceeded = false;
    const found = setOverlaps(
      Array.from({ length: 14 }, (_, i) => square(i * 0.1, 0, 10)),
      () => {
        exceeded = true;
      },
    );
    expect(found).toHaveLength(SET_OVERLAP_BUDGET);
    expect(exceeded).toBe(true);
    expect(found.some((region) => region.members.length > 2)).toBe(true);
  });
  test("two overlapping squares give one overlap with the common area", () => {
    const found = setOverlaps([square(0, 0, 10), square(5, 5, 10)]);
    expect(found).toHaveLength(1);
    expect(found[0]?.members).toEqual([0, 1]);
    expect(area(found[0]?.polygon ?? [])).toBeCloseTo(25, 6);
  });

  test("disjoint and merely touching sets have no overlap", () => {
    expect(setOverlaps([square(0, 0, 10), square(20, 0, 10)])).toEqual([]);
    expect(setOverlaps([square(0, 0, 10), square(10, 0, 10)])).toEqual([]);
  });

  test("a set without a fill (undefined) takes no part", () => {
    expect(setOverlaps([square(0, 0, 10), undefined, square(5, 5, 10)])).toHaveLength(1);
    expect(setOverlaps([square(0, 0, 10), undefined, square(5, 5, 10)])[0]?.members).toEqual([
      0, 2,
    ]);
  });

  test("the winding of the input does not matter", () => {
    const reversed = [...square(5, 5, 10)].reverse();
    const found = setOverlaps([square(0, 0, 10), reversed]);
    expect(area(found[0]?.polygon ?? [])).toBeCloseTo(25, 6);
  });

  test("three mutually overlapping sets give the pairs first, then the triple on top", () => {
    const found = setOverlaps([square(0, 0, 10), square(4, 0, 10), square(8, 0, 10)]);
    expect(found.map((o) => o.members)).toEqual([
      [0, 1],
      [0, 2],
      [1, 2],
      [0, 1, 2],
    ]);
    expect(area(found[3]?.polygon ?? [])).toBeCloseTo(20, 6);
  });

  test("a region common to six sets includes every member and paints last", () => {
    const stack = Array.from({ length: 6 }, (_, i) => square(i * 0.5, 0, 10));
    const found = setOverlaps(stack);
    expect(found.at(-1)?.members).toEqual([0, 1, 2, 3, 4, 5]);
    expect(area(found.at(-1)?.polygon ?? [])).toBeCloseTo(75, 6);
  });

  test("clipConvex keeps the subject when it lies inside the clip", () => {
    const inside = clipConvex(square(2, 2, 2), square(0, 0, 10));
    expect(area(inside)).toBeCloseTo(4, 6);
  });
});
