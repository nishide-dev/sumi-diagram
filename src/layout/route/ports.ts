/**
 * Edge ends for the orthogonal router (#90): which side of the source and
 * target an edge uses, the port on that side, and where the route meets the
 * shape's outline.
 */

import { imageLayerRects } from "../../assets/layers";
import type { ArrangeBoxIR, EdgeIR, FigureIR, NodeIR } from "../../compiler/ir";
import type { ElementKey } from "../../core/check-state";
import { type Anchor, type EdgeAnchor, STRAIGHT_ANCHOR } from "../../core/figure/layout";
import type { Side } from "../../core/figure/schema";
import type { Region } from "../../core/geometry";
import { getOutlineRenderer } from "../../core/outline";
import { outlineRegions } from "../../lint/geometry/outlines";
import { rectPolygon, shapeOutline } from "../../lint/geometry/shapes";
import { type LayoutIR, type Point, type Rect, roundUnits } from "../ir";

/** Direction indices: 0 = east (+x), 1 = south (+y), 2 = west (−x), 3 = north (−y). */
export const DIRS: readonly Point[] = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
];

/** The outward direction of each side. */
export const SIDE_DIR: Readonly<Record<Side, number>> = { east: 0, south: 1, west: 2, north: 3 };

/** Sides clockwise from north. */
const CLOCKWISE: readonly Side[] = ["north", "east", "south", "west"];

export const opposite = (dir: number): number => (dir + 2) % 4;

/** The right edge / bottom edge of a rounded rectangle, rounded the same way as the Layout IR. */
export const rightOf = (r: Rect): number => roundUnits(r.x + r.width);
export const bottomOf = (r: Rect): number => roundUnits(r.y + r.height);

/** The point at `anchor` on the bounding box `rect` (offset left → right, top → bottom). */
export function anchorPoint(rect: Rect, anchor: Anchor): Point {
  const along = (start: number, length: number) => roundUnits(start + length * anchor.offset);
  switch (anchor.side) {
    case "north":
      return { x: along(rect.x, rect.width), y: rect.y };
    case "south":
      return { x: along(rect.x, rect.width), y: bottomOf(rect) };
    case "west":
      return { x: rect.x, y: along(rect.y, rect.height) };
    case "east":
      return { x: rightOf(rect), y: along(rect.y, rect.height) };
  }
}

/** The shape a node draws, as a convex region (its bounding box for `text`). */
export function nodeRegion(node: NodeIR, rect: Rect): Region {
  if (node.render !== undefined) {
    const renderer = getOutlineRenderer(node.render.renderer);
    if (!renderer)
      throw new Error(`internal error: unknown outline renderer ${node.render.renderer}`);
    return outlineRegions(renderer.draw(rect, renderer.params.parse(node.render.params ?? {})))
      .outline;
  }
  return node.shape === "text" ? rectPolygon(rect) : shapeOutline(node.shape, rect);
}

/**
 * The first `t ∈ [0, 1]` where `a + t (b - a)` meets the closed `region`,
 * touching included (a ray along a polygon side, or tangent to an ellipse,
 * meets it at its first common point); `undefined` if it never does.
 */
export function boundaryEntry(a: Point, b: Point, region: Region): number | undefined {
  const EPS = 1e-9;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (region.kind === "ellipse") {
    const px = (a.x - region.cx) / region.rx;
    const py = (a.y - region.cy) / region.ry;
    const qx = dx / region.rx;
    const qy = dy / region.ry;
    const qa = qx * qx + qy * qy;
    const qb = 2 * (px * qx + py * qy);
    const qc = px * px + py * py - 1;
    if (qc <= EPS) return 0;
    if (qa < EPS) return undefined;
    // A tangent ray has a (numerically) zero discriminant: clamp it.
    const disc = qb * qb - 4 * qa * qc;
    if (disc < -1e-9) return undefined;
    const t = (-qb - Math.sqrt(Math.max(0, disc))) / (2 * qa);
    return t >= -EPS && t <= 1 + EPS ? Math.min(1, Math.max(0, t)) : undefined;
  }
  const points = region.points;
  let area = 0;
  for (const [i, p] of points.entries()) {
    const q = points[(i + 1) % points.length] as Point;
    area += p.x * q.y - q.x * p.y;
  }
  const sign = Math.sign(area);
  if (points.length < 3 || sign === 0) return undefined;
  let t0 = 0;
  let t1 = 1;
  for (const [i, p] of points.entries()) {
    const q = points[(i + 1) % points.length] as Point;
    const length = Math.hypot(q.x - p.x, q.y - p.y);
    if (length < EPS) continue;
    const nx = (sign * (p.y - q.y)) / length;
    const ny = (sign * (q.x - p.x)) / length;
    // Closed: inside or on the side means n · (x - p) ≥ 0.
    const start = nx * (a.x - p.x) + ny * (a.y - p.y);
    const rate = nx * dx + ny * dy;
    if (Math.abs(rate) < EPS) {
      if (start < -EPS) return undefined;
      continue;
    }
    const t = -start / rate;
    if (rate > 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t1 < t0 - EPS) return undefined;
  }
  return t0;
}

/** A junction: a node drawn as a point (#92), where edges meet in any direction. */
export const isJunction = (node: NodeIR | undefined): boolean => node?.mark?.type === "point";

/** One end of an edge, resolved. */
export interface End {
  readonly key: ElementKey;
  readonly junction: boolean;
  /** The side used; omitted at a junction. */
  readonly side?: Side;
  /**
   * The direction pointing away from the port into the route: the route
   * leaves a source port, and enters a target port, along it. Usually the
   * side's outward normal; inward for a group whose other end is inside it.
   * `-1` at a junction (any direction).
   */
  readonly dir: number;
  /** On the bounding box (a junction: its center). The router's terminal. */
  readonly port: Point;
  /** Where the drawn route ends: the port moved inward onto the shape's outline. */
  readonly outline: Point;
}

interface Element {
  readonly key: ElementKey;
  readonly rect: Rect;
  readonly node?: NodeIR;
  readonly parent?: ElementKey;
}

const center = (r: Rect): Point => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

/**
 * The side and position of a non-junction end, while it is being resolved.
 * `anchored`: the position was written in the YAML (an anchor), so it is
 * never moved, except onto a facing end's line within
 * {@link STRAIGHTEN_TOLERANCE} (#169). `straight`: an anchored end written
 * `straight` (#179) that resolved to a side; it is in line with the other
 * end, and follows it when the #113 split moves that end.
 */
interface Choice {
  side: Side;
  offset?: number;
  inward: boolean;
  anchored: boolean;
  straight?: boolean;
}

