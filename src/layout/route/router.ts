/**
 * The orthogonal edge router of structured figures (#90, design doc §6.22;
 * #86 §4). Takes the Layout IR of the structured engine (#89) and fills in
 * every edge's `route` and the `nets`.
 *
 * - **Grid**: a sparse ("Hanan") grid whose lines are the node borders, the
 *   borders inflated by the clearance, group borders and group-label
 *   borders, a ring around the content and the midlines between those
 *   neighbouring lines (to run in the middle of a gutter), plus the ports,
 *   the ends of their stubs and junction centers. Coordinates are rounded
 *   to 1/1000 unit and lines are integer-indexed. The grid and its step
 *   costs are built once; occupancy is updated in place.
 * - **Search**: per edge, A* (an admissible lower bound, so the same cost as
 *   Dijkstra) over (grid point, direction), first within a corridor around
 *   the ends (`ROUTE.corridor`) and on the whole grid if that finds nothing;
 *   with costs
 *   for length, bends, crossing a group border, running through a group's
 *   label or a node's clearance zone, and crossing, touching or overlapping
 *   a route of another net. Steps along or inside a node (other than a
 *   junction of the edge's own) are not allowed, so a route never passes
 *   through a node.
 * - **Ports and stubs**: an end leaves (enters) its port perpendicular to the
 *   side and runs straight for at least the clearance (and the arrowhead's
 *   length at an end with an arrowhead) before it may bend. A junction is a
 *   point the route may leave or enter in any direction.
 * - **Room before an arrowhead (#116)**: the arrowhead's length plus the
 *   wire's corner radius (`arrowRoom()`), so a rounded corner before the
 *   arrowhead ends where it starts. The stub is reserved up to the room's
 *   end, and that end (not the stub's) is the grid line, so the grid does
 *   not grow. Turning within the room, or another edge of the net forking
 *   off or joining the line there (a shared trunk split right before the
 *   arrowhead), costs `ROUTE.arrowRoom`: a route keeps the room unless that
 *   costs a crossing or a detour, and a tight gap routes as before. An end whose
 *   room would not fit, with the clearance, inside a group that holds both
 *   ends has none, and a room never reaches past a junction straight ahead
 *   at the edge's other end (#153; `#room`).
 * - **Facing ends out of line (#169)**: ends that face each other but miss
 *   by at most `STRAIGHTEN_TOLERANCE` are put in line by `resolveEnds`. If
 *   the gap between two facing ports out of line is shorter than their two
 *   stubs, no plain jog fits; the grid gets the column and rows of an S
 *   between them (`tightJog`), so the route need not go around an end.
 *   Ends within the tolerance that cannot be moved (both shared) get
 *   `layout/unaligned-ends` (warning).
 * - **Nets**: edges that leave the same port, enter the same port, or touch
 *   the same junction form one net (union-find, so junctions joined by edges
 *   merge transitively). Edges entering and leaving one port are different
 *   nets; `resolveEnds` gives them different ports (#113). A
 *   step already used by the edge's own net costs nothing, which yields
 *   shared trunks, buses and fan-outs without a separate bundling step.
 * - **Occupancy**: every step of every route is recorded with all its nets,
 *   and the stubs of all ends are recorded before the first search, so a
 *   route avoids the stubs of the edges routed after it. There is no special
 *   case for straight connectors: a straight line between facing ports is
 *   simply the cheapest route, and it is recorded like any other.
 * - **Order**: edges are routed in document order (greedy); heap ties are
 *   broken by state index. Fully deterministic: no hashing order, randomness
 *   or time dependence.
 *
 * Zoom edges (#176, `zoom.ts`) are not routed: `routeEdges` routes the
 * others as if they were absent, then adds their straight lines.
 *
 * An edge without a route gets `layout/no-route` (error), located at the
 * edge; the others are still routed. If every edge is routed, each crossing
 * between nets gets `layout/edge-crossing` (info, `crossings.ts`, #133). After routing, edge labels are placed
 * (`labels.ts`) and the content and canvas grow to hold the routes.
 */

import type { EdgeIR, FigureIR } from "../../compiler/ir";
import type { ElementKey } from "../../core/check-state";
import { type Diagnostic, hasErrors } from "../../core/diagnostics";
import {
  type EdgeLayout,
  type EdgeRoute,
  type GroupLayout,
  type LayoutIR,
  type NodeLayout,
  type Point,
  type Rect,
  type RouteNet,
  roundRect,
  roundUnits,
  type TextLayout,
} from "../ir";
import { deepFreeze } from "../structured/engine";
import { arrowheadLength } from "./arrowhead";
import { crossingDiagnostics } from "./crossings";
import { PairHeap } from "./heap";
import { requestedLabelDiagnostics } from "./label-diagnostics";
import { arrowheadRects, hasRequestedLabel, placeEdgeLabel } from "./labels";
import {
  bottomOf,
  DIRS,
  type End,
  facing,
  isJunction,
  opposite,
  resolveEnds,
  rightOf,
  STRAIGHT_MARGIN,
  straightenable,
  straightPlacement,
} from "./ports";
import { addZoomRoutes, withoutZoomEdges, withoutZoomLayouts } from "./zoom";

/** Router parameters in units (0.5pt) and costs (in units of length). */
export const ROUTE = Object.freeze({
  /** Space kept around nodes where possible (3pt), and the shortest stub. */
  clearance: 6,
  /** Extra cost per unit of length inside a node's clearance zone or along a group border. */
  clearanceCost: 4,
  bend: 40,
  /** Crossing a group's border. */
  groupBorder: 150,
  /** Per step through a group's label. */
  groupLabel: 1000,
  /** Crossing or touching a route of another net. */
  cross: 300,
  /** Running along a route of another net. */
  overlap: 4000,
  /**
   * A route is first searched within the bounding box of its ends' stubs
   * widened by this much (40pt), and on the whole grid only if none is
   * found there.
   */
  corridor: 80,
  /**
   * Turning, or forking off or joining another edge of the net, within the
   * room before an arrowhead (`arrowRoom()`, #116): more than two bends,
   * less than a crossing, so a route keeps the room where moving a bend or
   * the trunk gives it, but not at the price of a crossing or a detour.
   */
  arrowRoom: 100,
});

// In its own module so the structured engine can size group padding by it
// (#171, `padding.ts`) without importing the router.
export { arrowheadLength };

/**
 * The largest corner radius of a structured wire (#101), in units: 4pt, a
 * little under D2's 5pt for ELK routes, as structured figures pack blocks
 * closer. The router prefers to keep this much more straight line before an
 * arrowhead (#116), so the SVG writer (`src/render/wire.ts`) can round the corner
 * before it without reaching the arrowhead.
 */
export const WIRE_CORNER_RADIUS = 8;

/**
 * The straight line a route keeps before an arrowhead where it can (#116):
 * the arrowhead's length plus the corner radius, so that a rounded corner
 * before it ends where the arrowhead starts. The stub itself (where a route
 * may not turn at all) is only the arrowhead's length.
 */
export function arrowRoom(strokeUnits: number): number {
  return arrowheadLength(strokeUnits) + WIRE_CORNER_RADIUS;
}

export interface RouteResult {
  /** The layout with `route` on every routable edge, `nets`, and the content / canvas grown to hold them. */
  readonly layout: LayoutIR;
  /**
   * `layout/no-route` for each edge without a route; if every edge has one,
   * `layout/edge-crossing` (info) for the crossings between nets (#133).
   */
  readonly diagnostics: Diagnostic[];
}

/** Routes the edges of a structured layout. `ir` is the Figure IR the layout was made from. */
export interface RouteOptions {
  /**
   * Use the A* lower bound (default). `false` searches with Dijkstra (the
   * same costs, slower); tests compare the two.
   */
  lowerBound?: boolean;
  /**
   * For tests: search every edge also with Dijkstra on the same occupancy
   * and throw if the costs differ (the lower bound overestimated). Routes of
   * equal cost may differ between the two (the pop order picks one), so a
   * whole layout routed each way need not match once a tie appears.
   */
  verifyLowerBound?: boolean;
}

export function routeEdges(
  ir: FigureIR,
  layout: LayoutIR,
  options: RouteOptions = {},
): RouteResult {
  // Zoom edges (#176) are not routed: the other edges are routed without
  // them, and their straight lines are added to the result (`zoom.ts`).
  const routed = routeWithoutZoom(withoutZoomEdges(ir), withoutZoomLayouts(ir, layout), options);
  if (routed.layout.edges.length === layout.edges.length) return routed;
  const zoom = addZoomRoutes(ir, layout, routed.layout);
  return {
    layout: deepFreeze(zoom.layout),
    diagnostics: [...routed.diagnostics, ...zoom.diagnostics],
  };
}

function routeWithoutZoom(ir: FigureIR, layout: LayoutIR, options: RouteOptions): RouteResult {
  const routeFigure = (figure: FigureIR) =>
    chooseRouting(figure, (stubLines: boolean) =>
      new Router(
        figure,
        layout,
        options.lowerBound ?? true,
        options.verifyLowerBound ?? false,
        stubLines,
      ).run(),
    );
  const result = routeFigure(ir);
  if (ir.meta.fanIn !== "spread" || !hasErrors(result.diagnostics)) return result;
  // Fan-in spreading must not lose an edge merge mode routes (#134, design
  // doc §6.33): the spread ends can leave a stub no room (a box in the way)
  // where the merged port had it. Only then, route in merge mode too and
  // keep it for the whole figure if it has fewer errors.
  const { fanIn: _, ...meta } = ir.meta;
  const merged = routeFigure({ ...ir, meta });
  const errors = (r: RouteResult) => r.diagnostics.filter((d) => d.severity === "error").length;
  return errors(merged) < errors(result) ? merged : result;
}

