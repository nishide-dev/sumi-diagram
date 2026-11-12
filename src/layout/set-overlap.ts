/**
 * Where tinted sets overlap (#440). Set fills are opaque, so an overlap does
 * not mix by itself: the renderers paint each overlapping region with the
 * resolved overlap tint, on top of all the fills and
 * under the outlines. The regions are the non-empty intersections of two or
 * more sets, found on the sets' convex outlines as polygons.
 */

import type { Point } from "../core/geometry";

/** An overlap region: the sets (indices into the input, ascending) it lies in. */
export interface SetOverlap {
  readonly members: readonly number[];
  /** The region as a convex polygon (the outlines sampled); the editable PPTX draws it. */
  readonly polygon: readonly Point[];
}

/** An intersection smaller than this (square units) is a touch, not an overlap. */
export const MIN_OVERLAP_AREA = 1;

function area(polygon: readonly Point[]): number {
  let sum = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i] as Point;
    const b = polygon[(i + 1) % polygon.length] as Point;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

/** `polygon` counter-clockwise on screen or not, so that the clip's inside is on one known side. */
function oriented(polygon: readonly Point[]): Point[] {
  return area(polygon) < 0 ? [...polygon].reverse() : [...polygon];
}

/** Sutherland–Hodgman: `subject` clipped to the convex `clip` (both with the same orientation). */
export function clipConvex(subject: readonly Point[], clip: readonly Point[]): Point[] {
  let output = [...subject];
  for (let i = 0; i < clip.length && output.length > 0; i++) {
    const a = clip[i] as Point;
    const b = clip[(i + 1) % clip.length] as Point;
    const side = (p: Point) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    const input = output;
    output = [];
    for (let j = 0; j < input.length; j++) {
      const p = input[j] as Point;
      const q = input[(j + 1) % input.length] as Point;
      const sp = side(p);
      const sq = side(q);
      if (sp >= 0) output.push(p);
      if (sp >= 0 !== sq >= 0) {
        const t = sp / (sp - sq);
        output.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
      }
    }
  }
  return output;
}

/**
 * Every region covered by two or more of `polygons` (`undefined` for a set
 * with no fill), smallest groups first (pairs, then triples), so painting
 * them in order puts a deeper overlap over the shallower ones.
 */
export function setOverlaps(polygons: readonly (readonly Point[] | undefined)[]): SetOverlap[] {
  const shapes = polygons.map((p) => (p === undefined ? undefined : oriented(p)));
  const found: SetOverlap[] = [];
  const extend = (members: number[], region: Point[]) => {
    const last = members[members.length - 1] as number;
    for (let j = last + 1; j < shapes.length; j++) {
      const other = shapes[j];
      if (other === undefined) continue;
      const common = clipConvex(region, other);
      if (common.length < 3 || Math.abs(area(common)) < MIN_OVERLAP_AREA) continue;
      const next = [...members, j];
      found.push({ members: next, polygon: common });
      extend(next, common);
    }
  };
  shapes.forEach((shape, i) => {
    if (shape !== undefined) extend([i], shape);
  });
  return found.sort(
    (a, b) =>
      a.members.length - b.members.length ||
      a.members.join(",").localeCompare(b.members.join(","), undefined, { numeric: true }),
  );
}
