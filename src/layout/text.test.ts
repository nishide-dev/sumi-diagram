import { describe, expect, test } from "bun:test";
import { getFontSet, LATIN_FONT_SET_ID } from "../core/theme/fonts";
import { loadFontMetrics } from "../lint/metrics";
import { fontClassOf, fontSetMeasurer, measureText, placeAccent, type TextMeasurer } from "./text";

const fonts = getFontSet("sumi/biz-ud-gothic");
if (fonts === undefined) throw new Error("bundled font set missing");
const measurer = fontSetMeasurer(fonts);
const style = (extra: object = {}) => ({
  bold: false,
  italic: false,
  mono: false,
  fontSize: { pt: 8, units: 16 },
  ...extra,
});

describe("fontClassOf", () => {
  test.each([
    [{}, "regular"],
    [{ bold: true }, "bold"],
    [{ italic: true }, "italic"],
    [{ bold: true, italic: true }, "bold"],
    [{ mono: true }, "mono"],
    [{ mono: true, bold: true }, "mono-bold"],
    [{ mono: true, italic: true }, "mono-italic"],
  ])("%o → %s", (extra, expected) => {
    expect(fontClassOf(style(extra))).toBe(expected);
  });
});

describe("measureText", () => {
  test("measures with the bundled TTF advance widths and hhea metrics", () => {
    const regular = loadFontMetrics(fonts.regular);
    const label = measureText("Add & Norm\nx", style(), measurer);
    expect(label?.lines).toEqual(["Add & Norm", "x"]);
    expect(label?.width).toBe(regular.measureEm("Add & Norm") * 16);
    expect(label?.height).toBe(40);
    expect(label?.lineHeightUnits).toBe(20);
    expect(label?.ascentUnits).toBe((regular.hhea.ascender / regular.unitsPerEm) * 16);
    expect(label?.descentUnits).toBe((-regular.hhea.descender / regular.unitsPerEm) * 16);
    const bold = measureText("Add & Norm", style({ bold: true }), measurer);
    expect(bold?.font).toBe("bold");
    expect(bold?.width).toBe(loadFontMetrics(fonts.bold).measureEm("Add & Norm") * 16);
  });

  test("collapses whitespace like the SVG text it becomes; no label → undefined", () => {
    expect(measureText("  a \t b  ", style(), measurer)?.lines).toEqual(["a b"]);
    expect(measureText("", style(), measurer)).toBeUndefined();
  });
});

describe("placeAccent (#129)", () => {
  const run = { text: "W", font: "math-italic", fontSizeUnits: 20, shiftUnits: 0, width: 10 };

  test("without outlines, the mark is centered on its base's advance", () => {
    const fake: TextMeasurer = {
      lineWidth: () => 0,
      verticalMetrics: (_font, size) => ({ ascent: 0.8 * size, descent: 0.2 * size }),
    };
    expect(placeAccent(run, "̂", fake).accent).toEqual({
      char: "̂",
      dxUnits: 5,
      shiftUnits: 0,
      width: 0,
    });
  });

  test("the mark's outline sits ACCENT_GAP above the base's, moved by the slant", () => {
    const fake: TextMeasurer = {
      lineWidth: () => 0,
      verticalMetrics: (_font, size) => ({ ascent: 0.8 * size, descent: 0.2 * size }),
      glyphBox: (_font, char) =>
        char === "W"
          ? { xMin: 1, yMin: 0, xMax: 9, yMax: 14 }
          : { xMin: -6, yMin: 11, xMax: -2, yMax: 15 },
      slant: () => 0.5,
    };
    const placed = placeAccent(run, "̂", fake);
    // Center 5 + 0.5 × 14 / 2 = 8.5; the mark's center is at −4.
    expect(placed.accent.dxUnits).toBe(12.5);
    // Its bottom (11 above its baseline) at 14 + 0.8: the baseline 3.8 up.
    expect(placed.accent.shiftUnits).toBeCloseTo(-3.8, 9);
    expect(placed.top).toBeCloseTo(18.8, 9);
    expect(placed.bottom).toBeCloseTo(14.8, 9);
  });

  test("a mark reaching above the ascender grows the label's ascent", () => {
    const fake: TextMeasurer = {
      lineWidth: (text, _font, size) => ([...text].length * size) / 2,
      verticalMetrics: (_font, size) => ({ ascent: 0.8 * size, descent: 0.2 * size }),
      glyphBox: (_font, char, size) =>
        char === "W"
          ? { xMin: 0, yMin: 0, xMax: size / 2, yMax: 0.75 * size }
          : { xMin: -size / 4, yMin: 0.5 * size, xMax: 0, yMax: 0.7 * size },
    };
    const label = measureText("$\\hat W$", style(), fake);
    // The mark's top: 0.75 + 0.04 − 0.5 + 0.7 = 0.99 em.
    expect(label?.ascentUnits).toBeCloseTo(0.99 * 16, 9);
    expect(label?.runs?.[0]?.[0]?.accent?.char).toBe("̂");
    expect(label?.lines).toEqual(["Ŵ"]);
    expect(label?.width).toBe(8);
  });
});

describe("fontSetMeasurer with Latin slots (#172)", () => {
  const latinFonts = getFontSet(LATIN_FONT_SET_ID);
  if (latinFonts === undefined) throw new Error("bundled Latin font set missing");
  const latin = fontSetMeasurer(latinFonts);

  test("only a font set with Latin slots moves text to them", () => {
    expect(measurer.latin).toBeUndefined();
    expect(latin.latin?.("regular")).toBe("latin");
    expect(latin.latin?.("bold")).toBe("latin-bold");
    expect(latin.latin?.("mono")).toBeUndefined();
    expect(measureText("Encoder", style(), measurer)?.font).toBe("regular");
  });

  test("Latin text is measured in Inter with Inter's vertical metrics", () => {
    const inter = loadFontMetrics(latinFonts.latin ?? "");
    const metrics = measureText("Encoder", style(), latin);
    expect(metrics?.font).toBe("latin");
    expect(metrics?.runs).toBeUndefined();
    expect(metrics?.width).toBeCloseTo(inter.measureEm("Encoder") * 16, 9);
    expect(metrics?.ascentUnits).toBeCloseTo((inter.hhea.ascender / inter.unitsPerEm) * 16, 9);
    expect(metrics?.lineHeightUnits).toBe(20);
    const mixed = measureText("入力 Encoder", style({ bold: true }), latin);
    expect(mixed?.font).toBe("bold");
    expect(mixed?.runs?.[0]?.map((r) => r.font)).toEqual(["bold", "latin-bold"]);
  });
});
