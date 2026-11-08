/**
 * Line widths, arrowhead sizes and frame corners a figure sets (#427, design
 * record 427). They are applied to the resolved style of an element, after
 * the theme and the tone: the figure-wide values (`themeOverrides.lineWidth`,
 * `frameWidth`, `arrowheadScale`, `cornerRadius`) first, then the element's
 * own (`lineWidth`, `arrowheadScale`, `cornerRadius`). Without any of them
 * the style is returned as it is.
 */

import type { ResolvedStyle, StyleLength } from "./style";

/** The figure-wide values, in pt (`figure.themeOverrides`). */
export interface FigureStrokes {
  readonly lineWidth?: number | undefined;
  readonly frameWidth?: number | undefined;
  readonly arrowheadScale?: number | undefined;
  readonly cornerRadius?: number | undefined;
}

/** The element's own values, in pt (`lineWidth`, `arrowheadScale`, `cornerRadius`). */
export interface ElementStrokes {
  readonly lineWidth?: number | undefined;
  readonly arrowheadScale?: number | undefined;
  readonly cornerRadius?: number | undefined;
}

/** Largest stroke width a style takes (7.5pt, see `STYLE_PROPERTIES`), in D2 units. */
const MAX_WIDTH_UNITS = 15;

const length = (pt: number): StyleLength => ({ pt, units: pt * 2 });

/**
 * The stroke width of an element: `width` (pt) where the style draws a
 * stroke. A frame (group, set, legend) and an element's own width take
 * exactly that. A figure-wide `lineWidth` replaces the regular width of
 * nodes and edges: a variant the theme draws at another width (a heavier
 * emphasis, a lighter zoom line) keeps its ratio to `reference`, the
 * component's default width, rounded to 0.25pt. Never above 7.5pt; zero
 * (borderless) stays zero.
 */
function width(
  current: StyleLength,
  reference: StyleLength,
  widthPt: number,
  exact: boolean,
): StyleLength {
  if (current.units <= 0) return current;
  const ratio = exact || reference.units <= 0 ? 1 : current.units / reference.units;
  const units = Math.min(MAX_WIDTH_UNITS, Math.round(widthPt * 2 * ratio * 2) / 2);
  return { pt: units / 2, units };
}

export interface StrokeContext {
  readonly figure?: FigureStrokes | undefined;
  readonly element?: ElementStrokes | undefined;
  /** A frame: a group, a set or a legend, which take `frameWidth` and `cornerRadius`. */
  readonly frame: boolean;
  /** The component's default-variant stroke width: what `lineWidth` replaces. */
  readonly reference: StyleLength;
}

/** The style with the figure's line widths and arrowhead size (not the corners, see {@link withRadius}). */
export function withStrokes(style: ResolvedStyle, context: StrokeContext): ResolvedStyle {
  const { figure, element } = context;
  let next = style;
  const own = element?.lineWidth;
  const wide = own ?? (context.frame ? figure?.frameWidth : figure?.lineWidth);
  if (wide !== undefined) {
    const strokeWidth = width(
      style.strokeWidth,
      context.reference,
      wide,
      own !== undefined || context.frame,
    );
    if (strokeWidth !== style.strokeWidth) next = Object.freeze({ ...next, strokeWidth });
  }
  if (style.kind === "edge") {
    const scale = element?.arrowheadScale ?? figure?.arrowheadScale;
    if (scale !== undefined && scale !== 1)
      next = Object.freeze({ ...next, arrowheadScale: scale }) as ResolvedStyle;
  }
  return next;
}

/** The style with a corner radius (pt) on a node or group; edges have none. */
export function withRadius(style: ResolvedStyle, radiusPt: number | undefined): ResolvedStyle {
  if (radiusPt === undefined || style.kind === "edge") return style;
  return Object.freeze({ ...style, radius: length(radiusPt) });
}
