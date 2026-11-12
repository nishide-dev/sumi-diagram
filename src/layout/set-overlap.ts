/**
 * Where tinted sets overlap (#440). Set fills are opaque, so an overlap does
 * not mix by itself: the renderers paint each overlapping region with the
 * resolved overlap tint, on top of all the fills and
 * under the outlines. The regions are the non-empty intersections of two or
 * more sets, found on the sets' convex outlines as polygons.
 */

import type { FigureIR } from "../compiler/ir";
import type { Diagnostic } from "../core/diagnostics";
import type { Point } from "../core/geometry";
import type { LayoutIR } from "./ir";
import { outlinePolygon } from "./set-shape";

/** An overlap region: the sets (indices into the input, ascending) it lies in. */
export interface SetOverlap {
  readonly members: readonly number[];
  /** The region as a convex polygon (the outlines sampled); the editable PPTX draws it. */
  readonly polygon: readonly Point[];
}

/** An intersection smaller than this (square units) is a touch, not an overlap. */
export const MIN_OVERLAP_AREA = 1;
export const SET_OVERLAP_BUDGET = 1024;

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
export function setOverlaps(
  polygons: readonly (readonly Point[] | undefined)[],
  onBudget?: () => void,
): SetOverlap[] {
  const groups: { polygon: Point[]; members: number[] }[] = [];
  const keys = new Map<string, number>();
  polygons.forEach((polygon, i) => {
    if (polygon === undefined || polygon.length < 3) return;
    const shape = oriented(polygon);
    const key = rotationKey(shape.map((p) => `${p.x},${p.y}`));
    const existing = keys.get(key);
    if (existing !== undefined) (groups[existing] as { members: number[] }).members.push(i);
    else {
      keys.set(key, groups.length);
      groups.push({ polygon: shape, members: [i] });
    }
  });
  const found: SetOverlap[] = [];
  let level = groups.map((group, last) => ({ ...group, last }));
  for (const group of level) {
    if (group.members.length > 1 && Math.abs(area(group.polygon)) >= MIN_OVERLAP_AREA) {
      if (found.length === SET_OVERLAP_BUDGET) {
        onBudget?.();
        return found;
      }
      found.push(group);
    }
  }
  while (level.length > 0) {
    const next: typeof level = [];
    for (const region of level) {
      for (let j = region.last + 1; j < groups.length; j++) {
        const group = groups[j] as (typeof groups)[number];
        const common = clipConvex(region.polygon, group.polygon);
        if (common.length < 3 || Math.abs(area(common)) < MIN_OVERLAP_AREA) continue;
        if (found.length === SET_OVERLAP_BUDGET) {
          onBudget?.();
          return found.sort(compareOverlaps);
        }
        const overlap = {
          members: [...region.members, ...group.members].sort((a, b) => a - b),
          polygon: common,
          last: j,
        };
        found.push(overlap);
        next.push(overlap);
      }
    }
    level = next;
  }
  return found.sort(compareOverlaps);
}

function compareOverlaps(a: SetOverlap, b: SetOverlap): number {
  return (
    a.members.length - b.members.length ||
    a.members.join(",").localeCompare(b.members.join(","), undefined, { numeric: true })
  );
}

/** Warn once, using the same sampled outlines and budget as the SVG writer. */
export function setOverlapDiagnostics(ir: FigureIR, layout: LayoutIR): Diagnostic[] {
  const sets = ir.sets ?? [];
  let exceeded = false;
  setOverlaps(
    sets.map((set) => {
      const placed = layout.sets?.find((item) => item.id === set.id);
      return placed !== undefined && set.style.fill !== "transparent" && set.style.strength > 0
        ? outlinePolygon(placed.outline)
        : undefined;
    }),
    () => {
      exceeded = true;
    },
  );
  if (!exceeded) return [];
  const names = sets
    .filter((set) => set.style.fill !== "transparent" && set.style.strength > 0)
    .map((set) => `"${set.id}"`)
    .join(", ");
  return [
    {
      code: "layout/set-overlap-budget",
      severity: "warning",
      message: `Set overlap region budget (${SET_OVERLAP_BUDGET}) exceeded for ${names}; deeper intersections may omit participating colors.`,
      path: ["sets"],
      hint: "Reduce the number of overlapping sets or split the figure.",
    },
  ];
}

/**
 * The outline's identity regardless of its starting vertex, in linear memory (#492): the
 * rotation starting at the smallest vertex, the ties among those compared lazily.
 */
export function rotationKey(vertices: readonly string[]): string {
  const n = vertices.length;
  let smallest = vertices[0] as string;
  for (const v of vertices) if (v < smallest) smallest = v;
  let best = -1;
  for (let i = 0; i < n; i++) {
    if (vertices[i] !== smallest) continue;
    if (best < 0) {
      best = i;
      continue;
    }
    for (let k = 1; k < n; k++) {
      const a = vertices[(i + k) % n] as string;
      const b = vertices[(best + k) % n] as string;
      if (a === b) continue;
      if (a < b) best = i;
      break;
    }
  }
  const out: string[] = [];
  for (let k = 0; k < n; k++) out.push(vertices[(best + k) % n] as string);
  return out.join(";");
}
