import { describe, expect, test } from "bun:test";
import { getFontSet } from "../core/theme/fonts";
import { FontParseError } from "./cmap";
import { loadFontMetrics, parseFontMetrics } from "./metrics";

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
  zeros(count: number): this {
    this.data.push(...new Array<number>(count).fill(0));
    return this;
  }
}

/** An sfnt with the given tables (tag → body). */
function sfnt(tables: Record<string, Bytes>): Uint8Array {
  const entries = Object.entries(tables);
  const header = new Bytes().u32(0x00010000).u16(entries.length, 0, 0, 0);
  let offset = 12 + entries.length * 16;
  for (const [tag, body] of entries) {
    header.data.push(...[...tag].map((c) => c.charCodeAt(0)));
    header.u32(0, offset, body.data.length);
    offset += body.data.length;
  }
  return new Uint8Array([...header.data, ...entries.flatMap(([, body]) => body.data)]);
}

interface SyntheticOptions {
  unitsPerEm?: number;
  magic?: number;
  numGlyphs?: number;
  advances?: number[];
  /** Bytes to drop from the end of hmtx. */
  truncateHmtx?: number;
  os2?: boolean;
}

/**
 * A font with glyphs 0..numGlyphs-1, `advances` as the long metrics, and a
 * format 4 cmap mapping "A".."C" to glyphs 1..3.
 */
function syntheticFont({
  unitsPerEm = 1000,
  magic = 0x5f0f3cf5,
  numGlyphs = 4,
  advances = [500, 600, 700],
  truncateHmtx = 0,
  os2 = true,
}: SyntheticOptions = {}): Uint8Array {
  const head = new Bytes().u32(0x00010000, 0, 0, magic).u16(0, unitsPerEm).zeros(34);
  const maxp = new Bytes().u32(0x00005000).u16(numGlyphs);
  const hhea = new Bytes()
    .u32(0x00010000)
    .u16(800, 0x10000 - 200, 50) // ascender, descender (-200), lineGap
    .zeros(24)
    .u16(advances.length);
  const hmtx = new Bytes();
  for (const advance of advances) hmtx.u16(advance, 0);
  for (let g = advances.length; g < numGlyphs; g++) hmtx.u16(0);
  hmtx.data.splice(hmtx.data.length - truncateHmtx, truncateHmtx);
  const cmap4 = new Bytes()
    .u16(4, 32, 0, 4, 0, 0, 0) // format, length, language, segCountX2 = 4, search fields
    .u16(0x43, 0xffff) // endCode
    .u16(0) // reservedPad
    .u16(0x41, 0xffff) // startCode
    .u16(0x10000 - 0x40, 1) // idDelta: A → 1
    .u16(0, 0); // idRangeOffset
  const cmap = new Bytes().u16(0, 1).u16(3, 1).u32(12);
  cmap.data.push(...cmap4.data);
  const tables: Record<string, Bytes> = { cmap, head, hhea, hmtx, maxp };
  if (os2)
    tables["OS/2"] = new Bytes()
      .zeros(68)
      .u16(880, 0x10000 - 120, 0)
      .zeros(20);
  return sfnt(tables);
}

describe("parseFontMetrics", () => {
  test("reads units per em, vertical metrics and advances", () => {
    const metrics = parseFontMetrics(syntheticFont());
    expect(metrics.unitsPerEm).toBe(1000);
    expect(metrics.numGlyphs).toBe(4);
    expect(metrics.hhea).toEqual({ ascender: 800, descender: -200, lineGap: 50 });
    expect(metrics.typo).toEqual({ ascender: 880, descender: -120, lineGap: 0 });
    expect([0, 1, 2].map((g) => metrics.advance(g))).toEqual([500, 600, 700]);
  });

  test("glyphs past numberOfHMetrics repeat the last advance", () => {
    const metrics = parseFontMetrics(syntheticFont());
    expect(metrics.advance(3)).toBe(700);
    expect(metrics.advanceOf(0x43)).toBe(700); // "C" → glyph 3
  });

  test("unmapped code points and glyph IDs outside the font measure as .notdef", () => {
    const metrics = parseFontMetrics(syntheticFont());
    expect(metrics.advanceOf(0x5a)).toBe(500); // "Z" is not mapped
    expect(metrics.advance(99)).toBe(500);
    expect(metrics.advance(-1)).toBe(500);
  });

  test("measureEm sums advances and skips unmapped invisible characters", () => {
    const metrics = parseFontMetrics(syntheticFont());
    expect(metrics.measureEm("ABC")).toBeCloseTo((600 + 700 + 700) / 1000, 12);
    // Zero-width joiner, variation selector and a control character draw nothing.
    expect(metrics.measureEm("A‍️B\u0007")).toBeCloseTo(1.3, 12);
    expect(metrics.measureEm("")).toBe(0);
  });

  test("the OS/2 table is optional", () => {
    expect(parseFontMetrics(syntheticFont({ os2: false })).typo).toBeUndefined();
  });

  test.each<[string, SyntheticOptions, RegExp]>([
    ["a bad head magic number", { magic: 0x12345678 }, /bad magic/],
    ["unitsPerEm out of range", { unitsPerEm: 8 }, /unitsPerEm 8/],
    ["more long metrics than glyphs", { numGlyphs: 2 }, /numberOfHMetrics 3 is not within 1–2/],
    ["no long metrics", { advances: [] }, /numberOfHMetrics 0/],
    [
      "a truncated hmtx",
      { truncateHmtx: 2 },
      /hmtx table has 12 bytes, but hhea and maxp require 14/,
    ],
    ["no glyphs", { numGlyphs: 0, advances: [] }, /no glyphs/],
  ])("rejects %s", (_, options, message) => {
    const bytes = syntheticFont(options);
    expect(() => parseFontMetrics(bytes)).toThrow(FontParseError);
    expect(() => parseFontMetrics(bytes)).toThrow(message);
  });

  test("rejects fonts without a required table, and reads outside a table", () => {
    const full = syntheticFont();
    expect(() => parseFontMetrics(full.slice(0, 40))).toThrow(/outside the font/);
    // unitsPerEm (offset 18) lies past the end of a truncated head table.
    const shortHead = sfnt({ head: new Bytes().u32(0x00010000, 0, 0, 0x5f0f3cf5).u16(0) });
    expect(() => parseFontMetrics(shortHead)).toThrow(/outside the head table/);
    const headOnly = sfnt({
      head: new Bytes().u32(0x00010000, 0, 0, 0x5f0f3cf5).u16(0, 1000).zeros(34),
    });
    expect(() => parseFontMetrics(headOnly)).toThrow(/no maxp table/);
  });
});

