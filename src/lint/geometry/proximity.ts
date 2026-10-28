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

/** A straight piece of one owner's (edge's) drawn line, with the owner's stroke width. */
export interface Piece<Owner> extends AxisSegment {
  owner: Owner;
  width: number;
}

/** Two pieces side by side: how far apart, and the stretch where both run. */
export interface ParallelRun {
  /** Distance between the two lines (centre to centre). */
  distance: number;
  /** The common stretch `[from, to]` along the axis. */
  from: number;
  to: number;
}

/** The stretch where two parallel pieces run side by side, if they do. */
export function parallelRun(a: AxisSegment, b: AxisSegment): ParallelRun | undefined {
  if (a.axis !== b.axis) return undefined;
  const from = Math.max(a.from, b.from);
  const to = Math.min(a.to, b.to);
  if (to <= from) return undefined;
  return { distance: Math.abs(a.at - b.at), from, to };
}

/**
 * Identical pieces of several owners (a trunk they share, drawn on the same
 * coordinates over the same stretch with the same width), kept once.
 */
export interface Bundle<Owner> extends AxisSegment {
  owners: Owner[];
  width: number;
}

/**
 * Pieces by axis, sorted by their coordinate, for sweeps: neighbours within
 * a distance are found without comparing every pair (#156). Identical pieces
 * are bundled, so a trunk many edges share is compared once.
 */
export class PieceIndex<Owner> {
  readonly #byAxis: Record<"h" | "v", Bundle<Owner>[]>;

  constructor(pieces: readonly Piece<Owner>[]) {
    const bundles = new Map<string, Bundle<Owner>>();
    for (const { owner, ...piece } of pieces) {
      const key = `${piece.axis}|${piece.at}|${piece.from}|${piece.to}|${piece.width}`;
      const bundle = bundles.get(key);
      if (bundle === undefined) bundles.set(key, { ...piece, owners: [owner] });
      else if (!bundle.owners.includes(owner)) bundle.owners.push(owner);
    }
    const sorted = [...bundles.values()].sort((a, b) => a.at - b.at || a.from - b.from);
    this.#byAxis = {
      h: sorted.filter((p) => p.axis === "h"),
      v: sorted.filter((p) => p.axis === "v"),
    };
  }

  /** Bundles along `axis` whose coordinate is within `reach` of `at`. */
  near(axis: "h" | "v", at: number, reach: number): Bundle<Owner>[] {
    const list = this.#byAxis[axis];
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((list[mid] as Bundle<Owner>).at < at - reach) lo = mid + 1;
      else hi = mid;
    }
    const found: Bundle<Owner>[] = [];
    for (let i = lo; i < list.length && (list[i] as Bundle<Owner>).at <= at + reach; i++) {
      found.push(list[i] as Bundle<Owner>);
    }
    return found;
  }

  /**
   * Every pair of bundles on the same axis whose coordinates differ by more
   * than `apart` and at most `reach`, and that run side by side, each pair
   * once, with the owners of each side that have a partner other than
   * themselves on the other side (an edge beside only itself is a route
   * doubling back, not two lines; an edge on both sides beside another edge
   * still counts). A sweep over the
   * sorted coordinates: bundles on the same line are skipped as a block.
   */
  pairs(
    apart: number,
    reach: number,
  ): {
    a: Bundle<Owner>;
    b: Bundle<Owner>;
    aOwners: Owner[];
    bOwners: Owner[];
    run: ParallelRun;
  }[] {
    const found: {
      a: Bundle<Owner>;
      b: Bundle<Owner>;
      aOwners: Owner[];
      bOwners: Owner[];
      run: ParallelRun;
    }[] = [];
    for (const list of [this.#byAxis.h, this.#byAxis.v]) {
      let start = 0;
      for (let i = 0; i < list.length; i++) {
        const a = list[i] as Bundle<Owner>;
        if (start <= i) start = i + 1;
        while (start < list.length && (list[start] as Bundle<Owner>).at - a.at <= apart) start++;
        for (let j = start; j < list.length; j++) {
          const b = list[j] as Bundle<Owner>;
          if (b.at - a.at > reach) break;
          const run = parallelRun(a, b);
          if (run === undefined) continue;
          // Owners with a partner other than themselves on the other side.
          const aOwners = a.owners.filter((o) => b.owners.some((other) => other !== o));
          const bOwners = b.owners.filter((o) => a.owners.some((other) => other !== o));
          if (aOwners.length > 0 && bOwners.length > 0) found.push({ a, b, aOwners, bOwners, run });
        }
      }
    }
    return found;
  }
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
