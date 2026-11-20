/**
 * Removing avoidable bends after routing (#604, design record
 * `docs/design/decisions/604-avoidable-bends.md`).
 *
 * The grid search finds the cheapest route on its grid with the ports
 * `resolveEnds` chose, so it can leave a route with more bends than the
 * ends need: an S between ends that would face each other if one port slid
 * along its side, a staircase where a clearance zone or a label made two
 * small steps cheaper than one column, a Z whose middle runs right beside a
 * frame although the channel is wider. This pass looks at each finished
 * route once, in document order, and tries simpler shapes:
 *
 * 1. **Straight**: facing sides whose spans overlap; a free end slides along
 *    its side into line (generalising #169, which straightens ends at most
 *    `STRAIGHTEN_TOLERANCE` apart before routing).
 * 2. **L** (one bend): the corner at either end's line, with a free end on
 *    another side of its element if the current one does not allow an L.
 * 3. **Z** (two bends) between facing ports: the middle segment in the
 *    clearest place of the channel.
 * 4. **Nudge** (as many bends): each segment between two bends moves across
 *    within the room its neighbours leave, to remove a jog shorter than
 *    {@link TINY_JOG}, come less close to a node, or leave a frame, node or
 *    line it runs beside within {@link HUG_GAP}.
 *
 * An end leaves its side for an L only when the route is in trouble (three
 * bends or more, a tiny jog, a hug, a node's clearance): a plain S keeps the
 * sides the arrange tree gave it (#134). It must
 * keep every rule the grid search keeps as a hard rule, and more:
 * perpendicular stubs of the ends' lanes and the rooms before arrowheads;
 * the clearance from every node that is not an end (and from the ends
 * beyond their own stub); group titles and captions; no more crossings of a
 * group's border than before; no line of another net crossed, touched,
 * overlapped or run beside more often than before, and none crossed in the
 * room before its arrowhead. Ends with a written anchor never move; a free
 * end moves only along a straight side of a plain shape, and to another
 * side only if no other edge uses that side. All choices are deterministic.
 */

import type { ElementKey } from "../../core/check-state";
import type { Side } from "../../core/figure/schema";
import { mmToPt, ptToD2Units } from "../../core/units";
import { type Point, type Rect, roundUnits } from "../ir";
import { WIRE_CORNER_RADIUS } from "./arrowhead";
import { DIRS, opposite, SIDE_DIR } from "./ports";

/** A step between two bends shorter than this (2mm, in units) is a tiny jog. */
export const TINY_JOG = ptToD2Units(mmToPt(2));
/** A middle segment closer than this (1.5mm, centre to line) to a frame, node or line hugs it. */
export const HUG_GAP = ptToD2Units(mmToPt(1.5));
/** …along at least this much (3mm). */
export const HUG_RUN = ptToD2Units(mmToPt(3));
/** The clearance kept from annotation text where that saves a bend (1.5pt). */
const SOFT_CLEARANCE = 3;
/** The clearance kept from nodes (the router's `ROUTE.clearance`). */
const CLEARANCE = 6;
/** How far a centred middle segment is still worth moving for (beyond this, any place is clear). */
const ENOUGH_CLEARANCE = 4 * CLEARANCE;
const EPS = 1e-6;

/** Where an end meets its element: the router's port, the drawn end and the direction away from it. */
export interface Terminal {
  readonly port: Point;
  readonly outline: Point;
  /** Away from the port into the route (`DIRS` index). */
  readonly dir: number;
  readonly side?: Side;
}

/** A side a free end may use, with the positions along it (x on north / south, y on east / west). */
export interface SideRange {
  readonly side: Side;
  readonly lo: number;
  readonly hi: number;
}

export interface SimplifyEnd {
  readonly key: ElementKey;
  /** The element's bounding box. */
  readonly rect: Rect;
  readonly current: Terminal;
  /** Straight run required out of / into the port (the stub). */
  readonly lane: number;
  /** The arrowhead's length at this end (0 without one), for the corner rounding. */
  readonly arrow?: number;
  /** Straight run kept before an arrowhead (`arrowRoom()`); 0 without one. */
  readonly room: number;
  /**
   * Where the end may move; omitted for an end that keeps its port (a
   * written anchor, a junction, a shared port, a shape without straight
   * sides). The current side comes first.
   */
  readonly free?: {
    /**
     * Read when the edge's turn comes: the caller keeps it up to date with
     * the ends earlier edges moved (`simplifyRoutes`' `onChange`).
     */
    readonly sides: readonly SideRange[];
    /** The end at `along` on `side`. */
    readonly at: (side: Side, along: number) => Terminal;
  };
}

export interface SimplifyEdge {
  readonly key: ElementKey;
  readonly from: SimplifyEnd;
  readonly to: SimplifyEnd;
}

export interface SimplifyScene {
  /**
   * Nodes routes keep clear of (junctions included). `soft`: annotation text
   * (a label attached to a node, a caption), which a line may pass at half
   * the clearance from its text lines (`lines`, each as wide as the line)
   * where that saves a bend.
   */
  readonly nodes: readonly {
    readonly key: ElementKey;
    readonly rect: Rect;
    readonly soft?: boolean;
    readonly lines?: readonly Rect[];
  }[];
  /** Text routes keep clear of: group titles and captions. */
  readonly boxes: readonly Rect[];
  /** Group frames: crossings are counted, and a drawn one is not run beside. */
  readonly groups: readonly {
    readonly key: ElementKey;
    readonly rect: Rect;
    readonly drawn: boolean;
  }[];
  /** Every route (updated as edges are simplified). */
  readonly routes: Map<ElementKey, Point[]>;
  /** The room before each route's arrowheads (0 where there is none). */
  readonly rooms: ReadonlyMap<ElementKey, { readonly from: number; readonly to: number }>;
  /** `a` and `b` may share lines (one net, #113): neither counts against the other. */
  readonly shares: (a: ElementKey, b: ElementKey) => boolean;
  /** `true` if `key` lies (transitively) inside the group `group`. */
  readonly inside: (key: ElementKey, group: ElementKey) => boolean;
}

/** A replaced route: its new ends and points (outline to outline). */
export interface Simplified {
  readonly from: Terminal;
  readonly to: Terminal;
  readonly points: Point[];
}

