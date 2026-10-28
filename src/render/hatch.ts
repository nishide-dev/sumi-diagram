/**
 * Hatching (#180, design doc §6.56): the diagonal lines a hatched matrix cell
 * or legend sample box draws over its fill. They are explicit line segments,
 * computed here from the node's rectangle and clipped to its (rounded)
 * outline, not an SVG `<pattern>` or a clip path: every consumer of the SVG
 * (the PDF engine, the picture PPTX's renderer, the editable PPTX, which
 * writes them as a line shape) then draws the very same segments, and none
 * depends on pattern support or tiling phase.
 */

import type { Point, Rect } from "../layout/ir";

/**
 * Hatch geometry in SVG units (0.5pt): lines rising to the right (45°),
 * `period` apart along the x axis (so `period / √2` apart across), `width`
 * thick with round caps. Fixed, like the size of a junction's dot: a hatch
 * reads as a texture, not as data.
 */
export const HATCH = Object.freeze({ period: 5, width: 1 });

/** Segments shorter than this (units) are left out: specks at a rounded corner. */
const MIN_LENGTH = 0.5;

/** `[from, to]` of `x` on the line `x + y = k` inside the axis-parallel box, or `undefined`. */
function boxSpan(
  k: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
): [number, number] | undefined {
  if (right < left || bottom < top) return undefined;
  const from = Math.max(left, k - bottom);
  const to = Math.min(right, k - top);
  return from <= to ? [from, to] : undefined;
}

/** `[from, to]` of `x` on the line `x + y = k` inside the disk, or `undefined`. */
function diskSpan(k: number, cx: number, cy: number, r: number): [number, number] | undefined {
  // With u = x − cx and m = k − cx − cy: u² + (m − u)² ≤ r².
  const m = k - cx - cy;
  const d = 2 * r * r - m * m;
  if (d < 0) return undefined;
  const root = Math.sqrt(d);
  return [cx + (m - root) / 2, cx + (m + root) / 2];
}

/**
 * The hatch segments of a rectangle with corner radius `radius`, kept
 * `inset` inside its outline (half the outline's width plus half a hatch
 * line, so round caps end at the outline's inner edge). Each segment runs
 * from its lower-left to its upper-right end; the lines are centered in the
 * rectangle, so equal rectangles get equal hatching wherever they are.
 */
export function hatchSegments(
  rect: Rect,
  radius: number,
  inset: number,
  period = HATCH.period,
): [Point, Point][] {
  const left = rect.x + inset;
  const top = rect.y + inset;
  const right = rect.x + rect.width - inset;
  const bottom = rect.y + rect.height - inset;
  if (right <= left || bottom <= top) return [];
  const r = Math.max(0, Math.min(radius - inset, (right - left) / 2, (bottom - top) / 2));
  // The inset outline as the union of two boxes and four corner disks (one
  // box when the corners are square): convex, so the union of a line's spans
  // is one span.
  const pieces = (k: number) =>
    r === 0
      ? [boxSpan(k, left, top, right, bottom)]
      : [
          boxSpan(k, left + r, top, right - r, bottom),
          boxSpan(k, left, top + r, right, bottom - r),
          diskSpan(k, left + r, top + r, r),
          diskSpan(k, right - r, top + r, r),
          diskSpan(k, left + r, bottom - r, r),
          diskSpan(k, right - r, bottom - r, r),
        ];
  // Lines x + y = k from the top-left corner (k = left + top) to the bottom-right one.
  const span = right - left + (bottom - top);
  const count = Math.floor(span / period);
  const first = left + top + (span - (count - 1) * period) / 2;
  const segments: [Point, Point][] = [];
  for (let i = 0; i < count; i++) {
    const k = first + i * period;
    let from = Number.POSITIVE_INFINITY;
    let to = Number.NEGATIVE_INFINITY;
    for (const piece of pieces(k)) {
      if (piece === undefined) continue;
      from = Math.min(from, piece[0]);
      to = Math.max(to, piece[1]);
    }
    if (!(to - from >= MIN_LENGTH / Math.SQRT2)) continue;
    segments.push([
      { x: from, y: k - from },
      { x: to, y: k - to },
    ]);
  }
  return segments;
}
