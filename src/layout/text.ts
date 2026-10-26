/**
 * Text measurement for layout engines (design doc §6.21). Labels are measured
 * with the theme's bundled TTF files, read in-process by the same font reader
 * and with the same rules as the geometry lint (§6.5): `hmtx` advance widths
 * without kerning or shaping, `hhea` ascender / descender, and whitespace
 * collapsed as an SVG `<text>` without `xml:space` draws it. The lint's
 * re-measurement of an SVG drawn from a layout therefore finds the same lines
 * and widths, and glyph boxes inside the layout's line boxes.
 */

import type { FontSet } from "../core/theme/fonts";
import type { CommonStyle } from "../core/theme/style";
import { fontFileFor, renderedLines } from "../lint/geometry/measure";
import { loadFontMetrics } from "../lint/metrics";
import type { TextMetrics } from "./ir";

/** Baseline-to-baseline distance as a multiple of the font size (the #86 prototype's value). */
export const LINE_HEIGHT = 1.25;

/** Measures single lines of text. Injected into layout engines (tests use their own). */
export interface TextMeasurer {
  /** Advance width of one line in units, drawn in `font` (a font class) at `sizeUnits`. */
  lineWidth(text: string, font: string, sizeUnits: number): number;
  /** Ascender and descender in units, both positive. */
  verticalMetrics(font: string, sizeUnits: number): { ascent: number; descent: number };
}

/** A {@link TextMeasurer} reading the TTF files of a font set. */
export function fontSetMeasurer(fonts: FontSet): TextMeasurer {
  const metricsOf = (font: string) => loadFontMetrics(fontFileFor(font, fonts));
  return {
    lineWidth: (text, font, sizeUnits) => metricsOf(font).measureEm(text) * sizeUnits,
    verticalMetrics(font, sizeUnits) {
      const metrics = metricsOf(font);
      return {
        ascent: (metrics.hhea.ascender / metrics.unitsPerEm) * sizeUnits,
        descent: (-metrics.hhea.descender / metrics.unitsPerEm) * sizeUnits,
      };
    },
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
  const font = fontClassOf(style);
  const size = style.fontSize.units;
  const lines = renderedLines(label);
  const lineWidths = lines.map((line) => measurer.lineWidth(line, font, size));
  const { ascent, descent } = measurer.verticalMetrics(font, size);
  const lineHeightUnits = size * LINE_HEIGHT;
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
  };
}
