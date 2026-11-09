/**
 * Oriented ellipses for set enclosures (#430, design record 430): the
 * smallest-area ellipse around a point set, either at the orientation that
 * gives the least area (`auto`, Khachiyan's algorithm for the minimum-volume
 * enclosing ellipsoid) or at a given angle (the axes fixed, the aspect ratio
 * searched). Pure geometry in layout units.
 *
 * The padding is applied before the fit: every point is replaced by a polygon
 * circumscribing the disc of radius `padding` about it, so the fitted ellipse
 * keeps at least `padding` of clearance from the original points, wherever on
 * its boundary they lie (growing an ellipse's two axes by the padding would
 * leave less than `padding` on its flat sides).
 */

import type { Point } from "./ir";

/** An ellipse: its center, semi-axes and the rotation of its `rx` axis (degrees, clockwise on screen). */
export interface OrientedEllipse {
  readonly cx: number;
  readonly cy: number;
  readonly rx: number;
  readonly ry: number;
  readonly angle: number;
}

const EPSILON = 1e-9;
/** Samples of the disc around a point (a multiple of 4); the polygon circumscribes the disc. */
const PADDING_SAMPLES = 32;
/** The smallest clearance fitted, so a degenerate set (a point or a line) still has an area. */
const MIN_CLEARANCE = 0.05;
/** The aspect ratio (rx : ry) searched for a given angle is within 1 : this. */
const MAX_SEARCH_ASPECT = 400;
const GOLDEN = (Math.sqrt(5) - 1) / 2;

/** The convex hull (Andrew's monotone chain), counter-clockwise in math orientation; no repeats. */
function hullOf(points: readonly Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const unique = sorted.filter((p, i) => {
    const q = sorted[i - 1];
    return q === undefined || Math.abs(p.x - q.x) > EPSILON || Math.abs(p.y - q.y) > EPSILON;
  });
  if (unique.length <= 2) return unique;
  const cross = (o: Point, a: Point, b: Point) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const build = (list: readonly Point[]) => {
    const chain: Point[] = [];
    for (const p of list) {
      while (
        chain.length >= 2 &&
        cross(chain[chain.length - 2] as Point, chain[chain.length - 1] as Point, p) <= EPSILON
      )
        chain.pop();
      chain.push(p);
    }
    chain.pop();
    return chain;
  };
  return [...build(unique), ...build([...unique].reverse())];
}

/**
 * The points an ellipse must contain to keep `padding` clear of `points`: the
 * hull of the points, each vertex replaced by a polygon around the disc of
 * radius `padding` (the polygon's sides are tangent to the disc at their
 * midpoints, so it contains the disc), reduced to its convex hull.
 */
export function paddedHull(points: readonly Point[], padding: number): Point[] {
  const radius = Math.max(padding, MIN_CLEARANCE);
  const k = radius / Math.cos(Math.PI / PADDING_SAMPLES);
  const ring = Array.from({ length: PADDING_SAMPLES }, (_, i) => {
    const a = (i / PADDING_SAMPLES) * 2 * Math.PI;
    return { x: k * Math.cos(a), y: k * Math.sin(a) };
  });
  return hullOf(hullOf(points).flatMap((p) => ring.map((q) => ({ x: p.x + q.x, y: p.y + q.y }))));
}

/** Whether `p` is inside (or on) the ellipse, within `slack` of its normalized radius. */
function normalizedRadius(p: Point, e: OrientedEllipse): number {
  const a = (e.angle * Math.PI) / 180;
  const dx = p.x - e.cx;
  const dy = p.y - e.cy;
  const u = dx * Math.cos(a) + dy * Math.sin(a);
  const v = -dx * Math.sin(a) + dy * Math.cos(a);
  return Math.hypot(u / e.rx, v / e.ry);
}

/** The ellipse grown about its center, if need be, until it contains every point. */
function containing(e: OrientedEllipse, points: readonly Point[]): OrientedEllipse {
  const worst = Math.max(...points.map((p) => normalizedRadius(p, e)));
  if (worst <= 1) return e;
  return { ...e, rx: e.rx * worst, ry: e.ry * worst };
}

/** Folds an angle in degrees into (-90, 90], the range of a major-axis direction. */
export function foldAngle(degrees: number): number {
  let a = degrees % 180;
  if (a <= -90) a += 180;
  if (a > 90) a -= 180;
  return a;
}

/** Orders the axes so that `rx` is the longer and folds the angle; a circle gets angle 0. */
function normalized(e: OrientedEllipse): OrientedEllipse {
  const [rx, ry, angle] = e.rx >= e.ry ? [e.rx, e.ry, e.angle] : [e.ry, e.rx, e.angle + 90];
  return rx - ry <= 1e-9 * rx
    ? { cx: e.cx, cy: e.cy, rx, ry: rx, angle: 0 }
    : { cx: e.cx, cy: e.cy, rx, ry, angle: foldAngle(angle) };
}

