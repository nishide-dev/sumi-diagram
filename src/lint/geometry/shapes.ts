/**
 * Planar geometry for the geometry lint (#13): convex regions (polygons and
 * ellipses), the outline and the label area of each shape D2 v0.9.0 draws,
 * and segment / rectangle tests. Coordinates are SVG user units (= D2 units,
 * 1 unit = 0.5pt), like the inspection's.
 *
 * Shapes are reconstructed from the shape's bounding box with D2 v0.9.0's
 * fixed proportions (design doc §6.4), checked against D2's SVG output in the
 * integration tests.
 */

import type { NodeShape } from "../../core/registry/manifest";
import type { PathSegment, Point, Rect } from "../../render/geometry";

/** A convex region: a polygon (vertices in order, either orientation) or an axis-aligned ellipse. */
export type Region =
  | { kind: "polygon"; points: readonly Point[] }
  | { kind: "ellipse"; cx: number; cy: number; rx: number; ry: number };

const EPSILON = 1e-9;

export function rectPolygon({ x, y, width, height }: Rect): Region {
  return {
    kind: "polygon",
    points: [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
    ],
  };
}

const polygon = (...points: Point[]): Region => ({ kind: "polygon", points });

function inscribedEllipse({ x, y, width, height }: Rect): Region {
  return { kind: "ellipse", cx: x + width / 2, cy: y + height / 2, rx: width / 2, ry: height / 2 };
}

/** D2 v0.9.0: horizontal offset of a parallelogram's slanted sides (`parallelWedgeWidth`). */
export const PARALLELOGRAM_WEDGE_UNITS = 26;
/** D2 v0.9.0: depth of a cylinder's elliptical caps (`defaultArcDepth`). */
export const CYLINDER_ARC_UNITS = 24;
/** D2 v0.9.0: fraction of a document's height above its wavy bottom edge (14 / 18.925). */
export const DOCUMENT_BODY_RATIO = 14 / 18.925;

/** Shapes with a geometry: node shapes other than `text`, and groups (`rectangle`). */
export type DrawnShape = Exclude<NodeShape, "text">;

/**
 * The outline of a shape drawn in `bbox`, used for collisions. Cylinders and
 * documents use their bounding box (their curved parts deviate little).
 */
export function shapeOutline(shape: DrawnShape, bbox: Rect): Region {
  const { x, y, width: w, height: h } = bbox;
  switch (shape) {
    case "circle":
    case "oval":
      return inscribedEllipse(bbox);
    case "diamond":
      return polygon(
        { x: x + w / 2, y },
        { x: x + w, y: y + h / 2 },
        { x: x + w / 2, y: y + h },
        { x, y: y + h / 2 },
      );
    case "hexagon":
      return polygon(
        { x: x + w / 4, y },
        { x: x + (3 * w) / 4, y },
        { x: x + w, y: y + h / 2 },
        { x: x + (3 * w) / 4, y: y + h },
        { x: x + w / 4, y: y + h },
        { x, y: y + h / 2 },
      );
    case "parallelogram": {
      const wedge = Math.min(PARALLELOGRAM_WEDGE_UNITS, w / 2);
      return polygon(
        { x: x + wedge, y },
        { x: x + w, y },
        { x: x + w - wedge, y: y + h },
        { x, y: y + h },
      );
    }
    default:
      return rectPolygon(bbox);
  }
}

/**
 * Where a label may be drawn inside a shape: the outline, except for the
 * cylinder (between the front edge of the top cap and the top of the bottom
 * cap) and the document (above the wavy bottom edge).
 */
export function labelArea(shape: DrawnShape, bbox: Rect): Region {
  const { x, y, width, height } = bbox;
  switch (shape) {
    case "cylinder": {
      const arc = Math.min(CYLINDER_ARC_UNITS, height / 3);
      return rectPolygon({ x, y: y + 2 * arc, width, height: height - 3 * arc });
    }
    case "document":
      return rectPolygon({ x, y, width, height: height * DOCUMENT_BODY_RATIO });
    default:
      return shapeOutline(shape, bbox);
  }
}

