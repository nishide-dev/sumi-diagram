/**
 * Rounded corners of structured wires (#101, design doc §6.26).
 *
 * A structured route is an orthogonal polyline (#90). The writer strokes the
 * wires of a net as the union of maximal segments (#91); this module cuts
 * every turn back by a small radius and joins the cut ends with a quarter
 * circle (a cubic Bézier), the way D2 rounds ELK's orthogonal routes:
 *
 * - **A turn of one route**: the two legs are cut back by `r` and joined by
 *   an arc. Where another route of the same wire goes straight through the
 *   corner (a trunk that one route leaves), the trunk's own segment still
 *   covers the corner, so the leaving route peels off it smoothly.
 * - **A hidden junction** (a junction drawn without a dot): routes that meet
 *   there are joined like one route through it. An incoming route turns
 *   into each perpendicular outgoing one along an arc; a route that an
 *   incoming / outgoing partner continues straight on the other side is not
 *   cut, so a branch leaves a straight line smoothly (as in the Transformer
 *   and DiT figures), and two branches to either side fork off one line. A
 *   junction with a dot keeps its sharp joins: the dot marks the point.
 *
 * The radius at a turn is the largest up to `radius` that keeps the arc (in
 * fact the square spanned by the cut legs, which holds it) clear of every
 * obstacle by `clearance`: nodes, labels and the lines of other nets. It is
 * also at most half of each leg, so the cuts of two turns never overlap, and
 * it leaves the part of an end segment under an arrowhead straight
 * (`keepStart` / `keepEnd`, #116; at a hidden junction too, #160). A turn that cannot take `minRadius` stays
 * sharp. The router prefers to keep the segment before an arrowhead long
 * enough for both (`arrowRoom()`), but not always (a tight gap, a group
 * padding narrower than the room).
 *
 * The geometry the inspection, the geometry lint and the editable PPTX read
 * is the edge's `path.connection` (M / L, the route as it is): a rounded
 * corner lies inside the turn of the route, between its legs.
 */

import type { NodeIR } from "../compiler/ir";
import type { Point, Rect } from "../core/geometry";

/**
 * A junction drawn without a dot (#101): variant `hidden` of a point mark,
 * resolved by the theme to no paint at all (a theme without the variant
 * falls back to the default dot, which stays a dot).
 */
export const isHiddenJunction = (node: NodeIR): boolean =>
  node.mark?.type === "point" &&
  node.variant === "hidden" &&
  node.style.fill === "transparent" &&
  (node.style.stroke === "transparent" || node.style.strokeWidth.units === 0);

/** A wire's polyline, and the hidden junction (by id) its first / last point is the center of. */
export interface WirePolyline {
  readonly points: readonly Point[];
  /** The edge leaves this hidden junction: `points[0]` is its center. */
  readonly start?: string;
  /** The edge enters this hidden junction: the last point is its center. */
  readonly end?: string;
  /**
   * How much of the first / last segment must stay straight (#116): the part
   * of an arrowhead the wire runs under (the wire stops at the arrowhead's
   * base, which is not always its back). A turn there leaves it alone.
   */
  readonly keepStart?: number;
  readonly keepEnd?: number;
}

export interface CornerOptions {
  /** The largest radius, in units. */
  readonly radius: number;
  /** Turns that cannot take this radius stay sharp. */
  readonly minRadius: number;
  /** Space kept between an arc's square and an obstacle. */
  readonly clearance: number;
  /** Rectangles the arcs keep clear of (a segment is a rectangle with zero width or height). */
  readonly obstacles: readonly Rect[];
}

/** A quarter circle from `from` to `to` as a cubic Bézier. */
export interface Arc {
  readonly from: Point;
  readonly c1: Point;
  readonly c2: Point;
  readonly to: Point;
}

export interface RoundedWire {
  /** The straight pieces left after cutting the turns back (per polyline, in order). */
  readonly pieces: readonly (readonly [Point, Point])[][];
  /** The arcs, per polyline index that owns them (a junction's arcs go to the polyline that enters it). */
  readonly arcs: readonly Arc[][];
}

/** The control-point distance of a quarter circle of radius 1 as a cubic. */
const KAPPA = 0.5522847498307936;

type Direction = Point;

const direction = (from: Point, to: Point): Direction => {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  return { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
};
const distance = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y);
const along = (p: Point, d: Direction, t: number): Point => ({
  x: p.x + d.x * t,
  y: p.y + d.y * t,
});
const same = (a: Direction, b: Direction): boolean => a.x === b.x && a.y === b.y;
const opposite = (a: Direction, b: Direction): boolean => a.x === -b.x && a.y === -b.y;
const perpendicular = (a: Direction, b: Direction): boolean => a.x * b.x + a.y * b.y === 0;