interface Candidate {
  readonly from: Terminal;
  readonly to: Terminal;
  /** Port to port. */
  readonly core: Point[];
  /** Ends moved: a slide counts 1, another side 2. */
  readonly moved: number;
}

interface Seg {
  readonly a: Point;
  readonly b: Point;
  readonly h: boolean;
}

const horizontalDir = (dir: number) => dir % 2 === 0;

/** Drops repeated points and points on a straight line between their neighbours. */
export function straightened(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out.at(-1);
    if (last !== undefined && Math.abs(last.x - p.x) < EPS && Math.abs(last.y - p.y) < EPS)
      continue;
    out.push(p);
    while (out.length >= 3) {
      const a = out.at(-3) as Point;
      const b = out.at(-2) as Point;
      const c = out.at(-1) as Point;
      const collinear =
        (Math.abs(a.x - b.x) < EPS && Math.abs(b.x - c.x) < EPS) ||
        (Math.abs(a.y - b.y) < EPS && Math.abs(b.y - c.y) < EPS);
      if (!collinear) break;
      out.splice(out.length - 2, 1);
    }
  }
  return out;
}

function segments(points: readonly Point[]): Seg[] {
  const out: Seg[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as Point;
    const b = points[i] as Point;
    out.push({ a, b, h: Math.abs(a.y - b.y) < Math.abs(a.x - b.x) });
  }
  return out;
}

const length = (s: Seg) => Math.abs(s.a.x - s.b.x) + Math.abs(s.a.y - s.b.y);

/** Bends of a simplified polyline. */
export const bendCount = (points: readonly Point[]): number =>
  Math.max(0, straightened(points).length - 2);

/** Lengths of the segments between two bends. */
export function jogLengths(points: readonly Point[]): number[] {
  const s = segments(straightened(points));
  return s.slice(1, -1).map(length);
}

/** The segment meets the rectangle grown by `pad` (strictly: touching its edge does not count). */
function hitsRect(s: Seg, r: Rect, pad: number): boolean {
  const x0 = Math.min(s.a.x, s.b.x);
  const x1 = Math.max(s.a.x, s.b.x);
  const y0 = Math.min(s.a.y, s.b.y);
  const y1 = Math.max(s.a.y, s.b.y);
  return (
    x1 > r.x - pad + EPS &&
    x0 < r.x + r.width + pad - EPS &&
    y1 > r.y - pad + EPS &&
    y0 < r.y + r.height + pad - EPS
  );
}

/** How two lines of different nets meet: proper crossings and touches, collinear overlaps, close parallels. */
interface Contacts {
  crossings: number;
  overlaps: number;
  near: number;
}

function contacts(mine: readonly Seg[], theirs: readonly Seg[], within: Rect): Contacts {
  const out: Contacts = { crossings: 0, overlaps: 0, near: 0 };
  for (const t of theirs) {
    if (
      Math.max(t.a.x, t.b.x) < within.x ||
      Math.min(t.a.x, t.b.x) > within.x + within.width ||
      Math.max(t.a.y, t.b.y) < within.y ||
      Math.min(t.a.y, t.b.y) > within.y + within.height
    )
      continue;
    for (const s of mine) {
      if (s.h === t.h) {
        const [sc, tc] = s.h ? [s.a.y, t.a.y] : [s.a.x, t.a.x];
        const [s0, s1] = s.h
          ? [Math.min(s.a.x, s.b.x), Math.max(s.a.x, s.b.x)]
          : [Math.min(s.a.y, s.b.y), Math.max(s.a.y, s.b.y)];
        const [t0, t1] = t.h
          ? [Math.min(t.a.x, t.b.x), Math.max(t.a.x, t.b.x)]
          : [Math.min(t.a.y, t.b.y), Math.max(t.a.y, t.b.y)];
        const along = Math.min(s1, t1) - Math.max(s0, t0);
        const d = Math.abs(sc - tc);
        if (d <= 0.5 && along > -EPS) out.overlaps++;
        else if (d < CLEARANCE && along > 1) out.near++;
        continue;
      }
      const [h, v] = s.h ? [s, t] : [t, s];
      const hy = h.a.y;
      const vx = v.a.x;
      const hx0 = Math.min(h.a.x, h.b.x);
      const hx1 = Math.max(h.a.x, h.b.x);
      const vy0 = Math.min(v.a.y, v.b.y);
      const vy1 = Math.max(v.a.y, v.b.y);
      // Closed: a crossing, or one line ending on the other (a touch).
      if (vx >= hx0 - EPS && vx <= hx1 + EPS && hy >= vy0 - EPS && hy <= vy1 + EPS) {
        out.crossings++;
      }
    }
  }
  return out;
}

/** Proper crossings of the polyline with the border of `r` (ends on the border do not count). */
function borderCrossings(s: readonly Seg[], r: Rect): number {
  let n = 0;
  const right = r.x + r.width;
  const bottom = r.y + r.height;
  for (const g of s) {
    if (g.h) {
      const y = g.a.y;
      if (y <= r.y + EPS || y >= bottom - EPS) continue;
      const x0 = Math.min(g.a.x, g.b.x);
      const x1 = Math.max(g.a.x, g.b.x);
      if (x0 < r.x - EPS && x1 > r.x + EPS) n++;
      if (x0 < right - EPS && x1 > right + EPS) n++;
    } else {
      const x = g.a.x;
      if (x <= r.x + EPS || x >= right - EPS) continue;
      const y0 = Math.min(g.a.y, g.b.y);
      const y1 = Math.max(g.a.y, g.b.y);
      if (y0 < r.y - EPS && y1 > r.y + EPS) n++;
      if (y0 < bottom - EPS && y1 > bottom + EPS) n++;
    }
  }
  return n;
}

