/**
 * The output size of a rendered figure against its profile's limits (#37):
 * the `size` field of `sumi render --json` and `sumi lint --geometry --json`.
 */

import { ptToMm } from "../core/units";
import type { SvgInspection } from "./inspect";

export interface OutputSize {
  /** Width and height of the SVG (margin included), as written to its `width` / `height`. */
  widthPt: number;
  heightPt: number;
  /** The same in mm, rounded to 0.01. */
  widthMm: number;
  heightMm: number;
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

/** The output size of an inspected SVG and its profile's limits. */
export function outputSize(inspection: Pick<SvgInspection, "canvas" | "profile">): OutputSize {
  const { canvas, profile } = inspection;
  const within = (value: number, limit: number | undefined) =>
    limit === undefined || value <= limit + PT_EPSILON;
  return {
    widthPt: canvas.width.pt,
    heightPt: canvas.height.pt,
    widthMm: mm(canvas.width.pt),
    heightMm: mm(canvas.height.pt),
    profile: {
      id: profile.id,
      maxWidthMm: profile.maxWidthPt === undefined ? null : mm(profile.maxWidthPt),
      maxHeightMm: profile.maxHeightPt === undefined ? null : mm(profile.maxHeightPt),
      minFontSizePt: profile.minFontSizePt,
    },
    fits:
      within(canvas.width.pt, profile.maxWidthPt) && within(canvas.height.pt, profile.maxHeightPt),
  };
}
