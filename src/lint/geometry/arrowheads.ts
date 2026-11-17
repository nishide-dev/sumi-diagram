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

/**
 * How far the arrowhead painted at the end of `route` reaches back from its tip along the edge, when it is
 * drawn flat on a projected tilted plane (#577): the head's points are mapped, so it may be shorter or
 * longer than the nominal `fallback`. The head whose nearest point is closest to the tip is the end's.
 */
export function paintedHeadLength(
  heads: readonly (readonly Point[])[] | undefined,
  route: readonly Point[],
  source: boolean,
  fallback: number,
): number {
  if (heads === undefined || heads.length === 0) return fallback;
  const points = source ? route : [...route].reverse();
  const tip = points[0];
  const next = points.find(
    (p) => tip !== undefined && Math.hypot(p.x - tip.x, p.y - tip.y) > EPSILON,
  );
  if (tip === undefined || next === undefined) return fallback;
  const norm = Math.hypot(next.x - tip.x, next.y - tip.y);
  const dx = (next.x - tip.x) / norm;
  const dy = (next.y - tip.y) / norm;
  const near = (head: readonly Point[]) =>
    Math.min(...head.map((p) => Math.hypot(p.x - tip.x, p.y - tip.y)));
  const head = [...heads].sort((a, b) => near(a) - near(b))[0] as readonly Point[];
  if (near(head) > fallback * 2) return fallback;
  return Math.max(...head.map((p) => (p.x - tip.x) * dx + (p.y - tip.y) * dy));
}
