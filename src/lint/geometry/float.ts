/**
 * `geometry/float-overlap` (#643, design record 643): a floating legend
 * (`props.float`) is drawn over its container's content without taking room
 * in it, so nothing checks for free space when it is placed. This rule
 * reports what its frame covers: a node, a group's frame or title that is not
 * one of its ancestors, an edge or an edge label, or the outline of a set it
 * is not entirely inside (a legend inside a sequence's fragment frame is
 * fine; one across its border is not).
 */

import { groupKey } from "../../core/check-state";
import type { Point, Rect } from "../../render/geometry";
import { defineGeometryRule, type LintFinding } from "../rule";
import { capitalize } from "./common";
import type { GeometryContext, GeometryElement } from "./context";

/** Overlaps up to this deep (units) are touching, not covering. */
const TOUCH = 0.5;

/** The ID of the floating legend `element` is the frame or a part of, if any. */
export function floatingLegendOf(context: GeometryContext, element: GeometryElement) {
  const id = element.ir.legend?.id;
  if (id === undefined) return undefined;
  const frame = context.ir.elements.get(groupKey(id));
  return frame?.kind === "group" && frame.float !== undefined ? id : undefined;
}

const overlaps = (a: Rect, b: Rect): boolean =>
  Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > TOUCH &&
  Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > TOUCH;

const inside = (inner: Rect, outer: Rect): boolean =>
  inner.x >= outer.x - TOUCH &&
  inner.y >= outer.y - TOUCH &&
  inner.x + inner.width <= outer.x + outer.width + TOUCH &&
  inner.y + inner.height <= outer.y + outer.height + TOUCH;

/** Whether the segment `a`–`b` passes through the inside of `r` (shrunk by {@link TOUCH}). */
function segmentEnters(a: Point, b: Point, r: Rect): boolean {
  const x0 = r.x + TOUCH;
  const y0 = r.y + TOUCH;
  const x1 = r.x + r.width - TOUCH;
  const y1 = r.y + r.height - TOUCH;
  if (x1 <= x0 || y1 <= y0) return false;
  // Liang–Barsky clipping: the segment meets the rectangle if the clipped range is not empty.
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  for (const [p, q] of [
    [-dx, a.x - x0],
    [dx, x1 - a.x],
    [-dy, a.y - y0],
    [dy, y1 - a.y],
  ] as const) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return true;
}

const routeEnters = (route: readonly (readonly Point[])[], r: Rect): boolean =>
  route.some((line) =>
    line.some((point, i) => i > 0 && segmentEnters(line[i - 1] as Point, point, r)),
  );

export const floatOverlap = defineGeometryRule({
  id: "geometry/float-overlap",
  description:
    "A floating legend (props.float) covers a node, group, edge, edge label or set outline of the content it floats over.",
  defaultSeverity: "warning",
  fixable: false,
  run(context) {
    const findings: LintFinding[] = [];
    for (const legend of context.elements) {
      if (legend.kind !== "group" || legend.ir.kind !== "group") continue;
      if (legend.ir.float === undefined) continue;
      const frame = legend.bbox;
      if (frame === undefined) continue;
      const id = legend.ir.legend?.id ?? legend.ir.id;
      const covered: GeometryElement[] = [];
      for (const other of context.elements) {
        if (other === legend || floatingLegendOf(context, other) === id) continue;
        if (other.kind === "group" && context.isAncestor(other.key, legend.key)) continue;
        if (other.kind === "edge") {
          const route = other.drawn ?? other.route;
          const hit =
            (route !== undefined &&
              other.ir.kind === "edge" &&
              other.ir.style.stroke !== "transparent" &&
              other.ir.style.strokeWidth.units > 0 &&
              routeEnters(route, frame)) ||
            other.labels.some((label) => label.box !== undefined && overlaps(label.box, frame));
          if (hit) covered.push(other);
          continue;
        }
        // A junction is a point on a wire: the wire is checked as an edge.
        if (other.ir.kind === "node" && other.ir.mark?.type === "point") continue;
        const boxes = [
          ...(other.bbox !== undefined ? [other.bbox] : []),
          ...other.labels.flatMap((label) => (label.box !== undefined ? [label.box] : [])),
        ];
        if (boxes.some((box) => overlaps(box, frame))) covered.push(other);
      }
      // A set's outline: the legend may sit inside the set (a fragment of a sequence), not across it.
      const sets = context.sets.filter((set) => {
        const box = set.geometry.bbox;
        return overlaps(box, frame) && !inside(frame, box);
      });
      if (covered.length === 0 && sets.length === 0) continue;
      const names = [...covered.map((e) => e.name), ...sets.map((s) => s.name)];
      const shown = names.slice(0, 4).join(", ");
      const more = names.length > 4 ? ` and ${names.length - 4} more` : "";
      findings.push({
        message: `Floating legend "${id}" (float: ${legend.ir.float.at}) covers ${shown}${more}.`,
        path: [...legend.docPath, "props", "float"],
        subject: legend.subject,
        hint: "A floating legend takes no room, so it needs free space at its corner: choose another corner or side (props.float), add or change the inset ({at, inset}), make the legend smaller (flow: row, perRow), or list it in an arrange tree beside the content instead.",
        related: [
          ...covered.map((e) => ({
            path: e.docPath,
            message: `${capitalize(e.name)} is defined here.`,
          })),
          ...sets.map((s) => ({
            path: s.docPath,
            message: `${capitalize(s.name)} is defined here.`,
          })),
        ],
      });
    }
    return findings;
  },
});
