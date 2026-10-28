/**
 * The output size of a rendered figure against its profile's limits (#37):
 * the `size` field of `sumi render --json` and `sumi lint --geometry --json`.
 */

import { ptToMm } from "../core/units";
import type { SvgInspection } from "./inspect";

export interface OutputSize {
  /**
   * Width and height of the SVG (margin included), as written to its `width` /
   * `height`: the printed size, after `figure.fit: scale` (#183) if it shrank the figure.
   */
  widthPt: number;
  heightPt: number;
  /** The same in mm, rounded to 0.01. */
  widthMm: number;
  heightMm: number;
  /**
   * The factor `figure.fit: scale` (#183) shrank the figure by (printed ÷
   * natural size, rounded to 0.0001). Absent when it is printed at its natural size.
   */
  scale?: number;
  /** The profile's limits (mm rounded to 0.01); `null` = no limit. */
  profile: {
    id: string;
    maxWidthMm: number | null;
    maxHeightMm: number | null;
    minFontSizePt: number;
  };
  /**
   * `true` if the width and height are within the profile's page limits
   * (compared unrounded, as `geometry/exceeds-page-width` / `-height` do).
   * Font sizes are not part of it; they are reported as diagnostics.
   */
  fits: boolean;
}

/** Slack for comparing physical sizes in pt (as in the geometry rules). */
const PT_EPSILON = 1e-6;

const mm = (pt: number): number => Math.round(ptToMm(pt) * 100) / 100;

/**
 * The printed size of an inspected SVG in pt: its canvas times the
 * `figure.fit: scale` factor (#183), i.e. the root's `width` / `height`.
 */
export function printedSize(inspection: Pick<SvgInspection, "canvas" | "scale">): {
  widthPt: number;
  heightPt: number;
  scale: number;
} {
  const scale = inspection.scale ?? 1;
  return {
    widthPt: inspection.canvas.width.pt * scale,
    heightPt: inspection.canvas.height.pt * scale,
    scale,
  };
}

/** The output size of an inspected SVG and its profile's limits. */
export function outputSize(
  inspection: Pick<SvgInspection, "canvas" | "profile" | "scale">,
): OutputSize {
  const { profile } = inspection;
  const { widthPt, heightPt } = printedSize(inspection);
  const within = (value: number, limit: number | undefined) =>
    limit === undefined || value <= limit + PT_EPSILON;
  return {
    widthPt,
    heightPt,
    widthMm: mm(widthPt),
    heightMm: mm(heightPt),
    ...(inspection.scale !== undefined && {
      scale: Math.round(inspection.scale * 10000) / 10000,
    }),
    profile: {
      id: profile.id,
      maxWidthMm: profile.maxWidthPt === undefined ? null : mm(profile.maxWidthPt),
      maxHeightMm: profile.maxHeightPt === undefined ? null : mm(profile.maxHeightPt),
      minFontSizePt: profile.minFontSizePt,
    },
    fits: within(widthPt, profile.maxWidthPt) && within(heightPt, profile.maxHeightPt),
  };
}
