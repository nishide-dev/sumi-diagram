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
