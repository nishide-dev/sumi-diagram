/** Conservative validation of split-outline corrections; uncertainty keeps D2's route. */
import { segmentCrossesRect } from "../lint/geometry/shapes";
import type { PathSegment, Point, Rect } from "./geometry";
import { extensionsCross } from "./outline-geometry";

const EPS = 1e-8;
const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
const bounds = (points: readonly Point[]): Rect => {
  const x = Math.min(...points.map((p) => p.x));
  const y = Math.min(...points.map((p) => p.y));
  return {
    x,
    y,
    width: Math.max(...points.map((p) => p.x)) - x,
    height: Math.max(...points.map((p) => p.y)) - y,
  };
};
const controls = (route: readonly PathSegment[]) =>
  route.slice(1).map((s, i) => {
    const start = (route[i] as PathSegment).to;
    return s.command === "C" ? [start, s.c1, s.c2, s.to] : [start, s.to];
  });

function meets(a: Point, b: Point, c: Point, d: Point): boolean {
  if (extensionsCross(a, b, c, d)) return true;
  // Include T-junctions and repeated non-adjacent vertices, too.
  const on = (p: Point, q: Point, r: Point) =>
    Math.abs(distance(p, r) + distance(r, q) - distance(p, q)) < EPS;
  return on(a, b, c) || on(a, b, d) || on(c, d, a) || on(c, d, b);
}

/** A separating line through a shared vertex certifies adjacent Bezier hulls. */
function separatedAtJoin(a: readonly Point[], b: readonly Point[]): boolean {
  const joint = b[0] as Point;
  for (const p of [a[0], b.at(-1)]) {
    if (!p) continue;
    const dx = p.x - joint.x;
    const dy = p.y - joint.y;
    const projection = (q: Point) => (q.x - joint.x) * dx + (q.y - joint.y) * dy;
    for (const sign of [-1, 1]) {
      const before = a
        .slice(0, -1)
        .every((q) => distance(q, joint) < EPS || sign * projection(q) < -EPS);
      const after = b.slice(1).every((q) => distance(q, joint) < EPS || sign * projection(q) > EPS);
      if (before && after) return true;
    }
  }
  return false;
}

export function correctedOutlineRouteIsSafe(
  route: readonly PathSegment[],
  original: readonly PathSegment[],
  obstacles: readonly Rect[],
): boolean {
  const pieces = controls(route);
  const old = new Set(controls(original).map((points) => JSON.stringify(points)));
  for (const [i, points] of pieces.entries()) {
    const a = points[0] as Point;
    const b = points.at(-1) as Point;
    if (distance(a, b) < EPS) return false;
    if (points.length > 2) {
      // Monotonic projection of the control polygon certifies a non-looping
      // cubic. Hull checks below deliberately reject uncertain curved joins.
      for (let k = 1; k < points.length; k++) {
        const p = points[k - 1] as Point;
        const q = points[k] as Point;
        if ((q.x - p.x) * (b.x - a.x) + (q.y - p.y) * (b.y - a.y) < -EPS) return false;
      }
    }
    if (!old.has(JSON.stringify(points))) {
      for (const rect of obstacles) {
        if (points.length === 2) {
          if (segmentCrossesRect(a, b, rect, 0)) return false;
        } else {
          // Every Bezier lies inside its control bounds: clearance is certified
          // without relying on sampled points missing a small obstacle.
          const box = bounds(points);
          if (
            box.x < rect.x + rect.width &&
            box.x + box.width > rect.x &&
            box.y < rect.y + rect.height &&
            box.y + box.height > rect.y
          )
            return false;
        }
      }
    }
    for (let j = 0; j < i; j++) {
      const other = pieces[j] as Point[];
      const c = other[0] as Point;
      const d = other.at(-1) as Point;
      if (points.length === 2 && other.length === 2) {
        if (i === j + 1 ? extensionsCross(a, b, c, d) : meets(a, b, c, d)) return false;
      } else if (i === j + 1) {
        if (!separatedAtJoin(other, points)) return false;
      } else {
        const p = bounds(points);
        const q = bounds(other);
        if (
          p.x <= q.x + q.width &&
          p.x + p.width >= q.x &&
          p.y <= q.y + q.height &&
          p.y + p.height >= q.y
        )
          return false;
      }
    }
  }
  return true;
}
