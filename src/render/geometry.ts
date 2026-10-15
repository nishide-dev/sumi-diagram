/**
 * Geometry primitives for SVG inspection (design doc §6): points, rectangles,
 * SVG path normalization to absolute M/L/C segments, and bounding boxes.
 *
 * Coordinates are in the user units of D2's `svg.d2-svg` (= D2 units,
 * 1 unit = 0.5pt); {@link unitsToPt} / {@link unitsToMm} convert them.
 */

import { d2UnitsToPt, ptToMm } from "../core/units";

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A path segment with absolute coordinates. Every subpath starts with `M`. */
export type PathSegment =
  | { command: "M"; to: Point }
  | { command: "L"; to: Point }
  | { command: "C"; c1: Point; c2: Point; to: Point };

/** A length in D2 units with its physical equivalents. */
export interface Size {
  units: number;
  pt: number;
  mm: number;
}

/** Converts D2 units (SVG user units) to pt. */
export const unitsToPt = (units: number): number => d2UnitsToPt(units);

/** Converts D2 units (SVG user units) to mm. */
export const unitsToMm = (units: number): number => ptToMm(d2UnitsToPt(units));

/** A length in D2 units as units, pt and mm. */
export const toSize = (units: number): Size => ({
  units,
  pt: unitsToPt(units),
  mm: unitsToMm(units),
});

export type PathParseResult =
  | { ok: true; segments: PathSegment[] }
  | { ok: false; message: string };