/**
 * How far from a side's corners a `straight` end (#179) must stay, in units
 * (3pt, the router's clearance): the arrowhead and the line keep off the
 * corner and the neighbouring side. On a side shorter than twice this, only
 * its middle qualifies.
 */
export const STRAIGHT_MARGIN = 6;

/** Where a `straight` end goes (#179): its side and position, or why it has none. */
export type StraightPlacement =
  | { readonly side: Side; readonly offset: number }
  | {
      /**
       * `diagonal`: the two elements are apart along both axes; `overlap`:
       * along neither (they overlap, one holds the other, or it is a
       * self-loop); `beyond`: the other's centre is not in line with the
       * facing side (at least {@link STRAIGHT_MARGIN} inside its corners).
       */
      readonly off: "diagonal" | "overlap" | "beyond";
      /** The facing side, for `beyond`. */
      readonly side?: Side;
    };

/**
 * The offset on `side` of `rect` of the coordinate `at` along it (x on
 * north / south, y on east / west), if it is at least
 * {@link STRAIGHT_MARGIN} inside the side's corners (#179).
 */
export function straightOffset(rect: Rect, side: Side, at: number): number | undefined {
  const vertical = side === "north" || side === "south";
  const start = vertical ? rect.x : rect.y;
  const length = vertical ? rect.width : rect.height;
  if (!(length > 0)) return undefined;
  const margin = Math.min(STRAIGHT_MARGIN, length / 2);
  const EPS = 1e-9;
  if (at < start + margin - EPS || at > start + length - margin + EPS) return undefined;
  return (at - start) / length;
}

/**
 * How far the coordinate `at` along `side` of `rect` lies outside the
 * positions a `straight` end may take ({@link straightOffset}): 0 inside
 * them, infinite on a side of no length.
 */
export function straightMarginDistance(rect: Rect, side: Side, at: number): number {
  const vertical = side === "north" || side === "south";
  const start = vertical ? rect.x : rect.y;
  const length = vertical ? rect.width : rect.height;
  if (!(length > 0)) return Number.POSITIVE_INFINITY;
  const margin = Math.min(STRAIGHT_MARGIN, length / 2);
  return Math.max(0, start + margin - at, at - (start + length - margin));
}

/**
 * A `straight` end on `self` toward `other` (#179, design doc §6.47): the
 * side of `self` that faces `other` along the one axis the two are apart
 * on, at the projection of `other`'s centre (exact, not rounded) onto it.
 * The router then puts the end in line with the other end's port
 * (`resolveEndsWith`), which for an end at the middle of its side is the
 * same point.
 */
export function straightPlacement(self: Rect, other: Rect): StraightPlacement {
  const apartY = bottomOf(self) <= other.y || bottomOf(other) <= self.y;
  const apartX = rightOf(self) <= other.x || rightOf(other) <= self.x;
  if (apartX && apartY) return { off: "diagonal" };
  if (!apartX && !apartY) return { off: "overlap" };
  const c = center(other);
  const side: Side = apartY
    ? other.y < self.y
      ? "north"
      : "south"
    : other.x < self.x
      ? "west"
      : "east";
  const offset = straightOffset(self, side, apartY ? c.x : c.y);
  return offset === undefined ? { off: "beyond", side } : { side, offset };
}

/** The side opposite `side`. */
const OPPOSITE_SIDE: Readonly<Record<Side, Side>> = {
  north: "south",
  south: "north",
  east: "west",
  west: "east",
};

/** The edges' ends as the side-sharing left them: `undefined` at a junction. */
interface ChoicePair {
  readonly from: ElementKey;
  readonly to: ElementKey;
  readonly fromChoice: Choice | undefined;
  readonly toChoice: Choice | undefined;
}

/** Rounds of `separateDirections`: a split can only meet another port a few times. */
const SEPARATION_ROUNDS = 8;

/**
 * Splits every port (element, side, point) that edges both leave and enter
 * (#113, design doc §6.22). The router joins the edges at one port into a
 * net per direction only (a net of edges leaving a port is a fan-out, of
 * edges entering it a fan-in); an edge entering a port and one leaving it
 * are different nets and must not share the port's stub, or `a → x` and
 * `x → b` would read as `a → b`.
 *
 * One direction keeps the point and the other moves along the side, half way
 * toward the side's end on the side of its other ends (`o / 2` or
 * `(o + 1) / 2`; at a corner the other way). Only ends without an anchor
 * move; if both directions have one there, the port is left and its edges
 * are returned. When both may move, the one with fewer straight lines to
 * the other end moves (then the one with fewer edges, then the edges
 * leaving). A moved end whose edge was a straight line between facing sides
 * takes its other end along (if that end has no anchor, is not shared and
 * stays on its side), so the line stays straight.
 *
 * Parallel edges (between the same two elements in the same direction) stay
 * apart (#143): a move that would put an end on a parallel edge's end there
 * takes the other half instead, else the first free position of the side
 * (1/4, 3/4, 1/8, …) that is not one; the partner of a straight line does
 * not follow onto one (the line bends). The multi-edge sharing put them
 * apart, and joining them would draw two edges as one line and one net.
 * Ends of different elements' edges may still share a port in one direction
 * (a fan-out or fan-in, as before).
 *
 * If the rounds run out (moves keep meeting other ports), a direction that
 * may move takes the first unused position of 1/4, 3/4, 1/8, 3/8, … instead.
 *
 * Mutates the choices' offsets; returns the indices of the edges that keep a
 * shared port (the later direction in document order) with the reason, for
 * `layout/no-route`: both directions anchored there, or (with over a
 * thousand ports on one side) no free position left, for a shared port or
 * for parallel edges that would otherwise be joined.
 */
