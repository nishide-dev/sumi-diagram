/**
 * Placement rules (#546) for what the lint used to leave to the eye: an edge
 * label pressed against its own line, an edge label on the corner of a box,
 * and a row of tokens that drifts off the column of the row above it.
 */

import type { Rect } from "../../render/geometry";
import { unitsToPt } from "../../render/geometry";
import { defineGeometryRule, type LintFinding } from "../rule";
import { capitalize, drawnUnits, isDrawnEdge, isStructured, mmText, printedUnits } from "./common";
import type { GeometryElement } from "./context";
import { inkLines } from "./measure";
import { polylinesRectDistance } from "./proximity";
import { regionIntersectsRect } from "./shapes";

/** D2's rounding slack (0.5pt), as `GEOMETRY_TOLERANCE_UNITS` in the other rules. */
const OVERLAP_TOLERANCE_UNITS = 1;

/**
 * The printed clearance (1pt, about 0.35mm) under which an edge label counts
 * as pressed against its line. The router's own gap (3 units) leaves 0.4 to
 * 0.5mm between stroke and glyphs, and that is the shipped look, so the line
 * is drawn under it.
 */
export const LABEL_HUG_UNITS = 2;

/** The printed distance (1.5pt) within which an edge label counts as sitting on a box's corner. */
export const LABEL_CORNER_UNITS = 3;

/** The printed drift (0.5pt) of a token cell off its column under which the rows count as aligned. */
export const TOKEN_DRIFT_UNITS = 1;

export const edgeLabelHugging = defineGeometryRule({
  id: "geometry/edge-label-hugging",
  description:
    "An edge's label (glyph outlines) sits less than 1pt from its own line without touching it.",
  defaultSeverity: "info",
  fixable: false,
  run(context) {
    // D2 draws an auto figure's label on its line, over a masked gap.
    if (!isStructured(context)) return [];
    const findings: LintFinding[] = [];
    for (const edge of context.elements) {
      if (!isDrawnEdge(edge) || edge.drawn === undefined || edge.labels.length === 0) continue;
      const drawn = edge.drawn;
      const gap =
        Math.min(...edge.labels.flatMap(inkLines).map((ink) => polylinesRectDistance(drawn, ink))) -
        edge.strokeInset;
      // On or across the line: not a near miss.
      if (gap <= 0 || printedUnits(context, gap) >= LABEL_HUG_UNITS) continue;
      findings.push({
        message: `The label of ${edge.name} sits ${mmText(context, gap, 2)} from its line (under 1pt), so it reads as pressed against it.`,
        path: [...edge.docPath, "label"],
        subject: edge.subject,
        hint: "Move the label with labelAt / labelSide to a longer segment, widen the gap before the arrowhead, or use a smaller label so the text keeps clear of its line.",
      });
    }
    return findings;
  },
});

/** The corners of a polygonal outline, or none for an ellipse. */
const cornersOf = (element: GeometryElement): readonly { x: number; y: number }[] =>
  element.outline?.kind === "polygon" ? element.outline.points : [];

export const edgeLabelOnCorner = defineGeometryRule({
  id: "geometry/edge-label-on-corner",
  description:
    "An edge's label comes within 1.5pt of a corner of a node's outline without overlapping its shape.",
  defaultSeverity: "info",
  fixable: false,
  run(context) {
    const findings: LintFinding[] = [];
    const reach = drawnUnits(context, LABEL_CORNER_UNITS);
    for (const edge of context.elements) {
      if (edge.ir.kind !== "edge" || edge.labels.length === 0 || edge.ir.legend !== undefined)
        continue;
      const boxes = edge.labels.flatMap((l) => l.visibleLines);
      for (const node of context.elements) {
        if (node.kind !== "node" || node.outline === undefined) continue;
        const { outline } = node;
        // Overlapping the shape is label-collision's.
        if (boxes.some((r) => regionIntersectsRect(outline, r, OVERLAP_TOLERANCE_UNITS))) continue;
        let nearest = Number.POSITIVE_INFINITY;
        for (const corner of cornersOf(node)) {
          for (const r of boxes) {
            const dx = Math.max(r.x - corner.x, 0, corner.x - (r.x + r.width));
            const dy = Math.max(r.y - corner.y, 0, corner.y - (r.y + r.height));
            nearest = Math.min(nearest, Math.hypot(dx, dy));
          }
        }
        if (nearest >= reach) continue;
        findings.push({
          message: `The label of ${edge.name} sits ${nearest === 0 ? "on" : `${mmText(context, nearest, 2)} from`} a corner of ${node.name}.`,
          path: [...edge.docPath, "label"],
          subject: edge.subject,
          hint: "A label by a corner reads as belonging to the box. Move it with labelAt / labelSide, move the edge's ends (fromAnchor / toAnchor), or widen the gap so the label sits beside its line.",
          related: [{ path: node.docPath, message: `${capitalize(node.name)} is defined here.` }],
        });
      }
    }
    return findings;
  },
});

