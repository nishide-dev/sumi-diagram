/**
 * The style of a set enclosure (#407, design record 407). A set is not a
 * registry component: its paint comes from the theme's group frame
 * (`sumi/container`: line width, text size and weight, corner radius) and
 * the tone's line color (`toneLines.<tone>`, gray's without a tone) that the
 * outline, the translucent fill and the label all take. Because the tint is
 * the line color at low opacity, it shows in every theme, also the
 * monochrome ones, and two overlapping sets mix to a darker color.
 */

import type { SetVariant } from "../figure/schema";
import { resolveStyle } from "./resolve";
import type { Theme } from "./schema";
import type { ElementStrokes, FigureStrokes } from "./strokes";
import type { Color, CommonStyle, StyleLength } from "./style";
import type { Tone } from "./tones";

export interface SetStyle extends CommonStyle {
  readonly kind: "set";
  /** The tint; `transparent` for an outlined set. */
  readonly fill: Color;
  /** Opacity of the tint alone (the outline and the label stay opaque). */
  readonly fillOpacity: number;
  /** Corner radius of a `rect` set. */
  readonly radius: StyleLength;
}

/** Default opacity of the tinted fill of a variant. */
export const SET_FILL_OPACITY: Readonly<Record<SetVariant, number>> = {
  default: 0.2,
  filled: 0.28,
  outlined: 0,
  dashed: 0.2,
  dotted: 0.2,
};

export interface SetStyleOptions {
  readonly variant: SetVariant;
  readonly tone?: Tone | undefined;
  /** `fillOpacity` as written. */
  readonly fillOpacity?: number | undefined;
  /** `figure.themeOverrides.nodeCorners: square`. */
  readonly square?: boolean | undefined;
  /** The figure's frame widths and corners (#427, `themeOverrides`). */
  readonly figure?: Pick<FigureStrokes, "frameWidth" | "cornerRadius"> | undefined;
  /** The set's own `lineWidth` and `cornerRadius` (#427), in pt. */
  readonly element?: Pick<ElementStrokes, "lineWidth" | "cornerRadius"> | undefined;
}

/** Resolves the style of a set under `theme` (already carrying the figure's tone overrides). */
export function resolveSetStyle(theme: Theme, options: SetStyleOptions): SetStyle {
  const { variant, tone } = options;
  const frame = resolveStyle(theme, {
    kind: "group",
    id: "sumi/container",
    variant: "default",
  }).style;
  const dashed = resolveStyle(theme, {
    kind: "group",
    id: "sumi/container",
    variant: "dashed",
  }).style;
  const line = theme.toneLines.get(tone ?? "gray");
  const ink = line?.stroke ?? frame.stroke;
  const outlined = variant !== "filled";
  const tinted = variant !== "outlined";
  const zero: StyleLength = { pt: 0, units: 0 };
  const own = options.element?.lineWidth;
  const wide = options.figure?.frameWidth;
  const radiusPt = options.element?.cornerRadius ?? options.figure?.cornerRadius;
  // The set's own width always draws; the figure's replaces a frame the theme draws (a borderless one has none).
  const strokeWidth =
    own !== undefined
      ? { pt: own, units: own * 2 }
      : wide !== undefined && frame.strokeWidth.units > 0
        ? { pt: wide, units: wide * 2 }
        : frame.strokeWidth;
  const radius: StyleLength =
    options.square === true && options.element?.cornerRadius === undefined
      ? zero
      : radiusPt === undefined
        ? frame.radius
        : { pt: radiusPt, units: radiusPt * 2 };
  return Object.freeze({
    kind: "set",
    stroke: outlined ? ink : "transparent",
    strokeWidth: outlined ? strokeWidth : zero,
    strokeDash: variant === "dashed" ? Math.max(1, dashed.strokeDash) : 0,
    ...(variant === "dotted" && { strokeDotted: true as const }),
    opacity: 1,
    fontSize: frame.fontSize,
    fontColor: line?.fontColor ?? ink,
    bold: frame.bold,
    italic: frame.italic,
    mono: frame.mono,
    fill: tinted ? ink : "transparent",
    fillOpacity: tinted ? (options.fillOpacity ?? SET_FILL_OPACITY[variant]) : 0,
    radius,
  });
}