const corners = ({ x, y, width, height }: Rect): Point[] => [
  { x, y },
  { x: x + width, y },
  { x: x + width, y: y + height },
  { x, y: y + height },
];

/** The sign of the polygon's signed area: which side of each edge is the inside. */
function orientation(points: readonly Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i] as Point;
    const b = points[(i + 1) % points.length] as Point;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.sign(sum) || 1;
}

/**
 * How far `point` lies inside a convex region (negative: outside). For a
 * polygon, the distance to the nearest edge line; for an ellipse, the radial
 * slack `1 - √((dx/rx)² + (dy/ry)²)` scaled by the smaller radius (exact on
 * circles, an approximation on ellipses).
 */
export function depthInside(region: Region, point: Point): number {
  if (region.kind === "ellipse") {
    const { cx, cy, rx, ry } = region;
    if (rx <= 0 || ry <= 0) return Number.NEGATIVE_INFINITY;
    const r = Math.hypot((point.x - cx) / rx, (point.y - cy) / ry);
    return (1 - r) * Math.min(rx, ry);
  }
  const { points } = region;
  const sign = orientation(points);
  let depth = Number.POSITIVE_INFINITY;
  for (let i = 0; i < points.length; i++) {
    const a = points[i] as Point;
    const b = points[(i + 1) % points.length] as Point;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < EPSILON) continue;
    const cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
    depth = Math.min(depth, (sign * cross) / length);
  }
  return depth;
}

/**
 * The smallest depth of `rect`'s corners inside a convex region: at least
 * `margin` means the whole rectangle lies `margin` units inside the boundary
 * (convex regions contain a rectangle exactly when they contain its corners).
 */
export function rectDepthInside(region: Region, rect: Rect): number {
  return Math.min(...corners(rect).map((p) => depthInside(region, p)));
}

/** `rect` shrunk by `amount` on every side, or `undefined` if nothing is left. */
export function shrinkRect(rect: Rect, amount: number): Rect | undefined {
  const width = rect.width - 2 * amount;
  const height = rect.height - 2 * amount;
  if (width <= EPSILON || height <= EPSILON) return undefined;
  return { x: rect.x + amount, y: rect.y + amount, width, height };
}

/** Projection of points onto an axis. */
function project(points: readonly Point[], axis: Point): [number, number] {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const p of points) {
    const v = p.x * axis.x + p.y * axis.y;
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  return [min, max];
}

/**
 * `true` if `rect`, shrunk by `tolerance` on every side, has interior points
 * in common with the region: the two overlap by more than `tolerance`.
 * Touching boundaries do not count.
 */
export function regionIntersectsRect(region: Region, rect: Rect, tolerance: number): boolean {
  const inner = shrinkRect(rect, tolerance);
  if (inner === undefined) return false;
  if (region.kind === "ellipse") {
    const { cx, cy, rx, ry } = region;
    if (rx <= 0 || ry <= 0) return false;
    // Scale the ellipse to the unit circle; the rectangle stays axis-aligned.
    const x0 = (inner.x - cx) / rx;
    const x1 = (inner.x + inner.width - cx) / rx;
    const y0 = (inner.y - cy) / ry;
    const y1 = (inner.y + inner.height - cy) / ry;
    const nx = Math.max(x0, Math.min(0, x1));
    const ny = Math.max(y0, Math.min(0, y1));
    return nx * nx + ny * ny < 1 - EPSILON;
  }
  // Separating axis theorem: the rectangle's axes and the polygon's edge normals.
  const rectPoints = corners(inner);
  const { points } = region;
  const axes: Point[] = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
  ];
  for (let i = 0; i < points.length; i++) {
    const a = points[i] as Point;
    const b = points[(i + 1) % points.length] as Point;
    if (Math.hypot(b.x - a.x, b.y - a.y) > EPSILON) axes.push({ x: a.y - b.y, y: b.x - a.x });
  }
  for (const axis of axes) {
    const [minA, maxA] = project(points, axis);
    const [minB, maxB] = project(rectPoints, axis);
    if (maxA <= minB + EPSILON || maxB <= minA + EPSILON) return false;
  }
  return true;
}