/** Parallel runs closer than the clearance to the border of `r`, at least a unit long. */
function borderRuns(s: readonly Seg[], r: Rect): number {
  let n = 0;
  for (const g of s) {
    const lines = g.h
      ? [
          { c: r.y, lo: r.x, hi: r.x + r.width },
          { c: r.y + r.height, lo: r.x, hi: r.x + r.width },
        ]
      : [
          { c: r.x, lo: r.y, hi: r.y + r.height },
          { c: r.x + r.width, lo: r.y, hi: r.y + r.height },
        ];
    const c = g.h ? g.a.y : g.a.x;
    const s0 = g.h ? Math.min(g.a.x, g.b.x) : Math.min(g.a.y, g.b.y);
    const s1 = g.h ? Math.max(g.a.x, g.b.x) : Math.max(g.a.y, g.b.y);
    for (const l of lines) {
      if (Math.abs(c - l.c) < CLEARANCE && Math.min(s1, l.hi) - Math.max(s0, l.lo) > 1) n++;
    }
  }
  return n;
}

/** A line a segment may run beside: a drawn frame's side, a node's side, another net's segment. */
interface Line {
  readonly h: boolean;
  readonly c: number;
  readonly lo: number;
  readonly hi: number;
}

/** The lines segments of `edge` must not hug: drawn frames, other nodes' sides, other nets' lines. */
function hugLines(edge: SimplifyEdge, scene: SimplifyScene, others: readonly Seg[]): Line[] {
  const lines: Line[] = [];
  const rectLines = (r: Rect) => {
    lines.push({ h: true, c: r.y, lo: r.x, hi: r.x + r.width });
    lines.push({ h: true, c: r.y + r.height, lo: r.x, hi: r.x + r.width });
    lines.push({ h: false, c: r.x, lo: r.y, hi: r.y + r.height });
    lines.push({ h: false, c: r.x + r.width, lo: r.y, hi: r.y + r.height });
  };
  for (const g of scene.groups) if (g.drawn) rectLines(g.rect);
  for (const n of scene.nodes) {
    if (n.key === edge.from.key || n.key === edge.to.key) continue;
    if (n.rect.width < 2 || n.rect.height < 2) continue;
    rectLines(n.rect);
  }
  for (const t of others) {
    lines.push(
      t.h
        ? { h: true, c: t.a.y, lo: Math.min(t.a.x, t.b.x), hi: Math.max(t.a.x, t.b.x) }
        : { h: false, c: t.a.x, lo: Math.min(t.a.y, t.b.y), hi: Math.max(t.a.y, t.b.y) },
    );
  }
  return lines;
}

/**
 * The smallest distance from `segs` to a parallel line they run beside for
 * at least {@link HUG_RUN}; `Infinity` if none.
 */
function hugGapOf(segs: readonly Seg[], lines: readonly Line[]): number {
  let gap = Number.POSITIVE_INFINITY;
  for (const g of segs) {
    const c = g.h ? g.a.y : g.a.x;
    const s0 = g.h ? Math.min(g.a.x, g.b.x) : Math.min(g.a.y, g.b.y);
    const s1 = g.h ? Math.max(g.a.x, g.b.x) : Math.max(g.a.y, g.b.y);
    for (const l of lines) {
      if (l.h !== g.h) continue;
      if (Math.min(s1, l.hi) - Math.max(s0, l.lo) < HUG_RUN) continue;
      gap = Math.min(gap, Math.abs(c - l.c));
    }
  }
  return gap;
}

/** A rectangle routes keep a clearance from: a node (not an end), a title or caption. */
interface Obstacle {
  readonly rect: Rect;
  /** The clearance it needs, in units. */
  readonly need: number;
}

/** The scene of one edge: only what lies near it, and the obstacles with their clearances. */
interface LocalScene extends SimplifyScene {
  readonly obstacles: readonly Obstacle[];
}

/**
 * Everything a route is measured by, per thing it meets (in the order of the
 * scene's groups and obstacles and of `others`), so that a candidate can be
 * held to "no worse than the routed line" thing by thing.
 */
interface Measure {
  /** Per other route: crossings and touches, overlaps, close parallels. */
  contacts: Contacts[];
  groupCrossings: number[];
  groupRuns: number[];
  /** Per obstacle: how far the route comes inside its clearance (≤ 0: clear). */
  shortfalls: number[];
  /** The sum of the positive shortfalls (for ranking). */
  shortfall: number;
}

/** The route from port to port: the drawn points with the outline ends replaced by the ports. */
function coreOf(edge: SimplifyEdge, points: readonly Point[]): Point[] {
  const p = straightened(points);
  return straightened([edge.from.current.port, ...p.slice(1, -1), edge.to.current.port]);
}

/** L∞ distance between an axis-parallel segment and a rectangle (≤ 0 when they meet). */
function rectDistance(g: Seg, r: Rect): number {
  const x0 = Math.min(g.a.x, g.b.x);
  const x1 = Math.max(g.a.x, g.b.x);
  const y0 = Math.min(g.a.y, g.b.y);
  const y1 = Math.max(g.a.y, g.b.y);
  const dx = Math.max(r.x - x1, 0, x0 - (r.x + r.width));
  const dy = Math.max(r.y - y1, 0, y0 - (r.y + r.height));
  if (dx > 0 || dy > 0) return Math.max(dx, dy);
  // Meeting it: negative, by how deep the segment goes in (touching is 0).
  return -Math.max(0, Math.min(x1 - r.x, r.x + r.width - x0, y1 - r.y, r.y + r.height - y0));
}

/**
 * Measures a route (`core`: port to port; `points`: as drawn) against the
 * scene. With `limit` (the routed line's measure), `undefined` as soon as the
 * route is worse than it on any one thing: a group border crossed or run
 * beside more often, an obstacle the line kept clear of now within its
 * clearance (or one it was already too close to, closer), a route of another
 * net crossed, touched, overlapped or run beside more often than the routed
 * line did (a route it never met may not be met at all).
 */
