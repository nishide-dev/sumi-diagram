/**
 * Minimal reader for the `cmap` table of TrueType / OpenType fonts: which
 * Unicode code points a font maps to a glyph. Used by `lint/missing-glyph`.
 *
 * Supports the Unicode subtables of formats 4 (BMP) and 12 (full range),
 * preferring format 12. Every read is bounds-checked; malformed data throws a
 * {@link FontParseError} instead of producing a partial answer.
 */

import { readFileSync } from "node:fs";

export class FontParseError extends Error {
  override name = "FontParseError";
}

/** The code points a font has glyphs for. */
export interface GlyphCoverage {
  has(codePoint: number): boolean;
  /** Number of mapped code points. */
  readonly size: number;
}

/** sfnt versions of single fonts: TrueType outlines (two spellings) and CFF (`OTTO`). */
const SFNT_VERSIONS = new Set([0x00010000, 0x74727565, 0x4f54544f]);
const TTC_TAG = 0x74746366; // "ttcf"

/** Bounds-checked big-endian reader. */
class Reader {
  readonly #view: DataView;
  constructor(bytes: Uint8Array) {
    this.#view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  get length(): number {
    return this.#view.byteLength;
  }
  #check(offset: number, size: number): void {
    if (!Number.isInteger(offset) || offset < 0 || offset + size > this.#view.byteLength) {
      throw new FontParseError(`read of ${size} bytes at offset ${offset} is out of bounds`);
    }
  }
  u16(offset: number): number {
    this.#check(offset, 2);
    return this.#view.getUint16(offset);
  }
  i16(offset: number): number {
    this.#check(offset, 2);
    return this.#view.getInt16(offset);
  }
  u32(offset: number): number {
    this.#check(offset, 4);
    return this.#view.getUint32(offset);
  }
}

/** Unicode subtables we can read, best first: (platform, encoding, format). */
const PREFERENCE: readonly [platform: number, encoding: number, format: number][] = [
  [3, 10, 12], // Windows, UCS-4
  [0, 4, 12], // Unicode, full repertoire
  [0, 6, 12],
  [3, 1, 4], // Windows, BMP
  [0, 3, 4], // Unicode, BMP
  [0, 4, 4],
  [0, 6, 4],
  [0, 1, 4],
  [0, 0, 4],
];

/** Parses the Unicode coverage of a font file's bytes. */
export function parseGlyphCoverage(bytes: Uint8Array): GlyphCoverage {
  const r = new Reader(bytes);
  const sfntVersion = r.u32(0);
  if (sfntVersion === TTC_TAG) {
    throw new FontParseError("font collections (.ttc) are not supported");
  }
  if (!SFNT_VERSIONS.has(sfntVersion)) {
    throw new FontParseError("not a TrueType or OpenType font");
  }
  const numTables = r.u16(4);
  let cmap: number | undefined;
  for (let i = 0; i < numTables; i++) {
    const record = 12 + i * 16;
    if (r.u32(record) === 0x636d6170 /* "cmap" */) cmap = r.u32(record + 8);
  }
  if (cmap === undefined) throw new FontParseError("the font has no cmap table");

  const numSubtables = r.u16(cmap + 2);
  const subtables: { platform: number; encoding: number; format: number; offset: number }[] = [];
  for (let i = 0; i < numSubtables; i++) {
    const record = cmap + 4 + i * 8;
    const offset = cmap + r.u32(record + 4);
    subtables.push({
      platform: r.u16(record),
      encoding: r.u16(record + 2),
      format: r.u16(offset),
      offset,
    });
  }
  for (const [platform, encoding, format] of PREFERENCE) {
    const subtable = subtables.find(
      (s) => s.platform === platform && s.encoding === encoding && s.format === format,
    );
    if (subtable === undefined) continue;
    const codePoints =
      format === 12 ? readFormat12(r, subtable.offset) : readFormat4(r, subtable.offset);
    return { has: (cp) => codePoints.has(cp), size: codePoints.size };
  }
  throw new FontParseError("the font has no Unicode cmap subtable of format 4 or 12");
}

/** Format 4: segment mapping to delta values (BMP only). */
function readFormat4(r: Reader, offset: number): Set<number> {
  const codePoints = new Set<number>();
  const segCount = r.u16(offset + 6) / 2;
  if (!Number.isInteger(segCount)) throw new FontParseError("odd segCountX2 in cmap format 4");
  const endCodes = offset + 14;
  const startCodes = endCodes + segCount * 2 + 2; // skip reservedPad
  const idDeltas = startCodes + segCount * 2;
  const idRangeOffsets = idDeltas + segCount * 2;
  for (let s = 0; s < segCount; s++) {
    const end = r.u16(endCodes + s * 2);
    const start = r.u16(startCodes + s * 2);
    const delta = r.i16(idDeltas + s * 2);
    const rangeOffsetAt = idRangeOffsets + s * 2;
    const rangeOffset = r.u16(rangeOffsetAt);
    for (let cp = start; cp <= end && cp !== 0xffff; cp++) {
      let glyph: number;
      if (rangeOffset === 0) {
        glyph = (cp + delta) & 0xffff;
      } else {
        // The offset is relative to the idRangeOffset entry itself.
        glyph = r.u16(rangeOffsetAt + rangeOffset + (cp - start) * 2);
        if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
      }
      if (glyph !== 0) codePoints.add(cp);
    }
  }
  return codePoints;
}

/** Format 12: segmented coverage (full Unicode range). */
function readFormat12(r: Reader, offset: number): Set<number> {
  const codePoints = new Set<number>();
  const numGroups = r.u32(offset + 12);
  if (numGroups * 12 > r.length) throw new FontParseError("bad group count in cmap format 12");
  for (let g = 0; g < numGroups; g++) {
    const group = offset + 16 + g * 12;
    const start = r.u32(group);
    const end = Math.min(r.u32(group + 4), 0x10ffff);
    const startGlyph = r.u32(group + 8);
    if (end < start) throw new FontParseError("bad group range in cmap format 12");
    // Glyph 0 is `.notdef`: a group starting at glyph 0 does not cover its first code point.
    for (let cp = startGlyph === 0 ? start + 1 : start; cp <= end; cp++) codePoints.add(cp);
  }
  return codePoints;
}

const cache = new Map<string, GlyphCoverage>();

/** Reads the glyph coverage of a font file. Results are cached per path. */
export function loadGlyphCoverage(path: string): GlyphCoverage {
  let coverage = cache.get(path);
  if (coverage === undefined) {
    try {
      coverage = parseGlyphCoverage(readFileSync(path));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new FontParseError(`cannot read the cmap of ${path}: ${reason}`, { cause: error });
    }
    cache.set(path, coverage);
  }
  return coverage;
}
