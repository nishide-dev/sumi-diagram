/**
 * Crossing-reduction strategies (#124 §8). Each takes the placed layout and
 * returns a routed one; all of them use the product router, either as is or
 * through the patched copy (`variant.ts`), so the costs, grid, nets and
 * checks are the product's.
 */

import type { ArrangeBoxIR, EdgeIR, FigureIR } from "../../../src/compiler/ir";
import type { Anchor } from "../../../src/core/figure/layout";
import type { LayoutIR, Rect } from "../../../src/layout/ir";
import { checkRoutes } from "../../../src/layout/route/check";
import { resolveEnds } from "../../../src/layout/route/ports";
import { routeEdges } from "../../../src/layout/route/router";
import { better, type RouteMetrics, routeMetrics } from "./metrics";
import type { HookEdge, VariantRouter } from "./variant";

export interface Outcome {
  layout: LayoutIR;
  /** Full routings performed (1 for single-pass strategies). */
  passes: number;
  /** The IR the routes were made for (differs when a strategy adds anchors). */
  ir: FigureIR;
}

export type Strategy = (ir: FigureIR, placed: LayoutIR, v: VariantRouter) => Outcome;

const manhattan = (e: HookEdge) =>
  Math.abs(e.from.port.x - e.to.port.x) + Math.abs(e.from.port.y - e.to.port.y);

/** Runs the variant router with `ROUTE` overrides and hooks, restoring both afterwards (so strategies nest). */
function withVariant(
  v: VariantRouter,
  costs: Record<string, number>,
  hooks: Partial<VariantRouter["HOOKS"]>,
  run: () => LayoutIR,
): LayoutIR {
  const saved = { ...v.ROUTE };
  const savedHooks = { ...v.HOOKS };
  Object.assign(v.ROUTE, costs);
  Object.assign(v.HOOKS, hooks);
  try {
    return run();
  } finally {
    Object.assign(v.ROUTE, saved);
    Object.assign(v.HOOKS, savedHooks);
  }
}

const once =
  (costs: Record<string, number>, order: VariantRouter["HOOKS"]["order"] = null): Strategy =>
  (ir, placed, v) => ({
    ir,
    passes: 1,
    layout: withVariant(v, costs, { order }, () => v.routeEdges(ir, placed).layout),
  });

/** Edges (keys) named in crossings, contacts and overlaps of a routed layout. */
function conflicted(ir: FigureIR, layout: LayoutIR): Set<string> {
  const report = checkRoutes(ir, layout);
  const keys = new Set<string>();
  for (const line of [...report.crossings, ...report.contacts, ...report.overlaps]) {
    for (const m of line.matchAll(/e:[^\s×]+/g)) keys.add(m[0]);
  }
  return keys;
}

/** Grid points of crossings (`"x,y"`), each as often as it is reported. */
function crossingPoints(ir: FigureIR, layout: LayoutIR): string[] {
  return checkRoutes(ir, layout).crossings.map((c) => c.slice(c.lastIndexOf(" at ") + 4));
}

export const STRATEGIES: Record<string, Strategy> = {
  /** The product router (v0.4.1). */
  product: (ir, placed) => ({ ir, passes: 1, layout: routeEdges(ir, placed).layout }),
  /** The patched copy with no hook: must equal `product` byte for byte. */
  "variant-identity": once({}),

  // Crossing-aware cost tuning (ROUTE.cross is 300 in v0.4.1).
  "cost-cross-600": once({ cross: 600 }),
  "cost-cross-1200": once({ cross: 1200 }),
  "cost-cross-3000": once({ cross: 3000 }),
  "cost-bend-20": once({ bend: 20 }),

  // Edge ordering (YAML order in v0.4.1).
  "order-long-first": once({}, (edges) =>
    [...edges].sort((a, b) => manhattan(b) - manhattan(a) || a.index - b.index),
  ),
  "order-short-first": once({}, (edges) =>
    [...edges].sort((a, b) => manhattan(a) - manhattan(b) || a.index - b.index),
  ),
  /** Nets with more edges first (trunks and buses claim their lines first), then YAML order. */
  "order-net-size": once({}, (edges) => {
    const size = new Map<number, number>();
    for (const e of edges) size.set(e.net, (size.get(e.net) ?? 0) + 1);
    return [...edges].sort(
      (a, b) => (size.get(b.net) ?? 0) - (size.get(a.net) ?? 0) || a.index - b.index,
    );
  }),

  /**
   * Rip-up and reroute by reordering: route, move the edges in a crossing /
   * contact / overlap to the front, route everything again; up to 6 passes,
   * keep the best (metrics `better`).
   */
  "ripup-conflicts-first": ripUpByOrder("first", 6),
  "ripup-conflicts-last": ripUpByOrder("last", 6),

  /**
   * Negotiated congestion (PathFinder-like): rip up every route and route
   * again with a history cost on each grid point where nets crossed in
   * earlier passes (+150 per crossing, accumulated); up to 8 passes, keep the best.
   */
  "negotiate-150x8": negotiate(150, 8),
  "negotiate-300x8": negotiate(300, 8),

  /** Negotiation, then the conflicts-first reordering on top. */
  "negotiate+ripup": (ir, placed, v) => {
    const n = negotiate(150, 8)(ir, placed, v);
    const r = ripUpByOrder("first", 6)(ir, placed, v);
    const best = better(routeMetrics(ir, r.layout), routeMetrics(ir, n.layout)) ? r : n;
    return { ...best, passes: n.passes + r.passes };
  },
};