/**
 * The minimum-area ellipse around the points (Khachiyan, 1979: a Frank-Wolfe
 * ascent on the dual weights; deterministic), grown by the last bit of its
 * tolerance so it contains every point. `rx` is the longer axis.
 */
export function minimumAreaEllipse(points: readonly Point[]): OrientedEllipse {
  const n = points.length;
  if (n === 0) return { cx: 0, cy: 0, rx: 0, ry: 0, angle: 0 };
  // Work around the centroid, which keeps the matrix well conditioned.
  const mx = points.reduce((s, p) => s + p.x, 0) / n;
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  const q = points.map((p) => ({ x: p.x - mx, y: p.y - my }));
  const u = new Array<number>(n).fill(1 / n);
  for (let iteration = 0; iteration < 10000; iteration++) {
    // X = sum u_i (x, y, 1)(x, y, 1)^T, a symmetric 3x3 matrix.
    let xx = 0;
    let xy = 0;
    let yy = 0;
    let x1 = 0;
    let y1 = 0;
    let w = 0;
    for (let i = 0; i < n; i++) {
      const p = q[i] as Point;
      const ui = u[i] as number;
      xx += ui * p.x * p.x;
      xy += ui * p.x * p.y;
      yy += ui * p.y * p.y;
      x1 += ui * p.x;
      y1 += ui * p.y;
      w += ui;
    }
    // Inverse of the symmetric matrix [[xx, xy, x1], [xy, yy, y1], [x1, y1, w]].
    const c00 = yy * w - y1 * y1;
    const c01 = x1 * y1 - xy * w;
    const c02 = xy * y1 - yy * x1;
    const c11 = xx * w - x1 * x1;
    const c12 = xy * x1 - xx * y1;
    const c22 = xx * yy - xy * xy;
    const det = xx * c00 + xy * c01 + x1 * c02;
    if (Math.abs(det) < 1e-300) break;
    let best = -1;
    let bestValue = -Infinity;
    for (let i = 0; i < n; i++) {
      const p = q[i] as Point;
      const m =
        (c00 * p.x * p.x + c11 * p.y * p.y + c22 + 2 * (c01 * p.x * p.y + c02 * p.x + c12 * p.y)) /
        det;
      if (m > bestValue) {
        bestValue = m;
        best = i;
      }
    }
    const step = (bestValue - 3) / (3 * (bestValue - 1));
    if (!(step > 1e-10)) break;
    for (let i = 0; i < n; i++) u[i] = (1 - step) * (u[i] as number);
    u[best] = (u[best] as number) + step;
  }
  // Center and shape matrix: A = (1/2) (P U P^T - c c^T)^-1.
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    const p = q[i] as Point;
    cx += (u[i] as number) * p.x;
    cy += (u[i] as number) * p.y;
  }
  let sxx = -cx * cx;
  let sxy = -cx * cy;
  let syy = -cy * cy;
  for (let i = 0; i < n; i++) {
    const p = q[i] as Point;
    const ui = u[i] as number;
    sxx += ui * p.x * p.x;
    sxy += ui * p.x * p.y;
    syy += ui * p.y * p.y;
  }
  // The ellipse is { x : (x-c)^T (S/2)^-1 (x-c) <= 1 }: its semi-axes are sqrt(2 lambda) for S's eigenvalues.
  const mean = (sxx + syy) / 2;
  const diff = Math.hypot((sxx - syy) / 2, sxy);
  const l1 = Math.max(mean + diff, 0);
  const l2 = Math.max(mean - diff, 0);
  const angle = (0.5 * Math.atan2(2 * sxy, sxx - syy) * 180) / Math.PI;
  const ellipse: OrientedEllipse = {
    cx: cx + mx,
    cy: cy + my,
    rx: Math.sqrt(2 * l1),
    ry: Math.sqrt(2 * l2),
    angle,
  };
  return normalized(containing(ellipse, points));
}

