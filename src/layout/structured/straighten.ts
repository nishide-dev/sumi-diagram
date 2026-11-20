/**
 * `figure.layout.straighten` (#618, design #618): line up the ends of an edge
 * by moving a node or group, the way a person drawing the figure would,
 * rather than bending the line.
 *
 * After the engine's pass (and the `figure.layout.align` solve, #132), the
 * edges' ends are resolved as the router resolves them (`resolveEnds`). An
 * edge whose ends face each other (opposite sides, the target ahead) but are
 * out of line by more than the router's own {@link STRAIGHTEN_TOLERANCE} is
 * crooked. For each crooked edge, in document order, the candidates are an
 * arrange item holding one end (the target's end first, then the source's;
 * the end's own slot first, then the boxes and groups around it) shifted
 * across the edge: by the whole offset (the ports line up), else by the least
 * amount that brings the ends within the side of an end without an anchor
 * (the router then moves that end onto the other's line, `far` in
 * `ports.ts`). A shift translates the item and everything placed inside it
 * or attached to it; sizes never change. A candidate is laid out and kept
 * only if:
 *
 * - its box leaves it free on that axis (`Slot.soft`): a stack (for `x`) or
 *   a row (for `y`) that centres its items (written `start`, `end` and
 *   `stretch` line items up on purpose), not a `gap: 0` box, no cross-axis
 *   space from `figure.layout.align` (#545); or a `place` box whose
 *   coordinate on that axis no other item shares (a shared coordinate is a
 *   line the author drew). Cells of tokens / matrices and anything on a
 *   tilted plane or in a chat never move;
 * - it stays inside its box's frame, the canvas and every other element are
 *   exactly where they were (nothing grows, nothing else moves), it gets no
 *   closer than {@link CLEARANCE} to anything it was not already closer to,
 *   and it stays inside every group it was inside;
 * - it moves no element of a `figure.layout.align` constraint on that axis,
 *   and no part of a fan without the whole fan: an element with two or more
 *   ends without an anchor on one side, or a junction that two or more edges
 *   leave (or enter), with the elements at their other ends. Edges of a fan
 *   are not straightened either: their branches stay alike;
 * - the edge becomes straight, and every edge that was straight stays so
 *   (lined up, or straight thanks to the router).
 *
 * The candidates are ranked: more edges lined up, then more straight, then
 * fewer elements moved, then the earlier. The best one whose routes do no
 * harm wins: routed, the edge is straight, no edge gains a bend or loses its
 * route, and the routed figure is no larger ({@link MAX_STRAIGHTEN_ROUTINGS}).
 * Rounds repeat until no edge changes ({@link MAX_STRAIGHTEN_ROUNDS}) or the
 * layouts are spent ({@link MAX_STRAIGHTEN_LAYOUTS}). Deterministic: document
 * order and the engine's rounding.
 */

import type { ArrangeItemIR, FigureIR } from "../../compiler/ir";
import type { ElementKey } from "../../core/check-state";
import type { LayoutIR, Point, Rect } from "../ir";
import {
  type End,
  facing,
  resolveEnds,
  STRAIGHT_MARGIN,
  STRAIGHTEN_TOLERANCE,
} from "../route/ports";
import { routeEdges } from "../route/router";
import type { Shifts, Slot } from "./engine";

/** One layout with shifts: the Layout IR, where the items were placed and the footprints (pass coordinates). */
export interface StraightenTrial {
  readonly layout: LayoutIR;
  readonly slots: ReadonlyMap<ArrangeItemIR, Slot>;
  readonly footprints: ReadonlyMap<ElementKey, Rect>;
}

/** The most layouts one figure's straightening computes. */
export const MAX_STRAIGHTEN_LAYOUTS = 400;

/** The most rounds over the edges. */
export const MAX_STRAIGHTEN_ROUNDS = 4;

/** How close (units, 3pt: the router's clearance) a moved element may come to another one. */
export const CLEARANCE = 6;

