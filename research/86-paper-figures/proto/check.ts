/**
 * Geometry checks of a prototype layout: the properties a product version
 * would have to guarantee (and the geometry lint would re-check on the SVG).
 */
import type { PlacedLabel } from "./edge-labels";
import type { Layout, Rect } from "./layout";
import type { ArrangeBox, Model } from "./model";
import { anchorPoint, type Point, type RoutedEdge } from "./route";

export interface CheckReport {
  nodes: number;
  edges: number;
  nonOrthogonalSegments: number;
  /** Edge segments passing through a node that is not one of its ends. */
  edgeThroughNode: string[];
  /** Ends not on the requested side / anchor (> 0.01 unit). */
  misplacedEnds: string[];
  /** Proper crossings between edges of different nets. */
  crossings: number;
  /** Collinear overlap length between different nets (units). */
  overlapLength: number;
  nodeOverlaps: string[];
  /** Nodes not inside their container (with 1 unit tolerance). */
  containment: string[];
  /** A vertex (end or bend) of one net lying on a segment of another net (T contacts, touching bends). */
  contacts: string[];
  /** Arrowhead areas hit by another net, or by a node other than the target. */
  arrowheadHits: string[];
  /** Edge labels overlapping a node, a caption, a group border, another label or any edge. */
  labelCollisions: string[];
  bends: number;
  totalLength: number;
}

const EPS = 0.01;
/** Must match svg.ts. */
const ARROW_LENGTH = 9;
const ARROW_HALF = 4;

function rectsOverlap(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.y < b.y + b.h - EPS && b.y < a.y + a.h - EPS
  );
}

/** p lies on the axis-aligned segment a–b, ends included. */
function onSegment(p: Point, a: Point, b: Point): boolean {
  const axis = Math.abs(a.x - b.x) <= EPS || Math.abs(a.y - b.y) <= EPS;
  return (
    axis &&
    p.x >= Math.min(a.x, b.x) - EPS &&
    p.x <= Math.max(a.x, b.x) + EPS &&
    p.y >= Math.min(a.y, b.y) - EPS &&
    p.y <= Math.max(a.y, b.y) + EPS
  );
}

function segments(points: Point[]): [Point, Point][] {
  const out: [Point, Point][] = [];
  for (let i = 1; i < points.length; i++) out.push([points[i - 1] as Point, points[i] as Point]);
  return out;
}

/** Interior of segment intersects the open rectangle. */
function segmentHitsRect(a: Point, b: Point, r: Rect): boolean {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  return maxX > r.x + EPS && minX < r.x + r.w - EPS && maxY > r.y + EPS && minY < r.y + r.h - EPS;
}

function members(model: Model): Map<string, string> {
  const parent = new Map<string, string>();
  const visit = (box: ArrangeBox, owner: string | undefined) => {
    for (const item of box.items) {
      if (typeof item !== "string") visit(item, owner);
      else {
        if (owner !== undefined) parent.set(item, owner);
        const g = model.groups.get(item);
        if (g !== undefined) visit(g.arrange, item);
      }
    }
  };
  visit(model.arrange, undefined);
  return parent;
}

