/**
 * Edge geometry shared by the geometry lint (`geometry/edge-through-node`)
 * and the structured router's checks (#90): does a route pass through the
 * shape of a node? Pure geometry over polylines and convex regions, so it
 * works on routes read from an SVG (`inspectSvg`) and on routes of a Layout
 * IR alike.
 */

import type { ElementKey } from "../../core/check-state";
import type { Point, Region } from "../../core/geometry";

const EPSILON = 1e-9;

/** The parameter interval `[t0, t1]` of `a + t (b - a)`, `t ∈ [0, 1]`, inside `region` shrunk by `inset`. */
export function segmentInterval(
  a: Point,
  b: Point,
  region: Region,
  inset: number,
): [number, number] | undefined {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (region.kind === "ellipse") {
    const rx = region.rx - inset;
    const ry = region.ry - inset;
    if (rx <= 0 || ry <= 0) return undefined;
    // In the ellipse's unit-circle frame: |p + t d|² < 1.
    const px = (a.x - region.cx) / rx;
    const py = (a.y - region.cy) / ry;
    const qx = dx / rx;
    const qy = dy / ry;
    const qa = qx * qx + qy * qy;
    const qb = 2 * (px * qx + py * qy);
    const qc = px * px + py * py - 1;
    if (qa < EPSILON) return qc < 0 ? [0, 1] : undefined;
    const disc = qb * qb - 4 * qa * qc;
    if (disc <= 0) return undefined;
    const root = Math.sqrt(disc);
    const t0 = Math.max(0, (-qb - root) / (2 * qa));
    const t1 = Math.min(1, (-qb + root) / (2 * qa));
    return t1 > t0 ? [t0, t1] : undefined;
  }
  const points = region.points;
  if (points.length < 3) return undefined;
  // Orientation of the polygon (either is allowed), for the inward normals.
  let area = 0;
  for (const [i, p] of points.entries()) {
    const q = points[(i + 1) % points.length] as Point;
    area += p.x * q.y - q.x * p.y;
  }
  const sign = Math.sign(area);
  if (sign === 0) return undefined;
  let t0 = 0;
  let t1 = 1;
  for (const [i, p] of points.entries()) {
    const q = points[(i + 1) % points.length] as Point;
    const length = Math.hypot(q.x - p.x, q.y - p.y);
    if (length < EPSILON) continue;
    // Inward unit normal; inside (shrunk) means n · (x - p) ≥ inset.
    const nx = (sign * (p.y - q.y)) / length;
    const ny = (sign * (q.x - p.x)) / length;
    const start = nx * (a.x - p.x) + ny * (a.y - p.y) - inset;
    const rate = nx * dx + ny * dy;
    if (Math.abs(rate) < EPSILON) {
      if (start <= EPSILON) return undefined;
      continue;
    }
    const t = -start / rate;
    if (rate > 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t1 <= t0) return undefined;
  }
  return [t0, t1];
}

/**
 * `true` if the segment runs through `region` deeper than `tolerance`: some
 * part of it longer than 1/1000 unit lies inside the region shrunk by
 * `tolerance`. Touching the outline, or ending on it, does not count.
 */
export function segmentCrossesRegion(
  a: Point,
  b: Point,
  region: Region,
  tolerance: number,
): boolean {
  const interval = segmentInterval(a, b, region, tolerance);
  if (interval === undefined) return false;
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  return (interval[1] - interval[0]) * length > 1e-3;
}

/** A node shape a route must not pass through. */
export interface RouteObstacle {
  readonly key: ElementKey;
  readonly region: Region;
}

/**
 * The obstacles (in their order) that some segment of `route` passes
 * through, more than `tolerance` deep, except those in `exclude` (the
 * edge's own ends).
 */
export function obstaclesCrossedByRoute(
  route: readonly (readonly Point[])[],
  obstacles: readonly RouteObstacle[],
  exclude: ReadonlySet<ElementKey>,
  tolerance: number,
): ElementKey[] {
  const crossed: ElementKey[] = [];
  for (const obstacle of obstacles) {
    if (exclude.has(obstacle.key)) continue;
    const hit = route.some((line) =>
      line.some(
        (p, i) =>
          i > 0 && segmentCrossesRegion(line[i - 1] as Point, p, obstacle.region, tolerance),
      ),
    );
    if (hit) crossed.push(obstacle.key);
  }
  return crossed;
}
