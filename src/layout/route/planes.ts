/**
 * Edges inside tilted planes (#577, design #574 stage C).
 *
 * The nodes of a plane are mapped to the page by their centers, so the router
 * would see a skewed layout. An edge between two nodes of one plane is routed
 * in the plane's own flat coordinates instead (as in any group: orthogonal,
 * with shared trunks and rounded corners) and its polyline is mapped to the
 * page afterwards: its legs run along the plane's two axes, parallel to the
 * parallelogram's sides. Everything else is routed on the page as usual:
 * straight and curved edges (a `route: straight` edge between two nodes of one
 * plane maps to the same straight line between the mapped nodes), edges
 * between planes, and edges to nodes outside of any plane.
 */
import type { EdgeIR, FigureIR, GroupIR } from "../../compiler/ir";
import type { ElementKey } from "../../core/check-state";
import type {
  EdgeLayout,
  EdgeRoute,
  GroupLayout,
  LayoutIR,
  NodeLayout,
  PlaneLayout,
  Point,
  Rect,
  RouteNet,
  TextLayout,
} from "../ir";
import { roundUnits } from "../ir";
import { mapFlatPoint, type PlaneFrame, planeBasis, pointsBounds } from "../plane";
import { deepFreeze } from "../structured/engine";
import { isDirectEdge } from "./diagonal";
import { boundaryEntry, isJunction, nodeRegion } from "./ports";
import type { RouteOptions, RouteResult } from "./router";

type Route = (ir: FigureIR, layout: LayoutIR, options: RouteOptions) => RouteResult;

const frameOf = (plane: PlaneLayout): PlaneFrame => ({
  projection: { orientation: plane.orientation, angle: plane.angle, depthScale: plane.depthScale },
  frame: plane.frame,
  origin: plane.origin,
});

const translate = (rect: Rect, dx: number, dy: number): Rect => ({
  ...rect,
  x: rect.x + dx,
  y: rect.y + dy,
});

function translateText(text: TextLayout, dx: number, dy: number): TextLayout {
  return {
    ...text,
    box: translate(text.box, dx, dy),
    anchor: { x: text.anchor.x + dx, y: text.anchor.y + dy },
  };
}

/** The edges of `ir` between two nodes of one plane that the router lays out orthogonally. */
function planarEdges(ir: FigureIR, layout: LayoutIR): Map<ElementKey, EdgeIR[]> {
  const planeOf = new Map<ElementKey, ElementKey>();
  for (const plane of layout.planes ?? [])
    for (const node of plane.flat) planeOf.set(node.key, plane.key);
  const byPlane = new Map<ElementKey, EdgeIR[]>();
  for (const edge of ir.edges) {
    if (isDirectEdge(edge)) continue;
    const from = planeOf.get(edge.from);
    if (from === undefined || from !== planeOf.get(edge.to)) continue;
    byPlane.set(from, [...(byPlane.get(from) ?? []), edge]);
  }
  return byPlane;
}

/**
 * Routes `layout` whose figure has tilted planes: the edges inside a plane in
 * plane coordinates, mapped, the others by `route` on the page.
 */
