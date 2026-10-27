/**
 * Route quality numbers for the crossing-reduction experiments.
 *
 * - `crossings`: `checkRoutes().crossings`, i.e. pairs of edges of different
 *   nets crossing (one crossing of a three-edge bus with a line counts 3),
 *   the number the dogfooding record (#109) and the product tests use.
 * - `crossingPoints`: distinct points where nets cross (what a reader sees).
 * - `contacts`, `overlaps`, `labelCollisions`: as reported by `checkRoutes`.
 * - `length`: total route length (mm); `bends`: total bends.
 * - `excess`: Σ (route length − Manhattan distance between its two ends) in mm:
 *   how far routes are from the straightest possible (0 for straight or
 *   single-L routes); `detours`: edges whose excess is over 10mm.
 */

import type { FigureIR } from "../../../src/compiler/ir";
import type { LayoutIR, Point } from "../../../src/layout/ir";
import { checkRoutes } from "../../../src/layout/route/check";

/** 1 unit = 0.5pt; 1mm = 72 / 25.4 pt. */
const MM_PER_UNIT = 0.5 * (25.4 / 72);
const DETOUR_MM = 10;

export interface RouteMetrics {
  unrouted: number;
  crossings: number;
  crossingPoints: number;
  contacts: number;
  overlaps: number;
  labelCollisions: number;
  /** All other `checkRoutes` findings (must stay 0). */
  otherProblems: number;
  length: number;
  bends: number;
  excess: number;
  detours: number;
}

const round = (v: number, digits = 1) => Math.round(v * 10 ** digits) / 10 ** digits;

export function routeMetrics(ir: FigureIR, layout: LayoutIR): RouteMetrics {
  const report = checkRoutes(ir, layout);
  let length = 0;
  let bends = 0;
  let excess = 0;
  let detours = 0;
  for (const edge of layout.edges) {
    const points = edge.route?.points as readonly Point[] | undefined;
    if (points === undefined || points.length < 2) continue;
    let l = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1] as Point;
      const b = points[i] as Point;
      l += Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    }
    const first = points[0] as Point;
    const last = points[points.length - 1] as Point;
    const e = (l - Math.abs(first.x - last.x) - Math.abs(first.y - last.y)) * MM_PER_UNIT;
    length += l * MM_PER_UNIT;
    bends += points.length - 2;
    excess += e;
    if (e > DETOUR_MM) detours++;
  }
  const points = new Set(report.crossings.map((c) => c.slice(c.lastIndexOf(" at ") + 4)));
  const other =
    report.nonOrthogonal.length +
    report.malformed.length +
    report.throughNode.length +
    report.endpointMisses.length +
    report.misjoinedNets.length +
    report.shortArrowSegments.length +
    report.outside.length;
  return {
    unrouted: report.unrouted.length,
    crossings: report.crossings.length,
    crossingPoints: points.size,
    contacts: report.contacts.length,
    overlaps: report.overlaps.length,
    labelCollisions: report.labelCollisions.length,
    otherProblems: other,
    length: round(length),
    bends,
    excess: round(excess),
    detours,
  };
}

/** Lexicographic score used to keep the best of several attempts: fewer is better. */
export function score(m: RouteMetrics): number[] {
  return [
    m.unrouted,
    m.otherProblems,
    m.overlaps,
    m.crossingPoints,
    m.crossings,
    m.contacts,
    m.labelCollisions,
    m.length,
  ];
}

export function better(a: RouteMetrics, b: RouteMetrics): boolean {
  const sa = score(a);
  const sb = score(b);
  for (let i = 0; i < sa.length; i++) {
    if ((sa[i] as number) !== (sb[i] as number)) return (sa[i] as number) < (sb[i] as number);
  }
  return false;
}
