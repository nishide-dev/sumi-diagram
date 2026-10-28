/**
 * Proximity geometry for the geometry lint (#156): where an edge runs along a
 * group's border or along another edge, and how close it comes to a label.
 * Routes of both engines are orthogonal (D2/ELK with rounded corners, the
 * structured router with straight ones) and group borders are rectangles, so
 * "running along" is measured between axis-parallel pieces only.
 */

import type { Point, Rect } from "../../core/geometry";

/** A horizontal (`h`, at y = `at`) or vertical (`v`, at x = `at`) piece from `from` to `to` (`from < to`). */
export interface AxisSegment {
  axis: "h" | "v";
  at: number;
  from: number;
  to: number;
}

/**
 * How far a chord may lean (in units across its length) and still count as
 * axis-parallel: D2 writes coordinates rounded to hundredths and ELK's
 * straight parts are exact, so this only absorbs rounding.
 */
const STRAIGHT_SLACK = 0.25;

/**
 * The axis-parallel pieces of polylines, consecutive chords on the same line
 * merged (the flattened rounded corners of D2 routes are left out: they are
 * shorter than the runs these rules look for).
 */
export function axisSegments(polylines: readonly (readonly Point[])[]): AxisSegment[] {
  const segments: AxisSegment[] = [];
  for (const line of polylines) {
    let current: AxisSegment | undefined;
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1] as Point;
      const b = line[i] as Point;
      const dx = Math.abs(b.x - a.x);
      const dy = Math.abs(b.y - a.y);
      let piece: AxisSegment | undefined;
      if (dx > 0 && dy <= STRAIGHT_SLACK) {
        piece = {
          axis: "h",
          at: (a.y + b.y) / 2,
          from: Math.min(a.x, b.x),
          to: Math.max(a.x, b.x),
        };
      } else if (dy > 0 && dx <= STRAIGHT_SLACK) {
        piece = {
          axis: "v",
          at: (a.x + b.x) / 2,
          from: Math.min(a.y, b.y),
          to: Math.max(a.y, b.y),
        };
      }
      if (
        piece !== undefined &&
        current !== undefined &&
        current.axis === piece.axis &&
        Math.abs(current.at - piece.at) <= STRAIGHT_SLACK &&
        piece.from <= current.to + STRAIGHT_SLACK &&
        piece.to >= current.from - STRAIGHT_SLACK
      ) {
        current.from = Math.min(current.from, piece.from);
        current.to = Math.max(current.to, piece.to);
        continue;
      }
      if (current !== undefined) segments.push(current);
      current = piece;
    }
    if (current !== undefined) segments.push(current);
  }
  return segments;
}

/**
 * Pieces at most this far apart (in units, 0.25pt) are one line: a trunk
 * that several edges share (a fan-in / fan-out merge, a junction) is drawn
 * once per edge on the same coordinates. The structured router draws them
 * exactly there; D2/ELK can leave a fraction of a unit between the edges
 * leaving a junction (0.22 units in the gallery's hidden junction), which
 * still draws one line: the strokes (1pt and more) overlap almost entirely.
 */
export const COINCIDENT_UNITS = 0.5;

/** A straight line drawn by one or more edges (a shared trunk), with the parts they draw. */
export interface Wire<Owner> {
  axis: "h" | "v";
  at: number;
  /** Disjoint stretches `[from, to]`, sorted. */
  spans: [number, number][];
  /** The owners whose pieces make up the wire, in input order. */
  owners: Owner[];
}

/**
 * Merges the pieces of several owners (edges) that lie on the same line and
 * overlap into wires: a shared trunk is one wire with all its edges.
 */
export function wiresOf<Owner>(
  pieces: readonly { owner: Owner; segment: AxisSegment }[],
): Wire<Owner>[] {
  const parent = pieces.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i] as number] as number;
      i = parent[i] as number;
    }
    return i;
  };
  for (const [i, a] of pieces.entries()) {
    for (let j = i + 1; j < pieces.length; j++) {
      const b = pieces[j] as (typeof pieces)[number];
      if (a.segment.axis !== b.segment.axis) continue;
      if (Math.abs(a.segment.at - b.segment.at) > COINCIDENT_UNITS) continue;
      if (Math.min(a.segment.to, b.segment.to) - Math.max(a.segment.from, b.segment.from) <= 0)
        continue;
      parent[find(j)] = find(i);
    }
  }
  const byRoot = new Map<number, number[]>();
  for (const i of pieces.keys()) {
    const root = find(i);
    byRoot.set(root, [...(byRoot.get(root) ?? []), i]);
  }
  return [...byRoot.values()].map((members) => {
    const segments = members.map((i) => (pieces[i] as (typeof pieces)[number]).segment);
    const sorted = [...segments].sort((a, b) => a.from - b.from);
    const spans: [number, number][] = [];
    for (const s of sorted) {
      const last = spans[spans.length - 1];
      if (last !== undefined && s.from <= last[1]) last[1] = Math.max(last[1], s.to);
      else spans.push([s.from, s.to]);
    }
    const owners: Owner[] = [];
    for (const i of members) {
      const owner = (pieces[i] as (typeof pieces)[number]).owner;
      if (!owners.includes(owner)) owners.push(owner);
    }
    const first = segments[0] as AxisSegment;
    return { axis: first.axis, at: first.at, spans, owners };
  });
}

