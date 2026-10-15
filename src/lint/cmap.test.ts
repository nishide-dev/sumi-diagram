import { describe, expect, test } from "bun:test";
import { getFontSet } from "../core/theme/fonts";
import { FontParseError, loadGlyphCoverage, parseGlyphCoverage } from "./cmap";

/** Big-endian byte builder for synthetic fonts. */
class Bytes {
  readonly data: number[] = [];
  u16(...values: number[]): this {
    for (const v of values) this.data.push((v >> 8) & 0xff, v & 0xff);
    return this;
  }
  u32(...values: number[]): this {
    for (const v of values) this.u16(Math.floor(v / 0x10000) & 0xffff, v & 0xffff);
    return this;
  }
}

/** A minimal sfnt with a single `cmap` table holding the given subtables. */
function font(subtables: { platform: number; encoding: number; body: Bytes }[]): Uint8Array {
  const cmap = new Bytes().u16(0, subtables.length);
  let offset = 4 + subtables.length * 8;
  for (const s of subtables) {
    cmap.u16(s.platform, s.encoding).u32(offset);
    offset += s.body.data.length;
  }
  for (const s of subtables) cmap.data.push(...s.body.data);
  const header = new Bytes()
    .u32(0x00010000)
    .u16(1, 16, 0, 0) // numTables, searchRange, entrySelector, rangeShift
    .u32(0x636d6170, 0, 12 + 16, cmap.data.length); // "cmap" record
  return new Uint8Array([...header.data, ...cmap.data]);
}

/**
 * Format 4 with three segments:
 * - 0x41–0x43 via idDelta (glyphs 1–3);
 * - 0x61–0x63 via the glyph array (0x62 maps to glyph 0: missing);
 * - the required final 0xFFFF segment.
 */
function format4(): Bytes {
  const segCount = 3;
  return new Bytes()
    .u16(4, 0, 0, segCount * 2, 0, 0, 0) // format, length, language, segCountX2, search fields
    .u16(0x43, 0x63, 0xffff) // endCode
    .u16(0) // reservedPad
    .u16(0x41, 0x61, 0xffff) // startCode
    .u16(0x10000 - 0x40, 0, 1) // idDelta: -0x40, 0, 1
    .u16(0, 4, 0) // idRangeOffset: segment 1 points 4 bytes ahead, at the glyph array
    .u16(10, 0, 11); // glyphIdArray for 0x61, 0x62, 0x63
}

/** Format 12 with two groups; the second starts at glyph 0, so its first code point is missing. */
function format12(): Bytes {
  return new Bytes()
    .u16(12, 0)
    .u32(16 + 2 * 12, 0, 2) // length, language, numGroups
    .u32(0x1f600, 0x1f601, 5)
    .u32(0x20000, 0x20002, 0);
}

describe("parseGlyphCoverage", () => {
  test("reads format 4 (delta and glyph array segments)", () => {
    const coverage = parseGlyphCoverage(font([{ platform: 3, encoding: 1, body: format4() }]));
    const covered = [0x41, 0x42, 0x43, 0x61, 0x63];
    for (const cp of covered) expect(coverage.has(cp)).toBe(true);
    for (const cp of [0x40, 0x44, 0x62, 0xffff]) expect(coverage.has(cp)).toBe(false);
    expect(coverage.size).toBe(covered.length);
  });

  test("reads format 12 and treats glyph 0 as missing", () => {
    const coverage = parseGlyphCoverage(font([{ platform: 3, encoding: 10, body: format12() }]));
    for (const cp of [0x1f600, 0x1f601, 0x20001, 0x20002]) expect(coverage.has(cp)).toBe(true);
    for (const cp of [0x1f602, 0x20000]) expect(coverage.has(cp)).toBe(false);
  });

  test("prefers format 12 over format 4", () => {
    const coverage = parseGlyphCoverage(
      font([
        { platform: 3, encoding: 1, body: format4() },
        { platform: 3, encoding: 10, body: format12() },
      ]),
    );
    expect(coverage.has(0x1f600)).toBe(true);
    expect(coverage.has(0x41)).toBe(false);
  });

  test("rejects malformed and unsupported data", () => {
    const valid = font([{ platform: 3, encoding: 1, body: format4() }]);
    const cases: [Uint8Array, RegExp][] = [
      [new Uint8Array(2), /out of bounds/],
      [valid.slice(0, valid.length - 4), /out of bounds/],
      [new Uint8Array([0x74, 0x74, 0x63, 0x66, 0, 1, 0, 0]), /collections/],
      [new Uint8Array([0x77, 0x4f, 0x46, 0x46, 0, 0, 0, 0]), /not a TrueType/],
      [font([{ platform: 1, encoding: 0, body: format4() }]), /no Unicode cmap subtable/],
      [new Uint8Array(new Bytes().u32(0x00010000).u16(0, 0, 0, 0).data), /no cmap table/],
    ];
    for (const [bytes, message] of cases) {
      expect(() => parseGlyphCoverage(bytes)).toThrow(FontParseError);
      expect(() => parseGlyphCoverage(bytes)).toThrow(message);
    }
  });
});

describe("bundled BIZ UD Gothic", () => {
  const fonts = getFontSet("sumi/biz-ud-gothic");
  if (fonts?.mono === undefined) throw new Error("bundled font set is missing");
  const files = [fonts.regular, fonts.bold, fonts.mono];

  // Cross-checked with fontconfig (`fc-query --format=%{charset}`): the
  // coverage of all three files is identical, 11741 code points.
  test("coverage matches fontconfig", () => {
    for (const file of files) expect(loadGlyphCoverage(file).size).toBe(11741);
  });

  test.each([
    ["A", true],
    ["あ", true],
    ["漢", true],
    ["Ａ", true],
    ["①", true],
    ["𠀋", true], // U+2000B, CJK Extension B (JIS X 0213)
    ["😀", false], // U+1F600, emoji
    ["✅", false], // U+2705
    ["𠮷", false], // U+20BB7, CJK Extension B
    ["龘", false], // U+9F98
    ["ก", false], // U+0E01, Thai
  ])("%s covered: %p", (char, covered) => {
    const cp = char.codePointAt(0) ?? 0;
    for (const file of files) expect(loadGlyphCoverage(file).has(cp)).toBe(covered);
  });

  test("caches per file", () => {
    expect(loadGlyphCoverage(fonts.regular)).toBe(loadGlyphCoverage(fonts.regular));
  });

  test("unreadable files throw FontParseError", () => {
    expect(() => loadGlyphCoverage(`${fonts.regular}.missing`)).toThrow(FontParseError);
  });
});
