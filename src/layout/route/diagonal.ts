/** Opt-in, independent single-segment correspondence lines (#349). */
import type { EdgeIR, FigureIR } from "../../compiler/ir";
import type { ElementKey } from "../../core/check-state";
import type { Diagnostic } from "../../core/diagnostics";
import { segmentCrossesRegion } from "../../lint/geometry/edges";
import { rectPolygon } from "../../lint/geometry/shapes";
import type { EdgeLayout, LayoutIR, Point, Rect, TextLayout, TextMetrics } from "../ir";
import { roundUnits } from "../ir";
import { placeText } from "../structured/engine";
import { arrowheadLength } from "./arrowhead";
import { endpointRects } from "./endpoint-rects";
import { EDGE_LABEL_GAP } from "./labels";
import { anchorPoint, boundaryEntry, isJunction, nodeBoundaryEntry, nodeRegion } from "./ports";
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
    const s = raw(source, edge.fromAnchor);
    const t = raw(target, edge.toAnchor);
    const end = (
      key: ElementKey,
      r: Rect,
      rawPoint: Point,
      other: Point,
      anchor: EdgeIR["fromAnchor"],
    ): Point | undefined => {
      const node = nodes.get(key);
      if (isJunction(node)) return center(r);
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
