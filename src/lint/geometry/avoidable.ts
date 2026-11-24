/**
 * `geometry/avoidable-bend` (#604, design record
 * `docs/design/decisions/604-avoidable-bends.md`): an orthogonal edge with
 * more bends than its ends need, or with a tiny step between two bends.
 *
 * The rule names the cause and a fix the author can write; it does not
 * change the routes (rewriting them after routing was tried in #617 and
 * dropped; moving nodes into line is `figure.layout.straighten`, #618):
 *
 * - **A written anchor** keeps the ends out of line: the two sides face each
 *   other over a common span, but the anchored position lies outside it.
 *   The hint gives anchor values whose exact line is checked to be clear:
 *   one value when the other end already lies in the span, else one for
 *   each end. Or the anchors hold the ends on sides where an L with one
 *   bend would fit: the hint names the sides.
 * - **A tiny jog**: a step between two bends shorter than 2mm (printed; under
 *   1pt is `geometry/edge-jog`'s), which nothing could straighten.
 * - **A turn just before a junction**: a line into a junction that ends in a
 *   short sideways step (under 4mm) next to another line leaving the
 *   junction along the first one's axis: the junction lies just beside the
 *   side the line leaves, and putting the two in line makes it straight.
 *
 * Structured figures only: the hints are about the structured router's
 * anchors and alignment.
 */

import type { EdgeIR, FigureIR } from "../../compiler/ir";
import type { ElementKey } from "../../core/check-state";
import type { Anchor } from "../../core/figure/layout";
import type { Side } from "../../core/figure/schema";
import { mmToPt, ptToD2Units } from "../../core/units";
import { groupFrontRect } from "../../layout/group-layers";
import { routeStructured } from "../../layout/route/face-routes";
import { STRAIGHT_MARGIN } from "../../layout/route/ports";
import type { Point, Rect } from "../../render/geometry";
import { defineGeometryRule, type LintFinding } from "../rule";
import { capitalize, isDrawnEdge, isStructured, mmText, printedUnits } from "./common";
import type { GeometryContext, GeometryElement } from "./context";
import { unionOf } from "./measure";

/** A step between two bends shorter than this (2mm printed, in units) is a tiny jog. */
export const AVOIDABLE_JOG_UNITS = ptToD2Units(mmToPt(2));
/** Under this (1pt), `geometry/edge-jog` reports the step. */
const MICRO_JOG_UNITS = ptToD2Units(1);
/** A sideways step into a junction shorter than this (4mm) is a near miss. */
const JUNCTION_STEP_UNITS = ptToD2Units(mmToPt(4));
/** How close (units) a straight line may pass another element: the router's clearance. */
const CLEARANCE = 6;

const OPPOSITE: Readonly<Record<Side, Side>> = {
  north: "south",
  south: "north",
  east: "west",
  west: "east",
};

/** Drops repeated points and points on a straight line between their neighbours. */
export function corners(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out.at(-1);
    if (last !== undefined && Math.hypot(p.x - last.x, p.y - last.y) < 1e-3) continue;
    out.push(p);
    while (out.length >= 3) {
      const a = out.at(-3) as Point;
      const b = out.at(-2) as Point;
      const c = out.at(-1) as Point;
      const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      if (Math.abs(cross) > 1e-3) break;
      out.splice(out.length - 2, 1);
    }
  }
  return out;
}

export const orthogonal = (points: readonly Point[]) =>
  points
    .slice(1)
    .every(
      (p, i) =>
        Math.abs(p.x - (points[i] as Point).x) < 1e-3 ||
        Math.abs(p.y - (points[i] as Point).y) < 1e-3,
    );

const distance = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/** The side of `rect` a route leaves `port` from, toward `next`. */
function sideOf(port: Point, next: Point): Side {
  if (Math.abs(next.y - port.y) < 1e-3) return next.x > port.x ? "east" : "west";
  return next.y > port.y ? "south" : "north";
}

const vertical = (side: Side) => side === "north" || side === "south";

/** The span of a side (x of north / south, y of east / west) and its line. */
function sideSpan(r: Rect, side: Side): { lo: number; hi: number; at: number } {
  switch (side) {
    case "north":
      return { lo: r.x, hi: r.x + r.width, at: r.y };
    case "south":
      return { lo: r.x, hi: r.x + r.width, at: r.y + r.height };
    case "west":
      return { lo: r.y, hi: r.y + r.height, at: r.x };
    case "east":
      return { lo: r.y, hi: r.y + r.height, at: r.x + r.width };
  }
}

