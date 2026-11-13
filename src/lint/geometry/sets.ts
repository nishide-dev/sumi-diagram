/**
 * Geometry rules of set enclosures (#407, design record 407): a set's
 * outline covering a node that is not a member (the Venn diagram says it
 * is), and its label colliding with other text, shapes, routes or another
 * set's boundary. Edges may cross a set's boundary freely; a set always fits
 * the canvas, which the layout grows to hold it.
 */

import type { Point, Rect } from "../../render/geometry";
import { defineGeometryRule, type LintFinding } from "../rule";
import type { GeometryContext, GeometryElement, GeometrySet } from "./context";
import { unionOf } from "./measure";
import {
  depthInside,
  polylinesCrossRect,
  type Region,
  rectDepthInside,
  rectPolygon,
  rectsOverlap,
  regionIntersectsRect,
} from "./shapes";

/** Slack in units for rounding, as the other geometry rules. */
const TOLERANCE = 1;
/** A node counts as covered when this share of its footprint lies inside the outline... */
const COVERED_SHARE = 0.25;
/** ...or when its center does. The footprint is sampled on a grid this many points a side. */
const GRID = 7;

const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** The ID of the group a caption node was expanded from, if `element` is one. */
const captionOf = (element: GeometryElement): string | undefined =>
  element.ir.kind === "node" ? element.ir.captionOf : undefined;

/** Where a node is drawn: its shape, or for a text node the boxes of its labels. */
function footprint(element: GeometryElement): Rect | undefined {
  if (element.bbox !== undefined) return element.bbox;
  return unionOf(element.labels.flatMap((l) => l.visibleLines));
}

/** The region a node occupies: its drawn outline, or the box of its text. */
function nodeRegion(element: GeometryElement): Region | undefined {
  if (element.outline !== undefined) return element.outline;
  const rect = footprint(element);
  return rect === undefined ? undefined : rectPolygon(rect);
}

/** Points inside the region (a grid over its bounds) and on its boundary. */
function sampleRegion(region: Region): { inside: Point[]; boundary: Point[] } {
  const inside: Point[] = [];
  const boundary: Point[] = [];
  if (region.kind === "ellipse") {
    const { cx, cy, rx, ry } = region;
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * 2 * Math.PI;
      boundary.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
    }
    for (let i = 0; i < GRID; i++)
      for (let j = 0; j < GRID; j++) {
        const p = {
          x: cx + rx * (((i + 0.5) / GRID) * 2 - 1),
          y: cy + ry * (((j + 0.5) / GRID) * 2 - 1),
        };
        if (depthInside(region, p) >= 0) inside.push(p);
      }
    return { inside, boundary };
  }
  const { points } = region;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const w = Math.max(...xs) - x0;
  const h = Math.max(...ys) - y0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i] as Point;
    const b = points[(i + 1) % points.length] as Point;
    for (let k = 0; k < 4; k++)
      boundary.push({ x: a.x + ((b.x - a.x) * k) / 4, y: a.y + ((b.y - a.y) * k) / 4 });
  }
  for (let i = 0; i < GRID; i++)
    for (let j = 0; j < GRID; j++) {
      const p = { x: x0 + ((i + 0.5) / GRID) * w, y: y0 + ((j + 0.5) / GRID) * h };
      if (depthInside(region, p) >= 0) inside.push(p);
    }
  return { inside, boundary };
}

/**
 * How a set's outline meets a non-member node, by the node's drawn shape (a
 * diamond's empty corner does not count) and without shrinking it, so a thin
 * node is judged like any other:
 * - `covered`: the node's center, or a quarter or more of its shape, is inside;
 * - `crossed`: not covered, but part of the shape lies more than TOLERANCE
 *   inside the outline (the outline cuts it);
 * - `clear`: otherwise.
 * Each node is exactly one of the three, so the two rules never both report it
 * and none is missed.
 */
export function classifyAgainstSet(
  set: GeometrySet,
  node: GeometryElement,
): "covered" | "crossed" | "clear" {
  const region = nodeRegion(node);
  if (region === undefined) return "clear";
  const { inside, boundary } = sampleRegion(region);
  const centerOf = footprint(node);
  const center =
    node.outline?.kind === "ellipse"
      ? { x: node.outline.cx, y: node.outline.cy }
      : centerOf === undefined
        ? undefined
        : { x: centerOf.x + centerOf.width / 2, y: centerOf.y + centerOf.height / 2 };
  if (center !== undefined && depthInside(set.geometry.region, center) >= 0) return "covered";
  const share =
    inside.length === 0
      ? 0
      : inside.filter((p) => depthInside(set.geometry.region, p) >= 0).length / inside.length;
  if (share >= COVERED_SHARE) return "covered";
  const cut = [...inside, ...boundary].some(
    (p) => depthInside(set.geometry.region, p) >= TOLERANCE,
  );
  return cut ? "crossed" : "clear";
}