describe("bundled BIZ UD Gothic", () => {
  const set = getFontSet("sumi/biz-ud-gothic");
  if (set?.mono === undefined) throw new Error("bundled font set is missing");
  const fonts = { regular: set.regular, bold: set.bold, mono: set.mono };

  test("vertical metrics", () => {
    for (const file of [fonts.regular, fonts.bold, fonts.mono]) {
      const metrics = loadFontMetrics(file);
      expect(metrics.unitsPerEm).toBe(2048);
      expect(metrics.numGlyphs).toBe(13932);
      // Ascender + descender = 1em, so a line box is exactly one font size tall.
      expect(metrics.hhea).toEqual({ ascender: 1802, descender: -246, lineGap: 0 });
    }
  });

  // Cross-checked with fontTools (hmtx via getBestCmap) and FreeType
  // (Pillow `ImageFont.getlength` at 2048px, basic layout).
  test("advance widths of single characters", () => {
    const cases: ["regular" | "bold" | "mono", string, number][] = [
      ["regular", "A", 1556],
      ["regular", "i", 655],
      ["regular", " ", 683],
      ["regular", "あ", 2007],
      ["regular", "漢", 2048],
      ["regular", "Ａ", 1556],
      ["bold", "A", 1597],
      ["bold", "W", 2048],
      ["mono", "A", 1024],
      ["mono", "あ", 2048],
    ];
    for (const [slot, char, advance] of cases) {
      const metrics = loadFontMetrics(fonts[slot] as string);
      expect([slot, char, metrics.advanceOf(char.codePointAt(0) ?? 0)]).toEqual([
        slot,
        char,
        advance,
      ]);
    }
  });

  test.each<[string, number, number, number]>([
    ["Hello World", 12972, 13442, 11264],
    ["認証サーバ", 10056, 10097, 10240],
    ["WAVE To", 10023, 10186, 7168],
    ["API サーバ", 10575, 10738, 10240],
    ["Database (primary)", 21900, 22465, 18432],
  ])(
    "%s measures like FreeType (regular %d, bold %d, mono %d units)",
    (text, regular, bold, mono) => {
      const width = (file: string) => loadFontMetrics(file).measureEm(text) * 2048;
      expect(width(fonts.regular)).toBeCloseTo(regular, 6);
      expect(width(fonts.bold)).toBeCloseTo(bold, 6);
      expect(width(fonts.mono)).toBeCloseTo(mono, 6);
    },
  );

  // Sum of the advances of all 11741 mapped code points, per fontTools.
  test.each([
    ["regular", 23487293],
    ["bold", 23507145],
    ["mono", 23448576],
  ] as const)("every mapped code point of %s matches fontTools (checksum)", (slot, sum) => {
    const metrics = loadFontMetrics(fonts[slot] as string);
    let total = 0;
    let count = 0;
    for (let cp = 0; cp <= 0x10ffff; cp++) {
      if (!metrics.coverage.has(cp)) continue;
      total += metrics.advanceOf(cp);
      count++;
    }
    expect({ count, total }).toEqual({ count: 11741, total: sum });
  });

  test("caches per file", () => {
    expect(loadFontMetrics(fonts.regular)).toBe(loadFontMetrics(fonts.regular));
  });

  test("unreadable files throw FontParseError", () => {
    expect(() => loadFontMetrics(`${fonts.regular}.missing`)).toThrow(FontParseError);
  });
});
