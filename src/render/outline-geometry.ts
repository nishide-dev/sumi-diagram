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

/**
 * Largest angle (degrees) between an edge end's travel direction and the inward
 * normal of the footprint side it enters that still counts as "entering
 * normally" (#82). ELK's last segment is orthogonal to the side, but when D2
 * traces the other end to a diamond/oval/circle the straight route between
 * two nearly aligned centres keeps a lateral offset below 1 unit. Measured with
 * D2 v0.9.0 over 241 figures / 770 custom-outline ends: at most 1.302° (0.95
 * unit over 32 units). 5° keeps a ~4x margin, accepts a 1-unit offset down to
 * an 11.5-unit segment, and still rejects routes that clearly are not a normal
 * entry (diagonal, curved or corner approaches). See design §6.13.
 */
export const ENDPOINT_ANGLE_TOLERANCE_DEG = 5;
/** |outline − footprint| distance along the ray (units) treated as already touching. */
export const FLUSH_TOLERANCE = 1e-6;

/** Whether `point` lies strictly inside `rect`, beyond `tolerance` from every side. */
export function insideRect(rect: Rect, point: Point, tolerance = 0.01): boolean {
  return (
    point.x > rect.x + tolerance &&
    point.x < rect.x + rect.width - tolerance &&
    point.y > rect.y + tolerance &&
    point.y < rect.y + rect.height - tolerance
  );
}

/**
 * Angle in degrees between the unit `direction` and the inward normal of the
 * side of `rect` that the ray from `origin` reaches at `distance`. At a corner
 * the smaller of the two angles is used.
 */
export function entryAngle(rect: Rect, origin: Point, direction: Point, distance: number): number {
  const hit = { x: origin.x + direction.x * distance, y: origin.y + direction.y * distance };
  const sides = [
    { gap: Math.abs(hit.x - rect.x), normal: { x: 1, y: 0 } },
    { gap: Math.abs(hit.x - rect.x - rect.width), normal: { x: -1, y: 0 } },
    { gap: Math.abs(hit.y - rect.y), normal: { x: 0, y: 1 } },
    { gap: Math.abs(hit.y - rect.y - rect.height), normal: { x: 0, y: -1 } },
  ];
  const nearest = Math.min(...sides.map((s) => s.gap));
  const cosine = Math.max(
    ...sides
      .filter((s) => s.gap <= nearest + 1e-6)
      .map((s) => direction.x * s.normal.x + direction.y * s.normal.y),
  );
  return (Math.acos(Math.min(1, Math.max(-1, cosine))) * 180) / Math.PI;
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