export function checkLayout(
  model: Model,
  layout: Layout,
  routed: RoutedEdge[],
  labels: PlacedLabel[] = [],
): CheckReport {
  const report: CheckReport = {
    nodes: model.nodes.size,
    edges: routed.length,
    nonOrthogonalSegments: 0,
    edgeThroughNode: [],
    misplacedEnds: [],
    crossings: 0,
    overlapLength: 0,
    nodeOverlaps: [],
    containment: [],
    contacts: [],
    arrowheadHits: [],
    labelCollisions: [],
    bends: 0,
    totalLength: 0,
  };
  const solid = [...layout.nodes].filter(([id]) => model.nodes.get(id)?.component !== "junction");
  for (const e of routed) {
    const segs = segments(e.points);
    report.bends += Math.max(0, segs.length - 1);
    for (const [a, b] of segs) {
      if (Math.abs(a.x - b.x) > EPS && Math.abs(a.y - b.y) > EPS) report.nonOrthogonalSegments++;
      report.totalLength += Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      for (const [id, r] of solid) {
        if (segmentHitsRect(a, b, r))
          report.edgeThroughNode.push(
            `e#${e.edge.index} ${e.edge.from}->${e.edge.to} through ${id}`,
          );
      }
    }
    const check = (id: string, p: Point, anchorSide: string | undefined, explicit: boolean) => {
      const r = layout.nodes.get(id) as Rect;
      const node = model.nodes.get(id);
      if (node?.component === "junction") {
        if (Math.abs(p.x - (r.x + r.w / 2)) > EPS || Math.abs(p.y - (r.y + r.h / 2)) > EPS)
          report.misplacedEnds.push(`e#${e.edge.index} ${id}`);
        return;
      }
      const onSide =
        anchorSide === "north"
          ? Math.abs(p.y - r.y) <= EPS
          : anchorSide === "south"
            ? Math.abs(p.y - r.y - r.h) <= EPS
            : anchorSide === "west"
              ? Math.abs(p.x - r.x) <= EPS
              : Math.abs(p.x - r.x - r.w) <= EPS;
      if (!onSide) report.misplacedEnds.push(`e#${e.edge.index} ${id} not on ${anchorSide}`);
      if (explicit) {
        const want = anchorPoint(
          r,
          (id === e.edge.to ? e.edge.toAnchor : e.edge.fromAnchor) ?? {
            side: "north",
            offset: 0.5,
          },
        );
        if (Math.abs(want.x - p.x) > EPS || Math.abs(want.y - p.y) > EPS)
          report.misplacedEnds.push(`e#${e.edge.index} ${id} off anchor`);
      }
    };
    check(e.edge.from, e.points[0] as Point, e.fromSide, e.edge.fromAnchor !== undefined);
    check(e.edge.to, e.points.at(-1) as Point, e.toSide, e.edge.toAnchor !== undefined);
  }
  // Contacts: any vertex (end or bend) of one net on a segment of another net.
  for (const p of routed)
    for (const q of routed) {
      if (p.net === q.net) continue;
      for (const v of p.points)
        if (segments(q.points).some(([a, b]) => onSegment(v, a, b)))
          report.contacts.push(`e#${p.edge.index} vertex on e#${q.edge.index}`);
    }
  // Arrowheads: the last ARROW_LENGTH of the final segment, ARROW_HALF to each side.
  for (const e of routed) {
    if (!e.edge.arrow || e.points.length < 2) continue;
    const tip = e.points.at(-1) as Point;
    const prev = e.points.at(-2) as Point;
    const len = Math.hypot(tip.x - prev.x, tip.y - prev.y);
    const ux = (tip.x - prev.x) / len;
    const uy = (tip.y - prev.y) / len;
    const bx = tip.x - ux * ARROW_LENGTH;
    const by = tip.y - uy * ARROW_LENGTH;
    const head: Rect = {
      x: Math.min(tip.x, bx) - Math.abs(uy) * ARROW_HALF,
      y: Math.min(tip.y, by) - Math.abs(ux) * ARROW_HALF,
      w: Math.abs(tip.x - bx) + 2 * Math.abs(uy) * ARROW_HALF,
      h: Math.abs(tip.y - by) + 2 * Math.abs(ux) * ARROW_HALF,
    };
    for (const q of routed)
      if (q.net !== e.net && segments(q.points).some(([a, b]) => segmentHitsRect(a, b, head)))
        report.arrowheadHits.push(`e#${e.edge.index} head / e#${q.edge.index}`);
    for (const [id, r] of solid)
      if (id !== e.edge.to && rectsOverlap(head, r))
        report.arrowheadHits.push(`e#${e.edge.index} head / ${id}`);
  }
  // Crossings / overlaps between different nets.
  for (let i = 0; i < routed.length; i++)
    for (let j = i + 1; j < routed.length; j++) {
      const p = routed[i] as RoutedEdge;
      const q = routed[j] as RoutedEdge;
      if (p.net === q.net) continue;
      for (const [a, b] of segments(p.points))
        for (const [c, d] of segments(q.points)) {
          const h1 = Math.abs(a.y - b.y) <= EPS;
          const h2 = Math.abs(c.y - d.y) <= EPS;
          if (h1 !== h2) {
            const [hs, vs] = h1
              ? [
                  [a, b],
                  [c, d],
                ]
              : [
                  [c, d],
                  [a, b],
                ];
            const [ha, hb] = hs as [Point, Point];
            const [va, vb] = vs as [Point, Point];
            const x = va.x;
            const y = ha.y;
            if (
              x > Math.min(ha.x, hb.x) + EPS &&
              x < Math.max(ha.x, hb.x) - EPS &&
              y > Math.min(va.y, vb.y) + EPS &&
              y < Math.max(va.y, vb.y) - EPS
            )
              report.crossings++;
          } else if (h1 && Math.abs(a.y - c.y) <= EPS) {
            const lo = Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x));
            const hi = Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x));
            if (hi > lo + EPS) report.overlapLength += hi - lo;
          } else if (!h1 && Math.abs(a.x - c.x) <= EPS) {
            const lo = Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y));
            const hi = Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y));
            if (hi > lo + EPS) report.overlapLength += hi - lo;
          }
        }
    }
  for (let i = 0; i < solid.length; i++)
    for (let j = i + 1; j < solid.length; j++) {
      const [ia, a] = solid[i] as [string, Rect];
      const [ib, b] = solid[j] as [string, Rect];
      if (
        a.x < b.x + b.w - EPS &&
        b.x < a.x + a.w - EPS &&
        a.y < b.y + b.h - EPS &&
        b.y < a.y + a.h - EPS
      )
        report.nodeOverlaps.push(`${ia}/${ib}`);
    }
  for (const [child, group] of members(model)) {
    const g = layout.groups.get(group) as Rect;
    const r = layout.nodes.get(child) ?? layout.groups.get(child);
    if (r === undefined) continue;
    if (r.x < g.x - 1 || r.y < g.y - 1 || r.x + r.w > g.x + g.w + 1 || r.y + r.h > g.y + g.h + 1)
      report.containment.push(`${child} outside ${group}`);
  }
  for (const l of labels) {
    const r = l.rect;
    const overlaps = (o: Rect) =>
      r.x < o.x + o.w - EPS &&
      o.x < r.x + r.w - EPS &&
      r.y < o.y + o.h - EPS &&
      o.y < r.y + r.h - EPS;
    for (const [id, o] of solid)
      if (overlaps(o)) report.labelCollisions.push(`e#${l.edge} label / ${id}`);
    for (const [id, o] of layout.captions)
      if (overlaps(o)) report.labelCollisions.push(`e#${l.edge} label / caption ${id}`);
    for (const [id, g] of layout.groups) {
      const inside = r.x >= g.x && r.y >= g.y && r.x + r.w <= g.x + g.w && r.y + r.h <= g.y + g.h;
      if (overlaps(g) && !inside) report.labelCollisions.push(`e#${l.edge} label / border ${id}`);
    }
    for (const e of routed)
      for (const [a, b] of segments(e.points))
        if (segmentHitsRect(a, b, r))
          report.labelCollisions.push(`e#${l.edge} label / e#${e.edge.index}`);
    for (const other of labels)
      if (other.edge > l.edge && overlaps(other.rect))
        report.labelCollisions.push(`e#${l.edge} label / e#${other.edge} label`);
  }
  report.totalLength = Math.round(report.totalLength * 1000) / 1000;
  report.overlapLength = Math.round(report.overlapLength * 1000) / 1000;
  return report;
}
