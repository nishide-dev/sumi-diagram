/**
 * Color scales of matrices (#644): a sequential ramp of one tone, from a pale
 * tint (the tone's `filled` fill, halfway to the canvas) to the tone's `solid`
 * fill, mixed in OKLab so the steps look evenly spaced. The text on a step is
 * one of the theme's two inks for the tone (the `filled` text and the `solid`
 * text) that keeps 4.5:1 on it, or the nearest readable ink (see
 * {@link rampInk}), so the ramp stays readable in light and dark themes
 * without colors of its own. Design: docs/design/decisions/644-matrix-scale-span.md.
 */

import { fromOklch, toOklab } from "./color-math";
import { expandColor, lightenColor } from "./dim";
import { contrastRatio, luminance, readableInk } from "./node-variants";
import type { Color, NodeStyle } from "./style";

/** How far the pale end moves the tone's fill toward the canvas. */
export const RAMP_LOW_LIGHTEN = 0.5;

/** The ends of a ramp and the inks drawn on it, as `#rrggbb`. */
export interface RampEnds {
  /** At 0: the tone's filled fill, halfway to the canvas. */
  readonly low: string;
  /** At 1: the tone's solid fill. */
  readonly high: string;
  /** The text of a filled node of the tone (on pale steps). */
  readonly ink: string;
  /** The text of a solid node of the tone (on strong steps). */
  readonly inverse: string;
}

const HEX = /^#[0-9a-f]{6}$/;

/**
 * The ends of the ramp of a tone, from its `filled` and `solid` node styles
 * on `canvas`. A fill that is no color (transparent) falls back to the canvas
 * at the pale end and to the line color at the strong end.
 */
export function rampEnds(filled: NodeStyle, solid: NodeStyle, canvas: Color): RampEnds {
  const ground = expandColor(canvas);
  const pale = filled.fill === "transparent" ? ground : expandColor(filled.fill);
  const low = lightenColor(pale, RAMP_LOW_LIGHTEN, ground);
  const strong = solid.fill === "transparent" ? solid.stroke : solid.fill;
  const high = strong === "transparent" ? expandColor(filled.stroke) : expandColor(strong);
  const ink = expandColor(filled.fontColor);
  const inverse = expandColor(solid.fontColor);
  return { low, high, ink, inverse };
}

/** The color at `t` (0 to 1) between `low` and `high`, mixed in OKLab. */
export function rampColor(low: string, high: string, t: number): string {
  if (!HEX.test(low) || !HEX.test(high)) return t < 0.5 ? low : high;
  if (t <= 0) return low;
  if (t >= 1) return high;
  const a = toOklab(low);
  const b = toOklab(high);
  const [l, x, y] = a.map((v, i) => v + ((b[i] as number) - v) * t) as [number, number, number];
  const c = Math.hypot(x, y);
  const h = c < 1e-4 ? 0 : ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return fromOklch({ l, c, h });
}

/** The contrast the text on a step keeps (#644), as body text (WCAG AA). */
export const RAMP_TEXT_CONTRAST = 4.5;

/**
 * The ink that reads on `fill`: the pale-step ink, else the strong-step ink,
 * while one keeps {@link RAMP_TEXT_CONTRAST}; on a middle step where neither
 * does, the darker of the two darkened until it does, or white if that reads
 * better.
 */
export function rampInk(ends: RampEnds, fill: string): string {
  if (!HEX.test(fill) || !HEX.test(ends.ink) || !HEX.test(ends.inverse)) return ends.ink;
  const inks = [ends.ink, ends.inverse];
  const readable = inks.find((ink) => contrastRatio(ink, fill) >= RAMP_TEXT_CONTRAST);
  if (readable !== undefined) return readable;
  const dark = luminance(ends.ink) <= luminance(ends.inverse) ? ends.ink : ends.inverse;
  const darkened = readableInk(fill, dark, RAMP_TEXT_CONTRAST);
  // Black or white always keeps 4.5:1 on one side: white where even black does not.
  return [...inks, darkened, "#ffffff"].reduce((a, b) =>
    contrastRatio(b, fill) > contrastRatio(a, fill) ? b : a,
  );
}

/** A node drawn at step `t` of the ramp `ends`: its fill and text; outline and size kept. */
export function rampStyle<S extends NodeStyle>(style: S, ends: RampEnds, t: number): S {
  const fill = rampColor(ends.low, ends.high, t);
  return Object.freeze({ ...style, fill, fontColor: rampInk(ends, fill) });
}
