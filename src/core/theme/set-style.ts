/**
 * The style of a set enclosure (#407, design record 407). A set is not a
 * registry component: its paint comes from the theme's group frame
 * (`sumi/container`: line width, text size and weight, corner radius) and
 * the tone's line color (`toneLines.<tone>`, gray's without a tone) that the
 * outline, the fill and the label all take. The fill is mixed into white on
 * light canvases and into the canvas on dark ones, then painted opaque (#440).
 * Overlaps combine the tints relative to the canvas ({@link overlapTint}).
 */

import type { SetVariant, TextRole } from "../figure/schema";
import { deltaE, fromOklch, toOklch } from "./color-math";
import { resolveStyle } from "./resolve";
import type { Theme } from "./schema";
import type { ElementStrokes, FigureStrokes } from "./strokes";
import { type Color, type CommonStyle, mergeStyle, type StyleLength } from "./style";
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
  /** The figure's frame widths and corners (#427, `themeOverrides`); `groupStroke` for a `panel` outline. */
  readonly figure?:
    | (Pick<FigureStrokes, "frameWidth" | "cornerRadius"> & {
        readonly groupStroke?: string | undefined;
      })
    | undefined;
  /**
   * Outline the set as the theme draws a group's frame (#645): the stroke and width of
   * the container's default variant (`sumi`'s pale hairline), no fill. A theme whose
   * panels have no frame (`llama`) gives its frame color at the thin line width.
   * Only for an outlined set without a tone, e.g. a sequence fragment written without
   * `variant` and `tone`.
   */
  readonly panel?: boolean | undefined;
  /** The set's own `lineWidth` and `cornerRadius` (#427), in pt. */
  readonly element?: Pick<ElementStrokes, "lineWidth" | "cornerRadius"> | undefined;
  /** The label's size as a role of the theme's text (#614); omitted means the group title's. */
  readonly text?: TextRole | undefined;
  /** The label's weight (#614); omitted means the group title's. */
  readonly weight?: "regular" | "bold" | undefined;
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

/** Mix opaque set tints as their perceptual (OKLCH) average; `canvas` is the result of no tint. */
export function mixTints(colors: readonly string[], canvas = "#ffffff"): string {
  const values = colors.filter((color) => channels(color) !== undefined).map(toOklch);
  if (values.length === 0) return canvas;
  const mean = (f: (value: (typeof values)[number]) => number) =>
    values.reduce((sum, value) => sum + f(value), 0) / values.length;
  // A neutral has no meaningful hue; its numerical OKLCH angle is noise.
  const hues = values.filter((value) => value.c >= 0.005);
  const x = hues.reduce((sum, v) => sum + Math.cos((v.h * Math.PI) / 180), 0);
  const y = hues.reduce((sum, v) => sum + Math.sin((v.h * Math.PI) / 180), 0);
  const h = Math.hypot(x, y) < 1e-10 ? 0 : (Math.atan2(y, x) * 180) / Math.PI;
  const mixed = { l: mean((v) => v.l), c: mean((v) => v.c), h: (h + 360) % 360 };
  const result = fromOklch(mixed);
  if (values.length < 3) return result;
  // The average of three or more tints can land on one of them (#547): the
  // overlap then reads as that set alone. Move its lightness, first away from
  // the canvas, then the other way, until it differs from every tint by
  // MIN_OVERLAP_DELTA_E. Best effort: where no shift within the cap gets there
  // (a tint at the edge of the gamut, say), the candidate farthest from its
  // nearest tint is returned.
  const inks = colors.filter((color) => channels(color) !== undefined);
  const away = darkCanvas(canvas) ? 1 : -1;
  const nearest = (candidate: string) => Math.min(...inks.map((ink) => deltaE(candidate, ink)));
  let best = result;
  let bestGap = nearest(result);
  if (bestGap >= MIN_OVERLAP_DELTA_E) return result;
  for (let step = 1; step <= OVERLAP_SEPARATION_STEPS; step++) {
    for (const direction of [away, -away]) {
      const candidate = fromOklch({ ...mixed, l: mixed.l + direction * step * 0.005 });
      const gap = nearest(candidate);
      if (gap >= MIN_OVERLAP_DELTA_E) return candidate;
      if (gap > bestGap) {
        best = candidate;
        bestGap = gap;
      }
    }
  }
  return best;
}