/** An axis-parallel unit direction: routes are orthogonal, so the components are -1, 0 or 1. */
const axis = (d: Direction): Direction => ({ x: Math.sign(d.x), y: Math.sign(d.y) });

/**
 * The largest radius up to `limit` whose square at the corner `p` (spanned by
 * the legs toward `u` and `v`) stays `clearance` away from every obstacle.
 */
export function clearRadius(
  p: Point,
  u: Direction,
  v: Direction,
  limit: number,
  options: Pick<CornerOptions, "clearance" | "obstacles">,
): number {
  const sx = u.x !== 0 ? u.x : v.x;
  const sy = u.y !== 0 ? u.y : v.y;
  // Distance along one axis from p into an interval, in the square's direction s (Infinity: never).
  const gap = (at: number, s: number, low: number, high: number): number => {
    if (at >= low && at <= high) return 0;
    if (s > 0 && low > at) return low - at;
    if (s < 0 && high < at) return at - high;
    return Number.POSITIVE_INFINITY;
  };
  let r = limit;
  for (const o of options.obstacles) {
    const gx = gap(p.x, sx, o.x, o.x + o.width);
    const gy = gap(p.y, sy, o.y, o.y + o.height);
    // The square [p, p + s·r] meets the rectangle once r reaches both gaps.
    const reach = Math.max(gx, gy);
    if (reach !== Number.POSITIVE_INFINITY) r = Math.min(r, reach - options.clearance);
  }
  return r;
}

/** The arc turning at `p` from travelling along `d1` to travelling along `d2`. */
function arc(p: Point, d1: Direction, d2: Direction, r: number): Arc {
  const from = along(p, d1, -r);
  const to = along(p, d2, r);
  return { from, c1: along(from, d1, r * KAPPA), c2: along(to, d2, -r * KAPPA), to };
}

interface JunctionEnd {
  /** The polyline. */
  readonly index: number;
  /** Its first point (true) or last point (false) is the junction's center. */
  readonly atStart: boolean;
  /** Away from the junction, along the polyline's segment there. */
  readonly away: Direction;
  /**
   * How far the junction's arcs may cut into that segment: half of it (a
   * turn at its other end may take the other half), less the part under an
   * arrowhead at its other end when that is the route's other end (#160);
   * none when an arrowhead at the junction itself runs under it.
   */
  readonly room: number;
}

/**
 * Cuts the turns of the polylines back and returns the straight pieces and
 * the arcs that replace them (see the module comment). The polylines are
 * orthogonal, without repeated points; collinear interior points and
 * reversals are left as they are.
 */