function ripUpByOrder(where: "first" | "last", passes: number): Strategy {
  return (ir, placed, v) => {
    let order: string[] = ir.edges.map((e) => e.key);
    let best: { layout: LayoutIR; metrics: RouteMetrics } | undefined;
    let done = 0;
    const seen = new Set<string>();
    for (let k = 0; k < passes; k++) {
      const rank = new Map(order.map((key, i) => [key, i]));
      const layout = withVariant(
        v,
        {},
        {
          order: (edges) =>
            [...edges].sort((a, b) => (rank.get(a.ir.key) ?? 0) - (rank.get(b.ir.key) ?? 0)),
        },
        () => v.routeEdges(ir, placed).layout,
      );
      done++;
      const metrics = routeMetrics(ir, layout);
      if (best === undefined || better(metrics, best.metrics)) best = { layout, metrics };
      const bad = conflicted(ir, layout);
      if (bad.size === 0) break;
      const moved = order.filter((key) => bad.has(key));
      const kept = order.filter((key) => !bad.has(key));
      order = where === "first" ? [...moved, ...kept] : [...kept, ...moved];
      const signature = order.join(" ");
      if (seen.has(signature)) break;
      seen.add(signature);
    }
    return { ir, passes: done, layout: (best as { layout: LayoutIR }).layout };
  };
}

function negotiate(step: number, passes: number): Strategy {
  return (ir, placed, v) => {
    const history = new Map<string, number>();
    let best: { layout: LayoutIR; metrics: RouteMetrics } | undefined;
    let done = 0;
    for (let k = 0; k < passes; k++) {
      const layout = withVariant(
        v,
        {},
        { history: new Map(history) },
        () => v.routeEdges(ir, placed).layout,
      );
      done++;
      const metrics = routeMetrics(ir, layout);
      if (best === undefined || better(metrics, best.metrics)) best = { layout, metrics };
      const points = crossingPoints(ir, layout);
      if (points.length === 0) break;
      for (const p of points) history.set(p, (history.get(p) ?? 0) + step);
    }
    return { ir, passes: done, layout: (best as { layout: LayoutIR }).layout };
  };
}

/**
 * Port assignment per side (#124 §8, idea "ports"): the ends without an
 * anchor that share a default port in the same direction (a fan-in: several
 * sources entering one point; `fanOut` also: several targets leaving one)
 * are spread along the side as anchors 1/(n+1) … n/(n+1), ordered by where
 * the other end is, so they enter side by side instead of merging into one
 * line, and in an order that does not cross. Ends between the same two
 * elements (already spread by the router) and junction ends are left alone.
 * Returns a new IR with those anchors; the product router routes it.
 */
export function spreadPorts(
  ir: FigureIR,
  placed: LayoutIR,
  fanOut: boolean,
  resolve: typeof resolveEnds = resolveEnds,
): FigureIR {
  const ends = resolve(ir, placed);
  type Use = { edge: number; end: "from" | "to"; along: number };
  const groups = new Map<string, Use[]>();
  ir.edges.forEach((edge, i) => {
    const pair = ends[i];
    if (pair === undefined || "error" in pair) return;
    for (const end of ["from", "to"] as const) {
      if (end === "from" && !fanOut) continue;
      const self = pair[end];
      const other = end === "from" ? pair.to : pair.from;
      const anchored = end === "from" ? edge.fromAnchor : edge.toAnchor;
      if (self.junction || self.side === undefined || anchored !== undefined) continue;
      const vertical = self.side === "north" || self.side === "south";
      const id = `${self.key}|${self.side}|${self.port.x},${self.port.y}|${end}`;
      const list = groups.get(id) ?? [];
      list.push({ edge: i, end, along: vertical ? other.port.x : other.port.y });
      groups.set(id, list);
    }
  });
  const anchors = new Map<string, Anchor>();
  for (const [id, uses] of groups) {
    if (uses.length < 2) continue;
    const side = id.split("|")[1] as Anchor["side"];
    const sorted = [...uses].sort((a, b) => a.along - b.along || a.edge - b.edge);
    sorted.forEach((u, k) => {
      anchors.set(`${u.edge}|${u.end}`, { side, offset: (k + 1) / (sorted.length + 1) });
    });
  }
  const edges: EdgeIR[] = ir.edges.map((edge, i) => {
    const from = anchors.get(`${i}|from`);
    const to = anchors.get(`${i}|to`);
    return {
      ...edge,
      ...(from !== undefined && { fromAnchor: from }),
      ...(to !== undefined && { toAnchor: to }),
    };
  });
  return { ...ir, edges };
}