function separateDirections(
  pairs: readonly ChoicePair[],
  rectOf: (key: ElementKey) => Rect,
): Map<number, string> {
  interface Slot {
    readonly edge: number;
    readonly key: ElementKey;
    readonly choice: Choice;
    /** The other end of the edge. */
    readonly partner: ElementKey;
    readonly partnerChoice: Choice | undefined;
  }
  interface Port {
    readonly point: Point;
    readonly side: Side;
    readonly leaving: Slot[];
    readonly entering: Slot[];
  }
  const portOf = (key: ElementKey, choice: Choice): Point =>
    anchorPoint(rectOf(key), { side: choice.side, offset: choice.offset ?? 0.5 });
  const pointOf = (key: ElementKey, choice: Choice | undefined): Point => {
    if (choice !== undefined) return portOf(key, choice);
    const c = center(rectOf(key));
    return { x: roundUnits(c.x), y: roundUnits(c.y) };
  };
  const horizontalSide = (side: Side) => side === "north" || side === "south";
  /** The coordinate along a side (x on north / south, y on east / west). */
  const along = (side: Side, p: Point) => (horizontalSide(side) ? p.x : p.y);
  const portId = (key: ElementKey, choice: Choice) => {
    const p = portOf(key, choice);
    return `${key} ${choice.side} ${choice.inward} ${p.x} ${p.y}`;
  };
  const collect = (): Map<string, Port> => {
    const ports = new Map<string, Port>();
    for (const [edge, pair] of pairs.entries()) {
      for (const leaving of [true, false]) {
        const choice = leaving ? pair.fromChoice : pair.toChoice;
        if (choice === undefined) continue;
        const key = leaving ? pair.from : pair.to;
        const id = portId(key, choice);
        let port = ports.get(id);
        if (port === undefined) {
          port = { point: portOf(key, choice), side: choice.side, leaving: [], entering: [] };
          ports.set(id, port);
        }
        (leaving ? port.leaving : port.entering).push({
          edge,
          key,
          choice,
          partner: leaving ? pair.to : pair.from,
          partnerChoice: leaving ? pair.toChoice : pair.fromChoice,
        });
      }
    }
    return ports;
  };
  const choiceOf = (edge: number, leaving: boolean) => {
    const pair = pairs[edge] as ChoicePair;
    return leaving ? pair.fromChoice : pair.toChoice;
  };
  const pointKey = (p: Point) => `${p.x} ${p.y}`;
  /** The edges between the same two elements in the same direction, by edge. */
  const parallels = new Map<number, number[]>();
  {
    const byPair = new Map<string, number[]>();
    for (const [edge, { from, to }] of pairs.entries()) {
      const list = byPair.get(`${from} ${to}`) ?? [];
      list.push(edge);
      byPair.set(`${from} ${to}`, list);
    }
    for (const list of byPair.values()) {
      if (list.length < 2) continue;
      for (const edge of list) parallels.set(edge, list);
    }
  }
  /**
   * `true` if an end of a parallel edge (another edge between the same two
   * elements in the same direction), other than `moving`, is on the same
   * side at `point`: the end of `edge` there would join it.
   */
  const parallelEndAt = (
    edge: number,
    leaving: boolean,
    choice: Choice,
    point: Point,
    moving: ReadonlySet<Choice>,
  ): boolean => {
    const { from, to } = pairs[edge] as ChoicePair;
    const key = leaving ? from : to;
    for (const other of parallels.get(edge) ?? []) {
      if (other === edge) continue;
      const end = choiceOf(other, leaving);
      if (end === undefined || moving.has(end)) continue;
      if (end.side !== choice.side || end.inward !== choice.inward) continue;
      if (pointKey(portOf(key, end)) === pointKey(point)) return true;
    }
    return false;
  };
  /** The points of a side used by any end (either direction, outside or inside). */
  const usedOn = (key: ElementKey, side: Side): Set<string> => {
    const used = new Set<string>();
    for (const pair of pairs) {
      for (const [k, c] of [
        [pair.from, pair.fromChoice],
        [pair.to, pair.toChoice],
      ] as const) {
        if (k === key && c !== undefined && c.side === side) used.add(pointKey(portOf(k, c)));
      }
    }
    return used;
  };
  /** `true` if the `leaving` (else entering) ends of edges `i` and `j` are on one point. */
  const together = (i: number, j: number, leaving: boolean): boolean => {
    const p = choiceOf(i, leaving);
    const q = choiceOf(j, leaving);
    if (p === undefined || q === undefined) return false;
    const pair = pairs[i] as ChoicePair;
    const key = leaving ? pair.from : pair.to;
    return p.inward === q.inward && pointKey(portOf(key, p)) === pointKey(portOf(key, q));
  };
  // The ends of parallel edges that are apart before the split: it must not
  // put them together (#143).
  const apartBefore: [number, number, boolean][] = [];
  for (const [i, list] of parallels) {
    for (const j of list) {
      if (j <= i) continue;
      for (const leaving of [true, false]) {
        if (!together(i, j, leaving)) apartBefore.push([i, j, leaving]);
      }
    }
  }

  for (let round = 0; round < SEPARATION_ROUNDS; round++) {
    const ports = collect();
    /** Choices changed in this round: their ports are stale until the next one. */
    const touched = new Set<Choice>();
    for (const port of ports.values()) {
      const { leaving, entering, side, point } = port;
      if (leaving.length === 0 || entering.length === 0) continue;
      // An edge with both ends here is a `layout/no-route` of its own.
      if (leaving.some((l) => entering.some((e) => e.edge === l.edge))) continue;
      const all = [...leaving, ...entering];
      if (all.some((s) => touched.has(s.choice))) continue;
      const movable = (slots: Slot[]) => slots.every((s) => !s.choice.anchored);
      const straight = (slots: Slot[]) =>
        slots.filter((s) => along(side, pointOf(s.partner, s.partnerChoice)) === along(side, point))
          .length;
      let move: Slot[] | undefined;
      if (movable(leaving) && movable(entering)) {
        const order =
          straight(leaving) - straight(entering) || leaving.length - entering.length || -1;
        move = order < 0 ? leaving : entering;
      } else if (movable(leaving)) {
        move = leaving;
      } else if (movable(entering)) {
        move = entering;
      }
      if (move === undefined) continue;
      const stay = move === leaving ? entering : leaving;
      const moving = new Set(move.map((s) => s.choice));
      const parallelAt = (slot: Slot, offset: number) =>
        parallelEndAt(
          slot.edge,
          move === leaving,
          slot.choice,
          portOf(slot.key, { ...slot.choice, offset }),
          moving,
        );
      // Toward the moving edges' other ends, else away from the staying ones'.
      const mean = (slots: Slot[]) =>
        slots.reduce((sum, s) => sum + along(side, pointOf(s.partner, s.partnerChoice)), 0) /
          slots.length -
        along(side, point);
      const sign = Math.sign(mean(move)) || -Math.sign(mean(stay)) || 1;
      const offset = (move[0] as Slot).choice.offset ?? 0.5;
      let next = sign > 0 ? (offset + 1) / 2 : offset / 2;
      if (next === offset) next = sign > 0 ? offset / 2 : (offset + 1) / 2;
      // #143: never onto the point of a parallel edge's end (same two
      // elements, same direction), or the two would become one line and one
      // net. Try the other half, then the free positions of the side.
      if (move.some((slot) => parallelAt(slot, next))) {
        const first = move[0] as Slot;
        const other = next < offset ? (offset + 1) / 2 : offset / 2;
        const used = usedOn(first.key, side);
        const candidates = [other];
        for (let d = 4; d <= 1024; d *= 2) {
          for (let k = 1; k < d; k += 2) {
            const point = portOf(first.key, { ...first.choice, offset: k / d });
            if (!used.has(pointKey(point))) candidates.push(k / d);
          }
        }
        const free = candidates.find(
          (c) => c !== offset && c > 0 && c < 1 && !move.some((slot) => parallelAt(slot, c)),
        );
        // None left (over a thousand ends on one side): the collapse is
        // reported below, never drawn silently.
        if (free !== undefined) next = free;
      }
      for (const slot of move) {
        const before = pointOf(slot.partner, slot.partnerChoice);
        slot.choice.offset = next;
        touched.add(slot.choice);
        // Keep a straight line between facing sides straight.
        const partner = slot.partnerChoice;
        if (
          partner === undefined ||
          (partner.anchored && !partner.straight) ||
          touched.has(partner) ||
          partner.inward ||
          slot.choice.inward ||
          SIDE_DIR[partner.side] !== opposite(SIDE_DIR[side]) ||
          along(side, before) !== along(side, point)
        ) {
          continue;
        }
        const id = portId(slot.partner, partner);
        const users = ports.get(id);
        if (users === undefined || users.leaving.length + users.entering.length !== 1) continue;
        const rect = rectOf(slot.partner);
        const target = along(side, portOf(slot.key, slot.choice));
        const start = horizontalSide(side) ? rect.x : rect.y;
        const length = horizontalSide(side) ? rect.width : rect.height;
        // A straight end (#179) follows only as far as its corner margin.
        const t = partner.straight
          ? straightOffset(rect, partner.side, target)
          : (target - start) / length;
        if (t === undefined || !(t > 0 && t < 1)) continue;
        // #143: the line bends rather than join a parallel edge's end.
        const at = portOf(slot.partner, { ...partner, offset: t });
        if (parallelEndAt(slot.edge, move !== leaving, partner, at, new Set([partner]))) continue;
        partner.offset = t;
        touched.add(partner);
      }
    }
    if (touched.size === 0) break;
  }

  // Rounds used up (moves kept meeting other ports): a movable direction
  // takes the first free position of 1/4, 3/4, 1/8, 3/8, … (1/1024 at most;
  // a side with every one of those taken is reported as having no room).
  for (const port of collect().values()) {
    const { leaving, entering } = port;
    if (leaving.length === 0 || entering.length === 0) continue;
    if (leaving.some((l) => entering.some((e) => e.edge === l.edge))) continue;
    const move = [entering, leaving].find((slots) => slots.every((s) => !s.choice.anchored));
    if (move === undefined) continue;
    const first = move[0] as Slot;
    // Any point of the side already used (in either direction, from outside
    // or inside a group).
    const used = usedOn(first.key, port.side);
    let free: number | undefined;
    for (let d = 4; d <= 1024 && free === undefined; d *= 2) {
      for (let k = 1; k < d && free === undefined; k += 2) {
        const point = portOf(first.key, { ...first.choice, offset: k / d });
        if (!used.has(pointKey(point))) free = k / d;
      }
    }
    if (free === undefined) continue;
    for (const slot of move) slot.choice.offset = free;
  }

  const kept = new Map<number, string>();
  for (const { leaving, entering } of collect().values()) {
    if (leaving.length === 0 || entering.length === 0) continue;
    if (leaving.some((l) => entering.some((e) => e.edge === l.edge))) continue;
    const first = (slots: Slot[]) => Math.min(...slots.map((s) => s.edge));
    const anchored = [leaving, entering].every((slots) => slots.some((s) => s.choice.anchored));
    const reason = anchored
      ? "an edge leaving and an edge entering the same element are anchored at the same point of it, so they would share a line"
      : "an edge leaving and an edge entering the same element would share a point of it, and no free position is left on that side";
    for (const slot of first(leaving) > first(entering) ? leaving : entering) {
      kept.set(slot.edge, reason);
    }
  }
  // Parallel edges the split put on one point (only when no free position
  // was left): the later one is reported rather than drawn as one line.
  for (const [i, j, leaving] of apartBefore) {
    if (together(i, j, leaving) && !kept.has(i) && !kept.has(j)) {
      kept.set(
        j,
        "the edge would share a point with a parallel edge between the same elements, and no free position is left on that side",
      );
    }
  }
  return kept;
}

