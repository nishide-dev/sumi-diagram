/**
 * Checks of a routed Layout IR (#90): the properties the router is meant to
 * guarantee, verified independently of how it works. Tests run them on the
 * fixtures; the geometry lint re-checks the "through a node" part on the
 * SVG (`geometry/edge-through-node`, through the same `obstaclesCrossedByRoute`).
 */

import type { FigureIR } from "../../compiler/ir";
import type { ElementKey } from "../../core/check-state";
import type { Region } from "../../core/geometry";
import { obstaclesCrossedByRoute, type RouteObstacle } from "../../lint/geometry/edges";
import { rectPolygon, segmentCrossesRect } from "../../lint/geometry/shapes";
import type { EdgeLayout, LayoutIR, Point, Rect } from "../ir";
import { anchorPoint, DIRS, isJunction, nodeRegion, SIDE_DIR } from "./ports";
import { arrowheadLength } from "./router";

/** Each list names the problems found; all empty is a clean routing. */
export interface RouteCheckReport {
  /** Edges without a route. */
  unrouted: string[];
  /** Segments that are neither horizontal nor vertical. */
  nonOrthogonal: string[];
  /** Repeated points, or consecutive segments on one line (including turning back). */
  malformed: string[];
  /**
   * Segments passing through a node that is not one of the edge's ends, or
   * through one of its ends other than along the segment that ends there.
   */
  throughNode: string[];
  /**
   * Ends not on the outline of their element, not at a junction's center,
   * not at the requested anchor, or not leaving / entering perpendicular to
   * the side, away from / into the element.
   */
  endpointMisses: string[];
  /**
   * Nets that are not the edges a shared port or junction joins (#113): one
   * net holding edges that nothing joins, or edges that should be one net
   * split over several. Edges are joined when they leave the same port
   * (element, side and point), enter the same port, or touch junctions
   * joined by edges; a net is a group of edges joined that way, transitively.
   */
  misjoinedNets: string[];
  /** Proper crossings between routes of different nets. */
  crossings: string[];
  /** A point (end or bend) of one net's route lying on another net's route. */
  contacts: string[];
  /**
   * Collinear overlaps between routes of different nets, or of one net but
   * neither leaving a port together, entering one together nor joined by
   * junctions (#113: `a → x` and `x → b` sharing a line read as `a → b`).
   */
  overlaps: string[];
  /** A segment ending in an arrowhead that is shorter than the arrowhead. */
  shortArrowSegments: string[];
  /** Edge labels over a node, another label, a route, or across a group border. */
  labelCollisions: string[];
  /** Route points or edge labels outside the canvas or the content box. */
  outside: string[];
}

const EPS = 0.01;

type Segment = readonly [Point, Point];

const segmentsOf = (points: readonly Point[]): Segment[] =>
  points.slice(1).map((p, i) => [points[i] as Point, p] as const);

const horizontal = ([a, b]: Segment) => Math.abs(a.y - b.y) <= EPS;

/** `p` lies on the axis-parallel segment, ends included. */
function onSegment(p: Point, [a, b]: Segment): boolean {
  return (
    p.x >= Math.min(a.x, b.x) - EPS &&
    p.x <= Math.max(a.x, b.x) + EPS &&
    p.y >= Math.min(a.y, b.y) - EPS &&
    p.y <= Math.max(a.y, b.y) + EPS
  );
}

/** Distance from `p` to the boundary of a convex region is at most `EPS`. */
function onOutline(region: Region, p: Point): boolean {
  if (region.kind === "ellipse") {
    const r = Math.hypot((p.x - region.cx) / region.rx, (p.y - region.cy) / region.ry);
    return Math.abs(r - 1) * Math.min(region.rx, region.ry) <= EPS;
  }
  const n = region.points.length;
  for (let i = 0; i < n; i++) {
    const a = region.points[i] as Point;
    const b = region.points[(i + 1) % n] as Point;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length2 = dx * dx + dy * dy;
    const t =
      length2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2));
    if (Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y) <= EPS) return true;
  }
  return false;
}

