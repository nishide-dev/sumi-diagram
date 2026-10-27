/**
 * `layout/edge-label-overlap` (#128, design doc §6.30): an edge label placed
 * by `labelAt` / `labelSide` stays beside the requested segment and side
 * even when nothing there is clear (`placeRequestedLabel`). The overlap that
 * remains is reported here, so the author can pick another side or segment.
 *
 * Only edges that write `labelAt` or `labelSide` are checked: the default
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
import type { LayoutIR, Point, Rect } from "../ir";
import { arrowheadRects, hasRequestedLabel } from "./labels";

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
  const routed = layout.edges.flatMap((e) => {
    const edge = byKey.get(e.key);
    const points = e.route?.points;
    return edge === undefined || points === undefined ? [] : [{ edge, points, layout: e }];
  });
  const otherLabels: (readonly [ElementKey, Rect])[] = [
    ...layout.nodes.flatMap((n) => (n.label === undefined ? [] : [[n.key, n.label.box] as const])),
    ...layout.groups.flatMap((g) => (g.label === undefined ? [] : [[g.key, g.label.box] as const])),
    ...routed.flatMap(({ layout: e }) =>
      e.route?.label === undefined ? [] : [[e.key, e.route.label.box] as const],
    ),
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
    const box = e.route?.label?.box;
    if (box === undefined || !hasRequestedLabel(edge)) continue;
    const found: string[] = [];
    for (const other of routed) {
      const own = other.edge.key === edge.key;
      const points = other.points;
      const crosses = points
        .slice(1)
        .some((q, i) => overlaps(segmentRect(points[i] as Point, q), box));
      if (crosses) found.push(own ? "its own line" : `the line of ${elementName(other.edge.key)}`);
      const heads = arrowheadRects(points, other.edge, arrowheadOf(other.edge));
      if (heads.some((r) => overlaps(r, box))) {
        found.push(own ? "its own arrowhead" : `the arrowhead of ${elementName(other.edge.key)}`);
      }
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
      if (overlaps(group.rect, box) && !contains(group.rect, box)) {
        found.push(`the border of ${elementName(group.key)}`);
      }
    }
    if (found.length === 0) continue;

    const source = ir.sourceMap.get(edge.key);
    const written = [
      ...(edge.labelAt !== undefined ? [`labelAt: ${edge.labelAt}`] : []),
      ...(edge.labelSide !== undefined ? [`labelSide: ${edge.labelSide}`] : []),
    ].join(", ");
    const otherSide = EDGE_LABEL_SIDES.find((s) => s !== edge.labelSide);
    const otherAt = EDGE_LABEL_POSITIONS.filter((p) => p !== edge.labelAt);
    const tries = [
      ...(edge.labelSide !== undefined ? [`labelSide: ${otherSide}`] : []),
      `labelAt: ${otherAt.join(" or ")}`,
    ];
    diagnostics.push({
      code: "layout/edge-label-overlap",
      severity: "warning",
      message: `The label of edge ${edgeName(edge)} overlaps ${list(found)}: nothing beside the segment and side it asks for (${written}) is clear.`,
      path: source?.path ?? ["edges", edge.index],
      ...(source?.location !== undefined && { location: source.location }),
      subject: { kind: "edge", id: edge.id ?? `edges[${edge.index}]` },
      hint: `labelAt and labelSide keep the label beside the segment and side they name, so it is not moved elsewhere. Try ${tries.join(", or ")}; remove them to let the router choose; or make room (a gap, anchors, a shorter label).`,
    });
  }
  return diagnostics;
}

function list(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
