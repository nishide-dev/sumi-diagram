/** Local lane packing for facing, three-segment connectors (#329). */
import type { ElementKey } from "../../core/check-state";
import { mmToPt, ptToD2Units } from "../../core/units";
import { axisSegments } from "../../lint/geometry/proximity";
import type { Point, Rect } from "../ir";
import { roundUnits } from "../ir";
import { WIRE_CORNER_RADIUS } from "./arrowhead";

const MIN_RUN = ptToD2Units(mmToPt(3));
/** 1.5pt stroke-to-stroke, with room for 1/1000-unit rounding. */
const LANE_GAP = 3.02;

export interface ParallelEdge {
  key: ElementKey;
  width: number;
  fromRoom: number;
  toRoom: number;
}

interface Lane {
  edge: ParallelEdge;
  points: Point[];
  original: Point[];
  axis: "x" | "y";
  at: number;
  low: number;
  high: number;
  from: number;
  to: number;
}

const overlap = (a: Lane, b: Lane) => Math.min(a.to, b.to) - Math.max(a.from, b.from);
const spacing = (a: Lane, b: Lane) => (a.edge.width + b.edge.width) / 2 + LANE_GAP;

function paintedRuns(points: Point[]) {
  const distance = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  const turn = (i: number): number =>
    i === 0 || i === points.length - 1
      ? 0
      : Math.min(
          WIRE_CORNER_RADIUS,
          distance(points[i - 1] as Point, points[i] as Point) / 2,
          distance(points[i] as Point, points[i + 1] as Point) / 2,
        );
  return points.slice(1).map((b, i) => {
    const a = points[i] as Point;
    const axis = a.y === b.y ? "h" : "v";
    const along = axis === "h" ? "x" : "y";
    const increasing = a[along] < b[along];
    return {
      axis,
      at: axis === "h" ? a.y : a.x,
      from: Math.min(a[along], b[along]) + turn(increasing ? i : i + 1),
      to: Math.max(a[along], b[along]) - turn(increasing ? i + 1 : i),
    };
  });
}

function parallelProblem(a: Lane, b: Lane): boolean {
  return paintedRuns(a.original).some((s) =>
    paintedRuns(b.original).some(
      (t) =>
        s.axis === (a.axis === "y" ? "h" : "v") &&
        s.axis === t.axis &&
        Math.abs(s.at - t.at) < spacing(a, b) &&
        Math.min(s.to, t.to) - Math.max(s.from, t.from) >= MIN_RUN,
    ),
  );
}

interface Plan {
  order: Lane[];
  positions: number[];
}

/** Lane centres for one ordering (ascending axis), or undefined when they do not fit. */
function place(order: Lane[]): Plan | undefined {
  const offsets = [0];
  for (let i = 1; i < order.length; i++)
    offsets.push((offsets[i - 1] ?? 0) + spacing(order[i - 1] as Lane, order[i] as Lane));
  const low = Math.max(...order.map((l, i) => l.low - (offsets[i] ?? 0)));
  const high = Math.min(...order.map((l, i) => l.high - (offsets[i] ?? 0)));
  if (low > high) return undefined;
  const preferred = order.reduce((sum, l, i) => sum + l.at - (offsets[i] ?? 0), 0) / order.length;
  const start = Math.max(low, Math.min(high, preferred));
  return { order, positions: offsets.map((o) => start + o) };
}

/** Cost of an ordering: leg/run crossings, plus a heavy penalty for overlapping legs. */
function orderCost({ order, positions }: Plan): number {
  let count = 0;
  for (const [i, l] of order.entries()) {
    const along = l.axis === "y" ? "x" : "y";
    const ends = [l.points[0] as Point, l.points[3] as Point];
    for (const [j, m] of order.entries()) {
      if (i === j) continue;
      const at = positions[j] as number;
      // Legs of two lanes on one line must not overlap (merely near legs cannot be fixed by order).
      for (const end of ends)
        for (const other of [m.points[0] as Point, m.points[3] as Point]) {
          if (i > j || Math.abs(end[along] - other[along]) >= COLLINEAR) continue;
          const reach = [end[l.axis], positions[i] as number];
          const otherReach = [other[l.axis], at];
          if (
            Math.min(Math.max(...reach), Math.max(...otherReach)) -
              Math.max(Math.min(...reach), Math.min(...otherReach)) >
            0
          )
            count += LEG_OVERLAP;
        }
      for (const end of ends) {
        const x = end[along];
        const reach = [end[l.axis], positions[i] as number];
        if (Math.min(...reach) < at && at < Math.max(...reach) && m.from < x && x < m.to) count++;
      }
    }
  }
  return count;
}

const MAX_PERMUTED = 7;
const COLLINEAR = 0.5;
/** Lane centres are rounded to 1/1000, so a gap of exactly LANE spacing may read a hair short. */
const EPSILON = 1e-6;
/** Outweighs any number of crossings: collinear legs read as one line. */
const LEG_OVERLAP = 1000;

/**
 * Choose the lane order with the fewest leg/lane crossings (nested spans put the
 * narrower one nearer its source, crossing pairs keep only the unavoidable
 * crossing). Ties keep the original-position / document order, so it is
 * deterministic. Large groups keep that order.
 */
function bestOrder(sorted: Lane[]): Plan | undefined {
  if (sorted.length > MAX_PERMUTED) return place(sorted);
  let best: (Plan & { cost: number }) | undefined;
  const walk = (rest: Lane[], chosen: Lane[]) => {
    if (!rest.length) {
      const plan = place(chosen);
      if (!plan) return;
      const cost = orderCost(plan);
      if (!best || cost < best.cost) best = { ...plan, cost };
      return;
    }
    for (const [i, l] of rest.entries())
      walk(
        rest.filter((_, k) => k !== i),
        [...chosen, l],
      );
  };
  walk(sorted, []);
  return best;
}

