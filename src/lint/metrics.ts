/**
 * Minimal reader for the horizontal metrics of TrueType / OpenType fonts
 * (`head`, `hhea`, `maxp`, `hmtx`, optionally `OS/2`), combined with the
 * `cmap` reader into a {@link FontMetrics} that measures text advance widths.
 * Used by the geometry lint (#13) to re-measure labels with the same TTF D2
 * embedded in the SVG (design doc §6.5).
 *
 * Like `cmap.ts`, every read is confined to the declared bounds of its table,
 * and inconsistent counts (more horizontal metrics than glyphs, an `hmtx`
 * shorter than `hhea` / `maxp` declare) throw a {@link FontParseError}.
 *
 * Measurement sums the advance widths of the code points' nominal glyphs
 * (`cmap` → glyph ID → `hmtx`). No kerning (`kern` / GPOS), ligatures or other
 * shaping: see the limits in the design doc.
 */

import { readFileSync } from "node:fs";
import { type GlyphCoverage, parseCmapTable } from "./cmap";
import { FontParseError, readTables } from "./sfnt";

const HEAD_MAGIC = 0x5f0f3cf5;

/** Control and default-ignorable characters (variation selectors, joiners, ...). */
const INVISIBLE = /[\p{Cc}\p{Default_Ignorable_Code_Point}]/u;

/** Vertical metrics in font units (positive ascender, negative descender). */
export interface VerticalMetrics {
  ascender: number;
  descender: number;
  lineGap: number;
}

export interface FontMetrics {
  readonly unitsPerEm: number;
  readonly numGlyphs: number;
  /** `hhea` ascender / descender / lineGap. */
  readonly hhea: VerticalMetrics;
  /** `OS/2` sTypoAscender / sTypoDescender / sTypoLineGap, if the font has an OS/2 table. */
  readonly typo?: VerticalMetrics;
  readonly coverage: GlyphCoverage;
  /** Advance width of a glyph in font units. Glyph IDs outside the font use `.notdef` (glyph 0). */
  advance(glyph: number): number;
  /**
   * Advance width of a code point in font units: its nominal glyph, or
   * `.notdef` when the font does not map it (what a renderer draws as tofu).
   */
  advanceOf(codePoint: number): number;
  /** Sum of the advance widths of `text`'s code points, in em (multiply by the font size). */
  measureEm(text: string): number;
  /** `post.italicAngle` in degrees (negative for a font leaning right); 0 without a `post` table. */
  readonly italicAngle: number;
  /**
   * The outline's bounding box of a code point's nominal glyph in font units
   * (`glyf`, y up), or `undefined` when the font does not map the code
   * point, the glyph is empty, or the font has no TrueType outlines. Used
   * to place math accents (#129).
   */
  glyphBounds(codePoint: number): GlyphBounds | undefined;
}

/** A glyph's outline bounding box in font units, y up (`glyf` header). */
export interface GlyphBounds {
  readonly xMin: number;
  readonly yMin: number;
  readonly xMax: number;
  readonly yMax: number;
}

/**
 * The bounding box of each glyph from `loca` / `glyf` (read lazily), or
 * `undefined` for a font without TrueType outlines.
 */
function glyphBoundsReader(
  tables: ReturnType<typeof readTables>,
  numGlyphs: number,
): ((glyph: number) => GlyphBounds | undefined) | undefined {
  const loca = tables.get("loca");
  const glyf = tables.get("glyf");
  if (loca === undefined || glyf === undefined) return undefined;
  const long = tables.require("head").i16(50) === 1;
  const offset = (i: number) => (long ? loca.u32(i * 4) : loca.u16(i * 2) * 2);
  return (glyph) => {
    if (!Number.isInteger(glyph) || glyph < 0 || glyph >= numGlyphs) return undefined;
    const start = offset(glyph);
    if (offset(glyph + 1) <= start) return undefined;
    return {
      xMin: glyf.i16(start + 2),
      yMin: glyf.i16(start + 4),
      xMax: glyf.i16(start + 6),
      yMax: glyf.i16(start + 8),
    };
  };
}

