// Edge-routing defect yardstick for the #603 dogfooding figures.
// Run from the repo root: SUMI_D2_PATH=$PWD/.sumi/bin/d2 bun research/603-dogfood-v0.19/routes/measure.ts
// 1 unit = 0.5pt; 1mm = 5.6693 units.
// biome-ignore-all lint/suspicious/noExplicitAny: a one-off measurement script over loosely typed layout data
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ElementKey } from "../../../src/core/check-state";
import type { EdgeLayout, LayoutIR, Point, Rect } from "../../../src/layout/ir";
import { renderFigure } from "../../../src/render/render";

const MM = 72 / 25.4 / 0.5; // units per mm
const mm = (u: number) => Math.round((u / MM) * 100) / 100;
const MARGIN = 6; // port margin (STRAIGHT_MARGIN in ports.ts)
const TINY_JOG = 2 * MM;
const SHORT_JOG = 4 * MM; // reported separately from tiny jogs
const LOOSE_DIST = 6 * MM; // group-frame proximity, looser tier
const HUG_DIST = 1.5 * MM;
const HUG_LEN = 3 * MM;
const OVERLAP_EPS = 0.5; // collinear tolerance in units
const OVERLAP_MIN = 0.5 * MM;

type Seg = { a: Point; b: Point; horiz: boolean };

function simplify(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out.at(-1);
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < 1e-6) continue;
    const a = out.at(-2);
    if (a && last) {
      const cross = (last.x - a.x) * (p.y - last.y) - (last.y - a.y) * (p.x - last.x);
      if (Math.abs(cross) < 1e-6) out.pop();
    }
    out.push(p);
  }
  return out;
}
function segs(points: Point[]): Seg[] {
  const out: Seg[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i] as Point;
    const b = points[i + 1] as Point;
    out.push({ a, b, horiz: Math.abs(a.y - b.y) < Math.abs(a.x - b.x) });
  }
  return out;
}
const len = (s: Seg) => Math.hypot(s.a.x - s.b.x, s.a.y - s.b.y);
const rnd = (n: number) => Math.round(n * 100) / 100;
const pt = (p: Point) => [rnd(p.x), rnd(p.y)];

function segHitsRect(a: Point, b: Point, r: Rect, pad = 0): boolean {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  return x1 > r.x - pad && x0 < r.x + r.width + pad && y1 > r.y - pad && y0 < r.y + r.height + pad;
}

function crossesOrthSeg(a: Point, b: Point, s: Seg): boolean {
  // a-b axis-parallel; true if it properly crosses or overlaps s (axis-parallel)
  const ah = Math.abs(a.y - b.y) < 1e-6;
  const lo = (p: number, q: number) => Math.min(p, q);
  const hi = (p: number, q: number) => Math.max(p, q);
  if (ah === s.horiz) {
    if (ah) {
      return (
        Math.abs(a.y - s.a.y) < 1 &&
        hi(a.x, b.x) > lo(s.a.x, s.b.x) &&
        lo(a.x, b.x) < hi(s.a.x, s.b.x)
      );
    }
    return (
      Math.abs(a.x - s.a.x) < 1 &&
      hi(a.y, b.y) > lo(s.a.y, s.b.y) &&
      lo(a.y, b.y) < hi(s.a.y, s.b.y)
    );
  }
  const [h, v] = ah ? [{ a, b }, s] : [s, { a, b }];
  const hy = h.a.y;
  const vx = v.a.x;
  return (
    vx > lo(h.a.x, h.b.x) + 0.01 &&
    vx < hi(h.a.x, h.b.x) - 0.01 &&
    hy > lo(v.a.y, v.b.y) + 0.01 &&
    hy < hi(v.a.y, v.b.y) - 0.01
  );
}

interface Ctx {
  layout: LayoutIR;
  rects: Map<string, Rect>;
  labelRects: { edge: string; rect: Rect }[];
  nodeRects: { key: string; rect: Rect }[];
  allSegs: Map<string, Seg[]>;
  net: Map<string, number | undefined>;
  parent: Map<string, string | undefined>;
}

