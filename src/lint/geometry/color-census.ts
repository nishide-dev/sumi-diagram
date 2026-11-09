/**
 * The colors a figure paints (#423): every fill and line of its groups, nodes,
 * edges, set enclosures and glyph marks as drawn (the style resolved against
 * the figure's theme, palette and tone overrides), in OKLCH. The input of the
 * `geometry/color-harmony` rule.
 */

import type { ElementIR, FigureIR } from "../../compiler/ir";
import { type Oklch, toOklch } from "../../core/theme/color-math";

/** What a painted color is used for. */
export type PaintRole =
  /** A pale area of a node: its fill, a glyph mark. */
  | "fill"
  /** The background of a group: a panel tint, kept apart from the fills it holds. */
  | "panel"
  /** A dark color: a frame, an edge, text, a solid fill. */
  | "line";

export interface PaintedColor {
  /** `#rrggbb`. */
  readonly color: string;
  readonly role: PaintRole;
  readonly oklch: Oklch;
  /** Where it is painted, for messages: `node "attn" fill`. */
  readonly where: string;
}

/** Below this OKLCH chroma a color reads as neutral (gray, black, white): it takes no part in harmony. */
export const NEUTRAL_CHROMA = 0.025;
/** A fill at or above this OKLCH lightness is a pale area; a darker one (a solid fill) counts as a line color. */
export const PALE_LIGHTNESS = 0.7;

const HEX3 = /^#[0-9a-f]{3}$/i;
const HEX6 = /^#[0-9a-f]{6}$/i;

/** `#rgb` / `#rrggbb` as `#rrggbb`; `transparent` and anything else as `undefined`. */
function hex(color: string | undefined): string | undefined {
  if (color === undefined) return undefined;
  if (HEX3.test(color)) return `#${[...color.slice(1)].map((c) => c + c).join("")}`.toLowerCase();
  return HEX6.test(color) ? color.toLowerCase() : undefined;
}

function name(element: ElementIR): string {
  if (element.kind === "edge") return `edge "${element.id ?? `edges[${element.index}]`}"`;
  return `${element.kind} "${element.id}"`;
}

/** Every color the figure paints, in document order (groups, nodes, edges, sets). */
export function paintedColors(ir: FigureIR): PaintedColor[] {
  const out: PaintedColor[] = [];
  const add = (color: string | undefined, role: PaintRole | "area", where: string) => {
    const value = hex(color);
    if (value === undefined) return;
    const oklch = toOklch(value);
    const resolved: PaintRole =
      role === "area" ? (oklch.l >= PALE_LIGHTNESS ? "fill" : "line") : role;
    out.push({ color: value, role: resolved, oklch, where });
  };
  for (const element of ir.elements.values()) {
    const { style } = element;
    if (element.kind === "edge") {
      add(style.stroke, "line", `${name(element)} line`);
      continue;
    }
    // A frame is painted only when it has a width; a label's or a junction's fill is transparent.
    add(style.fill, element.kind === "group" ? "panel" : "area", `${name(element)} fill`);
    if (style.strokeWidth.units > 0) add(style.stroke, "line", `${name(element)} frame`);
    if (element.kind === "node") {
      for (const glyph of element.glyphs ?? []) {
        for (const part of glyph.parts) add(part.fill, "area", `${name(element)} glyph`);
      }
    }
  }
  // A set's tint is its outline color mixed into white: only the outline is a choice of color.
  for (const set of ir.sets ?? []) {
    if (set.style.strokeWidth.units > 0) add(set.style.stroke, "line", `set "${set.id}" outline`);
  }
  return out;
}
