/**
 * Cuboid edges with face ports (#587) are one straight face-centre line when that line is clear of
 * every other node and of group titles; once the figure is placed, the others fall back to the
 * router (face-centroid ports on the visible faces, silhouette contacts on the hidden ones).
 */

import { type EdgeIR, type FigureIR, readonlyMap } from "../../compiler/ir";
import type { Diagnostic } from "../../core/diagnostics";
import { getOutlineRenderer } from "../../core/outline";
import { segmentCrossesRegion } from "../../lint/geometry/edges";
import { rectPolygon } from "../../lint/geometry/shapes";
import type { LayoutIR, Point, Rect } from "../ir";
import { endpointRects } from "./endpoint-rects";
import { nodeRegion } from "./ports";
import { routeEdges } from "./router";

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
  const about = (d: Diagnostic, edge: EdgeIR) =>
    d.severity === "error" &&
    (d.subject?.id === (edge.id ?? `edges[${edge.index}]`) || d.path?.[1] === edge.index);
  const withEdge = (figure: FigureIR, edge: EdgeIR): FigureIR => ({
    ...figure,
    edges: figure.edges.map((e) => (e.key === edge.key ? edge : e)),
    elements: readonlyMap(
      [...figure.elements].map(([k, v]) => [k, k === edge.key ? edge : v] as const),
    ),
  });
  // The sides a blocked edge may detour by, the shorter first (the top or the right on a tie): the
  // lift needed to clear the nodes between the ends, counted from both ends. Ends side by side
  // go over or under (top, bottom); ends one above the other go round the right or the left
  // (side faces: east visible, west hidden).
  const detours = (edge: EdgeIR): ("north" | "south" | "east" | "west")[] => {
    const [a, b] = [rects.get(edge.from), rects.get(edge.to)];
    if (a === undefined || b === undefined) return [];
    const [ca, cb] = [centre(a), centre(b)];
    const sideways = Math.abs(cb.x - ca.x) >= Math.abs(cb.y - ca.y);
    const others = placed.nodes.filter((n) => n.key !== edge.from && n.key !== edge.to);
    if (sideways) {
      const [left, right] = [Math.min(a.x, b.x), Math.max(a.x + a.width, b.x + b.width)];
      const between = others.filter((n) => n.rect.x < right && n.rect.x + n.rect.width > left);
      const top = Math.min(a.y, b.y, ...between.map((n) => n.rect.y));
      const bottom = Math.max(
        a.y + a.height,
        b.y + b.height,
        ...between.map((n) => n.rect.y + n.rect.height),
      );
      const over = a.y - top + (b.y - top);
      const under = bottom - (a.y + a.height) + (bottom - (b.y + b.height));
      return over <= under ? ["north", "south"] : ["south", "north"];
    }
    const [upper, lower] = [Math.min(a.y, b.y), Math.max(a.y + a.height, b.y + b.height)];
    const between = others.filter((n) => n.rect.y < lower && n.rect.y + n.rect.height > upper);
    const farRight = Math.max(
      a.x + a.width,
      b.x + b.width,
      ...between.map((n) => n.rect.x + n.rect.width),
    );
    const farLeft = Math.min(a.x, b.x, ...between.map((n) => n.rect.x));
    const right = farRight - (a.x + a.width) + (farRight - (b.x + b.width));
    const left = a.x - farLeft + (b.x - farLeft);
    return right <= left ? ["east", "west"] : ["west", "east"];
  };
  // Each edge in turn: the straight line if the router accepts it, else a detour the router
  // accepts, else ordinary routing with the 3D-centre ports (a route nobody wrote never errors).
  let figure = ir;
  for (const edge of ir.edges) {
    if (edge.faceDirect !== true) continue;
    const fits = (candidate: EdgeIR): boolean => {
      const trial = withEdge(figure, candidate);
      // Other edges still waiting are drawn straight in the trial: only this edge's errors count.
      const pending = {
        ...trial,
        edges: trial.edges.map((e) =>
          e.faceDirect === true &&
          e.route === undefined &&
          e.faceSides === undefined &&
          e.key !== edge.key
            ? ({ ...e, route: "straight" } as EdgeIR)
            : e,
        ),
      };
      const result = routeEdges(pending, placed, { hintTrials: false });
      return !result.diagnostics.some((d) => about(d, edge));
    };
    const straight: EdgeIR = { ...edge, route: "straight" };
    let chosen: EdgeIR | undefined = clear(edge) && fits(straight) ? straight : undefined;
    if (chosen === undefined)
      for (const side of detours(edge)) {
        const candidate: EdgeIR = { ...edge, faceSides: { from: side, to: side } };
        if (fits(candidate)) {
          chosen = candidate;
          break;
        }
      }
    figure = withEdge(figure, chosen ?? { ...edge, centerPorts: true });
  }
  return figure;
}
