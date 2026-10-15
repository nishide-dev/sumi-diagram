import { describe, expect, test } from "bun:test";
import { getFontSet } from "../../core/theme/fonts";
import { fontFileFor, measureLabel } from "./measure";
import {
  depthInside,
  flattenPath,
  labelArea,
  polylinesCrossRect,
  rectDepthInside,
  rectPolygon,
  regionIntersectsRect,
  segmentCrossesRect,
  shapeOutline,
} from "./shapes";
import { label } from "./testing";

const bbox = { x: 0, y: 0, width: 100, height: 60 };

describe("regions", () => {
  test("depth inside polygons (either orientation) and ellipses", () => {
    const rect = rectPolygon(bbox);
    expect(depthInside(rect, { x: 50, y: 30 })).toBe(30);
    expect(depthInside(rect, { x: 5, y: 30 })).toBe(5);
    expect(depthInside(rect, { x: -2, y: 30 })).toBe(-2);
    const reversed = {
      kind: "polygon" as const,
      points: [...(rect.kind === "polygon" ? rect.points : [])].reverse(),
    };
    expect(depthInside(reversed, { x: 5, y: 30 })).toBe(5);
    const circle = shapeOutline("circle", { x: 0, y: 0, width: 100, height: 100 });
    expect(depthInside(circle, { x: 50, y: 50 })).toBe(50);
    expect(depthInside(circle, { x: 90, y: 50 })).toBeCloseTo(10, 9);
    expect(depthInside(circle, { x: 100, y: 100 })).toBeLessThan(0);
  });

  test("a rectangle is inside a convex region when its corners are", () => {
    const diamond = shapeOutline("diamond", bbox);
    expect(rectDepthInside(diamond, { x: 40, y: 25, width: 20, height: 10 })).toBeGreaterThan(0);
    expect(rectDepthInside(diamond, { x: 5, y: 20, width: 90, height: 20 })).toBeLessThan(0);
  });

  test("shape outlines follow D2 v0.9.0's proportions", () => {
    expect(shapeOutline("hexagon", bbox)).toEqual({
      kind: "polygon",
      points: [
        { x: 25, y: 0 },
        { x: 75, y: 0 },
        { x: 100, y: 30 },
        { x: 75, y: 60 },
        { x: 25, y: 60 },
        { x: 0, y: 30 },
      ],
    });
    expect(shapeOutline("parallelogram", bbox)).toEqual({
      kind: "polygon",
      points: [
        { x: 26, y: 0 },
        { x: 100, y: 0 },
        { x: 74, y: 60 },
        { x: 0, y: 60 },
      ],
    });
    expect(shapeOutline("oval", bbox)).toEqual({ kind: "ellipse", cx: 50, cy: 30, rx: 50, ry: 30 });
  });

  test("label areas of cylinders and documents leave out the caps and the wave", () => {
    const tall = { x: 0, y: 0, width: 100, height: 120 };
    expect(labelArea("cylinder", tall)).toEqual(
      rectPolygon({ x: 0, y: 48, width: 100, height: 48 }),
    );
    const document = labelArea("document", tall);
    expect(document.kind === "polygon" && document.points[2]?.y).toBeCloseTo(
      (120 * 14) / 18.925,
      9,
    );
    expect(labelArea("rectangle", tall)).toEqual(rectPolygon(tall));
  });

  test("intersections need more overlap than the tolerance", () => {
    const rect = rectPolygon(bbox);
    expect(regionIntersectsRect(rect, { x: 99, y: 10, width: 10, height: 10 }, 1)).toBe(false);
    expect(regionIntersectsRect(rect, { x: 97, y: 10, width: 10, height: 10 }, 1)).toBe(true);
    expect(regionIntersectsRect(rect, { x: 100, y: 10, width: 10, height: 10 }, 0)).toBe(false);
    const circle = shapeOutline("circle", { x: 0, y: 0, width: 100, height: 100 });
    // In the bounding box's corner, outside the circle.
    expect(regionIntersectsRect(circle, { x: 0, y: 0, width: 12, height: 12 }, 0)).toBe(false);
    expect(regionIntersectsRect(circle, { x: 0, y: 40, width: 12, height: 12 }, 0)).toBe(true);
    const diamond = shapeOutline("diamond", bbox);
    expect(regionIntersectsRect(diamond, { x: 0, y: 0, width: 20, height: 10 }, 0)).toBe(false);
    expect(regionIntersectsRect(diamond, { x: 40, y: 0, width: 20, height: 10 }, 0)).toBe(true);
  });
});

