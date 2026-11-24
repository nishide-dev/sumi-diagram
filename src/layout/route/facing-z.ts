/**
 * A Z into the facing side instead of a side entry with more bends (#657,
 * design record `docs/design/decisions/657-facing-z.md`).
 *
 * An edge with one written anchor (side S) and no anchor at the other end
 * takes the other end's default side (the arrange tree's, else toward the
 * centre). When the other element lies beyond S, the route into that default
 * side can need three bends or more (around a node in the way) where a Z with
 * two bends into the side facing S would do. The router then routes the
 * figure again with that end on the facing side (`EdgeLayout.facingEnd`) and
 * keeps it only if the edge has at most two bends, no other edge gets more
 * bends, and routing reports no more errors. Written anchors never change.
 */

import type { FigureIR } from "../../compiler/ir";
import type { ElementKey } from "../../core/check-state";
import { type Diagnostic, hasErrors } from "../../core/diagnostics";
import type { Side } from "../../core/figure/schema";
import type { EdgeLayout, LayoutIR, Point, Rect } from "../ir";
import { endpointRects } from "./endpoint-rects";

/** Re-routings tried per figure (each routes the whole figure once more). */
export const FACING_Z_BUDGET = 4;

const OPPOSITE: Readonly<Record<Side, Side>> = {
  north: "south",
  south: "north",
  east: "west",
  west: "east",
};

/** Corners of an orthogonal polyline (repeated and collinear points dropped). */
function corners(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out.at(-1);
    if (last !== undefined && Math.abs(p.x - last.x) < 1e-6 && Math.abs(p.y - last.y) < 1e-6)
      continue;
    out.push(p);
    while (out.length >= 3) {
      const a = out.at(-3) as Point;
      const b = out.at(-2) as Point;
      const c = out.at(-1) as Point;
      const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      if (Math.abs(cross) > 1e-6) break;
      out.splice(out.length - 2, 1);
    }
  }
  return out;
}

/** Bends of an edge's route (infinite without one). */
export function routeBends(edge: EdgeLayout): number {
  const points = edge.route?.points;
  return points === undefined || points.length < 2
    ? Number.POSITIVE_INFINITY
    : corners(points).length - 2;
}

/** The side a route leaves (enters) its element through, from its end point toward the next. */
function sideOf(port: Point, next: Point): Side {
  if (Math.abs(next.y - port.y) < 1e-6) return next.x > port.x ? "east" : "west";
  return next.y > port.y ? "south" : "north";
}

/** `b` lies beyond `side` of `a`. */
function beyond(a: Rect, side: Side, b: Rect): boolean {
  switch (side) {
    case "east":
      return b.x >= a.x + a.width;
    case "west":
      return b.x + b.width <= a.x;
    case "south":
      return b.y >= a.y + a.height;
    case "north":
      return b.y + b.height <= a.y;
  }
}

/** An end of a routed edge: the element, the point on it and the side it uses. */
interface RoutedEnd {
  readonly key: ElementKey;
  readonly at: Point;
  readonly side: Side;
}

function routedEnds(edge: EdgeLayout): [RoutedEnd, RoutedEnd] | undefined {
  const points = edge.route?.points;
  if (points === undefined || points.length < 2 || edge.route?.lines !== undefined) return;
  const line = corners(points);
  if (line.length < 2) return undefined;
  const first = line[0] as Point;
  const last = line.at(-1) as Point;
  return [
    { key: edge.from, at: first, side: sideOf(first, line[1] as Point) },
    { key: edge.to, at: last, side: sideOf(last, line.at(-2) as Point) },
  ];
}

/**
 * The edges (keys) whose free end may move to the facing side, with the end:
 * three or more bends, one written anchor (side S), the other end on a
 * node without an anchor and beyond S, not on the side facing S already,
 * and neither that end's point nor the facing side used by another edge (a
 * fan, a multi-edge or another port keeps its shape).
 */