/**
 * Where two parallel lines (given as stretches along the same axis) run side
 * by side: the longest stretch where they do.
 */
export function sideBySide(
  a: { axis: "h" | "v"; at: number; spans: readonly (readonly [number, number])[] },
  b: { axis: "h" | "v"; at: number; spans: readonly (readonly [number, number])[] },
): ParallelRun | undefined {
  if (a.axis !== b.axis) return undefined;
  let longest: [number, number] | undefined;
  for (const [af, at] of a.spans) {
    for (const [bf, bt] of b.spans) {
      const from = Math.max(af, bf);
      const to = Math.min(at, bt);
      if (to <= from) continue;
      if (longest === undefined || to - from > longest[1] - longest[0]) longest = [from, to];
    }
  }
  if (longest === undefined) return undefined;
  const mid = (longest[0] + longest[1]) / 2;
  return {
    distance: Math.abs(a.at - b.at),
    overlap: longest[1] - longest[0],
    at: a.axis === "h" ? { x: mid, y: a.at } : { x: a.at, y: mid },
  };
}

/** Two parallel lines side by side: how far apart and over how long a stretch. */
export interface ParallelRun {
  /** Distance between the two lines (centre to centre). */
  distance: number;
  /** Length of the longest stretch where both run side by side. */
  overlap: number;
  /** The midpoint of that stretch on the first line. */
  at: Point;
}

/** The four straight sides of a rectangle whose corners are rounded by `radius`. */
export function rectSides({ x, y, width, height }: Rect, radius = 0): AxisSegment[] {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  return [
    { axis: "h", at: y, from: x + r, to: x + width - r },
    { axis: "h", at: y + height, from: x + r, to: x + width - r },
    { axis: "v", at: x, from: y + r, to: y + height - r },
    { axis: "v", at: x + width, from: y + r, to: y + height - r },
  ];
}

/** Distance from the segment `a`–`b` to `rect` (0 if it touches or enters it). */
export function segmentRectDistance(a: Point, b: Point, rect: Rect): number {
  // Separating-axis style: the distance between two convex sets is reached at
  // an endpoint of the segment or at a corner of the rectangle.
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  const pointRect = (p: Point) =>
    Math.hypot(Math.max(rect.x - p.x, 0, p.x - right), Math.max(rect.y - p.y, 0, p.y - bottom));
  const pointSegment = (p: Point) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length2 = dx * dx + dy * dy;
    const t =
      length2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2));
    return Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y);
  };
  // A segment that enters the rectangle or crosses it.
  const inside = (p: Point) => p.x >= rect.x && p.x <= right && p.y >= rect.y && p.y <= bottom;
  if (inside(a) || inside(b)) return 0;
  const corners: Point[] = [
    { x: rect.x, y: rect.y },
    { x: right, y: rect.y },
    { x: right, y: bottom },
    { x: rect.x, y: bottom },
  ];
  const cross = (p: Point, q: Point, r: Point) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  for (let i = 0; i < 4; i++) {
    const c = corners[i] as Point;
    const d = corners[(i + 1) % 4] as Point;
    const d1 = cross(a, b, c);
    const d2 = cross(a, b, d);
    const d3 = cross(c, d, a);
    const d4 = cross(c, d, b);
    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0)))
      return 0;
  }
  return Math.min(pointRect(a), pointRect(b), ...corners.map(pointSegment));
}

/** The shortest distance from polylines to `rect` (0 if they touch or enter it). */
export function polylinesRectDistance(
  polylines: readonly (readonly Point[])[],
  rect: Rect,
): number {
  let best = Number.POSITIVE_INFINITY;
  for (const line of polylines) {
    if (line.length === 1)
      best = Math.min(best, segmentRectDistance(line[0] as Point, line[0] as Point, rect));
    for (let i = 1; i < line.length; i++) {
      best = Math.min(best, segmentRectDistance(line[i - 1] as Point, line[i] as Point, rect));
    }
  }
  return best;
}