function minimalBends(
  e: EdgeLayout,
  c: Ctx,
): { min: number | null; note: string; unverified?: boolean } {
  const A = c.rects.get(e.from);
  const B = c.rects.get(e.to);
  if (!A || !B) return { min: null, note: "unknown endpoint" };
  const inside = (key: string, anc: string) => {
    for (let k: string | undefined = key; k; k = c.parent.get(k)) if (k === anc) return true;
    return false;
  };
  if (inside(e.from, e.to) || inside(e.to, e.from)) return { min: null, note: "nested endpoints" };
  const obstacles = [
    ...c.nodeRects
      .filter((n) => !inside(n.key, e.from) && !inside(n.key, e.to) && n.rect.width > 2)
      .map((n) => n.rect),
    ...c.labelRects.filter((l) => l.edge !== e.key).map((l) => l.rect),
  ];
  const clear = (a: Point, b: Point) => !obstacles.some((r) => segHitsRect(a, b, r, 0.5));
  const others = [...c.allSegs.entries()].filter(
    ([k]) => k !== e.key && (c.net.get(k) === undefined || c.net.get(k) !== c.net.get(e.key)),
  );
  const notCrossing = (a: Point, b: Point) =>
    !others.some(([, ss]) => ss.some((s) => crossesOrthSeg(a, b, s)));
  const ov = (lo1: number, hi1: number, lo2: number, hi2: number) =>
    [Math.max(lo1, lo2), Math.min(hi1, hi2)] as const;
  const samples = (lo: number, hi: number) => {
    const out: number[] = [];
    const l = hi - lo;
    const m = Math.min(MARGIN, l / 2);
    for (let i = 0; i <= 6; i++) out.push(lo + m + ((l - 2 * m) * i) / 6);
    return out;
  };
  // 0 bends
  const [yl, yh] = ov(A.y, A.y + A.height, B.y, B.y + B.height);
  const [xl, xh] = ov(A.x, A.x + A.width, B.x, B.x + B.width);
  const degenerate = A.width < 2 || A.height < 2 || B.width < 2 || B.height < 2;
  const okSpan = (lo: number, hi: number) => (degenerate ? hi - lo >= -0.01 : hi - lo > MARGIN);
  if (okSpan(yl, yh) && (A.x + A.width <= B.x || B.x + B.width <= A.x)) {
    const x1 = A.x + A.width <= B.x ? A.x + A.width : A.x;
    const x2 = A.x + A.width <= B.x ? B.x : B.x + B.width;
    for (const y of degenerate ? [(yl + yh) / 2] : samples(yl, yh))
      if (clear({ x: x1, y }, { x: x2, y }) && notCrossing({ x: x1, y }, { x: x2, y }))
        return { min: 0, note: `straight horizontal at y=${rnd(y)}` };
  }
  if (okSpan(xl, xh) && (A.y + A.height <= B.y || B.y + B.height <= A.y)) {
    const y1 = A.y + A.height <= B.y ? A.y + A.height : A.y;
    const y2 = A.y + A.height <= B.y ? B.y : B.y + B.height;
    for (const x of degenerate ? [(xl + xh) / 2] : samples(xl, xh))
      if (clear({ x, y: y1 }, { x, y: y2 }) && notCrossing({ x, y: y1 }, { x, y: y2 }))
        return { min: 0, note: `straight vertical at x=${rnd(x)}` };
  }
  // 1 bend (L), either corner; corner x in B's span / y in A's span etc.
  const cx = (r: Rect) => r.x + r.width / 2;
  const cy = (r: Rect) => r.y + r.height / 2;
  const tries: [Point, Point, Point][] = [];
  for (const ay of samples(A.y, A.y + A.height))
    for (const bx of samples(B.x, B.x + B.width)) {
      // A leaves horizontally (east/west side) at y=ay, enters B vertically at x=bx
      const sx = bx > cx(A) ? A.x + A.width : A.x;
      const ty = ay < cy(B) ? B.y : B.y + B.height;
      if (Math.abs(ay - ty) < 1) continue;
      if ((bx - sx) * (bx > cx(A) ? 1 : -1) <= 0) continue;
      if (ay < cy(B) !== ay < B.y + (ay < cy(B) ? 0 : B.height)) continue;
      if (ay < cy(B) ? ay >= B.y : ay <= B.y + B.height) continue;
      tries.push([
        { x: sx, y: ay },
        { x: bx, y: ay },
        { x: bx, y: ty },
      ]);
    }
  for (const ax of samples(A.x, A.x + A.width))
    for (const by of samples(B.y, B.y + B.height)) {
      const sy = by > cy(A) ? A.y + A.height : A.y;
      const tx = ax < cx(B) ? B.x : B.x + B.width;
      if ((by - sy) * (by > cy(A) ? 1 : -1) <= 0) continue;
      if (ax < cx(B) ? ax >= B.x : ax <= B.x + B.width) continue;
      tries.push([
        { x: ax, y: sy },
        { x: ax, y: by },
        { x: tx, y: by },
      ]);
    }
  for (const [p, q, r] of tries)
    if (clear(p, q) && clear(q, r)) return { min: 1, note: `L via (${rnd(q.x)},${rnd(q.y)})` };
  // 2 bends (Z, either orientation), corner lines in the gap between the facing sides.
  const gapSamples = (lo: number, hi: number) =>
    [1, 2, 3, 4, 5].map((i) => lo + ((hi - lo) * i) / 6);
  const ys = samples(A.y, A.y + A.height);
  const yt = samples(B.y, B.y + B.height);
  const xs = samples(A.x, A.x + A.width);
  const xt = samples(B.x, B.x + B.width);
  if (A.x + A.width <= B.x || B.x + B.width <= A.x) {
    const east = A.x + A.width <= B.x;
    const x1 = east ? A.x + A.width : A.x;
    const x2 = east ? B.x : B.x + B.width;
    for (const mx of gapSamples(Math.min(x1, x2), Math.max(x1, x2)))
      for (const ay of ys)
        for (const by of yt)
          if (
            clear({ x: x1, y: ay }, { x: mx, y: ay }) &&
            clear({ x: mx, y: ay }, { x: mx, y: by }) &&
            clear({ x: mx, y: by }, { x: x2, y: by })
          )
            return { min: 2, note: `Z via x=${rnd(mx)} (y ${rnd(ay)}->${rnd(by)})` };
  }
  if (A.y + A.height <= B.y || B.y + B.height <= A.y) {
    const down = A.y + A.height <= B.y;
    const y1 = down ? A.y + A.height : A.y;
    const y2 = down ? B.y : B.y + B.height;
    for (const my of gapSamples(Math.min(y1, y2), Math.max(y1, y2)))
      for (const ax of xs)
        for (const bx of xt)
          if (
            clear({ x: ax, y: y1 }, { x: ax, y: my }) &&
            clear({ x: ax, y: my }, { x: bx, y: my }) &&
            clear({ x: bx, y: my }, { x: bx, y: y2 })
          )
            return { min: 2, note: `Z via y=${rnd(my)} (x ${rnd(ax)}->${rnd(bx)})` };
  }
  return {
    min: 2,
    note: ">=2 (no straight/L/Z found; lower bound, unverified)",
    unverified: true,
  } as { min: number; note: string; unverified?: boolean };
}