/**
 * The routing `routeEdges()` returns, from `route(stubLines)` (exported for
 * tests). The grid has a line at the end of the room before an arrowhead,
 * not of the stub (#116). In a tight spot the stub's end can be the only
 * place to turn, so if an edge has no route, route the figure again with
 * both lines and keep that if it routes more edges (rare, so the grid stays
 * small). Only then, and only if every edge has a route, the crossings
 * between nets are added (`layout/edge-crossing`, #133), and the overlaps
 * of labels placed by `labelAt` / `labelSide` (`layout/edge-label-overlap`,
 * #128).
 */
export function chooseRouting(
  ir: FigureIR,
  route: (stubLines: boolean) => RouteResult,
): RouteResult {
  let result = route(false);
  if (hasErrors(result.diagnostics)) {
    const retried = route(true);
    if (retried.diagnostics.length < result.diagnostics.length) result = retried;
  }
  if (hasErrors(result.diagnostics)) return result;
  return {
    layout: result.layout,
    diagnostics: [
      ...result.diagnostics,
      ...crossingDiagnostics(ir, result.layout),
      ...requestedLabelDiagnostics(ir, result.layout, (edge) =>
        arrowheadLength(edge.style.strokeWidth.units),
      ),
    ],
  };
}

/** Owners of grid steps or points: `-1` none, a net, or `-2` several (listed in `multi`). */
class Owners {
  /** The owner, `-1` (none) or `-2` (several); read directly by the search's fast path. */
  readonly first: Int32Array;
  readonly #multi = new Map<number, number[]>();

  constructor(size: number) {
    this.first = new Int32Array(size).fill(-1);
  }

  add(index: number, net: number): void {
    const first = this.first[index] as number;
    if (first === -1) {
      this.first[index] = net;
    } else if (first === -2) {
      const list = this.#multi.get(index) as number[];
      if (!list.includes(net)) list.push(net);
    } else if (first !== net) {
      this.first[index] = -2;
      this.#multi.set(index, [first, net]);
    }
  }

