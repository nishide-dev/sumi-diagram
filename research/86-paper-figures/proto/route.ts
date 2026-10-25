/**
 * Orthogonal edge routing (#86 prototype) on a sparse "Hanan" grid built from
 * obstacle borders, ports and gutter midlines; Dijkstra over (point,
 * direction) with bend, container-crossing, crossing and overlap costs.
 *
 * Edges that leave the same port (or touch the same junction) form one *net*
 * and may share segments for free: this yields fan-outs and shared trunks
 * without a separate bundling step. Fully deterministic: integer-indexed
 * grid, ties broken by insertion order.
 */
import type { Layout, Rect } from "./layout";
import type { Anchor, EdgeDef, Model, Side } from "./model";

export const ROUTE = {
  clearance: 6, // obstacle inflation (3pt)
  bend: 40,
  group: 150,
  cross: 80,
  overlap: 4000,
};

export interface Point {
  x: number;
  y: number;
}

export interface RoutedEdge {
  edge: EdgeDef;
  net: string;
  points: Point[];
  /** Side of the target the path enters, if the target is not a junction. */
  toSide: Side | undefined;
  fromSide: Side | undefined;
}

const NORMAL: Record<Side, Point> = {
  north: { x: 0, y: -1 },
  south: { x: 0, y: 1 },
  east: { x: 1, y: 0 },
  west: { x: -1, y: 0 },
};
/** dir index: 0 = +x, 1 = +y, 2 = -x, 3 = -y */
const DIRS: Point[] = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
];
const dirOf = (v: Point): number => DIRS.findIndex((d) => d.x === v.x && d.y === v.y);

export function anchorPoint(r: Rect, a: Anchor): Point {
  switch (a.side) {
    case "north":
      return { x: r.x + r.w * a.offset, y: r.y };
    case "south":
      return { x: r.x + r.w * a.offset, y: r.y + r.h };
    case "west":
      return { x: r.x, y: r.y + r.h * a.offset };
    case "east":
      return { x: r.x + r.w, y: r.y + r.h * a.offset };
  }
}

const center = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** Default side: toward the other end, along the dominant axis. */
function defaultSide(from: Rect, to: Rect): Side {
  const a = center(from);
  const b = center(to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dy) >= Math.abs(dx)) return dy < 0 ? "north" : "south";
  return dx < 0 ? "west" : "east";
}

interface End {
  point: Point;
  /** Outward normal, or undefined for a junction (free direction). */
  normal: Point | undefined;
  side: Side | undefined;
}

class Heap {
  private readonly keys: number[] = [];
  private readonly vals: number[] = [];
  get size(): number {
    return this.keys.length;
  }
  push(key: number, val: number): void {
    const k = this.keys;
    const v = this.vals;
    k.push(key);
    v.push(val);
    let i = k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if ((k[p] as number) < key || ((k[p] as number) === key && (v[p] as number) <= val)) break;
      k[i] = k[p] as number;
      v[i] = v[p] as number;
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }
  pop(): [number, number] {
    const k = this.keys;
    const v = this.vals;
    const top: [number, number] = [k[0] as number, v[0] as number];
    const lk = k.pop() as number;
    const lv = v.pop() as number;
    if (k.length > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        let mk = lk;
        let mv = lv;
        if (
          l < k.length &&
          ((k[l] as number) < mk || ((k[l] as number) === mk && (v[l] as number) < mv))
        ) {
          m = l;
          mk = k[l] as number;
          mv = v[l] as number;
        }
        if (
          r < k.length &&
          ((k[r] as number) < mk || ((k[r] as number) === mk && (v[r] as number) < mv))
        ) {
          m = r;
        }
        if (m === i) break;
        k[i] = k[m] as number;
        v[i] = v[m] as number;
        i = m;
      }
      k[i] = lk;
      v[i] = lv;
    }
    return top;
  }
}