/** Rounding of the engine (1/1000 unit) and floating-point noise. */
const EPS = 0.002;

export interface StraightenStats {
  /** Layouts computed, the first included. */
  readonly layouts: number;
  /** The edges (indices) made straight. */
  readonly straightened: readonly number[];
  /** The edges (indices) straight because an end slides along its side (`EdgeLayout.slide`). */
  readonly slides: readonly number[];
  /** The shifts kept, by item (an element key, or `box:<first item>`). */
  readonly shifts: Readonly<Record<string, Point>>;
}

export interface StraightenResult {
  readonly trial: StraightenTrial;
  /** The trial's layout with `slide` on the edges that slide. */
  readonly layout: LayoutIR;
  readonly shifts: Shifts;
  readonly stats: StraightenStats;
}

type Axis = "x" | "y";

/** The ends of a crooked edge, as resolved without moving any end along its side. */
interface Crooked {
  /** The axis across the edge: the one a shift moves along. */
  readonly axis: Axis;
  /** The target's port minus the source's, on {@link axis}. */
  readonly delta: number;
  readonly from: End;
  readonly to: End;
  /**
   * For an end without an anchor: where on its side (on {@link axis}) the
   * router may move it onto the other end's line (`far` in `ports.ts`).
   */
  readonly room: { readonly from?: Range; readonly to?: Range };
}

type Range = readonly [number, number];

/** The state of the ends in one layout. */
interface EdgeState {
  /** Edges (indices) whose ends are in line where they were resolved (no end moved along its side). */
  readonly aligned: ReadonlySet<number>;
  /** Edges drawn straight: aligned, or an end without an anchor moved onto the other's line. */
  readonly straight: ReadonlySet<number>;
  /** Edges whose ends face each other but are not aligned. */
  readonly crooked: ReadonlyMap<number, Crooked>;
  /** For each fan, every element in it (the hub and the other ends). */
  readonly fans: readonly ReadonlySet<ElementKey>[];
  /** Ends (`edge from|to`) of fans. */
  readonly fanEnds: ReadonlySet<string>;
}

interface Candidate {
  readonly trial: StraightenTrial;
  readonly state: EdgeState;
  readonly shifts: Map<ArrangeItemIR, Point>;
  readonly moved: number;
  /** The edges that slide with this candidate. */
  readonly slides: ReadonlySet<number>;
}

/**
 * Straightens `ir`'s crooked edges by shifting arrange items (see the module
 * comment). `layoutWith` is the engine's pass with fixed struts.
 */