function measure(
  edge: SimplifyEdge,
  core: readonly Point[],
  points: readonly Point[],
  scene: LocalScene,
  others: readonly Other[],
  limit?: Measure,
): Measure | undefined {
  const s = segments(straightened(points));
  const groupCrossings = scene.groups.map((g) => borderCrossings(s, g.rect));
  if (limit !== undefined && groupCrossings.some((n, i) => n > (limit.groupCrossings[i] as number)))
    return undefined;
  const groupRuns = scene.groups.map((g) =>
    !g.drawn || g.key === edge.from.key || g.key === edge.to.key ? 0 : borderRuns(s, g.rect),
  );
  if (limit !== undefined && groupRuns.some((n, i) => n > (limit.groupRuns[i] as number)))
    return undefined;
  // `scene.obstacles` holds nothing of the ends (`simplifyEdge`).
  const coreSegs = segments(core);
  const shortfalls: number[] = [];
  let shortfall = 0;
  for (const [i, o] of scene.obstacles.entries()) {
    let worst = Number.NEGATIVE_INFINITY;
    for (const g of coreSegs) worst = Math.max(worst, o.need - rectDistance(g, o.rect));
    if (limit !== undefined && worst > Math.max(0, limit.shortfalls[i] as number) + EPS)
      return undefined;
    shortfalls.push(worst);
    if (worst > 0) shortfall += worst;
  }
  // Lines farther than the clearance cannot meet or run beside the route.
  const b = boxOf(points);
  const near = {
    x: b.x - CLEARANCE,
    y: b.y - CLEARANCE,
    width: b.width + 2 * CLEARANCE,
    height: b.height + 2 * CLEARANCE,
  };
  const all: Contacts[] = [];
  for (const [i, o] of others.entries()) {
    const c = meets(o.box, near)
      ? contacts(s, o.segs, near)
      : { crossings: 0, overlaps: 0, near: 0 };
    const was = limit?.contacts[i];
    if (
      was !== undefined &&
      (c.crossings > was.crossings || c.overlaps > was.overlaps || c.near > was.near)
    )
      return undefined;
    all.push(c);
  }
  return { contacts: all, groupCrossings, groupRuns, shortfalls, shortfall };
}

/**
 * The rules a candidate must keep outright: the ends' stubs and rooms are
 * straight and point the right way, no segment enters an end (only the
 * segment at an end touches it, the others keep the clearance), and no
 * line crosses the room before another's arrowhead.
 */
function keepsRules(
  edge: SimplifyEdge,
  c: Candidate,
  points: readonly Point[],
  scene: SimplifyScene,
  others: readonly Other[],
): boolean {
  if (!lanesKept(edge, c)) return false;
  const core = segments(c.core);
  const last = core.length - 1;
  for (const [i, g] of core.entries()) {
    for (const [end, adjacent] of [
      [edge.from, i === 0],
      [edge.to, i === last],
    ] as const) {
      // A junction is a point the line ends in.
      if (end.current.dir < 0) continue;
      if (hitsRect(g, end.rect, adjacent ? 0 : CLEARANCE)) return false;
    }
  }
  const s = segments(straightened(points));
  const mine = arrowZones(points, { from: edge.from.room, to: edge.to.room });
  for (const o of others) {
    if (s.some((g) => o.zones.some((z) => hitsRect(g, z, 0)))) return false;
    if (o.segs.some((g) => mine.some((z) => hitsRect(g, z, 0)))) return false;
  }
  return true;
}

/** Another net's route as candidates are checked against it. */
interface Other {
  readonly key: ElementKey;
  readonly segs: Seg[];
  readonly box: Rect;
  /** The rooms before its arrowheads, which no other line may cross. */
  readonly zones: Rect[];
}

/** The rooms before a route's arrowheads, as rectangles 1 unit wider than the line. */
function arrowZones(route: readonly Point[], rooms: { from: number; to: number }): Rect[] {
  const out: Rect[] = [];
  const zone = (tip: Point, before: Point, room: number) => {
    if (room <= 0) return;
    const d = Math.abs(tip.x - before.x) + Math.abs(tip.y - before.y);
    const t = Math.min(1, room / Math.max(d, EPS));
    const q = { x: tip.x + (before.x - tip.x) * t, y: tip.y + (before.y - tip.y) * t };
    out.push({
      x: Math.min(tip.x, q.x) - 1,
      y: Math.min(tip.y, q.y) - 1,
      width: Math.abs(tip.x - q.x) + 2,
      height: Math.abs(tip.y - q.y) + 2,
    });
  };
  const p = straightened(route);
  if (p.length >= 2) {
    zone(p[0] as Point, p[1] as Point, rooms.from);
    zone(p.at(-1) as Point, p.at(-2) as Point, rooms.to);
  }
  return out;
}

/**
 * Every corner of the candidate takes the wire's full corner radius
 * ({@link WIRE_CORNER_RADIUS}) as the renderer rounds it (`render/wire.ts`):
 * each leg of a turn at least two radii long (an end leg two radii past its
 * arrowhead), and the square the arc is drawn in clear of every obstacle. A
 * candidate whose corners would round less looks sharper than a routed line
 * (#604 review).
 */
function cornersRound(edge: SimplifyEdge, c: Candidate, scene: LocalScene): boolean {
  const p = straightened(c.core);
  const s = segments(p);
  if (s.length < 2) return true;
  const R = WIRE_CORNER_RADIUS;
  const legsOk = s.every((g, i) => {
    const head = i === 0 ? (edge.from.arrow ?? 0) : 0;
    const tail = i === s.length - 1 ? (edge.to.arrow ?? 0) : 0;
    return length(g) >= 2 * R + head + tail - EPS;
  });
  if (!legsOk) return false;
  for (let i = 1; i + 1 < p.length; i++) {
    const a = p[i - 1] as Point;
    const q = p[i] as Point;
    const b = p[i + 1] as Point;
    const back = { x: Math.sign(a.x - q.x) * R, y: Math.sign(a.y - q.y) * R };
    const on = { x: Math.sign(b.x - q.x) * R, y: Math.sign(b.y - q.y) * R };
    const xs = [q.x, q.x + back.x, q.x + on.x];
    const ys = [q.y, q.y + back.y, q.y + on.y];
    const square = {
      x: Math.min(...xs),
      y: Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    };
    if (scene.obstacles.some((o) => meets(square, o.rect))) return false;
  }
  return true;
}

