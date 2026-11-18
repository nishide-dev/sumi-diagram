/**
 * Cuboid edges with face ports (#587) are one straight face-centre line when that line is clear of
 * every other node and of group titles; once the figure is placed, the others fall back to the
 * router (face-centroid ports on the visible faces, silhouette contacts on the hidden ones).
 */
import { type EdgeIR, type FigureIR, readonlyMap } from "../../compiler/ir";
import { getOutlineRenderer } from "../../core/outline";
import { segmentCrossesRegion } from "../../lint/geometry/edges";
import { rectPolygon } from "../../lint/geometry/shapes";
import type { LayoutIR, Point, Rect } from "../ir";
import { endpointRects } from "./endpoint-rects";
import { nodeRegion } from "./ports";

/** Clearance, in units, kept between the line and other nodes. */
const CLEARANCE = 2;

const centre = (r: Rect): Point => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

export function resolveFaceRoutes(ir: FigureIR, placed: LayoutIR): FigureIR {
  if (!ir.edges.some((e) => e.faceDirect === true)) return ir;
  const rects = endpointRects(ir, placed);
  const nodes = new Map(ir.nodes.map((n) => [n.key, n]));
  const aim = (key: EdgeIR["from"], other: Point): Point => {
    const rect = rects.get(key);
    const node = nodes.get(key);
    if (rect === undefined) return other;
    const c = centre(rect);
    const render = node?.render;
    const renderer = render === undefined ? undefined : getOutlineRenderer(render.renderer);
    const drawing = renderer?.draw(rect, renderer.params.parse(render?.params ?? {}));
    const [dx, dy] = [other.x - c.x, other.y - c.y];
    const side =
      Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? "east" : "west") : dy < 0 ? "north" : "south";
    return (
      drawing?.faceContacts?.[side as "north" | "east"] ??
      drawing?.hiddenFaceContacts?.[side as "south" | "west"] ??
      c
    );
  };
  const titles = placed.groups.flatMap((g) => (g.label === undefined ? [] : [g.label.box]));
  const clear = (edge: EdgeIR): boolean => {
    const [a, b] = [rects.get(edge.from), rects.get(edge.to)];
    if (a === undefined || b === undefined) return true;
    const p = aim(edge.from, centre(b));
    const q = aim(edge.to, centre(a));
    const inflated = (r: Rect): Rect => ({
      x: r.x - CLEARANCE,
      y: r.y - CLEARANCE,
      width: r.width + 2 * CLEARANCE,
      height: r.height + 2 * CLEARANCE,
    });
    for (const node of placed.nodes) {
      if (node.key === edge.from || node.key === edge.to) continue;
      const other = nodes.get(node.key);
      const region =
        other === undefined ? rectPolygon(node.rect) : nodeRegion(other, inflated(node.rect));
      if (segmentCrossesRegion(p, q, region, 0.01)) return false;
    }
    return !titles.some((box) => segmentCrossesRegion(p, q, rectPolygon(box), 0.01));
  };
  // A blocked edge detours over the top faces, or under the bottom ones when that is shorter:
  // the lift needed to clear the nodes between the ends, counted from both ends.
  const detour = (edge: EdgeIR): "north" | "south" => {
    const [a, b] = [rects.get(edge.from), rects.get(edge.to)];
    if (a === undefined || b === undefined) return "north";
    const [left, right] = [Math.min(a.x, b.x), Math.max(a.x + a.width, b.x + b.width)];
    const between = placed.nodes.filter(
      (n) =>
        n.key !== edge.from &&
        n.key !== edge.to &&
        n.rect.x < right &&
        n.rect.x + n.rect.width > left,
    );
    const top = Math.min(a.y, b.y, ...between.map((n) => n.rect.y));
    const bottom = Math.max(
      a.y + a.height,
      b.y + b.height,
      ...between.map((n) => n.rect.y + n.rect.height),
    );
    const over = a.y - top + (b.y - top);
    const under = bottom - (a.y + a.height) + (bottom - (b.y + b.height));
    return over <= under ? "north" : "south";
  };
  const edges = ir.edges.map((e): EdgeIR => {
    if (e.faceDirect !== true) return e;
    if (clear(e)) return { ...e, route: "straight" };
    const side = detour(e);
    return { ...e, faceSides: { from: side, to: side } };
  });
  const byKey = new Map(edges.map((e) => [e.key, e]));
  return {
    ...ir,
    edges,
    elements: readonlyMap([...ir.elements].map(([k, v]) => [k, byKey.get(k) ?? v] as const)),
  };
}
