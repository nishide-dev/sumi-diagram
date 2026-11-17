/**
 * Tilted planes (#577, design #574 stage C): the affine map from a plane's own
 * coordinates (u, v) to the page, in the figure's oblique projection.
 *
 * A group with `props.plane` is laid out like any group in a flat 2D frame of
 * W × H (the "flat" frame, y down). Its content is placed there with the usual
 * arrange boxes; the plane then maps only the centers of nodes (nodes stay
 * upright) and the polylines of in-plane routes. The frame itself becomes a
 * parallelogram.
 *
 * Plane coordinates: `u` runs along the flat frame's x axis from its left edge,
 * `v` runs from its bottom edge upward (`v = bottom - y`). With the projection's
 * `k = depthScale·cos(angle)` and `m = depthScale·sin(angle)` (y down on the page):
 *
 * - `floor`: a horizontal sheet seen from above; depth is `v`.
 *   `x = x0 + u + v·k`, `y = y0 − v·m`.
 * - `wall`: a vertical sheet receding to the back (the side face of a cuboid);
 *   `u` runs into the depth and `v` up. `x = x0 + u·k`, `y = y0 − u·m − v`.
 *
 * `(x0, y0)` is the page position of (0, 0), the bottom left of the
 * parallelogram's bounding box in both orientations.
 */
import type { Point, Rect } from "../core/geometry";
import { PARALLELOGRAM_WEDGE_UNITS } from "../lint/geometry/shapes";
import type { PlaneLayout } from "./ir";

export const PLANE_ORIENTATIONS = ["floor", "wall"] as const;
export type PlaneOrientation = (typeof PLANE_ORIENTATIONS)[number];

/** The projection a plane is drawn with: its orientation and the figure's `projection`. */
export interface PlaneProjection {
  readonly orientation: PlaneOrientation;
  /** Degrees counterclockwise from the right in which depth runs back. */
  readonly angle: number;
  readonly depthScale: number;
}

/** Page displacement per unit of u and per unit of v (y down). */
export interface PlaneBasis {
  readonly u: Point;
  readonly v: Point;
}

export function planeBasis(projection: PlaneProjection): PlaneBasis {
  const a = (projection.angle * Math.PI) / 180;
  const k = projection.depthScale * Math.cos(a);
  const m = projection.depthScale * Math.sin(a);
  return projection.orientation === "floor"
    ? { u: { x: 1, y: 0 }, v: { x: k, y: -m } }
    : { u: { x: k, y: -m }, v: { x: 0, y: -1 } };
}

/** The size of the bounding box of a flat `width × height` frame once mapped. */
export function planeExtent(
  projection: PlaneProjection,
  width: number,
  height: number,
): { width: number; height: number } {
  const { u, v } = planeBasis(projection);
  return {
    width: Math.abs(u.x) * width + Math.abs(v.x) * height,
    height: Math.abs(u.y) * width + Math.abs(v.y) * height,
  };
}

/**
 * A placed plane: the flat frame the content was laid out in, and the page
 * position its bottom left corner (u = 0, v = 0) maps to.
 */
export interface PlaneFrame {
  readonly projection: PlaneProjection;
  /** The flat frame (y down): `frame.x` is u = 0, `frame.y + frame.height` is v = 0. */
  readonly frame: Rect;
  /** Where (u, v) = (0, 0) is on the page. */
  readonly origin: Point;
}

/** The plane coordinates of a point of the flat frame. */
export function toPlane(plane: PlaneFrame, flat: Point): Point {
  return { x: flat.x - plane.frame.x, y: plane.frame.y + plane.frame.height - flat.y };
}

/** Maps a point of the flat frame to the page. */
export function mapFlatPoint(plane: PlaneFrame, flat: Point): Point {
  const { u, v } = planeBasis(plane.projection);
  const p = toPlane(plane, flat);
  return { x: plane.origin.x + p.x * u.x + p.y * v.x, y: plane.origin.y + p.x * u.y + p.y * v.y };
}

/** The page point a flat frame's point maps from: the inverse of {@link mapFlatPoint}. */
export function unmapPoint(plane: PlaneFrame, page: Point): Point {
  const { u, v } = planeBasis(plane.projection);
  const dx = page.x - plane.origin.x;
  const dy = page.y - plane.origin.y;
  const det = u.x * v.y - u.y * v.x;
  const pu = (dx * v.y - dy * v.x) / det;
  const pv = (u.x * dy - u.y * dx) / det;
  return { x: plane.frame.x + pu, y: plane.frame.y + plane.frame.height - pv };
}

/** A rectangle of the flat frame as a parallelogram on the page: front left, front right, back right, back left. */
export function mapFlatQuad(plane: PlaneFrame, rect: Rect = plane.frame): Point[] {
  const { x, y, width, height } = rect;
  return [
    { x, y: y + height },
    { x: x + width, y: y + height },
    { x: x + width, y },
    { x, y },
  ].map((p) => mapFlatPoint(plane, p));
}

