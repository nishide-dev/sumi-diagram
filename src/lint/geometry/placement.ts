/**
 * Placement rules (#546) for what the lint used to leave to the eye: an edge
 * label pressed against its own line, an edge label on the corner of a box,
 * and a row of tokens that drifts off the column of the row above it.
 */

import type { FigureIR } from "../../compiler/ir";
import type { ElementKey } from "../../core/check-state";
import { mmToPt } from "../../core/units";
import {
  asHintTrial,
  hintLayoutOptions,
  inHintTrial,
  MAX_HINT_ELEMENTS,
} from "../../layout/hint-trials";
import { isTagLabel, labelGap } from "../../layout/route/labels";
import { placeStructured } from "../../layout/structured/engine";
import type { Rect } from "../../render/geometry";
import { unitsToMm, unitsToPt } from "../../render/geometry";
import { defineGeometryRule, type LintFinding } from "../rule";
import { capitalize, drawnUnits, isDrawnEdge, isStructured, mmText, printedUnits } from "./common";
import type { GeometryContext, GeometryElement } from "./context";
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

/**
 * Under a theme that sets `edgeLabelGap` (#546) the label has that gap by
 * default, so a label counts as pressed against its line when it is closer
 * than this share of it (a label the router moved off its default place, or
 * one set by hand).
 */
