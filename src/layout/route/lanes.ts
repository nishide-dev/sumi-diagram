/**
 * Edge lanes (#609, design record `docs/design/decisions/609-edge-lanes.md`):
 * `edges[].lane` puts the long segment of a loop, skip or bus on a chosen
 * side, a set distance beyond the ends (or beyond the frame of `outside`).
 *
 * The plan here is pure geometry on the placed layout, shared by the end
 * resolution (`resolveEnds` puts each end on the side facing the lane) and the
 * router (which draws the route on the lane, or reports why it cannot):
 *
 * - **The lane line**: `offset` beyond the farthest face on `side` of the
 *   reference boxes: both ends, or the element named by `outside` (a group's
 *   frame, with its title where that sits outside the frame on that side).
 * - **Buses**: lanes on one side whose edges share a source (or a target),
 *   transitively, are one lane, the farthest of theirs: one trunk.
 * - **Ends**: an end whose face on `side` lies short of the lane attaches on
 *   `side`; an end wholly beyond the lane attaches on the opposite side (it
 *   faces the lane); a junction reaches it from its centre. An end the lane
 *   runs through, a written anchor on another side, a `straight` anchor, an
 *   end that holds the other, and a zoom edge are problems: the router draws
 *   the edge as without a lane and says why (`layout/lane-blocked`).
 */

import type { EdgeIR, FigureIR } from "../../compiler/ir";
import type { ElementKey } from "../../core/check-state";
import type { Diagnostic } from "../../core/diagnostics";
import type { Side } from "../../core/figure/schema";
import { type LayoutIR, type Rect, roundUnits } from "../ir";
import { arrowheadLength, WIRE_CORNER_RADIUS } from "./arrowhead";
import { endpointRects, makeInside } from "./endpoint-rects";

/** The lane's distance beyond the faces when `offset` is omitted: 6pt (units). */
export const DEFAULT_LANE_OFFSET = 12;

export interface LanePlan {
  readonly edge: ElementKey;
  readonly side: Side;
  /** The coordinate the lane fixes: `x` for a vertical lane (east / west), `y` for a horizontal one. */
  readonly axis: "x" | "y";
  /** The lane line's coordinate, rounded to 1/1000 unit. */
  readonly at: number;
  /** The side each end attaches on; omitted at a junction. */
  readonly from?: Side;
  readonly to?: Side;
  /** The edges sharing this lane (a bus), this one included, in document order. */
  readonly bus: readonly ElementKey[];
  /** Why the lane cannot be drawn, and the elements involved. */
  readonly problem?: { readonly reason: string; readonly related: readonly ElementKey[] };
}

const OPPOSITE: Readonly<Record<Side, Side>> = {
  north: "south",
  south: "north",
  east: "west",
  west: "east",
};

/** -1 for the sides toward smaller coordinates (west, north), +1 otherwise. */
const signOf = (side: Side): 1 | -1 => (side === "west" || side === "north" ? -1 : 1);

/** The coordinate of `rect`'s face on `side`. */
export function faceOf(rect: Rect, side: Side): number {
  switch (side) {
    case "west":
      return rect.x;
    case "east":
      return roundUnits(rect.x + rect.width);
    case "north":
      return rect.y;
    case "south":
      return roundUnits(rect.y + rect.height);
  }
}

/** Whether the edge asks for a lane. */
export const isLaneEdge = (edge: EdgeIR): boolean => edge.lane !== undefined;

/** The default offset of an edge: 6pt, or its arrowhead and a corner where that is longer. */
function defaultOffset(edge: EdgeIR): number {
  const arrow =
    edge.sourceArrowhead !== undefined || edge.targetArrowhead !== undefined
      ? arrowheadLength(edge.style.strokeWidth.units, edge.style.arrowheadScale) +
        WIRE_CORNER_RADIUS
      : 0;
  return Math.max(DEFAULT_LANE_OFFSET, arrow);
}