export function routeWithPlanes(
  ir: FigureIR,
  layout: LayoutIR,
  options: RouteOptions,
  route: Route,
): RouteResult {
  const planar = planarEdges(ir, layout);
  const { planes, ...page } = layout;
  const planarKeys = new Set([...planar.values()].flatMap((edges) => edges.map((e) => e.key)));
  const main = route(
    { ...ir, edges: ir.edges.filter((e) => !planarKeys.has(e.key)) },
    { ...page, edges: layout.edges.filter((e) => !planarKeys.has(e.key)) },
    options,
  );
  const diagnostics = [...main.diagnostics];
  const routed = new Map<ElementKey, EdgeLayout>();
  const nets: RouteNet[] = [...(main.layout.nets ?? [])];
  const reach: Point[] = [];
  const margin = layout.margin;

  for (const plane of planes ?? []) {
    const edges = planar.get(plane.key);
    if (edges === undefined || edges.length === 0) continue;
    const group = ir.groups.find((g) => g.key === plane.key) as GroupIR;
    const members = new Set(plane.flat.map((n) => n.key));
    // The flat frame, moved to the margin so the router sees an ordinary small figure.
    // An upright node on the page covers a larger, sheared area of the flat frame: the router
    // sees each node as the box around that area, so mapped routes keep clear of the real node.
    const basis = planeBasis(frameOf(plane).projection);
    const det = basis.u.x * basis.v.y - basis.u.y * basis.v.x;
    const inv = [
      [basis.v.y / det, -basis.v.x / det],
      [-basis.u.y / det, basis.u.x / det],
    ] as const;
    const inflate = (r: Rect): Rect => {
      const hw = r.width / 2;
      const hh = r.height / 2;
      const hx = Math.abs(inv[0][0]) * hw + Math.abs(inv[0][1]) * hh;
      const hy = Math.abs(inv[1][0]) * hw + Math.abs(inv[1][1]) * hh;
      return { x: r.x + hw - hx, y: r.y + hh - hy, width: 2 * hx, height: 2 * hy };
    };
    const inflated = plane.flat.map((n) => ({ key: n.key, rect: inflate(n.rect) }));
    const grow = Math.max(
      0,
      ...inflated.flatMap(({ rect }) => [
        plane.frame.x - rect.x,
        plane.frame.y - rect.y,
        rect.x + rect.width - (plane.frame.x + plane.frame.width),
        rect.y + rect.height - (plane.frame.y + plane.frame.height),
      ]),
    );
    const dx = margin + grow - plane.frame.x;
    const dy = margin + grow - plane.frame.y;
    const frame = translate(
      {
        x: plane.frame.x - grow,
        y: plane.frame.y - grow,
        width: plane.frame.width + 2 * grow,
        height: plane.frame.height + 2 * grow,
      },
      dx,
      dy,
    );
    const flatRects = new Map(inflated.map((n) => [n.key, translate(n.rect, dx, dy)]));
    // Positions to map back are the node centers' translation only: the flat frame moved by (dx, dy).
    const shift = { dx, dy };
    const pageNodes = new Map(layout.nodes.map((n) => [n.key, n]));
    const nodes: NodeLayout[] = plane.flat.map(({ key }) => {
      const node = pageNodes.get(key) as NodeLayout;
      const rect = flatRects.get(key) as Rect;
      // Labels follow their node: the page position moved to the flat one.
      const flatRect = translate(
        (plane.flat.find((f) => f.key === key) as { rect: Rect }).rect,
        dx,
        dy,
      );
      const sx = flatRect.x + flatRect.width / 2 - (node.rect.x + node.rect.width / 2);
      const sy = flatRect.y + flatRect.height / 2 - (node.rect.y + node.rect.height / 2);
      return {
        ...node,
        rect,
        ...(node.label !== undefined && { label: translateText(node.label, sx, sy) }),
        ...(node.sublabel !== undefined && { sublabel: translateText(node.sublabel, sx, sy) }),
      };
    });
    const { parent: _parent, ...groupIR } = group;
    const flatGroup: GroupLayout = {
      key: plane.key,
      kind: "group",
      rect: frame,
      content: translate(
        {
          x: plane.content.x - grow,
          y: plane.content.y - grow,
          width: plane.content.width + 2 * grow,
          height: plane.content.height + 2 * grow,
        },
        dx,
        dy,
      ),
    };
    const flatIR: FigureIR = {
      ...ir,
      groups: [groupIR as GroupIR],
      nodes: ir.nodes.filter((n) => members.has(n.key)),
      edges,
    };
    const flatLayout: LayoutIR = {
      engine: layout.engine,
      canvas: {
        width: Math.ceil(frame.x + frame.width + margin),
        height: Math.ceil(frame.y + frame.height + margin),
      },
      margin,
      content: frame,
      groups: [flatGroup],
      nodes,
      edges: layout.edges.filter((e) => edges.some((x) => x.key === e.key)),
    };
    const result = route(flatIR, flatLayout, options);
    diagnostics.push(...result.diagnostics);
    const frameMap = frameOf(plane);
    const map = (p: Point): Point => {
      const m = mapFlatPoint(frameMap, { x: p.x - shift.dx, y: p.y - shift.dy });
      return { x: roundUnits(m.x), y: roundUnits(m.y) };
    };
    const offset = nets.length;
    for (const net of result.layout.nets ?? []) {
      nets.push({
        id: net.id + offset,
        edges: net.edges,
        segments: net.segments.map(([a, b]) => [map(a), map(b)] as const),
      });
    }
    for (const placed of result.layout.edges) {
      const flat = placed.route;
      if (flat === undefined) {
        routed.set(placed.key, placed);
        continue;
      }
      const points = onOutlines(flat.points.map(map), placed, ir, layout);
      reach.push(...points);
      let label = flat.label;
      if (label !== undefined) {
        const at = map({
          x: label.box.x + label.box.width / 2,
          y: label.box.y + label.box.height / 2,
        });
        const sx = at.x - (label.box.x + label.box.width / 2);
        const sy = at.y - (label.box.y + label.box.height / 2);
        label = translateText(label, sx, sy);
        reach.push(
          { x: label.box.x, y: label.box.y },
          {
            x: label.box.x + label.box.width,
            y: label.box.y + label.box.height,
          },
        );
      }
      const mapped: EdgeRoute = {
        ...flat,
        points,
        ...(label !== undefined && { label }),
        ...(flat.net !== undefined && { net: flat.net + offset }),
      };
      routed.set(placed.key, { ...placed, route: mapped });
    }
  }

  const edges = layout.edges.map(
    (edge) => routed.get(edge.key) ?? main.layout.edges.find((e) => e.key === edge.key) ?? edge,
  );
  const content =
    reach.length === 0 ? main.layout.content : unionRects(main.layout.content, pointsBounds(reach));
  const merged: LayoutIR = {
    ...main.layout,
    content,
    edges,
    ...(nets.length > 0 && { nets }),
    ...(planes !== undefined && { planes }),
  };
  return { layout: deepFreeze(merged), diagnostics };
}