function candidates(ir: FigureIR, layout: LayoutIR): { key: ElementKey; end: "from" | "to" }[] {
  const rects = endpointRects(ir, layout);
  const irEdges = new Map(ir.edges.map((e) => [e.key, e]));
  const nodes = new Map(ir.nodes.map((n) => [n.key, n]));
  const ends = new Map(
    layout.edges.flatMap((e) => {
      const pair = routedEnds(e);
      return pair === undefined ? [] : [[e.key, pair] as const];
    }),
  );
  const out: { key: ElementKey; end: "from" | "to" }[] = [];
  for (const layoutEdge of layout.edges) {
    const edge = irEdges.get(layoutEdge.key);
    const pair = ends.get(layoutEdge.key);
    if (edge === undefined || pair === undefined || layoutEdge.facingEnd !== undefined) continue;
    if (edge.from === edge.to || edge.lane !== undefined || edge.faceSides !== undefined) continue;
    if (edge.route === "straight" || edge.route === "curve" || edge.routing === "zoom") continue;
    if (routeBends(layoutEdge) < 3) continue;
    const fromWritten = typeof edge.fromAnchor === "object" ? edge.fromAnchor : undefined;
    const toWritten = typeof edge.toAnchor === "object" ? edge.toAnchor : undefined;
    let end: "from" | "to";
    if (fromWritten !== undefined && edge.toAnchor === undefined) end = "to";
    else if (toWritten !== undefined && edge.fromAnchor === undefined) end = "from";
    else continue;
    const written = (end === "to" ? fromWritten : toWritten) as { side: Side };
    const [anchoredEnd, freeEnd] = end === "to" ? [pair[0], pair[1]] : [pair[1], pair[0]];
    const node = nodes.get(freeEnd.key);
    // A junction has no sides; a node drawn by a renderer with a fixed port keeps it.
    if (node === undefined || node.mark?.type === "point" || node.render !== undefined) continue;
    const facing = OPPOSITE[written.side];
    if (anchoredEnd.side !== written.side || freeEnd.side === facing) continue;
    const a = rects.get(anchoredEnd.key);
    const b = rects.get(freeEnd.key);
    if (a === undefined || b === undefined || !beyond(a, written.side, b)) continue;
    const shared = layout.edges.some((other) => {
      if (other.key === layoutEdge.key) return false;
      const theirs = ends.get(other.key);
      if (theirs === undefined) return false;
      return theirs.some(
        (t) =>
          t.key === freeEnd.key &&
          (t.side === facing ||
            (Math.abs(t.at.x - freeEnd.at.x) < 0.5 && Math.abs(t.at.y - freeEnd.at.y) < 0.5)),
      );
    });
    if (!shared) out.push({ key: layoutEdge.key, end });
  }
  return out;
}

const errors = (diagnostics: readonly Diagnostic[]) =>
  diagnostics.filter((d) => d.severity === "error").length;

/**
 * `result` (the figure routed on `layout`) with the free ends of edges that
 * bend three times or more moved to the facing side where that routes the
 * edge as a Z and harms no other edge (see the module comment). `route`
 * routes the figure on a layout. Candidates are tried in document order, at
 * most {@link FACING_Z_BUDGET}; each accepted move is kept for the next.
 */
export function withFacingZ<R extends { layout: LayoutIR; diagnostics: Diagnostic[] }>(
  ir: FigureIR,
  layout: LayoutIR,
  result: R,
  route: (layout: LayoutIR) => R,
): R {
  if (hasErrors(result.diagnostics)) return result;
  let best = result;
  let current = layout;
  let budget = FACING_Z_BUDGET;
  for (const { key, end } of candidates(ir, result.layout)) {
    if (budget <= 0) break;
    budget--;
    const trial: LayoutIR = {
      ...current,
      edges: current.edges.map((e) => (e.key === key ? { ...e, facingEnd: end } : e)),
    };
    const routed = route(trial);
    if (errors(routed.diagnostics) > errors(best.diagnostics)) continue;
    const before = new Map(best.layout.edges.map((e) => [e.key, routeBends(e)] as const));
    const ok = routed.layout.edges.every((e) =>
      e.key === key
        ? routeBends(e) <= 2
        : routeBends(e) <= (before.get(e.key) ?? Number.POSITIVE_INFINITY),
    );
    if (!ok) continue;
    best = routed;
    current = trial;
  }
  return best;
}
