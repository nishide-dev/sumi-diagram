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
    Math.abs(s.at - t.at) < distance &&
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
    const offsets = [0];
    for (let i = 1; i < group.length; i++)
      offsets.push((offsets[i - 1] ?? 0) + spacing(group[i - 1] as Lane, group[i] as Lane));
    const low = Math.max(...group.map((l, i) => l.low - (offsets[i] ?? 0)));
    const high = Math.min(...group.map((l, i) => l.high - (offsets[i] ?? 0)));
    if (low > high) continue;
    const preferred = group.reduce((sum, l, i) => sum + l.at - (offsets[i] ?? 0), 0) / group.length;
    const start = Math.max(low, Math.min(high, preferred));
    const moved = group.map((l, i) => {
      const at = roundUnits(start + (offsets[i] ?? 0));
      return l.points.map((p, j) => (j === 1 || j === 2 ? { ...p, [l.axis]: at } : p));
    });
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