/**
 * A mapped route ends where the flat route met the flat node's outline, which is
 * inside the upright node on the page: its first and last points are moved
 * along their legs to the node's outline (a junction's center stays).
 */
function onOutlines(
  points: readonly Point[],
  edge: EdgeLayout,
  ir: FigureIR,
  layout: LayoutIR,
): Point[] {
  const out = [...points];
  const trim = (end: ElementKey, at: number, next: number): void => {
    const node = ir.nodes.find((n) => n.key === end);
    const rect = layout.nodes.find((n) => n.key === end)?.rect;
    const a = out[at];
    const b = out[next];
    if (node === undefined || rect === undefined || a === undefined || b === undefined) return;
    if (isJunction(node)) return;
    // The flat route ends on the flat node's (inflated) box: on the page that is inside or
    // outside the upright node, so the end leg is cut or extended to the node's outline.
    const far = { x: b.x + (a.x - b.x) * 8, y: b.y + (a.y - b.y) * 8 };
    const t = boundaryEntry(b, far, nodeRegion(node, rect));
    if (t === undefined || t <= 0) return;
    out[at] = {
      x: roundUnits(b.x + (far.x - b.x) * t),
      y: roundUnits(b.y + (far.y - b.y) * t),
    };
  };
  if (out.length < 2) return out;
  trim(edge.from, 0, 1);
  trim(edge.to, out.length - 1, out.length - 2);
  return out;
}

function unionRects(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}
