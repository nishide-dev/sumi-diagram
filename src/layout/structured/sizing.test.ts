import { describe, expect, test } from "bun:test";
import { NODE_SHAPES } from "../../core/registry/manifest";
import { type DrawnShape, labelArea, rectDepthInside } from "../../lint/geometry/shapes";
import type { TextMetrics } from "../ir";
import { labelCenter, naturalSize, stretchableShape } from "./sizing";

const PADDING = { x: 14, y: 7 };

const metrics = (width: number, lines: number): TextMetrics => ({
  lines: Array.from({ length: lines }, () => "x"),
  lineWidths: Array.from({ length: lines }, () => width),
  font: "regular",
  fontSizeUnits: 16,
  lineHeightUnits: 20,
  ascentUnits: 14,
  descentUnits: 3,
  width,
  height: lines * 20,
});

const LABELS: [number, number][] = [
  [0.5, 1],
  [8, 1],
  [57.3, 1],
  [120, 2],
  [30, 4],
  [300, 1],
];

describe("naturalSize", () => {
  test("the prototype's leaves: box, label and a circle around one glyph", () => {
    expect(naturalSize("rectangle", metrics(99.5, 2), PADDING)).toEqual({
      width: 128,
      height: 54,
    });
    expect(naturalSize("text", metrics(57.3, 1), PADDING)).toEqual({ width: 58, height: 20 });
    // The prototype's icon circle is 34; a one-glyph label gives the same.
    expect(naturalSize("circle", metrics(9.6, 1), PADDING)).toEqual({ width: 34, height: 34 });
    expect(naturalSize("rectangle", undefined, PADDING)).toEqual({ width: 28, height: 14 });
  });

  const drawn = NODE_SHAPES.filter((shape): shape is DrawnShape => shape !== "text");
  test.each(drawn)("%s: the label fits in the lint's label area, padded", (shape) => {
    for (const [width, lines] of LABELS) {
      const label = metrics(width, lines);
      const size = naturalSize(shape, label, PADDING);
      expect(Number.isInteger(size.width) && Number.isInteger(size.height)).toBe(true);
      if (shape === "circle" || shape === "square") expect(size.width).toBe(size.height);
      const rect = { x: 0, y: 0, ...size };
      const center = labelCenter(shape, rect);
      const box = {
        x: center.x - width / 2,
        y: center.y - label.height / 2,
        width,
        height: label.height,
      };
      expect({
        shape,
        width,
        lines,
        fits: rectDepthInside(labelArea(shape, rect), box) >= -1e-9,
      }).toEqual({ shape, width, lines, fits: true });
    }
  });

  test("stretch resizes every shape but text, circle and square", () => {
    expect(NODE_SHAPES.filter((s) => !stretchableShape(s))).toEqual(["square", "circle", "text"]);
  });
});