export function straightenLayout(
  ir: FigureIR,
  layoutWith: (shifts: Shifts) => StraightenTrial,
  maxLayouts = MAX_STRAIGHTEN_LAYOUTS,
): StraightenResult {
  let current = layoutWith(new Map());
  let layouts = 1;
  let shifts = new Map<ArrangeItemIR, Point>();
  const straightened: number[] = [];
  const info = figureInfo(ir);
  /** Edges whose unanchored end may slide along its side (`EdgeLayout.slide`), checked by routing. */
  let slides: ReadonlySet<number> = new Set<number>();
  let state = edgeState(ir, current.layout, slides);
  /** The routes of `current`, once needed. */
  let routed: RouteSummary | undefined;
  let routings = 0;
  for (let round = 0; round < MAX_STRAIGHTEN_ROUNDS && layouts < maxLayouts; round++) {
    let changed = false;
    for (const index of [...state.crooked.keys()]) {
      if (layouts >= maxLayouts) break;
      const crooked = state.crooked.get(index);
      if (crooked === undefined) continue;
      if (state.fanEnds.has(`${index} from`) || state.fanEnds.has(`${index} to`)) continue;
      const found: Candidate[] = [];
      const consider = (
        trial: StraightenTrial,
        trialShifts: Map<ArrangeItemIR, Point>,
        moved: number,
      ): void => {
        const withSlide = new Set(slides).add(index);
        const after = edgeState(ir, trial.layout, withSlide);
        if (!after.straight.has(index)) return;
        if (!includes(after.aligned, state.aligned) || !includes(after.straight, state.straight))
          return;
        // Lined up without sliding: the edge needs no slide.
        const trialSlides = after.aligned.has(index) ? new Set(slides) : withSlide;
        found.push({ trial, state: after, shifts: trialShifts, moved, slides: trialSlides });
      };
      for (const which of ["to", "from"] as const) {
        const end = which === "to" ? crooked.to : crooked.from;
        const other = which === "to" ? crooked.from : crooked.to;
        const amounts = shiftAmounts(crooked, which);
        for (const item of info.path(end.key, current.slots)) {
          if (layouts >= maxLayouts) break;
          const slot = current.slots.get(item) as Slot;
          if (!slot.soft[crooked.axis]) continue;
          const inside = info.contents(item);
          // Both ends would move: no larger item helps either.
          if (inside.has(other.key)) break;
          if (info.aligned[crooked.axis].some((key) => inside.has(key))) continue;
          if (state.fans.some((fan) => splits(fan, inside))) continue;
          for (const delta of amounts) {
            if (layouts >= maxLayouts) break;
            const shift = shifts.get(item) ?? { x: 0, y: 0 };
            const next = { ...shift, [crooked.axis]: shift[crooked.axis] + delta };
            if (!withinFrame(slot, next, crooked.axis)) continue;
            const trialShifts = new Map(shifts);
            trialShifts.set(item, next);
            const trial = layoutWith(trialShifts);
            layouts++;
            if (!keepsTheRest(info, current, trial, inside, crooked.axis, delta)) continue;
            consider(trial, trialShifts, inside.size);
          }
        }
      }
      // Last resort: no node moves, an end slides along its side (ranked after every shift).
      consider(current, shifts, Number.POSITIVE_INFINITY);
      // The best first (a stable sort keeps the earlier of equals); the first that harms no route wins.
      found.sort((a, b) => (better(a, b) ? -1 : better(b, a) ? 1 : 0));
      for (const candidate of found) {
        if (routings >= MAX_STRAIGHTEN_ROUTINGS) break;
        if (routed === undefined) {
          routed = routeSummary(ir, withSlides(current.layout, slides));
          routings++;
        }
        const next = routeSummary(ir, withSlides(candidate.trial.layout, candidate.slides));
        routings++;
        if (!harmless(routed, next, index)) continue;
        current = candidate.trial;
        state = candidate.slides.has(index)
          ? candidate.state
          : edgeState(ir, candidate.trial.layout, candidate.slides);
        shifts = candidate.shifts;
        slides = candidate.slides;
        routed = next;
        straightened.push(index);
        changed = true;
        break;
      }
    }
    if (!changed) break;
  }
  const record: Record<string, Point> = {};
  for (const [item, shift] of shifts) record[itemName(item)] = shift;
  return {
    trial: current,
    layout: withSlides(current.layout, slides),
    shifts,
    stats: { layouts, straightened, slides: [...slides].sort((a, b) => a - b), shifts: record },
  };
}

/** `layout` with `slide` set on the edges `slides` (indices) and on no other (#618). */
function withSlides(layout: LayoutIR, slides: ReadonlySet<number>): LayoutIR {
  const marked = layout.edges.some((e, i) => (e.slide === true) !== slides.has(i));
  if (!marked) return layout;
  return {
    ...layout,
    edges: layout.edges.map((edge, i) => {
      const { slide: _, ...rest } = edge;
      return slides.has(i) ? { ...rest, slide: true as const } : rest;
    }),
  };
}

/** The most routings (of the current layout and of candidates) one figure's straightening runs. */
export const MAX_STRAIGHTEN_ROUTINGS = 40;

