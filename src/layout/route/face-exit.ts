/** Lines that start on a visible face of their own solid (cuboid `ports: face`, #575). */
import type { Point } from "../ir";

/** Whether `p` lies inside (or on) a convex polygon. */
export function insidePolygon(p: Point, polygon: readonly Point[]): boolean {
  let sign = 0;
  for (const [i, a] of polygon.entries()) {
    const b = polygon[(i + 1) % polygon.length] as Point;
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (Math.abs(cross) < 1e-6) continue;
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  return true;
}

/** Where the segment p → q (p inside the convex polygon) leaves it. */
export function polygonExit(polygon: readonly Point[], p: Point, q: Point): Point | undefined {
  const d = { x: q.x - p.x, y: q.y - p.y };
  let best: number | undefined;
  for (const [i, a] of polygon.entries()) {
    const b = polygon[(i + 1) % polygon.length] as Point;
    const e = { x: b.x - a.x, y: b.y - a.y };
    const denominator = d.x * e.y - d.y * e.x;
    if (Math.abs(denominator) < 1e-12) continue;
    const t = ((a.x - p.x) * e.y - (a.y - p.y) * e.x) / denominator;
    const u = ((a.x - p.x) * d.y - (a.y - p.y) * d.x) / denominator;
    if (
      t >= -1e-9 &&
      t <= 1 + 1e-9 &&
      u >= -1e-9 &&
      u <= 1 + 1e-9 &&
      (best === undefined || t > best)
    )
      best = t;
  }
  return best === undefined ? undefined : { x: p.x + d.x * best, y: p.y + d.y * best };
}

/** Distance from `p` to the boundary of a polygon. */
export function distanceToPolygon(p: Point, polygon: readonly Point[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (const [i, a] of polygon.entries()) {
    const b = polygon[(i + 1) % polygon.length] as Point;
    const [dx, dy] = [b.x - a.x, b.y - a.y];
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return best;
}

/**
 * The polyline from where it leaves the face it starts on, if it leaves through the silhouette
 * (the stretch over the face is intended); `undefined` when it leaves across another edge of the
 * solid (the front, or the neighbouring face) or never leaves. Whatever follows is for the
 * caller to check against the solid.
 */
export function leaveFace(
  faces: readonly (readonly Point[])[],
  outline: readonly Point[],
  at: Point,
  points: readonly Point[],
): Point[] | undefined {
  const face = faces.find((polygon) => insidePolygon(at, polygon));
  if (face === undefined) return [...points];
  for (let i = 0; i + 1 < points.length; i++) {
    const [p, q] = [points[i] as Point, points[i + 1] as Point];
    if (insidePolygon(q, face)) continue;
    const exit = polygonExit(face, p, q);
    if (exit === undefined || distanceToPolygon(exit, outline) > 0.5) return undefined;
    return [exit, ...points.slice(i + 1)];
  }
  return undefined;
}
