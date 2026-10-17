// Smoke test for the #18 PoC geometry (no D2 needed). Research code.
import { describe, expect, test } from "bun:test";
import type { Point, Rect } from "../../src/render/geometry";
import { CUSTOM_SHAPES, rayHit, rectPolygon } from "./shapes";

const footprint: Rect = { x: 10, y: 20, width: 160, height: 80 };
const inside = (p: Point, r: Rect) =>
  p.x >= r.x - 1e-9 &&
  p.x <= r.x + r.width + 1e-9 &&
  p.y >= r.y - 1e-9 &&
  p.y <= r.y + r.height + 1e-9;

describe("custom shapes", () => {
  for (const shape of Object.values(CUSTOM_SHAPES)) {
    test(`${shape.name}: layers and outline stay inside the footprint`, () => {
      const drawing = shape.draw(footprint);
      for (const p of [...drawing.layers.flat(), ...drawing.outline]) {
        expect(inside(p, footprint)).toBe(true);
      }
    });

    test(`${shape.name}: the footprint for a label box holds it in the safe area`, () => {
      const label = { width: 93, height: 61 };
      const size = shape.footprintFor(label);
      const { safeArea } = shape.draw({ x: 0, y: 0, ...size });
      expect(safeArea.width).toBeGreaterThanOrEqual(label.width - 1e-9);
      expect(safeArea.height).toBeGreaterThanOrEqual(label.height - 1e-9);
    });

    test(`${shape.name}: inward rays from every side hit the outline`, () => {
      const { outline } = shape.draw(footprint);
      const { x, y, width: w, height: h } = footprint;
      for (const f of [0.1, 0.5, 0.9]) {
        expect(rayHit(outline, { x: x - 2, y: y + f * h }, { x: 1, y: 0 })).toBeDefined();
        expect(rayHit(outline, { x: x + w + 2, y: y + f * h }, { x: -1, y: 0 })).toBeDefined();
        expect(rayHit(outline, { x: x + f * w, y: y - 2 }, { x: 0, y: 1 })).toBeDefined();
        expect(rayHit(outline, { x: x + f * w, y: y + h + 2 }, { x: 0, y: -1 })).toBeDefined();
      }
    });
  }

  test("rayHit returns the nearest crossing", () => {
    const square = rectPolygon({ x: 0, y: 0, width: 10, height: 10 });
    expect(rayHit(square, { x: -3, y: 5 }, { x: 1, y: 0 })).toBe(3);
    expect(rayHit(square, { x: -3, y: 20 }, { x: 1, y: 0 })).toBeUndefined();
  });

  test("trapezoid: a mid-height ray from the left stops short of the footprint by s/2", () => {
    const { outline } = CUSTOM_SHAPES.trapezoid?.draw(footprint) ?? { outline: [] };
    const s = 0.4 * footprint.height;
    const t = rayHit(outline, { x: 0, y: 60 }, { x: 1, y: 0 });
    expect(t).toBeCloseTo(10 + s / 2);
  });
});
