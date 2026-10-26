import { describe, expect, test } from "bun:test";
import {
  ellipseDepth,
  obstaclesCrossedByRoute,
  segmentCrossesRegion,
  segmentInterval,
} from "./edges";
import { rectPolygon, shapeOutline } from "./shapes";

const square = rectPolygon({ x: 0, y: 0, width: 10, height: 10 });
const circle = shapeOutline("circle", { x: 0, y: 0, width: 10, height: 10 });
const diamond = shapeOutline("diamond", { x: 0, y: 0, width: 10, height: 10 });

describe("segmentCrossesRegion", () => {
  test("through, beside, along and ending on a rectangle", () => {
    expect(segmentCrossesRegion({ x: -5, y: 5 }, { x: 15, y: 5 }, square, 0)).toBe(true);
    expect(segmentCrossesRegion({ x: -5, y: 12 }, { x: 15, y: 12 }, square, 0)).toBe(false);
    expect(segmentCrossesRegion({ x: -5, y: 10 }, { x: 15, y: 10 }, square, 0)).toBe(false);
    expect(segmentCrossesRegion({ x: 5, y: -5 }, { x: 5, y: 0 }, square, 0)).toBe(false);
    // Only 0.5 deep, within a tolerance of 1.
    expect(segmentCrossesRegion({ x: -5, y: 9.5 }, { x: 15, y: 9.5 }, square, 1)).toBe(false);
    expect(segmentCrossesRegion({ x: -5, y: 8.5 }, { x: 15, y: 8.5 }, square, 1)).toBe(true);
  });

  test("circles and diamonds: corners of the bounding box are outside", () => {
    expect(segmentCrossesRegion({ x: -1, y: 0.5 }, { x: 1.5, y: 0.5 }, circle, 0)).toBe(false);
    expect(segmentCrossesRegion({ x: -1, y: 5 }, { x: 1, y: 5 }, circle, 0)).toBe(true);
    expect(segmentCrossesRegion({ x: -1, y: 2 }, { x: 2.5, y: 2 }, diamond, 0)).toBe(false);
    expect(segmentCrossesRegion({ x: -1, y: 5 }, { x: 2, y: 5 }, diamond, 0)).toBe(true);
    // Tangent to the circle.
    expect(segmentCrossesRegion({ x: -5, y: 0 }, { x: 15, y: 0 }, circle, 0)).toBe(false);
  });

  test("an elongated ellipse: the tolerance is a distance from the outline", () => {
    const oval = { kind: "ellipse", cx: 0, cy: 0, rx: 100, ry: 10 } as const;
    // About 0.79 unit from the outline: shallower than the tolerance of 1
    // (shrinking both radii by 1 would count it).
    expect(segmentCrossesRegion({ x: 69.9, y: 6.35 }, { x: 70.1, y: 6.35 }, oval, 1)).toBe(false);
    expect(segmentCrossesRegion({ x: 69.9, y: 5 }, { x: 70.1, y: 5 }, oval, 1)).toBe(true);
    expect(segmentCrossesRegion({ x: -200, y: 9.5 }, { x: 200, y: 9.5 }, oval, 1)).toBe(false);
    expect(segmentCrossesRegion({ x: -200, y: 8.5 }, { x: 200, y: 8.5 }, oval, 1)).toBe(true);
  });

  test("ellipseDepth", () => {
    expect(ellipseDepth({ cx: 0, cy: 0, rx: 5, ry: 5 }, { x: 0, y: 0 })).toBe(5);
    expect(ellipseDepth({ cx: 0, cy: 0, rx: 100, ry: 10 }, { x: 0, y: 0 })).toBe(10);
    expect(ellipseDepth({ cx: 0, cy: 0, rx: 100, ry: 10 }, { x: 99, y: 0 })).toBeCloseTo(1, 9);
    expect(ellipseDepth({ cx: 0, cy: 0, rx: 100, ry: 10 }, { x: 70, y: 6.35 })).toBeCloseTo(
      0.7876,
      3,
    );
    expect(ellipseDepth({ cx: 0, cy: 0, rx: 100, ry: 10 }, { x: 0, y: 20 })).toBe(0);
  });

  test("the interval along the segment", () => {
    expect(segmentInterval({ x: -10, y: 5 }, { x: 10, y: 5 }, square, 0)).toEqual([0.5, 1]);
    const [t0, t1] = segmentInterval({ x: 5, y: -5 }, { x: 5, y: 15 }, circle, 0) ?? [];
    expect(t0).toBeCloseTo(0.25, 9);
    expect(t1).toBeCloseTo(0.75, 9);
  });
});

test("obstaclesCrossedByRoute: in obstacle order, ends excluded", () => {
  const obstacles = [
    { key: "n:b" as const, region: rectPolygon({ x: 20, y: 0, width: 10, height: 10 }) },
    { key: "n:a" as const, region: square },
    { key: "n:c" as const, region: rectPolygon({ x: 40, y: 0, width: 10, height: 10 }) },
  ];
  const route = [
    [
      { x: -5, y: 5 },
      { x: 55, y: 5 },
    ],
  ];
  expect(obstaclesCrossedByRoute(route, obstacles, new Set(), 0)).toEqual(["n:b", "n:a", "n:c"]);
  expect(obstaclesCrossedByRoute(route, obstacles, new Set(["n:a", "n:c"] as const), 0)).toEqual([
    "n:b",
  ]);
});