/**
 * Default side from the arrange tree (#134, design doc §6.33): the box that
 * separates two elements (their nearest common arrange box, where their
 * paths from the root first take different items) decides the axis, toward
 * the other element: a stack north / south, a row east / west. A node placed
 * by `attach` takes the place of its target. Returns `undefined` when no box
 * separates the two (an element and a group around it, a node and the
 * element it is attached to, a figure without arrange trees): the caller
 * falls back to {@link facingSide}.
 *
 * `facingSide` compares the centers instead, so a box below and far to the
 * side of the other leaves from its west or east side although the stack
 * between them runs vertically.
 */
function arrangeSides(
  ir: FigureIR,
  rectOf: (key: ElementKey) => Rect,
): (self: ElementKey, other: ElementKey) => Side | undefined {
  interface Step {
    readonly box: ArrangeBoxIR;
    readonly index: number;
  }
  const paths = new Map<ElementKey, Step[]>();
  const groups = new Map(ir.groups.map((g) => [g.key, g]));
  const walk = (box: ArrangeBoxIR, prefix: readonly Step[]) => {
    for (const [index, item] of box.items.entries()) {
      if (item === null) continue;
      const path = [...prefix, { box, index }];
      if (typeof item === "string") {
        paths.set(item, path);
        const arrange = groups.get(item)?.arrange;
        if (arrange !== undefined) walk(arrange, path);
      } else {
        walk(item, path);
      }
    }
  };
  if (ir.arrange !== undefined) walk(ir.arrange, []);
  const nodes = new Map(ir.nodes.map((n) => [n.key, n]));
  const pathOf = (key: ElementKey): Step[] | undefined => {
    // `attach` chains are acyclic (the layout stage checks them); the bound is a guard.
    let current = key;
    for (let depth = 0; depth <= nodes.size; depth++) {
      const own = paths.get(current);
      if (own !== undefined) return own;
      const to = nodes.get(current)?.attach?.to;
      if (to === undefined) return undefined;
      current = to;
    }
    return undefined;
  };
  return (self, other) => {
    const a = pathOf(self);
    const b = pathOf(other);
    if (a === undefined || b === undefined) return undefined;
    for (let k = 0; k < Math.min(a.length, b.length); k++) {
      const sa = a[k] as Step;
      const sb = b[k] as Step;
      if (sa.box !== sb.box) return undefined;
      if (sa.index === sb.index) continue;
      if (sa.box.kind === "grid") return undefined;
      const ra = rectOf(self);
      const rb = rectOf(other);
      const ca = center(ra);
      const cb = center(rb);
      // Only if the two do not overlap along the box's axis: an attached
      // node can hang beside the next item (stack [a, b], x attached below
      // something east of a, level with b), and then the box says nothing
      // about where the other end is.
      const apartY = bottomOf(ra) <= rb.y || bottomOf(rb) <= ra.y;
      const apartX = rightOf(ra) <= rb.x || rightOf(rb) <= ra.x;
      if (sa.box.kind === "stack") {
        if (!apartY) return undefined;
        return cb.y < ca.y ? "north" : "south";
      }
      if (!apartX) return undefined;
      return cb.x < ca.x ? "west" : "east";
    }
    return undefined;
  };
}

