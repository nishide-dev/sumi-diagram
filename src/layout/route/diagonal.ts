/** Opt-in, independent single-segment correspondence lines (#349). */
import type { EdgeIR, FigureIR } from "../../compiler/ir";
import type { ElementKey } from "../../core/check-state";
import type { Diagnostic } from "../../core/diagnostics";
import { getOutlineRenderer } from "../../core/outline";
import { segmentCrossesRegion } from "../../lint/geometry/edges";
import { rectPolygon } from "../../lint/geometry/shapes";
import type { EdgeLayout, LayoutIR, Point, Rect, TextLayout, TextMetrics } from "../ir";
import { roundUnits } from "../ir";
import { placeText } from "../structured/engine";
import { arrowheadLength } from "./arrowhead";
import { endpointRects } from "./endpoint-rects";
import { EDGE_LABEL_GAP } from "./labels";
import {
  anchorPoint,
  boundaryEntry,
  DIRS,
  isJunction,
  nodeBoundaryEntry,
  nodeRegion,
  SIDE_DIR,
} from "./ports";
import { zoomSide } from "./zoom";

export const isStraightEdge = (edge: Pick<EdgeIR, "route">): boolean => edge.route === "straight";

/** Horizontal text, offset by its support radius along the line's normal. */
function straightLabel(metrics: TextMetrics, a: Point, b: Point, edge: EdgeIR): TextLayout {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const ux = (b.x - a.x) / length;
  const uy = (b.y - a.y) / length;
  const along = (Math.abs(ux) * metrics.width + Math.abs(uy) * metrics.height) / 2;
  const away = (Math.abs(uy) * metrics.width + Math.abs(ux) * metrics.height) / 2 + EDGE_LABEL_GAP;
  const at = edge.labelAt ?? "middle";
  const head = arrowheadLength(edge.style.strokeWidth.units);
  const start = along + EDGE_LABEL_GAP + (edge.sourceArrowhead === undefined ? 0 : head);
  const end = length - along - EDGE_LABEL_GAP - (edge.targetArrowhead === undefined ? 0 : head);
  const t =
    at === "start"
      ? Math.min(length / 2, start)
      : at === "end"
        ? Math.max(length / 2, end)
        : length / 2;
  const side = edge.labelSide === "right" ? -1 : 1;
  return placeText(metrics, {
    x: roundUnits(a.x + ux * t + uy * away * side),
    y: roundUnits(a.y + uy * t - ux * away * side),
  });
}