/** `side` of `a` faces `b` (b lies beyond it). */
function faces(a: Rect, side: Side, b: Rect): boolean {
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

/**
 * The anchor offsets for a straight line between two facing sides over
 * `[lo, hi]`: for each written end, an offset (two decimals, else three, else
 * four) such that all written ends land on one coordinate (to 0.01 unit),
 * that coordinate's line passes `isClear`, nearest to `want`. `undefined` if
 * no representable coordinate gives a clear line.
 */
function straightOffsets(
  ends: readonly { readonly rect: Rect; readonly side: Side }[],
  want: number,
  lo: number,
  hi: number,
  isClear: (at: number) => boolean,
): number[] | undefined {
  const [first, ...rest] = ends;
  if (first === undefined) return undefined;
  const sa = sideSpan(first.rect, first.side);
  const la = sa.hi - sa.lo;
  for (const digits of [2, 3, 4]) {
    const f = 10 ** digits;
    const candidates: { at: number; offsets: number[] }[] = [];
    for (
      let k = Math.ceil(((lo - sa.lo) / la) * f);
      k <= Math.floor(((hi - sa.lo) / la) * f);
      k++
    ) {
      const at = sa.lo + (k / f) * la;
      const offsets = [k / f];
      let lands = true;
      for (const end of rest) {
        const s = sideSpan(end.rect, end.side);
        const o = Math.round(((at - s.lo) / (s.hi - s.lo)) * f) / f;
        if (Math.abs(s.lo + o * (s.hi - s.lo) - at) > 0.01) lands = false;
        offsets.push(o);
      }
      if (lands) candidates.push({ at, offsets });
    }
    candidates.sort((p, q) => Math.abs(p.at - want) - Math.abs(q.at - want) || p.at - q.at);
    for (const c of candidates) if (isClear(c.at)) return c.offsets;
  }
  return undefined;
}

const anchorText = (side: Side, offset: number) =>
  Math.abs(offset - 0.5) < 1e-9 ? side : `${side}:${offset}`;

const writtenAnchor = (edge: EdgeIR, field: "fromAnchor" | "toAnchor"): Anchor | undefined => {
  // A `block` end (#642) holds the middle of the whole element: not a position to tune.
  if ((field === "fromAnchor" ? edge.fromBlock : edge.toBlock) === true) return undefined;
  const value = edge[field];
  return typeof value === "object" ? value : undefined;
};

/** The box an element is routed to: its shape's, or its text's for a label. */
export function boxOf(element: GeometryElement | undefined): Rect | undefined {
  if (element === undefined) return undefined;
  // A layered group's edges end on its front frame, not its whole footprint.
  if (element.ir.kind === "group" && element.bbox !== undefined)
    return groupFrontRect(element.ir, element.bbox);
  return (
    element.bbox ?? unionOf(element.labels.flatMap((l) => (l.box === undefined ? [] : [l.box])))
  );
}

/** Things a suggested line must keep clear of: other nodes and group titles. */
export function obstacles(
  context: GeometryContext,
  edge: EdgeIR,
): { rect: Rect; element: GeometryElement }[] {
  const ends = [edge.from, edge.to];
  const related = (key: ElementKey) =>
    ends.some((end) => end === key || context.isAncestor(key, end) || context.isAncestor(end, key));
  const out: { rect: Rect; element: GeometryElement }[] = [];
  for (const element of context.elements) {
    if (element.kind === "edge") continue;
    if (element.kind === "group") {
      // Every group's title, the ends' own and their ancestors' too: the
      // router keeps routes off all of them (the frame itself is crossed or
      // kept as routed).
      for (const label of element.labels)
        if (label.box !== undefined) out.push({ rect: label.box, element });
      continue;
    }
    // A caption drawn below a node's frame (#491): the router keeps off it too.
    if (element.ir.kind === "node" && element.ir.labelBelow === true)
      for (const label of element.labels)
        if (label.box !== undefined) out.push({ rect: label.box, element });
    if (related(element.key)) continue;
    if (element.ir.kind === "node" && element.ir.mark?.type === "point") {
      // A junction: the router may not pass through it, but keeps no
      // clearance around it. Its box is shrunk by the clearance less half a
      // unit, so the clearance every check adds leaves just that half unit.
      const box = element.bbox ?? boxOf(element);
      if (box !== undefined) {
        const inset = CLEARANCE - 0.5;
        out.push({
          rect: {
            x: box.x + inset,
            y: box.y + inset,
            width: box.width - 2 * inset,
            height: box.height - 2 * inset,
          },
          element,
        });
      }
      continue;
    }
    const box = boxOf(element);
    if (box !== undefined) out.push({ rect: box, element });
  }
  return out;
}

/** The axis-parallel segment meets the rectangle grown by `pad`. */
function hits(a: Point, b: Point, r: Rect, pad: number): boolean {
  return (
    Math.max(a.x, b.x) > r.x - pad &&
    Math.min(a.x, b.x) < r.x + r.width + pad &&
    Math.max(a.y, b.y) > r.y - pad &&
    Math.min(a.y, b.y) < r.y + r.height + pad
  );
}

const clear = (path: readonly Point[], blocks: readonly Rect[]) =>
  path.slice(1).every((b, i) => !blocks.some((r) => hits(path[i] as Point, b, r, CLEARANCE)));

/** Other edges' ends on `side` of `key` (their first or last point on that side's line). */
function sideUsed(
  context: GeometryContext,
  self: GeometryElement,
  key: ElementKey,
  rect: Rect,
  side: Side,
): boolean {
  const { lo, hi, at } = sideSpan(rect, side);
  return context.elements.some((other) => {
    if (other === self || other.ir.kind !== "edge" || other.route === undefined) return false;
    if (other.ir.from !== key && other.ir.to !== key) return false;
    const line = other.route[0] ?? [];
    return [line[0], line.at(-1)].some((p) => {
      if (p === undefined) return false;
      const [along, across] = vertical(side) ? [p.x, p.y] : [p.y, p.x];
      return Math.abs(across - at) < 1 && along >= lo - 1 && along <= hi + 1;
    });
  });
}

interface Fix {
  readonly bends: number;
  readonly anchors: string[];
}

/** An anchor to write: on which end, which side, where along it. */
interface Write {
  readonly field: "fromAnchor" | "toAnchor";
  readonly side: Side;
  readonly offset: number;
}

/**
 * At most this many hint checks per figure. Each check runs the render's
 * routing steps once (`routeStructured`); face resolution among them can
 * itself route the figure several times when it has cuboid face edges.
 */
export const VERIFY_BUDGET = 8;

const bendsOf = (points: readonly Point[] | undefined): number =>
  points === undefined ? Number.POSITIVE_INFINITY : corners(points).length - 2;

/** Per figure: the routes as the router draws them now, and the checks left. */
const verifying = new WeakMap<GeometryContext, { budget: number }>();

/**
 * Writes `writes` on `edge` in a copy of the figure as compiled and routes
 * it again on the same placement, the way render does (`routeStructured`:
 * face routes, then the router): `true` only if the edge then has `bends`
 * bends, every other edge has no more bends than in the rendered figure
 * (which the same steps drew), and routing reports no error. Each call is
 * one check (one pass of those steps, with `hintTrials: false` reaching every
 * routing inside them); at most {@link VERIFY_BUDGET} per figure. Without the
 * placement (an auto figure), nothing is verified.
 */
function verified(
  context: GeometryContext,
  edge: EdgeIR,
  writes: readonly Write[],
  bends: number,
): boolean {
  const placed = context.placed;
  const rendered = context.layout;
  if (placed === undefined || rendered === undefined) return false;
  let state = verifying.get(context);
  if (state === undefined) {
    state = { budget: VERIFY_BUDGET };
    verifying.set(context, state);
  }
  if (state.budget <= 0) return false;
  state.budget--;
  const original = placed.ir.edges.find((e) => e.key === edge.key);
  if (original === undefined) return false;
  const changed: Record<string, unknown> = { ...original };
  for (const w of writes) changed[w.field] = { side: w.side, offset: w.offset };
  const next = changed as unknown as EdgeIR;
  const elements = new Map(placed.ir.elements);
  elements.set(edge.key, next);
  const ir: FigureIR = {
    ...placed.ir,
    elements,
    edges: placed.ir.edges.map((e) => (e.key === edge.key ? next : e)),
  };
  const { routed } = routeStructured(ir, placed.layout, { hintTrials: false });
  if (routed.diagnostics.some((d) => d.severity === "error")) return false;
  const before = new Map(rendered.edges.map((e) => [e.key, bendsOf(e.route?.points)] as const));
  for (const e of routed.layout.edges) {
    const n = bendsOf(e.route?.points);
    if (e.key === edge.key) {
      if (n !== bends) return false;
    } else if (n > (before.get(e.key) ?? Number.POSITIVE_INFINITY)) return false;
  }
  return true;
}

/**
 * Anchors that give `edge` a straight line (or else an L) where its written
 * anchors make it bend, or `undefined`.
 */
function anchorFix(
  context: GeometryContext,
  element: GeometryElement,
  edge: EdgeIR,
  points: readonly Point[],
): Fix | undefined {
  const fromAnchor = writtenAnchor(edge, "fromAnchor");
  const toAnchor = writtenAnchor(edge, "toAnchor");
  if (fromAnchor === undefined && toAnchor === undefined) return undefined;
  // An anchor at a corner (offset 0 or 1) draws a deliberate shape, such as
  // a zoom callout's lines: not a position that missed by a little.
  if (
    [fromAnchor, toAnchor].some((x) => x !== undefined && (x.offset <= 0.001 || x.offset >= 0.999))
  )
    return undefined;
  // A junction has no sides: anchors around it spread a fan on purpose.
  const isPoint = (key: ElementKey) => {
    const e = context.get(key)?.ir;
    return e?.kind === "node" && e.mark?.type === "point";
  };
  if (isPoint(edge.from) || isPoint(edge.to)) return undefined;
  // An anchored end another edge also uses is a shared port (a trunk, a
  // fan-in or fan-out): its position serves them all.
  const shared = (p: Point) =>
    context.elements.some((o) => {
      if (o === element || o.ir.kind !== "edge" || o.route?.[0] === undefined) return false;
      const line = o.route[0];
      return [line[0], line.at(-1)].some((q) => q !== undefined && distance(p, q) < 0.5);
    });
  if (
    (fromAnchor !== undefined && shared(points[0] as Point)) ||
    (toAnchor !== undefined && shared(points.at(-1) as Point))
  )
    return undefined;
  const a = boxOf(context.get(edge.from));
  const b = boxOf(context.get(edge.to));
  if (a === undefined || b === undefined || edge.from === edge.to) return undefined;
  if (context.isAncestor(edge.from, edge.to) || context.isAncestor(edge.to, edge.from))
    return undefined;
  const fromSide = fromAnchor?.side ?? sideOf(points[0] as Point, points[1] as Point);
  const toSide = toAnchor?.side ?? sideOf(points.at(-1) as Point, points.at(-2) as Point);
  const blocks = obstacles(context, edge).map((o) => o.rect);
  const bends = points.length - 2;
  const candidates: { bends: number; writes: Write[] }[] = [];
  // Straight: the written sides face each other over a common span.
  if (bends >= 2 && toSide === OPPOSITE[fromSide] && faces(a, fromSide, b)) {
    const sa = sideSpan(a, fromSide);
    const sb = sideSpan(b, toSide);
    const margin = (s: { lo: number; hi: number }) => Math.min(STRAIGHT_MARGIN, (s.hi - s.lo) / 2);
    const lo = Math.max(sa.lo + margin(sa), sb.lo + margin(sb));
    const hi = Math.min(sa.hi - margin(sa), sb.hi - margin(sb));
    if (hi >= lo) {
      const written = (anchor: Anchor | undefined, r: Rect, side: Side) => {
        if (anchor === undefined) return undefined;
        const s = sideSpan(r, side);
        return s.lo + anchor.offset * (s.hi - s.lo);
      };
      const wf = written(fromAnchor, a, fromSide);
      const wt = written(toAnchor, b, toSide);
      // The line: nearest to the written positions, inside the common span.
      const want = wf ?? wt ?? (lo + hi) / 2;
      const at = Math.min(
        hi,
        Math.max(lo, wt !== undefined && wf !== undefined ? (wf + wt) / 2 : want),
      );
      const lineAt = (c: number): Point[] =>
        vertical(fromSide)
          ? [
              { x: c, y: sa.at },
              { x: c, y: sb.at },
            ]
          : [
              { x: sa.at, y: c },
              { x: sb.at, y: c },
            ];
      const outside = (w: number | undefined) =>
        w !== undefined && (w < lo - 1e-6 || w > hi + 1e-6);
      // Both written, inside the span but apart: one position for both.
      const apart = wf !== undefined && wt !== undefined && Math.abs(wf - wt) > 0.5;
      // An end without an anchor stays where the router put it: a single
      // anchor can only line up with that end's position (within the 1pt the
      // router straightens, #169); else both ends get a value.
      const across = (p: Point, side: Side) => (vertical(side) ? p.x : p.y);
      const single = (wf === undefined) !== (wt === undefined);
      const freeAt =
        wf === undefined
          ? across(points[0] as Point, fromSide)
          : across(points.at(-1) as Point, toSide);
      const alone = single && freeAt >= lo - 1e-6 && freeAt <= hi + 1e-6;
      // One anchor in the span, but off the other end's position by more
      // than the router straightens.
      const off = alone && Math.abs((wf ?? wt ?? freeAt) - freeAt) > 2;
      if (outside(wf) || outside(wt) || apart || off) {
        const all = [
          ["fromAnchor", a, fromSide],
          ["toAnchor", b, toSide],
        ] as const;
        // Proposals, checked by routing again below: the written anchor in
        // line with the other end where it is, then a value for each end.
        const tries: [readonly (typeof all)[number][], number, number, number][] = [];
        if (alone)
          tries.push([
            all.filter(([field]) => (field === "fromAnchor" ? wf : wt) !== undefined),
            freeAt,
            Math.max(lo, freeAt - 1),
            Math.min(hi, freeAt + 1),
          ]);
        tries.push([all, at, lo, hi]);
        for (const [fields, want, from, to] of tries) {
          const offsets = straightOffsets(
            fields.map(([, rect, side]) => ({ rect, side })),
            want,
            from,
            to,
            (c) => clear(lineAt(c), blocks),
          );
          if (offsets !== undefined)
            candidates.push({
              bends: 0,
              writes: fields.map(([field, , side], i) => ({
                field,
                side,
                offset: offsets[i] as number,
              })),
            });
        }
      }
    }
  }
  // L: apart on both axes; one end leaves along x, the other along y. Only
  // with both ends anchored: an unanchored end's port can move (fan-in
  // spreading, port separation) when the other end changes side, so the L
  // checked here could differ from the one the anchors would give.
  const apartX = a.x + a.width <= b.x || b.x + b.width <= a.x;
  const apartY = a.y + a.height <= b.y || b.y + b.height <= a.y;
  if (fromAnchor !== undefined && toAnchor !== undefined && bends >= 2 && apartX && apartY) {
    const right = b.x >= a.x + a.width;
    const down = b.y >= a.y + a.height;
    const first = points[0] as Point;
    const last = points.at(-1) as Point;
    // An end that keeps its side keeps its written position (where the route
    // ends now); an end that moves takes the middle of its new side (the bare
    // side the hint writes).
    const options: { from: Side; to: Side }[] = [
      { from: right ? "east" : "west", to: down ? "north" : "south" },
      { from: down ? "south" : "north", to: right ? "west" : "east" },
    ];
    for (const option of options) {
      const keepFrom = option.from === fromAnchor.side;
      const keepTo = option.to === toAnchor.side;
      if (keepFrom && keepTo) continue;
      const sa = sideSpan(a, option.from);
      const sb = sideSpan(b, option.to);
      const fromAt = keepFrom ? (vertical(option.from) ? first.x : first.y) : (sa.lo + sa.hi) / 2;
      const toAt = keepTo ? (vertical(option.to) ? last.x : last.y) : (sb.lo + sb.hi) / 2;
      const p: Point = vertical(option.from) ? { x: fromAt, y: sa.at } : { x: sa.at, y: fromAt };
      const r: Point = vertical(option.to) ? { x: toAt, y: sb.at } : { x: sb.at, y: toAt };
      const q: Point = vertical(option.from) ? { x: p.x, y: r.y } : { x: r.x, y: p.y };
      if (distance(p, q) < CLEARANCE || distance(q, r) < CLEARANCE) continue;
      if (!clear([p, q, r], blocks)) continue;
      if (!keepFrom && sideUsed(context, element, edge.from, a, option.from)) continue;
      if (!keepTo && sideUsed(context, element, edge.to, b, option.to)) continue;
      candidates.push({
        bends: 1,
        writes: [
          ...(keepFrom ? [] : [{ field: "fromAnchor" as const, side: option.from, offset: 0.5 }]),
          ...(keepTo ? [] : [{ field: "toAnchor" as const, side: option.to, offset: 0.5 }]),
        ],
      });
    }
  }
  // Only what the router, given the anchors, is seen to draw.
  for (const c of candidates) {
    if (c.bends >= bends || !verified(context, edge, c.writes, c.bends)) continue;
    return {
      bends: c.bends,
      anchors: c.writes.map((w) => `${w.field} "${anchorText(w.side, w.offset)}"`),
    };
  }
  return undefined;
}

/**
 * Whether some two-bend route from `p` (leaving `fromSide`) to `q` on the
 * facing side keeps the clearance from every rectangle, exactly: the middle
 * segment's position `m` must keep both stubs, the first leg must stop
 * before anything across `p`'s line, the last leg start after anything
 * across `q`'s line, and the middle segment must miss everything across its
 * span. Each condition is an interval of `m`; the free positions are what
 * is left of the stubs' range.
 */
export function twoBendFits(p: Point, q: Point, fromSide: Side, rects: readonly Rect[]): boolean {
  const horizontal = fromSide === "east" || fromSide === "west";
  // Work as if the route leaves along x: swap the axes otherwise.
  const along = (pt: Point) => (horizontal ? pt.x : pt.y);
  const across = (pt: Point) => (horizontal ? pt.y : pt.x);
  const box = (r: Rect) =>
    horizontal
      ? {
          a0: r.x - CLEARANCE,
          a1: r.x + r.width + CLEARANCE,
          c0: r.y - CLEARANCE,
          c1: r.y + r.height + CLEARANCE,
        }
      : {
          a0: r.y - CLEARANCE,
          a1: r.y + r.height + CLEARANCE,
          c0: r.x - CLEARANCE,
          c1: r.x + r.width + CLEARANCE,
        };
  const a = along(p);
  const b = along(q);
  const s = Math.sign(b - a);
  if (s === 0) return false;
  // Positions in the direction of travel: t = s × m, so the legs run upwards.
  let lo = s * a + CLEARANCE;
  let hi = s * b - CLEARANCE;
  const cp = across(p);
  const cq = across(q);
  const c0 = Math.min(cp, cq);
  const c1 = Math.max(cp, cq);
  const blocked: [number, number][] = [];
  for (const r of rects) {
    const k = box(r);
    // In travel coordinates, the rectangle's open interval along the route.
    const t0 = Math.min(s * k.a0, s * k.a1);
    const t1 = Math.max(s * k.a0, s * k.a1);
    // The first leg runs from s·a to t on p's line: it must end at t0 at the latest.
    if (cp > k.c0 && cp < k.c1 && t1 > s * a) hi = Math.min(hi, t0);
    // The last leg runs from t to s·b on q's line: it must start at t1 at the earliest.
    if (cq > k.c0 && cq < k.c1 && t0 < s * b) lo = Math.max(lo, t1);
    // The middle segment, across from p's line to q's, must not be inside it.
    if (c1 > k.c0 && c0 < k.c1) blocked.push([t0, t1]);
  }
  if (hi < lo) return false;
  // The free positions in [lo, hi] outside every open blocked interval.
  blocked.sort((x, y) => x[0] - y[0]);
  let at = lo;
  for (const [t0, t1] of blocked) {
    if (t1 <= at) continue;
    if (t0 >= at) return true;
    at = t1;
    if (at > hi) return false;
  }
  return at <= hi;
}

/**
 * Two-bend routes from `p` to `q` with their middle segment at 33 positions
 * between the stubs, for naming what is in the way (the claim that none
 * fits is `twoBendFits`).
 */
function twoBendSamples(p: Point, q: Point, fromSide: Side): Point[][] {
  const horizontal = fromSide === "east" || fromSide === "west";
  const lo = (horizontal ? Math.min(p.x, q.x) : Math.min(p.y, q.y)) + CLEARANCE;
  const hi = (horizontal ? Math.max(p.x, q.x) : Math.max(p.y, q.y)) - CLEARANCE;
  return Array.from({ length: 33 }, (_, i) => {
    const m = lo + ((hi - lo) * i) / 32;
    return horizontal
      ? [p, { x: m, y: p.y }, { x: m, y: q.y }, q]
      : [p, { x: p.x, y: m }, { x: q.x, y: m }, q];
  });
}

/**
 * For a route of three or more bends between sides that face each other,
 * with a step under 4mm, when no two-bend route between its ports is clear
 * of the other elements by the clearance (`twoBendFits`): the elements in
 * the way of those routes. Empty otherwise.
 */
function staircaseBlockers(
  context: GeometryContext,
  edge: EdgeIR,
  points: readonly Point[],
): GeometryElement[] {
  if (points.length < 5) return [];
  const p = points[0] as Point;
  const q = points.at(-1) as Point;
  const fromSide = sideOf(p, points[1] as Point);
  const toSide = sideOf(q, points.at(-2) as Point);
  if (toSide !== OPPOSITE[fromSide]) return [];
  const ahead =
    fromSide === "east"
      ? q.x - p.x
      : fromSide === "west"
        ? p.x - q.x
        : fromSide === "south"
          ? q.y - p.y
          : p.y - q.y;
  if (ahead <= 2 * CLEARANCE) return [];
  const steps = points.slice(1, -2).map((a, i) => distance(a, points[i + 2] as Point));
  // Steps under 1pt are `geometry/edge-jog`'s.
  const short = (l: number) => {
    const printed = printedUnits(context, l);
    return printed >= MICRO_JOG_UNITS - 0.002 && printed < JUNCTION_STEP_UNITS;
  };
  if (!steps.some(short)) return [];
  const all = obstacles(context, edge);
  const rects = all.map((o) => o.rect);
  if (twoBendFits(p, q, fromSide, rects)) return [];
  const columns = twoBendSamples(p, q, fromSide);
  // Every column is blocked: the elements that block some of them.
  const seen = new Set<GeometryElement>();
  for (const path of columns) {
    for (const { rect, element } of all) {
      if (seen.has(element)) continue;
      if (path.slice(1).some((b, i) => hits(path[i] as Point, b, rect, CLEARANCE)))
        seen.add(element);
    }
  }
  return [...seen];
}

/**
 * The edge is a branch of a group drawn alike: it ends at a junction, or one
 * of its ends shares its element's side with another edge's end (a fan-out,
 * fan-in, spread fan-in or multi-edge).
 */
export function inGroup(
  context: GeometryContext,
  element: GeometryElement,
  points: readonly Point[],
): boolean {
  const edge = element.ir;
  if (edge.kind !== "edge") return false;
  const point = (key: ElementKey) => {
    const e = context.get(key)?.ir;
    return e?.kind === "node" && e.mark?.type === "point";
  };
  if (point(edge.from) || point(edge.to)) return true;
  // An end and the point next to it: the side's line is across that leg.
  const ends: [ElementKey, Point, Point][] = [
    [edge.from, points[0] as Point, points[1] as Point],
    [edge.to, points.at(-1) as Point, points.at(-2) as Point],
  ];
  return context.elements.some((o) => {
    if (o === element || o.ir.kind !== "edge" || o.route?.[0] === undefined) return false;
    const line = corners(o.route[0]);
    const theirs: [ElementKey, Point | undefined, Point | undefined][] = [
      [o.ir.from, line[0], line[1]],
      [o.ir.to, line.at(-1), line.at(-2)],
    ];
    return ends.some(([key, p, next]) =>
      theirs.some(([k, q, qn]) => {
        if (k !== key || q === undefined || qn === undefined) return false;
        const vertical = Math.abs(p.x - next.x) < 1e-3;
        const theirVertical = Math.abs(q.x - qn.x) < 1e-3;
        if (vertical !== theirVertical) return false;
        // On one side: the same line across the leg, and leaving the same way.
        return vertical
          ? Math.abs(p.y - q.y) < 0.5 && Math.sign(next.y - p.y) === Math.sign(qn.y - q.y)
          : Math.abs(p.x - q.x) < 0.5 && Math.sign(next.x - p.x) === Math.sign(qn.x - q.x);
      }),
    );
  });
}

export const avoidableBend = defineGeometryRule({
  id: "geometry/avoidable-bend",
  description:
    "An orthogonal edge bends more than its ends need because of a written anchor, has a step under 2mm between two bends, or turns just before a junction it nearly lines up with.",
  defaultSeverity: "warning",
  fixable: false,
  run(context) {
    if (!isStructured(context)) return [];
    const findings: LintFinding[] = [];
    for (const element of context.elements) {
      const edge = element.ir;
      if (edge.kind !== "edge" || !isDrawnEdge(element) || element.route === undefined) continue;
      if (edge.routing === "zoom" || edge.route === "curve" || edge.route === "straight") continue;
      // A lane (#609) is the author's route: its bends are asked for.
      if (edge.lane !== undefined) continue;
      const line = element.route[0];
      if (line === undefined || element.route.length !== 1) continue;
      const points = corners(line);
      if (points.length < 3 || !orthogonal(points)) continue;
      const bends = points.length - 2;
      const fix = anchorFix(context, element, edge, points);
      if (fix !== undefined && fix.anchors.length > 0) {
        findings.push({
          message: `${capitalize(element.name)} bends ${bends} times where ${fix.bends === 0 ? "a straight line" : "one bend"} would do: its written ${fix.anchors.length === 1 ? "anchor holds an end" : "anchors hold the ends"} ${fix.bends === 0 ? "out of line" : "on sides that need more bends"}.`,
          path: element.docPath,
          subject: element.subject,
          hint: `Write ${fix.anchors.join(" and ")}, or remove the anchor if the default sides are fine (or figure.layout.straighten: true, which moves nodes into line). Write an anchor only where the side or position matters.`,
        });
        continue;
      }
      const steps = points.slice(1, -2).map((p, i) => distance(p, points[i + 2] as Point));
      // A staircase between facing sides: something stands between the ends.
      const blockers = staircaseBlockers(context, edge, points);
      if (blockers.length > 0) {
        const short = steps.filter((l) => {
          const printed = printedUnits(context, l);
          return printed >= MICRO_JOG_UNITS - 0.002 && printed < JUNCTION_STEP_UNITS;
        });
        findings.push({
          message: `${capitalize(element.name)} bends ${bends} times, with steps of ${short.map((l) => mmText(context, l)).join(", ")}, where its ends face each other: no route with two bends between its current ends keeps clear of the elements around it (in the way: ${blockers.map((b) => (b.kind === "group" ? `the title of ${b.name}` : b.name)).join(", ")}).`,
          path: element.docPath,
          subject: element.subject,
          hint: "Make room for a single step between the ends: give the elements in the way more room or another place (an attached label's side or gap, the arrange order or a gap), or line the ends up (figure.layout.straighten: true).",
          related: blockers.map((b) => ({
            path: b.docPath,
            message: `${capitalize(b.name)} is defined here.`,
          })),
        });
        continue;
      }
      const tiny = steps.filter((l) => {
        const printed = printedUnits(context, l);
        return printed >= MICRO_JOG_UNITS - 0.002 && printed < AVOIDABLE_JOG_UNITS;
      });
      // A branch of a fan (a junction end, or an end another edge shares) is
      // drawn like its siblings: its step is part of the group's shape.
      if (tiny.length > 0 && !inGroup(context, element, points)) {
        const anchored =
          writtenAnchor(edge, "fromAnchor") !== undefined ||
          writtenAnchor(edge, "toAnchor") !== undefined;
        findings.push({
          message: `${capitalize(element.name)} has ${tiny.length === 1 ? "a step" : `${tiny.length} steps`} of ${tiny.map((l) => mmText(context, l)).join(", ")} between two bends (under 2mm): a jog that reads as a mistake.`,
          path: element.docPath,
          subject: element.subject,
          hint: anchored
            ? "Change fromAnchor / toAnchor so the ends line up (or remove them), or give the edge room for one clear step (figure.layout.straighten: true moves nodes into line)."
            : "Something blocks a cleaner line: move the nodes or attached labels in the way (an attach gap or side, the arrange order or a gap) so the edge has a straight channel, or line the two ends up.",
        });
        continue;
      }
      // A short sideways step into (or out of) a junction.
      if (bends !== 1) continue;
      // Only a line into a junction: out of one, a short step is how a fan-out
      // reaches a target beside its trunk.
      for (const [junctionKey, otherKey, step, run] of [
        [
          edge.to,
          edge.from,
          distance(points.at(-2) as Point, points.at(-1) as Point),
          distance(points[0] as Point, points[1] as Point),
        ],
      ] as const) {
        const junction = context.get(junctionKey);
        const other = context.get(otherKey);
        if (
          junction?.ir.kind !== "node" ||
          junction.ir.mark?.type !== "point" ||
          other === undefined
        )
          continue;
        if (other.ir.kind === "node" && other.ir.mark?.type === "point") continue;
        const printed = printedUnits(context, step);
        if (printed >= JUNCTION_STEP_UNITS || run <= step) continue;
        // A near miss only if another line leaves the junction along the
        // long run's axis (the trunk it misses), not where the step simply
        // joins a bus at its end.
        const at = (junctionKey === edge.to ? points.at(-1) : points[0]) as Point;
        const [r0, r1] = (
          junctionKey === edge.to ? [points[0], points[1]] : [points.at(-2), points.at(-1)]
        ) as [Point, Point];
        const runVertical = Math.abs(r0.x - r1.x) < 1e-3;
        const missed = context.elements.some((o) => {
          if (o === element || o.ir.kind !== "edge" || o.route?.[0] === undefined) return false;
          if (o.ir.from !== junctionKey && o.ir.to !== junctionKey) return false;
          const line = corners(o.route[0]);
          const [p, q] = (
            o.ir.from === junctionKey ? [line[0], line[1]] : [line.at(-1), line.at(-2)]
          ) as [Point | undefined, Point | undefined];
          if (p === undefined || q === undefined || distance(p, at) > 1) return false;
          return runVertical ? Math.abs(p.x - q.x) < 1e-3 : Math.abs(p.y - q.y) < 1e-3;
        });
        if (!missed) continue;
        findings.push({
          message: `${capitalize(element.name)} turns ${mmText(context, step)} before junction "${junction.ir.id}": the junction lies just beside the side of ${other.name} the line leaves, so a straight line misses it.`,
          path: element.docPath,
          subject: element.subject,
          hint: `Put ${other.name} and junction "${junction.ir.id}" in line (figure.layout.align, the junction's place, or the order or align of the arrange box), so the line runs straight into the junction.`,
          related: [
            { path: junction.docPath, message: `Junction "${junction.ir.id}" is defined here.` },
          ],
        });
        break;
      }
    }
    return findings;
  },
});
