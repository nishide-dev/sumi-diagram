import { expect, test } from "bun:test";
import { displayWidth, formatCodePoint, glyphCodePoints, labelLines } from "./text";

test("labelLines splits on every line break style", () => {
  expect(labelLines("a\nb\r\nc\rd")).toEqual(["a", "b", "c", "d"]);
  expect(labelLines("")).toEqual([""]);
});

test.each([
  ["", 0],
  ["API", 3],
  ["認証サーバ", 10],
  ["ＡＢＣ", 6], // fullwidth forms
  ["ｱｲｳ", 3], // halfwidth katakana
  ["한국어", 6],
  ["é", 1], // combining acute accent: one grapheme
  ["😀", 2],
  ["👨‍👩‍👧", 2], // ZWJ sequence: one grapheme
  ["❤", 1], // text presentation by default
  ["❤️", 2], // emoji presentation selector
  ["𠀋", 2], // CJK Extension B
  ["DB サーバ", 9],
])("displayWidth(%p) = %p", (line, width) => {
  expect(displayWidth(line)).toBe(width);
});

test("glyphCodePoints skips whitespace, controls and default-ignorables, and dedupes", () => {
  const text = "a b\n\ta　‍❤️\u0007";
  expect(glyphCodePoints(text)).toEqual([0x61, 0x62, 0x2764]);
});

test("formatCodePoint pads to four hex digits", () => {
  expect(formatCodePoint(0x41)).toBe("U+0041");
  expect(formatCodePoint(0x1f600)).toBe("U+1F600");
});