/** Add straight lines after orthogonal routing, using the final endpoint rectangles. */
export function addStraightRoutes(
  ir: FigureIR,
  placed: LayoutIR,
  routed: LayoutIR,
): {
  layout: LayoutIR;
  diagnostics: Diagnostic[];
} {
  const straight = new Map(ir.edges.filter(isStraightEdge).map((e) => [e.key, e]));
  if (straight.size === 0) return { layout: routed, diagnostics: [] };
  const rects = endpointRects(ir, routed);
  const nodes = new Map(ir.nodes.map((n) => [n.key, n]));
  const existing = new Map(routed.edges.map((e) => [e.key, e]));
  const diagnostics: Diagnostic[] = [];
  const center = (r: Rect): Point => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
  const edges = placed.edges.map((e): EdgeLayout => {
    const edge = straight.get(e.key);
    if (edge === undefined) return existing.get(e.key) ?? e;
    const source = rects.get(edge.from);
    const target = rects.get(edge.to);
    if (source === undefined || target === undefined) throw new Error("Missing straight endpoint");
    const fail = (reason: string): EdgeLayout => {
      const at = ir.sourceMap.get(edge.key);
      diagnostics.push({
        code: "layout/no-route",
        severity: "error",
        message: `Cannot draw straight edge ${edge.id ?? `edges[${edge.index}]`}: ${reason}.`,
        path: at?.path ?? ["edges", edge.index],
        ...(at?.location !== undefined && { location: at.location }),
        subject: { kind: "edge", id: edge.id ?? `edges[${edge.index}]` },
        hint: "Separate the endpoints, choose anchors facing the other end, increase the gap, or remove route: straight.",
      });
      return e;
    };
    if (edge.routing === "zoom") return fail("zoom callouts already define their two lines");
    if (zoomSide(source, target) === undefined) return fail("the endpoint boxes overlap");
    const raw = (r: Rect, anchor: EdgeIR["fromAnchor"]): Point =>
      anchor === undefined || anchor === "straight" ? center(r) : anchorPoint(r, anchor);
    const drawing = (key: ElementKey, r: Rect) => {
      const render = nodes.get(key)?.render;
      if (render === undefined) return undefined;
      const renderer = getOutlineRenderer(render.renderer);
      if (!renderer) throw new Error(`Unknown outline renderer ${render.renderer}`);
      return renderer.draw(r, renderer.params.parse(render.params ?? {}));
    };
    const sourceDrawing = drawing(edge.from, source);
    const targetDrawing = drawing(edge.to, target);
    const s =
      sourceDrawing?.fixedPort === undefined
        ? raw(source, edge.fromAnchor)
        : anchorPoint(source, sourceDrawing.fixedPort);
    const t =
      targetDrawing?.fixedPort === undefined
        ? raw(target, edge.toAnchor)
        : anchorPoint(target, targetDrawing.fixedPort);
    const end = (
      key: ElementKey,
      r: Rect,
      rawPoint: Point,
      other: Point,
      anchor: EdgeIR["fromAnchor"],
    ): Point | undefined => {
      const node = nodes.get(key);
      if (isJunction(node)) return center(r);
      const fixed = drawing(key, r)?.fixedPort;
      if (fixed !== undefined) return anchorPoint(r, fixed);
      // Explicit anchors are projected radially onto the silhouette. Automatic
      // ends trace the line from the other end towards this shape's centre.
      const from = anchor === undefined || anchor === "straight" ? other : rawPoint;
      const to = center(r);
      const entry =
        node === undefined
          ? boundaryEntry(from, to, rectPolygon(r))
          : nodeBoundaryEntry(from, to, node, r);
      if (entry === undefined) return undefined;
      const f = entry;
      return {
        x: roundUnits(from.x + (to.x - from.x) * f),
        y: roundUnits(from.y + (to.y - from.y) * f),
      };
    };
    const a = end(edge.from, source, s, t, edge.fromAnchor);
    const b = end(edge.to, target, t, s, edge.toAnchor);
    if (a === undefined || b === undefined)
      return fail("the line does not meet an endpoint outline; choose another anchor");
    for (const [fixed, p, q] of [
      [sourceDrawing?.fixedPort, a, b],
      [targetDrawing?.fixedPort, b, a],
    ] as const) {
      if (fixed === undefined) continue;
      const normal = DIRS[SIDE_DIR[fixed.side]] as Point;
      if ((q.x - p.x) * normal.x + (q.y - p.y) * normal.y <= 0.001)
        return fail("the line cannot approach the fixed port from its outward side");
    }
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const head = arrowheadLength(edge.style.strokeWidth.units);
    const needed =
      (edge.sourceArrowhead === undefined ? 0 : head) +
      (edge.targetArrowhead === undefined ? 0 : head);
    if (length <= Math.max(0.001, needed))
      return fail("there is no room for the line and its arrowheads");
    // A side explicitly facing away would make the line pass through its end.
    const enters = (key: ElementKey, r: Rect, p: Point, q: Point) => {
      const node = nodes.get(key);
      if (isJunction(node)) return false;
      const painted = drawing(key, r);
      if (painted !== undefined)
        return (painted.boundaries ?? [painted.outline]).some((polygon) =>
          crossesPaintedPolygon(p, q, polygon),
        );
      return segmentCrossesRegion(
        p,
        q,
        node === undefined ? rectPolygon(r) : nodeRegion(node, r),
        0.01,
      );
    };
    if (enters(edge.from, source, a, b) || enters(edge.to, target, b, a))
      return fail("an anchor faces into its endpoint");
    return {
      ...e,
      route: {
        points: [a, b],
        ...(e.labelMetrics !== undefined && { label: straightLabel(e.labelMetrics, a, b, edge) }),
      },
    };
  });
  return { layout: growForStraightLabels({ ...routed, edges }), diagnostics };
}