/** What the router makes of a layout: each edge's bends (routed edges only) and the errors. */
interface RouteSummary {
  readonly bends: ReadonlyMap<number, number>;
  /**
   * The other edges (`route: straight` / `curve`, zoom): whether each has a route, and whether
   * that route is one horizontal or vertical line.
   */
  readonly direct: ReadonlyMap<number, { readonly drawn: boolean; readonly level: boolean }>;
  readonly errors: number;
  /** The canvas once routed: routes and edge labels can widen it. */
  readonly canvas: { readonly width: number; readonly height: number };
}

function routeSummary(ir: FigureIR, layout: LayoutIR): RouteSummary {
  const result = routeEdges(ir, layout, { hintTrials: false });
  const bends = new Map<number, number>();
  const direct = new Map<number, { drawn: boolean; level: boolean }>();
  for (const [index, edge] of result.layout.edges.entries()) {
    const points = edge.route?.points;
    if (!routed(ir, index)) {
      const [a, b] = points ?? [];
      const level =
        points?.length === 2 &&
        a !== undefined &&
        b !== undefined &&
        (Math.abs(a.x - b.x) < EPS || Math.abs(a.y - b.y) < EPS);
      direct.set(index, { drawn: edge.route !== undefined, level });
      continue;
    }
    if (points !== undefined) bends.set(index, bendCount(points));
  }
  const errors = result.diagnostics.filter((d) => d.severity === "error").length;
  return { bends, direct, errors, canvas: result.layout.canvas };
}

/** Corners of a polyline: points that are not on the line through their neighbours. */
function bendCount(points: readonly Point[]): number {
  let count = 0;
  for (let i = 1; i + 1 < points.length; i++) {
    const a = points[i - 1] as Point;
    const b = points[i] as Point;
    const c = points[i + 1] as Point;
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) > 1e-6) count++;
  }
  return count;
}

/**
 * A move is kept only if the edge is routed straight and the move does no
 * harm to the routes: no edge gains a bend or loses its route (a `route:
 * straight` / `curve` or zoom edge keeps its route, and a level one stays
 * level), and the routed figure is no larger.
 */
function harmless(before: RouteSummary, after: RouteSummary, index: number): boolean {
  if (after.errors > before.errors) return false;
  if (after.canvas.width > before.canvas.width || after.canvas.height > before.canvas.height)
    return false;
  for (const [i, bends] of before.bends) {
    const now = after.bends.get(i);
    if (now === undefined || now > bends) return false;
  }
  // A straight, curved or zoom edge keeps its route, and a level one stays level.
  for (const [i, was] of before.direct) {
    const now = after.direct.get(i);
    if (now === undefined || (was.drawn && !now.drawn) || (was.level && !now.level)) return false;
  }
  return after.bends.get(index) === 0;
}

/** More aligned edges, then more straight ones, then fewer elements moved; else the earlier. */
function better(a: Candidate, b: Candidate): boolean {
  if (a.state.aligned.size !== b.state.aligned.size)
    return a.state.aligned.size > b.state.aligned.size;
  if (a.state.straight.size !== b.state.straight.size)
    return a.state.straight.size > b.state.straight.size;
  return a.moved < b.moved;
}

function includes(all: ReadonlySet<number>, some: ReadonlySet<number>): boolean {
  for (const i of some) if (!all.has(i)) return false;
  return true;
}

/** Inner margin (units) a partial shift keeps inside an end's room, against rounding. */
const ROOM_NUDGE = 0.01;

/**
 * How far to shift the `which` end's item: the whole offset (the ports line
 * up), then the least shift that brings the ends within an end's room
 * (the router moves that end onto the other's line). Smaller amounts are
 * never tried: an end the router can already move needs no shift.
 */