/**
 * `true` if the edge's target end has a position of its own: an anchor, or
 * `straight` (#179) where it resolves to a side. Such an end never spreads.
 */
function holdsPosition(edge: EdgeIR, rectOf: (key: ElementKey) => Rect): boolean {
  if (edge.toAnchor === undefined) return false;
  if (edge.toAnchor !== STRAIGHT_ANCHOR) return true;
  return "offset" in straightPlacement(rectOf(edge.to), rectOf(edge.from));
}

/** The key of an edge's end in the positions {@link spreadFanIn} returns. */
const endKey = (edge: number, leaving: boolean) => `${edge} ${leaving ? "from" : "to"}`;

/**
 * Fan-in spreading (`figure.layout.fanIn: spread`, #134, design doc §6.33):
 * the target ends without an anchor that `ends` (a first resolution) left
 * two or more at one port (element, side, point, direction) are spread along
 * the side, so the edges enter side by side instead of merging into one line.
 *
 * Positions are allocated per side (element, side, direction), knowing every
 * other end on it: the side gets `N` = (spread ends) + (distinct other
 * positions) evenly spaced slots k/(N+1); the other ends (anchored ends, the
 * multi-edge positions, ends leaving the side, single ends) keep their
 * positions and claim the slots nearest to them in order (least total
 * distance, order kept); the spread ends take the free slots in the order of
 * their other ends' ports along the side (then document order), which keeps
 * them from crossing each other. If a free slot would still fall on another
 * end's point, the side is left merged (never two nets on one point).
 * Junction ends and anchored ends never move.
 *
 * Returns the side and offset of every end on a side that spreads, keyed
 * {@link endKey}: the spread ends at their slots, and the other ends pinned
 * where the first resolution put them. The pins matter: without them the
 * second resolution would share the multi-edges whose other members became
 * spread ends among the fewer ones left, moving them onto the slots given
 * to the spread ends.
 */
function spreadFanIn(
  edges: readonly EdgeIR[],
  ends: readonly ({ from: End; to: End } | { error: string })[],
  rectOf: (key: ElementKey) => Rect,
): Map<string, { side: Side; offset: number }> {
  const horizontal = (side: Side) => side === "north" || side === "south";
  const along = (side: Side, p: Point) => (horizontal(side) ? p.x : p.y);
  const sideId = (end: End) => `${end.key} ${end.side} ${end.dir}`;
  const pointId = (end: End) => `${sideId(end)} ${end.port.x} ${end.port.y}`;

  // Target ends that may spread, by port; every end, by side.
  const ports = new Map<string, number[]>();
  const sides = new Map<string, { end: End; edge: number; leaving: boolean }[]>();
  for (const [index, edge] of edges.entries()) {
    const pair = ends[index];
    if (pair === undefined || "error" in pair) continue;
    for (const leaving of [true, false]) {
      const end = leaving ? pair.from : pair.to;
      if (end.junction || end.side === undefined) continue;
      const list = sides.get(sideId(end)) ?? [];
      list.push({ end, edge: index, leaving });
      sides.set(sideId(end), list);
      if (!leaving && !holdsPosition(edge, rectOf)) {
        const users = ports.get(pointId(end)) ?? [];
        users.push(index);
        ports.set(pointId(end), users);
      }
    }
  }
  const spreading = new Set<number>();
  for (const users of ports.values())
    if (users.length >= 2) for (const i of users) spreading.add(i);

  const spread = new Map<string, { side: Side; offset: number }>();
  for (const uses of sides.values()) {
    const first = uses[0];
    if (first === undefined) continue;
    const side = first.end.side as Side;
    const rect = rectOf(first.end.key);
    const start = horizontal(side) ? rect.x : rect.y;
    const length = horizontal(side) ? rect.width : rect.height;
    const movers = uses
      .filter((u) => !u.leaving && spreading.has(u.edge))
      .map((u) => {
        const pair = ends[u.edge] as { from: End; to: End };
        return { edge: u.edge, along: along(side, pair.from.port) };
      })
      .sort((a, b) => a.along - b.along || a.edge - b.edge);
    if (movers.length === 0 || length <= 0) continue;
    const kept = new Map<string, number>();
    for (const u of uses) {
      if (!u.leaving && spreading.has(u.edge)) continue;
      kept.set(`${u.end.port.x} ${u.end.port.y}`, (along(side, u.end.port) - start) / length);
    }
    const fixed = [...kept.values()].sort((a, b) => a - b);
    const n = movers.length + fixed.length;
    const slots = Array.from({ length: n }, (_, k) => (k + 1) / (n + 1));
    // Order-kept assignment of the fixed positions to slots, least total distance.
    const m = fixed.length;
    const cost: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(Infinity));
    for (let j = 0; j <= n; j++) (cost[0] as number[])[j] = 0;
    for (let i = 1; i <= m; i++) {
      for (let j = i; j <= n; j++) {
        const skip = (cost[i] as number[])[j - 1] as number;
        const take =
          ((cost[i - 1] as number[])[j - 1] as number) +
          Math.abs((fixed[i - 1] as number) - (slots[j - 1] as number));
        (cost[i] as number[])[j] = Math.min(skip, take);
      }
    }
    const taken = new Set<number>();
    for (let i = m, j = n; i > 0; j--) {
      const take =
        ((cost[i - 1] as number[])[j - 1] as number) +
        Math.abs((fixed[i - 1] as number) - (slots[j - 1] as number));
      if ((cost[i] as number[])[j] === take) {
        taken.add(j - 1);
        i--;
      }
    }
    const free = slots.filter((_, k) => !taken.has(k));
    const pointOf = (offset: number) =>
      anchorPoint(rect, { side, offset })[horizontal(side) ? "x" : "y"];
    const occupied = new Set(fixed.map((offset) => pointOf(offset)));
    if (free.some((offset) => occupied.has(pointOf(offset)))) continue;
    for (const [k, mover] of movers.entries()) {
      spread.set(endKey(mover.edge, false), { side, offset: free[k] as number });
    }
    for (const u of uses) {
      if (!u.leaving && spreading.has(u.edge)) continue;
      const offset = (along(side, u.end.port) - start) / length;
      spread.set(endKey(u.edge, u.leaving), { side, offset });
    }
  }
  return spread;
}