/** The ends' stubs (and rooms before arrowheads) are straight and point the right way. */
function lanesKept(edge: SimplifyEdge, c: Candidate): boolean {
  const core = c.core;
  if (core.length < 2) return false;
  const first = core[0] as Point;
  const second = core[1] as Point;
  const end = core.at(-1) as Point;
  const before = core.at(-2) as Point;
  const along = (a: Point, b: Point, dir: number) => {
    const d = DIRS[dir] as Point;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    // Perpendicular offset must be zero; the distance along must be positive.
    if (Math.abs(dx * d.y - dy * d.x) > EPS) return -1;
    return dx * d.x + dy * d.y;
  };
  if (core.length === 2) {
    // A straight line has no corner before its arrowheads: the stubs suffice.
    // At a junction (no direction) the port's direction decides.
    const run = c.from.dir >= 0 ? along(first, end, c.from.dir) : along(end, first, c.to.dir);
    return (
      run > 0 &&
      (c.from.dir < 0 || c.to.dir < 0 || c.to.dir === opposite(c.from.dir)) &&
      run >= Math.max(edge.from.lane, edge.to.lane) - EPS
    );
  }
  return (
    along(first, second, c.from.dir) >= need(edge.from) - EPS &&
    along(end, before, c.to.dir) >= need(edge.to) - EPS
  );
}

/** The straight run an end needs: its stub, or the room before its arrowhead. */
const need = (e: SimplifyEnd) => Math.max(e.lane, e.room);

/** The distance from `segs` to the nearest node, text, drawn frame or other line beside them (capped). */
function clearanceOf(
  edge: SimplifyEdge,
  segs: readonly Seg[],
  scene: SimplifyScene,
  others: readonly Other[],
): number {
  let best = ENOUGH_CLEARANCE;
  for (const g of segs) {
    // Only what lies beside the segment (overlapping it along its axis).
    const beside = (r: Rect) =>
      g.h
        ? Math.min(Math.max(g.a.x, g.b.x), r.x + r.width) - Math.max(Math.min(g.a.x, g.b.x), r.x) >
          0
        : Math.min(Math.max(g.a.y, g.b.y), r.y + r.height) - Math.max(Math.min(g.a.y, g.b.y), r.y) >
          0;
    for (const n of scene.nodes) {
      if (beside(n.rect)) best = Math.min(best, rectDistance(g, n.rect));
    }
    // The ends too: these segments are not the ones that touch them.
    for (const r of [edge.from.rect, edge.to.rect]) {
      if (beside(r)) best = Math.min(best, rectDistance(g, r));
    }
    for (const r of scene.boxes) if (beside(r)) best = Math.min(best, rectDistance(g, r));
    for (const fr of scene.groups) {
      if (!fr.drawn || !beside(fr.rect)) continue;
      const r = fr.rect;
      const c = g.h ? g.a.y : g.a.x;
      for (const l of g.h ? [r.y, r.y + r.height] : [r.x, r.x + r.width]) {
        best = Math.min(best, Math.abs(c - l));
      }
    }
    for (const o of others) {
      for (const t of o.segs) {
        if (t.h !== g.h) continue;
        const r = {
          x: Math.min(t.a.x, t.b.x),
          y: Math.min(t.a.y, t.b.y),
          width: Math.abs(t.a.x - t.b.x),
          height: Math.abs(t.a.y - t.b.y),
        };
        if (beside(r)) best = Math.min(best, rectDistance(g, r));
      }
    }
  }
  return best;
}

/**
 * Simplifies each route of `edges` in order where a simpler one is allowed
 * (see the module comment); updates `scene.routes` and returns the
 * replaced routes by edge.
 */
export function simplifyRoutes(
  edges: readonly SimplifyEdge[],
  scene: SimplifyScene,
  /**
   * Called after each replaced route, before the next edge: the caller moves
   * the edge's ends in what it knows (the sides and points ends use), which
   * the next edges' `free.sides` read.
   */
  onChange?: (key: ElementKey, result: Simplified) => void,
): Map<ElementKey, Simplified> {
  const changed = new Map<ElementKey, Simplified>();
  // Every route's segments and bounding box, kept up to date as routes change.
  const cache = new Map<ElementKey, { segs: Seg[]; box: Rect; zones: Rect[] }>();
  const cached = (key: ElementKey, route: readonly Point[]) => {
    const segs = segments(straightened(route));
    const rooms = scene.rooms.get(key);
    const entry = {
      segs,
      box: boxOf(route),
      zones: rooms === undefined ? [] : arrowZones(route, rooms),
    };
    cache.set(key, entry);
    return entry;
  };
  for (const [key, route] of scene.routes) cached(key, route);
  for (const edge of edges) {
    const points = scene.routes.get(edge.key);
    if (points === undefined) continue;
    const result = simplifyEdge(edge, points, scene, cache);
    if (result === undefined) continue;
    scene.routes.set(edge.key, result.points);
    cached(edge.key, result.points);
    changed.set(edge.key, result);
    onChange?.(edge.key, result);
  }
  return changed;
}

