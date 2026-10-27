/**
 * Crossings between the routes of different nets (#133, design doc §6.28).
 *
 * The router keeps nets apart where it can, but crossing is a cost, not
 * forbidden, and greedy routing in document order cannot always avoid it
 * (#124 §3.7: most crossings follow from the arrangement). Instead of
 * reducing them automatically, the renderer reports each one as
 * `layout/edge-crossing` (info), so the author can change the edge order,
 * the anchors or the arrangement.
 *
 * A crossing is a point strictly inside a horizontal segment of one net and
 * strictly inside a vertical segment of another (the nets' merged segments,
 * so a shared trunk crossing a line is one crossing, not one per edge of the
 * trunk). Edges of one net sharing a trunk or meeting at a junction never
 * cross; a route touching another (a bend or end on it) is not a crossing.
 */

import type { FigureIR } from "../../compiler/ir";
import type { ElementKey } from "../../core/check-state";
import type { Diagnostic } from "../../core/diagnostics";
import type { LayoutIR, Point } from "../ir";

const EPS = 0.01;

/** Crossings reported one by one; the rest are summed up in one more diagnostic. */
export const MAX_REPORTED_CROSSINGS = 10;

/** One point where two nets cross. */
export interface EdgeCrossing {
  readonly point: Point;
  /**
   * The edges of the net drawn later (its first edge comes later in the
   * document) that cross there: one of their own segments runs through the
   * point, across the other net (not just a bend, an end or an overlap). In
   * document order.
   */
  readonly edges: readonly ElementKey[];
  /** The edges of the other net that cross there, likewise. */
  readonly others: readonly ElementKey[];
}

type Segment = readonly [Point, Point];

const strictlyBetween = (v: number, a: number, b: number) =>
  v > Math.min(a, b) + EPS && v < Math.max(a, b) - EPS;

/**
 * The crossings of a routed layout, one per pair of nets and point, ordered
 * by the first crossing edge of the later net, then of the other net, then
 * top to bottom and left to right. Deterministic. Per pair of nets it
 * compares H1 · V2 + V1 · H2 segments (H, V: a net's merged horizontal and
 * vertical segments), plus a scan of the two nets' edge segments for each
 * crossing found.
 */
export function findCrossings(layout: LayoutIR): EdgeCrossing[] {
  const order = new Map(layout.edges.map((e, i) => [e.key, i]));
  const segmentsOf = new Map(
    layout.edges.map((e) => {
      const points = e.route?.points ?? [];
      return [e.key, points.slice(1).map((q, i) => [points[i] as Point, q] as const)];
    }),
  );
  const horizontal = ([a, b]: Segment) => Math.abs(a.y - b.y) <= EPS;
  // Nets are numbered in the order of their first edge, and list their
  // edges in document order (`RouteNet`).
  const nets = (layout.nets ?? []).map((net) => ({
    id: net.id,
    edges: net.edges,
    h: net.segments.filter(horizontal),
    v: net.segments.filter((s) => !horizontal(s)),
  }));
  /**
   * The net's edges that cross at `p` along the given orientation: one of
   * their own segments of that orientation runs through `p`, ends excluded.
   * An edge that only bends or ends there, or runs along the other net
   * there, does not. If no edge of a net does (its edges only bend or meet
   * end to end there, e.g. a merged line that is really two bends, or a
   * line running along the other net), the point is a degenerate merge or
   * overlap, not a crossing a reader sees, and is not reported.
   */
  const crossingEdges = (keys: readonly ElementKey[], p: Point, alongX: boolean) =>
    keys.filter((key) =>
      (segmentsOf.get(key) ?? []).some(([a, b]) => {
        if (horizontal([a, b]) !== alongX) return false;
        const [at, lo, hi] = alongX ? [a.y - p.y, a.x, b.x] : [a.x - p.x, a.y, b.y];
        return Math.abs(at) <= EPS && strictlyBetween(alongX ? p.x : p.y, lo, hi);
      }),
    );
  const found = new Map<string, EdgeCrossing>();
  const add = (
    early: (typeof nets)[number],
    late: (typeof nets)[number],
    h: Segment,
    v: Segment,
    lateIsHorizontal: boolean,
  ) => {
    const point = { x: v[0].x, y: h[0].y };
    if (!strictlyBetween(point.x, h[0].x, h[1].x)) return;
    if (!strictlyBetween(point.y, v[0].y, v[1].y)) return;
    const edges = crossingEdges(late.edges, point, lateIsHorizontal);
    const others = crossingEdges(early.edges, point, !lateIsHorizontal);
    if (edges.length === 0 || others.length === 0) return;
    // Each net can run through the point both ways (then they also overlap
    // there): one crossing, with the edges crossing either way.
    const key = `${early.id} ${late.id} ${point.x.toFixed(3)} ${point.y.toFixed(3)}`;
    const seen = found.get(key);
    const merge = (a: readonly ElementKey[], b: readonly ElementKey[]) =>
      [...new Set([...a, ...b])].sort(
        (p, q) => (order.get(p) as number) - (order.get(q) as number),
      );
    found.set(key, {
      point,
      edges: seen === undefined ? edges : merge(seen.edges, edges),
      others: seen === undefined ? others : merge(seen.others, others),
    });
  };
  for (const [i, early] of nets.entries()) {
    for (const late of nets.slice(i + 1)) {
      for (const h of late.h) for (const v of early.v) add(early, late, h, v, true);
      for (const v of late.v) for (const h of early.h) add(early, late, h, v, false);
    }
  }
  const compare = (a: readonly number[], b: readonly number[]) => {
    for (const [i, v] of a.entries()) {
      if (v !== b[i]) return v - (b[i] as number);
    }
    return 0;
  };
  const rank = (c: EdgeCrossing) => [
    order.get(c.edges[0] as ElementKey) as number,
    order.get(c.others[0] as ElementKey) as number,
    c.point.y,
    c.point.x,
  ];
  return [...found.values()].sort((a, b) => compare(rank(a), rank(b)));
}

