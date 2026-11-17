import { describe, expect, test } from "bun:test";
import {
  clipSegmentToConvex,
  mapFlatPoint,
  mapFlatRect,
  type PlaneFrame,
  planeBasis,
  planeExtent,
  planeQuad,
  pointsBounds,
  unmapPoint,
} from "./plane";

const floor = { orientation: "floor", angle: 45, depthScale: 0.5 } as const;
const wall = { orientation: "wall", angle: 45, depthScale: 0.5 } as const;
const K = 0.5 * Math.cos(Math.PI / 4);

/** A 100 × 56 flat frame whose bottom left corner maps to (10, 80). */
const frameOf = (projection: PlaneFrame["projection"]): PlaneFrame => ({
  projection,
  frame: { x: 200, y: 300, width: 100, height: 56 },
  origin: { x: 10, y: 80 },
});

describe("plane basis and extent", () => {
  test("a floor maps u along x and v back up and right", () => {
    const { u, v } = planeBasis(floor);
    expect(u).toEqual({ x: 1, y: 0 });
    expect(v.x).toBeCloseTo(K, 12);
    expect(v.y).toBeCloseTo(-K, 12);
  });

  test("a wall maps u into the depth and v straight up", () => {
    const { u, v } = planeBasis(wall);
    expect(u.x).toBeCloseTo(K, 12);
    expect(u.y).toBeCloseTo(-K, 12);
    expect(v).toEqual({ x: 0, y: -1 });
  });

  test("the extent of a 100 × 56 floor at 45 degrees is about 120 × 20", () => {
    const e = planeExtent(floor, 100, 56);
    expect(e.width).toBeCloseTo(100 + 56 * K, 9);
    expect(e.height).toBeCloseTo(56 * K, 9);
    expect(e.width).toBeGreaterThan(119);
    expect(e.height).toBeCloseTo(19.8, 1);
  });

  test("a 30 degree projection with scale 0.7 uses its own factors", () => {
    const e = planeExtent({ orientation: "floor", angle: 30, depthScale: 0.7 }, 100, 40);
    expect(e.width).toBeCloseTo(100 + 40 * 0.7 * Math.cos(Math.PI / 6), 9);
    expect(e.height).toBeCloseTo(40 * 0.7 * 0.5, 9);
  });

  test("the extent of a wall is the depth run plus the height", () => {
    const e = planeExtent(wall, 100, 56);
    expect(e.width).toBeCloseTo(100 * K, 9);
    expect(e.height).toBeCloseTo(100 * K + 56, 9);
  });
});

describe("mapping points", () => {
  test("the flat frame's bottom left corner is the origin, and u runs along the front edge", () => {
    const plane = frameOf(floor);
    expect(mapFlatPoint(plane, { x: 200, y: 356 })).toEqual({ x: 10, y: 80 });
    expect(mapFlatPoint(plane, { x: 300, y: 356 })).toEqual({ x: 110, y: 80 });
  });

  test("a point v up in the flat frame moves back up and right on a floor", () => {
    const p = mapFlatPoint(frameOf(floor), { x: 230, y: 356 - 40 });
    expect(p.x).toBeCloseTo(10 + 30 + 40 * K, 9);
    expect(p.y).toBeCloseTo(80 - 40 * K, 9);
  });

  test("a wall runs its flat x axis into the depth", () => {
    const p = mapFlatPoint(frameOf(wall), { x: 230, y: 356 - 40 });
    expect(p.x).toBeCloseTo(10 + 30 * K, 9);
    expect(p.y).toBeCloseTo(80 - 30 * K - 40, 9);
  });

  test("unmapping inverts mapping for both orientations", () => {
    for (const projection of [floor, wall, { ...floor, angle: 30, depthScale: 0.7 }]) {
      const plane = frameOf(projection);
      for (const flat of [
        { x: 200, y: 300 },
        { x: 251.5, y: 333.25 },
        { x: 300, y: 356 },
      ]) {
        const back = unmapPoint(plane, mapFlatPoint(plane, flat));
        expect(back.x).toBeCloseTo(flat.x, 9);
        expect(back.y).toBeCloseTo(flat.y, 9);
      }
    }
  });

  test("the quad is a parallelogram inside the extent's box at the origin", () => {
    const plane = frameOf(floor);
    const quad = planeQuad(plane);
    const [fl, fr, br, bl] = quad;
    expect(fl).toEqual({ x: 10, y: 80 });
    expect(fr).toEqual({ x: 110, y: 80 });
    // Opposite sides are parallel and equal.
    expect((br?.x ?? 0) - (fr?.x ?? 0)).toBeCloseTo((bl?.x ?? 0) - (fl?.x ?? 0), 9);
    expect((br?.y ?? 0) - (fr?.y ?? 0)).toBeCloseTo((bl?.y ?? 0) - (fl?.y ?? 0), 9);
    const box = pointsBounds(quad);
    const extent = planeExtent(floor, 100, 56);
    expect(box.x).toBeCloseTo(10, 9);
    expect(box.y + box.height).toBeCloseTo(80, 9);
    expect(box.width).toBeCloseTo(extent.width, 9);
    expect(box.height).toBeCloseTo(extent.height, 9);
  });

  test("the quad of a wall has its bounding box at the origin too", () => {
    const quad = planeQuad(frameOf(wall));
    const box = pointsBounds(quad);
    const extent = planeExtent(wall, 100, 56);
    expect(box.x).toBeCloseTo(10, 9);
    expect(box.y + box.height).toBeCloseTo(80, 9);
    expect(box.width).toBeCloseTo(extent.width, 9);
    expect(box.height).toBeCloseTo(extent.height, 9);
  });

  test("a node keeps its size and upright shape: only its center moves", () => {
    const plane = frameOf(floor);
    const rect = { x: 240, y: 320, width: 17.2, height: 17.2 };
    const mapped = mapFlatRect(plane, rect);
    expect(mapped.width).toBe(17.2);
    expect(mapped.height).toBe(17.2);
    const center = mapFlatPoint(plane, { x: 248.6, y: 328.6 });
    expect(mapped.x + mapped.width / 2).toBeCloseTo(center.x, 9);
    expect(mapped.y + mapped.height / 2).toBeCloseTo(center.y, 9);
  });
});

describe("clipSegmentToConvex", () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];

  test("keeps the inside part of a segment crossing the polygon", () => {
    expect(clipSegmentToConvex({ x: 5, y: -10 }, { x: 5, y: 20 }, square)).toEqual([1 / 3, 2 / 3]);
  });

  test("returns the whole segment when it is inside and none when it misses", () => {
    expect(clipSegmentToConvex({ x: 2, y: 2 }, { x: 8, y: 8 }, square)).toEqual([0, 1]);
    expect(clipSegmentToConvex({ x: 20, y: 0 }, { x: 30, y: 10 }, square)).toBeUndefined();
  });

  test("does not depend on the polygon's orientation", () => {
    const reversed = [...square].reverse();
    expect(clipSegmentToConvex({ x: 5, y: -10 }, { x: 5, y: 20 }, reversed)).toEqual([
      1 / 3,
      2 / 3,
    ]);
  });

  test("a segment along an edge outside the polygon is dropped", () => {
    expect(clipSegmentToConvex({ x: -5, y: -1 }, { x: 15, y: -1 }, square)).toBeUndefined();
  });
});
