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
import { findCrossings } from "./crossings";
import { addDirectRoutes } from "./diagonal";
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
  // Group titles and the captions below frames (#491), which routes keep clear of.
  const below = new Set(ir.nodes.filter((n) => n.labelBelow).map((n) => n.key));
  const titles = [
    ...placed.groups.flatMap((g) => (g.label === undefined ? [] : [g.label.box])),
    ...placed.nodes.flatMap((n) =>
      below.has(n.key)
        ? [n.label?.box, n.sublabel?.box].filter((box): box is Rect => box !== undefined)
        : [],
    ),
  ];
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
    const box = {
      x0: Math.min(p.x, q.x) - CLEARANCE,
      x1: Math.max(p.x, q.x) + CLEARANCE,
      y0: Math.min(p.y, q.y) - CLEARANCE,
      y1: Math.max(p.y, q.y) + CLEARANCE,
    };
    for (const node of placed.nodes) {
      if (node.key === edge.from || node.key === edge.to) continue;
      const r = node.rect;
      if (r.x > box.x1 || r.x + r.width < box.x0 || r.y > box.y1 || r.y + r.height < box.y0)
        continue;
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
  // The faceDirect edges in a deterministic order (the shorter span first, then document order),
  // each against the routes accepted before it: the straight line if the router accepts it and it
  // meets none of them, else a detour that does the same (the shorter side first), else ordinary
  // routing with the 3D-centre ports (a route nobody wrote never errors).
  const resolved = new Map<EdgeIR["key"], EdgeIR>();
  const span = (e: EdgeIR) => {
    const [a, b] = [rects.get(e.from), rects.get(e.to)];
    return a === undefined || b === undefined
      ? 0
      : Math.hypot(centre(a).x - centre(b).x, centre(a).y - centre(b).y);
  };
  const accepted: { from: EdgeIR["from"]; to: EdgeIR["to"]; points: readonly Point[] }[] = [];
  const meets = (edge: EdgeIR, points: readonly Point[]): boolean =>
    accepted.some((other) => {
      for (const [key, p] of [
        [edge.from, points[0]],
        [edge.to, points.at(-1)],
      ] as const)
        for (const [k, q] of [
          [other.from, other.points[0]],
          [other.to, other.points.at(-1)],
        ] as const)
          if (
            key === k &&
            p !== undefined &&
            q !== undefined &&
            Math.hypot(p.x - q.x, p.y - q.y) < 3
          )
            return true;
      for (let i = 0; i + 1 < points.length; i++)
        for (let j = 0; j + 1 < other.points.length; j++)
          if (
            segmentsTouch(
              points[i] as Point,
              points[i + 1] as Point,
              other.points[j] as Point,
              other.points[j + 1] as Point,
            )
          )
            return true;
      return false;
    });
  const order = ir.edges
    .filter((e) => e.faceDirect === true)
    .sort((x, y) => span(x) - span(y) || x.index - y.index);
  for (const edge of order) {
    // Only this edge is tried, against the placed nodes as static obstacles (not the whole figure).
    // Its points when the router draws it and it meets no accepted route.
    const fits = (candidate: EdgeIR, avoid = true): readonly Point[] | undefined => {
      const solo: FigureIR = {
        ...ir,
        edges: [candidate],
        elements: readonlyMap(
          [...ir.elements]
            .filter(([, v]) => v.kind !== "edge")
            .concat([[candidate.key, candidate]]),
        ),
      };
      const layout: LayoutIR = { ...placed, edges: placed.edges.filter((e) => e.key === edge.key) };
      const result =
        candidate.route === "straight"
          ? addDirectRoutes(solo, layout, layout)
          : routeEdges(solo, layout, { hintTrials: false });
      if (result.diagnostics.some((d) => about(d, edge))) return undefined;
      const points = result.layout.edges.find((e) => e.key === edge.key)?.route?.points;
      return points === undefined || (avoid && meets(edge, points)) ? undefined : points;
    };
    let chosen: EdgeIR | undefined;
    let points: readonly Point[] | undefined;
    const straight: EdgeIR = { ...edge, route: "straight" };
    if (clear(edge)) {
      points = fits(straight);
      if (points !== undefined) chosen = straight;
    }
    if (chosen === undefined)
      for (const side of detours(edge)) {
        const candidate: EdgeIR = { ...edge, faceSides: { from: side, to: side } };
        points = fits(candidate);
        if (points !== undefined) {
          chosen = candidate;
          break;
        }
      }
    if (chosen === undefined) {
      // The ordinary route with the 3D-centre ports is accepted as it is, and later edges keep
      // clear of it like of any other.
      chosen = { ...edge, centerPorts: true };
      points = fits(chosen, false);
    }
    if (points !== undefined) accepted.push({ from: edge.from, to: edge.to, points });
    resolved.set(edge.key, chosen);
  }
  const build = (): FigureIR => ({
    ...ir,
    edges: ir.edges.map((e) => resolved.get(e.key) ?? e),
    elements: readonlyMap([...ir.elements].map(([k, v]) => [k, resolved.get(k) ?? v] as const)),
  });
  // The figure is routed once as a whole (only when some edge detours or falls back): where a
  // detour crosses another edge there, it is dropped to ordinary routing with the 3D-centre ports.
  for (let round = 0; round < 3; round++) {
    if (![...resolved.values()].some((e) => e.faceSides !== undefined || e.centerPorts === true))
      break;
    const figure = build();
    const crossings = findCrossings(routeEdges(figure, placed, { hintTrials: false }).layout);
    const demote = new Set(
      crossings
        .flatMap((c) => [...c.edges, ...c.others])
        .filter((key) => resolved.get(key)?.faceSides !== undefined),
    );
    if (demote.size === 0) break;
    for (const key of demote) {
      const e = resolved.get(key) as EdgeIR;
      const { faceSides: _dropped, ...rest } = e;
      resolved.set(key, { ...rest, centerPorts: true });
    }
  }
  return build();
}

/** Whether two segments cross, touch or overlap. */
function segmentsTouch(a: Point, b: Point, c: Point, d: Point): boolean {
  const cross = (o: Point, p: Point, q: Point) =>
    (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const eps = 1e-6;
  const [d1, d2, d3, d4] = [cross(c, d, a), cross(c, d, b), cross(a, b, c), cross(a, b, d)];
  if (
    ((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) &&
    ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps))
  )
    return true;
  const within = (p: Point, q: Point, r: Point) =>
    Math.min(p.x, q.x) - 0.5 <= r.x &&
    r.x <= Math.max(p.x, q.x) + 0.5 &&
    Math.min(p.y, q.y) - 0.5 <= r.y &&
    r.y <= Math.max(p.y, q.y) + 0.5;
  const near = (o: Point, p: Point, q: Point) =>
    Math.abs(cross(o, p, q)) / Math.max(Math.hypot(p.x - o.x, p.y - o.y), 1e-9) < 0.5;
  return (
    (near(c, d, a) && within(c, d, a)) ||
    (near(c, d, b) && within(c, d, b)) ||
    (near(a, b, c) && within(a, b, c)) ||
    (near(a, b, d) && within(a, b, d))
  );
}
