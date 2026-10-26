/**
 * Minimal reader for the `cmap` table of TrueType / OpenType fonts: which
 * Unicode code points a font maps to a glyph, and to which glyph ID. Used by
 * `lint/missing-glyph` and, through the glyph IDs, by the text measurement of
 * the geometry lint (`metrics.ts`).
 *
 * Supports the Unicode subtables of formats 4 (BMP) and 12 (full range),
 * preferring format 12. Every read is confined to the declared bounds of the
 * table and subtable it belongs to, and segments / groups must be sorted and
 * non-overlapping. Malformed data throws a {@link FontParseError} instead of
 * producing a partial answer. Coverage is stored as sorted ranges, so memory
 * and time stay proportional to the size of the font data.
 */

import { readFileSync } from "node:fs";
import { FontParseError, type Reader, readTables } from "./sfnt";

export { FontParseError } from "./sfnt";

/** The code points a font has glyphs for, and their glyph IDs. */
export interface GlyphCoverage {
  has(codePoint: number): boolean;
  /** Glyph ID of a code point, or 0 (`.notdef`) if the font does not map it. */
  glyph(codePoint: number): number;
  /** Number of mapped code points. */
  readonly size: number;
  /** Every mapping, ascending by code point: code point → glyph ID. */
  entries(): Generator<[codePoint: number, glyph: number]>;
}

const MAX_CODE_POINT = 0x10ffff;

/**
 * Collects code points in ascending order as `[start, end]` ranges mapped to
 * consecutive glyph IDs from `glyphStart`. Adjacent ranges merge only when
 * their glyph IDs continue, so a range lookup also yields the glyph ID.
 */
