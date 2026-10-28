/** Turned labels (#178): the measured boxes of a label drawn with `rotate(±90 cx cy)`. */

import { describe, expect, test } from "bun:test";
import { getFontSet } from "../../core/theme/fonts";
import type { Rect } from "../../render/geometry";
import { inkLines, measureLabel, turnRect } from "./measure";
import { label } from "./testing";

const fonts = getFontSet("sumi/biz-ud-gothic");
if (fonts === undefined) throw new Error("bundled font set is missing");

const close = (rect: Rect | undefined) => {
  if (rect === undefined) throw new Error("no box");
  return [rect.x, rect.y, rect.width, rect.height].map((v) => Math.round(v * 1e6) / 1e6);
};

describe("turnRect", () => {
  const rect = { x: 10, y: 20, width: 40, height: 10 };
  const center = { x: 30, y: 25 };

  test("about the rect's own center: width and height swap in place", () => {
    for (const degrees of [90, -90]) {
      expect(turnRect(rect, { degrees, center })).toEqual({ x: 25, y: 5, width: 10, height: 40 });
    }
  });

  test("about another point, as SVG's rotate(): positive clockwise with y down", () => {
    // The rect's center (30, 25) is 30 right of (0, 25): rotate(90) puts it 30 below.
    expect(turnRect(rect, { degrees: 90, center: { x: 0, y: 25 } })).toEqual({
      x: -5,
      y: 35,
      width: 10,
      height: 40,
    });
    expect(turnRect(rect, { degrees: -90, center: { x: 0, y: 25 } })).toEqual({
      x: -5,
      y: -25,
      width: 10,
      height: 40,
    });
  });

  test("turning back by the opposite angle about the same point restores the rect", () => {
    const at = { x: 3, y: -7 };
    for (const degrees of [90, -90]) {
      const turned = turnRect(rect, { degrees, center: at });
      expect(turnRect(turned, { degrees: -degrees, center: at })).toEqual(rect);
    }
  });
});

describe("measureLabel of a turned label", () => {
  const text = "Visual VAE Encoder\nsecond";
  const upright = label(text, 100, 50, { lineHeightUnits: 20 });
  const center = { x: 100, y: 60 };

  test("every box is the upright one turned about the center", () => {
    const plain = measureLabel(upright, fonts);
    for (const degrees of [90, -90] as const) {
      const turned = measureLabel({ ...upright, rotation: { degrees, center } }, fonts);
      const turn = (r: Rect) => close(turnRect(r, { degrees, center }));
      expect(turned.texts).toEqual(plain.texts);
      expect(turned.lines.map(close)).toEqual(plain.lines.map(turn));
      expect(turned.visibleLines.map(close)).toEqual(plain.visibleLines.map(turn));
      expect(close(turned.box)).toEqual(turn(plain.box as Rect));
      // Tall and narrow: the long line runs down the page.
      expect(turned.box?.height).toBeCloseTo(plain.box?.width as number, 6);
      expect(turned.box?.width).toBeCloseTo(plain.box?.height as number, 6);
      // The glyph outlines turn with the lines.
      expect(inkLines(turned).map(close)).toEqual(inkLines(plain).map(turn));
    }
  });

  test("a label with runs turns its run boxes too", () => {
    const runs = label("x2", 100, 50, {
      runs: [
        [
          { text: "x", font: "math-italic", fontSizeUnits: 16, shiftUnits: 0 },
          { text: "2", font: "regular", fontSizeUnits: 11.2, shiftUnits: -6 },
        ],
      ],
    });
    const plain = measureLabel(runs, fonts);
    const rotation = { degrees: -90 as const, center };
    const turned = measureLabel({ ...runs, rotation }, fonts);
    expect(turned.runs?.flat().map((r) => close(r.box))).toEqual(
      plain.runs?.flat().map((r) => close(turnRect(r.box, rotation))),
    );
    expect(close(turned.box)).toEqual(close(turnRect(plain.box as Rect, rotation)));
  });
});