/** The bounding box of points. */
function boxOf(points: readonly Point[]): Rect {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

const meets = (a: Rect, b: Rect) =>
  a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;

function simplifyEdge(
  written: SimplifyEdge,
  points: readonly Point[],
  full: SimplifyScene,
  cache: ReadonlyMap<ElementKey, { segs: Seg[]; box: Rect; zones: Rect[] }>,
): Simplified | undefined {
  const bends = bendCount(points);
  if (bends === 0) return undefined;
  // The room before an arrowhead is a preference (the grid search gives it
  // up where it has to): a candidate keeps as much of it as the route had.
  const s = segments(straightened(points));
  const kept = (end: SimplifyEnd, run: number): SimplifyEnd => ({
    ...end,
    room: Math.min(end.room, Math.max(end.lane, run)),
  });
  const edge: SimplifyEdge = {
    ...written,
    from: kept(written.from, length(s[0] as Seg)),
    to: kept(written.to, length(s.at(-1) as Seg)),
  };
  // Every candidate (and every nudge) stays within the box of the route and
  // the ends: only what lies near it is looked at.
  const reach = ENOUGH_CLEARANCE + CLEARANCE + 2;
  const around = boxOf([
    ...points,
    { x: edge.from.rect.x, y: edge.from.rect.y },
    { x: edge.from.rect.x + edge.from.rect.width, y: edge.from.rect.y + edge.from.rect.height },
    { x: edge.to.rect.x, y: edge.to.rect.y },
    { x: edge.to.rect.x + edge.to.rect.width, y: edge.to.rect.y + edge.to.rect.height },
  ]);
  const region = {
    x: around.x - reach,
    y: around.y - reach,
    width: around.width + 2 * reach,
    height: around.height + 2 * reach,
  };
  const own = (key: ElementKey) =>
    key === edge.from.key ||
    key === edge.to.key ||
    full.inside(key, edge.from.key) ||
    full.inside(key, edge.to.key);
  // The nodes in the way: none of the ends' own.
  const nodes = full.nodes.filter((n) => meets(n.rect, region) && !own(n.key));
  const boxes = full.boxes.filter((b) => meets(b, region));
  const local = (relaxed: boolean): LocalScene => ({
    ...full,
    nodes,
    boxes,
    groups: full.groups.filter((g) => meets(g.rect, region)),
    obstacles: [
      ...nodes.flatMap((n) =>
        relaxed && n.soft === true
          ? (n.lines ?? [n.rect]).map((rect) => ({ rect, need: SOFT_CLEARANCE }))
          : [{ rect: n.rect, need: CLEARANCE }],
      ),
      ...boxes.map((rect) => ({ rect, need: CLEARANCE / 2 })),
    ],
  });
  const scene = local(false);
  const others: Other[] = [];
  for (const [key, entry] of cache) {
    if (key === edge.key || full.shares(key, edge.key) || !meets(entry.box, region)) continue;
    others.push({ key, segs: entry.segs, box: entry.box, zones: entry.zones });
  }
  const current = measure(edge, coreOf(edge, points), points, scene, others) as Measure;
  const interior = segments(coreOf(edge, points)).slice(1, -1);
  const hugging =
    bends >= 2 &&
    hugGapOf(
      interior,
      hugLines(
        edge,
        scene,
        others.flatMap((o) => o.segs),
      ),
    ) < HUG_GAP;
  const tiny = jogLengths(points).some((l) => l < TINY_JOG);
  // An end leaves the side the arrange tree gave it (#134) only to mend a
  // route in trouble: a staircase, a tiny jog, a hug or a node's clearance.
  // A plain S or L keeps its sides; sliding along a side is always allowed.
  const troubled = bends >= 3 || tiny || hugging || current.shortfall > EPS;
  // Fewer bends: straight, then L, then Z, the first shape that fits.
  // Each with the full room before an arrowhead first, else with the room the route had.
  const variants = [written, edge];
  const fewer = (sc: LocalScene, base: Measure) => {
    for (let level = 0; level < Math.min(bends, 3); level++) {
      for (const e of variants) {
        const list =
          level === 0 ? straights(e, troubled) : level === 1 ? corners(e, troubled) : zs(e);
        const best = pick(e, list, sc, others, base);
        if (best !== undefined) return best;
      }
    }
    return undefined;
  };
  const best = fewer(scene, current);
  if (best !== undefined) return best;
  // Annotation text (a label attached to a node, a caption) may be passed at
  // half the clearance from its lines (a short line of a centred label
  // leaves room beside it), never touched, where that saves a bend.
  if (nodes.some((n) => n.soft === true)) {
    const relaxed = local(true);
    const base = measure(edge, coreOf(edge, points), points, relaxed, others) as Measure;
    const eased = fewer(relaxed, base);
    if (eased !== undefined) return eased;
  }
  // As many bends: the segments between bends moved off tiny jogs, out of a
  // node's clearance and away from what they hug, where the route has any.
  if (bends < 2 || !troubled) return undefined;
  return nudge(edge, points, scene, others, current);
}

const outlined = (c: Candidate): Point[] => straightened([c.from.outline, ...c.core, c.to.outline]);

/** The best valid candidate of one bend count, if any. */
function pick(
  edge: SimplifyEdge,
  list: readonly Candidate[],
  scene: LocalScene,
  others: readonly Other[],
  current: Measure,
): Simplified | undefined {
  let best: { c: Candidate; points: Point[]; score: number[] } | undefined;
  for (const c of list) {
    const points = outlined(c);
    if (!lanesKept(edge, c) || !cornersRound(edge, c, scene)) continue;
    const m = measure(edge, c.core, points, scene, others, current);
    if (m === undefined || !keepsRules(edge, c, points, scene, others)) continue;
    const score = [
      jogLengths(points).filter((l) => l < TINY_JOG).length,
      c.moved,
      m.shortfall,
      -clearanceOf(edge, segments(c.core).slice(1, -1), scene, others),
      routeLength(points),
    ];
    if (best === undefined || lexLess(score, best.score)) best = { c, points, score };
  }
  if (best === undefined) return undefined;
  return { from: best.c.from, to: best.c.to, points: best.points };
}

/**
 * Moves each segment between two bends across, within the room its
 * neighbours leave, where that removes a tiny jog, brings the route farther
 * from a node it comes too close to, or takes a segment that hugs a frame,
 * node or line to where it has clearly more room. Two passes, in order.
 */
function nudge(
  edge: SimplifyEdge,
  points: readonly Point[],
  scene: LocalScene,
  others: readonly Other[],
  start: Measure,
): Simplified | undefined {
  const lines = hugLines(
    edge,
    scene,
    others.flatMap((o) => o.segs),
  );
  const from = edge.from.current;
  const to = edge.to.current;
  let core = coreOf(edge, points);
  let current = start;
  let moved = false;
  const tinyCount = (c: readonly Point[]) => jogLengths(c).filter((l) => l < TINY_JOG).length;
  /** The segments between bends next to segment `k` (its neighbours change length with it). */
  const local = (c: readonly Point[], k: number) =>
    segments(c)
      .slice(1, -1)
      .slice(Math.max(0, k - 2), k + 1);
  for (let pass = 0; pass < 2; pass++) {
    for (let k = 1; k < segments(core).length - 1; k++) {
      const segs = segments(core);
      const n = segs.length;
      if (k > n - 2) break;
      const seg = segs[k] as Seg;
      const axis = seg.h ? "y" : "x";
      const c0 = (core[k] as Point)[axis];
      const before = (core[k - 1] as Point)[axis];
      const after = (core[k + 2] as Point)[axis];
      const min1 = k - 1 === 0 ? need(edge.from) : 1;
      const min2 = k + 1 === n - 1 ? need(edge.to) : 1;
      let lo = Number.NEGATIVE_INFINITY;
      let hi = Number.POSITIVE_INFINITY;
      if (c0 > before) lo = Math.max(lo, before + min1);
      else hi = Math.min(hi, before - min1);
      if (after > c0) hi = Math.min(hi, after - min2);
      else lo = Math.max(lo, after + min2);
      // A U-turn's middle (its neighbours run opposite ways) is bounded on one
      // side only: it may move in, never out, so no route grows longer.
      if (lo === Number.NEGATIVE_INFINITY) lo = Math.min(c0, hi);
      if (hi === Number.POSITIVE_INFINITY) hi = Math.max(c0, lo);
      if (!(hi >= lo)) continue;
      const interior = (c: readonly Point[]) => segments(c).slice(1, -1);
      // A segment stays on its side of every group border beside it: moving
      // it across one would take the route out of (or into) the group.
      const passesFrame = (g: Seg, from: number, to: number) => {
        const lo2 = Math.min(from, to);
        const hi2 = Math.max(from, to);
        const s0 = g.h ? Math.min(g.a.x, g.b.x) : Math.min(g.a.y, g.b.y);
        const s1 = g.h ? Math.max(g.a.x, g.b.x) : Math.max(g.a.y, g.b.y);
        return scene.groups.some(({ rect: r }) => {
          const [a, b, e0, e1] = g.h
            ? [r.y, r.y + r.height, r.x, r.x + r.width]
            : [r.x, r.x + r.width, r.y, r.y + r.height];
          if (Math.min(s1, e1) - Math.max(s0, e0) <= 0) return false;
          return [a, b].some((line) => line > lo2 - EPS && line < hi2 + EPS);
        });
      };
      const scoreOf = (c: readonly Point[], m: Measure) => [
        tinyCount(c),
        m.shortfall,
        -clearanceOf(edge, local(c, k), scene, others),
        // Then the segment's own room, then the smallest move.
        -clearanceOf(edge, segments(c).slice(k, k + 1), scene, others),
        Math.abs((c[k] as Point)[axis] - c0),
      ];
      const currentScore = scoreOf(core, current);
      const currentHug = hugGapOf(interior(core), lines);
      let best: { core: Point[]; m: Measure; score: number[] } | undefined;
      const samples = 16;
      for (let i = 0; i <= samples; i++) {
        const c = roundUnits(lo + ((hi - lo) * i) / samples);
        if (Math.abs(c - c0) < 1e-3 || passesFrame(seg, c0, c)) continue;
        const next = core.map((p, j) => (j === k || j === k + 1 ? { ...p, [axis]: c } : p));
        const candidate: Candidate = { from, to, core: next, moved: 0 };
        const drawn = outlined(candidate);
        if (!lanesKept(edge, candidate) || !cornersRound(edge, candidate, scene)) continue;
        const m = measure(edge, next, drawn, scene, others, current);
        if (m === undefined || !keepsRules(edge, candidate, drawn, scene, others)) continue;
        const score = scoreOf(next, m);
        if (best === undefined || lexLess(score, best.score)) best = { core: next, m, score };
      }
      if (best === undefined) continue;
      const [t0, s0, c0s] = currentScore as [number, number, number];
      const [t1, s1, c1s] = best.score as [number, number, number];
      const better =
        t1 < t0 ||
        (t1 === t0 && s1 < s0 - EPS) ||
        (t1 === t0 &&
          Math.abs(s1 - s0) <= EPS &&
          currentHug < HUG_GAP &&
          -c1s > -c0s + 1 &&
          hugGapOf(interior(best.core), lines) > currentHug + 1);
      if (!better) continue;
      core = best.core;
      current = best.m;
      moved = true;
    }
  }
  if (!moved) return undefined;
  return { from, to, points: straightened([from.outline, ...core, to.outline]) };
}

function lexLess(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    const d = (a[i] as number) - (b[i] as number);
    if (Math.abs(d) > 1e-6) return d < 0;
  }
  return false;
}

