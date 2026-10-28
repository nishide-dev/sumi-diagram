/**
 * Text measurement for layout engines (design doc §6.21). Labels are measured
 * with the theme's bundled TTF files, read in-process by the same font reader
 * and with the same rules as the geometry lint (§6.5): `hmtx` advance widths
 * without kerning or shaping, `hhea` ascender / descender, and whitespace
 * collapsed as an SVG `<text>` without `xml:space` draws it. The lint's
 * re-measurement of an SVG drawn from a layout therefore finds the same lines
 * and widths, and glyph boxes inside the layout's line boxes.
 */

import { labelRuns, scriptGeometry } from "../core/label/runs";
import type { FontSet } from "../core/theme/fonts";
import type { CommonStyle } from "../core/theme/style";
import { fontFileFor, latinFontOf } from "../lint/geometry/measure";
import { loadFontMetrics } from "../lint/metrics";
import type { TextAccent, TextMetrics, TextRun } from "./ir";

/** Baseline-to-baseline distance as a multiple of the font size (the #86 prototype's value). */
export const LINE_HEIGHT = 1.25;

/** Measures single lines of text. Injected into layout engines (tests use their own). */
export interface TextMeasurer {
  /** Advance width of one line in units, drawn in `font` (a font class) at `sizeUnits`. */
  lineWidth(text: string, font: string, sizeUnits: number): number;
  /** Ascender and descender in units, both positive. */
  verticalMetrics(font: string, sizeUnits: number): { ascent: number; descent: number };
  /**
   * Whether a font class has a glyph for a code point (#93): label text the
   * label's font lacks is drawn with the `math` font when that has it.
   * Without it, nothing falls back.
   */
  covers?(font: string, codePoint: number): boolean;
  /**
   * The Latin font class of a label font class, if the font set has one
   * (#172): text characters that font has are drawn with it. Needs `covers`.
   */
  latin?(font: string): string | undefined;
  /**
   * The outline box of a character's glyph in units at `sizeUnits`, y up
   * from the baseline, or `undefined` if the font has none (#129: math
   * accents are placed over their base's outline). Without it, accents are
   * centered on their base's advance.
   */
  glyphBox?(font: string, char: string, sizeUnits: number): GlyphBox | undefined;
  /** The font's slant: tan of its italic angle, positive leaning right (#129). */
  slant?(font: string): number;
}

/** A glyph's outline box in units, y up from the baseline. */
export interface GlyphBox {
  readonly xMin: number;
  readonly yMin: number;
  readonly xMax: number;
  readonly yMax: number;
}

/** A {@link TextMeasurer} reading the TTF files of a font set. */
export function fontSetMeasurer(fonts: FontSet): TextMeasurer {
  const metricsOf = (font: string) => loadFontMetrics(fontFileFor(font, fonts));
  return {
    glyphBox(font, char, sizeUnits) {
      const metrics = metricsOf(font);
      const bounds = metrics.glyphBounds(char.codePointAt(0) ?? 0);
      if (bounds === undefined) return undefined;
      const scale = sizeUnits / metrics.unitsPerEm;
      return {
        xMin: bounds.xMin * scale,
        yMin: bounds.yMin * scale,
        xMax: bounds.xMax * scale,
        yMax: bounds.yMax * scale,
      };
    },
    slant: (font) => Math.tan((-metricsOf(font).italicAngle * Math.PI) / 180),
    lineWidth: (text, font, sizeUnits) => metricsOf(font).measureEm(text) * sizeUnits,
    verticalMetrics(font, sizeUnits) {
      const metrics = metricsOf(font);
      return {
        ascent: (metrics.hhea.ascender / metrics.unitsPerEm) * sizeUnits,
        descent: (-metrics.hhea.descender / metrics.unitsPerEm) * sizeUnits,
      };
    },
    covers: (font, codePoint) => metricsOf(font).coverage.has(codePoint),
    ...((fonts.latin !== undefined || fonts.latinBold !== undefined) && {
      latin: (font: string) => latinFontOf(font, fonts),
    }),
  };
}

/**
 * The font class of a style, named like D2's `text-*` classes without the
 * prefix (and like `LabelGeometry.font`). Bold wins over italic, like the
 * font set's slots: there is no bold-italic file.
 */
export function fontClassOf(style: Pick<CommonStyle, "bold" | "italic" | "mono">): string {
  const weight = style.bold ? "bold" : style.italic ? "italic" : undefined;
  if (style.mono) return weight === undefined ? "mono" : `mono-${weight}`;
  return weight ?? "regular";
}

