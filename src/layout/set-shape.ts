/**
 * The outline of a set enclosure (#407, design record 407): a circle, an
 * ellipse, a rounded convex hull or a rounded rectangle fitted around the
 * footprints of the members, plus the place of its label. Pure geometry in
 * layout units (1 unit = 0.5pt), without the structured engine, so the
 * figure's tests and the lint can use the same fit.
 *
 * Fitting works on points: the corners of a rectangular member, or samples
 * of a round (circle / oval) member's boundary. The padding is the room
 * between the members and the outline: the outline is the smallest shape of
 * its kind that contains every point, grown by the padding.
 */

import type { SetLabelPosition, SetShape } from "../core/figure/schema";
import type { Point, Rect, SetOutline, SetSegment } from "./ir";

/** A member's footprint: its box, and whether its shape is round (a circle or oval). */
export interface MemberFootprint {
  readonly rect: Rect;
  readonly round: boolean;
}

/** Samples of a round member's boundary (a multiple of 4: the axis points are exact). */
const ROUND_SAMPLES = 32;
const EPSILON = 1e-9;
/** An ellipse is at most this much wider than tall (or the reverse). */
export const MAX_ELLIPSE_ASPECT = 3;
const SEGMENTS_PER_QUARTER = 1;

/** The points that stand for a member: four corners, or samples of an ellipse. */
export function footprintPoints({ rect, round }: MemberFootprint): Point[] {
  const { x, y, width, height } = rect;
  if (!round) {
    return [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
    ];
  }
  const cx = x + width / 2;
  const cy = y + height / 2;
  return Array.from({ length: ROUND_SAMPLES }, (_, i) => {
    const a = (i / ROUND_SAMPLES) * 2 * Math.PI;
    return { x: cx + (width / 2) * Math.cos(a), y: cy + (height / 2) * Math.sin(a) };
  });
}

interface Circle {
  cx: number;
  cy: number;
  r: number;
}

const dist = (p: Point, c: Circle): number => Math.hypot(p.x - c.cx, p.y - c.cy);

function circleOf2(a: Point, b: Point): Circle {
  return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, r: Math.hypot(a.x - b.x, a.y - b.y) / 2 };
}

function circleOf3(a: Point, b: Point, c: Point): Circle {
  const bx = b.x - a.x;
  const by = b.y - a.y;
  const cx = c.x - a.x;
  const cy = c.y - a.y;
  const d = 2 * (bx * cy - by * cx);
  // Collinear points: the circle on the two farthest ones.
  if (Math.abs(d) < EPSILON) {
    const pairs = [circleOf2(a, b), circleOf2(a, c), circleOf2(b, c)];
    return pairs.reduce((best, p) => (p.r > best.r ? p : best));
  }
  const ux = (cy * (bx * bx + by * by) - by * (cx * cx + cy * cy)) / d;
  const uy = (bx * (cx * cx + cy * cy) - cx * (bx * bx + by * by)) / d;
  return { cx: a.x + ux, cy: a.y + uy, r: Math.hypot(ux, uy) };
}

/**
 * The smallest circle containing every point (the iterative form of Welzl's
 * algorithm; deterministic, exact for the few dozen points a set has).
 */
export function minimumEnclosingCircle(points: readonly Point[]): Circle {
  const first = points[0];
  if (first === undefined) return { cx: 0, cy: 0, r: 0 };
  const inside = (p: Point, c: Circle) => dist(p, c) <= c.r * (1 + 1e-12) + EPSILON;
  let c: Circle = { cx: first.x, cy: first.y, r: 0 };
  for (let i = 1; i < points.length; i++) {
    const pi = points[i] as Point;
    if (inside(pi, c)) continue;
    c = { cx: pi.x, cy: pi.y, r: 0 };
    for (let j = 0; j < i; j++) {
      const pj = points[j] as Point;
      if (inside(pj, c)) continue;
      c = circleOf2(pi, pj);
      for (let k = 0; k < j; k++) {
        const pk = points[k] as Point;
        if (!inside(pk, c)) c = circleOf3(pi, pj, pk);
      }
    }
  }
  return c;
}

