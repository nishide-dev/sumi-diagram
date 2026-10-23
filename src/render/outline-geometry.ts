/** Straight-polygon ray intersections used to preserve D2's endpoint clearance. */
import type { Point, Rect } from "../core/geometry";

export const rectPoints = ({ x, y, width, height }: Rect): Point[] => [
  { x, y },
  { x: x + width, y },
  { x: x + width, y: y + height },
  { x, y: y + height },
];

export function rayHit(
  polygon: readonly Point[],
  origin: Point,
  direction: Point,
): number | undefined {
  let best: number | undefined;
  for (const [i, a] of polygon.entries()) {
    const b = polygon[(i + 1) % polygon.length] as Point;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const denominator = direction.x * ey - direction.y * ex;
    if (Math.abs(denominator) < 1e-12) continue;
    const ax = a.x - origin.x;
    const ay = a.y - origin.y;
    const t = (ax * ey - ay * ex) / denominator;
    const u = (ax * direction.y - ay * direction.x) / denominator;
    if (t < -1e-8 || u < -1e-8 || u > 1 + 1e-8) continue;
    if (best === undefined || t < best) best = Math.max(0, t);
  }
  return best;
}

/** Interior intersection (or overlapping interiors), excluding a mere shared endpoint. */
export function extensionsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const u = { x: b.x - a.x, y: b.y - a.y };
  const v = { x: d.x - c.x, y: d.y - c.y };
  const cross = (p: Point, q: Point) => p.x * q.y - p.y * q.x;
  const w = { x: c.x - a.x, y: c.y - a.y };
  const denominator = cross(u, v);
  if (Math.abs(denominator) > 1e-9) {
    const t = cross(w, v) / denominator;
    const s = cross(w, u) / denominator;
    return t > 1e-8 && t < 1 - 1e-8 && s > 1e-8 && s < 1 - 1e-8;
  }
  const length = Math.hypot(u.x, u.y);
  if (length < 1e-8 || Math.abs(cross(w, u)) > 1e-8 * length) return false;
  const projection = (p: Point) => ((p.x - a.x) * u.x + (p.y - a.y) * u.y) / length;
  const p = projection(c);
  const q = projection(d);
  return Math.min(length, Math.max(p, q)) - Math.max(0, Math.min(p, q)) > 1e-8;
}
