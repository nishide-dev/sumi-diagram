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
 * other.
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
  type Choice = { side: Side; offset?: number; inward: boolean };
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
    if (anchor !== undefined) return { side: anchor.side, offset: anchor.offset, inward };
    if (edge.from === edge.to) {
      // A self-loop goes around a corner: east → north by default, or the
      // side next to the one given (clockwise from the source).
      const given = isSource ? edge.toAnchor?.side : edge.fromAnchor?.side;
      if (given === undefined) return { side: isSource ? "east" : "north", inward };
      const index = CLOCKWISE.indexOf(given);
      return { side: CLOCKWISE[(index + (isSource ? 1 : 3)) % 4] as Side, inward };
    }
    if (inward) return { side: nearestSide(self.rect, other.rect), inward };
    if (other.node === undefined && inside(self, other)) {
      return { side: nearestSide(other.rect, self.rect), inward: false };
    }
    return { side: facingSide(self.rect, other.rect), inward: false };
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

  return choices.map(({ edge, from, to }) => {
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
