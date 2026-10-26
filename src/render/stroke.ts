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

/** Stroke attributes of a style (` stroke="…" stroke-width="…"` and dashes). */
export function strokeAttributes(style: CommonStyle, color = paint(style.stroke)): string {
  const width = style.strokeWidth.units;
  const dash = dashArray(width, style.strokeDash);
  return (
    ` stroke="${color}" stroke-width="${n(width)}"` +
    (dash === undefined ? "" : ` stroke-dasharray="${n(dash[0])},${n(dash[1])}"`)
  );
}