export function routeEdges(model: Model, layout: Layout): RoutedEdge[] {
  const C = ROUTE.clearance;
  const rectOf = (id: string): Rect => layout.nodes.get(id) as Rect;
  const isJunction = (id: string) => model.nodes.get(id)?.component === "junction";
  const obstacles: Rect[] = [];
  for (const [id, r] of layout.nodes) {
    if (isJunction(id)) continue;
    obstacles.push({ x: r.x - C, y: r.y - C, w: r.w + 2 * C, h: r.h + 2 * C });
  }
  const groupRects = [...layout.groups.values()];

  const endOf = (id: string, anchor: Anchor | undefined, other: string): End => {
    const r = rectOf(id);
    if (isJunction(id)) return { point: center(r), normal: undefined, side: undefined };
    const a = anchor ?? { side: defaultSide(r, rectOf(other)), offset: 0.5 };
    return { point: anchorPoint(r, a), normal: NORMAL[a.side], side: a.side };
  };
  const stub = (e: End): Point =>
    e.normal === undefined
      ? e.point
      : { x: e.point.x + e.normal.x * C, y: e.point.y + e.normal.y * C };

  const ends = model.edges.map((edge) => {
    const from = endOf(edge.from, edge.fromAnchor, edge.to);
    const to = endOf(edge.to, edge.toAnchor, edge.from);
    return { edge, from, to };
  });

  // Grid coordinates.
  const xs = new Set<number>();
  const ys = new Set<number>();
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  for (const o of obstacles) {
    xs.add(r3(o.x)).add(r3(o.x + o.w));
    ys.add(r3(o.y)).add(r3(o.y + o.h));
  }
  for (const g of groupRects) {
    xs.add(r3(g.x)).add(r3(g.x + g.w));
    ys.add(r3(g.y)).add(r3(g.y + g.h));
  }
  for (const { from, to } of ends)
    for (const p of [stub(from), stub(to)]) {
      xs.add(r3(p.x));
      ys.add(r3(p.y));
    }
  const withMid = (set: Set<number>): number[] => {
    const sorted = [...set].sort((a, b) => a - b);
    const out = [...sorted];
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1] as number;
      const b = sorted[i] as number;
      if (b - a > 2) out.push(r3((a + b) / 2));
    }
    return [...new Set(out)].sort((a, b) => a - b);
  };
  const X = withMid(xs);
  const Y = withMid(ys);
  const NX = X.length;
  const NY = Y.length;
  const idx = (i: number, j: number) => j * NX + i;
  const inside = (x: number, y: number) =>
    obstacles.some(
      (o) => x > o.x + 1e-6 && x < o.x + o.w - 1e-6 && y > o.y + 1e-6 && y < o.y + o.h - 1e-6,
    );
  const free = new Uint8Array(NX * NY);
  for (let j = 0; j < NY; j++)
    for (let i = 0; i < NX; i++) free[idx(i, j)] = inside(X[i] as number, Y[j] as number) ? 0 : 1;
  /** Grid edge between point p and its neighbour in direction d is usable. */
  const edgeFree = (i: number, j: number, d: number): boolean => {
    const ni = i + (DIRS[d] as Point).x;
    const nj = j + (DIRS[d] as Point).y;
    if (ni < 0 || nj < 0 || ni >= NX || nj >= NY || free[idx(ni, nj)] === 0) return false;
    const mx = ((X[i] as number) + (X[ni] as number)) / 2;
    const my = ((Y[j] as number) + (Y[nj] as number)) / 2;
    return !inside(mx, my);
  };
  /** Number of group borders crossed by the unit grid step. */
  const groupCrossings = (i: number, j: number, ni: number, nj: number): number => {
    const ax = X[i] as number;
    const ay = Y[j] as number;
    const bx = X[ni] as number;
    const by = Y[nj] as number;
    let n = 0;
    for (const g of groupRects) {
      const inA = ax > g.x && ax < g.x + g.w && ay > g.y && ay < g.y + g.h;
      const inB = bx > g.x && bx < g.x + g.w && by > g.y && by < g.y + g.h;
      if (inA !== inB) n++;
    }
    return n;
  };

  // Occupancy by net: grid step key → net; point → nets passing horizontally / vertically.
  const stepNet = new Map<number, string>();
  const hNets = new Map<number, Set<string>>();
  const vNets = new Map<number, Set<string>>();
  const stepKey = (a: number, b: number) => (a < b ? a * NX * NY + b : b * NX * NY + a);
  const occupy = (map: Map<number, Set<string>>, p: number, net: string) => {
    const s = map.get(p) ?? new Set<string>();
    s.add(net);
    map.set(p, s);
  };
  const others = (map: Map<number, Set<string>>, p: number, net: string) => {
    const s = map.get(p);
    return s !== undefined && [...s].some((n) => n !== net);
  };

  const locate = (p: Point): number => {
    const i = X.indexOf(r3(p.x));
    const j = Y.indexOf(r3(p.y));
    if (i < 0 || j < 0) throw new Error(`port off grid ${p.x},${p.y}`);
    return idx(i, j);
  };

  const netOf = (edge: EdgeDef, from: End): string => {
    if (isJunction(edge.from)) return `j:${edge.from}`;
    if (isJunction(edge.to)) return `j:${edge.to}`;
    return `p:${edge.from}@${from.point.x},${from.point.y}`;
  };

  const routed: RoutedEdge[] = [];
  for (const { edge, from, to } of ends) {
    const net = netOf(edge, from);
    // Facing, aligned ports with a clear straight line between them (stack
    // neighbours, possibly closer than 2 × clearance): a straight connector.
    const straight =
      from.normal !== undefined &&
      to.normal !== undefined &&
      from.normal.x === -to.normal.x &&
      from.normal.y === -to.normal.y &&
      (from.normal.x === 0
        ? Math.abs(from.point.x - to.point.x) < 1e-6 &&
          (to.point.y - from.point.y) * from.normal.y > 0
        : Math.abs(from.point.y - to.point.y) < 1e-6 &&
          (to.point.x - from.point.x) * from.normal.x > 0);
    if (straight) {
      const solidHit = [...layout.nodes].some(([id, r]) => {
        if (id === edge.from || id === edge.to || isJunction(id)) return false;
        const minX = Math.min(from.point.x, to.point.x);
        const maxX = Math.max(from.point.x, to.point.x);
        const minY = Math.min(from.point.y, to.point.y);
        const maxY = Math.max(from.point.y, to.point.y);
        return maxX > r.x && minX < r.x + r.w && maxY > r.y && minY < r.y + r.h;
      });
      if (!solidHit) {
        routed.push({
          edge,
          net,
          points: [from.point, to.point],
          toSide: to.side,
          fromSide: from.side,
        });
        continue;
      }
    }
    const s = locate(stub(from));
    const t = locate(stub(to));
    const startDir = from.normal === undefined ? -1 : dirOf(from.normal);
    const inward = to.normal === undefined ? -1 : dirOf({ x: -to.normal.x, y: -to.normal.y });
    const states = NX * NY * 5;
    const dist = new Float64Array(states).fill(Number.POSITIVE_INFINITY);
    const prev = new Int32Array(states).fill(-1);
    const heap = new Heap();
    const sid = s * 5 + (startDir + 1);
    dist[sid] = 0;
    heap.push(0, sid);
    let best = Number.POSITIVE_INFINITY;
    let bestState = -1;
    while (heap.size > 0) {
      const [d, state] = heap.pop();
      if (d > (dist[state] as number)) continue;
      if (d >= best) break;
      const p = Math.floor(state / 5);
      const dir = (state % 5) - 1;
      if (p === t) {
        const total = d + (inward >= 0 && dir !== inward && dir >= 0 ? ROUTE.bend : 0);
        if (total < best) {
          best = total;
          bestState = state;
        }
        continue;
      }
      const i = p % NX;
      const j = Math.floor(p / NX);
      for (let nd = 0; nd < 4; nd++) {
        if (dir >= 0 && nd === (dir + 2) % 4) continue; // no U-turn in place
        if (!edgeFree(i, j, nd)) continue;
        const ni = i + (DIRS[nd] as Point).x;
        const nj = j + (DIRS[nd] as Point).y;
        const q = idx(ni, nj);
        const len =
          Math.abs((X[ni] as number) - (X[i] as number)) +
          Math.abs((Y[nj] as number) - (Y[j] as number));
        const owner = stepNet.get(stepKey(p, q));
        let cost: number;
        if (owner === net)
          cost = 0; // shared trunk of the same net
        else {
          cost = len;
          if (owner !== undefined) cost += ROUTE.overlap;
          if (dir >= 0 && nd !== dir) cost += ROUTE.bend;
          cost += ROUTE.group * groupCrossings(i, j, ni, nj);
          const horizontal = nd % 2 === 0;
          if (others(horizontal ? vNets : hNets, q, net)) cost += ROUTE.cross;
        }
        const ns = q * 5 + (nd + 1);
        const nd2 = d + cost;
        if (nd2 < (dist[ns] as number)) {
          dist[ns] = nd2;
          prev[ns] = state;
          heap.push(nd2, ns);
        }
      }
    }
    if (bestState < 0) throw new Error(`no route for edge ${edge.index} ${edge.from}->${edge.to}`);
    const cells: number[] = [];
    for (let st = bestState; st >= 0; st = prev[st] as number) cells.push(Math.floor(st / 5));
    cells.reverse();
    for (let k = 1; k < cells.length; k++) {
      const a = cells[k - 1] as number;
      const b = cells[k] as number;
      stepNet.set(stepKey(a, b), net);
      const horizontal = Math.floor(a / NX) === Math.floor(b / NX);
      for (const c of [a, b]) occupy(horizontal ? hNets : vNets, c, net);
    }
    const pts: Point[] = [from.point];
    for (const c of cells) pts.push({ x: X[c % NX] as number, y: Y[Math.floor(c / NX)] as number });
    pts.push(to.point);
    routed.push({ edge, net, points: simplify(pts), toSide: to.side, fromSide: from.side });
  }
  return routed;
}

/** Drops duplicate and collinear interior points. */
export function simplify(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out.at(-1);
    if (last !== undefined && Math.abs(last.x - p.x) < 1e-9 && Math.abs(last.y - p.y) < 1e-9)
      continue;
    out.push(p);
    while (out.length >= 3) {
      const a = out[out.length - 3] as Point;
      const b = out[out.length - 2] as Point;
      const c = out[out.length - 1] as Point;
      const collinear =
        (Math.abs(a.x - b.x) < 1e-9 && Math.abs(b.x - c.x) < 1e-9) ||
        (Math.abs(a.y - b.y) < 1e-9 && Math.abs(b.y - c.y) < 1e-9);
      if (!collinear) break;
      out.splice(out.length - 2, 1);
    }
  }
  return out;
}