export function roundCorners(
  polylines: readonly WirePolyline[],
  options: CornerOptions,
): RoundedWire {
  // How far each segment is cut back at its start and at its end.
  const cutStart = polylines.map((p) =>
    new Array<number>(Math.max(0, p.points.length - 1)).fill(0),
  );
  const cutEnd = polylines.map((p) => new Array<number>(Math.max(0, p.points.length - 1)).fill(0));
  // How much of the first / last segment a hidden junction's arcs attach to
  // (at least its cut): a turn at the segment's other end must leave it.
  const reserveStart = polylines.map(() => 0);
  const reserveEnd = polylines.map(() => 0);
  const arcs: Arc[][] = polylines.map(() => []);

  // Hidden junctions: the routes that meet at one, joined through its center.
  const ends = new Map<string, JunctionEnd[]>();
  const centers = new Map<string, Point>();
  polylines.forEach(({ points, start, end, keepStart = 0, keepEnd = 0 }, index) => {
    const n = points.length;
    if (n < 2) return;
    const add = (id: string, atStart: boolean, center: Point, other: Point) => {
      const list = ends.get(id) ?? [];
      const length = distance(center, other);
      const keepNear = atStart ? keepStart : keepEnd;
      const keepFar = n === 2 ? (atStart ? keepEnd : keepStart) : 0;
      list.push({
        index,
        atStart,
        away: axis(direction(center, other)),
        room: keepNear > 0 ? 0 : Math.min(length / 2, length - keepFar),
      });
      ends.set(id, list);
      centers.set(id, center);
    };
    if (start !== undefined) add(start, true, points[0] as Point, points[1] as Point);
    if (end !== undefined) add(end, false, points[n - 1] as Point, points[n - 2] as Point);
  });
  for (const [id, list] of ends) {
    const center = centers.get(id) as Point;
    const incoming = list.filter((e) => !e.atStart);
    const outgoing = list.filter((e) => e.atStart);
    // Turns go from an edge entering the junction into one leaving it; a
    // junction only entered or only left joins every pair.
    const pairs: [JunctionEnd, JunctionEnd][] = [];
    if (incoming.length > 0 && outgoing.length > 0) {
      for (const a of incoming) for (const b of outgoing) pairs.push([a, b]);
    } else {
      for (let i = 0; i < list.length; i++)
        for (let j = i + 1; j < list.length; j++)
          pairs.push([list[i] as JunctionEnd, list[j] as JunctionEnd]);
    }
    const turns = pairs.filter(([a, b]) => perpendicular(a.away, b.away));
    if (turns.length === 0) continue;
    // An arc lies on the legs it joins, and every route along a leg shares it
    // (including routes in no turn, such as one whose only partner is
    // parallel): the leg's room is the least of theirs (#160).
    const legKey = (d: Direction) => `${d.x},${d.y}`;
    const legRoom = new Map<string, number>();
    for (const e of list) {
      const key = legKey(e.away);
      legRoom.set(key, Math.min(legRoom.get(key) ?? e.room, e.room));
    }
    const room = (e: JunctionEnd) => legRoom.get(legKey(e.away)) as number;
    // One radius for the whole junction, so every cut meets its arcs.
    let r = options.radius;
    for (const [a, b] of turns) {
      r = Math.min(r, clearRadius(center, a.away, b.away, Math.min(room(a), room(b)), options));
    }
    if (r < options.minRadius) continue;
    const turning = new Set(turns.flat());
    // A route that one of its pairs continues straight through the junction is not cut.
    const continued = new Set(pairs.filter(([a, b]) => opposite(a.away, b.away)).flat());
    for (const e of turning) {
      if (e.atStart) reserveStart[e.index] = r;
      else reserveEnd[e.index] = r;
      if (continued.has(e)) continue;
      const points = polylines[e.index]?.points as readonly Point[];
      if (e.atStart) (cutStart[e.index] as number[])[0] = r;
      else (cutEnd[e.index] as number[])[points.length - 2] = r;
    }
    const seen = new Set<string>();
    for (const [a, b] of turns) {
      const key = `${a.away.x},${a.away.y}|${b.away.x},${b.away.y}`;
      if (seen.has(key) || same(a.away, b.away)) continue;
      seen.add(key);
      // Travelling into the junction against `a.away`, out along `b.away`.
      (arcs[a.index] as Arc[]).push(arc(center, { x: -a.away.x, y: -a.away.y }, b.away, r));
    }
  }

  // Turns of one route. A leg ending at a hidden junction can take its whole
  // length but what the junction's arcs use of it (none if the junction joins
  // nothing there); any other leg half of it (the turn at its other end may
  // take the other half).
  polylines.forEach(({ points, start, end, keepStart = 0, keepEnd = 0 }, index) => {
    const last = points.length - 2; // the last segment
    for (let i = 1; i + 1 < points.length; i++) {
      const prev = points[i - 1] as Point;
      const p = points[i] as Point;
      const next = points[i + 1] as Point;
      const d1 = axis(direction(prev, p));
      const d2 = axis(direction(p, next));
      if (!perpendicular(d1, d2)) continue;
      const before = distance(prev, p);
      const after = distance(p, next);
      const room = Math.min(
        i - 1 === 0 && start !== undefined ? before - (reserveStart[index] as number) : before / 2,
        i === last && end !== undefined ? after - (reserveEnd[index] as number) : after / 2,
        i - 1 === 0 ? before - keepStart : before,
        i === last ? after - keepEnd : after,
      );
      const r = clearRadius(p, { x: -d1.x, y: -d1.y }, d2, Math.min(options.radius, room), options);
      if (r < options.minRadius) continue;
      (cutEnd[index] as number[])[i - 1] = r;
      (cutStart[index] as number[])[i] = r;
      (arcs[index] as Arc[]).push(arc(p, d1, d2, r));
    }
  });

  const pieces = polylines.map(({ points }, index) => {
    const out: [Point, Point][] = [];
    for (let i = 0; i + 1 < points.length; i++) {
      const a = points[i] as Point;
      const b = points[i + 1] as Point;
      const length = distance(a, b);
      if (length === 0) continue;
      const d = direction(a, b);
      const s = (cutStart[index] as number[])[i] as number;
      const e = (cutEnd[index] as number[])[i] as number;
      if (s + e >= length) continue;
      out.push([along(a, d, s), along(b, d, -e)]);
    }
    return out;
  });
  return { pieces, arcs };
}