const overlap = (a: Rect, b: Rect) =>
  a.x < b.x + b.width - EPS &&
  b.x < a.x + a.width - EPS &&
  a.y < b.y + b.height - EPS &&
  b.y < a.y + a.height - EPS;

const contains = (outer: Rect, inner: Rect) =>
  inner.x >= outer.x - EPS &&
  inner.y >= outer.y - EPS &&
  inner.x + inner.width <= outer.x + outer.width + EPS &&
  inner.y + inner.height <= outer.y + outer.height + EPS;

/** Checks the routes of `layout` (laid out and routed from `ir`). */
export function checkRoutes(ir: FigureIR, layout: LayoutIR): RouteCheckReport {
  const report: RouteCheckReport = {
    unrouted: [],
    nonOrthogonal: [],
    malformed: [],
    throughNode: [],
    endpointMisses: [],
    misjoinedNets: [],
    crossings: [],
    contacts: [],
    overlaps: [],
    shortArrowSegments: [],
    labelCollisions: [],
    outside: [],
  };
  const nodeIR = new Map(ir.nodes.map((n) => [n.key, n]));
  const edgeIR = new Map(ir.edges.map((e) => [e.key, e]));
  const regions = new Map<ElementKey, Region>();
  const rects = new Map<ElementKey, Rect>();
  for (const node of layout.nodes) {
    const n = nodeIR.get(node.key);
    if (n === undefined) throw new Error(`internal error: ${node.key} is not in the IR`);
    regions.set(node.key, nodeRegion(n, node.rect));
    rects.set(node.key, node.rect);
  }
  for (const group of layout.groups) {
    regions.set(group.key, rectPolygon(group.rect));
    rects.set(group.key, group.rect);
  }
  const obstacles: RouteObstacle[] = layout.nodes.map((n) => ({
    key: n.key,
    region: regions.get(n.key) as Region,
  }));
  const parents = new Map<ElementKey, ElementKey | undefined>(
    [...layout.nodes, ...layout.groups].map((e) => [e.key, e.parent]),
  );
  /** `inner` lies (transitively) in the group `outer`. */
  const inside = (inner: ElementKey, outer: ElementKey) => {
    for (let p = parents.get(inner); p !== undefined; p = parents.get(p)) {
      if (p === outer) return true;
    }
    return false;
  };
  const netOf = (e: EdgeLayout) => e.route?.net ?? -1;
  const routed = layout.edges.filter((e) => e.route !== undefined);
  const pointsOf = (e: EdgeLayout) => e.route?.points ?? [];

  for (const edge of layout.edges) {
    const route = edge.route;
    if (route === undefined) {
      report.unrouted.push(edge.key);
      continue;
    }
    const { points } = route;
    const segments = segmentsOf(points);
    for (const [a, b] of segments) {
      if (Math.abs(a.x - b.x) > EPS && Math.abs(a.y - b.y) > EPS) {
        report.nonOrthogonal.push(`${edge.key} ${a.x},${a.y} → ${b.x},${b.y}`);
      }
    }
    for (const [i, p] of points.entries()) {
      const q = points[i + 1];
      const r = points[i + 2];
      if (q !== undefined && Math.abs(p.x - q.x) <= EPS && Math.abs(p.y - q.y) <= EPS) {
        report.malformed.push(`${edge.key} repeats ${p.x},${p.y}`);
      }
      if (q !== undefined && r !== undefined) {
        const line =
          (Math.abs(p.x - q.x) <= EPS && Math.abs(q.x - r.x) <= EPS) ||
          (Math.abs(p.y - q.y) <= EPS && Math.abs(q.y - r.y) <= EPS);
        if (line) report.malformed.push(`${edge.key} straight or turning back at ${q.x},${q.y}`);
      }
    }
    for (const key of obstaclesCrossedByRoute(
      [points],
      obstacles,
      new Set([edge.from, edge.to]),
      EPS,
    )) {
      report.throughNode.push(`${edge.key} through ${key}`);
    }
    // Its own end nodes: only the segment that ends there may be inside.
    for (const key of new Set([edge.from, edge.to])) {
      const region = regions.get(key);
      if (region === undefined || !nodeIR.has(key)) continue;
      const rest = points.slice(
        key === edge.from ? 1 : 0,
        key === edge.to ? points.length - 1 : points.length,
      );
      if (obstaclesCrossedByRoute([rest], [{ key, region }], new Set(), EPS).length > 0) {
        report.throughNode.push(`${edge.key} back through its end ${key}`);
      }
    }
    // Ends.
    const ends = [
      ["from", edge.from, points[0], points[1], route.fromSide, edge.fromAnchor],
      [
        "to",
        edge.to,
        points[points.length - 1],
        points[points.length - 2],
        route.toSide,
        edge.toAnchor,
      ],
    ] as const;
    for (const [which, key, end, next, side, anchor] of ends) {
      if (end === undefined || next === undefined) {
        report.endpointMisses.push(`${edge.key} ${which}: fewer than 2 points`);
        continue;
      }
      const rect = rects.get(key) as Rect;
      const miss = (why: string) =>
        report.endpointMisses.push(`${edge.key} ${which} ${key}: ${why}`);
      if (isJunction(nodeIR.get(key))) {
        const cx = rect.x + rect.width / 2;
        const cy = rect.y + rect.height / 2;
        if (Math.abs(end.x - cx) > EPS || Math.abs(end.y - cy) > EPS) miss("not at the center");
        continue;
      }
      if (side === undefined) {
        miss("no side");
        continue;
      }
      if (!onOutline(regions.get(key) as Region, end)) miss(`${end.x},${end.y} not on the outline`);
      const vertical = SIDE_DIR[side] % 2 === 1;
      if (vertical ? Math.abs(end.x - next.x) > EPS : Math.abs(end.y - next.y) > EPS) {
        miss(`not perpendicular to the ${side} side`);
      }
      // Away from the element (into it for a group entered from inside).
      const other = which === "from" ? edge.to : edge.from;
      const inward = !nodeIR.has(key) && inside(other, key);
      const out = DIRS[inward ? (SIDE_DIR[side] + 2) % 4 : SIDE_DIR[side]] as Point;
      if ((next.x - end.x) * out.x + (next.y - end.y) * out.y <= 0) {
        miss(`not ${inward ? "into" : "away from"} the element`);
      }
      if (anchor !== undefined) {
        const want = anchorPoint(rect, anchor);
        const off = vertical ? Math.abs(want.x - end.x) : Math.abs(want.y - end.y);
        if (anchor.side !== side || off > EPS)
          miss(`not at the anchor ${anchor.side}:${anchor.offset}`);
      }
    }
    // Arrowheads need a straight segment as long as themselves.
    const ir = edgeIR.get(edge.key);
    if (ir !== undefined) {
      const arrow = arrowheadLength(ir.style.strokeWidth.units);
      const length = ([a, b]: Segment) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      const first = segments[0];
      const last = segments[segments.length - 1];
      // Junction ends have no stub (design doc §6.22).
      const free = (key: ElementKey) => isJunction(nodeIR.get(key));
      if (
        ir.sourceArrowhead !== undefined &&
        !free(edge.from) &&
        first !== undefined &&
        length(first) < arrow - EPS
      ) {
        report.shortArrowSegments.push(`${edge.key} source`);
      }
      if (
        ir.targetArrowhead !== undefined &&
        !free(edge.to) &&
        last !== undefined &&
        length(last) < arrow - EPS
      ) {
        report.shortArrowSegments.push(`${edge.key} target`);
      }
    }
    for (const p of points) {
      if (
        p.x < -EPS ||
        p.y < -EPS ||
        p.x > layout.canvas.width + EPS ||
        p.y > layout.canvas.height + EPS
      ) {
        report.outside.push(`${edge.key} point ${p.x},${p.y} outside the canvas`);
      } else if (!contains(layout.content, { ...p, width: 0, height: 0 })) {
        report.outside.push(`${edge.key} point ${p.x},${p.y} outside the content`);
      }
    }
  }

  // Which routes may share lines (#113), from the Layout IR alone: edges
  // leaving the same port, edges entering the same port, and edges touching
  // junctions joined by edges. Not transitive through a port: `x → y` and
  // `w → z` are not joined because `x → z` shares a port with each.
  const junctionOf = new Map<ElementKey, ElementKey>();
  const findJunction = (key: ElementKey): ElementKey => {
    let root = key;
    while ((junctionOf.get(root) ?? root) !== root) root = junctionOf.get(root) as ElementKey;
    return root;
  };
  for (const edge of layout.edges) {
    if (isJunction(nodeIR.get(edge.from)) && isJunction(nodeIR.get(edge.to))) {
      const a = findJunction(edge.from);
      const b = findJunction(edge.to);
      if (a !== b) junctionOf.set(a < b ? b : a, a < b ? a : b);
    }
  }
  interface Joins {
    readonly leaving?: string;
    readonly entering?: string;
    readonly junction?: ElementKey;
  }
  const joinsOf = new Map<ElementKey, Joins>();
  for (const edge of routed) {
    const route = edge.route as NonNullable<EdgeLayout["route"]>;
    const first = route.points[0] as Point;
    const last = route.points[route.points.length - 1] as Point;
    // A port: element, side, point and the direction the route runs from it
    // (out of a group's side, or into it for an end inside the group).
    const port = (key: ElementKey, side: string | undefined, p: Point, next: Point | undefined) =>
      isJunction(nodeIR.get(key)) || next === undefined
        ? undefined
        : `${key} ${side} ${p.x},${p.y} ${Math.sign(next.x - p.x)},${Math.sign(next.y - p.y)}`;
    const junction = [edge.from, edge.to].find((key) => isJunction(nodeIR.get(key)));
    const leaving = port(edge.from, route.fromSide, first, route.points[1]);
    const entering = port(edge.to, route.toSide, last, route.points[route.points.length - 2]);
    joinsOf.set(edge.key, {
      ...(leaving !== undefined && { leaving }),
      ...(entering !== undefined && { entering }),
      ...(junction !== undefined && { junction: findJunction(junction) }),
    });
  }
  /** `p` and `q` may share lines: a port both leave or both enter, or joined junctions. */
  const joined = (p: EdgeLayout, q: EdgeLayout) => {
    const a = joinsOf.get(p.key) as Joins;
    const b = joinsOf.get(q.key) as Joins;
    return (
      (a.leaving !== undefined && a.leaving === b.leaving) ||
      (a.entering !== undefined && a.entering === b.entering) ||
      (a.junction !== undefined && a.junction === b.junction)
    );
  };
  // The nets the joins make (transitively), against the routes' nets.
  const group = new Map<ElementKey, number>(routed.map((e, i) => [e.key, i]));
  const findGroup = (key: ElementKey): number => {
    let g = group.get(key) as number;
    while (group.get((routed[g] as EdgeLayout).key) !== g) {
      g = group.get((routed[g] as EdgeLayout).key) as number;
    }
    return g;
  };
  for (const [i, p] of routed.entries()) {
    for (const q of routed.slice(i + 1)) {
      if (!joined(p, q)) continue;
      const a = findGroup(p.key);
      const b = findGroup(q.key);
      if (a !== b) group.set((routed[Math.max(a, b)] as EdgeLayout).key, Math.min(a, b));
    }
  }
  const byNet = new Map<number, EdgeLayout[]>();
  const byGroup = new Map<number, EdgeLayout[]>();
  for (const e of routed) {
    byNet.set(netOf(e), [...(byNet.get(netOf(e)) ?? []), e]);
    byGroup.set(findGroup(e.key), [...(byGroup.get(findGroup(e.key)) ?? []), e]);
  }
  for (const [net, edges] of byNet) {
    const groups = new Set(edges.map((e) => findGroup(e.key)));
    if (groups.size > 1) {
      report.misjoinedNets.push(
        `net ${net} holds edges nothing joins: ${[...groups]
          .map((g) => (byGroup.get(g) as EdgeLayout[]).map((e) => e.key).join(" "))
          .join(" / ")}`,
      );
    }
  }
  for (const edges of byGroup.values()) {
    const nets = new Set(edges.map(netOf));
    if (nets.size > 1) {
      report.misjoinedNets.push(
        `${edges.map((e) => e.key).join(" ")} are joined but in nets ${[...nets].join(", ")}`,
      );
    }
  }

  // Routes that may not share lines: crossings, contacts and overlaps.
  for (const [i, p] of routed.entries()) {
    for (const q of routed.slice(i + 1)) {
      if (joined(p, q)) continue;
      // Two edges of one net that nothing joins directly (a net bridged by
      // an edge that shares a port with each) meet at the net's branch
      // points; only running along each other is a fault (#113).
      const sameNet = netOf(p) === netOf(q);
      const sp = segmentsOf(pointsOf(p));
      const sq = segmentsOf(pointsOf(q));
      for (const v of sameNet ? [] : pointsOf(p)) {
        if (sq.some((s) => onSegment(v, s))) report.contacts.push(`${p.key} point on ${q.key}`);
      }
      for (const v of sameNet ? [] : pointsOf(q)) {
        if (sp.some((s) => onSegment(v, s))) report.contacts.push(`${q.key} point on ${p.key}`);
      }
      for (const a of sp) {
        for (const b of sq) {
          if (horizontal(a) !== horizontal(b)) {
            if (sameNet) continue;
            const [h, v] = horizontal(a) ? [a, b] : [b, a];
            const x = v[0].x;
            const y = h[0].y;
            if (
              x > Math.min(h[0].x, h[1].x) + EPS &&
              x < Math.max(h[0].x, h[1].x) - EPS &&
              y > Math.min(v[0].y, v[1].y) + EPS &&
              y < Math.max(v[0].y, v[1].y) - EPS
            ) {
              report.crossings.push(`${p.key} × ${q.key} at ${x},${y}`);
            }
            continue;
          }
          const along = horizontal(a) ? "x" : "y";
          const across = horizontal(a) ? "y" : "x";
          if (Math.abs(a[0][across] - b[0][across]) > EPS) continue;
          const lo = Math.max(
            Math.min(a[0][along], a[1][along]),
            Math.min(b[0][along], b[1][along]),
          );
          const hi = Math.min(
            Math.max(a[0][along], a[1][along]),
            Math.max(b[0][along], b[1][along]),
          );
          if (hi > lo + EPS)
            report.overlaps.push(`${p.key} = ${q.key} (${(hi - lo).toFixed(3)} units)`);
        }
      }
    }
  }

  // Edge labels.
  const otherLabels: [string, Rect][] = [
    ...layout.nodes.flatMap((n) =>
      n.label === undefined ? [] : [[n.key, n.label.box] as [string, Rect]],
    ),
    ...layout.groups.flatMap((g) =>
      g.label === undefined ? [] : [[g.key, g.label.box] as [string, Rect]],
    ),
  ];
  const edgeLabels = routed.flatMap((e) =>
    e.route?.label === undefined ? [] : [[e.key, e.route.label.box] as [string, Rect]],
  );
  for (const [i, [key, box]] of edgeLabels.entries()) {
    for (const node of layout.nodes) {
      if (overlap(box, node.rect)) report.labelCollisions.push(`${key} label / ${node.key}`);
    }
    for (const [other, r] of [...otherLabels, ...edgeLabels.slice(i + 1)]) {
      if (overlap(box, r)) report.labelCollisions.push(`${key} label / ${other} label`);
    }
    for (const group of layout.groups) {
      if (overlap(box, group.rect) && !contains(group.rect, box)) {
        report.labelCollisions.push(`${key} label / ${group.key} border`);
      }
    }
    for (const e of routed) {
      const points = pointsOf(e);
      if (segmentsOf(points).some(([a, b]) => segmentCrossesRect(a, b, box, 0))) {
        report.labelCollisions.push(`${key} label / ${e.key} route`);
      }
    }
    if (!contains(layout.content, box)) report.outside.push(`${key} label outside the content`);
  }
  return report;
}

/** The number of problems in a report. */
export function routeProblemCount(report: RouteCheckReport): number {
  return Object.values(report).reduce((sum, list: string[]) => sum + list.length, 0);
}