/** Parses the metrics of a font file's bytes. */
export function parseFontMetrics(bytes: Uint8Array): FontMetrics {
  const tables = readTables(bytes);

  const head = tables.require("head");
  if (head.u32(12) !== HEAD_MAGIC) throw new FontParseError("bad magic number in the head table");
  const unitsPerEm = head.u16(18);
  if (unitsPerEm < 16 || unitsPerEm > 16384) {
    throw new FontParseError(`unitsPerEm ${unitsPerEm} is outside 16–16384`);
  }

  const maxp = tables.require("maxp");
  const numGlyphs = maxp.u16(4);
  if (numGlyphs === 0) throw new FontParseError("the font has no glyphs");

  const hhea = tables.require("hhea");
  const hheaMetrics: VerticalMetrics = {
    ascender: hhea.i16(4),
    descender: hhea.i16(6),
    lineGap: hhea.i16(8),
  };
  const numberOfHMetrics = hhea.u16(34);
  if (numberOfHMetrics === 0 || numberOfHMetrics > numGlyphs) {
    throw new FontParseError(
      `hhea numberOfHMetrics ${numberOfHMetrics} is not within 1–${numGlyphs} (maxp numGlyphs)`,
    );
  }

  // hmtx: numberOfHMetrics × (advanceWidth u16, lsb i16), then one lsb i16 per remaining glyph.
  const hmtx = tables.require("hmtx");
  const required = numberOfHMetrics * 4 + (numGlyphs - numberOfHMetrics) * 2;
  if (hmtx.length < required) {
    throw new FontParseError(
      `hmtx table has ${hmtx.length} bytes, but hhea and maxp require ${required}`,
    );
  }
  const advances = new Uint16Array(numberOfHMetrics);
  for (let g = 0; g < numberOfHMetrics; g++) advances[g] = hmtx.u16(g * 4);
  // Glyphs past numberOfHMetrics repeat the last advance width.
  const lastAdvance = advances[numberOfHMetrics - 1] ?? 0;

  const os2 = tables.get("OS/2");
  // sTypoAscender / sTypoDescender / sTypoLineGap are at 68–73 in every OS/2 version.
  const typo: VerticalMetrics | undefined =
    os2 === undefined
      ? undefined
      : { ascender: os2.i16(68), descender: os2.i16(70), lineGap: os2.i16(72) };

  const coverage = parseCmapTable(tables.require("cmap"));
  const advance = (glyph: number): number => {
    const g = Number.isInteger(glyph) && glyph >= 0 && glyph < numGlyphs ? glyph : 0;
    return g < numberOfHMetrics ? (advances[g] ?? 0) : lastAdvance;
  };
  const advanceOf = (codePoint: number): number => advance(coverage.glyph(codePoint));
  const post = tables.get("post");
  // italicAngle is a Fixed (16.16) at offset 4.
  const italicAngle = post === undefined ? 0 : (post.u32(4) | 0) / 65536;
  let boundsOf: ((glyph: number) => GlyphBounds | undefined) | undefined | null = null;
  const glyphBounds = (codePoint: number): GlyphBounds | undefined => {
    if (!coverage.has(codePoint)) return undefined;
    if (boundsOf === null) boundsOf = glyphBoundsReader(tables, numGlyphs);
    return boundsOf?.(coverage.glyph(codePoint));
  };
  return Object.freeze({
    italicAngle,
    glyphBounds,
    unitsPerEm,
    numGlyphs,
    hhea: Object.freeze(hheaMetrics),
    ...(typo !== undefined && { typo: Object.freeze(typo) }),
    coverage,
    advance,
    advanceOf,
    measureEm(text: string) {
      let total = 0;
      for (const char of text) {
        const codePoint = char.codePointAt(0) ?? 0;
        // Renderers draw nothing for unmapped control and default-ignorable characters.
        if (!coverage.has(codePoint) && INVISIBLE.test(char)) continue;
        total += advanceOf(codePoint);
      }
      return total / unitsPerEm;
    },
  });
}

const cache = new Map<string, FontMetrics>();

/** Reads the metrics of a font file. Results are cached per path. */
export function loadFontMetrics(path: string): FontMetrics {
  let metrics = cache.get(path);
  if (metrics === undefined) {
    try {
      metrics = parseFontMetrics(readFileSync(path));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new FontParseError(`cannot read the metrics of ${path}: ${reason}`, { cause: error });
    }
    cache.set(path, metrics);
  }
  return metrics;
}