/** 1 unit = 0.5pt. */
const MM_PER_UNIT = 0.5 * (25.4 / 72);
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const mm = (units: number) => `${(units * MM_PER_UNIT).toFixed(1)}mm`;

/**
 * `layout/edge-crossing` (info) for the crossings of a routed layout: one
 * per crossing up to `limit`, located at the first of the later net's edges
 * there, with the other net's edges (and the rest of its own net's) as
 * `related`; then, if there are more, one without a location saying how
 * many were left out.
 */
export function crossingDiagnostics(
  ir: FigureIR,
  layout: LayoutIR,
  limit = MAX_REPORTED_CROSSINGS,
): Diagnostic[] {
  const crossings = findCrossings(layout);
  const byKey = new Map(ir.edges.map((e) => [e.key, e]));
  const id = (key: ElementKey) => {
    const element = ir.elements.get(key);
    return element !== undefined && element.kind !== "edge" ? element.id : key;
  };
  /** `edges[3] ("gateway" → "api")`, or `"call" ("gateway" → "api")` for an edge with an ID. */
  const name = (key: ElementKey) => {
    const edge = byKey.get(key);
    if (edge === undefined) return key;
    const label = edge.id === undefined ? `edges[${edge.index}]` : `"${edge.id}"`;
    return `${label} ("${id(edge.from)}" → "${id(edge.to)}")`;
  };
  /** One edge, or the line several edges of one net share there. */
  const wire = (keys: readonly ElementKey[]) => {
    const names = keys.map(name);
    if (names.length === 1) return `edge ${names[0]}`;
    return `the line shared by ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  };
  const hint =
    "A crossing is not an error, but it makes the figure harder to follow. Edges are routed in document order and the ones written first run straightest, so move the edge you want straight earlier; or leave other sides with fromAnchor / toAnchor; or change the arrangement (a gap, the order of a box's items, align) so the ends no longer face across another wire. Some crossings cannot be avoided (two edges that swap sides).";
  const diagnostics: Diagnostic[] = crossings.slice(0, limit).map((crossing) => {
    const [main, ...own] = crossing.edges;
    const edge = byKey.get(main as ElementKey);
    const source = ir.sourceMap.get(main as ElementKey);
    const related = [
      ...crossing.others.map((key) => ({ key, message: `Crossed edge ${name(key)}.` })),
      ...own.map((key) => ({ key, message: `Edge ${name(key)} runs on the same line.` })),
    ].map(({ key, message }) => {
      const at = ir.sourceMap.get(key);
      return {
        ...(at !== undefined && { path: at.path }),
        ...(at?.location !== undefined && { location: at.location }),
        message,
      };
    });
    return {
      code: "layout/edge-crossing",
      severity: "info",
      message: `${capitalize(wire(crossing.edges))} crosses ${wire(crossing.others)} at ${mm(crossing.point.x)}, ${mm(crossing.point.y)} from the top left of the canvas.`,
      path: source?.path ?? ["edges", edge?.index ?? 0],
      ...(source?.location !== undefined && { location: source.location }),
      subject: {
        kind: "edge",
        id: edge?.id ?? `edges[${edge?.index ?? 0}]`,
      },
      hint,
      related,
    } satisfies Diagnostic;
  });
  if (crossings.length > limit) {
    diagnostics.push({
      code: "layout/edge-crossing",
      severity: "info",
      message: `${crossings.length - limit} more edge crossings are not listed (${crossings.length} in total).`,
      subject: { kind: "figure", id: ir.meta.id },
      hint,
    });
  }
  return diagnostics;
}