/** Overlap of two rectangles on both axes is more than `tolerance`. */
export function rectsOverlap(a: Rect, b: Rect, tolerance: number): boolean {
  const dx = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const dy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return dx > tolerance && dy > tolerance;
}

/** `true` if `inner` lies inside `outer`, allowing `tolerance` units on each side. */
export function rectInside(outer: Rect, inner: Rect, tolerance: number): boolean {
  return (
    inner.x >= outer.x - tolerance &&
    inner.y >= outer.y - tolerance &&
    inner.x + inner.width <= outer.x + outer.width + tolerance &&
    inner.y + inner.height <= outer.y + outer.height + tolerance
  );
}

/** How far `inner` extends beyond `outer` (0 when inside). */
export function overhang(outer: Rect, inner: Rect): number {
  return Math.max(
    0,
    outer.x - inner.x,
    outer.y - inner.y,
    inner.x + inner.width - (outer.x + outer.width),
    inner.y + inner.height - (outer.y + outer.height),
  );
}

/** Cubic segments are flattened into this many line segments. */
export const CUBIC_STEPS = 16;

/**
 * Flattens path segments into polylines (one per subpath): lines as they are,
 * each cubic as {@link CUBIC_STEPS} chords. The chords of a cubic lie within
 * its control polygon, and D2's edge curves are short corner roundings, so
 * the deviation is far below the tolerances used.
 */
export function flattenPath(segments: readonly PathSegment[]): Point[][] {
  const polylines: Point[][] = [];
  let current: Point[] | undefined;
  for (const segment of segments) {
    if (segment.command === "M" || current === undefined) {
      current = [segment.to];
      polylines.push(current);
      if (segment.command === "M") continue;
    }
    const from = current[current.length - 1] as Point;
    if (segment.command === "L") {
      current.push(segment.to);
      continue;
    }
    if (segment.command !== "C") continue;
    const { c1, c2, to } = segment;
    for (let i = 1; i <= CUBIC_STEPS; i++) {
      const t = i / CUBIC_STEPS;
      const u = 1 - t;
      const w0 = u * u * u;
      const w1 = 3 * u * u * t;
      const w2 = 3 * u * t * t;
      const w3 = t * t * t;
      current.push({
        x: w0 * from.x + w1 * c1.x + w2 * c2.x + w3 * to.x,
        y: w0 * from.y + w1 * c1.y + w2 * c2.y + w3 * to.y,
      });
    }
  }
  return polylines;
}

/**
 * `true` if the segment from `a` to `b` passes through the interior of
 * `rect` shrunk by `tolerance` (Liang–Barsky clipping).
 */
export function segmentCrossesRect(a: Point, b: Point, rect: Rect, tolerance: number): boolean {
  const inner = shrinkRect(rect, tolerance);
  if (inner === undefined) return false;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) < EPSILON) return q > 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  return (
    clip(-dx, a.x - inner.x) &&
    clip(dx, inner.x + inner.width - a.x) &&
    clip(-dy, a.y - inner.y) &&
    clip(dy, inner.y + inner.height - a.y) &&
    t1 - t0 > EPSILON
  );
}

/** `true` if any segment of the polylines passes through `rect` (see {@link segmentCrossesRect}). */
export function polylinesCrossRect(
  polylines: readonly (readonly Point[])[],
  rect: Rect,
  tolerance: number,
): boolean {
  for (const line of polylines) {
    for (let i = 1; i < line.length; i++) {
      if (segmentCrossesRect(line[i - 1] as Point, line[i] as Point, rect, tolerance)) return true;
    }
  }
  return false;
}