function shiftAmounts(crooked: Crooked, which: "from" | "to"): number[] {
  const full = which === "to" ? -crooked.delta : crooked.delta;
  const out = [full];
  const mover = which === "to" ? crooked.to : crooked.from;
  const still = which === "to" ? crooked.from : crooked.to;
  const p = mover.port[crooked.axis];
  const q = still.port[crooked.axis];
  // The still end's room: the mover's port must move into it.
  const stillRoom = which === "to" ? crooked.room.from : crooked.room.to;
  if (stillRoom !== undefined) out.push(nearest(stillRoom[0] - p, stillRoom[1] - p));
  // The mover's room moves with it: it must come over the still port.
  const moverRoom = which === "to" ? crooked.room.to : crooked.room.from;
  if (moverRoom !== undefined) out.push(nearest(q - moverRoom[1], q - moverRoom[0]));
  return [...new Set(out.filter((t) => Math.abs(t) > EPS))];
}

/** The value of `[lo, hi]` (shrunk by {@link ROOM_NUDGE}) nearest 0. */
function nearest(lo: number, hi: number): number {
  const a = lo + ROOM_NUDGE;
  const b = hi - ROOM_NUDGE;
  if (a > b) return (lo + hi) / 2;
  return Math.min(Math.max(0, a), b);
}

/** A fan is split when the moved elements hold some of it but not all. */
function splits(fan: ReadonlySet<ElementKey>, inside: ReadonlySet<ElementKey>): boolean {
  let some = false;
  let all = true;
  for (const key of fan) {
    if (inside.has(key)) some = true;
    else all = false;
  }
  return some && !all;
}

function withinFrame(slot: Slot, shift: Point, axis: Axis): boolean {
  const start = (axis === "x" ? slot.rect.x : slot.rect.y) + shift[axis];
  const length = axis === "x" ? slot.rect.width : slot.rect.height;
  const lo = axis === "x" ? slot.frame.x : slot.frame.y;
  const hi = lo + (axis === "x" ? slot.frame.width : slot.frame.height);
  return start >= lo - EPS && start + length <= hi + EPS;
}

function itemName(item: ArrangeItemIR): string {
  if (item === null) return "blank";
  if (typeof item === "string") return item;
  return `${item.kind}:${itemName(item.items[0] ?? null)}`;
}

interface FigureInfo {
  /** The slot items holding `key`, innermost first. */
  path(key: ElementKey, slots: ReadonlyMap<ArrangeItemIR, Slot>): ArrangeItemIR[];
  /** Every node and group a shift of `item` moves. */
  contents(item: ArrangeItemIR): ReadonlySet<ElementKey>;
  /** The groups `key` is inside, innermost first. */
  ancestors(key: ElementKey): readonly ElementKey[];
  /** Elements of `figure.layout.align` constraints, by axis. */
  readonly aligned: Readonly<Record<Axis, readonly ElementKey[]>>;
}

function figureInfo(ir: FigureIR): FigureInfo {
  const parent = new Map<ElementKey, ElementKey | undefined>();
  const children = new Map<ElementKey, readonly ElementKey[]>();
  const attachedTo = new Map<ElementKey, ElementKey>();
  for (const node of ir.nodes) {
    parent.set(node.key, node.parent);
    if (node.attach !== undefined) attachedTo.set(node.key, node.attach.to);
  }
  for (const group of ir.groups) {
    parent.set(group.key, group.parent);
    children.set(group.key, group.children);
  }
  const cache = new Map<ArrangeItemIR, ReadonlySet<ElementKey>>();
  const contents = (item: ArrangeItemIR): ReadonlySet<ElementKey> => {
    const cached = cache.get(item);
    if (cached !== undefined) return cached;
    const out = new Set<ElementKey>();
    const add = (key: ElementKey) => {
      out.add(key);
      for (const child of children.get(key) ?? []) add(child);
    };
    const visit = (it: ArrangeItemIR) => {
      if (it === null) return;
      if (typeof it === "string") add(it);
      else for (const inner of it.items) visit(inner);
    };
    visit(item);
    // Attached nodes follow their targets, through chains.
    for (let grew = true; grew; ) {
      grew = false;
      for (const [node, target] of attachedTo) {
        if (out.has(target) && !out.has(node)) {
          out.add(node);
          grew = true;
        }
      }
    }
    cache.set(item, out);
    return out;
  };
  const ancestors = (key: ElementKey): ElementKey[] => {
    const out: ElementKey[] = [];
    for (let p = parent.get(key); p !== undefined; p = parent.get(p)) out.push(p);
    return out;
  };
  const path = (key: ElementKey, slots: ReadonlyMap<ArrangeItemIR, Slot>): ArrangeItemIR[] => {
    let start: ArrangeItemIR | undefined;
    for (let k: ElementKey | undefined = key; k !== undefined && start === undefined; ) {
      if (slots.has(k)) start = k;
      else k = attachedTo.get(k) ?? parent.get(k);
    }
    const out: ArrangeItemIR[] = [];
    for (let item = start; item !== undefined; item = slots.get(item)?.parent) out.push(item);
    return out;
  };
  const aligned: Record<Axis, ElementKey[]> = { x: [], y: [] };
  for (const constraint of ir.align ?? []) aligned[constraint.axis].push(...constraint.items);
  return { path, contents, ancestors, aligned };
}