class RangeBuilder {
  readonly starts: number[] = [];
  readonly ends: number[] = [];
  readonly glyphs: number[] = [];
  size = 0;
  add(start: number, end: number, glyphStart: number): void {
    if (end < start) return;
    const last = this.ends.length - 1;
    const lastEnd = this.ends[last];
    if (lastEnd !== undefined && start <= lastEnd) {
      throw new FontParseError("cmap ranges are not ascending");
    }
    const lastStart = this.starts[last] ?? 0;
    const lastGlyph = this.glyphs[last] ?? 0;
    if (
      lastEnd !== undefined &&
      start === lastEnd + 1 &&
      glyphStart === lastGlyph + (start - lastStart)
    ) {
      this.ends[last] = end;
    } else {
      this.starts.push(start);
      this.ends.push(end);
      this.glyphs.push(glyphStart);
    }
    this.size += end - start + 1;
  }
  build(): GlyphCoverage {
    const starts = Uint32Array.from(this.starts);
    const ends = Uint32Array.from(this.ends);
    // Format 12 glyph IDs are 32-bit; Float64 keeps them exact.
    const glyphs = Float64Array.from(this.glyphs);
    const find = (codePoint: number): number => {
      let lo = 0;
      let hi = starts.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >>> 1;
        if (codePoint < (starts[mid] ?? 0)) hi = mid - 1;
        else if (codePoint > (ends[mid] ?? 0)) lo = mid + 1;
        else return mid;
      }
      return -1;
    };
    return {
      size: this.size,
      has: (codePoint) => find(codePoint) >= 0,
      glyph(codePoint) {
        const i = find(codePoint);
        return i < 0 ? 0 : (glyphs[i] ?? 0) + (codePoint - (starts[i] ?? 0));
      },
      *entries() {
        for (let i = 0; i < starts.length; i++) {
          const start = starts[i] ?? 0;
          for (let cp = start; cp <= (ends[i] ?? 0); cp++) {
            yield [cp, (glyphs[i] ?? 0) + (cp - start)];
          }
        }
      },
    };
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

/** Parses the Unicode coverage (with glyph IDs) of a font file's bytes. */
export function parseGlyphCoverage(bytes: Uint8Array): GlyphCoverage {
  return parseCmapTable(readTables(bytes).require("cmap"));
}

/** Parses a `cmap` table (a reader over exactly the table). */
export function parseCmapTable(cmap: Reader): GlyphCoverage {
  const numSubtables = cmap.u16(2);
  const subtables: { platform: number; encoding: number; format: number; offset: number }[] = [];
  for (let i = 0; i < numSubtables; i++) {
    const record = 4 + i * 8;
    const offset = cmap.u32(record + 4);
    subtables.push({
      platform: cmap.u16(record),
      encoding: cmap.u16(record + 2),
      format: cmap.u16(offset),
      offset,
    });
  }
  for (const [platform, encoding, format] of PREFERENCE) {
    const subtable = subtables.find(
      (s) => s.platform === platform && s.encoding === encoding && s.format === format,
    );
    if (subtable === undefined) continue;
    const { offset } = subtable;
    return format === 12
      ? readFormat12(cmap.window(offset, cmap.u32(offset + 4), "cmap format 12 subtable"))
      : readFormat4(cmap.window(offset, cmap.u16(offset + 2), "cmap format 4 subtable"));
  }
  throw new FontParseError("the font has no Unicode cmap subtable of format 4 or 12");
}

/** Format 4: segment mapping to delta values (BMP only). */
function readFormat4(r: Reader): GlyphCoverage {
  const segCountX2 = r.u16(6);
  if (segCountX2 % 2 !== 0) throw new FontParseError("odd segCountX2 in cmap format 4");
  const segCount = segCountX2 / 2;
  const endCodes = 14;
  const startCodes = endCodes + segCountX2 + 2; // skip reservedPad
  const idDeltas = startCodes + segCountX2;
  const idRangeOffsets = idDeltas + segCountX2;
  const ranges = new RangeBuilder();
  let previousEnd = -1;
  for (let s = 0; s < segCount; s++) {
    const end = r.u16(endCodes + s * 2);
    const start = r.u16(startCodes + s * 2);
    if (start > end || start <= previousEnd) {
      throw new FontParseError("cmap format 4 segments are not sorted and disjoint");
    }
    previousEnd = end;
    const delta = r.i16(idDeltas + s * 2);
    const rangeOffsetAt = idRangeOffsets + s * 2;
    const rangeOffset = r.u16(rangeOffsetAt);
    // Segments are disjoint within 0–0xFFFF, so this loop runs at most 65536 times overall.
    // Runs of code points with consecutive glyph IDs become one range.
    let runStart = -1;
    let runGlyph = 0;
    const flush = (runEnd: number) => {
      if (runStart >= 0) ranges.add(runStart, runEnd, runGlyph);
      runStart = -1;
    };
    for (let cp = start; cp <= end && cp !== 0xffff; cp++) {
      let glyph: number;
      if (rangeOffset === 0) {
        glyph = (cp + delta) & 0xffff;
      } else {
        // The offset is relative to the idRangeOffset entry itself.
        glyph = r.u16(rangeOffsetAt + rangeOffset + (cp - start) * 2);
        if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
      }
      if (runStart >= 0 && (glyph === 0 || glyph !== runGlyph + (cp - runStart))) flush(cp - 1);
      if (glyph !== 0 && runStart < 0) {
        runStart = cp;
        runGlyph = glyph;
      }
    }
    flush(Math.min(end, 0xfffe));
  }
  return ranges.build();
}

/** Format 12: segmented coverage (full Unicode range). */
function readFormat12(r: Reader): GlyphCoverage {
  const numGroups = r.u32(12);
  if (16 + numGroups * 12 > r.length) {
    throw new FontParseError("cmap format 12 groups exceed the subtable");
  }
  const ranges = new RangeBuilder();
  let previousEnd = -1;
  for (let g = 0; g < numGroups; g++) {
    const group = 16 + g * 12;
    const start = r.u32(group);
    const end = r.u32(group + 4);
    const startGlyph = r.u32(group + 8);
    if (start > end || end > MAX_CODE_POINT || start <= previousEnd) {
      throw new FontParseError("cmap format 12 groups are not sorted, disjoint and in range");
    }
    previousEnd = end;
    // Glyph 0 is `.notdef`: a group starting at glyph 0 does not cover its first code point.
    if (startGlyph === 0) ranges.add(start + 1, end, 1);
    else ranges.add(start, end, startGlyph);
  }
  return ranges.build();
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