/** One horizontal row of the cells of a tokens node (one line of it), left to right. */
interface TokenRow {
  readonly cells: readonly GeometryElement[];
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/**
 * The horizontal token rows: a stack (`direction: down`) or a single cell is
 * not a row to line up with another.
 */
function tokenRows(elements: readonly GeometryElement[]): TokenRow[] {
  const groups = new Map<string, GeometryElement[]>();
  for (const e of elements) {
    const t = e.ir.tokens;
    if (e.ir.kind !== "node" || t === undefined || e.bbox === undefined) continue;
    if (t.separator !== undefined || t.blank !== undefined) continue;
    const key = `${t.id}\0${t.line ?? 0}`;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [e]);
    else group.push(e);
  }
  const rows: TokenRow[] = [];
  for (const group of groups.values()) {
    const cells = group.sort((a, b) => (a.bbox?.x ?? 0) - (b.bbox?.x ?? 0));
    const boxes = cells.map((c) => c.bbox as Rect);
    const first = boxes[0];
    const last = boxes.at(-1);
    if (first === undefined || last === undefined || cells.length < 2) continue;
    const top = Math.min(...boxes.map((r) => r.y));
    const bottom = Math.max(...boxes.map((r) => r.y + r.height));
    // Side by side: each cell starts at or after the end of the one before.
    const horizontal = boxes.every(
      (r, i) => i === 0 || r.x >= (boxes[i - 1] as Rect).x + (boxes[i - 1] as Rect).width - 1,
    );
    if (!horizontal) continue;
    rows.push({ cells, left: first.x, right: last.x + last.width, top, bottom });
  }
  return rows.sort((a, b) => a.top - b.top);
}

/** How many row heights below a row another row still counts as its neighbour. */
const NEIGHBOUR_ROW_HEIGHTS = 3;

/** Index of the first row (rows sorted by top) whose top is at least `y`. */
function firstRowFrom(rows: readonly TokenRow[], y: number): number {
  let lo = 0;
  let hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((rows[mid] as TokenRow).top < y) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The most drifted cell of `lower` under `upper`, if the rows are columns of one grid that slipped. */
function worstDrift(
  upper: TokenRow,
  lower: TokenRow,
  tolerance: number,
  sameWidth: number,
): { cell: GeometryElement; other: GeometryElement; drift: number } | undefined {
  if (upper.cells.length !== lower.cells.length) return undefined;
  // Grid evidence: the rows' extents mostly coincide.
  const shared = Math.min(upper.right, lower.right) - Math.max(upper.left, lower.left);
  if (shared < 0.5 * Math.min(upper.right - upper.left, lower.right - lower.left)) return undefined;
  let worst: { cell: GeometryElement; other: GeometryElement; drift: number } | undefined;
  for (const [n, a] of upper.cells.entries()) {
    const b = lower.cells[n] as GeometryElement;
    const ra = a.bbox;
    const rb = b.bbox;
    if (ra === undefined || rb === undefined) return undefined;
    const drift = Math.abs(rb.x + rb.width / 2 - (ra.x + ra.width / 2));
    const overlap = Math.min(ra.x + ra.width, rb.x + rb.width) - Math.max(ra.x, rb.x);
    const narrow = Math.min(ra.width, rb.width);
    // ...and the cells are the same size (within 10% or 1pt).
    if (Math.abs(ra.width - rb.width) > Math.max(0.1 * narrow, sameWidth)) return undefined;
    // Columns of one grid, not two unrelated rows: every pair is under the
    // other, and the miss is a small fraction of the cell.
    if (overlap < 0.75 * narrow || drift > 0.25 * narrow) return undefined;
    if (drift > tolerance && (worst === undefined || drift > worst.drift))
      worst = { cell: b, other: a, drift };
  }
  return worst;
}

export const tokenColumnDrift = defineGeometryRule({
  id: "geometry/token-column-drift",
  description:
    "A horizontal token row almost lines up, column by column, with the row just below it, but a cell sits off the centre of the cell above it.",
  defaultSeverity: "info",
  fixable: false,
  run(context) {
    const findings: LintFinding[] = [];
    const rows = tokenRows(context.elements);
    const tolerance = drawnUnits(context, TOKEN_DRIFT_UNITS);
    const sameWidth = drawnUnits(context, 2);
    for (let i = 0; i < rows.length; i++) {
      const upper = rows[i] as TokenRow;
      // The nearest row below that shares columns with this one, within a few
      // row heights: binary search to the first row clear of this one, then
      // the rows in the window in order of height, skipping (cheaply) those in
      // other columns; the first row that shares columns is the neighbour.
      const reach = upper.bottom + NEIGHBOUR_ROW_HEIGHTS * (upper.bottom - upper.top);
      let lower: TokenRow | undefined;
      const start = firstRowFrom(rows, upper.bottom - 1);
      for (let j = start; j < rows.length; j++) {
        const row = rows[j] as TokenRow;
        if (row.top > reach) break;
        if (row.left < upper.right && upper.left < row.right) {
          lower = row;
          break;
        }
      }
      const worst =
        lower === undefined ? undefined : worstDrift(upper, lower, tolerance, sameWidth);
      if (worst === undefined) continue;
      const { cell, other, drift } = worst;
      findings.push({
        message: `${capitalize(cell.name)} sits ${mmText(context, drift, 2)} (${unitsToPt(printedUnits(context, drift)).toFixed(1)}pt) off the centre of ${other.name}, so the two token rows drift apart column by column.`,
        path: cell.docPath,
        subject: cell.subject,
        hint: "Give the cells of both rows the same width and gap (props.width, props.gap), or lay the rows out as one sumi/matrix, so the columns line up exactly.",
        related: [{ path: other.docPath, message: `${capitalize(other.name)} is defined here.` }],
      });
    }
    return findings;
  },
});
