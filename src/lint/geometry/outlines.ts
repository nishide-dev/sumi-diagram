/** Convex collision regions and safe label areas for composed outline nodes (#54). */
import type { Point, Region } from "../../core/geometry";
import type { OutlineDrawing } from "../../core/outline";
import { depthInside, rectPolygon } from "./shapes";

/** Monotone-chain convex hull; does not mutate the renderer's ordered silhouette. */
export function convexHull(points: readonly Point[]): Point[] {
  const sorted = [...points]
    .sort((a, b) => a.x - b.x || a.y - b.y)
    .filter((p, i, all) => i === 0 || p.x !== all[i - 1]?.x || p.y !== all[i - 1]?.y);
  const turn = (a: Point, b: Point, c: Point) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const half = (vertices: readonly Point[]) => {
    const chain: Point[] = [];
    for (const p of vertices) {
      while (
        chain.length >= 2 &&
        turn(chain[chain.length - 2] as Point, chain[chain.length - 1] as Point, p) <= 0
      )
        chain.pop();
      chain.push(p);
    }
    return chain.slice(0, -1);
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}

export function outlineRegions(drawing: OutlineDrawing): { outline: Region; labelArea: Region } {
  return {
    outline: drawing.collision ?? { kind: "polygon", points: convexHull(drawing.outline) },
    labelArea: rectPolygon(drawing.safeArea),
  };
}

const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const subtract = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;

/** Inset convex polygons exactly; ellipses use reduced radii (same approximation as depthInside). */
function inset(region: Region, amount: number): Region | undefined {
  if (region.kind === "ellipse") {
    const rx = region.rx - amount;
    const ry = region.ry - amount;
    return rx > 0 && ry > 0 ? { ...region, rx, ry } : undefined;
  }
  const points = region.points;
  const area = points.reduce(
    (sum, p, i) => sum + cross(p, points[(i + 1) % points.length] as Point),
    0,
  );
  const sign = Math.sign(area);
  if (points.length < 3 || sign === 0) return;
  const lines = points.map((a, i) => {
    const b = points[(i + 1) % points.length] as Point;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const normal = { x: (sign * (a.y - b.y)) / length, y: (sign * (b.x - a.x)) / length };
    return { normal, value: dot(normal, a) + amount };
  });
  const inner: Point[] = [];
  for (const [i, current] of lines.entries()) {
    const previous = lines[(i + lines.length - 1) % lines.length] as typeof current;
    const determinant = cross(previous.normal, current.normal);
    if (Math.abs(determinant) < 1e-12) continue;
    const point = {
      x: (previous.value * current.normal.y - current.value * previous.normal.y) / determinant,
      y: (previous.normal.x * current.value - current.normal.x * previous.value) / determinant,
    };
    if (!lines.every((line) => dot(line.normal, point) >= line.value - 1e-8)) return;
    inner.push(point);
  }
  return inner.length >= 3 ? { kind: "polygon", points: inner } : undefined;
}

function support(region: Region, direction: Point): Point {
  if (region.kind === "polygon") {
    return region.points.reduce((best, p) => (dot(p, direction) > dot(best, direction) ? p : best));
  }
  const length = Math.hypot(region.rx * direction.x, region.ry * direction.y);
  return {
    x: region.cx + (region.rx * region.rx * direction.x) / length,
    y: region.cy + (region.ry * region.ry * direction.y) / length,
  };
}

/** Convex polygon / ellipse overlap via support mapping (GJK), with an inset on both sides. */
export function regionsOverlap(first: Region, second: Region, tolerance: number): boolean {
  const a = inset(first, tolerance / 2);
  const b = inset(second, tolerance / 2);
  if (!a || !b) return false;
  // Polygon pairs have a finite exact separating-axis test.
  if (a.kind === "polygon" && b.kind === "polygon") {
    for (const polygon of [a.points, b.points]) {
      for (const [i, p] of polygon.entries()) {
        const q = polygon[(i + 1) % polygon.length] as Point;
        const axis = { x: p.y - q.y, y: q.x - p.x };
        const aa = a.points.map((v) => dot(v, axis));
        const bb = b.points.map((v) => dot(v, axis));
        if (Math.min(...aa) >= Math.max(...bb) - 1e-9 || Math.min(...bb) >= Math.max(...aa) - 1e-9)
          return false;
      }
    }
    return true;
  }
  // Scale the ellipse to the unit disk for an exact polygon/ellipse check.
  if (a.kind === "polygon" || b.kind === "polygon") {
    const polygon = a.kind === "polygon" ? a : b;
    const ellipse = a.kind === "ellipse" ? a : b;
    if (polygon.kind !== "polygon" || ellipse.kind !== "ellipse") return false;
    const points = polygon.points.map((p) => ({
      x: (p.x - ellipse.cx) / ellipse.rx,
      y: (p.y - ellipse.cy) / ellipse.ry,
    }));
    if (depthInside({ kind: "polygon", points }, { x: 0, y: 0 }) >= 0) return true;
    return points.some((p, i) => {
      const q = points[(i + 1) % points.length] as Point;
      const v = subtract(q, p);
      const t = Math.max(0, Math.min(1, -dot(p, v) / dot(v, v)));
      return Math.hypot(p.x + t * v.x, p.y + t * v.y) < 1 - 1e-9;
    });
  }
  // Ellipse/ellipse: GJK over the smooth Minkowski difference.
  const minkowski = (d: Point) => subtract(support(a, d), support(b, { x: -d.x, y: -d.y }));
  const triple = (u: Point, v: Point, w: Point): Point => ({
    x: v.x * dot(u, w) - u.x * dot(v, w),
    y: v.y * dot(u, w) - u.y * dot(v, w),
  });
  const simplex: Point[] = [minkowski({ x: 1, y: 0 })];
  if ((simplex[0]?.x ?? 0) <= 1e-12) return false;
  let direction: Point = { x: -(simplex[0]?.x ?? 0), y: -(simplex[0]?.y ?? 0) };
  for (let iteration = 0; iteration < 64; iteration++) {
    if (Math.hypot(direction.x, direction.y) < 1e-12) direction = { x: 0, y: 1 };
    const point = minkowski(direction);
    if (dot(point, direction) <= 1e-12) return false;
    simplex.push(point);
    const ao = { x: -point.x, y: -point.y };
    const ab = subtract(simplex[simplex.length - 2] as Point, point);
    if (simplex.length === 2) {
      direction = triple(ab, ao, ab);
      if (Math.hypot(direction.x, direction.y) < 1e-12) direction = { x: -ab.y, y: ab.x };
      continue;
    }
    const ac = subtract(simplex[0] as Point, point);
    const abOut = triple(ac, ab, ab);
    const acOut = triple(ab, ac, ac);
    if (dot(abOut, ao) > 0) {
      simplex.shift();
      direction = abOut;
    } else if (dot(acOut, ao) > 0) {
      simplex.splice(1, 1);
      direction = acOut;
    } else return true;
  }
  return false;
}
