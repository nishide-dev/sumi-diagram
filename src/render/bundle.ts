/**
 * Bundles of parallel lines (#614, `edges[].strands`, design record
 * `docs/design/decisions/614-missing-parts.md`): an edge drawn as `n` lines
 * along its route, `strandSpacing()` apart, e.g. the residual streams of a
 * hyper-connection. Each line is the route offset sideways (mitred at the
 * turns, so the lines stay parallel), and its turns are rounded about the same
 * centre as the route's own turn would be: the inner line by a smaller radius,
 * the outer by a larger one, each at most what the line's own legs leave. Each
 * line stops where it meets the back of its arrowhead (`strandHeadInset()`:
 * one head per end, grown to cover the bundle, `bundleArrowheadScale()`).
 *
 * A bend too tight for the bundle's width (a leg of an inner line would run
 * backwards or vanish) squeezes the whole bundle: the spacing shrinks until
 * every line runs forward on every leg, so every line is drawn, parallel, and
 * never doubles back; a corner whose legs leave no room for an arc stays sharp
 * (mitred).
 *
 * The edge's `path.connection` stays the route itself, so inspection and the
 * editable PPTX see one line; the painted lines are what the geometry lint
 * measures (`paintedEdges()`).
 */

import type { Point } from "../core/geometry";
import type { Arrowhead } from "../core/registry/manifest";
import type { Arc } from "./wire";

/** The control-point distance of a quarter circle of radius 1 as a cubic. */
const KAPPA = 0.5522847498307936;

/** Shorter pieces are dropped (units). */
const EPSILON = 1e-6;

/** One line of a bundle: its straight pieces and arcs, and its SVG path data. */
export interface Strand {
  /** The line's offset from the route, left of travel (units). */
  readonly offset: number;
  readonly pieces: readonly (readonly [Point, Point])[];
  readonly arcs: readonly Arc[];
  /** The line in drawing order: its points, and an arc after a point where it turns round. */
  readonly path: readonly (Point | Arc)[];
}

/** How far from the route's ends (along it) a line of the bundle stops, by its offset. */
export type StrandTrim = (offset: number) => { readonly start: number; readonly end: number };

const unitOf = (a: Point, b: Point): Point => {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  return length === 0 ? { x: 0, y: 0 } : { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
};

const dot = (a: Point, b: Point): number => a.x * b.x + a.y * b.y;
const distance = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y);

/** The left normal of a direction in SVG coordinates (y down): left of travel. */
const normal = (d: Point): Point => ({ x: d.y, y: -d.x });

/** Removes repeated points and points on a straight run (they make no turn). */
function simplify(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out.at(-1);
    if (last !== undefined && distance(last, p) < EPSILON) continue;
    if (out.length >= 2) {
      const a = out[out.length - 2] as Point;
      const b = last as Point;
      const u = unitOf(a, b);
      const v = unitOf(b, p);
      if (Math.abs(u.x * v.y - u.y * v.x) < 1e-9 && dot(u, v) > 0) out.pop();
    }
    out.push(p);
  }
  return out;
}

/**
 * Where a line `offset` from the axis meets the back of an arrowhead `length`
 * long and as wide, as a distance from the tip, for the shapes
 * `drawArrowhead()` draws: the triangle and the box end on their base; the
 * `arrow` on its notched back edge (60% of the length on the axis, the full
 * length at the barbs); the `open` chevron on its arm (from its vertex, at
 * 45°); the diamond and the circle on their rear outline (a line beside the
 * diamond's narrower body stops level with its widest point). `none` and
 * `cross` take none.
 */
export function strandHeadInset(
  head: Arrowhead | undefined,
  length: number,
  strokeUnits: number,
  offset: number,
): number {
  const half = length / 2;
  const o = Math.min(Math.abs(offset), half);
  switch (head) {
    case undefined:
    case "none":
    case "cross":
      return 0;
    case "arrow":
      return 0.6 * length + (0.4 * length * o) / half;
    case "open": {
      // `openArrowhead()`: the vertex is a stroke and a half from the tip, the arms reach half - stroke/2.
      const vertex = 1.5 * strokeUnits;
      return vertex + Math.min(o, half - strokeUnits / 2);
    }
    case "diamond":
      // Rear edges from (half, ±0.8·half) to (length, 0).
      return o <= 0.8 * half ? length - o / 0.8 : half;
    case "circle":
      return half + Math.sqrt(Math.max(0, half * half - o * o));
    default:
      return length;
  }
}

/** Removes `amount` from the start of a polyline (keeps at least its last point). */
function trimStart(points: readonly Point[], amount: number): Point[] {
  const out = [...points];
  let left = amount;
  while (left > 0 && out.length >= 2) {
    const a = out[0] as Point;
    const b = out[1] as Point;
    const length = distance(a, b);
    if (length > left) {
      const t = left / length;
      out[0] = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      return out;
    }
    out.shift();
    left -= length;
  }
  return out;
}