/** Smallest CIE76 difference (#547) between a three-or-more-way overlap and any tint in it. */
export const MIN_OVERLAP_DELTA_E = 5;
/** The most the overlap's OKLCH lightness is moved for it, either way: 16 steps of 0.005. */
const OVERLAP_SEPARATION_STEPS = 16;

/** A multiply preference on any participating set preserves its legacy intersection. */
export function overlapTint(
  sets: readonly { readonly style: SetStyle; readonly overlap?: "mix" | "multiply" }[],
  canvas = "#ffffff",
): string {
  const colors = sets.map((set) => set.style.fill);
  return sets.some((set) => set.overlap === "multiply")
    ? multiplyTints(colors, canvas)
    : mixTints(colors, canvas);
}

/**
 * The size of a set's label for a text role (#614): `heading` (the default) is
 * the group title's, `body` a box's text, `small` the theme's small (edge)
 * text and `large` 1.5 times a box's text, as a node's `text`.
 */
function setFontSize(theme: Theme, heading: StyleLength, text: TextRole | undefined): StyleLength {
  if (text === undefined || text === "heading") return heading;
  const sized = (kind: "node" | "edge", id: "sumi/box" | "sumi/line") =>
    resolveStyle(theme, { kind, id, variant: "default" }).style.fontSize;
  const body = sized("node", "sumi/box");
  if (text === "body") return body;
  if (text === "small") return sized("edge", "sumi/line");
  const units = Math.round(body.units * 1.5);
  return { pt: units / 2, units };
}

/**
 * The frame the theme draws around a group (#645): the container's default variant,
 * with `themeOverrides.groupStroke`. A theme that draws no frame there (its panels are
 * fills) gives the frame's color at its thin line (`line.frame`, else `line.thin`, else
 * 0.5pt), so the outline stays visible without a fill.
 */
function panelOutline(
  theme: Theme,
  groupStroke: string | undefined,
): { stroke: Color; strokeWidth: StyleLength } {
  const group = resolveStyle(theme, {
    kind: "group",
    id: "sumi/container",
    variant: "default",
  }).style;
  const stroke = groupStroke ?? group.stroke;
  if (group.strokeWidth.units > 0) return { stroke, strokeWidth: group.strokeWidth };
  const token = theme.tokens.get("line.frame") ?? theme.tokens.get("line.thin");
  const pt = token?.type === "length" ? token.value.pt : 0.5;
  return { stroke, strokeWidth: { pt, units: Math.round(pt * 2) } };
}

/** Resolves the style of a set under `theme` (already carrying the figure's tone overrides). */
export function resolveSetStyle(theme: Theme, options: SetStyleOptions): SetStyle {
  const { variant, tone } = options;
  // The theme's group base, not the container's own layers: a set is an outline that carries a
  // category, not a panel, so it keeps its weight where a theme draws quiet panel frames (#634).
  const frame = mergeStyle("group", [theme.base.group]);
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
  const panel = options.panel === true && variant === "outlined" && tone === undefined;
  const panelFrame = panel ? panelOutline(theme, options.figure?.groupStroke) : undefined;
  const radius: StyleLength =
    options.square === true && options.element?.cornerRadius === undefined
      ? zero
      : radiusPt === undefined
        ? frame.radius
        : { pt: radiusPt, units: radiusPt * 2 };
  return Object.freeze({
    kind: "set",
    stroke: panelFrame?.stroke ?? (outlined ? ink : "transparent"),
    // A panel frame always draws (#645): the set's or the figure's width replaces the
    // theme's, including the visible fallback of a theme whose panels have no frame.
    strokeWidth:
      panelFrame !== undefined
        ? own !== undefined
          ? { pt: own, units: own * 2 }
          : wide !== undefined
            ? { pt: wide, units: wide * 2 }
            : panelFrame.strokeWidth
        : outlined
          ? strokeWidth
          : zero,
    strokeDash: variant === "dashed" ? Math.max(1, dashed.strokeDash) : 0,
    ...(variant === "dotted" && { strokeDotted: true as const }),
    opacity: 1,
    fontSize: setFontSize(theme, frame.fontSize, options.text),
    fontColor: line?.fontColor ?? ink,
    bold: options.weight === undefined ? frame.bold : options.weight === "bold",
    italic: frame.italic,
    mono: frame.mono,
    fill: tinted
      ? tintOver(ink, strength, darkCanvas(theme.canvas) ? theme.canvas : undefined)
      : "transparent",
    strength: tinted ? strength : 0,
    radius,
  });
}