describe("edge routes", () => {
  test("segments crossing a rectangle (shrunk by the tolerance)", () => {
    const rect = { x: 10, y: 10, width: 20, height: 10 };
    expect(segmentCrossesRect({ x: 0, y: 15 }, { x: 40, y: 15 }, rect, 1)).toBe(true);
    expect(segmentCrossesRect({ x: 20, y: 0 }, { x: 20, y: 12 }, rect, 1)).toBe(true);
    // Along the border, or ending before the rectangle.
    expect(segmentCrossesRect({ x: 0, y: 10.5 }, { x: 40, y: 10.5 }, rect, 1)).toBe(false);
    expect(segmentCrossesRect({ x: 0, y: 15 }, { x: 10.5, y: 15 }, rect, 1)).toBe(false);
    // A diagonal that misses the corner.
    expect(segmentCrossesRect({ x: 0, y: 8 }, { x: 12, y: -4 }, rect, 0)).toBe(false);
  });

  test("cubics are flattened into bounded chords", () => {
    const [line] = flattenPath([
      { command: "M", to: { x: 0, y: 0 } },
      { command: "L", to: { x: 10, y: 0 } },
      { command: "C", c1: { x: 20, y: 0 }, c2: { x: 20, y: 0 }, to: { x: 20, y: 10 } },
    ]);
    expect(line?.length).toBe(2 + 16);
    expect(line?.[line.length - 1]).toEqual({ x: 20, y: 10 });
    expect(polylinesCrossRect([line ?? []], { x: 17, y: 1, width: 6, height: 4 }, 0)).toBe(true);
  });
});

describe("label measurement", () => {
  const set = getFontSet("sumi/biz-ud-gothic");
  if (set?.mono === undefined) throw new Error("bundled font set is missing");
  const fonts = { ...set, mono: set.mono };

  test("font files per D2 font class", () => {
    expect(fontFileFor("regular", fonts)).toBe(fonts.regular);
    expect(fontFileFor("bold", fonts)).toBe(fonts.bold);
    expect(fontFileFor("semibold", fonts)).toBe(fonts.bold);
    expect(fontFileFor("mono-bold", fonts)).toBe(fonts.mono);
    expect(fontFileFor("italic", fonts)).toBe(fonts.regular); // no italic slot
  });

  test("boxes from the anchor (center, baseline), advances and line height", () => {
    const measured = measureLabel(label("漢漢\nA", 100, 50, { lineHeightUnits: 18.5 }), fonts);
    const ascent = (1802 / 2048) * 16;
    expect(measured.lines).toEqual([
      { x: 84, y: 50 - ascent, width: 32, height: 16 },
      { x: 100 - (1556 / 2048) * 8, y: 68.5 - ascent, width: (1556 / 2048) * 16, height: 16 },
    ]);
    expect(measured.box).toEqual({ x: 84, y: 50 - ascent, width: 32, height: 18.5 + 16 });
    expect(measured.fontPath).toBe(fonts.regular);
  });

  test("bold labels use the bold advances", () => {
    const measured = measureLabel(label("A", 0, 0, { font: "bold" }), fonts);
    expect(measured.box.width).toBe((1597 / 2048) * 16);
  });
});