/** Default side: toward the other end, along the axis with the larger distance (vertical on ties). */
function facingSide(from: Rect, to: Rect): Side {
  const a = center(from);
  const b = center(to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dy) >= Math.abs(dx)) return dy < 0 ? "north" : "south";
  return dx < 0 ? "west" : "east";
}

/** The side of `group` nearest to the center of `inner` (an element inside it). */
function nearestSide(group: Rect, inner: Rect): Side {
  const c = center(inner);
  const distances: [Side, number][] = [
    ["north", c.y - group.y],
    ["east", group.x + group.width - c.x],
    ["south", group.y + group.height - c.y],
    ["west", c.x - group.x],
  ];
  let best = distances[0] as [Side, number];
  for (const entry of distances) if (entry[1] < best[1]) best = entry;
  return best[0];
}

/**
 * Resolves both ends of every edge (in document order), or a reason the
 * edge cannot be routed. Ends without an anchor take the default side (from
 * the arrange tree, else toward the other end's center); the
 * edges between the same two elements that use the same default side of an
 * element share it out evenly (offsets 1/(n+1) … n/(n+1)), so multi-edges
 * and two-way pairs are drawn as parallel lines rather than on top of each
 * other. Then a port used both by edges leaving it and by edges entering it
 * is split (`separateDirections`, #113): the router joins edges into a net
 * only per direction, and two nets cannot share a port. Last, facing ends
 * out of line by at most {@link STRAIGHTEN_TOLERANCE} are put in line
 * (`straighten`, #169).
 */
export function resolveEnds(
  ir: FigureIR,
  layout: LayoutIR,
): ({ from: End; to: End } | { error: string })[] {
  const ends = resolveEndsWith(ir, layout, new Map());
  if (ir.meta.fanIn !== "spread") return ends;
  // Fan-in spreading: resolve again with the target ends that met at one
  // port placed side by side (the rest of the resolution, including the
  // #113 split, runs as before around them).
  const rects = new Map<ElementKey, Rect>([
    ...layout.nodes.map((n) => [n.key, n.rect] as const),
    ...layout.groups.map((g) => [g.key, g.rect] as const),
  ]);
  const spread = spreadFanIn(ir.edges, ends, (key) => rects.get(key) as Rect);
  if (spread.size === 0) return ends;
  const spreadEnds = resolveEndsWith(ir, layout, spread);
  // Guard: the spread may only separate ends. If the second resolution
  // (with the #113 split around the new positions) put ends together that
  // merge mode kept apart, or failed an edge merge mode routed, the whole
  // figure keeps merge mode's ends.
  return addsCoincidence(ends, spreadEnds) ? ends : spreadEnds;
}

/**
 * `true` if `spread` has two ends at one point of an element that `merged`
 * had at different points, or an error on an edge `merged` resolved
 * (junction ends, which meet by design, are left out).
 */
function addsCoincidence(
  merged: readonly ({ from: End; to: End } | { error: string })[],
  spread: readonly ({ from: End; to: End } | { error: string })[],
): boolean {
  /** End → the point it is at, by `edge from|to`. */
  const points = (ends: typeof merged) => {
    const byEnd = new Map<string, string>();
    const byPoint = new Map<string, string[]>();
    for (const [index, pair] of ends.entries()) {
      if (pair === undefined || "error" in pair) continue;
      for (const leaving of [true, false]) {
        const end = leaving ? pair.from : pair.to;
        if (end.junction) continue;
        const point = `${end.key} ${end.port.x} ${end.port.y}`;
        byEnd.set(endKey(index, leaving), point);
        const list = byPoint.get(point) ?? [];
        list.push(endKey(index, leaving));
        byPoint.set(point, list);
      }
    }
    return { byEnd, byPoint };
  };
  for (const [index, pair] of spread.entries()) {
    const before = merged[index];
    if (pair !== undefined && "error" in pair && before !== undefined && !("error" in before)) {
      return true;
    }
  }
  const before = points(merged).byEnd;
  for (const members of points(spread).byPoint.values()) {
    if (members.length < 2) continue;
    const first = before.get(members[0] as string);
    if (first === undefined || members.some((m) => before.get(m) !== first)) return true;
  }
  return false;
}

/**
 * The largest sideways offset between two facing ends that is straightened
 * (#169, design doc §6.40), in units: 1pt, the default edge stroke. A jog
 * no wider than the line itself does not read as a jog, only as a kink.
 * Ends meant to be aligned miss by a few thousandths of a unit (positions
 * are rounded to 1/1000 unit, and a stretched box's center and a centered
 * node's center round differently), and anchors copied from a render to 4
 * decimals or written as round fractions miss by up to about a unit.
 */
export const STRAIGHTEN_TOLERANCE = 2;

/**
 * How two ends of an edge face each other: `dir`, the direction from the
 * source toward the target; `ahead`, the distance along it; `aside`, the
 * offset across it (signed). `undefined` unless the target is ahead of
 * the source and either both are ports on opposite sides or one is a
 * junction the port points at.
 */
export function facing(
  from: End,
  to: End,
): { dir: number; ahead: number; aside: number } | undefined {
  const dir = from.dir >= 0 ? from.dir : to.dir >= 0 ? opposite(to.dir) : -1;
  if (dir < 0 || (from.dir >= 0 && to.dir >= 0 && to.dir !== opposite(from.dir))) return undefined;
  const D = DIRS[dir] as Point;
  const dx = to.port.x - from.port.x;
  const dy = to.port.y - from.port.y;
  const ahead = dx * D.x + dy * D.y;
  if (ahead <= 0) return undefined;
  return { dir, ahead, aside: dx * D.y - dy * D.x };
}

/** Facing ends out of line by more than 0 and at most {@link STRAIGHTEN_TOLERANCE}. */
export const straightenable = (f: { aside: number }): boolean =>
  f.aside !== 0 && Math.abs(f.aside) <= STRAIGHTEN_TOLERANCE + 1e-9;

