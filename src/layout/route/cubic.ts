/** Cubic geometry shared by routing, SVG painting and sampled collision checks. */
import type { Point } from "../ir";

export type Cubic = readonly [Point, Point, Point, Point];

export function cubicPoint(points: readonly Point[], t: number): Point {
  const [a, b, c, d] = points as Cubic;
  const s = 1 - t;
  return {
    x: s ** 3 * a.x + 3 * s * s * t * b.x + 3 * s * t * t * c.x + t ** 3 * d.x,
    y: s ** 3 * a.y + 3 * s * s * t * b.y + 3 * s * t * t * c.y + t ** 3 * d.y,
  };
}

/** One sample per unit of control-polygon length, bounded to 32..4096 steps. */
export function sampleCubic(points: readonly Point[]): Point[] {
  const length = points.slice(1).reduce((n, p, i) => {
    const q = points[i] as Point;
    return n + Math.hypot(p.x - q.x, p.y - q.y);
  }, 0);
  const count = Math.max(32, Math.min(4096, Math.ceil(length)));
  return Array.from({ length: count + 1 }, (_, i) => cubicPoint(points, i / count));
}

/** De Casteljau split; retain the exact cubic, including its endpoint tangents. */
function split(p: Cubic, t: number): [Cubic, Cubic] {
  const mix = (a: Point, b: Point): Point => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  });
  const a = mix(p[0], p[1]);
  const b = mix(p[1], p[2]);
  const c = mix(p[2], p[3]);
  const d = mix(a, b);
  const e = mix(b, c);
  const f = mix(d, e);
  return [
    [p[0], a, d, f],
    [f, e, c, p[3]],
  ];
}

/** Trim by approximate arc length, then use exact subcurves for painting. */
export function trimCubic(points: Cubic, start: number, end: number): Cubic {
  const samples = sampleCubic(points);
  const lengths = [0];
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1] as Point;
    const b = samples[i] as Point;
    lengths.push((lengths[i - 1] ?? 0) + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const total = lengths.at(-1) ?? 0;
  const parameter = (distance: number): number => {
    const i = lengths.findIndex((n) => n >= distance);
    if (i <= 0) return i === 0 ? 0 : 1;
    const lo = lengths[i - 1] ?? 0;
    const hi = lengths[i] ?? lo;
    return (i - 1 + (distance - lo) / (hi - lo || 1)) / (samples.length - 1);
  };
  const t0 = parameter(Math.min(total / 2, start));
  const t1 = parameter(Math.max(total / 2, total - end));
  return split(split(points, t1)[0], t1 === 0 ? 0 : t0 / t1)[1];
}