/** The route offset sideways by `offset` (left of travel), mitred at the turns. */
function shifted(path: readonly Point[], dirs: readonly Point[], offset: number): Point[] {
  return path.map((p, j) => {
    const before = dirs[j - 1];
    const after = dirs[j];
    if (before === undefined || after === undefined) {
      const n = normal((before ?? after) as Point);
      return { x: p.x + n.x * offset, y: p.y + n.y * offset };
    }
    const n1 = normal(before);
    const n2 = normal(after);
    const denominator = 1 + dot(n1, n2);
    const scale = denominator < 1e-6 ? 1 : offset / denominator;
    return { x: p.x + (n1.x + n2.x) * scale, y: p.y + (n1.y + n2.y) * scale };
  });
}

/**
 * Whether an offset line, cut `start` / `end` from its ends, runs forward on
 * every leg: no leg backwards or empty, and the cuts within the end legs.
 */
function runsForward(
  line: readonly Point[],
  dirs: readonly Point[],
  start: number,
  end: number,
): boolean {
  for (let j = 1; j < line.length; j++) {
    const a = line[j - 1] as Point;
    const b = line[j] as Point;
    if (dot({ x: b.x - a.x, y: b.y - a.y }, dirs[j - 1] as Point) <= EPSILON) return false;
  }
  const first = distance(line[0] as Point, line[1] as Point);
  const last = distance(line.at(-2) as Point, line.at(-1) as Point);
  return line.length === 2 ? first > start + end + EPSILON : first > start && last > end;
}

/**
 * The lines of a bundle of `count` along the polyline `points` (the route from
 * tip to tip): line `i` is offset `(i − (count − 1) / 2) · spacing` to the left
 * of travel and stops `trim(offset)` from each end. Right-angle turns are
 * rounded with `radius` about the route's turn centre (a line on the inside
 * gets `radius − offset`), at most the line's own incoming leg (what is left
 * of it) and half its outgoing leg (all of it on the last leg); a line left
 * without an arc keeps the sharp mitred corner, and so do all with `radius`
 * 0. Other turns stay mitred. A bend too tight for the bundle squeezes its
 * spacing (see the module comment).
 */
export function bundleStrands(
  points: readonly Point[],
  count: number,
  spacing: number,
  radius: number,
  trim: StrandTrim = () => ({ start: 0, end: 0 }),
): Strand[] {
  const path = simplify(points);
  if (path.length < 2) return [];
  const dirs = path.slice(1).map((p, i) => unitOf(path[i] as Point, p));
  const lines = (gap: number) =>
    Array.from({ length: count }, (_, i) => {
      const offset = (i - (count - 1) / 2) * gap;
      return { offset, line: shifted(path, dirs, offset), ...trim(offset) };
    });
  const fits = (gap: number) =>
    lines(gap).every(({ line, start, end }) => runsForward(line, dirs, start, end));
  let gap = spacing;
  for (let tries = 0; tries < 60 && !fits(gap); tries++) gap *= 0.85;
  if (!fits(gap)) gap = 0;
  const strands: Strand[] = [];
  for (const { offset, line, start, end } of lines(gap)) {
    const own = trimStart(trimStart(line, start).reverse(), end).reverse();
    if (own.length < 2) continue;
    const pieces: [Point, Point][] = [];
    const arcs: Arc[] = [];
    const drawn: (Point | Arc)[] = [own[0] as Point];
    let at = own[0] as Point;
    const piece = (to: Point) => {
      if (distance(at, to) >= EPSILON) pieces.push([at, to]);
      at = to;
    };
    for (let j = 1; j < own.length - 1; j++) {
      const corner = own[j] as Point;
      const next = own[j + 1] as Point;
      const u = unitOf(own[j - 1] as Point, corner);
      const v = unitOf(corner, next);
      const right = Math.abs(dot(u, v)) < 1e-9;
      // A left turn has its centre on the left: a line offset to the left is inside it.
      const left = u.x * v.y - u.y * v.x < 0;
      // Sharp corners (radius 0, `edgeCorners: sharp`) stay sharp on every line.
      const wanted = right && radius > 0 ? radius - (left ? offset : -offset) : 0;
      const room = Math.min(
        distance(at, corner),
        distance(corner, next) / (j + 1 < own.length - 1 ? 2 : 1),
      );
      const r = Math.min(wanted, room);
      if (r <= EPSILON) {
        piece(corner);
        drawn.push(corner);
        continue;
      }
      const from = { x: corner.x - u.x * r, y: corner.y - u.y * r };
      const to = { x: corner.x + v.x * r, y: corner.y + v.y * r };
      piece(from);
      const arc = {
        from,
        c1: { x: from.x + u.x * r * KAPPA, y: from.y + u.y * r * KAPPA },
        c2: { x: to.x - v.x * r * KAPPA, y: to.y - v.y * r * KAPPA },
        to,
      };
      arcs.push(arc);
      drawn.push(from, arc);
      at = to;
    }
    piece(own.at(-1) as Point);
    drawn.push(own.at(-1) as Point);
    strands.push({ offset, pieces, arcs, path: drawn });
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

/** The length of a strand: its straight pieces and its quarter circles (`πr/2` each). */
export function strandLength(strand: Strand): number {
  const straight = strand.pieces.reduce((sum, [a, b]) => sum + distance(a, b), 0);
  const arcs = strand.arcs.reduce(
    (sum, arc) => sum + ((Math.PI / 2) * distance(arc.from, arc.to)) / Math.SQRT2,
    0,
  );
  return straight + arcs;
}
