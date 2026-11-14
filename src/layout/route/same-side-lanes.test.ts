import { describe, expect, test } from "bun:test";
import type { ElementKey } from "../../core/check-state";
import type { Point, Rect } from "../ir";
import { separateSameSideRuns } from "./parallel";

const key = (s: string) => s as ElementKey;
const edge = (k: string) => ({ key: key(k), width: 2, fromRoom: 4, toRoom: 4 });
/** An east-side C route from (0, y0) out to x and back to (0, y1). */
const c = (x: number, y0: number, y1: number): Point[] => [
  { x: 0, y: y0 },
  { x, y: y0 },
  { x, y: y1 },
  { x: 0, y: y1 },
];
const run = (routes: Map<ElementKey, Point[]>, keys: string[], obstacles: Rect[] = []) => {
  const before = new Map(routes);
  separateSameSideRuns(routes, keys.map(edge), obstacles, [], () => false);
  return { before, routes };
};

describe("separateSameSideRuns (#512)", () => {
  test("nested runs on one line get lanes, the shorter nearer", () => {
    const routes = new Map([
      [key("outer"), c(20, 0, 100)],
      [key("inner"), c(20, 30, 70)],
    ]);
    run(routes, ["outer", "inner"]);
    const x = (k: string) => (routes.get(key(k)) as Point[])[1]?.x as number;
    expect(x("inner")).toBe(20);
    expect(x("outer")).toBeGreaterThanOrEqual(25);
  });

  test("overlapping but not nested spans stay as routed", () => {
    const routes = new Map([
      [key("a"), c(20, 0, 100)],
      [key("b"), c(20, 30, 130)],
    ]);
    const { before } = run(routes, ["a", "b"]);
    expect(routes).toEqual(before);
  });

  test("a move that would cross an unrelated edge is dropped", () => {
    const routes = new Map<ElementKey, Point[]>([
      [key("outer"), c(20, 0, 100)],
      [key("inner"), c(20, 30, 70)],
      [
        key("other"),
        [
          { x: 23, y: 40 },
          { x: 30, y: 40 },
        ],
      ],
    ]);
    const { before } = run(routes, ["outer", "inner", "other"]);
    expect(routes).toEqual(before);
  });
});