/** The lane plans of a layout's lane edges, by edge key (empty without lanes). */
export function planLanes(ir: FigureIR, layout: LayoutIR): ReadonlyMap<ElementKey, LanePlan> {
  const edges = ir.edges.filter(isLaneEdge);
  if (edges.length === 0) return new Map();
  const rects = endpointRects(ir, layout);
  const parents = new Map<ElementKey, ElementKey | undefined>(
    [...layout.nodes, ...layout.groups].map((e) => [e.key, e.parent] as const),
  );
  const tokenFrames = new Set(ir.groups.filter((g) => g.tokens !== undefined).map((g) => g.key));
  const inside = makeInside(rects, parents, tokenFrames);
  const groupLabels = new Map(
    layout.groups.flatMap((g) => (g.label === undefined ? [] : [[g.key, g.label.box] as const])),
  );
  const nodes = new Map(ir.nodes.map((n) => [n.key, n]));
  const junction = (key: ElementKey) => nodes.get(key)?.mark?.type === "point";
  const name = (key: ElementKey): string => {
    const element = ir.elements.get(key);
    return element !== undefined && element.kind !== "edge" ? element.id : key;
  };

  // The lane each edge asks for on its own: the farthest reference face plus the offset.
  const own = new Map<ElementKey, number>();
  for (const edge of edges) {
    const lane = edge.lane as NonNullable<EdgeIR["lane"]>;
    const sign = signOf(lane.side);
    const reference: Rect[] = [];
    if (lane.outside !== undefined) {
      const frame = rects.get(lane.outside);
      if (frame !== undefined) reference.push(frame);
      // A title outside the frame on the lane's side (above-left, #517) counts as the frame's.
      const title = groupLabels.get(lane.outside);
      if (
        title !== undefined &&
        frame !== undefined &&
        sign * (faceOf(title, lane.side) - faceOf(frame, lane.side)) > 0
      )
        reference.push(title);
    } else {
      for (const key of [edge.from, edge.to]) {
        const rect = rects.get(key);
        if (rect !== undefined) reference.push(rect);
      }
    }
    if (reference.length === 0) continue;
    const far = Math.max(...reference.map((r) => sign * faceOf(r, lane.side)));
    own.set(edge.key, sign * (far + (lane.offset ?? defaultOffset(edge))));
  }

  // Buses: lanes on one side whose edges share a source or a target (transitively).
  const parent = new Map<ElementKey, ElementKey>(edges.map((e) => [e.key, e.key]));
  const find = (key: ElementKey): ElementKey => {
    let root = key;
    while (parent.get(root) !== root) root = parent.get(root) as ElementKey;
    return root;
  };
  const firstAt = new Map<string, ElementKey>();
  for (const edge of edges) {
    if (!own.has(edge.key)) continue;
    const side = (edge.lane as NonNullable<EdgeIR["lane"]>).side;
    for (const end of [`from ${edge.from}`, `to ${edge.to}`]) {
      const id = `${side} ${end}`;
      const first = firstAt.get(id);
      if (first === undefined) firstAt.set(id, edge.key);
      else {
        const [a, b] = [find(first), find(edge.key)];
        if (a !== b) parent.set(b, a);
      }
    }
  }
  const members = new Map<ElementKey, ElementKey[]>();
  for (const edge of edges) {
    if (!own.has(edge.key)) continue;
    const root = find(edge.key);
    const list = members.get(root) ?? [];
    list.push(edge.key);
    members.set(root, list);
  }

  const plans = new Map<ElementKey, LanePlan>();
  for (const edge of edges) {
    const lane = edge.lane as NonNullable<EdgeIR["lane"]>;
    const mine = own.get(edge.key);
    if (mine === undefined) continue;
    const sign = signOf(lane.side);
    const bus = members.get(find(edge.key)) ?? [edge.key];
    const at = roundUnits(sign * Math.max(...bus.map((key) => sign * (own.get(key) as number))));
    const axis = lane.side === "east" || lane.side === "west" ? "x" : "y";
    let problem: LanePlan["problem"];
    const fail = (reason: string, related: ElementKey[] = []) => {
      problem ??= { reason, related };
    };
    if (edge.routing === "zoom") fail("a zoom edge is drawn as straight lines between corners");
    if (inside(edge.from, edge.to) || inside(edge.to, edge.from))
      fail(
        `"${name(inside(edge.from, edge.to) ? edge.to : edge.from)}" holds the other end, so the route stays inside it`,
      );
    const attach = (key: ElementKey, written: EdgeIR["fromAnchor"], field: string) => {
      if (junction(key)) return undefined;
      const rect = rects.get(key);
      if (rect === undefined) return undefined;
      // Short of the lane: the lane's side; wholly beyond it: the side facing it.
      const side =
        sign * (faceOf(rect, lane.side) - at) < 0
          ? lane.side
          : sign * (faceOf(rect, OPPOSITE[lane.side]) - at) > 0
            ? OPPOSITE[lane.side]
            : undefined;
      if (side === undefined) {
        fail(
          `the lane runs through "${name(key)}"${lane.outside === undefined ? "" : ` (it sticks out of "${name(lane.outside)}" on the ${lane.side} side)`}`,
          [key],
        );
        return undefined;
      }
      if (written === "straight")
        fail(`${field} "straight" puts the end in line with the other end, not on the lane`, [key]);
      else if (written !== undefined && written.side !== side)
        fail(
          `${field} is on the ${written.side} side of "${name(key)}", but the lane needs its ${side} side`,
          [key],
        );
      return side;
    };
    const from = attach(edge.from, edge.fromAnchor, "fromAnchor");
    const to = attach(edge.to, edge.toAnchor, "toAnchor");
    plans.set(edge.key, {
      edge: edge.key,
      side: lane.side,
      axis,
      at,
      ...(from !== undefined && { from }),
      ...(to !== undefined && { to }),
      bus,
      ...(problem !== undefined && { problem }),
    });
  }
  return plans;
}

