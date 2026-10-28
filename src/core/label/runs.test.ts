import { describe, expect, test } from "bun:test";
import { LATIN_BOLD_FONT, LATIN_FONT, labelRuns, MATH_FONT } from "./runs";

/** ASCII is in the Latin font, `∼` only in the math font, everything else in the label's fonts. */
const covers = (font: string, cp: number) => {
  if (font === LATIN_FONT || font === LATIN_BOLD_FONT) return cp < 0x80;
  if (font === MATH_FONT) return cp === 0x223c || cp < 0x80;
  return cp !== 0x223c;
};
const latin = (font: string) =>
  font === "regular" ? LATIN_FONT : font === "bold" ? LATIN_BOLD_FONT : undefined;

describe("labelRuns with a Latin font (#172)", () => {
  test("a label wholly in the Latin font is plain text in it", () => {
    expect(labelRuns("Multi-Head  Attention", { font: "regular", covers, latin })).toEqual({
      lines: ["Multi-Head Attention"],
      font: LATIN_FONT,
    });
    expect(labelRuns("Add\n& Norm", { font: "bold", covers, latin })).toEqual({
      lines: ["Add", "& Norm"],
      font: LATIN_BOLD_FONT,
    });
  });

  test("Japanese text keeps the label's font, Latin text around it moves to the Latin font", () => {
    expect(labelRuns("入力 Embedding", { font: "regular", covers, latin })).toEqual({
      lines: ["入力 Embedding"],
      runs: [
        [
          { text: "入力", font: "regular", script: "base" },
          { text: " Embedding", font: LATIN_FONT, script: "base" },
        ],
      ],
    });
  });

  test("a label without Latin text, or a font without a Latin class, is unchanged", () => {
    expect(labelRuns("入力データ", { font: "regular", covers, latin })).toEqual({
      lines: ["入力データ"],
    });
    expect(labelRuns("Code", { font: "mono", covers, latin })).toEqual({ lines: ["Code"] });
    expect(labelRuns("Encoder", { font: "regular", covers })).toEqual({ lines: ["Encoder"] });
    expect(labelRuns("", { font: "regular", covers, latin })).toEqual({ lines: [""] });
  });

  test("label math keeps the math fonts; the math fallback still applies to the rest", () => {
    const drawn = labelRuns("x $\\alpha$ 〜∼", { font: "regular", covers, latin });
    expect(drawn.font).toBeUndefined();
    expect(drawn.runs?.[0]?.map((r) => [r.text, r.font])).toEqual([
      ["x ", LATIN_FONT],
      ["α", "math-italic"],
      [" ", LATIN_FONT],
      ["〜", "regular"],
      ["∼", MATH_FONT],
    ]);
  });

  test("a base and its combining marks stay in one font (grapheme clusters)", () => {
    // U+0301 is not in the (ASCII-only) Latin font: `e` stays with its mark.
    expect(labelRuns("Cafe\u0301 au", { font: "regular", covers, latin }).runs).toEqual([
      [
        { text: "Caf", font: LATIN_FONT, script: "base" },
        { text: "e\u0301", font: "regular", script: "base" },
        { text: " au", font: LATIN_FONT, script: "base" },
      ],
    ]);
    // A cluster only the math font has wholly goes there; one no font has
    // wholly stays in the label's font (lint/missing-glyph reports it).
    const onlyMath = (font: string, cp: number) =>
      font === MATH_FONT ? cp === 0x78 || cp === 0x20d7 : cp !== 0x20d7;
    expect(labelRuns("x\u20d7", { font: "regular", covers: onlyMath }).runs).toEqual([
      [{ text: "x\u20d7", font: MATH_FONT, script: "base" }],
    ]);
    expect(labelRuns("y\u20d7", { font: "regular", covers: onlyMath })).toEqual({
      lines: ["y\u20d7"],
    });
  });
});
