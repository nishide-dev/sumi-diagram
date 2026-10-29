import type { Point } from "../../core/geometry";

/** Numerical slack only; SVG coordinates are written to three decimal places. */
const EPSILON = 0.002;

/**
 * Straight distance behind a tip, including the part occupied by the head.
 * The logical route locates the tip; painted geometry locates the bend after
 * rounding. Never borrow a straight piece from another edge's shared wire.
 * A triangle's wire stops at its base, so that missing (unpainted) interval
 * must not itself be mistaken for a bend.
 */
export function arrowheadStraightRun(
  route: readonly Point[],
  drawn: readonly (readonly Point[])[],
  source: boolean,
  tolerance = EPSILON,
): number {
  const points = source ? route : [...route].reverse();
  const tip = points[0];
  const next = points.find(
    (p) => tip !== undefined && Math.hypot(p.x - tip.x, p.y - tip.y) > EPSILON,
  );
  if (tip === undefined || next === undefined) return 0;
  const length = Math.hypot(next.x - tip.x, next.y - tip.y);
  const dx = (next.x - tip.x) / length;
  const dy = (next.y - tip.y) / length;
  const along = (p: Point) => (p.x - tip.x) * dx + (p.y - tip.y) * dy;
  const onLine = (p: Point) => Math.abs((p.x - tip.x) * dy - (p.y - tip.y) * dx) <= tolerance;
  let run = 0;
  for (const p of points.slice(1)) {
    const distance = along(p);
    if (!onLine(p) || distance < run - EPSILON) break;
    run = distance;
  }
  for (const line of drawn) {
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1] as Point;
      const b = line[i] as Point;
      if (onLine(a) === onLine(b)) continue;
      const distance = along(onLine(a) ? a : b);
      if (distance >= -EPSILON) run = Math.min(run, Math.max(0, distance));
    }
  }
  return run;
}