const PATH_TOKEN =
  /[ \t\r\n,]*(?:([MmLlHhVvCcSsQqTtAaZz])|([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?))/y;

/** Number of parameters each supported command takes per repetition. */
const ARITY: Readonly<Record<string, number>> = {
  M: 2,
  L: 2,
  H: 1,
  V: 1,
  C: 6,
  S: 4,
  Q: 4,
  T: 2,
  Z: 0,
};

/**
 * Parses SVG path data and normalizes it to absolute `M` / `L` / `C`
 * segments: relative commands become absolute, `H` / `V` become `L`, `S`
 * becomes `C` (reflected control point), `Q` / `T` become the equivalent
 * cubic (exact degree elevation), and `Z` becomes an `L` back to the subpath
 * start (omitted when already there).
 *
 * Elliptical arcs (`A`) are rejected: converting them to cubics is an
 * approximation, and D2 v0.9.0 does not emit them for the supported shapes.
 */
export function parsePath(d: string): PathParseResult {
  const tokens: (string | number)[] = [];
  PATH_TOKEN.lastIndex = 0;
  while (PATH_TOKEN.lastIndex < d.length) {
    const start = PATH_TOKEN.lastIndex;
    const match = PATH_TOKEN.exec(d);
    if (match === null) {
      if (/^[ \t\r\n,]*$/.test(d.slice(start))) break;
      return {
        ok: false,
        message: `Invalid path data at offset ${start}: "${d.slice(start, start + 12)}".`,
      };
    }
    if (match[1] !== undefined) tokens.push(match[1]);
    else {
      const value = Number(match[2]);
      if (!Number.isFinite(value)) {
        return { ok: false, message: `Number "${match[2]}" in path data is out of range.` };
      }
      tokens.push(value);
    }
  }

  const segments: PathSegment[] = [];
  let current: Point = { x: 0, y: 0 };
  let subpathStart: Point = { x: 0, y: 0 };
  /** Second control point of the previous cubic (for `S`). */
  let lastCubic: Point | undefined;
  /** Control point of the previous quadratic (for `T`). */
  let lastQuad: Point | undefined;

  let i = 0;
  let command: string | undefined;
  while (i < tokens.length) {
    const token = tokens[i];
    if (typeof token === "string") {
      command = token;
      i++;
    } else if (command === undefined) {
      return { ok: false, message: "Path data must start with a command." };
    } else if (command === "Z" || command === "z") {
      return { ok: false, message: "Unexpected number after Z." };
    }
    if (command === undefined)
      return { ok: false, message: "Path data must start with a command." };

    const upper = command.toUpperCase();
    const arity = ARITY[upper];
    if (arity === undefined) {
      return { ok: false, message: `Unsupported path command "${command}".` };
    }
    if (segments.length === 0 && upper !== "M") {
      return { ok: false, message: "Path data must start with M." };
    }
    const args = tokens.slice(i, i + arity);
    if (args.length < arity || args.some((a) => typeof a !== "number")) {
      return { ok: false, message: `Path command "${command}" needs ${arity} numbers.` };
    }
    i += arity;
    const n = args as number[];
    const relative = command !== upper;
    const at = (dx: number, dy: number): Point =>
      relative ? { x: current.x + dx, y: current.y + dy } : { x: dx, y: dy };
    const nums = (k: number): number => n[k] as number;

    let cubic: Point | undefined;
    let quad: Point | undefined;
    switch (upper) {
      case "M": {
        current = at(nums(0), nums(1));
        subpathStart = current;
        segments.push({ command: "M", to: current });
        // Further coordinate pairs after M are implicit L (or l).
        command = relative ? "l" : "L";
        break;
      }
      case "L":
        current = at(nums(0), nums(1));
        segments.push({ command: "L", to: current });
        break;
      case "H":
        current = { x: relative ? current.x + nums(0) : nums(0), y: current.y };
        segments.push({ command: "L", to: current });
        break;
      case "V":
        current = { x: current.x, y: relative ? current.y + nums(0) : nums(0) };
        segments.push({ command: "L", to: current });
        break;
      case "C": {
        const c1 = at(nums(0), nums(1));
        const c2 = at(nums(2), nums(3));
        const to = at(nums(4), nums(5));
        segments.push({ command: "C", c1, c2, to });
        cubic = c2;
        current = to;
        break;
      }
      case "S": {
        const c1 = reflect(lastCubic, current);
        const c2 = at(nums(0), nums(1));
        const to = at(nums(2), nums(3));
        segments.push({ command: "C", c1, c2, to });
        cubic = c2;
        current = to;
        break;
      }
      case "Q": {
        const q = at(nums(0), nums(1));
        const to = at(nums(2), nums(3));
        segments.push(quadToCubic(current, q, to));
        quad = q;
        current = to;
        break;
      }
      case "T": {
        const q = reflect(lastQuad, current);
        const to = at(nums(0), nums(1));
        segments.push(quadToCubic(current, q, to));
        quad = q;
        current = to;
        break;
      }
      case "Z":
        if (current.x !== subpathStart.x || current.y !== subpathStart.y) {
          segments.push({ command: "L", to: subpathStart });
        }
        current = subpathStart;
        break;
    }
    // Relative offsets, reflections and degree elevation can overflow finite inputs.
    const last = segments[segments.length - 1];
    if (last !== undefined && !segmentIsFinite(last)) {
      return { ok: false, message: `Path command "${command}" produces a non-finite coordinate.` };
    }
    lastCubic = cubic;
    lastQuad = quad;
  }
  if (segments.length === 0) return { ok: false, message: "Path data is empty." };
  return { ok: true, segments };
}

const isFinitePoint = (p: Point): boolean => Number.isFinite(p.x) && Number.isFinite(p.y);

function segmentIsFinite(segment: PathSegment): boolean {
  return segment.command === "C"
    ? isFinitePoint(segment.c1) && isFinitePoint(segment.c2) && isFinitePoint(segment.to)
    : isFinitePoint(segment.to);
}

/** Reflection of `control` about `point`, or `point` itself without a previous control. */
function reflect(control: Point | undefined, point: Point): Point {
  return control === undefined ? point : { x: 2 * point.x - control.x, y: 2 * point.y - control.y };
}

/** The cubic equal to the quadratic from `p0` with control `q` to `p2`. */
function quadToCubic(p0: Point, q: Point, p2: Point): PathSegment {
  return {
    command: "C",
    c1: { x: p0.x + (2 / 3) * (q.x - p0.x), y: p0.y + (2 / 3) * (q.y - p0.y) },
    c2: { x: p2.x + (2 / 3) * (q.x - p2.x), y: p2.y + (2 / 3) * (q.y - p2.y) },
    to: p2,
  };
}

/** Accumulates the bounding box of points. */
export class BoundsBuilder {
  private minX = Number.POSITIVE_INFINITY;
  private minY = Number.POSITIVE_INFINITY;
  private maxX = Number.NEGATIVE_INFINITY;
  private maxY = Number.NEGATIVE_INFINITY;

  add(point: Point): this {
    this.minX = Math.min(this.minX, point.x);
    this.minY = Math.min(this.minY, point.y);
    this.maxX = Math.max(this.maxX, point.x);
    this.maxY = Math.max(this.maxY, point.y);
    return this;
  }

  addRect(rect: Rect): this {
    return this.add({ x: rect.x, y: rect.y }).add({
      x: rect.x + rect.width,
      y: rect.y + rect.height,
    });
  }

  /** Adds the exact extent of path segments (cubic extrema included). */
  addPath(segments: readonly PathSegment[]): this {
    let current: Point | undefined;
    for (const segment of segments) {
      if (segment.command === "C" && current !== undefined) {
        for (const point of cubicExtrema(current, segment.c1, segment.c2, segment.to)) {
          this.add(point);
        }
      }
      this.add(segment.to);
      current = segment.to;
    }
    return this;
  }

  /** The bounding box, or `undefined` if nothing was added. */
  rect(): Rect | undefined {
    if (this.minX > this.maxX) return undefined;
    return {
      x: this.minX,
      y: this.minY,
      width: this.maxX - this.minX,
      height: this.maxY - this.minY,
    };
  }
}

/** Points of a cubic at the parameters where x or y is extremal, within (0, 1). */
function cubicExtrema(p0: Point, p1: Point, p2: Point, p3: Point): Point[] {
  const ts: number[] = [];
  for (const axis of ["x", "y"] as const) {
    // B'(t)/3 = a t² + b t + c
    const a = -p0[axis] + 3 * p1[axis] - 3 * p2[axis] + p3[axis];
    const b = 2 * (p0[axis] - 2 * p1[axis] + p2[axis]);
    const c = p1[axis] - p0[axis];
    if (Math.abs(a) < 1e-12) {
      if (Math.abs(b) > 1e-12) ts.push(-c / b);
    } else {
      const disc = b * b - 4 * a * c;
      if (disc >= 0) {
        const root = Math.sqrt(disc);
        ts.push((-b + root) / (2 * a), (-b - root) / (2 * a));
      }
    }
  }
  return ts
    .filter((t) => t > 0 && t < 1)
    .map((t) => {
      const u = 1 - t;
      const w0 = u * u * u;
      const w1 = 3 * u * u * t;
      const w2 = 3 * u * t * t;
      const w3 = t * t * t;
      return {
        x: w0 * p0.x + w1 * p1.x + w2 * p2.x + w3 * p3.x,
        y: w0 * p0.y + w1 * p1.y + w2 * p2.y + w3 * p3.y,
      };
    });
}

/** `true` if `inner` lies within `outer`, allowing `tolerance` units on each side. */
export function containsRect(outer: Rect, inner: Rect, tolerance = 0): boolean {
  return (
    inner.x >= outer.x - tolerance &&
    inner.y >= outer.y - tolerance &&
    inner.x + inner.width <= outer.x + outer.width + tolerance &&
    inner.y + inner.height <= outer.y + outer.height + tolerance
  );
}

/** `true` if `point` lies within `rect`, allowing `tolerance` units on each side. */
export function containsPoint(rect: Rect, point: Point, tolerance = 0): boolean {
  return containsRect(rect, { ...point, width: 0, height: 0 }, tolerance);
}

/** Distance from `point` to the nearest point of `rect` (0 inside). */
export function distanceToRect(rect: Rect, point: Point): number {
  const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.width));
  const dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.height));
  return Math.hypot(dx, dy);
}