const routeLength = (points: readonly Point[]) =>
  segments(points).reduce((sum, s) => sum + length(s), 0);

// --- Candidates ------------------------------------------------------------------

/** One way an end can be placed: a side and the positions along it, or its current terminal. */
interface Option {
  readonly side: Side | undefined;
  readonly dir: number;
  readonly lo: number;
  readonly hi: number;
  /** The current position along the side (when the side is the current one). */
  readonly current?: number;
  readonly fixed?: Terminal;
  /** 0 on the current side, 2 on another. */
  readonly cost: number;
}

const alongOf = (p: Point, dir: number) => (horizontalDir(dir) ? p.y : p.x);

function options(end: SimplifyEnd, otherSides: boolean): Option[] {
  const t = end.current;
  if (end.free === undefined) {
    const at = alongOf(t.port, t.dir);
    return [{ side: t.side, dir: t.dir, lo: at, hi: at, current: at, fixed: t, cost: 0 }];
  }
  const sides = otherSides ? end.free.sides : end.free.sides.slice(0, 1);
  return sides.map((r) => {
    const dir = SIDE_DIR[r.side];
    const same = r.side === t.side && dir === t.dir;
    return {
      side: r.side,
      dir,
      lo: r.lo,
      hi: r.hi,
      ...(same && { current: alongOf(t.port, t.dir) }),
      cost: same ? 0 : 2,
    };
  });
}

/** The terminal of `end` at `along` with `option`, and what the move costs. */
function place(end: SimplifyEnd, option: Option, along: number): [Terminal, number] | undefined {
  if (option.fixed !== undefined) {
    return Math.abs(along - option.lo) < EPS ? [option.fixed, 0] : undefined;
  }
  if (along < option.lo - EPS || along > option.hi + EPS) return undefined;
  const at = roundUnits(along);
  if (option.current !== undefined && Math.abs(at - option.current) < EPS) return [end.current, 0];
  const free = end.free;
  if (free === undefined || option.side === undefined) return undefined;
  return [free.at(option.side, at), option.cost === 0 ? 1 : option.cost];
}

