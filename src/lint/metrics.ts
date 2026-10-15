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
  return Object.freeze({
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
