import { describe, expect, test } from "bun:test";
import { FINAL_DOT_RATIO, STATE_MARKER_KINDS, stateMarker } from "./state-marker";
import { assertOutlineDrawing } from "./testing";

const parse = (written: object) => Object.freeze(stateMarker.params.parse(written));

describe("sumi/state-marker (#519)", () => {
  test("the default diameter is a multiple of the text size; an explicit size wins", () => {
    const label = { width: 1, height: 1 };
    expect(stateMarker.footprint(label, parse({ kind: "initial" }))).toEqual({
      width: 20,
      height: 20,
    });
    expect(stateMarker.footprint(label, parse({ kind: "final" }))).toEqual({
      width: 28,
      height: 28,
    });
    expect(stateMarker.footprint(label, parse({ kind: "final", em: 32 }))).toEqual({
      width: 56,
      height: 56,
    });
    expect(stateMarker.footprint(label, parse({ kind: "initial", size: 12 }))).toEqual({
      width: 12,
      height: 12,
    });
  });

  test("a small explicit size is raised to the minimum that keeps a final marker's gap", () => {
    expect(
      stateMarker.footprint({ width: 1, height: 1 }, parse({ kind: "final", size: 4 })),
    ).toEqual({
      width: 12,
      height: 12,
    });
  });

  for (const kind of STATE_MARKER_KINDS) {
    test(`${kind}: a closed circle in its footprint`, () => {
      const footprint = Object.freeze({ x: 3, y: 5, width: 24, height: 24 });
      const drawing = stateMarker.draw(footprint, parse({ kind }));
      assertOutlineDrawing(drawing, footprint);
      const xs = drawing.outline.map((p) => p.x);
      const ys = drawing.outline.map((p) => p.y);
      expect(Math.min(...xs)).toBeCloseTo(3, 6);
      expect(Math.max(...xs)).toBeCloseTo(27, 6);
      expect(Math.min(...ys)).toBeCloseTo(5, 6);
      expect(Math.max(...ys)).toBeCloseTo(29, 6);
      expect(stateMarker.draw(footprint, parse({ kind }))).toEqual(drawing);
    });
  }

  test("initial is one dot; final is a ring (two half rings) around a smaller dot", () => {
    const footprint = { x: 0, y: 0, width: 20, height: 20 };
    const initial = stateMarker.draw(footprint, parse({ kind: "initial" }));
    expect(initial.layers.map((l) => l.role)).toEqual(["body"]);
    const final = stateMarker.draw(footprint, parse({ kind: "final" }));
    expect(final.layers.map((l) => l.role)).toEqual(["body", "body", "body"]);
    const radius = (points: readonly { x: number; y: number }[]) =>
      Math.hypot((points[0]?.x ?? 0) - 10, (points[0]?.y ?? 0) - 10);
    expect(radius(final.layers[2]?.path.points ?? [])).toBeCloseTo(10 * FINAL_DOT_RATIO, 6);
  });
});
