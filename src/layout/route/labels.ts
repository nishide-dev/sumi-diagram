/**
 * Edge labels (#90): placed after routing, next to the arrowhead on the last
 * segment (the reference figures label adaLN taps this way; #86 prototype
 * `edge-labels.ts`). A label keeps clear of the routes (#116): when the
 * last segment is too short for it, it moves to the other side of that
 * segment, past a trunk or corner, or beside the segment before. It keeps
 * off group borders and node boxes where it can; what remains is reported
 * by the checks (`geometry/label-collision`), not resolved.
 */

import type { EdgeIR } from "../../compiler/ir";
import type { Point, Rect, TextLayout, TextMetrics } from "../ir";
import { placeText } from "../structured/engine";

/** Space between a label and its line, and between the label and the arrowhead, in units. */
export const EDGE_LABEL_GAP = 3;

/** A place for a label: its center. */
interface Candidate {
  readonly center: Point;
}

/**
 * The center of a `w × h` label beside the segment from `prev` to `tip`, on
 * `side` (+1: above a horizontal segment / right of a vertical one; -1: the
 * other side), its near end `back` units behind `tip` along the segment
 * (negative: past it).
 */
function beside(
  prev: Point,
  tip: Point,
  w: number,
  h: number,
  back: number,
  side: 1 | -1,
): Candidate {
  const g = EDGE_LABEL_GAP;
  if (Math.abs(prev.y - tip.y) < 1e-9) {
    const dir = Math.sign(tip.x - prev.x) || 1;
    const x = dir > 0 ? tip.x - back - w : tip.x + back;
    const y = side > 0 ? tip.y - g - h : tip.y + g;
    return { center: { x: x + w / 2, y: y + h / 2 } };
  }
  const dir = Math.sign(tip.y - prev.y) || 1;
  const y = dir > 0 ? tip.y - back - h : tip.y + back;
  const x = side > 0 ? tip.x + g : tip.x - g - w;
  return { center: { x: x + w / 2, y: y + h / 2 } };
}

const boxOf = (center: Point, w: number, h: number): Rect => ({
  x: center.x - w / 2,
  y: center.y - h / 2,
  width: w,
  height: h,
});

/** The open rectangles overlap (touching does not count). */
const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** The segment from `a` to `b` as a rectangle (zero width or height). */
const segmentRect = (a: Point, b: Point): Rect => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  width: Math.abs(a.x - b.x),
  height: Math.abs(a.y - b.y),
});

/** `rect` grown by `d` on every side. */
const grow = (rect: Rect, d: number): Rect => ({
  x: rect.x - d,
  y: rect.y - d,
  width: rect.width + 2 * d,
  height: rect.height + 2 * d,
});

/** What an edge label keeps clear of, besides its own route (#116). */
export interface EdgeLabelSurroundings {
  /** The routes of the other edges: the label keeps the gap from them. */
  readonly routes?: readonly (readonly Point[])[];
  /** Node boxes: a place clear of them is preferred. */
  readonly nodes?: readonly Rect[];
  /** Group boxes: a place the gap away from their borders is preferred. */
  readonly groups?: readonly Rect[];
}

/**
 * Places `metrics` beside the route:
 * - with an arrowhead at the target (or else at the source), on that end's
 *   last segment, just behind the arrowhead (`arrowhead` units long):
 *   above a horizontal segment, right of a vertical one. If that place comes
 *   closer than the gap to a route (its own earlier segments when the last
 *   segment is shorter than the label, or another edge's) or to a group's
 *   border (#116), the label moves: to the other side, or back along the
 *   last segment just past a route or border that runs across it (up to just
 *   past the corner the segment starts at), nearest to the arrowhead first;
 *   else beside the segment before, on the side facing away from the last
 *   segment, next to the corner. Of the places clear of the routes, it takes
 *   the first also clear of borders and node boxes, else of node boxes (a
 *   label over a node hides more than one on a border), else any; if none
 *   is clear of the routes, the first place;
 * - without arrowheads, at the middle of the longest segment, on the same side.
 */