/** Measures a label drawn with `style`; `undefined` for no label (`""`). */
export function measureText(
  label: string,
  style: Pick<CommonStyle, "bold" | "italic" | "mono" | "fontSize">,
  measurer: TextMeasurer,
): TextMetrics | undefined {
  if (label === "") return undefined;
  const size = style.fontSize.units;
  const drawn = labelRuns(label, {
    font: fontClassOf(style),
    ...(measurer.covers !== undefined && { covers: measurer.covers.bind(measurer) }),
    ...(measurer.latin !== undefined && { latin: measurer.latin.bind(measurer) }),
  });
  const { lines, runs } = drawn;
  // A label wholly in the Latin font (#172) is plain text in it.
  const font = drawn.font ?? fontClassOf(style);
  let { ascent, descent } = measurer.verticalMetrics(font, size);
  let measuredRuns: TextRun[][] | undefined;
  let lineWidths: number[];
  if (runs === undefined) {
    lineWidths = lines.map((line) => measurer.lineWidth(line, font, size));
  } else {
    // Each run in its font and size; scripts move the line's extent up and down.
    measuredRuns = runs.map((line) =>
      line.map((run): TextRun => {
        const { fontSize, shift } = scriptGeometry(run.script, size);
        const v = measurer.verticalMetrics(run.font, fontSize);
        ascent = Math.max(ascent, v.ascent - shift);
        descent = Math.max(descent, v.descent + shift);
        const measured: TextRun = {
          text: run.text,
          font: run.font,
          fontSizeUnits: fontSize,
          shiftUnits: shift,
          width: measurer.lineWidth(run.text, run.font, fontSize),
        };
        if (run.accent === undefined) return measured;
        const { accent, top, bottom } = placeAccent(measured, run.accent, measurer);
        // The mark's outline may reach above the fonts' ascender (tall bases).
        ascent = Math.max(ascent, top);
        descent = Math.max(descent, -bottom);
        return { ...measured, accent };
      }),
    );
    lineWidths = measuredRuns.map((line) => line.reduce((sum, run) => sum + run.width, 0));
  }
  const lineHeightUnits =
    runs === undefined ? size * LINE_HEIGHT : Math.max(size * LINE_HEIGHT, ascent + descent);
  return {
    lines,
    lineWidths,
    font,
    fontSizeUnits: size,
    lineHeightUnits,
    ascentUnits: ascent,
    descentUnits: descent,
    width: Math.max(0, ...lineWidths),
    height: lines.length * lineHeightUnits,
    ...(measuredRuns !== undefined && { runs: measuredRuns }),
  };
}

/** The space between a base's outline and its accent's, as a fraction of the font size (#124 §3.6). */
export const ACCENT_GAP = 0.04;

/**
 * Places a math accent (#129, design doc §6.29) over its run's one
 * character. Sumi places it itself rather than the font's GPOS `mark`
 * feature, which no output keeps (the SVG subsets and the PDF fonts drop
 * GPOS): the mark's outline is centered over the base's outline, moved right
 * by the font's slant over half the base's height (an italic letter's top is
 * right of its middle), and its bottom is `ACCENT_GAP` above the base's top.
 * Returns the placement and how far the mark's outline reaches above and
 * below the line's baseline (`top`, `bottom`, y up).
 */
export function placeAccent(
  run: TextRun,
  mark: string,
  measurer: TextMeasurer,
): { accent: TextAccent; top: number; bottom: number } {
  const size = run.fontSizeUnits;
  const base = measurer.glyphBox?.(run.font, run.text, size) ?? {
    // No outline (no glyph, or a measurer without outlines): the advance, half an em high.
    xMin: 0,
    yMin: 0,
    xMax: run.width,
    yMax: size / 2,
  };
  const slant = measurer.slant?.(run.font) ?? 0;
  const center = (base.xMin + base.xMax) / 2 + (slant * (base.yMax - base.yMin)) / 2;
  const width = measurer.lineWidth(mark, run.font, size);
  const box = measurer.glyphBox?.(run.font, mark, size);
  if (box === undefined) {
    // A mark without an outline draws nothing to place: keep it on the run's baseline.
    return {
      accent: { char: mark, dxUnits: center, shiftUnits: run.shiftUnits, width },
      top: -run.shiftUnits,
      bottom: -run.shiftUnits,
    };
  }
  const rise = base.yMax + ACCENT_GAP * size - box.yMin;
  const shift = run.shiftUnits - rise;
  return {
    accent: { char: mark, dxUnits: center - (box.xMin + box.xMax) / 2, shiftUnits: shift, width },
    top: box.yMax - shift,
    bottom: box.yMin - shift,
  };
}
