/**
 * `layout/edge-label-overlap` (#128, design doc §6.30): an edge label placed
 * by `labelAt` / `labelSide` stays beside the requested segment and side
 * even when nothing there is clear (`placeRequestedLabel`). The overlap that
 * remains is reported here, so the author can pick another side or segment.
 *
 * Only edges that write `labelAt` or `labelSide` (or draw a tag, #610, whose
 * own segment does not count) are checked: the default
 * placement and its diagnostics are unchanged (its leftovers are found by
 * the geometry lint as before). Checked on the routed Layout IR, against
 * what the geometry lint does not see for an edge's own label: routes
 * (its own included) and arrowheads; and against nodes, labels and group
 * borders, so one warning names everything the label overlaps.
 */

import type { EdgeIR, FigureIR } from "../../compiler/ir";
import type { ElementKey } from "../../core/check-state";
import type { Diagnostic } from "../../core/diagnostics";
import { EDGE_LABEL_POSITIONS, EDGE_LABEL_SIDES } from "../../core/figure/schema";
import { groupFrontRect, groupLayerObstacles } from "../group-layers";
import type { LayoutIR, Point, Rect } from "../ir";
import { sampleCubic } from "./cubic";
import { arrowheadRects, hasRequestedLabel, isTagLabel, labelSegment, tagBox } from "./labels";

/** The open rectangles overlap (touching does not count). */
const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

const contains = (outer: Rect, inner: Rect): boolean =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width &&
  inner.y + inner.height <= outer.y + outer.height;

const segmentRect = (a: Point, b: Point): Rect => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  width: Math.abs(a.x - b.x),
  height: Math.abs(a.y - b.y),
});

/**
 * One warning per edge with `labelAt` / `labelSide` whose label overlaps a
 * route, an arrowhead, a node, another label or a group's border.
 * `arrowheadOf` gives an edge's arrowhead length (the router's
 * `arrowheadLength` of its stroke width).
 */
