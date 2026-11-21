import { describe, expect, test } from "bun:test";
import type { ElementKey } from "../../core/check-state";
import type { Point } from "../ir";
import { keepClearOfLanes } from "./parallel";

const key = (s: string) => s as ElementKey;
const edges = [
  { key: key("lane"), width: 2, fromRoom: 0, toRoom: 0 },
  { key: key("movable"), width: 2, fromRoom: 8, toRoom: 0 },
];
const MOVABLE: Point[] = [
  { x: 0, y: 0 },
  { x: 0, y: 10 },
  { x: 100, y: 10 },
  { x: 100, y: 30 },
];
const run = (lane: Point[]) => {
  const routes = new Map<ElementKey, Point[]>([
    [key("lane"), lane],
    [key("movable"), MOVABLE],
  ]);
  keepClearOfLanes(routes, edges, [], [], () => false, new Set([key("lane")]));
  return routes.get(key("movable")) as Point[];
};

describe("keepClearOfLanes (#609)", () => {
  test("a run beside a lane moves a lane gap away", () => {
    // A lane hanging down to y = 11 between x = 20 and 90: the run at y = 10 is too close.
    const moved = run([
      { x: 20, y: 0 },
      { x: 20, y: 11 },
      { x: 90, y: 11 },
      { x: 90, y: 0 },
    ]);
    // Not up (5.98 is inside the source's room of 8): down, 1 + 1 + 3.02 below the lane.
    expect(moved).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 16.02 },
      { x: 100, y: 16.02 },
      { x: 100, y: 30 },
    ]);
  });

  test("a move that would put a leg along the lane is dropped", () => {
    // The lane runs down x = 0 from y = 11 to 13: moving the run to y = 18.02 would stretch
    // the first leg (x = 0) over it, collinear. The count of crossings would not change.
    const moved = run([
      { x: 110, y: 11 },
      { x: 0, y: 11 },
      { x: 0, y: 13 },
      { x: 110, y: 13 },
    ]);
    expect(moved).toEqual(MOVABLE);
  });

  test("a move that trades one crossing for another is dropped", () => {
    // Old run (y = 10) crosses the lane's leg at x = 20; the moved run (y = 16.02) would cross
    // its other leg at x = 60 instead: the same count, a new crossing point.
    const moved = run([
      { x: 20, y: 0 },
      { x: 20, y: 11 },
      { x: 60, y: 11 },
      { x: 60, y: 40 },
    ]);
    expect(moved).toEqual(MOVABLE);
  });
});
