/**
 * Zoom edges (#176, design doc §6.45): a callout from an element to a view
 * that shows it enlarged, drawn as two straight lines from corners of the
 * source's box to the matching corners of the target's. They are not routed:
 * the orthogonal router, its nets, the crossing report and `checkRoutes` do
 * not see them. The geometry lint warns when a line crosses a node
 * (`geometry/zoom-crosses-node`).
 *
 * **Corners.** The side is where the target lies relative to the source:
 * - `right` (the target's left edge at or right of the source's right edge):
 *   the source's top-right → the target's top-left, bottom-right → bottom-left;
 * - `left`: top-left → top-right, bottom-left → bottom-right;
 * - `below` (the target's top at or below the source's bottom):
 *   bottom-left → top-left, bottom-right → top-right;
 * - `above`: top-left → bottom-left, top-right → bottom-right.
 *
 * If the boxes are apart on both axes (diagonally), the axis with the larger
 * gap decides, the horizontal one on a tie. The first line is the top one
 * (`right` / `left`) or the left one (`below` / `above`). A junction's
 * corners are its center. Boxes that overlap on both axes (an element and
 * its group, or the element itself) have no side: the edge gets
 * `layout/no-route`.
 *
 * Each line lies outside both boxes but for its ends (it runs monotonically
 * across the gap between them), so it never enters its own ends.
 */

import type { EdgeIR, FigureIR } from "../../compiler/ir";
import type { ElementKey } from "../../core/check-state";
import type { Diagnostic } from "../../core/diagnostics";
import { type LayoutIR, type Point, type Rect, roundUnits } from "../ir";
import { bottomOf, isJunction, rightOf } from "./ports";

/** `true` for a zoom edge (#176): drawn between corners, not routed. */
export const isZoomEdge = (edge: Pick<EdgeIR, "routing">): boolean => edge.routing === "zoom";

/** Where the target lies relative to the source. */
export type ZoomSide = "right" | "left" | "below" | "above";

/**
 * The side of `target` relative to `source` (see the module comment), or
 * `undefined` if the boxes overlap on both axes.
 */
export function zoomSide(source: Rect, target: Rect): ZoomSide | undefined {
  const right = target.x - rightOf(source);
  const left = source.x - rightOf(target);
  const below = target.y - bottomOf(source);
  const above = source.y - bottomOf(target);
  const horizontal = Math.max(right, left);
  const vertical = Math.max(below, above);
  if (horizontal < 0 && vertical < 0) return undefined;
  if (horizontal >= vertical) return right >= left ? "right" : "left";
  return below >= above ? "below" : "above";
}

/** The two lines of a zoom edge between the boxes (see the module comment). */
export function zoomLines(
  source: Rect,
  target: Rect,
  side: ZoomSide,
  ends: { sourcePoint?: boolean; targetPoint?: boolean } = {},
): [[Point, Point], [Point, Point]] {
  const corners = (r: Rect, point: boolean | undefined) => {
    if (point) {
      const c = {
        x: roundUnits(r.x + r.width / 2),
        y: roundUnits(r.y + r.height / 2),
      };
      return { tl: c, tr: c, bl: c, br: c };
    }
    const [l, t, rr, b] = [r.x, r.y, rightOf(r), bottomOf(r)];
    return {
      tl: { x: l, y: t },
      tr: { x: rr, y: t },
      bl: { x: l, y: b },
      br: { x: rr, y: b },
    };
  };
  const s = corners(source, ends.sourcePoint);
  const t = corners(target, ends.targetPoint);
  switch (side) {
    case "right":
      return [
        [s.tr, t.tl],
        [s.br, t.bl],
      ];
    case "left":
      return [
        [s.tl, t.tr],
        [s.bl, t.br],
      ];
    case "below":
      return [
        [s.bl, t.tl],
        [s.br, t.tr],
      ];
    case "above":
      return [
        [s.tl, t.bl],
        [s.tr, t.br],
      ];
  }
}

/** `ir` without its zoom edges: what the router routes. The same object if it has none. */
export function withoutZoomEdges(ir: FigureIR): FigureIR {
  if (!ir.edges.some(isZoomEdge)) return ir;
  return { ...ir, edges: ir.edges.filter((edge) => !isZoomEdge(edge)) };
}

/** `layout` without the edges of `ir` that are zoom edges. The same object if it has none. */
export function withoutZoomLayouts(ir: FigureIR, layout: LayoutIR): LayoutIR {
  const zoom = new Set(ir.edges.filter(isZoomEdge).map((edge) => edge.key));
  if (zoom.size === 0) return layout;
  return { ...layout, edges: layout.edges.filter((edge) => !zoom.has(edge.key)) };
}

/**
 * Adds the zoom edges of `ir` to the routed layout of its other edges:
 * `routed` holds the routed edges, `placed` every edge (in document order).
 * Each zoom edge gets a route with its two `lines` (and `points`, the first
 * line) and no net, from the boxes in `routed` (which the router may have
 * moved). An edge whose ends overlap gets `layout/no-route` and no route.
 */
export function addZoomRoutes(
  ir: FigureIR,
  placed: LayoutIR,
  routed: LayoutIR,
): { layout: LayoutIR; diagnostics: Diagnostic[] } {
  const zoom = new Map(ir.edges.filter(isZoomEdge).map((edge) => [edge.key, edge]));
  if (zoom.size === 0) return { layout: routed, diagnostics: [] };
  const rects = new Map<ElementKey, Rect>([
    ...routed.nodes.map((n) => [n.key, n.rect] as const),
    ...routed.groups.map((g) => [g.key, g.rect] as const),
  ]);
  const nodes = new Map(ir.nodes.map((n) => [n.key, n]));
  const routedEdges = new Map(routed.edges.map((e) => [e.key, e]));
  const diagnostics: Diagnostic[] = [];
  const edges = placed.edges.map((e) => {
    const edge = zoom.get(e.key);
    if (edge === undefined) return routedEdges.get(e.key) ?? e;
    const source = rects.get(edge.from);
    const target = rects.get(edge.to);
    if (source === undefined || target === undefined) {
      throw new Error(`internal error: zoom edge ${edge.key} has no ends in the layout`);
    }
    const side = zoomSide(source, target);
    if (side === undefined) {
      diagnostics.push(noSide(ir, edge));
      return e;
    }
    const lines = zoomLines(source, target, side, {
      sourcePoint: isJunction(nodes.get(edge.from)),
      targetPoint: isJunction(nodes.get(edge.to)),
    });
    return { ...e, route: { points: [...lines[0]], lines } };
  });
  return { layout: { ...routed, edges }, diagnostics };
}

function noSide(ir: FigureIR, edge: EdgeIR): Diagnostic {
  const id = (key: ElementKey) => {
    const element = ir.elements.get(key);
    return element !== undefined && element.kind !== "edge" ? element.id : key;
  };
  const source = ir.sourceMap.get(edge.key);
  return {
    code: "layout/no-route",
    severity: "error",
    message: `No route was found for edge ${edge.id === undefined ? `edges[${edge.index}]` : `"${edge.id}"`} from "${id(edge.from)}" to "${id(edge.to)}": it is a zoom edge, and the boxes of its ends overlap, so there is no side to join their corners on.`,
    path: source?.path ?? ["edges", edge.index],
    ...(source?.location !== undefined && { location: source.location }),
    subject: { kind: "edge", id: edge.id ?? `edges[${edge.index}]` },
    hint: "A zoom edge joins an element to a separate view beside, above or below it. Place the target outside the source (not in it, nor around it), or use another edge component.",
  };
}
