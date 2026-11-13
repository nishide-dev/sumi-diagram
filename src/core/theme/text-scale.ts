/**
 * Text scale (#514, `figure.themeOverrides.textScale`): the theme drawn
 * larger or smaller as a whole, for a placement the theme's own sizes do not
 * suit (`sumi` text is 7-9pt; a slide needs 14pt).
 *
 * The scale is applied to a copy of the theme, in every layer: font sizes,
 * line widths (so arrowheads, which follow the width of their edge, grow with
 * them) and corner radii. Colors, dashes and fonts are untouched. Every size
 * rounds to whole D2 units (0.5pt), which the auto layout writes as integers;
 * a line never rounds to zero and a borderless one stays borderless; font sizes stay within the style range (4-50pt) and line
 * widths within 7.5pt. Spacing (gaps, paddings, margins) is the profile's and
 * does not follow the theme; a profile for large text sets its own.
 *
 * A length the figure writes itself (`lineWidth`, `frameWidth`, element
 * `lineWidth`, `cornerRadius`, `iconSize` in mm) is final pt and is not
 * scaled. See docs/design/decisions/514-text-scale.md.
 */

import type { Theme } from "./schema";
import { type StyleLayer, type StyleLength, sublabelFontSize } from "./style";

/** Accepted scales: multiples of 0.25 from 0.5 to 4. */
export const TEXT_SCALE_MIN = 0.5;
export const TEXT_SCALE_MAX = 4;
export const TEXT_SCALE_STEP = 0.25;

const MAX_FONT_UNITS = 100;
const MIN_FONT_UNITS = 8;
const MAX_STROKE_UNITS = 15;

const fromUnits = (units: number): StyleLength => ({ pt: units / 2, units });

/** A font size scaled and rounded to 0.5pt, kept within the style range. */
export function scaleFontSize(size: StyleLength, scale: number): StyleLength {
  return fromUnits(
    Math.min(MAX_FONT_UNITS, Math.max(MIN_FONT_UNITS, Math.round(size.units * scale))),
  );
}

/** A line width scaled and rounded to 0.5pt; zero stays zero, a line stays visible. */
export function scaleLineWidth(width: StyleLength, scale: number): StyleLength {
  if (width.units <= 0) return width;
  return fromUnits(Math.min(MAX_STROKE_UNITS, Math.max(1, Math.round(width.units * scale))));
}

function scaleLayer(layer: StyleLayer, scale: number): StyleLayer {
  const next: { -readonly [K in keyof StyleLayer]: StyleLayer[K] } = { ...layer };
  if (layer.fontSize !== undefined) next.fontSize = scaleFontSize(layer.fontSize, scale);
  if (layer.strokeWidth !== undefined) next.strokeWidth = scaleLineWidth(layer.strokeWidth, scale);
  if (layer.radius !== undefined && layer.radius.units > 0)
    next.radius = fromUnits(Math.round(layer.radius.units * scale));
  return Object.freeze(next);
}

/** The theme with its text, lines and corners scaled; the theme itself for a scale of 1 or none. */
export function withTextScale(theme: Theme, scale: number | undefined): Theme {
  if (scale === undefined || scale === 1) return theme;
  return Object.freeze({
    ...theme,
    base: {
      node: scaleLayer(theme.base.node, scale),
      group: scaleLayer(theme.base.group, scale),
      edge: scaleLayer(theme.base.edge, scale),
    },
    components: new Map(
      [...theme.components].map(([id, variants]) => [
        id,
        new Map([...variants].map(([variant, layer]) => [variant, scaleLayer(layer, scale)])),
      ]),
    ),
  });
}

/**
 * The smallest scale (a multiple of 0.25, 1 at least) at which text of
 * `sizePt`, and the sublabel drawn at 7/8 of it, reaches `minPt`; `undefined`
 * if even the largest scale does not.
 */
export function scaleToReach(
  sizePt: number,
  minPt: number,
  withSublabel: boolean,
): number | undefined {
  for (let scale = 1; scale <= TEXT_SCALE_MAX; scale += TEXT_SCALE_STEP) {
    const size = scaleFontSize({ pt: sizePt, units: sizePt * 2 }, scale);
    const smallest = withSublabel ? sublabelFontSize(size) : size;
    if (smallest.pt >= minPt) return scale;
  }
  return undefined;
}
