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

/**
 * Distance from a point inside an ellipse to its outline (0 outside or on
 * it). Eberly, "Distance from a Point to an Ellipse" (robust bisection).
 */
export function ellipseDepth(
  ellipse: { cx: number; cy: number; rx: number; ry: number },
  p: Point,
): number {
  let y0 = Math.abs(p.x - ellipse.cx);
  let y1 = Math.abs(p.y - ellipse.cy);
  let e0 = ellipse.rx;
  let e1 = ellipse.ry;
  if ((y0 / e0) ** 2 + (y1 / e1) ** 2 >= 1) return 0;
  if (e0 < e1) {
    [e0, e1] = [e1, e0];
    [y0, y1] = [y1, y0];
  }
  if (y1 > 0) {
    if (y0 > 0) {
      const z0 = y0 / e0;
      const z1 = y1 / e1;
      const g = z0 * z0 + z1 * z1 - 1;
      const r0 = (e0 / e1) ** 2;
      const n0 = r0 * z0;
      let s0 = z1 - 1;
      let s1 = g < 0 ? 0 : Math.hypot(n0, z1) - 1;
      let s = 0;
      for (let i = 0; i < 200; i++) {
        s = (s0 + s1) / 2;
        if (s === s0 || s === s1) break;
        const ratio0 = n0 / (s + r0);
        const ratio1 = z1 / (s + 1);
        const value = ratio0 * ratio0 + ratio1 * ratio1 - 1;
        if (value > 0) s0 = s;
        else if (value < 0) s1 = s;
        else break;
      }
      return Math.hypot((r0 * y0) / (s + r0) - y0, y1 / (s + 1) - y1);
    }
    return Math.abs(y1 - e1);
  }
  const numer = e0 * y0;
  const denom = e0 * e0 - e1 * e1;
  if (numer < denom) {
    const ratio = numer / denom;
    return Math.hypot(e0 * ratio - y0, e1 * Math.sqrt(1 - ratio * ratio));
  }
  return Math.abs(y0 - e0);
}

/**
 * The parameter interval `[t0, t1]` of `a + t (b - a)`, `t ∈ [0, 1]`, inside
 * `region` shrunk by `inset` (for an ellipse: with both radii reduced by
 * `inset`, an approximation of the inward offset; exact for `inset` 0).
 * Touching the outline or running along it is not inside.
 */
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
  if (region.kind === "ellipse" && tolerance > 0) {
    // Shrinking both radii by the tolerance is not the inward offset of an
    // ellipse (it reaches closer than `tolerance` to the outline of an
    // elongated one), so measure the depth itself. Inside a convex region
    // the distance to the outline is concave, hence unimodal along the
    // segment: a ternary search finds the deepest point.
    const inside = segmentInterval(a, b, region, 0);
    if (inside === undefined) return false;
    const at = (t: number): Point => ({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
    let [lo, hi] = inside;
    for (let i = 0; i < 100 && hi - lo > 1e-12; i++) {
      const m1 = lo + (hi - lo) / 3;
      const m2 = hi - (hi - lo) / 3;
      if (ellipseDepth(region, at(m1)) < ellipseDepth(region, at(m2))) lo = m1;
      else hi = m2;
    }
    return ellipseDepth(region, at((lo + hi) / 2)) > tolerance + 1e-6;
  }
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