/** Orthogonal routed edges only: `straight`, `curve` and zoom edges are drawn otherwise. */
function routed(ir: FigureIR, index: number): boolean {
  const edge = ir.edges[index];
  return (
    edge !== undefined &&
    edge.route === undefined &&
    edge.routing === undefined &&
    edge.from !== edge.to
  );
}

function edgeState(ir: FigureIR, layout: LayoutIR, slides: ReadonlySet<number>): EdgeState {
  // As resolved with no end moved along its side, then with the `slides` (as the router draws them).
  const fixed = resolveEnds(ir, withSlides(layout, new Set()));
  const drawn = slides.size === 0 ? fixed : resolveEnds(ir, withSlides(layout, slides));
  const rects = new Map<ElementKey, Rect>([
    ...layout.nodes.map((n) => [n.key, n.rect] as const),
    ...layout.groups.map((g) => [g.key, g.rect] as const),
  ]);
  const inLine = (pair: (typeof fixed)[number] | undefined) => {
    if (pair === undefined || "error" in pair) return undefined;
    const f = facing(pair.from, pair.to);
    if (f === undefined) return undefined;
    return { f, pair, line: Math.abs(f.aside) <= STRAIGHTEN_TOLERANCE + 1e-9 };
  };
  const aligned = new Set<number>();
  const straight = new Set<number>();
  const crooked = new Map<number, Crooked>();
  const bySide = new Map<string, { end: string; other: ElementKey; key: ElementKey }[]>();
  for (const [index, pair] of fixed.entries()) {
    const edge = ir.edges[index];
    if (pair === undefined || "error" in pair || edge === undefined || edge.from === edge.to)
      continue;
    // Every edge counts toward a fan (`route: straight` / `curve` and zoom too): moving a hub
    // changes all its branches, whatever they are drawn with.
    for (const [which, end, other, anchor] of [
      ["from", pair.from, pair.to, edge.fromAnchor],
      ["to", pair.to, pair.from, edge.toAnchor],
    ] as const) {
      // An end placed by an anchor is the author's: it is not part of a fan. A junction
      // (any direction) is a fan when two or more edges leave it, or enter it.
      if (anchor !== undefined || (!end.junction && end.side === undefined)) continue;
      const side = end.junction ? `${end.key} junction ${which}` : `${end.key} ${end.side}`;
      const list = bySide.get(side) ?? [];
      list.push({ end: `${index} ${which}`, other: other.key, key: end.key });
      bySide.set(side, list);
    }
    if (!routed(ir, index)) continue;
    if (inLine(drawn[index])?.line === true) straight.add(index);
    const here = inLine(pair);
    if (here === undefined) continue;
    if (here.line) {
      aligned.add(index);
      continue;
    }
    const axis: Axis = here.f.dir % 2 === 0 ? "y" : "x";
    const room = (end: End, anchor: unknown): Range | undefined => {
      if (end.junction || end.side === undefined || anchor !== undefined) return undefined;
      const rect = rects.get(end.key);
      if (rect === undefined) return undefined;
      const start = axis === "x" ? rect.x : rect.y;
      const length = axis === "x" ? rect.width : rect.height;
      const margin = Math.min(STRAIGHT_MARGIN, length / 2);
      return [start + margin, start + length - margin];
    };
    const fromRoom = room(pair.from, edge.fromAnchor);
    const toRoom = room(pair.to, edge.toAnchor);
    crooked.set(index, {
      axis,
      delta: pair.to.port[axis] - pair.from.port[axis],
      from: pair.from,
      to: pair.to,
      room: {
        ...(fromRoom !== undefined && { from: fromRoom }),
        ...(toRoom !== undefined && { to: toRoom }),
      },
    });
  }
  const fans: Set<ElementKey>[] = [];
  const fanEnds = new Set<string>();
  for (const list of bySide.values()) {
    if (list.length < 2) continue;
    const first = list[0] as { key: ElementKey };
    fans.push(new Set([first.key, ...list.map((e) => e.other)]));
    for (const e of list) {
      fanEnds.add(e.end);
    }
  }
  return { aligned, straight, crooked, fans, fanEnds };
}