/**
 * Whether a drawn route runs on its lane: every point between its ends lies
 * on the lane line, or (a bus branch whose ends line up) it is one straight
 * line across the lane.
 */
export function followsLane(points: readonly { x: number; y: number }[], plan: LanePlan): boolean {
  const coord = (p: { x: number; y: number }) => (plan.axis === "x" ? p.x : p.y);
  const inner = points.slice(1, -1);
  if (points.length < 2) return false;
  if (inner.length === 0) {
    const [p, q] = points as [{ x: number; y: number }, { x: number; y: number }];
    const across = plan.axis === "x" ? Math.abs(p.y - q.y) < 0.01 : Math.abs(p.x - q.x) < 0.01;
    return across && (coord(p) - plan.at) * (coord(q) - plan.at) <= 1e-6;
  }
  return inner.every((p) => Math.abs(coord(p) - plan.at) < 0.01);
}

/**
 * `layout/lane-blocked` for the routes as drawn (#609): a lane edge whose
 * route does not run on its lane, unless a diagnostic about the edge's lane
 * or route is already in `existing`.
 */
export function laneDiagnostics(
  ir: FigureIR,
  layout: LayoutIR,
  existing: readonly Diagnostic[],
): Diagnostic[] {
  const plans = planLanes(ir, layout);
  const reported = new Set(
    existing
      .filter((d) => d.code === "layout/lane-blocked" || d.code === "layout/no-route")
      .map((d) => d.subject?.id),
  );
  const routes = new Map(layout.edges.map((e) => [e.key, e.route?.points]));
  const out: Diagnostic[] = [];
  for (const edge of ir.edges) {
    const plan = plans.get(edge.key);
    const points = routes.get(edge.key);
    const id = edge.id ?? `edges[${edge.index}]`;
    if (plan === undefined || points === undefined || reported.has(id)) continue;
    if (plan.problem === undefined && followsLane(points, plan)) continue;
    const source = ir.sourceMap.get(edge.key);
    const name = (key: ElementKey) => {
      const element = ir.elements.get(key);
      return element !== undefined && element.kind !== "edge" ? element.id : key;
    };
    out.push({
      code: "layout/lane-blocked",
      severity: "warning",
      message: `The lane of edge ${edge.id === undefined ? id : `"${id}"`} from "${name(edge.from)}" to "${name(edge.to)}" (${plan.side}) is not followed: ${plan.problem?.reason ?? "the drawn route does not run on the lane"}.`,
      path: [...(source?.path ?? ["edges", edge.index]), "lane"],
      ...(source?.location !== undefined && { location: source.location }),
      subject: { kind: "edge", id },
      hint: "Change lane.offset, name another lane.outside or side, or move the element in the way.",
    });
  }
  return out;
}
