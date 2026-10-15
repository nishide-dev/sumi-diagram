import { describe, expect, test } from "bun:test";
import {
  BoundsBuilder,
  containsRect,
  distanceToRect,
  type PathSegment,
  parsePath,
  toSize,
  unitsToMm,
  unitsToPt,
} from "./geometry";

function path(d: string): PathSegment[] {
  const result = parsePath(d);
  if (!result.ok) throw new Error(result.message);
  return result.segments;
}

const M = (x: number, y: number): PathSegment => ({ command: "M", to: { x, y } });
const L = (x: number, y: number): PathSegment => ({ command: "L", to: { x, y } });
const C = (...n: [number, number, number, number, number, number]): PathSegment => ({
  command: "C",
  c1: { x: n[0], y: n[1] },
  c2: { x: n[2], y: n[3] },
  to: { x: n[4], y: n[5] },
});

describe("parsePath", () => {
  test("keeps absolute M/L/C", () => {
    expect(path("M 1 2 L 3 4 C 5 6 7 8 9 10")).toEqual([M(1, 2), L(3, 4), C(5, 6, 7, 8, 9, 10)]);
  });

  test("converts relative commands", () => {
    expect(path("m 1 2 l 3 4 c 1 1 2 2 3 3")).toEqual([M(1, 2), L(4, 6), C(5, 7, 6, 8, 7, 9)]);
  });

  test("treats extra pairs after M / m as L / l", () => {
    expect(path("M 0 0 10 0 10 10")).toEqual([M(0, 0), L(10, 0), L(10, 10)]);
    expect(path("m 1 1 2 0 0 2")).toEqual([M(1, 1), L(3, 1), L(3, 3)]);
  });

  test("converts H and V (as D2 emits for cylinders)", () => {
    expect(path("M 1 2 H 5 V 7 h -1 v -2")).toEqual([M(1, 2), L(5, 2), L(5, 7), L(4, 7), L(4, 5)]);
  });

  test("converts S with a reflected control point (as D2 emits for edge corners)", () => {
    expect(path("M 0 0 L 10 0 S 20 0 20 10")).toEqual([M(0, 0), L(10, 0), C(10, 0, 20, 0, 20, 10)]);
    expect(path("M 0 0 C 0 5 5 10 10 10 S 20 15 20 20")).toEqual([
      M(0, 0),
      C(0, 5, 5, 10, 10, 10),
      C(15, 10, 20, 15, 20, 20),
    ]);
    expect(path("M 0 0 C 0 5 5 10 10 10 s 10 5 10 10")[2]).toEqual(C(15, 10, 20, 15, 20, 20));
  });

  test("converts Q and T to exact cubics", () => {
    expect(path("M 0 0 Q 3 3 6 0")).toEqual([M(0, 0), C(2, 2, 4, 2, 6, 0)]);
    expect(path("M 0 0 Q 3 3 6 0 T 12 0")).toEqual([
      M(0, 0),
      C(2, 2, 4, 2, 6, 0),
      C(8, -2, 10, -2, 12, 0),
    ]);
  });

  test("closes subpaths with Z as a line back to the start", () => {
    expect(path("M 0 0 L 4 0 L 4 4 Z")).toEqual([M(0, 0), L(4, 0), L(4, 4), L(0, 0)]);
    expect(path("M 0 0 L 4 0 L 0 0 Z")).toEqual([M(0, 0), L(4, 0), L(0, 0)]);
    expect(path("M 0 0 L 4 0 z l 1 1")).toEqual([M(0, 0), L(4, 0), L(0, 0), L(1, 1)]);
  });

  test("reads compact number syntax", () => {
    expect(path("M1-2.5.5.5L1e1,2E-1")).toEqual([M(1, -2.5), L(0.5, 0.5), L(10, 0.2)]);
  });

  test("rejects what it cannot normalize exactly", () => {
    const fails = (d: string, message: string) => {
      const result = parsePath(d);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toContain(message);
    };
    fails("M 0 0 A 5 5 0 0 1 10 10", 'Unsupported path command "A"');
    fails("M 0 0 a 5 5 0 0 1 10 10", 'Unsupported path command "a"');
    fails("L 1 1", "must start with M");
    fails("1 1", "must start with a command");
    fails("M 0", "needs 2 numbers");
    fails("M 0 0 C 1 1 2 2", "needs 6 numbers");
    fails("M 0 0 X 1", "Invalid path data");
    fails("M 0 0 Z 1 1", "after Z");
    fails("", "empty");
    // Non-finite coordinates, from the input or from arithmetic overflow.
    fails("M 1e999 0 L 1 1", "out of range");
    fails("M 0 0 L 1 -1e400", "out of range");
    fails("M 1.7e308 0 l 1.7e308 0", "non-finite");
    fails("m 1.7e308 0 1.7e308 0", "non-finite");
    fails("M 0 0 C 0 0 -1.7e308 0 1e308 0 S 1.7e308 0 1 1", "non-finite");
    fails("M 0 0 h 1.7e308 h 1.7e308", "non-finite");
  });
});

describe("BoundsBuilder", () => {
  test("includes cubic extrema, not just control points", () => {
    // A symmetric arch from (0,0) to (10,0) peaking at y = 7.5 (controls at y = 10).
    const rect = new BoundsBuilder().addPath(path("M 0 0 C 0 10 10 10 10 0")).rect();
    expect(rect?.x).toBe(0);
    expect(rect?.width).toBe(10);
    expect(rect?.y).toBe(0);
    expect(rect?.height).toBeCloseTo(7.5, 10);
  });

  test("unions rectangles and points; empty is undefined", () => {
    expect(new BoundsBuilder().rect()).toBeUndefined();
    const rect = new BoundsBuilder()
      .addRect({ x: 1, y: 2, width: 3, height: 4 })
      .add({ x: -1, y: 10 })
      .rect();
    expect(rect).toEqual({ x: -1, y: 2, width: 5, height: 8 });
  });
});

describe("helpers", () => {
  test("unit conversion (1 unit = 0.5pt)", () => {
    expect(unitsToPt(2)).toBe(1);
    expect(unitsToMm(144)).toBeCloseTo(25.4, 10);
    expect(toSize(100)).toEqual({ units: 100, pt: 50, mm: unitsToMm(100) });
  });

  test("containment and distance", () => {
    const outer = { x: 0, y: 0, width: 10, height: 10 };
    expect(containsRect(outer, { x: 1, y: 1, width: 8, height: 8 })).toBe(true);
    expect(containsRect(outer, { x: 1, y: 1, width: 10, height: 8 })).toBe(false);
    expect(containsRect(outer, { x: 1, y: 1, width: 10, height: 8 }, 1)).toBe(true);
    expect(distanceToRect(outer, { x: 5, y: 5 })).toBe(0);
    expect(distanceToRect(outer, { x: 13, y: 14 })).toBe(5);
  });
});