/** Positions to try within `[lo, hi]`: the preferred ones clamped in, deduplicated, in order. */
function within(lo: number, hi: number, preferred: readonly number[]): number[] {
  if (hi < lo - EPS) return [];
  const out: number[] = [];
  for (const p of [...preferred, (lo + hi) / 2]) {
    const v = Math.min(hi, Math.max(lo, p));
    if (!out.some((o) => Math.abs(o - v) < 1e-3)) out.push(v);
  }
  return out;
}

const middleOf = (o: Option) => o.current ?? (o.lo + o.hi) / 2;

/** Straight lines between facing sides whose positions overlap. */
function straights(edge: SimplifyEdge, otherSides: boolean): Candidate[] {
  const out: Candidate[] = [];
  for (const f of options(edge.from, otherSides)) {
    for (const t of options(edge.to, otherSides)) {
      if (t.dir !== opposite(f.dir)) continue;
      const lo = Math.max(f.lo, t.lo);
      const hi = Math.min(f.hi, t.hi);
      // A fixed end's position; else the middle of the shared span (an end
      // already in it stays put, which the score prefers).
      for (const at of within(lo, hi, [
        ...(f.fixed ? [f.lo] : []),
        ...(t.fixed ? [t.lo] : []),
        (lo + hi) / 2,
        middleOf(f),
        middleOf(t),
      ])) {
        const a = place(edge.from, f, at);
        const b = place(edge.to, t, at);
        if (a === undefined || b === undefined) continue;
        out.push({ from: a[0], to: b[0], core: [a[0].port, b[0].port], moved: a[1] + b[1] });
      }
    }
  }
  return out;
}

/** L shapes: one end leaves along x, the other along y, meeting at a corner. */
function corners(edge: SimplifyEdge, otherSides: boolean): Candidate[] {
  const out: Candidate[] = [];
  for (const f of options(edge.from, otherSides)) {
    for (const t of options(edge.to, otherSides)) {
      if (horizontalDir(f.dir) === horizontalDir(t.dir)) continue;
      const df = DIRS[f.dir] as Point;
      const dt = DIRS[t.dir] as Point;
      // The corner is at (the to-end's position, the from-end's position)
      // when the from-end leaves along x, the other way round along y. The
      // from-end's position must lie beyond the to-end's side by its lane,
      // and the to-end's position beyond the from-end's side by its lane.
      const fromSideAt = horizontalDir(f.dir)
        ? f.fixed
          ? f.fixed.port.x
          : sideCoordinate(edge.from.rect, f.side as Side)
        : f.fixed
          ? f.fixed.port.y
          : sideCoordinate(edge.from.rect, f.side as Side);
      const toSideAt = horizontalDir(t.dir)
        ? t.fixed
          ? t.fixed.port.x
          : sideCoordinate(edge.to.rect, t.side as Side)
        : t.fixed
          ? t.fixed.port.y
          : sideCoordinate(edge.to.rect, t.side as Side);
      // Along f's axis (perpendicular to f's side): the corner coordinate is
      // t's position; it must be at least need(from) out of f's side.
      const fSign = horizontalDir(f.dir) ? df.x : df.y;
      const tSign = horizontalDir(t.dir) ? dt.x : dt.y;
      const tRange = bound(t.lo, t.hi, fromSideAt + fSign * need(edge.from), fSign);
      const fRange = bound(f.lo, f.hi, toSideAt + tSign * need(edge.to), tSign);
      if (tRange === undefined || fRange === undefined) continue;
      for (const fa of within(fRange[0], fRange[1], [middleOf(f)])) {
        for (const ta of within(tRange[0], tRange[1], [middleOf(t)])) {
          const a = place(edge.from, f, fa);
          const b = place(edge.to, t, ta);
          if (a === undefined || b === undefined) continue;
          const p = a[0].port;
          const q = b[0].port;
          const corner = horizontalDir(f.dir) ? { x: q.x, y: p.y } : { x: p.x, y: q.y };
          out.push({ from: a[0], to: b[0], core: [p, corner, q], moved: a[1] + b[1] });
        }
      }
    }
  }
  return out;
}

/** `[lo, hi]` cut to the positions at least `limit` (sign +1) or at most `limit` (sign −1). */
function bound(lo: number, hi: number, limit: number, sign: number): [number, number] | undefined {
  const l = sign > 0 ? Math.max(lo, limit) : lo;
  const h = sign > 0 ? hi : Math.min(hi, limit);
  return h < l - EPS ? undefined : [l, h];
}

/** The coordinate of a side's line (x of east / west, y of north / south). */
function sideCoordinate(r: Rect, side: Side): number {
  switch (side) {
    case "east":
      return r.x + r.width;
    case "west":
      return r.x;
    case "south":
      return r.y + r.height;
    case "north":
      return r.y;
  }
}

/** Z shapes between the current facing ports, the middle segment at sampled positions. */
function zs(edge: SimplifyEdge): Candidate[] {
  const f = edge.from.current;
  const t = edge.to.current;
  if (f.dir < 0 || t.dir !== opposite(f.dir)) return [];
  const d = DIRS[f.dir] as Point;
  const p = f.port;
  const q = t.port;
  const ahead = (q.x - p.x) * d.x + (q.y - p.y) * d.y;
  const nf = need(edge.from);
  const nt = need(edge.to);
  if (ahead < nf + nt - EPS) return [];
  const start = horizontalDir(f.dir) ? p.x : p.y;
  const lo = Math.min(start + d.x * nf + d.y * nf, start + (ahead - nt) * (d.x + d.y));
  const hi = Math.max(start + d.x * nf + d.y * nf, start + (ahead - nt) * (d.x + d.y));
  const samples = new Set<number>();
  // Evenly across the channel, the middle first.
  const n = 16;
  for (let i = 0; i <= n; i++) samples.add(roundUnits(lo + ((hi - lo) * i) / n));
  const out: Candidate[] = [];
  const mid = (lo + hi) / 2;
  for (const m of [...samples].sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid) || a - b)) {
    const core = horizontalDir(f.dir)
      ? [p, { x: m, y: p.y }, { x: m, y: q.y }, q]
      : [p, { x: p.x, y: m }, { x: q.x, y: m }, q];
    out.push({ from: f, to: t, core, moved: 0 });
  }
  return out;
}
