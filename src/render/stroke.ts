/**
 * Paint helpers shared by the structured SVG writer (#91) and the drawing of
 * icons and images (#94), so both write numbers, colors and dashes the same
 * way.
 */

import type { CommonStyle } from "../core/theme/style";

/**
 * Formats a coordinate: at most 6 decimals (Layout IR coordinates have 3, and
 * centers / radii derived from them by halving 4, so shapes keep their exact
 * bounds), no exponent for the sizes used, never `-0`.
 */
export const n = (value: number): string => String(Number(value.toFixed(6)) || 0);

/** `transparent` is written as `none` (every SVG consumer reads it). */
export const paint = (color: string): string => (color === "transparent" ? "none" : color);

/**
 * D2's dash pattern for a dash level (`style.stroke-dash`, 0–10) at a stroke
 * width, so dashed lines look the same with both engines.
 */
export function dashArray(strokeWidth: number, dash: number): [number, number] | undefined {
  if (dash <= 0 || strokeWidth <= 0) return undefined;
  const scale = Math.log10(-0.6 * strokeWidth + 10.6) * 0.5 + 0.5;
  const dashSize = strokeWidth * dash;
  return [dashSize, scale * dashSize];
}

/**
 * The distance between the centers of two dots of a dotted line (#427), in
 * stroke widths: a dot is one stroke width across, so the gap is two. Dense
 * enough to read as a line, open enough that single dots stay apart at print
 * sizes (the dotted lines of the TriCL figure measure about 3).
 */
export const DOT_PERIOD = 3;

/**
 * The dash array of a style: round dots (a zero-length dash, spaced
 * {@link DOT_PERIOD} stroke widths apart; the line needs round caps, see
 * {@link strokeCap}) for `strokeDotted`, else D2's dashes.
 */
export function strokePattern(style: CommonStyle): [number, number] | undefined {
  const width = style.strokeWidth.units;
  if (style.strokeDotted === true) return width > 0 ? [0, DOT_PERIOD * width] : undefined;
  return dashArray(width, style.strokeDash);
}

/** ` stroke-dasharray="…"` of a style, or nothing for a solid line. */
export function dashAttribute(style: CommonStyle): string {
  const dash = strokePattern(style);
  return dash === undefined ? "" : ` stroke-dasharray="${n(dash[0])},${n(dash[1])}"`;
}

/** ` stroke-linecap="round"` of a dotted style (its dots are round caps), else nothing. */
export const strokeCap = (style: CommonStyle): string =>
  style.strokeDotted === true ? ' stroke-linecap="round"' : "";

/** Stroke attributes of a style (` stroke="…" stroke-width="…"`, dashes and round dots). */
export function strokeAttributes(style: CommonStyle, color = paint(style.stroke)): string {
  return (
    ` stroke="${color}" stroke-width="${n(style.strokeWidth.units)}"` +
    dashAttribute(style) +
    strokeCap(style)
  );
}
