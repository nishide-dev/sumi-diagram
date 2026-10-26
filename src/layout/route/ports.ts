/**
 * Edge ends for the orthogonal router (#90): which side of the source and
 * target an edge uses, the port on that side, and where the route meets the
 * shape's outline.
 */

import type { EdgeIR, FigureIR, NodeIR } from "../../compiler/ir";
import type { ElementKey } from "../../core/check-state";
import type { Anchor } from "../../core/figure/layout";
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
 * never moved.
 */
interface Choice {
  side: Side;
  offset?: number;
  inward: boolean;
  anchored: boolean;
}

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
 * If the rounds run out (moves keep meeting other ports), a direction that
 * may move takes the first unused position of 1/4, 3/4, 1/8, 3/8, … instead.
 *
 * Mutates the choices' offsets; returns the indices of the edges that keep a
 * shared port (the later direction in document order) with the reason, for
 * `layout/no-route`: both directions anchored there, or (with over a
 * thousand ports on one side) no free position left.
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
      // Toward the moving edges' other ends, else away from the staying ones'.
      const mean = (slots: Slot[]) =>
        slots.reduce((sum, s) => sum + along(side, pointOf(s.partner, s.partnerChoice)), 0) /
          slots.length -
        along(side, point);
      const sign = Math.sign(mean(move)) || -Math.sign(mean(stay)) || 1;
      const offset = (move[0] as Slot).choice.offset ?? 0.5;
      let next = sign > 0 ? (offset + 1) / 2 : offset / 2;
      if (next === offset) next = sign > 0 ? offset / 2 : (offset + 1) / 2;
      for (const slot of move) {
        const before = pointOf(slot.partner, slot.partnerChoice);
        slot.choice.offset = next;
        touched.add(slot.choice);
        // Keep a straight line between facing sides straight.
        const partner = slot.partnerChoice;
        if (
          partner === undefined ||
          partner.anchored ||
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
        const t = (target - start) / length;
        if (!(t > 0 && t < 1)) continue;
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
    const pointKey = (p: Point) => `${p.x} ${p.y}`;
    const used = new Set<string>();
    for (const other of collect().values()) {
      const slot = (other.leaving[0] ?? other.entering[0]) as Slot;
      if (slot.key === first.key && other.side === port.side) used.add(pointKey(other.point));
    }
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
  return kept;
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
 * edge cannot be routed. Ends without an anchor take the default side; the
 * edges between the same two elements that use the same default side of an
 * element share it out evenly (offsets 1/(n+1) … n/(n+1)), so multi-edges
 * and two-way pairs are drawn as parallel lines rather than on top of each
 * other. Then a port used both by edges leaving it and by edges entering it
 * is split (`separateDirections`, #113): the router joins edges into a net
 * only per direction, and two nets cannot share a port.
 */
export function resolveEnds(
  ir: FigureIR,
  layout: LayoutIR,
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
    anchor: Anchor | undefined,
    isSource: boolean,
  ): Choice | undefined => {
    if (isJunction(self.node)) return undefined;
    // A group connected to an element inside it: the route runs inside the group.
    const inward = self.node === undefined && inside(other, self);
    if (anchor !== undefined) {
      return { side: anchor.side, offset: anchor.offset, inward, anchored: true };
    }
    if (edge.from === edge.to) {
      // A self-loop goes around a corner: east → north by default, or the
      // side next to the one given (clockwise from the source).
      const given = isSource ? edge.toAnchor?.side : edge.fromAnchor?.side;
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
    if (inward) return { side: nearestSide(self.rect, other.rect), inward, anchored: false };
    if (other.node === undefined && inside(self, other)) {
      return { side: nearestSide(other.rect, self.rect), inward: false, anchored: false };
    }
    return { side: facingSide(self.rect, other.rect), inward: false, anchored: false };
  };

  const choices = ir.edges.map((edge) => {
    const from = element(edge.from);
    const to = element(edge.to);
    return {
      edge,
      from: choose(edge, from, to, edge.fromAnchor, true),
      to: choose(edge, to, from, edge.toAnchor, false),
    };
  });

  // Share out default sides among the edges between the same two elements.
  const sharing = new Map<string, Choice[]>();
  for (const { edge, from, to } of choices) {
    const pair = [edge.from, edge.to].sort().join(" ");
    for (const [key, choice] of [
      [edge.from, from],
      [edge.to, to],
    ] as const) {
      if (choice === undefined || choice.offset !== undefined) continue;
      const id = `${pair}|${key}|${choice.side}`;
      const list = sharing.get(id) ?? [];
      list.push(choice);
      sharing.set(id, list);
    }
  }
  for (const list of sharing.values()) {
    for (const [k, choice] of list.entries()) choice.offset = (k + 1) / (list.length + 1);
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

  const resolve = (key: ElementKey, choice: Choice | undefined): End => {
    const self = element(key);
    if (choice === undefined) {
      const c = center(self.rect);
      const point = { x: roundUnits(c.x), y: roundUnits(c.y) };
      return { key, junction: true, dir: -1, port: point, outline: point };
    }
    const port = anchorPoint(self.rect, { side: choice.side, offset: choice.offset ?? 0.5 });
    const outward = SIDE_DIR[choice.side];
    const dir = choice.inward ? opposite(outward) : outward;
    let outline = port;
    if (self.node !== undefined) {
      // Move inward along the normal onto the drawn outline (a circle, a diamond, …).
      const depth = outward % 2 === 0 ? self.rect.width : self.rect.height;
      const d = DIRS[opposite(outward)] as Point;
      const far = { x: port.x + d.x * depth, y: port.y + d.y * depth };
      const t = boundaryEntry(port, far, nodeRegion(self.node, self.rect));
      if (t !== undefined && t > 0) {
        outline = {
          x: roundUnits(port.x + d.x * depth * t),
          y: roundUnits(port.y + d.y * depth * t),
        };
      }
    }
    return { key, junction: false, side: choice.side, dir, port, outline };
  };

  return choices.map(({ edge, from, to }, index) => {
    const reason = shared.get(index);
    if (reason !== undefined) return { error: reason };
    const a = resolve(edge.from, from);
    const b = resolve(edge.to, to);
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