function bounds(points: readonly Point[]): Rect {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/**
 * The convex hull, clockwise on the screen (y down) i.e. with a positive
 * shoelace sum, without repeated or collinear points (Andrew's monotone chain).
 */
export function convexHull(points: readonly Point[]): Point[] {
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
  const lower = build(unique);
  const upper = build([...unique].reverse());
  return [...lower, ...upper];
}

/** The arc of radius `r` about `c`, from angle `a0` turning by `delta` (radians), as cubics. */
function arcSegments(c: Point, r: number, a0: number, delta: number): SetSegment[] {
  const pieces = Math.max(
    1,
    Math.ceil(Math.abs(delta) / (Math.PI / 2 / SEGMENTS_PER_QUARTER) - 1e-9),
  );
  const step = delta / pieces;
  const k = (4 / 3) * Math.tan(step / 4);
  const out: SetSegment[] = [];
  for (let i = 0; i < pieces; i++) {
    const a = a0 + i * step;
    const b = a + step;
    const at = (t: number): Point => ({ x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t) });
    const tangent = (t: number): Point => ({ x: -Math.sin(t) * r, y: Math.cos(t) * r });
    const p0 = at(a);
    const p1 = at(b);
    const t0 = tangent(a);
    const t1 = tangent(b);
    out.push({
      command: "C",
      c1: { x: p0.x + k * t0.x, y: p0.y + k * t0.y },
      c2: { x: p1.x - k * t1.x, y: p1.y - k * t1.y },
      to: p1,
    });
  }
  return out;
}

/**
 * A convex polygon grown by `radius` with round corners (its Minkowski sum
 * with a disc): straight sides, offset outward, joined by circular arcs at
 * the vertices, as one closed path of lines and cubics. A one-point polygon
 * gives a circle; a two-point one a stadium.
 */
export function roundedHull(hull: readonly Point[], radius: number): SetSegment[] {
  if (hull.length === 0) return [];
  if (hull.length === 1) {
    const p = hull[0] as Point;
    return [
      { command: "M", to: { x: p.x + radius, y: p.y } },
      ...arcSegments(p, radius, 0, Math.PI * 2),
    ];
  }
  const n = hull.length;
  const normals = hull.map((p, i) => {
    const q = hull[(i + 1) % n] as Point;
    const length = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    // Outward for a polygon with a positive shoelace sum.
    return { x: (q.y - p.y) / length, y: -(q.x - p.x) / length };
  });
  const out: SetSegment[] = [];
  for (let i = 0; i < n; i++) {
    const p = hull[i] as Point;
    const q = hull[(i + 1) % n] as Point;
    const nm = normals[i] as Point;
    const next = normals[(i + 1) % n] as Point;
    const start = { x: p.x + nm.x * radius, y: p.y + nm.y * radius };
    const end = { x: q.x + nm.x * radius, y: q.y + nm.y * radius };
    out.push(i === 0 ? { command: "M", to: start } : { command: "L", to: start });
    out.push({ command: "L", to: end });
    const a0 = Math.atan2(nm.y, nm.x);
    let delta = Math.atan2(next.y, next.x) - a0;
    while (delta < 0) delta += Math.PI * 2;
    while (delta >= Math.PI * 2) delta -= Math.PI * 2;
    out.push(...arcSegments(q, radius, a0, delta));
  }
  return out;
}

/** The path's points, cubics sampled (for the support function and the lint's polygons). */
export function samplePath(segments: readonly SetSegment[], steps = 12): Point[] {
  const out: Point[] = [];
  let at: Point | undefined;
  for (const s of segments) {
    if (s.command === "C" && at !== undefined) {
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const u = 1 - t;
        out.push({
          x:
            u * u * u * at.x + 3 * u * u * t * s.c1.x + 3 * u * t * t * s.c2.x + t * t * t * s.to.x,
          y:
            u * u * u * at.y + 3 * u * u * t * s.c1.y + 3 * u * t * t * s.c2.y + t * t * t * s.to.y,
        });
      }
    } else out.push(s.to);
    at = s.to;
  }
  return out;
}

