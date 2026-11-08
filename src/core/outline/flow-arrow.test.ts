import { describe, expect, test } from "bun:test";
import {
  FLOW_ARROW_DIRECTIONS,
  FLOW_ARROW_FORMS,
  FLOW_ARROW_LENGTHS,
  type FlowArrowDirection,
  flowArrow,
} from "./flow-arrow";
import { assertOutlineDrawing } from "./testing";

const parse = (written: object) => Object.freeze(flowArrow.params.parse(written));
const bounds = (points: readonly { x: number; y: number }[]) => ({
  minX: Math.min(...points.map((p) => p.x)),
  maxX: Math.max(...points.map((p) => p.x)),
  minY: Math.min(...points.map((p) => p.y)),
  maxY: Math.max(...points.map((p) => p.y)),
});

describe("sumi/flow-arrow (#426)", () => {
  test("the default footprint is a multiple of the text size, turned by the direction", () => {
    for (const form of FLOW_ARROW_FORMS) {
      const length = 16 * FLOW_ARROW_LENGTHS[form];
      expect(flowArrow.footprint({ width: 1, height: 1 }, parse({ form }))).toEqual({
        width: length,
        height: 16,
      });
      for (const direction of ["up", "down"])
        expect(flowArrow.footprint({ width: 1, height: 1 }, parse({ form, direction }))).toEqual({
          width: 16,
          height: length,
        });
    }
    // A block arrow is 1.6 em long and 1 em thick; the em follows the theme.
    expect(flowArrow.footprint({ width: 1, height: 1 }, parse({ em: 32 }))).toEqual({
      width: 51.2,
      height: 32,
    });
    // Explicit sizes name the length along the arrow whichever way it points.
    const explicit = { length: 60, thickness: 20 };
    expect(flowArrow.footprint({ width: 1, height: 1 }, parse(explicit))).toEqual({
      width: 60,
      height: 20,
    });
    expect(
      flowArrow.footprint({ width: 1, height: 1 }, parse({ ...explicit, direction: "left" })),
    ).toEqual({ width: 60, height: 20 });
    expect(
      flowArrow.footprint({ width: 1, height: 1 }, parse({ ...explicit, direction: "up" })),
    ).toEqual({ width: 20, height: 60 });
  });

  for (const form of FLOW_ARROW_FORMS) {
    for (const direction of FLOW_ARROW_DIRECTIONS) {
      test(`${form}/${direction}: a closed polygon in its footprint, tip on the pointing side`, () => {
        for (const size of [
          { width: 26, height: 16 },
          { width: 16, height: 26 },
          { width: 40, height: 40 },
          { width: 6, height: 90 },
          { width: 90, height: 6 },
        ]) {
          const footprint = Object.freeze({ x: -12.5, y: 24, ...size });
          for (const written of [{}, { head: 0.1 }, { head: 1 }, { shaft: 0.1 }, { shaft: 0.9 }]) {
            const p = parse({ form, direction, ...written });
            const drawing = flowArrow.draw(footprint, p);
            assertOutlineDrawing(drawing, footprint);
            expect(drawing.layers).toHaveLength(1);
            expect(drawing.layers[0]).toMatchObject({ role: "body", path: { closed: true } });
            expect(drawing.fixedPort).toBeUndefined();
            expect(flowArrow.draw(footprint, p)).toEqual(drawing);
            // The silhouette spans the whole footprint.
            const b = bounds(drawing.outline);
            expect(b.minX).toBeCloseTo(footprint.x, 9);
            expect(b.maxX).toBeCloseTo(footprint.x + footprint.width, 9);
            expect(b.minY).toBeCloseTo(footprint.y, 9);
            expect(b.maxY).toBeCloseTo(footprint.y + footprint.height, 9);
          }
        }
      });
    }
  }

  test("the tip is the middle of the far side for every direction", () => {
    const footprint = { x: 10, y: 20, width: 40, height: 40 };
    const tips: Record<FlowArrowDirection, { x: number; y: number }> = {
      right: { x: 50, y: 40 },
      left: { x: 10, y: 40 },
      up: { x: 30, y: 20 },
      down: { x: 30, y: 60 },
    };
    for (const form of FLOW_ARROW_FORMS)
      for (const direction of FLOW_ARROW_DIRECTIONS) {
        const { outline } = flowArrow.draw(footprint, parse({ form, direction }));
        expect(outline).toContainEqual(tips[direction]);
      }
  });

  test("a block arrow has a shaft and a head of the asked proportions", () => {
    const rect = { x: 0, y: 0, width: 60, height: 20 };
    const { outline } = flowArrow.draw(rect, parse({ head: 0.5, shaft: 0.4 }));
    expect(outline).toEqual([
      { x: 0, y: 6 },
      { x: 50, y: 6 },
      { x: 50, y: 0 },
      { x: 60, y: 10 },
      { x: 50, y: 20 },
      { x: 50, y: 14 },
      { x: 0, y: 14 },
    ]);
    // The head is a fraction of the shorter side: here the thickness, as in PowerPoint's rightArrow.
    const wide = flowArrow.draw(rect, parse({ head: 1 })).outline;
    expect(wide[1]).toEqual({ x: 40, y: 5 });
  });

  test("a triangle points at the tip and a chevron has a notch", () => {
    const rect = { x: 0, y: 0, width: 18, height: 20 };
    expect(flowArrow.draw(rect, parse({ form: "triangle" })).outline).toEqual([
      { x: 0, y: 0 },
      { x: 18, y: 10 },
      { x: 0, y: 20 },
    ]);
    const chevron = flowArrow.draw(
      { x: 0, y: 0, width: 30, height: 20 },
      parse({ form: "chevron", head: 0.5 }),
    ).outline;
    expect(chevron).toEqual([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 30, y: 10 },
      { x: 20, y: 20 },
      { x: 0, y: 20 },
      { x: 10, y: 10 },
    ]);
  });

  test("rejects values outside the contract", () => {
    for (const written of [
      { form: "round" },
      { direction: "north" },
      { length: 0 },
      { thickness: -1 },
      { head: 0 },
      { head: 1.1 },
      { shaft: 1 },
      { unknown: 1 },
    ])
      expect(flowArrow.params.safeParse(written).success).toBe(false);
  });
});