  has(index: number, net: number): boolean {
    const first = this.first[index] as number;
    if (first === net) return true;
    return first === -2 && (this.#multi.get(index) as number[]).includes(net);
  }

  /** `true` if a net other than `net` owns it. */
  other(index: number, net: number): boolean {
    const first = this.first[index] as number;
    if (first === -1 || first === net) return false;
    return first !== -2 || (this.#multi.get(index) as number[]).some((n) => n !== net);
  }
}

/** Sorted unique values. */
const sortedUnique = (values: Set<number>): number[] => [...values].sort((a, b) => a - b);

/** First index with `values[i] >= v`. */
function lowerBound(values: readonly number[], v: number): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((values[mid] as number) < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** First index with `values[i] > v`. */
function upperBound(values: readonly number[], v: number): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((values[mid] as number) <= v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

interface Edge {
  readonly ir: EdgeIR;
  readonly layout: EdgeLayout;
  readonly from: End;
  readonly to: End;
  /** Straight length required after the source port / before the target port. */
  readonly fromLane: number;
  readonly toLane: number;
  /** The room before an arrowhead at the source / target (`arrowRoom()`, #116); 0 without one. */
  readonly fromRoom: number;
  readonly toRoom: number;
  /** Union-find root of the edge's net. */
  net: number;
  /** Index in the routable edges (as recorded in `Router.#edgesH` and the like). */
  readonly index: number;
  /**
   * What it may share lines with (#113): the port it leaves and the port it
   * enters (`undefined` at a junction), and its junctions' group (junctions
   * joined by edges). Set by `#joinNets`.
   */
  leaving?: string;
  entering?: string;
  junctions?: string;
  /** Indexes of `leaving` / `entering` in `Router.#terminalIds` (-1 at a junction). */
  leavingId: number;
  enteringId: number;
}

/** `a` and `b` may share lines: they leave one port, enter one port, or touch joined junctions. */
function sharable(a: Edge, b: Edge): boolean {
  return (
    a === b ||
    (a.leaving !== undefined && a.leaving === b.leaving) ||
    (a.entering !== undefined && a.entering === b.entering) ||
    (a.junctions !== undefined && a.junctions === b.junctions)
  );
}

class Router {
  readonly #ir: FigureIR;
  readonly #layout: LayoutIR;
  readonly #diagnostics: Diagnostic[] = [];

  // Grid.
  #X: number[] = [];
  #Y: number[] = [];
  #NX = 0;
  #NP = 0;
  /** Step costs before occupancy: horizontal (p → p + 1) and vertical (p → p + NX). */
  #costH = new Float64Array(0);
  #costV = new Float64Array(0);
  /** Steps along or inside a node: never used. */
  #blockH = new Uint8Array(0);
  #blockV = new Uint8Array(0);
  /** Junction (index into #junctions) at a grid point, or -1. */
  #junctionAt = new Int32Array(0);
  #junctions: ElementKey[] = [];
  /**
   * Every node in layout order, for naming blockers (#114): routes go around
   * nodes and may not enter junctions other than their own ends.
   */
  #obstacles: { key: ElementKey; rect: Rect }[] = [];

  // Occupancy.
  #stepsH!: Owners;
  #stepsV!: Owners;
  /** Nets with a horizontal / vertical step at a point. */
  #pointsH!: Owners;
  #pointsV!: Owners;

  // Search buffers, reused across edges.
  #dist = new Float64Array(0);
  #prev = new Int32Array(0);
  #stamp = new Int32Array(0);
  #laneFrom = new Int32Array(0);
  #laneTo = new Int32Array(0);
  #generation = 0;
  readonly #heap = new PairHeap();
  /**
   * The routable edges, and the edges on each occupied step (horizontal,
   * vertical) and point: within a net, only edges that may share lines
   * (`sharable`) run on each other's steps for free (#113).
   */
  #edges: Edge[] = [];
  readonly #edgesH = new Map<number, number[]>();
  readonly #edgesV = new Map<number, number[]>();
  readonly #edgesAtPoint = new Map<number, number[]>();
  /** The grid points each net occupies (with repeats), for the search's lower bound. */
  readonly #netPoints = new Map<number, number[]>();
  /** Every port, per direction (`Edge.leaving` / `Edge.entering`), numbered. */
  readonly #terminalIds = new Map<string, number>();
  /** The net of each terminal (by index): edges sharing a port are one net. */
  #terminalNets: number[] = [];
  /**
   * Points in the room before an arrowhead (`arrowRoom()`, but its far end),
   * by the terminal they belong to: `-1` none, a terminal index, or `-2`
   * several (listed in `#arrowRoomsMulti`). Another edge of the net pays
   * `ROUTE.arrowRoom` to step there (#116).
   */
  #arrowRooms = new Int32Array(0);
  readonly #arrowRoomsMulti = new Map<number, number[]>();
  /** Points where turning costs `ROUTE.arrowRoom`, per search (stamped with the generation). */
  #roomFrom = new Int32Array(0);
  #roomTo = new Int32Array(0);

  #lowerBound: boolean;
  readonly #verify: boolean;
  /** The cost of the route the last search found. */
  #lastCost = 0;

  /** Also a grid line at the end of each stub that has a room beyond it (see `routeEdges`). */
  readonly #stubLines: boolean;

  constructor(
    ir: FigureIR,
    layout: LayoutIR,
    lowerBound: boolean,
    verify: boolean,
    stubLines: boolean,
  ) {
    this.#ir = ir;
    this.#layout = layout;
    this.#lowerBound = lowerBound;
    this.#verify = verify;
    this.#stubLines = stubLines;
  }

  /** Searches `edge` (see `#search`); with `#verify`, checks the cost against Dijkstra. */
  #route(edge: Edge, margin: number): number[] | undefined {
    const cells = this.#search(edge, margin);
    if (!this.#verify || !this.#lowerBound) return cells;
    const cost = this.#lastCost;
    this.#lowerBound = false;
    const exact = this.#search(edge, margin);
    this.#lowerBound = true;
    if ((cells === undefined) !== (exact === undefined) || Math.abs(cost - this.#lastCost) > 1e-6) {
      throw new Error(
        `internal error: edge ${edge.ir.key} costs ${cells === undefined ? "none" : cost} with the lower bound and ${exact === undefined ? "none" : this.#lastCost} without`,
      );
    }
    return cells;
  }

  run(): RouteResult {
    const ir = this.#ir;
    const layoutEdges = new Map(this.#layout.edges.map((e) => [e.key, e]));
    const resolved = resolveEnds(ir, this.#layout);
    for (const [index, edge] of ir.edges.entries()) {
      this.#reportStraightOffSide(edge, resolved[index]);
    }
    const edges: (Edge | undefined)[] = ir.edges.map((edge, index) => {
      const ends = resolved[index];
      const layout = layoutEdges.get(edge.key);
      if (ends === undefined || layout === undefined) {
        throw new Error(`internal error: edge ${edge.key} has no layout`);
      }
      if ("error" in ends) {
        this.#report(edge, ends.error);
        return undefined;
      }
      const arrow = arrowheadLength(edge.style.strokeWidth.units);
      const lane = (end: End, arrowhead: boolean) =>
        end.junction ? 0 : Math.max(ROUTE.clearance, arrowhead ? arrow : 0);
      const room = (end: End, other: End, arrowhead: boolean) =>
        end.junction || !arrowhead
          ? 0
          : this.#room(end, other, arrowRoom(edge.style.strokeWidth.units), lane(end, arrowhead));
      const source = edge.sourceArrowhead !== undefined;
      const target = edge.targetArrowhead !== undefined;
      return {
        ir: edge,
        layout,
        from: ends.from,
        to: ends.to,
        fromLane: lane(ends.from, source),
        toLane: lane(ends.to, target),
        fromRoom: room(ends.from, ends.to, source),
        toRoom: room(ends.to, ends.from, target),
        net: index,
        index: 0,
        leavingId: -1,
        enteringId: -1,
      };
    });
    const routable = edges
      .filter((e): e is Edge => e !== undefined)
      .map((e, index) => ({ ...e, index }));
    this.#edges = routable;
    this.#joinNets(routable);
    this.#buildGrid(routable);
    for (const edge of routable) this.#reserveStubs(edge);

    for (const edge of routable) this.#reportUnaligned(edge);

    const routes = new Map<ElementKey, Point[]>();
    for (const edge of routable) {
      // First within a corridor around the ends, then on the whole grid.
      const cells = this.#route(edge, ROUTE.corridor) ?? this.#route(edge, Infinity);
      if (cells === undefined) {
        const blockers = this.#blockers(edge);
        const reason = "every path is blocked by nodes or too narrow for its stubs";
        this.#report(
          edge.ir,
          blockers.length === 0
            ? reason
            : `${reason} (in the way: ${blockers.map((key) => (this.#isCaption(key) ? `the caption of "${this.#id(key)}"` : `"${this.#id(key)}"`)).join(", ")})`,
          blockers,
        );
        continue;
      }
      const points = this.#points(edge, cells);
      // The stubs keep bends away from the ends, so a short segment at an
      // arrowhead can only be a straight route between ends closer than
      // the arrowhead is long: there is no room to draw it.
      const short = shortArrowEnd(edge.ir, edge.from, edge.to, points);
      if (short !== undefined) {
        this.#report(edge.ir, `the ends are closer than its arrowhead at the ${short} is long`);
        continue;
      }
      this.#occupy(cells, edge);
      routes.set(edge.ir.key, points);
    }
    return { layout: this.#result(routable, routes), diagnostics: this.#diagnostics };
  }

  /**
   * The room before an arrowhead at `end` (#116): `room`, or 0 (none) where
   * it would not fit, with the clearance to spare, inside a group that holds
   * both ends. There the route has no reason to leave the group, so keeping
   * the room would push it out across the border and back (a group's padding
   * is often just a stub and a radius wide); it turns where it did before.
   */
  #room(end: End, other: End, room: number, lane: number): number {
    if (end.dir < 0) return 0;
    const d = DIRS[end.dir] as Point;
    const p = end.port;
    const clipped = clipRoomAtJunction(end, other, room, lane);
    if (clipped !== room) return clipped;
    const holds = (r: Rect, q: Point) =>
      q.x >= r.x && q.x <= rightOf(r) && q.y >= r.y && q.y <= bottomOf(r);
    for (const { rect } of this.#layout.groups) {
      if (!holds(rect, p) || !holds(rect, other.port)) continue;
      const free =
        d.x > 0
          ? rightOf(rect) - p.x
          : d.x < 0
            ? p.x - rect.x
            : d.y > 0
              ? bottomOf(rect) - p.y
              : p.y - rect.y;
      if (free < room + ROUTE.clearance) return 0;
    }
    return room;
  }

  /**
   * An element's ID for messages; a caption (#130) is named by its group and
   * a part of a legend (#131) by the legend, as written.
   */
  #id(key: ElementKey): string {
    const element = this.#ir.elements.get(key);
    if (element?.kind === "node" && element.captionOf !== undefined) {
      return this.#id(element.captionOf);
    }
    if (element?.legend !== undefined) return element.legend.id;
    return element !== undefined && element.kind !== "edge" ? element.id : key;
  }

  #isCaption(key: ElementKey): boolean {
    const element = this.#ir.elements.get(key);
    return element?.kind === "node" && element.captionOf !== undefined;
  }

  /**
   * `layout/unaligned-ends` (warning, #169, design doc §6.40): the edge's
   * ends face each other out of line by at most `STRAIGHTEN_TOLERANCE`,
   * and `resolveEnds` could move neither onto the other's line (each shares
   * its point with another edge, or the line misses its side, or another
   * end is there). Such an offset is too small for a jog or an S that reads
   * as one (0.001 unit apart, an S has no column between the lines), so the
   * route jogs by a sliver or, in a gap shorter than the stubs, goes around
   * an end. Said rather than drawn silently.
   */
  #reportUnaligned(edge: Edge): void {
    const f = facing(edge.from, edge.to);
    if (f === undefined || !straightenable(f)) return;
    const ir = edge.ir;
    const source = this.#ir.sourceMap.get(ir.key);
    const name = ir.id === undefined ? `edges[${ir.index}]` : `"${ir.id}"`;
    const pt = Number((Math.abs(f.aside) / 2).toFixed(4));
    this.#diagnostics.push({
      code: "layout/unaligned-ends",
      severity: "warning",
      message: `The ends of edge ${name} from "${this.#id(ir.from)}" to "${this.#id(ir.to)}" face each other ${pt}pt out of line, and neither can be moved into line: each shares its point with another edge (or the other's line misses its side), so the line ${f.ahead >= edge.fromLane + edge.toLane ? "jogs by that much" : tightJog(edge.from, edge.to, edge.fromLane, edge.toLane) === undefined ? "goes around an end (the gap is shorter than its stubs, and the offset too small for an S between them)" : "takes an S that narrow (the gap is shorter than its stubs)"}.`,
      path: source?.path ?? ["edges", ir.index],
      ...(source?.location !== undefined && { location: source.location }),
      subject: { kind: "edge", id: ir.id ?? `edges[${ir.index}]` },
      hint: "Put both ends at the same position (equal anchor offsets on sides of equal length, or no anchors), or give one end a point of its own (another anchor offset) so it can be moved into line.",
    });
  }

  /**
   * `layout/straight-off-side` (warning, #179, design doc §6.47): an end
   * written `straight` that has no side facing the other end in line with
   * its centre (the two are apart diagonally or not at all, or the centre
   * is beyond the side's corner margin), so `resolveEnds` treated it as an
   * end without an anchor. Junction ends are left to
   * `component/anchor-on-junction`.
   */
  #reportStraightOffSide(
    edge: EdgeIR,
    ends: { from: End; to: End } | { error: string } | undefined,
  ): void {
    const rectOf = (key: ElementKey): Rect | undefined =>
      this.#layout.nodes.find((n) => n.key === key)?.rect ??
      this.#layout.groups.find((g) => g.key === key)?.rect;
    for (const field of ["fromAnchor", "toAnchor"] as const) {
      if (edge[field] !== "straight") continue;
      const leaving = field === "fromAnchor";
      const selfKey = leaving ? edge.from : edge.to;
      const otherKey = leaving ? edge.to : edge.from;
      const self = this.#ir.elements.get(selfKey);
      if (self?.kind === "node" && isJunction(self)) continue;
      const selfRect = rectOf(selfKey);
      const otherRect = rectOf(otherKey);
      if (selfRect === undefined || otherRect === undefined) continue;
      const at = straightPlacement(selfRect, otherRect);
      const me = `"${this.#id(selfKey)}"`;
      const them = `"${this.#id(otherKey)}"`;
      const name = edge.id === undefined ? `edges[${edge.index}]` : `"${edge.id}"`;
      const source = this.#ir.sourceMap.get(edge.key);
      if (!("off" in at)) {
        // Resolved, but not in line with the other end: the other end's
        // point is beyond this side's margin and the end, shared out with
        // parallel edges, kept a point of its own (or another rule moved it).
        if (ends === undefined || "error" in ends) continue;
        const f = facing(ends.from, ends.to);
        if (f !== undefined && f.aside === 0) continue;
        this.#diagnostics.push({
          code: "layout/straight-off-side",
          severity: "warning",
          message: `${field} "straight" of edge ${name} could not be put in line: the other end's point on ${them} is not over the ${at.side} side of ${me} (at least ${STRAIGHT_MARGIN / 2}pt inside its corners): parallel edges between the two keep separate points, or another edge's end moved it; so the edge ${leaving ? "leaves" : "enters"} ${me} at a point of its own and is not straight.`,
          path: [...(source?.path ?? ["edges", edge.index]), field],
          ...(source?.location !== undefined && { location: source.location }),
          subject: { kind: "edge", id: edge.id ?? `edges[${edge.index}]` },
          hint: `Write "straight" on the other end instead (the end at the wider element), widen ${me}, or anchor the parallel edges' ends yourself.`,
        });
        continue;
      }
      const reason =
        edge.from === edge.to
          ? `the edge is a self-loop, so no side of ${me} faces its other end`
          : at.off === "diagonal"
            ? `${me} and ${them} are apart diagonally, so no side of ${me} faces ${them} in line`
            : at.off === "overlap"
              ? `${me} and ${them} overlap or one holds the other, so no side of ${me} faces ${them}`
              : `the centre of ${them} is not in line with the ${at.side} side of ${me} (at least ${STRAIGHT_MARGIN / 2}pt inside its corners)`;
      this.#diagnostics.push({
        code: "layout/straight-off-side",
        severity: "warning",
        message: `${field} "straight" of edge ${name} has no effect: ${reason}; the edge ${leaving ? "leaves" : "enters"} ${me} as if it had no anchor.`,
        path: [...(source?.path ?? ["edges", edge.index]), field],
        ...(source?.location !== undefined && { location: source.location }),
        subject: { kind: "edge", id: edge.id ?? `edges[${edge.index}]` },
        hint:
          at.off === "beyond"
            ? `Bring ${them} over ${me} (the order or align of the arrange box, or figure.layout.align), widen ${me}, or write a side anchor instead (e.g. "${at.side}:0.5").`
            : `Put ${me} and ${them} in line (one above the other in a stack, or side by side in a row), or write a side anchor instead (e.g. "north:0.5").`,
      });
    }
  }

  /**
   * `blockers`: the nodes most likely in the way (#114), as `related`
   * locations; the hint explains `attach` if one of them is attached.
   */
  #report(edge: EdgeIR, reason: string, blockers: readonly ElementKey[] = []): void {
    const source = this.#ir.sourceMap.get(edge.key);
    const id = (key: ElementKey) => this.#id(key);
    const name = edge.id === undefined ? `edges[${edge.index}]` : `"${edge.id}"`;
    const related = blockers.map((key) => {
      const at = this.#ir.sourceMap.get(key);
      return {
        ...(at !== undefined && { path: at.path }),
        ...(at?.location !== undefined && { location: at.location }),
        message: this.#isCaption(key)
          ? `The caption of group "${id(key)}" is in the way.`
          : this.#ir.elements.get(key)?.legend !== undefined
            ? `Legend "${id(key)}" is in the way.`
            : `Node "${id(key)}" is in the way.`,
      };
    });
    const attached = blockers.flatMap((key) => {
      const element = this.#ir.elements.get(key);
      return element?.kind === "node" && element.attach !== undefined
        ? [`"${element.id}" is attached to "${id(element.attach.to)}"`]
        : [];
    });
    const attachHint =
      attached.length === 0
        ? ""
        : ` ${attached.join(", ")}: an attached node takes no space in the arrange tree, so attach it to another side, put it in the tree, or widen the gap it sits in.`;
    this.#diagnostics.push({
      code: "layout/no-route",
      severity: "error",
      message: `No route was found for edge ${name} from "${id(edge.from)}" to "${id(edge.to)}": ${reason}.`,
      path: source?.path ?? ["edges", edge.index],
      ...(source?.location !== undefined && { location: source.location }),
      subject: { kind: "edge", id: edge.id ?? `edges[${edge.index}]` },
      hint: `Leave room around the elements it connects (a gap of at least 2 × 3pt plus the arrowhead between facing sides), connect other sides with fromAnchor / toAnchor, or use a different anchor for each end.${attachHint}`,
      ...(related.length > 0 && { related }),
    });
  }

  /**
   * The nodes most likely blocking an edge without a route (#114), for the
   * message: those on the stubs of its ends (the straight run out of or into
   * a port, where no node may be), or else those in the box between the
   * stubs' ends (where a straight or L-shaped route would run), nearest to an
   * end first (ties in layout order). Junctions count: a route may not enter
   * one that is not its own end. At most three; the edge's own ends are left
   * out. It runs only when routing failed: a scan of the nodes and a sort of
   * the matches.
   */
  #blockers(edge: Edge): ElementKey[] {
    const own = new Set([edge.from.key, edge.to.key]);
    const others = this.#obstacles.filter((n) => !own.has(n.key));
    const tip = (end: End, lane: number): Point => {
      if (end.dir < 0) return end.port;
      const d = DIRS[end.dir] as Point;
      return { x: end.port.x + d.x * lane, y: end.port.y + d.y * lane };
    };
    const box = (a: Point, b: Point): Rect => ({
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      width: Math.abs(a.x - b.x),
      height: Math.abs(a.y - b.y),
    });
    /** Closed rectangles meet (touching counts: a route may not run along a node either). */
    const meets = (r: Rect, s: Rect) =>
      r.x <= rightOf(s) && s.x <= rightOf(r) && r.y <= bottomOf(s) && s.y <= bottomOf(r);
    const fromTip = tip(edge.from, edge.fromLane);
    const toTip = tip(edge.to, edge.toLane);
    const stubs = [box(edge.from.port, fromTip), box(edge.to.port, toTip)];
    let found = others.filter((n) => stubs.some((s) => meets(n.rect, s)));
    if (found.length === 0) {
      const between = box(fromTip, toTip);
      found = others.filter((n) => meets(n.rect, between));
    }
    const distance = (r: Rect, p: Point) =>
      Math.max(r.x - p.x, 0, p.x - rightOf(r)) + Math.max(r.y - p.y, 0, p.y - bottomOf(r));
    const nearest = (r: Rect) => Math.min(distance(r, fromTip), distance(r, toTip));
    return found
      .map((n, order) => ({ key: n.key, d: nearest(n.rect), order }))
      .sort((a, b) => a.d - b.d || a.order - b.order)
      .slice(0, 3)
      .map((n) => n.key);
  }

  // --- Nets --------------------------------------------------------------------

  /**
   * Union-find over edges: the same port (element, point and direction) used
   * the same way (all leaving it, or all entering it), or the same junction.
   * An edge entering a port and one leaving it are different nets (#113):
   * joined, `a → x` and `x → b` would share a trunk and read as `a → b`.
   * A junction is a shared point by definition, so the edges into and out of
   * it are one net.
   */
  #joinNets(edges: Edge[]): void {
    const parent = new Map<number, number>();
    const find = (a: number): number => {
      let root = a;
      while (parent.get(root) !== undefined && parent.get(root) !== root) {
        root = parent.get(root) as number;
      }
      // Path compression.
      for (let x = a; x !== root; ) {
        const next = parent.get(x) as number;
        parent.set(x, root);
        x = next;
      }
      return root;
    };
    const union = (a: number, b: number) => {
      const ra = find(a);
      const rb = find(b);
      // The smaller index (the earlier edge) is the root: deterministic.
      if (ra < rb) parent.set(rb, ra);
      else if (rb < ra) parent.set(ra, rb);
    };
    const terminals = new Map<string, number>();
    const terminal = (end: End, leaving: boolean) =>
      end.junction
        ? `j ${end.key}`
        : `p ${end.key} ${end.port.x} ${end.port.y} ${end.dir} ${leaving ? "out" : "in"}`;
    for (const edge of edges) {
      parent.set(edge.net, edge.net);
      for (const [end, leaving] of [
        [edge.from, true],
        [edge.to, false],
      ] as const) {
        const id = terminal(end, leaving);
        const first = terminals.get(id);
        if (first === undefined) terminals.set(id, edge.net);
        else union(first, edge.net);
      }
    }
    for (const edge of edges) edge.net = find(edge.net);

    // What each edge may share lines with: its ports (per direction) and
    // its junctions' group (junctions joined by edges between them).
    const group = new Map<ElementKey, ElementKey>();
    const root = (key: ElementKey): ElementKey => {
      let r = key;
      while ((group.get(r) ?? r) !== r) r = group.get(r) as ElementKey;
      return r;
    };
    for (const edge of edges) {
      if (!edge.from.junction || !edge.to.junction) continue;
      const a = root(edge.from.key);
      const b = root(edge.to.key);
      // The smaller key is the root: deterministic.
      if (a < b) group.set(b, a);
      else if (b < a) group.set(a, b);
    }
    const id = (terminal: string, net: number): number => {
      let index = this.#terminalIds.get(terminal);
      if (index === undefined) {
        index = this.#terminalIds.size;
        this.#terminalIds.set(terminal, index);
        this.#terminalNets.push(net);
      }
      return index;
    };
    for (const edge of edges) {
      if (!edge.from.junction) {
        edge.leaving = terminal(edge.from, true);
        edge.leavingId = id(edge.leaving, edge.net);
      }
      if (!edge.to.junction) {
        edge.entering = terminal(edge.to, false);
        edge.enteringId = id(edge.entering, edge.net);
      }
      const junction = edge.from.junction ? edge.from : edge.to.junction ? edge.to : undefined;
      if (junction !== undefined) edge.junctions = root(junction.key);
    }
  }

  // --- Grid --------------------------------------------------------------------

  #buildGrid(edges: Edge[]): void {
    const C = ROUTE.clearance;
    const layout = this.#layout;
    const nodeIR = new Map(this.#ir.nodes.map((n) => [n.key, n]));
    const solid: Rect[] = [];
    const junctions: NodeLayout[] = [];
    for (const node of layout.nodes) {
      if (isJunction(nodeIR.get(node.key))) junctions.push(node);
      else solid.push(node.rect);
    }
    this.#obstacles = layout.nodes.map((node) => ({ key: node.key, rect: node.rect }));
    const xs = new Set<number>();
    const ys = new Set<number>();
    const addRect = (r: Rect, inflate: number) => {
      xs.add(roundUnits(r.x - inflate)).add(roundUnits(rightOf(r) + inflate));
      ys.add(roundUnits(r.y - inflate)).add(roundUnits(bottomOf(r) + inflate));
    };
    for (const r of solid) {
      addRect(r, 0);
      addRect(r, C);
    }
    for (const group of layout.groups) {
      addRect(group.rect, 0);
      if (group.label !== undefined) addRect(group.label.box, 0);
    }
    for (const node of junctions) {
      const c = { x: node.rect.x + node.rect.width / 2, y: node.rect.y + node.rect.height / 2 };
      xs.add(roundUnits(c.x));
      ys.add(roundUnits(c.y));
    }
    const content = layout.content;
    addRect(content, 2 * C);
    // Midlines of the gutters between those lines (not between ports, which
    // would only make the grid denser).
    const withMidlines = (values: Set<number>) => {
      const sorted = sortedUnique(values);
      for (let i = 1; i < sorted.length; i++) {
        const a = sorted[i - 1] as number;
        const b = sorted[i] as number;
        if (b - a > 2) values.add(roundUnits((a + b) / 2));
      }
    };
    withMidlines(xs);
    withMidlines(ys);
    for (const edge of edges) {
      // The end of the stub, or of the room before an arrowhead (#116): one
      // line per end, as before, so the grid does not grow. Without the
      // line at the stub's end, a route that cannot keep the room turns at
      // the first line past the stub (with `#stubLines`, at the stub's end).
      for (const [end, lane, room] of [
        [edge.from, edge.fromLane, edge.fromRoom],
        [edge.to, edge.toLane, edge.toRoom],
      ] as const) {
        xs.add(end.port.x);
        ys.add(end.port.y);
        if (end.dir >= 0) {
          const d = DIRS[end.dir] as Point;
          for (const length of room === 0 ? [lane] : this.#stubLines ? [lane, room] : [room]) {
            xs.add(roundUnits(end.port.x + d.x * length));
            ys.add(roundUnits(end.port.y + d.y * length));
          }
        }
      }
      const jog = tightJog(edge.from, edge.to, edge.fromLane, edge.toLane);
      if (jog !== undefined) {
        for (const p of jog) {
          xs.add(p.x);
          ys.add(p.y);
        }
      }
    }
    const X = sortedUnique(xs);
    const Y = sortedUnique(ys);
    this.#X = X;
    this.#Y = Y;
    const NX = X.length;
    const NY = Y.length;
    const NP = NX * NY;
    this.#NX = NX;
    this.#NP = NP;

    const softH = new Uint8Array(NP);
    const softV = new Uint8Array(NP);
    const labelH = new Uint8Array(NP);
    const labelV = new Uint8Array(NP);
    const groupH = new Uint8Array(NP);
    const groupV = new Uint8Array(NP);
    this.#blockH = new Uint8Array(NP);
    this.#blockV = new Uint8Array(NP);

    /** Marks the steps whose midpoint lies in the closed rectangle. */
    const markClosed = (r: Rect, h: Uint8Array, v: Uint8Array) => {
      const i0 = lowerBound(X, r.x);
      const i1 = upperBound(X, rightOf(r)) - 1;
      const j0 = lowerBound(Y, r.y);
      const j1 = upperBound(Y, bottomOf(r)) - 1;
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i < i1; i++) h[j * NX + i] = 1;
      }
      for (let j = j0; j < j1; j++) {
        for (let i = i0; i <= i1; i++) v[j * NX + i] = 1;
      }
    };
    /** Marks the steps whose midpoint lies in the open rectangle `[x0, x1] × [y0, y1]`. */
    const markOpen = (x0: number, y0: number, x1: number, y1: number) => {
      const i0 = lowerBound(X, x0);
      const i1 = upperBound(X, x1) - 1;
      const j0 = lowerBound(Y, y0);
      const j1 = upperBound(Y, y1) - 1;
      const si0 = upperBound(X, x0);
      const si1 = lowerBound(X, x1) - 1;
      const sj0 = upperBound(Y, y0);
      const sj1 = lowerBound(Y, y1) - 1;
      for (let j = sj0; j <= sj1; j++) {
        for (let i = i0; i < i1; i++) softH[j * NX + i] = 1;
      }
      for (let j = j0; j < j1; j++) {
        for (let i = si0; i <= si1; i++) softV[j * NX + i] = 1;
      }
    };
    for (const r of solid) {
      markClosed(r, this.#blockH, this.#blockV);
      markOpen(
        roundUnits(r.x - C),
        roundUnits(r.y - C),
        roundUnits(rightOf(r) + C),
        roundUnits(bottomOf(r) + C),
      );
    }
    for (const group of layout.groups) {
      const g = group.rect;
      const ix0 = lowerBound(X, g.x);
      const ix1 = lowerBound(X, rightOf(g));
      const iy0 = lowerBound(Y, g.y);
      const iy1 = lowerBound(Y, bottomOf(g));
      // Running along the border: as costly as a node's clearance zone.
      for (const j of [iy0, iy1]) for (let i = ix0; i < ix1; i++) softH[j * NX + i] = 1;
      for (const i of [ix0, ix1]) for (let j = iy0; j < iy1; j++) softV[j * NX + i] = 1;
      // Crossing the border: the step between the border and the inside.
      for (let j = iy0 + 1; j < iy1; j++) {
        groupH[j * NX + ix0] = (groupH[j * NX + ix0] as number) + 1;
        groupH[j * NX + ix1 - 1] = (groupH[j * NX + ix1 - 1] as number) + 1;
      }
      for (let i = ix0 + 1; i < ix1; i++) {
        groupV[iy0 * NX + i] = (groupV[iy0 * NX + i] as number) + 1;
        groupV[(iy1 - 1) * NX + i] = (groupV[(iy1 - 1) * NX + i] as number) + 1;
      }
      if (group.label !== undefined) markClosed(group.label.box, labelH, labelV);
    }

    this.#junctionAt = new Int32Array(NP).fill(-1);
    this.#junctions = junctions.map((n) => n.key);
    for (const [index, node] of junctions.entries()) {
      const r = node.rect;
      const i0 = lowerBound(X, r.x);
      const i1 = upperBound(X, rightOf(r)) - 1;
      const j0 = lowerBound(Y, r.y);
      const j1 = upperBound(Y, bottomOf(r)) - 1;
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) this.#junctionAt[j * NX + i] = index;
      }
    }

    this.#costH = new Float64Array(NP);
    this.#costV = new Float64Array(NP);
    const cost = (length: number, soft: number, label: number, group: number) =>
      length * (soft ? 1 + ROUTE.clearanceCost : 1) +
      label * ROUTE.groupLabel +
      group * ROUTE.groupBorder;
    for (let j = 0; j < NY; j++) {
      for (let i = 0; i < NX; i++) {
        const p = j * NX + i;
        if (i + 1 < NX) {
          const length = (X[i + 1] as number) - (X[i] as number);
          this.#costH[p] = cost(
            length,
            softH[p] as number,
            labelH[p] as number,
            groupH[p] as number,
          );
        }
        if (j + 1 < NY) {
          const length = (Y[j + 1] as number) - (Y[j] as number);
          this.#costV[p] = cost(
            length,
            softV[p] as number,
            labelV[p] as number,
            groupV[p] as number,
          );
        }
      }
    }

    this.#stepsH = new Owners(NP);
    this.#stepsV = new Owners(NP);
    this.#pointsH = new Owners(NP);
    this.#pointsV = new Owners(NP);
    this.#dist = new Float64Array(NP * 4);
    this.#prev = new Int32Array(NP * 4);
    this.#stamp = new Int32Array(NP * 4);
    this.#laneFrom = new Int32Array(NP);
    this.#laneTo = new Int32Array(NP);

    this.#roomFrom = new Int32Array(NP);
    this.#roomTo = new Int32Array(NP);
    this.#arrowRooms = new Int32Array(NP).fill(-1);
    for (const edge of edges) {
      for (const [end, room, terminal] of [
        [edge.from, edge.fromRoom, edge.leavingId],
        [edge.to, edge.toRoom, edge.enteringId],
      ] as const) {
        if (room === 0 || terminal < 0) continue;
        for (const p of this.#stubInside(end, room)) {
          const first = this.#arrowRooms[p] as number;
          if (first === -1) this.#arrowRooms[p] = terminal;
          else if (first === -2) {
            const list = this.#arrowRoomsMulti.get(p) as number[];
            if (!list.includes(terminal)) list.push(terminal);
          } else if (first !== terminal) {
            this.#arrowRooms[p] = -2;
            this.#arrowRoomsMulti.set(p, [first, terminal]);
          }
        }
      }
    }
  }

  /**
   * `true` if `p` is in the room before an arrowhead at a port of the edge's
   * net that the edge does not use (#116): stepping there forks off or joins
   * the net's line right before that arrowhead. Other nets only pay the
   * crossing cost there, as before.
   */
  #inOthersArrowRoom(p: number, edge: Edge): boolean {
    const at = this.#arrowRooms[p] as number;
    const foreign = (terminal: number) =>
      terminal !== edge.leavingId &&
      terminal !== edge.enteringId &&
      this.#terminalNets[terminal] === edge.net;
    if (at >= 0) return foreign(at);
    return at === -2 && (this.#arrowRoomsMulti.get(p) as number[]).some(foreign);
  }

  #pointIndex(p: Point): number {
    const i = lowerBound(this.#X, p.x);
    const j = lowerBound(this.#Y, p.y);
    if (this.#X[i] !== p.x || this.#Y[j] !== p.y) {
      throw new Error(`internal error: ${p.x},${p.y} is not on the routing grid`);
    }
    return j * this.#NX + i;
  }

  /** The neighbour of `p` in `dir`, or -1 at the grid's border. */
  #neighbour(p: number, dir: number): number {
    const NX = this.#NX;
    const i = p % NX;
    switch (dir) {
      case 0:
        return i + 1 < NX ? p + 1 : -1;
      case 1:
        return p + NX < this.#NP ? p + NX : -1;
      case 2:
        return i > 0 ? p - 1 : -1;
      default:
        return p >= NX ? p - NX : -1;
    }
  }

  /** The grid points from an end's port along its direction, up to `lane` away (the stub). */
  #stub(end: End, lane: number): number[] {
    const points: number[] = [];
    if (end.dir < 0) return points;
    for (let p = this.#pointIndex(end.port); p >= 0; p = this.#neighbour(p, end.dir)) {
      const x = this.#X[p % this.#NX] as number;
      const y = this.#Y[Math.floor(p / this.#NX)] as number;
      if (Math.abs(x - end.port.x) + Math.abs(y - end.port.y) > lane + 1e-9) break;
      points.push(p);
    }
    return points;
  }

  /**
   * The grid points of an end's stub closer than `lane` to the port: a route
   * may only pass them straight along the stub. The point at `lane` (where it
   * may turn) need not be on the grid (#116).
   */
  #stubInside(end: End, lane: number): number[] {
    const X = this.#X;
    const Y = this.#Y;
    const NX = this.#NX;
    return this.#stub(end, lane).filter(
      (p) =>
        Math.abs((X[p % NX] as number) - end.port.x) +
          Math.abs((Y[Math.floor(p / NX)] as number) - end.port.y) <
        lane - 1e-9,
    );
  }

  /** Records the stubs of an edge before any search, so earlier routes keep off them. */
  #reserveStubs(edge: Edge): void {
    for (const [end, lane] of [
      [edge.from, edge.fromRoom || edge.fromLane],
      [edge.to, edge.toRoom || edge.toLane],
    ] as const) {
      const stub = this.#stub(end, lane);
      this.#occupy(stub, edge);
    }
  }

  /** Records the steps between consecutive points for the edge (and its net). */
  #occupy(cells: readonly number[], edge: Edge): void {
    const net = edge.net;
    for (const [k, p] of cells.entries()) {
      this.#edgeAt(this.#edgesAtPoint, p, edge.index);
      const q = cells[k + 1];
      if (q === undefined) continue;
      this.#edgeAt(Math.abs(p - q) === 1 ? this.#edgesH : this.#edgesV, Math.min(p, q), edge.index);
    }
    let points = this.#netPoints.get(net);
    if (points === undefined) {
      points = [];
      this.#netPoints.set(net, points);
    }
    for (const p of cells) points.push(p);
    for (let k = 1; k < cells.length; k++) {
      const a = cells[k - 1] as number;
      const b = cells[k] as number;
      const step = Math.min(a, b);
      if (Math.abs(a - b) === 1) {
        this.#stepsH.add(step, net);
        this.#pointsH.add(a, net);
        this.#pointsH.add(b, net);
      } else {
        this.#stepsV.add(step, net);
        this.#pointsV.add(a, net);
        this.#pointsV.add(b, net);
      }
    }
  }

  #edgeAt(map: Map<number, number[]>, index: number, edge: number): void {
    const list = map.get(index);
    if (list === undefined) map.set(index, [edge]);
    else if (!list.includes(edge)) list.push(edge);
  }

  /** Some edge recorded at `index` of `map` is in the edge's net but may not share lines with it. */
  #unsharable(map: Map<number, number[]>, index: number, edge: Edge): boolean {
    const list = map.get(index);
    if (list === undefined) return false;
    for (const other of list) {
      const o = this.#edges[other] as Edge;
      if (o.net === edge.net && !sharable(o, edge)) return true;
    }
    return false;
  }

  // --- Search ------------------------------------------------------------------

  /**
   * The cheapest route of `edge` as grid point indices from port to port,
   * or `undefined`. A* over (point, direction) with a lower bound that
   * stays admissible although steps on the edge's own net cost nothing:
   * a path either uses no shared step outside the target's stub, and then
   * costs at least its Manhattan distance to the target minus the stub,
   * or it leaves the net last at some net point `q`, and then costs at
   * least `|q t|` minus the stub. So
   * `h(p) = max(0, min(|p t|, min_q |q t|) − stub)`, `q` over the net's
   * points outside the target's stub, and the stub points the net reaches
   * from outside it (where a shared trunk joins the stub, `q` is the last
   * point the route leaves a non-stub shared step at). Every other step
   * costs at least its length, so the bound never overestimates and the
   * first time the goal is taken from the heap its route is the cheapest
   * (the same cost as a plain Dijkstra; among routes of equal cost the
   * pop order picks one deterministically).
   */
  #search(edge: Edge, margin: number): number[] | undefined {
    const generation = ++this.#generation;
    const { from, to, net } = edge;
    const fromLane = edge.fromLane;
    const toLane = edge.toLane;
    const arrowRooms = this.#arrowRooms;
    const roomFrom = this.#roomFrom;
    const roomTo = this.#roomTo;
    const dist = this.#dist;
    const prev = this.#prev;
    const stamp = this.#stamp;
    const laneFrom = this.#laneFrom;
    const laneTo = this.#laneTo;
    const X = this.#X;
    const Y = this.#Y;
    const NX = this.#NX;
    // The stubs as reserved (up to the room before an arrowhead, #116): free
    // for the edge. Their points closer than the lane may only be passed
    // straight along the stub.
    const fromStub = this.#stub(from, edge.fromRoom || fromLane);
    for (const p of this.#stubInside(from, fromLane)) laneFrom[p] = generation;
    const toStub = this.#stub(to, edge.toRoom || toLane);
    for (const p of this.#stubInside(to, toLane)) laneTo[p] = generation;
    // Turning out of / into the stub before the room's end costs (#116).
    for (const p of this.#stubInside(from, edge.fromRoom)) roomFrom[p] = generation;
    for (const p of this.#stubInside(to, edge.toRoom)) roomTo[p] = generation;
    const outDir = from.dir;
    const inDir = to.dir < 0 ? -1 : opposite(to.dir);
    const s = this.#pointIndex(from.port);
    const t = this.#pointIndex(to.port);
    // The corridor, as grid index ranges (rows as offsets `j × NX`).
    const ends = [s, t, ...fromStub, ...toStub];
    const xs = ends.map((p) => X[p % NX] as number);
    const ys = ends.map((p) => Y[(p / NX) | 0] as number);
    const i0 = lowerBound(X, Math.min(...xs) - margin);
    const i1 = upperBound(X, Math.max(...xs) + margin) - 1;
    const j0 = lowerBound(Y, Math.min(...ys) - margin) * NX;
    const j1 = (upperBound(Y, Math.max(...ys) + margin) - 1) * NX;
    const fromJunction = this.#junctions.indexOf(from.key);
    const toJunction = this.#junctions.indexOf(to.key);

    // The lower bound (see above).
    const tx = to.port.x;
    const ty = to.port.y;
    const targetStub = to.dir < 0 ? 0 : edge.toRoom || toLane;
    // The target stub's own points are left out (the bound subtracts the
    // stub), unless the net also reaches one from outside the stub (a shared
    // trunk into the same target): then the route may run on the net all the
    // way to the target.
    const inTargetStub = new Set(toStub);
    const reachedFromOutside = (q: number) => {
      for (let nd = 0; nd < 4; nd++) {
        const r = this.#neighbour(q, nd);
        if (r < 0 || inTargetStub.has(r)) continue;
        if ((nd % 2 === 0 ? this.#stepsH : this.#stepsV).has(Math.min(q, r), net)) return true;
      }
      return false;
    };
    let nearest = Number.POSITIVE_INFINITY;
    for (const q of this.#netPoints.get(net) ?? []) {
      if (inTargetStub.has(q) && !(this.#lowerBound && reachedFromOutside(q))) continue;
      const d = Math.abs((X[q % NX] as number) - tx) + Math.abs((Y[(q / NX) | 0] as number) - ty);
      if (d < nearest) nearest = d;
    }
    if (!this.#lowerBound) nearest = Number.NEGATIVE_INFINITY;
    const bound = (p: number): number => {
      const d = Math.abs((X[p % NX] as number) - tx) + Math.abs((Y[(p / NX) | 0] as number) - ty);
      const h = (d < nearest ? d : nearest) - targetStub;
      return h > 0 ? h : 0;
    };

    const heap = this.#heap;
    heap.clear();
    const seed = (state: number) => {
      stamp[state] = generation;
      dist[state] = 0;
      prev[state] = -1;
      heap.push(bound(s), state);
    };
    if (outDir < 0) for (let d = 0; d < 4; d++) seed(s * 4 + d);
    else seed(s * 4 + outDir);

    const stepsH = this.#stepsH;
    const stepsV = this.#stepsV;
    const pointsH = this.#pointsH;
    const pointsV = this.#pointsV;
    const blockH = this.#blockH;
    const blockV = this.#blockV;
    const costH = this.#costH;
    const costV = this.#costV;
    const junctionAt = this.#junctionAt;
    const edgesH = this.#edgesH;
    const edgesV = this.#edgesV;
    const edgesAtPoint = this.#edgesAtPoint;
    const { bend, overlap, cross, arrowRoom } = ROUTE;
    const ownerH = stepsH.first;
    const ownerV = stepsV.first;
    const atH = pointsH.first;
    const atV = pointsV.first;
    let goal = -1;
    while (heap.size > 0) {
      const state = heap.pop();
      const p = state >> 2;
      const g = dist[state] as number;
      // A stale entry: the state was reached more cheaply since.
      if (heap.key > g + bound(p)) continue;
      const dir = state & 3;
      if (p === t) {
        if (inDir < 0 || dir === inDir) {
          goal = state;
          break;
        }
        // A route ends at its target; it never passes through it.
        continue;
      }
      const i = p % NX;
      const row = p - i;
      for (let nd = 0; nd < 4; nd++) {
        if (nd === ((dir + 2) & 3)) continue;
        if (laneFrom[p] === generation && nd !== outDir) continue;
        if (laneTo[p] === generation && nd !== inDir) continue;
        const q =
          nd === 0
            ? i < i1
              ? p + 1
              : -1
            : nd === 1
              ? row < j1
                ? p + NX
                : -1
              : nd === 2
                ? i > i0
                  ? p - 1
                  : -1
                : row > j0
                  ? p - NX
                  : -1;
        if (q < 0) continue;
        if (laneTo[q] === generation && nd !== inDir) continue;
        const horizontal = (nd & 1) === 0;
        const step = p < q ? p : q;
        if ((horizontal ? blockH : blockV)[step] === 1) continue;
        const junction = junctionAt[q] as number;
        if (junction >= 0 && junction !== fromJunction && junction !== toJunction) continue;
        // The owners' fast path: -1 none, a net, or -2 several (then ask).
        const steps = horizontal ? stepsH : stepsV;
        const owner = (horizontal ? ownerH : ownerV)[step] as number;
        let cost: number;
        // A step of the edge's own net is free, unless an edge on it may not
        // share lines with this one (#113): then it is an overlap.
        const own = owner === net || (owner === -2 && steps.has(step, net));
        if (own && !this.#unsharable(horizontal ? edgesH : edgesV, step, edge)) {
          // Free, but arriving where an edge of the net that may not share
          // lines with this one runs is still a crossing or a touch.
          cost = this.#unsharable(edgesAtPoint, q, edge) ? cross : 0;
        } else {
          cost = (horizontal ? costH : costV)[step] as number;
          if (nd !== dir) cost += bend;
          if (own || (owner !== -1 && (owner !== -2 || steps.other(step, net)))) cost += overlap;
          // Arriving at a point where another net (or an edge of this one
          // that may not share lines with it) runs across (a crossing) or
          // ends along this line (a touch).
          const v = atV[q] as number;
          const h = atH[q] as number;
          if (
            (v !== -1 && v !== net && (v !== -2 || pointsV.other(q, net))) ||
            (h !== -1 && h !== net && (h !== -2 || pointsH.other(q, net))) ||
            ((v === net || h === net || v === -2 || h === -2) &&
              this.#unsharable(edgesAtPoint, q, edge))
          ) {
            cost += cross;
          }
        }
        // Turning into or out of the room before an arrowhead, even onto the
        // edge's own stub (which is free), and forking off or joining another
        // edge of the net in the room before its arrowhead (#116).
        if (
          (nd !== dir &&
            ((roomTo[p] === generation && nd === inDir) ||
              (roomFrom[p] === generation && dir === outDir))) ||
          (arrowRooms[q] !== -1 && this.#inOthersArrowRoom(q, edge))
        ) {
          cost += arrowRoom;
        }
        const next = q * 4 + nd;
        const total = g + cost;
        if (stamp[next] !== generation || total < (dist[next] as number)) {
          stamp[next] = generation;
          dist[next] = total;
          prev[next] = state;
          heap.push(total + bound(q), next);
        }
      }
    }
    if (goal < 0) return undefined;
    this.#lastCost = dist[goal] as number;
    const cells: number[] = [];
    for (let state = goal; state >= 0; state = prev[state] as number) {
      const p = state >> 2;
      if (cells[cells.length - 1] !== p) cells.push(p);
    }
    cells.reverse();
    return withoutLoops(cells);
  }

  /** The drawn points of a route: outline → port → grid points → port → outline, simplified. */
  #points(edge: Edge, cells: readonly number[]): Point[] {
    const NX = this.#NX;
    const grid = cells.map((p) => ({
      x: this.#X[p % NX] as number,
      y: this.#Y[Math.floor(p / NX)] as number,
    }));
    return simplify([edge.from.outline, ...grid, edge.to.outline]);
  }

  // --- Result ------------------------------------------------------------------

  #result(edges: Edge[], routes: Map<ElementKey, Point[]>): LayoutIR {
    const layout = this.#layout;
    // Nets in the order of their first routed edge.
    const netIds = new Map<number, number>();
    const members: ElementKey[][] = [];
    const netOf = new Map<ElementKey, number>();
    for (const edge of edges) {
      if (!routes.has(edge.ir.key)) continue;
      let id = netIds.get(edge.net);
      if (id === undefined) {
        id = members.length;
        netIds.set(edge.net, id);
        members.push([]);
      }
      (members[id] as ElementKey[]).push(edge.ir.key);
      netOf.set(edge.ir.key, id);
    }
    const byKey = new Map(edges.map((e) => [e.ir.key, e]));
    const irEdges = new Map(this.#ir.edges.map((e) => [e.key, e]));
    const labels = new Map<ElementKey, TextLayout>();
    const nodeBoxes = layout.nodes.map((node) => node.rect);
    // Groups drawn with a border (as `geometry/label-collision` checks them).
    const groupBoxes = layout.groups.flatMap((group) => {
      const element = this.#ir.elements.get(group.key);
      const style = element?.kind === "group" ? element.style : undefined;
      return style === undefined || style.strokeWidth.units === 0 || style.stroke === "transparent"
        ? []
        : [group.rect];
    });
    // Labels in two passes (#128): the default placements first (they look at
    // routes, nodes and borders only, so they are as before), then the
    // `labelAt` / `labelSide` ones in document order, which also keep clear
    // of group titles, every label placed before them and every arrowhead.
    const labelBoxes = layout.groups.flatMap((group) =>
      group.label === undefined ? [] : [group.label.box],
    );
    const heads = new Map<ElementKey, Rect[]>();
    for (const [key, points] of routes) {
      const edge = irEdges.get(key);
      if (edge === undefined) continue;
      heads.set(key, arrowheadRects(points, edge, arrowheadLength(edge.style.strokeWidth.units)));
    }
    for (const requested of [false, true]) {
      for (const e of layout.edges) {
        const points = routes.get(e.key);
        const edge = irEdges.get(e.key);
        if (points === undefined || edge === undefined || e.labelMetrics === undefined) continue;
        if (hasRequestedLabel(edge) !== requested) continue;
        const arrow = arrowheadLength(edge.style.strokeWidth.units);
        const others = [...routes].flatMap(([key, route]) => (key === e.key ? [] : [route]));
        const label = placeEdgeLabel(e.labelMetrics, points, edge, arrow, {
          routes: others,
          nodes: nodeBoxes,
          groups: groupBoxes,
          ...(requested && {
            labels: [...labelBoxes],
            arrowheads: [...heads].flatMap(([key, rects]) => (key === e.key ? [] : rects)),
          }),
        });
        labels.set(e.key, label);
        labelBoxes.push(label.box);
      }
    }

    // Grow the content to hold the routes and edge labels; keep it at the margin.
    let minX = layout.content.x;
    let minY = layout.content.y;
    let maxX = rightOf(layout.content);
    let maxY = bottomOf(layout.content);
    const extend = (r: Rect) => {
      minX = Math.min(minX, r.x);
      minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x + r.width);
      maxY = Math.max(maxY, r.y + r.height);
    };
    for (const points of routes.values()) {
      for (const p of points) extend({ ...p, width: 0, height: 0 });
    }
    for (const label of labels.values()) extend(label.box);
    const m = layout.margin;
    const dx = m - minX;
    const dy = m - minY;
    const moved = dx !== 0 || dy !== 0;
    const point = (p: Point): Point =>
      moved ? { x: roundUnits(p.x + dx), y: roundUnits(p.y + dy) } : { x: p.x, y: p.y };
    const rect = (r: Rect): Rect => (moved ? roundRect({ ...r, x: r.x + dx, y: r.y + dy }) : r);
    const text = (t: TextLayout): TextLayout =>
      moved ? { ...t, box: rect(t.box), anchor: point(t.anchor) } : t;
    const placedLabel = (key: ElementKey) => {
      const label = labels.get(key);
      if (label === undefined) return undefined;
      return text({
        ...label,
        box: roundRect(label.box),
        anchor: { x: roundUnits(label.anchor.x), y: roundUnits(label.anchor.y) },
      });
    };

    const nodes: NodeLayout[] = layout.nodes.map((n) => ({
      ...n,
      rect: rect(n.rect),
      ...(n.label !== undefined && { label: text(n.label) }),
      ...(n.sublabel !== undefined && { sublabel: text(n.sublabel) }),
    }));
    const groups: GroupLayout[] = layout.groups.map((g) => ({
      ...g,
      rect: rect(g.rect),
      content: rect(g.content),
      ...(g.label !== undefined && { label: text(g.label) }),
    }));
    const routed: EdgeLayout[] = layout.edges.map((e) => {
      const points = routes.get(e.key);
      const edge = byKey.get(e.key);
      if (points === undefined || edge === undefined) return e;
      const label = placedLabel(e.key);
      const route: EdgeRoute = {
        points: points.map(point),
        ...(label !== undefined && { label }),
        net: netOf.get(e.key) as number,
        ...(edge.from.side !== undefined && { fromSide: edge.from.side }),
        ...(edge.to.side !== undefined && { toSide: edge.to.side }),
      };
      return { ...e, route };
    });
    const routeOf = new Map(routed.map((e) => [e.key, e.route]));
    const nets: RouteNet[] = members.map((keys, id) => ({
      id,
      edges: keys,
      segments: mergeSegments(keys.map((key) => (routeOf.get(key) as EdgeRoute).points)),
    }));
    const content = roundRect({ x: m, y: m, width: maxX - minX, height: maxY - minY });
    return deepFreeze({
      ...layout,
      canvas: {
        width: Math.max(
          moved ? 0 : layout.canvas.width,
          Math.ceil(roundUnits(maxX - minX) + 2 * m),
        ),
        height: Math.max(
          moved ? 0 : layout.canvas.height,
          Math.ceil(roundUnits(maxY - minY) + 2 * m),
        ),
      },
      content,
      groups,
      nodes,
      edges: routed,
      nets,
    });
  }
}

/**
 * The room before an arrowhead at `end` (`room` long, after a stub `lane`
 * long), cut at a junction straight ahead at the edge's other end (#153,
 * design doc §6.37). The route is then the straight line to the junction,
 * and a room past it would reach beyond the edge's own end, where the
 * other edges of the junction's net run: they would pay `ROUTE.arrowRoom`
 * at every grid point of it, and detour into the junction from the side.
 * So the room ends at the junction, or there is none if that is shorter
 * than the stub. A junction aside or behind, a port, and a junction at or
 * beyond the room's end leave `room` as it is.
 */
export function clipRoomAtJunction(end: End, other: End, room: number, lane: number): number {
  if (end.dir < 0 || !other.junction) return room;
  const d = DIRS[end.dir] as Point;
  const dx = other.port.x - end.port.x;
  const dy = other.port.y - end.port.y;
  const ahead = dx * d.x + dy * d.y;
  const aside = dx * d.y - dy * d.x;
  if (Math.abs(aside) >= 1e-9 || ahead <= 0 || ahead >= room) return room;
  return ahead >= lane ? ahead : 0;
}

/**
 * The grid points a jog needs between facing ends that are closer than
 * their stubs (#169, design doc §6.40), or `undefined` if the ends do not
 * face each other out of line, or a plain jog fits.
 *
 * Two ports on facing sides, out of line, are joined by a jog: straight
 * out of one, across, straight into the other. Its crossing row must be at
 * least the source's lane from the source and the target's lane from the
 * target (the stubs: the clearance, and the arrowhead's length at an
 * arrowhead), so where the gap is shorter than the two lanes there is no
 * such row. The shortest route left runs past the row at the source lane's
 * end, back to the row at the target lane's end and in: an S whose middle
 * runs backwards along a column strictly between the two ports' lines (on
 * either side of them, one leg would cross the other end's lane, where a
 * route may not turn or cross). The grid has no such column when the ends
 * are close (a gutter gets a midline only if it is wider than 2 units, and
 * the ports' lines get none), and then the only routes left go around a
 * node: the loop of #169. Ends out of line by at most
 * `STRAIGHTEN_TOLERANCE` are straightened before routing (`resolveEnds`)
 * where one of them can move; for the others, this returns the column
 * midway between the ports' lines at the rows of the lanes' ends, which
 * the grid adds (only for such edges, so other figures keep their grid).
 * `undefined` too if no column lies strictly between the lines at 1/1000
 * unit (ends 0.001 apart that could not be moved; `#reportUnaligned`).
 */
export function tightJog(
  from: End,
  to: End,
  fromLane: number,
  toLane: number,
): [Point, Point] | undefined {
  if (from.dir < 0 || to.dir < 0) return undefined;
  const f = facing(from, to);
  if (f === undefined || f.aside === 0 || f.ahead >= fromLane + toLane) return undefined;
  const d = DIRS[f.dir] as Point;
  const column =
    d.x === 0
      ? roundUnits((from.port.x + to.port.x) / 2)
      : roundUnits((from.port.y + to.port.y) / 2);
  // Ends left out of line by a sliver (both shared, so not straightened;
  // `#reportUnaligned` warns): the column must lie strictly between the
  // lines after rounding to 1/1000 unit. Ends 0.001 apart have none (the
  // midpoint rounds onto a port's line), and the route goes around an end.
  const a = d.x === 0 ? from.port.x : from.port.y;
  const b = d.x === 0 ? to.port.x : to.port.y;
  if (Math.min(Math.abs(column - a), Math.abs(b - column)) < 1e-9) return undefined;
  const out = { x: from.port.x + d.x * fromLane, y: from.port.y + d.y * fromLane };
  const back = { x: to.port.x - d.x * toLane, y: to.port.y - d.y * toLane };
  return d.x === 0
    ? [
        { x: column, y: roundUnits(out.y) },
        { x: column, y: roundUnits(back.y) },
      ]
    : [
        { x: roundUnits(out.x), y: column },
        { x: roundUnits(back.x), y: column },
      ];
}

/**
 * The end (`source` / `target`) whose arrowhead is longer than the route's
 * segment there, if any. Junction ends are not checked (they have no stub;
 * design doc §6.22).
 */
export function shortArrowEnd(
  edge: EdgeIR,
  from: End,
  to: End,
  points: readonly Point[],
): "source" | "target" | undefined {
  const arrow = arrowheadLength(edge.style.strokeWidth.units);
  const length = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  const n = points.length;
  if (
    edge.sourceArrowhead !== undefined &&
    !from.junction &&
    length(points[0] as Point, points[1] as Point) < arrow - 1e-9
  ) {
    return "source";
  }
  if (
    edge.targetArrowhead !== undefined &&
    !to.junction &&
    length(points[n - 2] as Point, points[n - 1] as Point) < arrow - 1e-9
  ) {
    return "target";
  }
  return undefined;
}

/** Cuts out loops (a point visited twice) from a path of grid points. */
function withoutLoops(cells: number[]): number[] {
  const out: number[] = [];
  const at = new Map<number, number>();
  for (const p of cells) {
    const seen = at.get(p);
    if (seen !== undefined) {
      for (const removed of out.splice(seen + 1)) at.delete(removed);
      continue;
    }
    at.set(p, out.length);
    out.push(p);
  }
  return out;
}

/** Drops repeated points and interior points on a straight line. */
export function simplify(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last !== undefined && last.x === p.x && last.y === p.y) continue;
    out.push(p);
    while (out.length >= 3) {
      const a = out[out.length - 3] as Point;
      const b = out[out.length - 2] as Point;
      const c = out[out.length - 1] as Point;
      const collinear = (a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y);
      if (!collinear) break;
      out.splice(out.length - 2, 1);
    }
  }
  return out;
}

/**
 * The union of polylines as maximal axis-parallel segments: horizontal ones
 * by y then x, then vertical ones by x then y, each from its smaller end.
 */
export function mergeSegments(lines: readonly (readonly Point[])[]): [Point, Point][] {
  const horizontal = new Map<number, [number, number][]>();
  const vertical = new Map<number, [number, number][]>();
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1] as Point;
      const b = line[i] as Point;
      if (a.y === b.y) {
        const list = horizontal.get(a.y) ?? [];
        list.push([Math.min(a.x, b.x), Math.max(a.x, b.x)]);
        horizontal.set(a.y, list);
      } else {
        const list = vertical.get(a.x) ?? [];
        list.push([Math.min(a.y, b.y), Math.max(a.y, b.y)]);
        vertical.set(a.x, list);
      }
    }
  }
  const merged = (intervals: [number, number][]): [number, number][] => {
    const sorted = [...intervals].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    const out: [number, number][] = [];
    for (const [lo, hi] of sorted) {
      const last = out[out.length - 1];
      if (last !== undefined && lo <= last[1]) last[1] = Math.max(last[1], hi);
      else out.push([lo, hi]);
    }
    return out;
  };
  const out: [Point, Point][] = [];
  for (const y of [...horizontal.keys()].sort((a, b) => a - b)) {
    for (const [lo, hi] of merged(horizontal.get(y) as [number, number][])) {
      out.push([
        { x: lo, y },
        { x: hi, y },
      ]);
    }
  }
  for (const x of [...vertical.keys()].sort((a, b) => a - b)) {
    for (const [lo, hi] of merged(vertical.get(x) as [number, number][])) {
      out.push([
        { x, y: lo },
        { x, y: hi },
      ]);
    }
  }
  return out;
}
