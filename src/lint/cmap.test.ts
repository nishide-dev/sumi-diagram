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

/**
 * A minimal sfnt with a single `cmap` table holding the given subtables,
 * followed by `padding` zero bytes that still belong to the table.
 */
function font(
  subtables: { platform: number; encoding: number; body: Bytes }[],
  { padding = 0, tableLength }: { padding?: number; tableLength?: number } = {},
): Uint8Array {
  const cmap = new Bytes().u16(0, subtables.length);
  let offset = 4 + subtables.length * 8;
  for (const s of subtables) {
    cmap.u16(s.platform, s.encoding).u32(offset);
    offset += s.body.data.length;
  }
  for (const s of subtables) cmap.data.push(...s.body.data);
  cmap.data.push(...new Array<number>(padding).fill(0));
  const header = new Bytes()
    .u32(0x00010000)
    .u16(1, 16, 0, 0) // numTables, searchRange, entrySelector, rangeShift
    .u32(0x636d6170, 0, 12 + 16, tableLength ?? cmap.data.length); // "cmap" record
  return new Uint8Array([...header.data, ...cmap.data]);
}

/**
 * Format 4 with three segments:
 * - 0x41–0x43 via idDelta (glyphs 1–3);
 * - 0x61–0x63 via the glyph array (0x62 maps to glyph 0: missing);
 * - the required final 0xFFFF segment.
 */
function format4({ rangeOffset = 4 } = {}): Bytes {
  const segCount = 3;
  const body = new Bytes()
    .u16(4, 0, 0, segCount * 2, 0, 0, 0) // format, length (set below), language, segCountX2, search fields
    .u16(0x43, 0x63, 0xffff) // endCode
    .u16(0) // reservedPad
    .u16(0x41, 0x61, 0xffff) // startCode
    .u16(0x10000 - 0x40, 0, 1) // idDelta: -0x40, 0, 1
    .u16(0, rangeOffset, 0) // idRangeOffset: segment 1 points 4 bytes ahead, at the glyph array
    .u16(10, 0, 11); // glyphIdArray for 0x61, 0x62, 0x63
  body.data[2] = body.data.length >> 8;
  body.data[3] = body.data.length & 0xff;
  return body;
}

/** Format 12 with the given `[start, end, startGlyph]` groups. */
function format12(
  groups: [number, number, number][] = [
    [0x1f600, 0x1f601, 5],
    // Starts at glyph 0, so its first code point is missing.
    [0x20000, 0x20002, 0],
  ],
): Bytes {
  const body = new Bytes().u16(12, 0).u32(16 + groups.length * 12, 0, groups.length);
  for (const group of groups) body.u32(...group);
  return body;
}

const parse12 = (groups: [number, number, number][]) =>
  parseGlyphCoverage(font([{ platform: 3, encoding: 10, body: format12(groups) }]));

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

  test("maps code points to glyph IDs (0 when missing)", () => {
    const four = parseGlyphCoverage(font([{ platform: 3, encoding: 1, body: format4() }]));
    expect([0x41, 0x42, 0x43, 0x61, 0x62, 0x63, 0x44].map((cp) => four.glyph(cp))).toEqual([
      1, 2, 3, 10, 0, 11, 0,
    ]);
    const twelve = parseGlyphCoverage(font([{ platform: 3, encoding: 10, body: format12() }]));
    expect(
      [0x1f600, 0x1f601, 0x20000, 0x20001, 0x20002, 0x1f602].map((cp) => twelve.glyph(cp)),
    ).toEqual([5, 6, 0, 1, 2, 0]);
  });

  test("adjacent ranges with discontinuous glyph IDs keep their own glyphs", () => {
    const coverage = parse12([
      [0x100, 0x1ff, 1],
      [0x200, 0x2ff, 500],
    ]);
    expect(coverage.size).toBe(0x200);
    expect([0x1ff, 0x200, 0x2ff].map((cp) => coverage.glyph(cp))).toEqual([0x100, 500, 755]);
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
      [new Uint8Array(2), /outside the font/],
      [valid.slice(0, valid.length - 4), /outside the font/],
      [new Uint8Array([0x74, 0x74, 0x63, 0x66, 0, 1, 0, 0]), /collections/],
      [new Uint8Array([0x77, 0x4f, 0x46, 0x46, 0, 0, 0, 0]), /not a TrueType/],
      [font([{ platform: 1, encoding: 0, body: format4() }]), /no Unicode cmap subtable/],
      // The table directory claims more bytes than the file has.
      [
        font([{ platform: 3, encoding: 1, body: format4() }], { tableLength: 1000 }),
        /outside the font/,
      ],
      // idRangeOffset points into the cmap table, but past the end of the subtable.
      [
        font([{ platform: 3, encoding: 1, body: format4({ rangeOffset: 40 }) }], { padding: 64 }),
        /outside the cmap format 4 subtable/,
      ],
      [new Uint8Array(new Bytes().u32(0x00010000).u16(0, 0, 0, 0).data), /no cmap table/],
    ];
    for (const [bytes, message] of cases) {
      expect(() => parseGlyphCoverage(bytes)).toThrow(FontParseError);
      expect(() => parseGlyphCoverage(bytes)).toThrow(message);
    }
  });
});

describe("format 12 groups", () => {
  test.each<[string, [number, number, number][]]>([
    [
      "unsorted",
      [
        [0x200, 0x2ff, 1],
        [0x100, 0x1ff, 1],
      ],
    ],
    [
      "overlapping",
      [
        [0x100, 0x1ff, 1],
        [0x1ff, 0x2ff, 1],
      ],
    ],
    ["reversed", [[0x200, 0x100, 1]]],
    ["beyond U+10FFFF", [[0x10ff00, 0x110000, 1]]],
  ])("rejects %s groups", (_, groups) => {
    expect(() => parse12(groups)).toThrow(/not sorted, disjoint and in range/);
  });

  test("rejects a group count larger than the subtable", () => {
    const body = format12();
    body.data.splice(12, 4, 0, 0, 0x10, 0); // numGroups = 4096
    const bytes = font([{ platform: 3, encoding: 10, body }]);
    expect(() => parseGlyphCoverage(bytes)).toThrow(/exceed the subtable/);
  });

  test("covering all of Unicode stays cheap (ranges, not a set of code points)", () => {
    const groups: [number, number, number][] = [];
    const step = 0x1100;
    for (let start = 0; start <= 0x10ffff; start += step) {
      groups.push([start, Math.min(start + step - 1, 0x10ffff), 1]);
    }
    const began = performance.now();
    const coverage = parse12(groups);
    expect(performance.now() - began).toBeLessThan(100);
    expect(coverage.size).toBe(0x110000);
    for (const cp of [0, 0x41, 0x1100, 0x10ffff]) expect(coverage.has(cp)).toBe(true);
    expect(coverage.has(0x110000)).toBe(false);
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