export const LABEL_HUG_SHARE = 0.75;

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
      // A tag (#610) sits on its line in a frame that hides it.
      if (edge.ir.kind === "edge" && isTagLabel(edge.ir)) continue;
      const drawn = edge.drawn;
      const gap =
        Math.min(...edge.labels.flatMap(inkLines).map((ink) => polylinesRectDistance(drawn, ink))) -
        edge.strokeInset;
      // On or across the line: not a near miss.
      if (gap <= 0) continue;
      const style = edge.ir.style;
      const themed = style.kind === "edge" ? style.labelGap : undefined;
      const tooClose =
        style.kind === "edge" && themed !== undefined
          ? gap < labelGap(style) * LABEL_HUG_SHARE
          : printedUnits(context, gap) < LABEL_HUG_UNITS;
      if (!tooClose) continue;
      findings.push({
        message: `The label of ${edge.name} sits ${mmText(context, gap, 2)} from its line (under ${themed === undefined ? "1pt" : "the theme's label gap"}), so it reads as pressed against it.`,
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

/** Below this (units), two widths, gaps or starts count as the same (layout rounding, D2's half units). */
const SAME_UNITS = 0.1;

/** A placed node beside a token row, for naming what shifts the row (#647). */
interface Footprint {
  readonly key: ElementKey;
  readonly name: string;
  readonly rect: Rect;
  /** The tokens node a cell belongs to. */
  readonly tokens?: string;
}

/** Every placed node: the structured layout's boxes (text nodes included), else the drawn shapes. */
function footprints(context: GeometryContext): Footprint[] {
  const footprint = (
    key: ElementKey,
    element: GeometryElement | undefined,
    rect: Rect,
  ): Footprint => ({
    key,
    name: element?.name ?? key,
    rect,
    ...(element?.ir.tokens !== undefined && { tokens: element.ir.tokens.id }),
  });
  if (context.layout !== undefined)
    return context.layout.nodes.map((n) => footprint(n.key, context.get(n.key), n.rect));
  return context.elements.flatMap((e) =>
    e.kind === "node" && e.bbox !== undefined ? [footprint(e.key, e, e.bbox)] : [],
  );
}

/** The nearest node right before (or after) a row on its band, within three row heights. */
function besideRow(
  boxes: readonly Footprint[],
  row: TokenRow,
  side: "before" | "after",
): Footprint | undefined {
  const id = row.cells[0]?.ir.tokens?.id;
  const reach = NEIGHBOUR_ROW_HEIGHTS * (row.bottom - row.top);
  let nearest: { box: Footprint; distance: number } | undefined;
  for (const box of boxes) {
    const r = box.rect;
    if (box.tokens === id || r.y >= row.bottom || r.y + r.height <= row.top) continue;
    const distance = side === "before" ? row.left - (r.x + r.width) : r.x - row.right;
    if (distance < -SAME_UNITS || distance > reach) continue;
    if (nearest === undefined || distance < nearest.distance) nearest = { box, distance };
  }
  return nearest?.box;
}

/** `12mm`, or `12–12.5mm` when the values differ. */
function rangeText(context: GeometryContext, values: readonly number[]): string {
  const low = Math.min(...values);
  const high = Math.max(...values);
  return high - low <= SAME_UNITS
    ? mmText(context, low, 2)
    : `${mmText(context, low, 2).replace(/mm$/, "")}–${mmText(context, high, 2)}`;
}

/** Trial layouts the drift hints may run per figure (#647). */
const DRIFT_TRIALS = 4;
/** The largest figure (elements) the drift hints lay out again. */
const DRIFT_TRIAL_ELEMENTS = 4 * MAX_HINT_ELEMENTS;
const driftTrials = new WeakMap<GeometryContext, { budget: number }>();

/**
 * Lays the figure out again with `a` and `b` both `widthMm` wide (as
 * `props.width` on both would) and measures the two rows there: `true` if
 * every cell then sits within the drift tolerance of the cell above it,
 * `false` if not, `undefined` if no trial could be made (an auto figure, a
 * large one, a trial inside a trial, or the budget spent).
 */
function equalWidthsAlign(
  context: GeometryContext,
  upper: TokenRow,
  lower: TokenRow,
  keys: readonly ElementKey[],
  widthMm: number,
): boolean | undefined {
  const placed = context.placed;
  if (placed === undefined || inHintTrial()) return undefined;
  const original = placed.ir;
  // Placement only (no routing, no lint of the trial), so a larger figure than
  // the routed hint trials take is fine.
  if (original.meta.engine !== "structured" || original.elements.size > DRIFT_TRIAL_ELEMENTS)
    return undefined;
  let state = driftTrials.get(context);
  if (state === undefined) {
    state = { budget: DRIFT_TRIALS };
    driftTrials.set(context, state);
  }
  if (state.budget <= 0) return undefined;
  state.budget--;
  const units = Math.round(mmToPt(widthMm) * 2);
  const width = { pt: units / 2, units };
  const nodes = original.nodes.map((n) => (keys.includes(n.key) ? { ...n, width } : n));
  const ir: FigureIR = {
    ...original,
    nodes,
    elements: new Map(
      [...original.elements].map(([k, e]) => [k, nodes.find((n) => n.key === k) ?? e]),
    ),
  };
  const laid = asHintTrial(() => {
    try {
      return placeStructured(ir, hintLayoutOptions.get(original));
    } catch {
      return undefined;
    }
  });
  if (laid === undefined || laid.diagnostics.some((d) => d.severity === "error")) return undefined;
  const rects = new Map(laid.layout.nodes.map((n) => [n.key, n.rect]));
  const tolerance = drawnUnits(context, TOKEN_DRIFT_UNITS);
  return upper.cells.every((cell, i) => {
    const a = rects.get(cell.key);
    const b = rects.get((lower.cells[i] as GeometryElement).key);
    return (
      a !== undefined &&
      b !== undefined &&
      Math.abs(b.x + b.width / 2 - (a.x + a.width / 2)) <= tolerance
    );
  });
}

/**
 * The hint of a drift (#647): what was measured to differ between the two
 * rows. The cells' widths and gaps and where the rows start are measured;
 * a neighbour is named as the cause only when a trial layout with the two
 * neighbours made one width lines the rows up.
 */
function driftHint(context: GeometryContext, upper: TokenRow, lower: TokenRow): string {
  const widths = (row: TokenRow) => row.cells.map((c) => (c.bbox as Rect).width);
  const gaps = (row: TokenRow) =>
    row.cells.slice(1).map((c, i) => {
      const before = row.cells[i]?.bbox as Rect;
      return (c.bbox as Rect).x - (before.x + before.width);
    });
  const tokensName = (row: TokenRow) => `tokens "${row.cells[0]?.ir.tokens?.id ?? "?"}"`;
  const differs = (a: readonly number[], b: readonly number[]) =>
    a.some((v, i) => Math.abs(v - (b[i] ?? v)) > SAME_UNITS);
  const cells = (row: TokenRow) =>
    `${tokensName(row)} has ${rangeText(context, widths(row))} cells${
      row.cells.length > 1 ? ` with ${rangeText(context, gaps(row))} gaps` : ""
    }`;
  const shift = lower.left - upper.left;
  const starts =
    Math.abs(shift) > SAME_UNITS
      ? `${tokensName(lower)} starts ${mmText(context, Math.abs(shift), 2)} ${shift > 0 ? "right" : "left"} of ${tokensName(upper)}`
      : undefined;
  if (differs(widths(upper), widths(lower)) || differs(gaps(upper), gaps(lower))) {
    const offset = (i: number) => {
      const a = upper.cells[i]?.bbox as Rect;
      const b = lower.cells[i]?.bbox as Rect;
      return mmText(context, Math.abs(b.x + b.width / 2 - (a.x + a.width / 2)), 2);
    };
    return `The cells differ (${cells(upper)}, ${cells(lower)})${starts === undefined ? "" : `, and ${starts}`}: the centres are ${offset(0)} apart at the first column and ${offset(upper.cells.length - 1)} at the last. Give the cells of both rows the same width and gap (props.width, props.gap)${starts === undefined ? "" : " and start the rows at the same x"}, or lay the rows out as one sumi/matrix.`;
  }
  const start = `Both rows have the same cells, but ${starts ?? `${tokensName(lower)} is off ${tokensName(upper)}`}`;
  const fallback =
    "Make the rows start at the same x: line up what positions them in their arrangement (the same width for the items before them, or the same align), or lay the rows out as one sumi/matrix.";
  const boxes = footprints(context);
  const unchecked: string[] = [];
  for (const side of ["before", "after"] as const) {
    const a = besideRow(boxes, upper, side);
    const b = besideRow(boxes, lower, side);
    if (a === undefined || b === undefined) continue;
    if (Math.abs(a.rect.width - b.rect.width) <= SAME_UNITS) continue;
    const measured = `${a.name} (${side} ${tokensName(upper)}) is ${mmText(context, a.rect.width, 2)} wide and ${b.name} (${side} ${tokensName(lower)}) ${mmText(context, b.rect.width, 2)}`;
    // The width to write: the wider one, rounded up to 0.1mm.
    const widthMm = Math.ceil(unitsToMm(Math.max(a.rect.width, b.rect.width)) * 10 - 1e-6) / 10;
    const aligned = equalWidthsAlign(context, upper, lower, [a.key, b.key], widthMm);
    if (aligned === true)
      return `${start}: ${measured}. Verified: props.width ${widthMm}mm on both ${a.name} and ${b.name} lines the rows up (laid out again as a trial).`;
    if (aligned === undefined) unchecked.push(measured);
  }
  if (unchecked.length > 0)
    return `${start}. Beside them, ${unchecked.join("; ")} (not checked whether that moves the rows). ${fallback}`;
  return `${start}. ${fallback}`;
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
        message: `${capitalize(cell.name)} sits ${mmText(context, drift, 2)} (${unitsToPt(printedUnits(context, drift)).toFixed(1)}pt) off the centre of ${other.name}, so the columns of tokens "${upper.cells[0]?.ir.tokens?.id ?? "?"}" and tokens "${(lower as TokenRow).cells[0]?.ir.tokens?.id ?? "?"}" do not line up.`,
        path: cell.docPath,
        subject: cell.subject,
        hint: driftHint(context, upper, lower as TokenRow),
        related: [{ path: other.docPath, message: `${capitalize(other.name)} is defined here.` }],
      });
    }
    return findings;
  },
});