async function analyse(name: string, file: string) {
  const text = readFileSync(file, "utf8");
  // The same layout the SVG is drawn from (renderFigure), not a bare layoutStructuredFigure call.
  const res = await renderFigure(text, { assetBase: join(file, "..") });
  if (!res.ok) throw new Error(`${name}: ${JSON.stringify(res.diagnostics).slice(0, 400)}`);
  if (!("layout" in res.value)) throw new Error(`${name}: not structured`);
  const layout = res.value.layout;
  const ir = res.value.compiled.ir;
  const rects = new Map<string, Rect>();
  for (const n of layout.nodes) rects.set(n.key, n.rect);
  for (const g of layout.groups) rects.set(g.key, g.rect);
  const irEdge = new Map(ir.edges.map((e) => [e.key, e]));
  const kindOf = (e: EdgeLayout): "orthogonal" | "straight" | "curve" | "zoom" => {
    const i = irEdge.get(e.key);
    if (i?.routing === "zoom" || e.route?.lines) return "zoom";
    if (i?.route === "curve") return "curve";
    if (i?.route === "straight") return "straight";
    return "orthogonal";
  };
  const labelRects = layout.edges.flatMap((e) =>
    e.route?.label ? [{ edge: e.key, rect: e.route.label.box }] : [],
  );
  const kinds = new Map(layout.edges.map((e) => [e.key, kindOf(e)] as const));
  const simp = new Map<string, Point[]>();
  const allSegs = new Map<string, Seg[]>();
  const net = new Map<string, number | undefined>();
  for (const e of layout.edges) {
    net.set(e.key, e.route?.net);
    if (kinds.get(e.key) !== "orthogonal" || !e.route) continue;
    const s = simplify(e.route.points);
    simp.set(e.key, s);
    allSegs.set(e.key, segs(s));
  }
  const ctx: Ctx = {
    layout,
    rects,
    labelRects,
    nodeRects: layout.nodes.map((n) => ({ key: n.key, rect: n.rect })),
    allSegs,
    net,
    parent: new Map([...layout.nodes, ...layout.groups].map((n) => [n.key, n.parent] as const)),
  };
  const idOf = (e: EdgeLayout) =>
    irEdge.get(e.key)?.id ?? `${e.key} ${e.from.slice(2)}->${e.to.slice(2)}`;
  const edges: any[] = [];
  const edgeById = new Map(layout.edges.map((e) => [e.key, e]));
  for (const e of layout.edges) {
    const kind = kinds.get(e.key) as string;
    const rec: any = {
      key: e.key,
      id: idOf(e),
      from: e.from,
      to: e.to,
      kind,
      fromAnchor: e.fromAnchor ?? null,
      toAnchor: e.toAnchor ?? null,
      anchored: !!(e.fromAnchor || e.toAnchor),
      fromSide: e.route?.fromSide ?? null,
      toSide: e.route?.toSide ?? null,
    };
    if (kind !== "orthogonal" || !e.route) {
      rec.points = e.route?.points.map(pt);
      edges.push(rec);
      continue;
    }
    const s = simp.get(e.key) as Point[];
    const ss = allSegs.get(e.key) as Seg[];
    rec.points = s.map(pt);
    rec.bends = Math.max(0, s.length - 2);
    rec.lengthMm = mm(ss.reduce((a, x) => a + len(x), 0));
    const m = minimalBends(e, ctx);
    rec.minBends = m.min;
    rec.minNote = m.note;
    rec.minUnverified = m.unverified === true;
    const excess = m.min !== null && rec.bends > m.min;
    rec.avoidable = excess && !rec.minUnverified;
    rec.avoidableUnverified = excess && rec.minUnverified;
    rec.avoidableDueToAnchor = rec.avoidable && rec.anchored;
    rec.endStubs = [];
    if (ss.length >= 2) {
      const first = ss[0] as Seg;
      const last = ss.at(-1) as Seg;
      if (len(first) < SHORT_JOG)
        rec.endStubs.push({ end: "from", mm: mm(len(first)), at: [pt(first.a), pt(first.b)] });
      if (len(last) < SHORT_JOG)
        rec.endStubs.push({ end: "to", mm: mm(len(last)), at: [pt(last.a), pt(last.b)] });
    }
    rec.tinyJogs = [];
    rec.shortJogs = [];
    for (let i = 1; i + 1 < ss.length - 0; i++) {
      if (i === 0 || i === ss.length - 1) continue;
      const l = len(ss[i] as Seg);
      if (l < SHORT_JOG && l >= TINY_JOG)
        rec.shortJogs.push({ at: [pt((ss[i] as Seg).a), pt((ss[i] as Seg).b)], mm: mm(l) });
      if (l < TINY_JOG)
        rec.tinyJogs.push({ at: [pt((ss[i] as Seg).a), pt((ss[i] as Seg).b)], mm: mm(l) });
    }
    edges.push(rec);
  }
  const byKey = new Map(edges.map((e) => [e.key, e]));
  // overlaps & hugging between edge pairs
  const overlaps: any[] = [];
  const irElement = (k: string) => ir.elements.get(k as never);
  const hugs: any[] = [];
  const loose: any[] = [];
  const keys = [...allSegs.keys()];
  for (let i = 0; i < keys.length; i++)
    for (let j = i + 1; j < keys.length; j++) {
      const ea = edgeById.get(keys[i] as ElementKey) as EdgeLayout;
      const eb = edgeById.get(keys[j] as ElementKey) as EdgeLayout;
      const sameNet = ea.route?.net !== undefined && ea.route.net === eb.route?.net;
      const sharePort =
        (ea.from === eb.from && ea.route?.fromSide === eb.route?.fromSide) ||
        (ea.to === eb.to && ea.route?.toSide === eb.route?.toSide);
      const trunk = sameNet || sharePort;
      let ovLen = 0;
      const ovAt: any[] = [];
      for (const sa of allSegs.get(ea.key) as Seg[])
        for (const sb of allSegs.get(eb.key) as Seg[]) {
          if (sa.horiz !== sb.horiz) continue;
          const [c1, c2] = sa.horiz ? [sa.a.y, sb.a.y] : [sa.a.x, sb.a.x];
          const [a0, a1] = sa.horiz
            ? [Math.min(sa.a.x, sa.b.x), Math.max(sa.a.x, sa.b.x)]
            : [Math.min(sa.a.y, sa.b.y), Math.max(sa.a.y, sa.b.y)];
          const [b0, b1] = sb.horiz
            ? [Math.min(sb.a.x, sb.b.x), Math.max(sb.a.x, sb.b.x)]
            : [Math.min(sb.a.y, sb.b.y), Math.max(sb.a.y, sb.b.y)];
          const along = Math.min(a1, b1) - Math.max(a0, b0);
          const d = Math.abs(c1 - c2);
          if (d <= OVERLAP_EPS && along > OVERLAP_MIN) {
            ovLen += along;
            ovAt.push({
              axis: sa.horiz ? "y" : "x",
              coord: rnd(c1),
              from: rnd(Math.max(a0, b0)),
              to: rnd(Math.min(a1, b1)),
              mm: mm(along),
            });
          } else if (d > OVERLAP_EPS && d <= HUG_DIST && along > HUG_LEN) {
            hugs.push({
              kind: sameNet ? "edge-edge-same-net" : "edge-edge",
              a: idOf(ea),
              b: idOf(eb),
              gapMm: mm(d),
              runMm: mm(along),
              axis: sa.horiz ? "y" : "x",
              coord: [rnd(c1), rnd(c2)],
              from: rnd(Math.max(a0, b0)),
              to: rnd(Math.min(a1, b1)),
            });
          }
        }
      if (ovAt.length)
        overlaps.push({
          a: idOf(ea),
          b: idOf(eb),
          type: trunk ? "trunk" : "non-trunk",
          trunkReason: sameNet ? "same-net" : sharePort ? "same-port" : null,
          totalMm: mm(ovLen),
          at: ovAt,
        });
    }
  // hugging a group frame / node border
  const frames: { key: string; kind: string; rect: Rect }[] = [
    ...layout.groups
      .filter((g) => !g.quad)
      .map((g) => {
        const gi: any = irElement(g.key);
        const framed = gi?.style?.strokeWidth?.units > 0 && gi?.style?.stroke !== "transparent";
        return { key: g.key, kind: framed ? "group-frame" : "group-frame-undrawn", rect: g.rect };
      }),
    ...layout.nodes
      .filter((n) => n.rect.width > 2)
      .map((n) => ({ key: n.key, kind: "node-border", rect: n.rect })),
  ];
  for (const [key, ss] of allSegs) {
    const e = edgeById.get(key as ElementKey) as EdgeLayout;
    for (const s of ss) {
      for (const f of frames) {
        const r = f.rect;
        const lines = s.horiz
          ? [
              { c: r.y, lo: r.x, hi: r.x + r.width },
              { c: r.y + r.height, lo: r.x, hi: r.x + r.width },
            ]
          : [
              { c: r.x, lo: r.y, hi: r.y + r.height },
              { c: r.x + r.width, lo: r.y, hi: r.y + r.height },
            ];
        const sc = s.horiz ? s.a.y : s.a.x;
        const [s0, s1] = s.horiz
          ? [Math.min(s.a.x, s.b.x), Math.max(s.a.x, s.b.x)]
          : [Math.min(s.a.y, s.b.y), Math.max(s.a.y, s.b.y)];
        for (const l of lines) {
          const d = Math.abs(sc - l.c);
          const along = Math.min(s1, l.hi) - Math.max(s0, l.lo);
          if (f.kind === "group-frame" && d > HUG_DIST && d <= LOOSE_DIST && along > 20 * MM)
            loose.push({
              edge: idOf(e),
              target: f.key,
              gapMm: mm(d),
              runMm: mm(along),
              axis: s.horiz ? "y" : "x",
              coord: rnd(sc),
            });
          if (d <= HUG_DIST && along > HUG_LEN)
            hugs.push({
              kind: f.kind,
              edge: idOf(e),
              target: f.key,
              own: f.key === e.from || f.key === e.to,
              gapMm: mm(d),
              runMm: mm(along),
              axis: s.horiz ? "y" : "x",
              coord: rnd(sc),
              from: rnd(Math.max(s0, l.lo)),
              to: rnd(Math.min(s1, l.hi)),
            });
        }
      }
    }
  }
  for (const o of overlaps) {
    for (const id of [o.a, o.b]) {
      const r = edges.find((x) => x.id === id);
      if (!r) continue;
      r.overlaps ??= [];
      r.overlaps.push({ with: id === o.a ? o.b : o.a, type: o.type });
    }
  }
  void byKey;
  const orth = edges.filter((e) => e.kind === "orthogonal");
  const counts = {
    edges: edges.length,
    orthogonal: orth.length,
    straight: edges.filter((e) => e.kind === "straight").length,
    curve: edges.filter((e) => e.kind === "curve").length,
    zoom: edges.filter((e) => e.kind === "zoom").length,
    avoidableBends: orth.filter((e) => e.avoidable).length,
    avoidableUnverified: orth.filter((e) => e.avoidableUnverified).length,
    endStubs: orth.reduce((a, e) => a + e.endStubs.length, 0),
    avoidableBendsAnchorCaused: orth.filter((e) => e.avoidableDueToAnchor).length,
    avoidableExtraBends: orth.reduce((a, e) => a + (e.avoidable ? e.bends - e.minBends : 0), 0),
    totalBends: orth.reduce((a, e) => a + e.bends, 0),
    shortJogs: orth.reduce((a, e) => a + e.shortJogs.length, 0),
    tinyJogs: orth.reduce((a, e) => a + e.tinyJogs.length, 0),
    overlapsNonTrunk: overlaps.filter((o) => o.type === "non-trunk").length,
    overlapsTrunk: overlaps.filter((o) => o.type === "trunk").length,
    looseFrameRuns: loose.length,
    hugging: hugs.filter((h) => h.kind !== "edge-edge-same-net" && h.kind !== "group-frame-undrawn")
      .length,
    huggingEdgeEdge: hugs.filter((h) => h.kind === "edge-edge").length,
    huggingGroupFrame: hugs.filter((h) => h.kind === "group-frame").length,
    huggingUndrawnFrame: hugs.filter((h) => h.kind === "group-frame-undrawn").length,
    huggingNodeBorder: hugs.filter((h) => h.kind === "node-border").length,
  };
  return { counts, edges, overlaps, hugging: hugs, looseFrameProximity: loose };
}

const root = join(import.meta.dir, "..", "runs");
const out: Record<string, unknown> = {};
for (const d of readdirSync(root).sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10))) {
  try {
    out[d] = await analyse(d, join(root, d, "figure.sumi.yaml"));
  } catch (err) {
    out[d] = { error: String(err) };
  }
}
writeFileSync(join(import.meta.dir, "measure.json"), `${JSON.stringify(out, null, 2)}\n`);
for (const [k, v] of Object.entries(out))
  console.log(k, JSON.stringify((v as any).counts ?? (v as any).error));