/** Split at every boundary crossing, then test the open intervals by even/odd fill.
 * Unlike convex clipping this preserves concavities and disconnected bodies.
 */
function crossesPaintedPolygon(a: Point, b: Point, polygon: readonly Point[]): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  const cuts = [0, 1];
  for (const [i, p] of polygon.entries()) {
    const q = polygon[(i + 1) % polygon.length] as Point;
    const ex = q.x - p.x;
    const ey = q.y - p.y;
    const cross = dx * ey - dy * ex;
    if (Math.abs(cross) < 1e-9) continue;
    const t = ((p.x - a.x) * ey - (p.y - a.y) * ex) / cross;
    const u = ((p.x - a.x) * dy - (p.y - a.y) * dx) / cross;
    if (t > 0 && t < 1 && u >= 0 && u <= 1) cuts.push(t);
  }
  cuts.sort((x, y) => x - y);
  return cuts.some((end, i) => {
    const start = cuts[i - 1];
    if (start === undefined || (end - start) * length <= 0.002) return false;
    const t = (start + end) / 2;
    const x = a.x + t * dx;
    const y = a.y + t * dy;
    let inside = false;
    let distance = Number.POSITIVE_INFINITY;
    for (const [j, p] of polygon.entries()) {
      const q = polygon[(j + 1) % polygon.length] as Point;
      if (p.y > y !== q.y > y && x < p.x + ((y - p.y) * (q.x - p.x)) / (q.y - p.y))
        inside = !inside;
      const ex = q.x - p.x;
      const ey = q.y - p.y;
      const u = Math.max(0, Math.min(1, ((x - p.x) * ex + (y - p.y) * ey) / (ex * ex + ey * ey)));
      distance = Math.min(distance, Math.hypot(x - p.x - u * ex, y - p.y - u * ey));
    }
    return inside && distance > 0.001;
  });
}

/** Keep new labels in the content and canvas, translating the whole layout if needed. */
function growForStraightLabels(layout: LayoutIR): LayoutIR {
  const boxes = [
    layout.content,
    ...layout.edges.flatMap((e) => (e.route?.label === undefined ? [] : [e.route.label.box])),
  ];
  const left = Math.min(...boxes.map((r) => r.x));
  const top = Math.min(...boxes.map((r) => r.y));
  const right = Math.max(...boxes.map((r) => r.x + r.width));
  const bottom = Math.max(...boxes.map((r) => r.y + r.height));
  const dx = layout.margin - left;
  const dy = layout.margin - top;
  const point = (p: Point): Point => ({ x: roundUnits(p.x + dx), y: roundUnits(p.y + dy) });
  const rect = (r: Rect): Rect => ({ ...r, ...point(r) });
  const text = (t: TextLayout): TextLayout => ({ ...t, box: rect(t.box), anchor: point(t.anchor) });
  return {
    ...layout,
    canvas: {
      width: Math.max(layout.canvas.width, Math.ceil(right - left + 2 * layout.margin)),
      height: Math.max(layout.canvas.height, Math.ceil(bottom - top + 2 * layout.margin)),
    },
    content: {
      x: layout.margin,
      y: layout.margin,
      width: roundUnits(right - left),
      height: roundUnits(bottom - top),
    },
    nodes: layout.nodes.map((n) => ({
      ...n,
      rect: rect(n.rect),
      ...(n.label && { label: text(n.label) }),
      ...(n.sublabel && { sublabel: text(n.sublabel) }),
    })),
    groups: layout.groups.map((g) => ({
      ...g,
      rect: rect(g.rect),
      content: rect(g.content),
      ...(g.label && { label: text(g.label) }),
    })),
    edges: layout.edges.map((e) =>
      e.route === undefined
        ? e
        : {
            ...e,
            route: {
              ...e.route,
              points: e.route.points.map(point),
              ...(e.route.lines && {
                lines: e.route.lines.map(([a, b]): [Point, Point] => [point(a), point(b)]),
              }),
              ...(e.route.label && { label: text(e.route.label) }),
            },
          },
    ),
    ...(layout.nets && {
      nets: layout.nets.map((n) => ({
        ...n,
        segments: n.segments.map(([a, b]): [Point, Point] => [point(a), point(b)]),
      })),
    }),
  };
}
