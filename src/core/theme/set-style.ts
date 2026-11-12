/**
 * The style of a set enclosure (#407, design record 407). A set is not a
 * registry component: its paint comes from the theme's group frame
 * (`sumi/container`: line width, text size and weight, corner radius) and
 * the tone's line color (`toneLines.<tone>`, gray's without a tone) that the
 * outline, the fill and the label all take. The fill is mixed into white on
 * light canvases and into the canvas on dark ones, then painted opaque (#440).
 * Overlaps combine the tints relative to the canvas ({@link multiplyTints}).
 */

import type { SetVariant } from "../figure/schema";
import { resolveStyle } from "./resolve";
import type { Theme } from "./schema";
import type { ElementStrokes, FigureStrokes } from "./strokes";
import type { Color, CommonStyle, StyleLength } from "./style";
import type { Tone } from "./tones";

export interface SetStyle extends CommonStyle {
  readonly kind: "set";
  /** The opaque tint; `transparent` for an outlined set. */
  readonly fill: Color;
  /** The share of the line color in the tint (0 for an outlined set). */
  readonly strength: number;
  /** Corner radius of a `rect` set. */
  readonly radius: StyleLength;
}

/** Default strength of the tinted fill of a variant. */
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
  /** `fillOpacity` as written: the strength of the tint (#440), not a transparency. */
  readonly fillOpacity?: number | undefined;
  /** `figure.themeOverrides.nodeCorners: square`. */
  readonly square?: boolean | undefined;
  /** The figure's frame widths and corners (#427, `themeOverrides`). */
  readonly figure?: Pick<FigureStrokes, "frameWidth" | "cornerRadius"> | undefined;
  /** The set's own `lineWidth` and `cornerRadius` (#427), in pt. */
  readonly element?: Pick<ElementStrokes, "lineWidth" | "cornerRadius"> | undefined;
}

const HEX = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;

function channels(color: string): [number, number, number] | undefined {
  const long = color.replace(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i, "#$1$1$2$2$3$3");
  const m = HEX.exec(long);
  if (m === null) return undefined;
  return [
    Number.parseInt(m[1] as string, 16),
    Number.parseInt(m[2] as string, 16),
    Number.parseInt(m[3] as string, 16),
  ];
}

const hexOf = (c: readonly number[]): string =>
  `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

/**
 * The opaque color of `ink` mixed into `canvas` at `strength` (0 is canvas, 1 is
 * `ink`), painted opaque so it looks the same on any background (#440). A color
 * that is not `#rgb` / `#rrggbb` is returned as it is.
 */
export function tintOver(ink: string, strength: number, canvas = "#ffffff"): string {
  const c = channels(ink);
  const ground = channels(canvas);
  if (c === undefined || ground === undefined) return ink;
  return hexOf(c.map((v, i) => (ground[i] as number) + (v - (ground[i] as number)) * strength));
}

/** Preserve the historic white-ground treatment on light canvases. */
function darkCanvas(canvas: string): boolean {
  const c = channels(canvas);
  return c !== undefined && 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] < 128;
}

/**
 * The color where tints overlap: the multiply of the colors relative to white
 * (each channel's product over 255), so two pale fills give a darker one in
 * the hues of both instead of the gray-brown a stack of translucent fills
 * mixes to (#440). On dark canvases, add attenuated differences from the canvas.
 * Colors that are not hex are skipped.
 */
export function multiplyTints(colors: readonly string[], canvas = "#ffffff"): string {
  if (darkCanvas(canvas)) {
    const base = channels(canvas) as [number, number, number];
    const out = [...base];
    for (const color of colors) {
      const c = channels(color);
      if (c !== undefined)
        for (let i = 0; i < 3; i++) {
          const b = base[i] as number;
          const delta = (c[i] as number) - b;
          out[i] = (out[i] as number) + delta * 0.8;
        }
    }
    return hexOf(out.map((v) => Math.max(0, Math.min(255, v))));
  }
  let out: number[] = [255, 255, 255];
  for (const color of colors) {
    const c = channels(color);
    if (c !== undefined) out = out.map((v, i) => (v * (c[i] as number)) / 255);
  }
  return hexOf(out);
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
  const strength = options.fillOpacity ?? SET_FILL_OPACITY[variant];
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
    fill: tinted
      ? tintOver(ink, strength, darkCanvas(theme.canvas) ? theme.canvas : undefined)
      : "transparent",
    strength: tinted ? strength : 0,
    radius,
  });
}