export function requestedLabelDiagnostics(
  ir: FigureIR,
  layout: LayoutIR,
  arrowheadOf: (edge: EdgeIR) => number,
  /**
   * The edges whose labels to check (default: every edge with a requested
   * label). The router checks orthogonal labels while routing, and the tags
   * of `route: straight` / `curve` edges once every route is drawn (#610).
   */
  only: (edge: EdgeIR) => boolean = () => true,
): Diagnostic[] {
  const byKey = new Map(ir.edges.map((e) => [e.key, e]));
  const idOf = (key: ElementKey) => {
    const element = ir.elements.get(key);
    return element !== undefined && element.kind !== "edge" ? element.id : key;
  };
  const edgeName = (edge: EdgeIR) =>
    `${edge.id === undefined ? `edges[${edge.index}]` : `"${edge.id}"`} ("${idOf(edge.from)}" → "${idOf(edge.to)}")`;
  const elementName = (key: ElementKey) => {
    const element = ir.elements.get(key);
    if (element?.kind === "edge") return `edge ${edgeName(element)}`;
    return `${element?.kind ?? "element"} "${idOf(key)}"`;
  };
  // Zoom edges (#176): their straight lines between corners are obstacles, not routes.
  const zoomLines = layout.edges.flatMap((e) => {
    const edge = byKey.get(e.key);
    const lines = e.route?.lines;
    return edge === undefined || lines === undefined ? [] : [{ edge, lines }];
  });
  const routed = layout.edges.flatMap((e) => {
    const edge = byKey.get(e.key);
    const route = e.route?.points;
    if (edge === undefined || route === undefined || e.route?.lines !== undefined) return [];
    // A curve (#610) as the polyline it is drawn as, not its control points.
    const points = edge.route === "curve" && route.length === 4 ? sampleCubic(route) : route;
    return [{ edge, points, layout: e }];
  });
  const otherLabels: (readonly [ElementKey, Rect])[] = [
    ...layout.nodes.flatMap((n) => (n.label === undefined ? [] : [[n.key, n.label.box] as const])),
    ...layout.nodes.flatMap((n) =>
      n.sublabel === undefined ? [] : [[n.key, n.sublabel.box] as const],
    ),
    ...layout.groups.flatMap((g) => (g.label === undefined ? [] : [[g.key, g.label.box] as const])),
    ...routed.flatMap(({ edge, layout: e }) => {
      const label = e.route?.label;
      if (label === undefined) return [];
      return [[e.key, isTagLabel(edge) ? tagBox(label.box, label) : label.box] as const];
    }),
  ];
  const bordered = layout.groups.filter((group) => {
    const element = ir.elements.get(group.key);
    const style = element?.kind === "group" ? element.style : undefined;
    return !(
      style === undefined ||
      style.strokeWidth.units === 0 ||
      style.stroke === "transparent"
    );
  });

  const diagnostics: Diagnostic[] = [];
  for (const { edge, layout: e } of routed) {
    const label = e.route?.label;
    if (label === undefined || !hasRequestedLabel(edge) || !only(edge)) continue;
    // A tag (#610) takes its drawn frame.
    const box = isTagLabel(edge) ? tagBox(label.box, label) : label.box;
    const found: string[] = [];
    // A tag (#610) sits on its own segment; on a straight or curved line, on its line.
    const tag = isTagLabel(edge);
    const direct = edge.route !== undefined;
    const host = tag && !direct ? labelSegment(e.route?.points ?? [], edge) : -1;
    for (const other of routed) {
      const own = other.edge.key === edge.key;
      const points = other.points;
      const crosses =
        !(own && tag && direct) &&
        points
          .slice(1)
          .some((q, i) => !(own && i + 1 === host) && segmentMeets(points[i] as Point, q, box));
      if (crosses) found.push(own ? "its own line" : `the line of ${elementName(other.edge.key)}`);
      const heads =
        other.edge.route !== undefined
          ? directHeads(points, other.edge, arrowheadOf(other.edge))
          : arrowheadRects(points, other.edge, arrowheadOf(other.edge));
      if (heads.some((r) => overlaps(r, box))) {
        found.push(own ? "its own arrowhead" : `the arrowhead of ${elementName(other.edge.key)}`);
      }
    }
    for (const { edge: zoom, lines } of zoomLines) {
      if (lines.some(([a, b]) => segmentMeets(a, b, box)))
        found.push(`the line of ${elementName(zoom.key)}`);
    }
    for (const node of layout.nodes) {
      if (overlaps(node.rect, box)) found.push(elementName(node.key));
    }
    for (const [key, r] of otherLabels) {
      if (key === edge.key || !overlaps(r, box)) continue;
      // A node's label lies inside its box, reported above.
      if (ir.elements.get(key)?.kind === "node" && found.includes(elementName(key))) continue;
      found.push(`the label of ${elementName(key)}`);
    }
    for (const group of bordered) {
      const element = ir.elements.get(group.key);
      if (element?.kind !== "group") continue;
      const front = groupFrontRect(element, group.rect);
      if (
        (overlaps(front, box) && !contains(front, box)) ||
        groupLayerObstacles(element, group.rect).some((band) => overlaps(band, box))
      ) {
        found.push(`the border of ${elementName(group.key)}`);
      }
    }
    if (found.length === 0) continue;

    const source = ir.sourceMap.get(edge.key);

    const written = [
      ...(edge.labelAt !== undefined ? [`labelAt: ${edge.labelAt}`] : []),
      ...(edge.labelSide !== undefined && !tag ? [`labelSide: ${edge.labelSide}`] : []),
      ...(tag ? ["labelStyle: tag"] : []),
    ].join(", ");
    const otherSide = EDGE_LABEL_SIDES.find((s) => s !== edge.labelSide);
    const otherAt = EDGE_LABEL_POSITIONS.filter((p) => p !== edge.labelAt);
    const tries = [
      ...(edge.labelSide !== undefined && !tag ? [`labelSide: ${otherSide}`] : []),
      `labelAt: ${otherAt.join(" or ")} (or a fraction of the route such as 0.3)`,
    ];
    diagnostics.push({
      code: "layout/edge-label-overlap",
      severity: "warning",
      message: tag
        ? `The tag of edge ${edgeName(edge)} overlaps ${list(found)}: nothing on the segment it asks for (${written}) is clear.`
        : `The label of edge ${edgeName(edge)} overlaps ${list(found)}: nothing beside the segment and side it asks for (${written}) is clear.`,
      path: source?.path ?? ["edges", edge.index],
      ...(source?.location !== undefined && { location: source.location }),
      subject: { kind: "edge", id: edge.id ?? `edges[${edge.index}]` },
      hint: tag
        ? `A tag stays on the segment labelAt names, so it is not moved elsewhere. Try ${tries.join(", or ")}; remove labelStyle: tag to let the router place the label beside the line; or make room (a gap, anchors, a shorter label).`
        : `labelAt and labelSide keep the label beside the segment and side they name, so it is not moved elsewhere. Try ${tries.join(", or ")}; remove them to let the router choose; or make room (a gap, anchors, a shorter label).`,
    });
  }
  return diagnostics;
}

/**
 * Whether the segment from `a` to `b` meets the open rectangle: an
 * axis-parallel one as its own (zero-width) rectangle, a slanted one
 * clipped to the rectangle (Liang–Barsky), as a straight line (#610) runs.
 */
function segmentMeets(a: Point, b: Point, r: Rect): boolean {
  if (a.x === b.x || a.y === b.y) return overlaps(segmentRect(a, b), r);
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  for (const [p, q] of [
    [-dx, a.x - r.x],
    [dx, r.x + r.width - a.x],
    [-dy, a.y - r.y],
    [dy, r.y + r.height - a.y],
  ] as const) {
    if (p === 0) {
      if (q <= 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
  }
  return t1 - t0 > 1e-9;
}

/**
 * The arrowheads of a straight or curved edge (#610) as squares `arrowhead`
 * wide about the middle of each head, along its end direction.
 */
function directHeads(points: readonly Point[], edge: EdgeIR, arrowhead: number): Rect[] {
  const head = (tip: Point, from: Point): Rect => {
    const d = Math.hypot(tip.x - from.x, tip.y - from.y) || 1;
    const c = {
      x: tip.x - ((tip.x - from.x) / d) * (arrowhead / 2),
      y: tip.y - ((tip.y - from.y) / d) * (arrowhead / 2),
    };
    return { x: c.x - arrowhead / 2, y: c.y - arrowhead / 2, width: arrowhead, height: arrowhead };
  };
  const n = points.length;
  if (n < 2) return [];
  return [
    ...(edge.targetArrowhead !== undefined
      ? [head(points[n - 1] as Point, points[n - 2] as Point)]
      : []),
    ...(edge.sourceArrowhead !== undefined ? [head(points[0] as Point, points[1] as Point)] : []),
  ];
}

function list(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