/** Fits the outline of `shape` around the members. `radius` rounds a `rect`'s corners. */
export function fitSetOutline(
  members: readonly MemberFootprint[],
  shape: SetShape,
  padding: number,
  radius = 0,
): SetOutline {
  const points = members.flatMap(footprintPoints);
  if (points.length === 0) throw new Error("internal error: a set without members");
  switch (shape) {
    case "circle": {
      const c = minimumEnclosingCircle(points);
      return { kind: "ellipse", cx: c.cx, cy: c.cy, rx: c.r + padding, ry: c.r + padding };
    }
    case "ellipse": {
      const box = bounds(points);
      const ratio =
        box.height < EPSILON
          ? MAX_ELLIPSE_ASPECT
          : box.width < EPSILON
            ? 1 / MAX_ELLIPSE_ASPECT
            : Math.min(
                MAX_ELLIPSE_ASPECT,
                Math.max(1 / MAX_ELLIPSE_ASPECT, box.width / box.height),
              );
      const c = minimumEnclosingCircle(points.map((p) => ({ x: p.x / ratio, y: p.y })));
      return {
        kind: "ellipse",
        cx: c.cx * ratio,
        cy: c.cy,
        rx: c.r * ratio + padding,
        ry: c.r + padding,
      };
    }
    case "rect": {
      const box = bounds(points);
      const rect = {
        x: box.x - padding,
        y: box.y - padding,
        width: box.width + 2 * padding,
        height: box.height + 2 * padding,
      };
      return {
        kind: "rect",
        rect,
        radius: Math.max(0, Math.min(radius, rect.width / 2, rect.height / 2)),
      };
    }
    case "hull":
      return { kind: "path", segments: roundedHull(convexHull(points), padding) };
  }
}

/** The smallest rectangle around an outline's drawing (stroke not included). */
export function outlineBounds(outline: SetOutline): Rect {
  switch (outline.kind) {
    case "ellipse":
      return {
        x: outline.cx - outline.rx,
        y: outline.cy - outline.ry,
        width: 2 * outline.rx,
        height: 2 * outline.ry,
      };
    case "rect":
      return outline.rect;
    case "path":
      return pathBounds(outline.segments);
  }
}

/** The exact bounds of a closed path of lines and cubics (the cubic's extrema included). */
function pathBounds(segments: readonly SetSegment[]): Rect {
  const points = samplePath(segments, 32);
  return bounds(points);
}

/** The outline as a convex polygon (an ellipse sampled), for containment tests. */
export function outlinePolygon(outline: SetOutline): Point[] {
  switch (outline.kind) {
    case "ellipse": {
      const steps = 96;
      return Array.from({ length: steps }, (_, i) => {
        const a = (i / steps) * 2 * Math.PI;
        return {
          x: outline.cx + outline.rx * Math.cos(a),
          y: outline.cy + outline.ry * Math.sin(a),
        };
      });
    }
    case "rect": {
      const { x, y, width, height } = outline.rect;
      return [
        { x, y },
        { x: x + width, y },
        { x: x + width, y: y + height },
        { x, y: y + height },
      ];
    }
    case "path":
      return samplePath(outline.segments, 16);
  }
}

/** The outline's point farthest in the direction `(dx, dy)`. */
function support(outline: SetOutline, dx: number, dy: number): Point {
  if (outline.kind === "ellipse") {
    // The point of the ellipse with the largest dot product: (rx² dx, ry² dy) scaled.
    const length = Math.hypot(outline.rx * dx, outline.ry * dy) || 1;
    return {
      x: outline.cx + (outline.rx * outline.rx * dx) / length,
      y: outline.cy + (outline.ry * outline.ry * dy) / length,
    };
  }
  const points = outlinePolygon(outline);
  return points.reduce((best, p) => (p.x * dx + p.y * dy > best.x * dx + best.y * dy ? p : best));
}

/** Where a label sits outside the outline: its center, for a label of `width` × `height`. */
export function setLabelCenter(
  outline: SetOutline,
  at: SetLabelPosition,
  size: { width: number; height: number },
  gap: number,
): Point {
  const box = outlineBounds(outline);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const { width: w, height: h } = size;
  const right = box.x + box.width;
  const bottom = box.y + box.height;
  switch (at) {
    case "top":
      return { x: cx, y: box.y - gap - h / 2 };
    case "bottom":
      return { x: cx, y: bottom + gap + h / 2 };
    case "left":
      return { x: box.x - gap - w / 2, y: cy };
    case "right":
      return { x: right + gap + w / 2, y: cy };
    default: {
      const dx = at.endsWith("left") ? -1 : 1;
      const dy = at.startsWith("top") ? -1 : 1;
      const p = support(outline, dx / Math.SQRT2, dy / Math.SQRT2);
      return { x: p.x + dx * (gap + w / 2), y: p.y + dy * (gap + h / 2) };
    }
  }
}