export function placeEdgeLabel(
  metrics: TextMetrics,
  points: readonly Point[],
  edge: EdgeIR,
  arrowhead: number,
  surroundings: EdgeLabelSurroundings = {},
): TextLayout {
  const atSource = edge.targetArrowhead === undefined && edge.sourceArrowhead !== undefined;
  const line = atSource ? [...points].reverse() : points;
  const w = metrics.width;
  const h = metrics.height;
  const g = EDGE_LABEL_GAP;
  if (edge.targetArrowhead === undefined && edge.sourceArrowhead === undefined) {
    // The middle of the longest segment (the first of equals).
    let best = 1;
    let bestLength = -1;
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1] as Point;
      const b = line[i] as Point;
      const length = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      if (length > bestLength) {
        best = i;
        bestLength = length;
      }
    }
    const a = line[best - 1] as Point;
    const b = line[best] as Point;
    const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    // Centered on the middle along the segment.
    const back = -(Math.abs(b.x - a.x) > 0 ? w : h) / 2;
    return placeText(metrics, beside(a, middle, w, h, back, 1).center);
  }

  const n = line.length;
  const tip = line[n - 1] as Point;
  const prev = line[n - 2] as Point;
  // What the label keeps the gap from: the routes' segments (and the arrowhead).
  const segments: Rect[] = [];
  for (const route of [line, ...(surroundings.routes ?? [])]) {
    for (let i = 1; i < route.length; i++) {
      segments.push(segmentRect(route[i - 1] as Point, route[i] as Point));
    }
  }
  // Beside the last segment: behind the arrowhead, or slid back just past a
  // route or group border that runs across it (a trunk the edge forks off,
  // its own corner, the border of the group it enters), on either side;
  // nearest to the arrowhead first, above / right first.
  const last = Math.abs(tip.x - prev.x) + Math.abs(tip.y - prev.y);
  const flat = Math.abs(tip.y - prev.y) < 1e-9;
  const behind = (c: number) =>
    flat ? (tip.x - c) * Math.sign(tip.x - prev.x) : (tip.y - c) * Math.sign(tip.y - prev.y);
  // The groups' borders: a label keeps the gap from them too where it can.
  const borders: Rect[] = (surroundings.groups ?? []).flatMap((r) => [
    { x: r.x, y: r.y, width: r.width, height: 0 },
    { x: r.x, y: r.y + r.height, width: r.width, height: 0 },
    { x: r.x, y: r.y, width: 0, height: r.height },
    { x: r.x + r.width, y: r.y, width: 0, height: r.height },
  ]);
  const stops = new Set([arrowhead + g]);
  for (const r of [...segments, ...borders]) {
    for (const c of flat ? [r.x, r.x + r.width] : [r.y, r.y + r.height]) {
      const d = behind(c);
      if (d > arrowhead && d <= last + 1e-9) stops.add(d + g);
    }
  }
  const candidates: Candidate[] = [...stops]
    .sort((p, q) => p - q)
    .flatMap((d) => [beside(prev, tip, w, h, d, 1), beside(prev, tip, w, h, d, -1)]);
  if (n >= 3) {
    // Beside the segment before, its near end the gap away from the corner,
    // on the side the last segment does not leave to.
    const corner = prev;
    const before = line[n - 3] as Point;
    const horizontal = Math.abs(before.y - corner.y) < 1e-9;
    const away = horizontal ? tip.y - corner.y : tip.x - corner.x;
    // `beside()`'s +1 side is above (negative y) or right (positive x).
    const side: 1 | -1 = (horizontal ? away > 0 : away < 0) ? 1 : -1;
    candidates.push(beside(before, corner, w, h, g, side));
  }
  const ux = Math.sign(tip.x - prev.x);
  const uy = Math.sign(tip.y - prev.y);
  const base = { x: tip.x - ux * arrowhead, y: tip.y - uy * arrowhead };
  // The arrowhead: `arrowhead` long, as wide, across the segment.
  const across = segmentRect(base, tip);
  const head =
    ux !== 0
      ? { ...across, y: across.y - arrowhead / 2, height: arrowhead }
      : { ...across, x: across.x - arrowhead / 2, width: arrowhead };
  const near = (c: Candidate) => grow(boxOf(c.center, w, h), g - 1e-6);
  const clearOfRoutes = (c: Candidate) =>
    !overlaps(boxOf(c.center, w, h), head) && segments.every((s) => !overlaps(near(c), s));
  const clearOfBorders = (c: Candidate) => borders.every((s) => !overlaps(near(c), s));
  const clearOfNodes = (c: Candidate) =>
    (surroundings.nodes ?? []).every((o) => !overlaps(boxOf(c.center, w, h), o));
  const first = candidates[0] as Candidate;
  if (clearOfRoutes(first) && clearOfBorders(first)) return placeText(metrics, first.center);
  const clear = candidates.filter(clearOfRoutes);
  const chosen =
    clear.find((c) => clearOfBorders(c) && clearOfNodes(c)) ??
    clear.find(clearOfNodes) ??
    clear[0] ??
    first;
  return placeText(metrics, chosen.center);
}