/** The flat frame as a parallelogram on the page. */
export function planeQuad(plane: PlaneFrame): Point[] {
  return mapFlatQuad(plane);
}

/** The node's rectangle on the page: the same size, centered on the mapped center. */
export function mapFlatRect(plane: PlaneFrame, rect: Rect): Rect {
  const c = mapFlatPoint(plane, { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
  return {
    x: c.x - rect.width / 2,
    y: c.y - rect.height / 2,
    width: rect.width,
    height: rect.height,
  };
}

/** The bounding box of points. */
export function pointsBounds(points: readonly Point[]): Rect {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/**
 * The part of the segment a → b inside the convex polygon `quad`, as the
 * parameters [t0, t1] of the segment, or `undefined` when none of it is inside
 * (Cyrus–Beck clipping).
 */
export function clipSegmentToConvex(
  a: Point,
  b: Point,
  quad: readonly Point[],
): [number, number] | undefined {
  let t0 = 0;
  let t1 = 1;
  // Orientation of the polygon, to know which side of an edge is inside.
  let area = 0;
  for (let i = 0; i < quad.length; i++) {
    const p = quad[i] as Point;
    const q = quad[(i + 1) % quad.length] as Point;
    area += p.x * q.y - q.x * p.y;
  }
  const sign = area >= 0 ? 1 : -1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  for (let i = 0; i < quad.length; i++) {
    const p = quad[i] as Point;
    const q = quad[(i + 1) % quad.length] as Point;
    // The inside is where the edge's cross product with (x − p) has the polygon's sign.
    const ex = q.x - p.x;
    const ey = q.y - p.y;
    const at = sign * (ex * (a.y - p.y) - ey * (a.x - p.x));
    const along = sign * (ex * dy - ey * dx);
    if (Math.abs(along) < 1e-12) {
      if (at < 0) return undefined;
      continue;
    }
    const t = -at / along;
    if (along > 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return undefined;
  }
  return [t0, t1];
}

/**
 * What a plane's nodes look like (#577): `upright` keeps every node's shape as
 * it is (only its center is mapped); `projected` maps the outline too, so the
 * node lies flat on the plane. Labels stay horizontal in both.
 */
export const PLANE_CONTENTS = ["upright", "projected"] as const;
export type PlaneContents = (typeof PLANE_CONTENTS)[number];

/**
 * The linear part of the map from the flat frame (y down) to the page: the page
 * displacement `(a·dx + c·dy, b·dx + d·dy)` of a flat displacement `(dx, dy)`.
 * Unlike {@link planeBasis} (per unit of u and v, with v up) it takes flat
 * frame coordinates directly.
 */
export interface FlatLinear {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
}

export function flatLinear(projection: PlaneProjection): FlatLinear {
  const { u, v } = planeBasis(projection);
  return { a: u.x, b: u.y, c: -v.x, d: -v.y };
}

/** A flat displacement mapped by the linear part. */
export function mapFlatVector(linear: FlatLinear, p: Point): Point {
  return { x: linear.a * p.x + linear.c * p.y, y: linear.b * p.x + linear.d * p.y };
}

/** The node shapes whose outline a projected plane maps (a polygon, or an ellipse sampled as one). */
export const PROJECTABLE_SHAPES = [
  "rectangle",
  "square",
  "circle",
  "oval",
  "diamond",
  "hexagon",
  "parallelogram",
] as const;
export type ProjectableShape = (typeof PROJECTABLE_SHAPES)[number];

export const isProjectableShape = (shape: string): shape is ProjectableShape =>
  (PROJECTABLE_SHAPES as readonly string[]).includes(shape);

/** Points an ellipse is sampled with (the outline stays a convex polygon the lint and the router read). */
const ELLIPSE_STEPS = 64;
/** Segments of each rounded corner of a rectangle. */
const CORNER_STEPS = 6;

/**
 * The outline of a flat node of `shape`, `width × height` around (0, 0) (y down), as a
 * polygon: an ellipse sampled in 64 steps, a rectangle with its rounded corners
 * (`radius`) sampled in 6 steps, the other shapes as the lint reads them.
 */
export function flatShapePolygon(
  shape: ProjectableShape,
  width: number,
  height: number,
  radius = 0,
): Point[] {
  const w = width / 2;
  const h = height / 2;
  switch (shape) {
    case "circle":
    case "oval":
      return Array.from({ length: ELLIPSE_STEPS }, (_, i) => {
        const t = (2 * Math.PI * i) / ELLIPSE_STEPS;
        return { x: w * Math.cos(t), y: h * Math.sin(t) };
      });
    case "rectangle":
    case "square": {
      const r = Math.min(radius, w, h);
      if (r <= 0)
        return [
          { x: -w, y: -h },
          { x: w, y: -h },
          { x: w, y: h },
          { x: -w, y: h },
        ];
      const corners = [
        { cx: w - r, cy: -h + r, from: -90 },
        { cx: w - r, cy: h - r, from: 0 },
        { cx: -w + r, cy: h - r, from: 90 },
        { cx: -w + r, cy: -h + r, from: 180 },
      ];
      return corners.flatMap(({ cx, cy, from }) =>
        Array.from({ length: CORNER_STEPS + 1 }, (_, i) => {
          const t = ((from + (90 * i) / CORNER_STEPS) * Math.PI) / 180;
          return { x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) };
        }),
      );
    }
    case "diamond":
      return [
        { x: 0, y: -h },
        { x: w, y: 0 },
        { x: 0, y: h },
        { x: -w, y: 0 },
      ];
    case "hexagon":
      return [
        { x: -w / 2, y: -h },
        { x: w / 2, y: -h },
        { x: w, y: 0 },
        { x: w / 2, y: h },
        { x: -w / 2, y: h },
        { x: -w, y: 0 },
      ];
    case "parallelogram": {
      const wedge = Math.min(PARALLELOGRAM_WEDGE_UNITS, width / 2);
      return [
        { x: -w + wedge, y: -h },
        { x: w, y: -h },
        { x: w - wedge, y: h },
        { x: -w, y: h },
      ];
    }
  }
}

/**
 * The page outline of a node of `shape` lying on a plane: its flat outline mapped by `linear`,
 * around `center` (the mapped center of the node).
 */
export function projectedOutline(
  shape: ProjectableShape,
  width: number,
  height: number,
  radius: number,
  linear: FlatLinear,
  center: Point,
): Point[] {
  return flatShapePolygon(shape, width, height, radius).map((p) => {
    const d = mapFlatVector(linear, p);
    return { x: center.x + d.x, y: center.y + d.y };
  });
}

/** Whether `p` lies inside the convex polygon (either winding), on its boundary included. */
export function insideConvex(polygon: readonly Point[], p: Point): boolean {
  let sign = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i] as Point;
    const b = polygon[(i + 1) % polygon.length] as Point;
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (Math.abs(cross) < 1e-9) continue;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/** Whether a box (a label's) centered on `center` fits inside the convex `polygon`. */
export function boxFitsPolygon(
  polygon: readonly Point[],
  center: Point,
  width: number,
  height: number,
): boolean {
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].every(([sx, sy]) =>
    insideConvex(polygon, {
      x: center.x + (sx as number) * (width / 2),
      y: center.y + (sy as number) * (height / 2),
    }),
  );
}

/**
 * The flat size a projected node needs so that its upright label (`label`, with `margin` around
 * it) fits inside its mapped outline: `size` when it fits already; otherwise the smallest
 * growth, in whole units, of the height alone, the width alone or (a fixed-aspect shape, or when
 * neither is enough) both.
 */
export function growToFitLabel(
  shape: ProjectableShape,
  size: { width: number; height: number },
  radius: number,
  linear: FlatLinear,
  label: { width: number; height: number },
  margin: number,
  fixedAspect: boolean,
): { width: number; height: number } {
  const zero = { x: 0, y: 0 };
  const lw = label.width + 2 * margin;
  const lh = label.height + 2 * margin;
  const fits = (w: number, h: number) =>
    boxFitsPolygon(projectedOutline(shape, w, h, radius, linear, zero), zero, lw, lh);
  if (size.width <= 0 || size.height <= 0 || fits(size.width, size.height)) return size;
  // The smallest whole size (by a doubling then a bisection of the factor) along one direction.
  const search = (make: (f: number) => { width: number; height: number }) => {
    let hi = 2;
    while (hi < 64 && !fits(make(hi).width, make(hi).height)) hi *= 2;
    if (!fits(make(hi).width, make(hi).height)) return undefined;
    let lo = hi / 2;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (fits(make(mid).width, make(mid).height)) hi = mid;
      else lo = mid;
    }
    let out = { width: Math.ceil(make(hi).width), height: Math.ceil(make(hi).height) };
    // Rounding up whole units may overshoot by one: keep the smaller that still fits.
    const down = { width: Math.floor(make(hi).width), height: Math.floor(make(hi).height) };
    if (fits(down.width, down.height)) out = down;
    return out;
  };
  const candidates = [
    ...(fixedAspect
      ? []
      : [
          search((f) => ({ width: size.width, height: size.height * f })),
          search((f) => ({ width: size.width * f, height: size.height })),
        ]),
    search((f) => ({ width: size.width * f, height: size.height * f })),
  ].filter((c): c is { width: number; height: number } => c !== undefined);
  const best = candidates.sort((a, b) => a.width * a.height - b.width * b.height)[0];
  return best ?? size;
}

/** The placed plane of the Layout IR as a {@link PlaneFrame}. */
export function planeFrameOf(plane: PlaneLayout): PlaneFrame {
  return {
    projection: {
      orientation: plane.orientation,
      angle: plane.angle,
      depthScale: plane.depthScale,
    },
    frame: plane.frame,
    origin: plane.origin,
  };
}
