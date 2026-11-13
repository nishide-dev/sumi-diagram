import { describe, expect, test } from "bun:test";
import { overlapsBeyond } from "./sets";
import { type Region, rectPolygon } from "./shapes";

const circle = (cx: number, cy: number, r: number): Region => ({
  kind: "ellipse",
  cx,
  cy,
  rx: r,
  ry: r,
});
const rect = (x: number, y: number, width: number, height: number) =>
  rectPolygon({ x, y, width, height });

describe("overlapsBeyond: exact, not sampled (#518)", () => {
  test("a 1000 x 2 rectangle cut by a small circle is found", () => {
    expect(overlapsBeyond(circle(100, 1, 10), rect(0, 0, 1000, 2), 1)).toBe(true);
    // Moved so the circle only just reaches it, and not at all.
    expect(overlapsBeyond(circle(100, 11.5, 10), rect(0, 0, 1000, 2), 1)).toBe(false);
    expect(overlapsBeyond(circle(100, 20, 10), rect(0, 0, 1000, 2), 1)).toBe(false);
  });

  test("long-thin, short-wide and vertical variants, against ellipse and polygon sets", () => {
    const sets: Region[] = [
      circle(500, 500, 30),
      { kind: "ellipse", cx: 500, cy: 500, rx: 60, ry: 15 },
      rect(480, 480, 40, 40),
      {
        kind: "polygon",
        points: [
          { x: 500, y: 470 },
          { x: 530, y: 500 },
          { x: 500, y: 530 },
          { x: 470, y: 500 },
        ],
      },
    ];
    const thin = [
      rect(0, 499, 1000, 2),
      rect(499, 0, 2, 1000),
      rect(490, 499.5, 20, 1),
      rect(0, 0, 1000, 2),
    ];
    for (const set of sets) {
      expect(overlapsBeyond(set, thin[0] as Region, 1)).toBe(true);
      expect(overlapsBeyond(set, thin[1] as Region, 1)).toBe(true);
      // Wholly inside.
      expect(overlapsBeyond(set, thin[2] as Region, 1)).toBe(true);
      expect(overlapsBeyond(set, thin[3] as Region, 1)).toBe(false);
    }
  });

  test("the tolerance is a distance, not a shrink of the node", () => {
    const set = rect(0, 0, 100, 100);
    // A node reaching 1 unit into the set is within the tolerance; 1.5 is beyond it.
    expect(overlapsBeyond(set, rect(99, 10, 50, 2), 1)).toBe(false);
    expect(overlapsBeyond(set, rect(98.5, 10, 50, 2), 1)).toBe(true);
    // The same on a circle set, and a thin node 0.5 units thick.
    expect(overlapsBeyond(circle(0, 0, 50), rect(49, -0.25, 40, 0.5), 1)).toBe(false);
    expect(overlapsBeyond(circle(0, 0, 50), rect(48.5, -0.25, 40, 0.5), 1)).toBe(true);
  });

  test("a circle node touching a set's corner region only through its box is clear", () => {
    expect(
      overlapsBeyond(circle(0, 0, 50), { kind: "ellipse", cx: 70, cy: 70, rx: 30, ry: 30 }, 1),
    ).toBe(false);
  });
});
