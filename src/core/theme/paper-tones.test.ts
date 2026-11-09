/**
 * The harmonized tones of the `paper` theme (#434, proposal B of #423): the
 * exact values, and the validations they must keep (text contrast, grayscale
 * and color-vision separation).
 */

import { describe, expect, test } from "bun:test";
import { getTheme } from "./builtin";
import { type ColorVision, deltaE, deltaEUnder, lightness, toOklch } from "./color-math";
import { contrastRatio } from "./node-variants";
import { TONE_NAMES } from "./tones";

const PAPER = getTheme("paper");
if (PAPER === undefined) throw new Error("missing paper");

/** Fill and line (text, solid fill, edge) of each tone. */
const EXPECTED = {
  gray: ["#dee1e8", "#656970"],
  red: ["#f9c7bb", "#703226"],
  orange: ["#fcdbb7", "#71480a"],
  yellow: ["#d7d8aa", "#73722e"],
  green: ["#c6edcd", "#417a50"],
  blue: ["#d1e7ff", "#31608e"],
  purple: ["#d8cdf8", "#524177"],
  pink: ["#ffdcf1", "#7c4569"],
} as const;

const fillOf = (tone: (typeof TONE_NAMES)[number]) => PAPER?.tones.get(tone)?.fill ?? "";
const lineOf = (tone: (typeof TONE_NAMES)[number]) => PAPER?.toneLines.get(tone)?.stroke ?? "";
const pairs = TONE_NAMES.flatMap((a, i) => TONE_NAMES.slice(i + 1).map((b) => [a, b] as const));
const views: ColorVision[] = ["protanopia", "deuteranopia", "tritanopia"];

describe("paper tones (#434)", () => {
  test("fill and line of every tone are the harmonized set", () => {
    for (const tone of TONE_NAMES) {
      expect([fillOf(tone), lineOf(tone)], tone).toEqual([...EXPECTED[tone]]);
      // Text on an outlined node and on an edge takes the same color as the line.
      expect(PAPER?.toneLines.get(tone)?.fontColor, tone).toBe(lineOf(tone));
    }
  });

  test("lines are less saturated than the former set and fills share a lightness band", () => {
    for (const tone of TONE_NAMES) {
      expect(toOklch(lineOf(tone)).c, `${tone} line chroma`).toBeLessThan(0.115);
      expect(toOklch(fillOf(tone)).l, `${tone} fill lightness`).toBeGreaterThan(0.85);
    }
  });

  test("text keeps 4.5:1: black on every fill, every line on white and white on the solid fill", () => {
    for (const tone of TONE_NAMES) {
      expect(contrastRatio("#000000", fillOf(tone)), `${tone} ink on fill`).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(
        contrastRatio(lineOf(tone), "#ffffff"),
        `${tone} line on white`,
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(lineOf(tone), "#f3f3f5"),
        `${tone} line on panel`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("tones stay apart: pairwise CIE76 of fills at least 10 (7.3 before #434) and of lines at least 20", () => {
    for (const [a, b] of pairs) {
      expect(deltaE(fillOf(a), fillOf(b)), `${a}-${b} fill`).toBeGreaterThanOrEqual(10);
      expect(deltaE(lineOf(a), lineOf(b)), `${a}-${b} line`).toBeGreaterThanOrEqual(20);
    }
  });

  test("grayscale: a line is at least 20 L* darker than its fill and every line is dark", () => {
    for (const tone of TONE_NAMES) {
      expect(lightness(fillOf(tone)) - lightness(lineOf(tone)), tone).toBeGreaterThanOrEqual(20);
      expect(lightness(lineOf(tone)), `${tone} line L*`).toBeLessThan(55);
    }
  });

  test("color vision: a line is apart from its fill, and no two tones collapse", () => {
    for (const view of views) {
      for (const tone of TONE_NAMES) {
        expect(
          deltaEUnder(view, fillOf(tone), lineOf(tone)),
          `${tone} fill-line (${view})`,
        ).toBeGreaterThanOrEqual(20);
      }
      for (const [a, b] of pairs) {
        expect(
          deltaEUnder(view, lineOf(a), lineOf(b)),
          `${a}-${b} line (${view})`,
        ).toBeGreaterThanOrEqual(2.5);
        expect(
          deltaEUnder(view, fillOf(a), fillOf(b)),
          `${a}-${b} fill (${view})`,
        ).toBeGreaterThanOrEqual(2.5);
      }
    }
  });
});