/**
 * Straightens edges whose ends face each other but are out of line by at
 * most {@link STRAIGHTEN_TOLERANCE} (#169, design doc §6.40): one end moves
 * along its side onto the other's line, so the route is a straight line.
 * Without this, a sub-unit offset leaves the router a jog (two bends and a
 * sliver of a segment), and where the gap is shorter than the stubs at both
 * ends (the clearance and the arrowhead) not even that: the route detours
 * around an end.
 *
 * Facing: a port end whose direction points at the other end's port, which
 * either leaves the other way (two ports on facing sides) or is a junction
 * (any direction). The end that moves: one whose point no other end of its
 * element uses (a shared port keeps its net and its other edges' lines),
 * whose new point no other end uses (#113 / #143: ends stay apart), and
 * that stays on its side; an end without an anchor before one with an
 * anchor (an anchor moves by at most the tolerance, which `checkRoutes`
 * allows), then the target before the source. A junction never moves.
 * Edges are taken in document order. Mutates `pairs`.
 */
function straighten(
  pairs: ({ from: End; to: End } | { error: string })[],
  choices: readonly { from: Choice | undefined; to: Choice | undefined }[],
  reresolve: (end: End, choice: Choice, port: Point) => End,
  element: (key: ElementKey) => Element,
): void {
  const pointKey = (key: ElementKey, p: Point) => `${key} ${p.x} ${p.y}`;
  const users = new Map<string, number>();
  for (const pair of pairs) {
    if ("error" in pair) continue;
    for (const end of [pair.from, pair.to]) {
      if (end.junction) continue;
      const k = pointKey(end.key, end.port);
      users.set(k, (users.get(k) ?? 0) + 1);
    }
  }
  for (const [index, pair] of pairs.entries()) {
    if ("error" in pair) continue;
    const { from: a, to: b } = pair;
    // The axis the ends face each other along.
    const f = facing(a, b);
    if (f === undefined || !straightenable(f)) continue;
    const d = f.dir;
    const choice = choices[index] as { from: Choice | undefined; to: Choice | undefined };
    const candidates = (
      [
        ["to", b, a, choice.to],
        ["from", a, b, choice.from],
      ] as const
    )
      .filter((c): c is readonly ["to" | "from", End, End, Choice] => c[3] !== undefined)
      .sort((p, q) => Number(p[3].anchored) - Number(q[3].anchored));
    for (const [which, end, other, endChoice] of candidates) {
      const vertical = d % 2 === 1;
      const port = vertical
        ? { x: other.port.x, y: end.port.y }
        : { x: end.port.x, y: other.port.y };
      const rect = element(end.key).rect;
      const onSide = vertical
        ? port.x >= rect.x && port.x <= rightOf(rect)
        : port.y >= rect.y && port.y <= bottomOf(rect);
      const here = pointKey(end.key, end.port);
      const there = pointKey(end.key, port);
      if (!onSide || users.get(here) !== 1 || (users.get(there) ?? 0) > 0) continue;
      users.delete(here);
      users.set(there, 1);
      const moved = reresolve(end, endChoice, port);
      pairs[index] = which === "to" ? { from: a, to: moved } : { from: moved, to: b };
      break;
    }
  }
}

