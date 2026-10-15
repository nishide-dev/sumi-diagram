/**
 * Label measurement for the geometry lint (#13, design doc §6.4): the boxes
 * of a label as the SVG draws it, re-measured with the same TTF files that D2
 * embedded (the theme's font set), without a browser.
 *
 * - Horizontal: each line is centered on the anchor (`text-anchor: middle`)
 *   and is as wide as the sum of its characters' advance widths (`hmtx`) at
 *   the label's font size. No kerning or shaping; the bundled BIZ UD Gothic
 *   has neither `kern` nor `GPOS`, so this is exact for it.
 * - Vertical: the first line's baseline is the anchor; later lines advance by
 *   the label's line height (the `<tspan>` `dy`). A line spans from the
 *   font's ascender above its baseline to its descender below (`hhea`).
 */

import type { FontSet } from "../../core/theme/fonts";
import type { Rect } from "../../render/geometry";
import type { LabelGeometry } from "../../render/inspect";
import { type FontMetrics, loadFontMetrics } from "../metrics";

export interface MeasuredLabel {
  /** The label as inspected. */
  label: LabelGeometry;
  /** The font file the label is drawn with. */
  fontPath: string;
  /** One box per line (empty lines have zero width), in drawing order. */
  lines: Rect[];
  /** The union of the line boxes. */
  box: Rect;
}

/**
 * The font file for one of D2's font classes (`LabelGeometry.font`): `mono*`
 * → mono, `bold` / `semibold` → bold, `italic` → italic, anything else
 * regular. Missing optional slots fall back to regular, like the `--font-*`
 * arguments do (design doc §4.2).
 */
export function fontFileFor(fontClass: string, fonts: FontSet): string {
  if (fontClass.startsWith("mono")) return fonts.mono ?? fonts.regular;
  if (fontClass === "bold" || fontClass === "semibold") return fonts.bold;
  if (fontClass === "italic") return fonts.italic ?? fonts.regular;
  return fonts.regular;
}

/** Measures a label drawn with `metrics` (see the module comment). */
export function measureLabelWith(
  label: LabelGeometry,
  metrics: FontMetrics,
): Omit<MeasuredLabel, "fontPath"> {
  const size = label.fontSizeUnits;
  const ascent = (metrics.hhea.ascender / metrics.unitsPerEm) * size;
  const descent = (-metrics.hhea.descender / metrics.unitsPerEm) * size;
  const texts = label.text.split("\n");
  const lines = texts.map((text, i): Rect => {
    const width = metrics.measureEm(text) * size;
    const baseline = label.anchor.y + i * label.lineHeightUnits;
    return {
      x: label.anchor.x - width / 2,
      y: baseline - ascent,
      width,
      height: ascent + descent,
    };
  });
  const widest = Math.max(0, ...lines.map((l) => l.width));
  const first = lines[0];
  const last = lines[lines.length - 1];
  const top = first?.y ?? label.anchor.y;
  const bottom = last === undefined ? label.anchor.y : last.y + last.height;
  return {
    label,
    lines,
    box: { x: label.anchor.x - widest / 2, y: top, width: widest, height: bottom - top },
  };
}

/** Measures a label with the font set's file for its font class. */
export function measureLabel(label: LabelGeometry, fonts: FontSet): MeasuredLabel {
  const fontPath = fontFileFor(label.font, fonts);
  return { ...measureLabelWith(label, loadFontMetrics(fontPath)), fontPath };
}