export const portStrategy =
  (fanOut: boolean): Strategy =>
  (ir, placed) => {
    const spread = spreadPorts(ir, placed, fanOut);
    return { ir: spread, passes: 1, layout: routeEdges(spread, placed).layout };
  };

STRATEGIES["ports-fan-in"] = portStrategy(false);
STRATEGIES["ports-fan-in-out"] = portStrategy(true);

/**
 * Side of an end from the arrange tree (#124 §8, idea "sides-tree"): the box
 * that separates the two ends (their nearest common arrange box) decides the
 * axis: a stack → north / south, a row → east / west, toward the other end.
 * `facingSide()` (v0.4.1) compares the centers instead, so a box below and far
 * to the side leaves from its west or east side and enters the target's side
 * (serving-architecture without anchors: Training workers → Model registry).
 * Attached nodes use their target's place; a group and an element inside it
 * have no separating box and keep the product rule.
 */
export function treeSides(ir: FigureIR, placed: LayoutIR) {
  type Step = { box: ArrangeBoxIR; index: number };
  const paths = new Map<string, Step[]>();
  const groups = new Map(ir.groups.map((g) => [g.key, g]));
  const walk = (box: ArrangeBoxIR, prefix: Step[]) => {
    box.items.forEach((item, index) => {
      if (item === null) return;
      const path = [...prefix, { box, index }];
      if (typeof item === "string") {
        paths.set(item, path);
        const arrange = groups.get(item)?.arrange;
        if (arrange !== undefined) walk(arrange, path);
      } else {
        walk(item, path);
      }
    });
  };
  if (ir.arrange !== undefined) walk(ir.arrange, []);
  const nodes = new Map(ir.nodes.map((n) => [n.key, n]));
  const pathOf = (key: string, depth = 0): Step[] | undefined => {
    const own = paths.get(key);
    if (own !== undefined || depth > 32) return own;
    const to = nodes.get(key as never)?.attach?.to;
    return to === undefined ? undefined : pathOf(to, depth + 1);
  };
  const rects = new Map<string, Rect>([
    ...placed.nodes.map((n) => [n.key, n.rect] as [string, Rect]),
    ...placed.groups.map((g) => [g.key, g.rect] as [string, Rect]),
  ]);
  const center = (r: Rect) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
  return (_edge: { readonly key: string }, self: string, other: string) => {
    const a = pathOf(self);
    const b = pathOf(other);
    const ra = rects.get(self);
    const rb = rects.get(other);
    if (a === undefined || b === undefined || ra === undefined || rb === undefined)
      return undefined;
    for (let k = 0; k < Math.min(a.length, b.length); k++) {
      const sa = a[k] as Step;
      const sb = b[k] as Step;
      if (sa.box !== sb.box) return undefined;
      if (sa.index === sb.index) continue;
      const ca = center(ra);
      const cb = center(rb);
      if (sa.box.kind === "stack") return cb.y < ca.y ? "north" : "south";
      return cb.x < ca.x ? "west" : "east";
    }
    return undefined;
  };
}

const withSides =
  (inner: Strategy): Strategy =>
  (ir, placed, v) => {
    v.HOOKS.side = treeSides(ir, placed);
    try {
      return inner(ir, placed, v);
    } finally {
      v.HOOKS.side = null;
    }
  };

STRATEGIES["sides-tree"] = withSides(once({}));
STRATEGIES["sides-tree+cost-cross-600"] = withSides(once({ cross: 600 }));
STRATEGIES["sides-tree+negotiate-150x8"] = withSides(negotiate(150, 8));

/** Tree sides, then the ports of each side spread in the order of the other ends. */
const sidesAndPorts =
  (fanOut: boolean): Strategy =>
  (ir, placed, v) =>
    withSides((ir2, placed2, v2) => {
      const spread = spreadPorts(ir2, placed2, fanOut, v2.resolveEnds);
      return { ir: spread, passes: 1, layout: v2.routeEdges(spread, placed2).layout };
    })(ir, placed, v);

STRATEGIES["sides-tree+ports-fan-in"] = sidesAndPorts(false);
STRATEGIES["sides-tree+ports-fan-in-out"] = sidesAndPorts(true);
