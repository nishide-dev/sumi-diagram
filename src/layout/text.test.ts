import { describe, expect, test } from "bun:test";
import { getFontSet } from "../core/theme/fonts";
import { loadFontMetrics } from "../lint/metrics";
import { fontClassOf, fontSetMeasurer, measureText } from "./text";

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