/** Distance between two rectangles: positive apart (the larger axis gap), negative overlapping. */
function separation(a: Rect, b: Rect): number {
  return Math.max(
    b.x - (a.x + a.width),
    a.x - (b.x + b.width),
    b.y - (a.y + a.height),
    a.y - (b.y + b.height),
  );
}

function inside(inner: Rect, outer: Rect): boolean {
  return (
    inner.x >= outer.x - EPS &&
    inner.y >= outer.y - EPS &&
    inner.x + inner.width <= outer.x + outer.width + EPS &&
    inner.y + inner.height <= outer.y + outer.height + EPS
  );
}

/**
 * Whether `trial` moved exactly the elements `moved`, by `delta` on `axis`,
 * left the canvas and everything else in place, and brought no moved
 * element closer to another one or out of a group (see the module comment).
 */
function keepsTheRest(
  info: FigureInfo,
  before: StraightenTrial,
  trial: StraightenTrial,
  moved: ReadonlySet<ElementKey>,
  axis: Axis,
  delta: number,
): boolean {
  const a = before.layout;
  const b = trial.layout;
  if (a.canvas.width !== b.canvas.width || a.canvas.height !== b.canvas.height) return false;
  const rectsOf = (layout: LayoutIR) =>
    new Map<ElementKey, Rect>([
      ...layout.nodes.map((n) => [n.key, n.rect] as const),
      ...layout.groups.map((g) => [g.key, g.rect] as const),
    ]);
  const was = rectsOf(a);
  const now = rectsOf(b);
  for (const [key, rect] of was) {
    const after = now.get(key);
    if (after === undefined) return false;
    const d = moved.has(key) ? delta : 0;
    const dx = axis === "x" ? d : 0;
    const dy = axis === "y" ? d : 0;
    if (
      Math.abs(after.x - rect.x - dx) > EPS ||
      Math.abs(after.y - rect.y - dy) > EPS ||
      Math.abs(after.width - rect.width) > EPS ||
      Math.abs(after.height - rect.height) > EPS
    )
      return false;
  }
  for (const key of moved) {
    const pastA = before.footprints.get(key);
    const pastB = trial.footprints.get(key);
    if (pastA === undefined || pastB === undefined) continue;
    const ancestors = new Set(info.ancestors(key));
    for (const [other, otherRect] of trial.footprints) {
      if (moved.has(other)) continue;
      const otherBefore = before.footprints.get(other) ?? otherRect;
      if (ancestors.has(other)) {
        if (inside(pastA, otherBefore) && !inside(pastB, otherRect)) return false;
        continue;
      }
      const sepBefore = separation(pastA, otherBefore);
      const sepAfter = separation(pastB, otherRect);
      if (sepAfter < Math.min(sepBefore, CLEARANCE) - EPS) return false;
    }
  }
  return true;
}
