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

/** An end of an edge as drawn: the element, the point on it and the side it uses. */
interface RoutedEnd {
  readonly key: ElementKey;
  readonly at: Point;
  /** `undefined`: the end may be anywhere on the element (a zoom edge's corner lines). */
  readonly side: Side | undefined;
}

/** The side of `rect` whose line passes nearest to `p` (for a straight or curved end). */
function nearestSideOf(rect: Rect, p: Point): Side {
  const distances: [Side, number][] = [
    ["north", Math.abs(p.y - rect.y)],
    ["south", Math.abs(p.y - (rect.y + rect.height))],
    ["west", Math.abs(p.x - rect.x)],
    ["east", Math.abs(p.x - (rect.x + rect.width))],
  ];
  let best = distances[0] as [Side, number];
  for (const entry of distances) if (entry[1] < best[1]) best = entry;
  return best[0];
}

/**
 * Both ends of every drawn edge. Orthogonal routes: the side their first
 * (last) segment leaves through. Straight and curved routes (#366): the side
 * nearest their end point. Zoom edges (#176): no side (they hold the whole
 * element). `undefined` for an edge without a route.
 */
function drawnEnds(
  ir: FigureIR,
  edge: EdgeLayout,
  rects: ReadonlyMap<ElementKey, Rect>,
): [RoutedEnd, RoutedEnd] | undefined {
  const points = edge.route?.points;
  if (points === undefined || points.length < 2) return undefined;
  const first = points[0] as Point;
  const last = points.at(-1) as Point;
  const irEdge = ir.edges.find((e) => e.key === edge.key);
  if (edge.route?.lines !== undefined || irEdge?.routing === "zoom")
    return [
      { key: edge.from, at: first, side: undefined },
      { key: edge.to, at: last, side: undefined },
    ];
  if (irEdge?.route === "straight" || irEdge?.route === "curve") {
    const side = (key: ElementKey, p: Point) => {
      const rect = rects.get(key);
      return rect === undefined ? undefined : nearestSideOf(rect, p);
    };
    return [
      { key: edge.from, at: first, side: side(edge.from, first) },
      { key: edge.to, at: last, side: side(edge.to, last) },
    ];
  }
  const line = corners(points);
  if (line.length < 2) return undefined;
  const a = line[0] as Point;
  const b = line.at(-1) as Point;
  return [
    { key: edge.from, at: a, side: sideOf(a, line[1] as Point) },
    { key: edge.to, at: b, side: sideOf(b, line.at(-2) as Point) },
  ];
}

/** A free end that may move to the facing side, and the edge's bends now. */
interface Candidate {
  readonly key: ElementKey;
  readonly end: "from" | "to";
  readonly bends: number;
}

/**
 * The first edge (in document order, not in `tried`) whose free end may
 * move to the facing side in `layout` as routed: three or more bends, one
 * written anchor (side S), the other end on a node without an anchor and
 * beyond S, not on the side facing S already, and neither that end's point
 * nor the facing side used by another edge, orthogonal, straight, curved or
 * zoom (a fan, a multi-edge or another port keeps its shape; a zoom edge
 * touching the node holds all of it).
 */
function nextCandidate(
  ir: FigureIR,
  layout: LayoutIR,
  tried: ReadonlySet<ElementKey>,
): Candidate | undefined {
  const rects = endpointRects(ir, layout);
  const irEdges = new Map(ir.edges.map((e) => [e.key, e]));
  const nodes = new Map(ir.nodes.map((n) => [n.key, n]));
  const ends = new Map(
    layout.edges.flatMap((e) => {
      const pair = drawnEnds(ir, e, rects);
      return pair === undefined ? [] : [[e.key, pair] as const];
    }),
  );
  for (const layoutEdge of layout.edges) {
    if (tried.has(layoutEdge.key)) continue;
    const edge = irEdges.get(layoutEdge.key);
    const pair = ends.get(layoutEdge.key);
    if (edge === undefined || pair === undefined || layoutEdge.facingEnd !== undefined) continue;
    if (edge.from === edge.to || edge.lane !== undefined || edge.faceSides !== undefined) continue;
    if (edge.route !== undefined || edge.routing === "zoom") continue;
    const bends = routeBends(layoutEdge);
    if (bends < 3) continue;
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
      if (other.from === freeEnd.key || other.to === freeEnd.key) {
        const theirs = ends.get(other.key);
        // An edge to the node without a drawn end (no route yet) may hold any side.
        if (theirs === undefined) return true;
        return theirs.some(
          (t) =>
            t.key === freeEnd.key &&
            (t.side === undefined ||
              t.side === facing ||
              (Math.abs(t.at.x - freeEnd.at.x) < 0.5 && Math.abs(t.at.y - freeEnd.at.y) < 0.5)),
        );
      }
      return false;
    });
    if (!shared) return { key: layoutEdge.key, end, bends };
  }
  return undefined;
}

const errors = (diagnostics: readonly Diagnostic[]) =>
  diagnostics.filter((d) => d.severity === "error").length;

/**
 * `result` (the figure routed on `layout`, with every edge: orthogonal,
 * straight, curved and zoom) with the free ends of edges that bend three
 * times or more moved to the facing side where that routes the edge with
 * fewer bends, at most two, and harms no other edge (see the module
 * comment). `route` routes the figure on a layout. Before each trial the
 * next candidate is found again on the figure as it now stands (an accepted
 * move can change the others), at most {@link FACING_Z_BUDGET} trials.
 * Returns the result, the layout it was routed on, and whether any end moved.
 */
export function withFacingZ<R extends { layout: LayoutIR; diagnostics: Diagnostic[] }>(
  ir: FigureIR,
  layout: LayoutIR,
  result: R,
  route: (layout: LayoutIR) => R,
): { result: R; layout: LayoutIR; moved: boolean } {
  let best = result;
  let current = layout;
  let moved = false;
  if (hasErrors(result.diagnostics)) return { result, layout, moved };
  const tried = new Set<ElementKey>();
  for (let budget = FACING_Z_BUDGET; budget > 0; budget--) {
    const candidate = nextCandidate(ir, best.layout, tried);
    if (candidate === undefined) break;
    const { key, end, bends } = candidate;
    tried.add(key);
    const trial: LayoutIR = {
      ...current,
      edges: current.edges.map((e) => (e.key === key ? { ...e, facingEnd: end } : e)),
    };
    const routed = route(trial);
    if (errors(routed.diagnostics) > errors(best.diagnostics)) continue;
    const before = new Map(best.layout.edges.map((e) => [e.key, routeBends(e)] as const));
    const ok = routed.layout.edges.every((e) => {
      const n = routeBends(e);
      return e.key === key
        ? n <= 2 && n < bends
        : n <= (before.get(e.key) ?? Number.POSITIVE_INFINITY);
    });
    if (!ok || routed.layout.edges.length !== best.layout.edges.length) continue;
    best = routed;
    current = trial;
    moved = true;
  }
  return { result: best, layout: current, moved };
}