/** Whether a node is a member of the set, directly or through a member group. */
function isMember(context: GeometryContext, set: GeometrySet, node: GeometryElement): boolean {
  const caption = captionOf(node);
  return set.ir.members.some(
    (member) =>
      member === node.key ||
      context.isAncestor(member, node.key) ||
      (caption !== undefined && member === `g:${caption}`),
  );
}

/** The non-member nodes of `set` of the given kind (see classifyAgainstSet). */
function nonMembersBy(
  context: GeometryContext,
  set: GeometrySet,
  kind: "covered" | "crossed",
): GeometryElement[] {
  return context.elements.filter((node) => {
    if (node.kind !== "node" || node.ir.kind !== "node") return false;
    // A junction is a point on a wire, not a thing the set could claim.
    if (node.ir.mark?.type === "point") return false;
    if (isMember(context, set, node)) return false;
    return classifyAgainstSet(set, node) === kind;
  });
}

/** The nodes the outline of `set` covers although they are no members. */
export const coveredNonMembers = (context: GeometryContext, set: GeometrySet) =>
  nonMembersBy(context, set, "covered");

export const setContainsNonMember = defineGeometryRule({
  id: "geometry/set-contains-non-member",
  description:
    "A set's outline covers a node that is not one of its members, so the figure says the node belongs to the set.",
  defaultSeverity: "warning",
  fixable: false,
  run(context) {
    const findings: LintFinding[] = [];
    for (const set of context.sets) {
      const covered = coveredNonMembers(context, set);
      if (covered.length === 0) continue;
      const names = covered.map((n) => n.name);
      findings.push({
        message: `The outline of ${set.name} covers ${names.length === 1 ? names[0] : `${names.length} nodes (${names.join(", ")})`}, which ${names.length === 1 ? "is" : "are"} not ${names.length === 1 ? "a member" : "members"}.`,
        path: set.docPath,
        subject: set.subject,
        hint: "A node inside a set's outline reads as a member. Add it to members, or move it clear of the outline (the `place` coordinates or a gap), or fit the set closer with shape: hull, rect, a tilted ellipse (shape: ellipse with angle: auto), or a smaller padding.",
        related: covered.map((n) => ({
          path: n.docPath,
          message: `${capitalize(n.name)} is defined here.`,
        })),
      });
    }
    return findings;
  },
});

export const setOutlineCrossesNode = defineGeometryRule({
  id: "geometry/set-outline-crosses-node",
  description:
    "A set's outline runs through a node that is not one of its members, so the node looks half inside the set.",
  defaultSeverity: "warning",
  fixable: false,
  run(context) {
    const findings: LintFinding[] = [];
    for (const set of context.sets) {
      const crossed = nonMembersBy(context, set, "crossed");
      if (crossed.length === 0) continue;
      const names = crossed.map((n) => n.name);
      findings.push({
        message: `The outline of ${set.name} crosses ${names.length === 1 ? names[0] : `${names.length} nodes (${names.join(", ")})`}, which ${names.length === 1 ? "is" : "are"} not ${names.length === 1 ? "a member" : "members"}.`,
        path: set.docPath,
        subject: set.subject,
        hint: "A node cut by an outline reads as half in the set. Move it clear of the outline (the `place` coordinates or a gap), narrow it, or fit the set closer: shape: hull or rect, a tilted ellipse (angle: auto), a smaller padding or minWidth / minHeight.",
        related: crossed.map((n) => ({
          path: n.docPath,
          message: `${capitalize(n.name)} is defined here.`,
        })),
      });
    }
    return findings;
  },
});

/** How close (units) the outline may come to a text box before it counts as touching it. */
const TEXT_TOUCH = 1;

/** Whether `element` is a member of `set`, or lies inside a member group: its text belongs to the set. */
function belongsToSet(
  context: GeometryContext,
  set: GeometrySet,
  element: GeometryElement,
): boolean {
  if (element.kind === "edge") return false;
  const caption = captionOf(element);
  return set.ir.members.some(
    (member) =>
      member === element.key ||
      context.isAncestor(member, element.key) ||
      (caption !== undefined && member === `g:${caption}`),
  );
}