/** Do not trade the repaired run for a new overlap/proximity on a leg. */
function newConflict(
  a: Point[],
  b: Point[],
  oldA: Point[],
  oldB: Point[],
  distance: number,
): boolean {
  const beforeA = axisSegments([oldA]);
  const beforeB = axisSegments([oldB]);
  const near = (s: (typeof beforeA)[number], t: (typeof beforeA)[number]) =>
    s.axis === t.axis &&
    Math.abs(s.at - t.at) < distance - EPSILON &&
    Math.min(s.to, t.to) - Math.max(s.from, t.from) >= MIN_RUN;
  return axisSegments([a]).some((s, i) =>
    axisSegments([b]).some(
      (t, j) => near(s, t) && !(beforeA[i] && beforeB[j] && near(beforeA[i], beforeB[j])),
    ),
  );
}

/**
 * Only move the middle run, inside the original facing-port corridor. Keep
 * endpoints, stub/arrow room and shared trunks. Unaffected routes
 * are returned verbatim; packing is atomic when the corridor is too narrow.
 */
export function separateParallelRuns(
  routes: Map<ElementKey, Point[]>,
  edges: readonly ParallelEdge[],
  obstacles: readonly Rect[],
  shares: (a: ElementKey, b: ElementKey) => boolean,
): void {
  const lanes: Lane[] = [];
  for (const edge of edges) {
    const points = routes.get(edge.key);
    if (
      !points ||
      points.length < 4 ||
      edges.some((other) => other !== edge && shares(edge.key, other.key))
    )
      continue;
    const a = points[0] as Point,
      first = points[1] as Point;
    const last = points[points.length - 2] as Point,
      d = points[points.length - 1] as Point;
    const axis = a.x === first.x ? "y" : "x";
    const along = axis === "y" ? "x" : "y";
    if (last[along] !== d[along]) continue;
    const sign = Math.sign(d[axis] - a[axis]);
    if (!sign || (first[axis] - a[axis]) * sign <= 0 || (d[axis] - last[axis]) * sign <= 0)
      continue;
    const start = a[axis] + sign * edge.fromRoom;
    const end = d[axis] - sign * edge.toRoom;
    const low = Math.min(start, end);
    const high = Math.max(start, end);
    if ((end - start) * sign < 0) continue;
    const at = Math.max(low, Math.min(high, first[axis]));
    const b = { ...a, [axis]: at },
      c = { ...d, [axis]: at };
    const from = Math.min(b[along], c[along]);
    const to = Math.max(b[along], c[along]);
    lanes.push({
      edge,
      points: [a, b, c, d],
      original: points,
      axis,
      at: b[axis],
      low,
      high,
      from,
      to,
    });
  }
  const related = (a: Lane, b: Lane) =>
    a.axis === b.axis &&
    overlap(a, b) >= MIN_RUN &&
    Math.max(a.low, b.low) <= Math.min(a.high, b.high) &&
    !shares(a.edge.key, b.edge.key);
  const seen = new Set<Lane>();
  for (const seed of lanes) {
    if (seen.has(seed)) continue;
    const group = [seed];
    seen.add(seed);
    for (const a of group)
      for (const b of lanes) {
        if (!seen.has(b) && related(a, b)) {
          seen.add(b);
          group.push(b);
        }
      }
    if (
      !group.some((a, i) => group.slice(i + 1).some((b) => related(a, b) && parallelProblem(a, b)))
    )
      continue;
    group.sort((a, b) => a.at - b.at || edges.indexOf(a.edge) - edges.indexOf(b.edge));
    const plan = bestOrder(group);
    if (!plan) continue;
    const moved = plan.order.map((l, i) => {
      const at = roundUnits(plan.positions[i] ?? 0);
      return l.points.map((p, j) => (j === 1 || j === 2 ? { ...p, [l.axis]: at } : p));
    });
    group.splice(0, group.length, ...plan.order);
    // Every changed segment stays out of node interiors. Testing the entire
    // new route also covers the two legs lengthened by moving the run.
    const blocked = moved.some((points) =>
      points.slice(1).some((b, i) => {
        const a = points[i] as Point;
        return obstacles.some((r) =>
          a.x === b.x
            ? a.x > r.x &&
              a.x < r.x + r.width &&
              Math.max(a.y, b.y) > r.y &&
              Math.min(a.y, b.y) < r.y + r.height
            : a.y > r.y &&
              a.y < r.y + r.height &&
              Math.max(a.x, b.x) > r.x &&
              Math.min(a.x, b.x) < r.x + r.width,
        );
      }),
    );
    if (blocked) continue;
    const next = new Map(routes);
    for (const [i, l] of group.entries()) next.set(l.edge.key, moved[i] as Point[]);
    if (
      group.some((l) =>
        edges.some((other) => {
          if (other.key === l.edge.key || shares(l.edge.key, other.key)) return false;
          const a = next.get(l.edge.key),
            b = next.get(other.key);
          const oldA = routes.get(l.edge.key),
            oldB = routes.get(other.key);
          return (
            a &&
            b &&
            oldA &&
            oldB &&
            newConflict(a, b, oldA, oldB, (l.edge.width + other.width) / 2 + LANE_GAP)
          );
        }),
      )
    )
      continue;
    for (const [i, l] of group.entries()) routes.set(l.edge.key, moved[i] as Point[]);
  }
}