/** {@link resolveEnds}, with the ends in `spread` (keyed {@link endKey}) at that side and offset. */
function resolveEndsWith(
  ir: FigureIR,
  layout: LayoutIR,
  spread: ReadonlyMap<string, { side: Side; offset: number }>,
): ({ from: End; to: End } | { error: string })[] {
  const elements = new Map<ElementKey, Element>();
  const nodes = new Map(ir.nodes.map((n) => [n.key, n]));
  for (const n of layout.nodes) {
    const node = nodes.get(n.key);
    if (node === undefined) throw new Error(`internal error: ${n.key} is not in the IR`);
    elements.set(n.key, {
      key: n.key,
      rect: n.rect,
      node,
      ...(n.parent !== undefined && { parent: n.parent }),
    });
  }
  for (const g of layout.groups) {
    elements.set(g.key, {
      key: g.key,
      rect: g.rect,
      ...(g.parent !== undefined && { parent: g.parent }),
    });
  }
  const element = (key: ElementKey): Element => {
    const found = elements.get(key);
    if (found === undefined) throw new Error(`internal error: ${key} has no layout`);
    return found;
  };
  /** `true` if `inner` lies (transitively) inside the group `outer`. */
  const inside = (inner: Element, outer: Element): boolean => {
    for (let p = inner.parent; p !== undefined; p = elements.get(p)?.parent) {
      if (p === outer.key) return true;
    }
    return false;
  };

  // The side of each end: the anchor's, or the default.
  const choose = (
    edge: EdgeIR,
    self: Element,
    other: Element,
    written: EdgeAnchor | undefined,
    isSource: boolean,
    spreadAt: { side: Side; offset: number } | undefined,
  ): Choice | undefined => {
    if (isJunction(self.node)) return undefined;
    // A group connected to an element inside it: the route runs inside the group.
    const inward = self.node === undefined && inside(other, self);
    // `straight` (#179): in line with the other end on the facing side; where
    // there is none (`layout/straight-off-side`), the end is a default one.
    if (written === STRAIGHT_ANCHOR) {
      const at = straightPlacement(self.rect, other.rect);
      if ("offset" in at) {
        return { side: at.side, offset: at.offset, inward, anchored: true, straight: true };
      }
    }
    const anchor: Anchor | undefined = written === STRAIGHT_ANCHOR ? undefined : written;
    if (anchor !== undefined) {
      return { side: anchor.side, offset: anchor.offset, inward, anchored: true };
    }
    // A spread fan-in end, or an end pinned beside them: its position is
    // set, so the multi-edge sharing leaves it, but (unlike an anchor) the
    // #113 split may still move it.
    if (spreadAt !== undefined) {
      return { side: spreadAt.side, offset: spreadAt.offset, inward, anchored: false };
    }
    if (edge.from === edge.to) {
      // A self-loop goes around a corner: east → north by default, or the
      // side next to the one given (clockwise from the source).
      const written = isSource ? edge.toAnchor : edge.fromAnchor;
      // `straight` never resolves on a self-loop (no side faces the element itself).
      const given = typeof written === "object" ? written.side : undefined;
      if (given === undefined) {
        return { side: isSource ? "east" : "north", inward, anchored: false };
      }
      const index = CLOCKWISE.indexOf(given);
      return {
        side: CLOCKWISE[(index + (isSource ? 1 : 3)) % 4] as Side,
        inward,
        anchored: false,
      };
    }
    // The other end of a `straight` end (#179) faces it, so the line can be
    // straight whatever side the arrange tree would pick.
    const facingStraight = isSource ? edge.toAnchor : edge.fromAnchor;
    if (facingStraight === STRAIGHT_ANCHOR && !isJunction(other.node)) {
      const at = straightPlacement(other.rect, self.rect);
      if ("offset" in at) return { side: OPPOSITE_SIDE[at.side], inward: false, anchored: false };
    }
    if (inward) return { side: nearestSide(self.rect, other.rect), inward, anchored: false };
    if (other.node === undefined && inside(self, other)) {
      return { side: nearestSide(other.rect, self.rect), inward: false, anchored: false };
    }
    return {
      side: treeSide(self.key, other.key) ?? facingSide(self.rect, other.rect),
      inward: false,
      anchored: false,
    };
  };
  const treeSide = arrangeSides(ir, (key) => element(key).rect);

  const choices = ir.edges.map((edge, index) => {
    const from = element(edge.from);
    const to = element(edge.to);
    return {
      edge,
      from: choose(edge, from, to, edge.fromAnchor, true, spread.get(endKey(index, true))),
      to: choose(edge, to, from, edge.toAnchor, false, spread.get(endKey(index, false))),
    };
  });

  // Share out default sides among the edges between the same two elements.
  // A `straight` end (#179) takes part, so the other edges between the pair
  // keep their parallel positions; it is put in line just below.
  const sharing = new Map<string, Choice[]>();
  for (const { edge, from, to } of choices) {
    const pair = [edge.from, edge.to].sort().join(" ");
    for (const [key, choice] of [
      [edge.from, from],
      [edge.to, to],
    ] as const) {
      if (choice === undefined || (choice.offset !== undefined && !choice.straight)) continue;
      const id = `${pair}|${key}|${choice.side}`;
      const list = sharing.get(id) ?? [];
      list.push(choice);
      sharing.set(id, list);
    }
  }
  /** Ends shared out with other ends of the same side and pair (multi-edges). */
  const sharedOut = new Set<Choice>();
  for (const list of sharing.values()) {
    for (const [k, choice] of list.entries()) choice.offset = (k + 1) / (list.length + 1);
    if (list.length > 1) for (const choice of list) sharedOut.add(choice);
  }

  // `straight` ends (#179) in line with the other end's port, now that it is
  // known (a shared-out multi-edge end, a spread end, an anchor, a junction's
  // centre). Where that port is not on the facing side or is off this side's
  // corner margin, the end takes the projection of the other's centre; or,
  // if it was shared out with parallel edges, keeps its shared-out position,
  // so the parallel edges keep separate points (the router reports that it is
  // not in line, `layout/straight-off-side`). Target
  // ends first: with `straight` at both ends, the target end lines up with
  // the source end's (shared-out) position, and the source end stays there.
  const portAt = (key: ElementKey, choice: Choice | undefined): Point => {
    const rect = element(key).rect;
    if (choice === undefined) {
      const c = center(rect);
      return { x: roundUnits(c.x), y: roundUnits(c.y) };
    }
    return anchorPoint(rect, { side: choice.side, offset: choice.offset ?? 0.5 });
  };
  for (const { edge, from, to } of choices) {
    for (const [key, self, otherKey, other] of [
      [edge.to, to, edge.from, from],
      [edge.from, from, edge.to, to],
    ] as const) {
      if (self?.straight !== true) continue;
      const rect = element(key).rect;
      const vertical = self.side === "north" || self.side === "south";
      const facingPort =
        other === undefined || (other.side === OPPOSITE_SIDE[self.side] && !other.inward);
      const p = portAt(otherKey, other);
      const inLine = facingPort ? straightOffset(rect, self.side, vertical ? p.x : p.y) : undefined;
      const centred = straightPlacement(rect, element(otherKey).rect);
      if (inLine !== undefined) self.offset = inLine;
      else if (!sharedOut.has(self)) self.offset = "offset" in centred ? centred.offset : 0.5;
    }
  }

  const shared = separateDirections(
    choices.map(({ edge, from, to }) => ({
      from: edge.from,
      to: edge.to,
      fromChoice: from,
      toChoice: to,
    })),
    (key) => element(key).rect,
  );

  /** The end at `choice` (`at`: the port, for an end straightened by {@link straighten}). */
  const resolve = (key: ElementKey, choice: Choice | undefined, at?: Point): End => {
    const self = element(key);
    if (choice === undefined) {
      const c = center(self.rect);
      const point = { x: roundUnits(c.x), y: roundUnits(c.y) };
      return { key, junction: true, dir: -1, port: point, outline: point };
    }
    const port = at ?? anchorPoint(self.rect, { side: choice.side, offset: choice.offset ?? 0.5 });
    const outward = SIDE_DIR[choice.side];
    const dir = choice.inward ? opposite(outward) : outward;
    let outline = port;
    if (self.node !== undefined) {
      // Move inward along the normal onto the drawn outline (a circle, a diamond, …).
      const depth = outward % 2 === 0 ? self.rect.width : self.rect.height;
      const d = DIRS[opposite(outward)] as Point;
      const far = { x: port.x + d.x * depth, y: port.y + d.y * depth };
      const regions = self.node.image?.layers
        ? imageLayerRects(self.node, self.rect).map(rectPolygon)
        : [nodeRegion(self.node, self.rect)];
      const hits = regions.flatMap((region) => {
        const t = boundaryEntry(port, far, region);
        return t === undefined ? [] : [t];
      });
      const t = hits.length > 0 ? Math.min(...hits) : undefined;
      if (t !== undefined && t > 0) {
        outline = {
          x: roundUnits(port.x + d.x * depth * t),
          y: roundUnits(port.y + d.y * depth * t),
        };
      }
    }
    return { key, junction: false, side: choice.side, dir, port, outline };
  };

  const resolved = choices.map(({ edge, from, to }, index) => {
    const reason = shared.get(index);
    if (reason !== undefined) return { error: reason };
    return { from: resolve(edge.from, from), to: resolve(edge.to, to) };
  });
  straighten(resolved, choices, (end, choice, port) => resolve(end.key, choice, port), element);
  return resolved.map((pair, index) => {
    if ("error" in pair) return pair;
    const edge = (choices[index] as (typeof choices)[number]).edge;
    const { from: a, to: b } = pair;
    for (const end of [a, b]) {
      const self = element(end.key);
      if (self.node?.image?.layers === undefined) continue;
      const touches = imageLayerRects(self.node, self.rect).some(
        (r) => boundaryEntry(end.outline, end.outline, rectPolygon(r)) === 0,
      );
      if (!touches) return { error: "the edge cannot contact a painted image layer at this port" };
    }
    if (a.port.x === b.port.x && a.port.y === b.port.y) {
      return {
        error:
          edge.from === edge.to
            ? "both ends are the same point of the element"
            : "both ends are the same point",
      };
    }
    return { from: a, to: b };
  });
}
