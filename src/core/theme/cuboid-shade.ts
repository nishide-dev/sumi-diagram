/**
 * Face colors of a cuboid (#575): the top and side faces are the front's fill
 * mixed toward a target by a fixed fraction, so no color is added to a tone.
 * A light theme lights the top (toward white) and darkens the side (toward the
 * frame); a dark one lights the top toward the frame and darkens the side
 * toward a deeper shade of its canvas. A theme may write its own factors.
 */
import { luminance } from "./node-variants";
import type { Theme } from "./schema";

/** `line` is the frame's color; a `#RRGGBB` is that color. */
export interface CuboidShadeTarget {
  readonly toward: "line" | string;
  /** The fraction of the way from the fill to the target, 0 to 1. */
  readonly amount: number;
}
export interface CuboidShade {
  readonly top: CuboidShadeTarget;
  readonly side: CuboidShadeTarget;
}

/** Inner edges are the frame mixed this far toward the fill, at half the frame's width. */
export const INNER_EDGE_MIX = 0.55;
export const INNER_EDGE_WIDTH = 0.5;

const channels = (hex: string): [number, number, number] => [
  Number.parseInt(hex.slice(1, 3), 16),
  Number.parseInt(hex.slice(3, 5), 16),
  Number.parseInt(hex.slice(5, 7), 16),
];

const HEX = /^#[0-9a-fA-F]{6}$/;

/** `a` moved the fraction `t` of the way to `b`. */
export function mixColors(a: string, b: string, t: number): string {
  const [ca, cb] = [channels(a), channels(b)];
  return `#${ca
    .map((v, i) =>
      Math.round(v + ((cb[i] as number) - v) * t)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/** The theme's factors: its own `cuboidShade`, else the light or dark default by its canvas. */
export function cuboidShadeOf(theme: Pick<Theme, "canvas" | "cuboidShade">): CuboidShade {
  if (theme.cuboidShade !== undefined) return theme.cuboidShade;
  if (luminance(theme.canvas) < 0.2) {
    return {
      top: { toward: "line", amount: 0.22 },
      side: { toward: mixColors(theme.canvas, "#000000", 0.4), amount: 0.35 },
    };
  }
  return { top: { toward: "#ffffff", amount: 0.55 }, side: { toward: "line", amount: 0.2 } };
}

export interface CuboidColors {
  readonly top: string;
  readonly side: string;
  readonly inner: string;
}

/** The face and inner-edge colors of a front `fill` framed by `line`; undefined unless both are colors. */
export function cuboidColors(
  fill: string,
  line: string,
  shade: CuboidShade,
): CuboidColors | undefined {
  if (!HEX.test(fill)) return undefined;
  const frame = HEX.test(line) ? line : fill;
  const target = ({ toward }: CuboidShadeTarget) => (toward === "line" ? frame : toward);
  return {
    top: mixColors(fill, target(shade.top), shade.top.amount),
    side: mixColors(fill, target(shade.side), shade.side.amount),
    inner: mixColors(frame, fill, INNER_EDGE_MIX),
  };
}
