/**
 * Bundles of parallel lines (#614, `edges[].strands`, design record
 * `docs/design/decisions/614-missing-parts.md`): an edge drawn as `n` lines
 * along its route, `strandSpacing()` apart, e.g. the residual streams of a
 * hyper-connection. Each line is the route offset sideways (mitred at the
 * turns, so the lines stay parallel), and its turns are rounded about the same
 * centre as the route's own turn would be: the inner line by a smaller radius,
 * the outer by a larger one. The lines stop at the base of the arrowheads (one
 * head per end, grown to cover the bundle, `bundleArrowheadScale()`).
 *
 * The edge's `path.connection` stays the route itself, so inspection and the
 * editable PPTX see one line; the painted lines are what the geometry lint
 * measures (`paintedEdges()`).
 */

import type { Point } from "../core/geometry";
import type { Arc } from "./wire";

/** The control-point distance of a quarter circle of radius 1 as a cubic. */
const KAPPA = 0.5522847498307936;

/** One line of a bundle: its straight pieces and arcs, and its SVG path data. */
export interface Strand {
  readonly pieces: readonly (readonly [Point, Point])[];
  readonly arcs: readonly Arc[];
  /** The line in drawing order: its points, and an arc after a point where it turns round. */
  readonly path: readonly (Point | Arc)[];
}

const unitOf = (a: Point, b: Point): Point => {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  return length === 0 ? { x: 0, y: 0 } : { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
};

/** The left normal of a direction in SVG coordinates (y down): left of travel. */
const normal = (d: Point): Point => ({ x: d.y, y: -d.x });

/** Removes repeated points and points on a straight run (they make no turn). */
function simplify(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out.at(-1);
    if (last !== undefined && last.x === p.x && last.y === p.y) continue;
    if (out.length >= 2) {
      const a = out[out.length - 2] as Point;
      const b = last as Point;
      const u = unitOf(a, b);
      const v = unitOf(b, p);
      if (Math.abs(u.x * v.y - u.y * v.x) < 1e-9 && u.x * v.x + u.y * v.y > 0) out.pop();
    }
    out.push(p);
  }
  return out;
}

/**
 * The lines of a bundle of `count` along the polyline `points` (the wire,
 * already stopped at the arrowheads' bases): line `i` is offset
 * `(i − (count − 1) / 2) · spacing` to the left of travel. Right-angle turns
 * are rounded with `radius` about the route's turn centre (a line on the
 * inside gets `radius − offset`, sharp when that is not positive), and each
 * radius is at most half of either leg, as the wires' own turns; other turns
 * stay mitred.
 */
export function bundleStrands(
  points: readonly Point[],
  count: number,
  spacing: number,
  radius: number,
): Strand[] {
  const path = simplify(points);
  if (path.length < 2) return [];
  const dirs = path.slice(1).map((p, i) => unitOf(path[i] as Point, p));
  const strands: Strand[] = [];
  for (let i = 0; i < count; i++) {
    const offset = (i - (count - 1) / 2) * spacing;
    // The offset polyline: endpoints moved along their segment's normal, turns mitred.
    const shifted: Point[] = path.map((p, j) => {
      const before = dirs[j - 1];
      const after = dirs[j];
      if (before === undefined || after === undefined) {
        const d = (before ?? after) as Point;
        const n = normal(d);
        return { x: p.x + n.x * offset, y: p.y + n.y * offset };
      }
      const n1 = normal(before);
      const n2 = normal(after);
      const denominator = 1 + n1.x * n2.x + n1.y * n2.y;
      const scale = denominator < 1e-6 ? 1 : offset / denominator;
      return { x: p.x + (n1.x + n2.x) * scale, y: p.y + (n1.y + n2.y) * scale };
    });
    const pieces: [Point, Point][] = [];
    const arcs: Arc[] = [];
    const drawn: (Point | Arc)[] = [shifted[0] as Point];
    let start = shifted[0] as Point;
    for (let j = 1; j < shifted.length - 1; j++) {
      const corner = shifted[j] as Point;
      const u = dirs[j - 1] as Point;
      const v = dirs[j] as Point;
      const right = Math.abs(u.x * v.x + u.y * v.y) < 1e-9;
      // A left turn has its centre on the left: a line offset to the left is inside it.
      const left = u.x * v.y - u.y * v.x < 0;
      const legs = Math.min(
        Math.hypot(
          (path[j] as Point).x - (path[j - 1] as Point).x,
          (path[j] as Point).y - (path[j - 1] as Point).y,
        ),
        Math.hypot(
          (path[j + 1] as Point).x - (path[j] as Point).x,
          (path[j + 1] as Point).y - (path[j] as Point).y,
        ),
      );
      const base = Math.min(radius, legs / 2);
      // Sharp corners (radius 0, `edgeCorners: sharp`) stay sharp on every line: the mitred points.
      const r = right && base > 0 ? base - (left ? offset : -offset) : 0;
      if (r <= 0) {
        pieces.push([start, corner]);
        drawn.push(corner);
        start = corner;
        continue;
      }
      const from = { x: corner.x - u.x * r, y: corner.y - u.y * r };
      const to = { x: corner.x + v.x * r, y: corner.y + v.y * r };
      pieces.push([start, from]);
      const arc = {
        from,
        c1: { x: from.x + u.x * r * KAPPA, y: from.y + u.y * r * KAPPA },
        c2: { x: to.x - v.x * r * KAPPA, y: to.y - v.y * r * KAPPA },
        to,
      };
      arcs.push(arc);
      drawn.push(from, arc);
      start = to;
    }
    pieces.push([start, shifted.at(-1) as Point]);
    drawn.push(shifted.at(-1) as Point);
    strands.push({ pieces, arcs, path: drawn });
  }
  return strands;
}

/** SVG path data of a strand, with `n` formatting each coordinate. */
export function strandPathData(strand: Strand, n: (value: number) => string): string {
  const xy = (p: Point) => `${n(p.x)} ${n(p.y)}`;
  return strand.path
    .map((step, i) =>
      "c1" in step
        ? `C ${xy(step.c1)} ${xy(step.c2)} ${xy(step.to)}`
        : `${i === 0 ? "M" : "L"} ${xy(step)}`,
    )
    .join(" ");
}