export const setOutlineCrossesText = defineGeometryRule({
  id: "geometry/set-outline-crosses-text",
  description:
    "A set's outline crosses or touches a label, caption or edge label it does not enclose: a node label, a group title or caption, or an edge label of something that is not a member.",
  defaultSeverity: "warning",
  fixable: false,
  run(context) {
    const findings: LintFinding[] = [];
    for (const set of context.sets) {
      const hits: GeometryElement[] = [];
      for (const element of context.elements) {
        if (belongsToSet(context, set, element)) continue;
        const crossed = element.labels.some((l) =>
          l.visibleLines.some(
            (line) =>
              // Within TEXT_TOUCH of the text, yet not wholly inside the outline.
              regionIntersectsRect(set.geometry.region, line, -TEXT_TOUCH) &&
              rectDepthInside(set.geometry.region, line) < TEXT_TOUCH,
          ),
        );
        // A text entirely inside the outline of a non-member is reported by set-contains-non-member.
        if (crossed) hits.push(element);
      }
      if (hits.length === 0) continue;
      const names = hits.map((h) => h.name);
      findings.push({
        message: `The outline of ${set.name} crosses the text of ${names.length === 1 ? names[0] : `${names.length} elements (${names.join(", ")})`}.`,
        path: set.docPath,
        subject: set.subject,
        hint: "A dashed or solid outline through text is hard to read. Move the members or the label apart (the `place` coordinates or a gap), use a smaller padding, or fit the set closer (a tilted ellipse: shape: ellipse with angle: auto).",
        related: hits.map((h) => ({
          path: h.docPath,
          message: `${capitalize(h.name)} is defined here.`,
        })),
      });
    }
    return findings;
  },
});

export const setLabelCollision = defineGeometryRule({
  id: "geometry/set-label-collision",
  description:
    "A set's label overlaps another label, a node's shape, an edge's route, or the boundary of another set.",
  defaultSeverity: "warning",
  fixable: false,
  run(context) {
    const findings: LintFinding[] = [];
    for (const set of context.sets) {
      const boxes = set.labels.flatMap((l) => l.visibleLines);
      if (boxes.length === 0) continue;
      const hits: { what: string; path: GeometrySet["docPath"] }[] = [];
      for (const element of context.elements) {
        if (element.kind !== "edge" && element.kind !== "group") {
          const outline = element.outline;
          const overlapsShape =
            outline !== undefined && boxes.some((b) => regionIntersectsRect(outline, b, TOLERANCE));
          const overlapsText = element.labels.some((l) =>
            l.visibleLines.some((line) => boxes.some((b) => rectsOverlap(b, line, TOLERANCE))),
          );
          if (overlapsShape || overlapsText)
            hits.push({ what: element.name, path: element.docPath });
        } else if (element.kind === "group") {
          const overlapsText = element.labels.some((l) =>
            l.visibleLines.some((line) => boxes.some((b) => rectsOverlap(b, line, TOLERANCE))),
          );
          if (overlapsText)
            hits.push({ what: `the title of ${element.name}`, path: element.docPath });
        } else if (
          element.drawn !== undefined &&
          boxes.some((b) => polylinesCrossRect(element.drawn ?? [], b, TOLERANCE))
        ) {
          hits.push({ what: `the route of ${element.name}`, path: element.docPath });
        }
      }
      for (const other of context.sets) {
        if (other === set) continue;
        const otherBoxes = other.labels.flatMap((l) => l.visibleLines);
        if (boxes.some((b) => otherBoxes.some((o) => rectsOverlap(b, o, TOLERANCE))))
          hits.push({ what: `the label of ${other.name}`, path: other.docPath });
        // A boundary through the text; a label wholly inside another set (a subset's title) is fine.
        else if (
          boxes.some(
            (b) =>
              regionIntersectsRect(other.geometry.region, b, TOLERANCE) &&
              rectDepthInside(other.geometry.region, b) < 0,
          )
        )
          hits.push({ what: `the boundary of ${other.name}`, path: other.docPath });
      }
      if (hits.length === 0) continue;
      findings.push({
        message: `The label of ${set.name} overlaps ${hits.map((h) => h.what).join(", ")}.`,
        path: [...set.docPath, "label"],
        subject: set.subject,
        hint: "Move the label with labelAt (top, top-right, right, bottom-right, bottom, bottom-left, left or top-left), shorten it, or move the sets apart.",
        related: hits.map((h) => ({ path: h.path, message: "It is defined here." })),
      });
    }
    return findings;
  },
});