/** The point set turned by `-degrees` about the origin (into the ellipse's own frame). */
function turned(points: readonly Point[], degrees: number): Point[] {
  const a = (degrees * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return points.map((p) => ({ x: p.x * c + p.y * s, y: -p.x * s + p.y * c }));
}

/** The smallest circle around the points (iterative Welzl). */
function enclosingCircle(points: readonly Point[]): { cx: number; cy: number; r: number } {
  const first = points[0];
  if (first === undefined) return { cx: 0, cy: 0, r: 0 };
  type C = { cx: number; cy: number; r: number };
  const inside = (p: Point, c: C) =>
    Math.hypot(p.x - c.cx, p.y - c.cy) <= c.r * (1 + 1e-12) + EPSILON;
  const of2 = (a: Point, b: Point): C => ({
    cx: (a.x + b.x) / 2,
    cy: (a.y + b.y) / 2,
    r: Math.hypot(a.x - b.x, a.y - b.y) / 2,
  });
  const of3 = (a: Point, b: Point, c: Point): C => {
    const bx = b.x - a.x;
    const by = b.y - a.y;
    const cx = c.x - a.x;
    const cy = c.y - a.y;
    const d = 2 * (bx * cy - by * cx);
    if (Math.abs(d) < EPSILON) {
      return [of2(a, b), of2(a, c), of2(b, c)].reduce((best, p) => (p.r > best.r ? p : best));
    }
    const ux = (cy * (bx * bx + by * by) - by * (cx * cx + cy * cy)) / d;
    const uy = (bx * (cx * cx + cy * cy) - cx * (bx * bx + by * by)) / d;
    return { cx: a.x + ux, cy: a.y + uy, r: Math.hypot(ux, uy) };
  };
  let c: C = { cx: first.x, cy: first.y, r: 0 };
  for (let i = 1; i < points.length; i++) {
    const pi = points[i] as Point;
    if (inside(pi, c)) continue;
    c = { cx: pi.x, cy: pi.y, r: 0 };
    for (let j = 0; j < i; j++) {
      const pj = points[j] as Point;
      if (inside(pj, c)) continue;
      c = of2(pi, pj);
      for (let k = 0; k < j; k++) {
        const pk = points[k] as Point;
        if (!inside(pk, c)) c = of3(pi, pj, pk);
      }
    }
  }
  return c;
}

/**
 * The minimum-area ellipse whose `rx` axis points along `angle` (degrees):
 * the points are turned into that frame, and the aspect ratio that minimizes
 * the area (the area of the smallest circle around the points squeezed by
 * the ratio, times the ratio) is found by a golden-section search.
 */
export function minimumAreaEllipseAt(points: readonly Point[], angle: number): OrientedEllipse {
  if (points.length === 0) return { cx: 0, cy: 0, rx: 0, ry: 0, angle };
  const frame = turned(points, angle);
  const fit = (logRatio: number) => {
    const ratio = Math.exp(logRatio);
    const c = enclosingCircle(frame.map((p) => ({ x: p.x / ratio, y: p.y })));
    return { c, ratio, area: ratio * c.r * c.r };
  };
  let lo = -Math.log(MAX_SEARCH_ASPECT);
  let hi = Math.log(MAX_SEARCH_ASPECT);
  let a = hi - GOLDEN * (hi - lo);
  let b = lo + GOLDEN * (hi - lo);
  let fa = fit(a).area;
  let fb = fit(b).area;
  for (let i = 0; i < 80; i++) {
    if (fa <= fb) {
      hi = b;
      b = a;
      fb = fa;
      a = hi - GOLDEN * (hi - lo);
      fa = fit(a).area;
    } else {
      lo = a;
      a = b;
      fa = fb;
      b = lo + GOLDEN * (hi - lo);
      fb = fit(b).area;
    }
  }
  const best = fit((lo + hi) / 2);
  const rad = (angle * Math.PI) / 180;
  const fx = best.c.cx * best.ratio;
  const fy = best.c.cy;
  const ellipse: OrientedEllipse = {
    cx: fx * Math.cos(rad) - fy * Math.sin(rad),
    cy: fx * Math.sin(rad) + fy * Math.cos(rad),
    rx: best.c.r * best.ratio,
    ry: best.c.r,
    angle,
  };
  return containing(ellipse, points);
}

/**
 * The ellipse around the members' points with at least `padding` of room
 * everywhere: at the orientation that needs the least area (`"auto"`), or
 * with its `rx` axis along the given angle (degrees, clockwise on screen).
 * An automatic fit has its longer axis as `rx` and an angle in (-90, 90].
 */
export function fitOrientedEllipse(
  points: readonly Point[],
  padding: number,
  angle: number | "auto",
): OrientedEllipse {
  const around = paddedHull(points, padding);
  if (angle !== "auto") return minimumAreaEllipseAt(around, angle);
  // The angle is kept to 1/1000 degree, so the final fit is made at the rounded angle.
  const auto = minimumAreaEllipse(around);
  if (auto.rx === auto.ry) return auto;
  return minimumAreaEllipseAt(around, Math.round(auto.angle * 1000) / 1000);
}
