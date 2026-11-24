/**
 * `geometry/edge-label-ambiguous` (#642, design record
 * `docs/design/decisions/642-block-anchor.md`): an edge's label sits about
 * as close to another edge's line as to its own, so a reader can take it for
 * the other edge's label (two parallel lines with the label between them,
 * #639 run 4; a label under one line and over the next, run 9).
 *
 * Measured on the letters (re-measured glyph outlines per line) against the
 * painted strokes: `own` is the room to the edge's own line, `other` to the
 * nearest other edge's. The label is ambiguous when `other` is at most
 * {@link AMBIGUOUS_RATIO} × `own` and within the distance a label reads as a
 * line's at all (the label gap plus three quarters of the text size, as
 * `geometry/edge-label-detached`). Not checked: a tag (it sits on its own
 * line), a label touching its own line or crossed by the other line (other
 * rules report those), edges of one net (they share a trunk on purpose),
 * zoom lines and the lifelines of a sequence diagram (they carry no labels),
 * and two messages of a sequence diagram: the layout puts every message's
 * label above its own arrow, so with a tight `rowGap` a label can come close
 * to the arrow of the row above without being read as its label.
 */

import type { ArrangeBoxIR, EdgeIR, FigureIR, SequenceRowIR } from "../../compiler/ir";
import type { ElementKey } from "../../core/check-state";
import type { Point } from "../../core/geometry";
import { isTagLabel, labelGap } from "../../layout/route/labels";
import { defineGeometryRule, type LintFinding } from "../rule";
import { capitalize, isDrawnEdge, isStructured, mmText } from "./common";
import type { GeometryElement } from "./context";
import { inkLines } from "./measure";
import { polylinesRectDistance } from "./proximity";

/** The other line counts when it is at most this many times as far from the letters as the own line. */
export const AMBIGUOUS_RATIO = 1.75;

export const EDGE_LABEL_AMBIGUOUS = "geometry/edge-label-ambiguous";

/**
 * How far beyond the label gap, in font sizes, a line can be and still read as the label's:
 * `DETACHED_FONT_SIZES` of `placement-drift.ts` (not imported: that module sits in the rule
 * list's import cycle).
 */
const READING_FONT_SIZES = 0.75;

/** Whether an edge's line competes for labels: drawn, not a zoom edge, not a lifeline. */
const competes = (e: GeometryElement): e is GeometryElement & { ir: EdgeIR } =>
  isDrawnEdge(e) &&
  e.ir.kind === "edge" &&
  e.ir.routing !== "zoom" &&
  e.ir.lifeline !== true &&
  e.drawn !== undefined;

/**
 * The side of the edge's route (facing from source to target) the label's
 * centre is on, at the route's segment nearest to it; `undefined` on the line.
 */
export function labelSideOf(
  route: readonly (readonly Point[])[],
  at: Point,
): "left" | "right" | undefined {
  let best: { d: number; cross: number } | undefined;
  for (const line of route) {
    for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i] as Point;
      const b = line[i + 1] as Point;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      if (len2 === 0) continue;
      const t = Math.max(0, Math.min(1, ((at.x - a.x) * dx + (at.y - a.y) * dy) / len2));
      const d = Math.hypot(at.x - (a.x + t * dx), at.y - (a.y + t * dy));
      const cross = dx * (at.y - a.y) - dy * (at.x - a.x);
      if (best === undefined || d < best.d) best = { d, cross };
    }
  }
  if (best === undefined || Math.abs(best.cross) < 1e-9) return undefined;
  // SVG's y points down: a negative cross product is on the left of the direction of travel.
  return best.cross < 0 ? "left" : "right";
}

/** The messages of the figure's sequence diagrams (#630), by edge key. */
function sequenceMessages(ir: FigureIR): Set<ElementKey> {
  const out = new Set<ElementKey>();
  const rows = (list: readonly SequenceRowIR[]): void => {
    for (const row of list) {
      if (row.kind === "message") out.add(row.edge);
      else if (row.kind === "band" || row.kind === "fragment") rows(row.rows);
    }
  };
  const visit = (box: ArrangeBoxIR) => {
    rows(box.sequence?.rows ?? []);
    for (const item of box.items) if (item !== null && typeof item !== "string") visit(item);
  };
  if (ir.arrange !== undefined) visit(ir.arrange);
  for (const group of ir.groups) if (group.arrange !== undefined) visit(group.arrange);
  return out;
}

export const edgeLabelAmbiguous = defineGeometryRule({
  id: EDGE_LABEL_AMBIGUOUS,
  description:
    "An edge's label (glyph outlines) sits about as close to another edge's line as to its own (at most 1.75 times as far), so it can be read as the other edge's label.",
  defaultSeverity: "warning",
  fixable: false,
  run(context) {
    // D2 draws an auto figure's labels on their lines.
    if (!isStructured(context)) return [];
    const nets = new Map(
      (context.layout?.edges ?? []).flatMap((e) =>
        e.route?.net === undefined ? [] : [[e.key, e.route.net] as const],
      ),
    );
    const edges = context.elements.filter(competes);
    const messages = sequenceMessages(context.ir);
    const findings: LintFinding[] = [];
    for (const edge of edges) {
      if (edge.labels.length === 0 || isTagLabel(edge.ir)) continue;
      const inks = edge.labels.flatMap(inkLines);
      if (inks.length === 0) continue;
      const distance = (e: GeometryElement & { ir: EdgeIR }) =>
        Math.min(...inks.map((ink) => polylinesRectDistance(e.drawn ?? [], ink))) - e.strokeInset;
      const own = distance(edge);
      if (own <= 0) continue;
      const size = Math.max(...edge.labels.map((l) => l.label.fontSizeUnits));
      const reach = labelGap(edge.ir.style) + READING_FONT_SIZES * size;
      const net = nets.get(edge.key);
      let rival: { element: GeometryElement; gap: number } | undefined;
      for (const other of edges) {
        if (other === edge) continue;
        if (net !== undefined && nets.get(other.key) === net) continue;
        // Two messages of a sequence diagram: each label sits above its own arrow by the
        // layout's rule, the same in every row, so the row above never owns it.
        if (messages.has(edge.key) && messages.has(other.key)) continue;
        const gap = distance(other);
        // Crossing or touching the letters is edge-crosses-label's / edge-touches-label's.
        if (gap <= 0 || gap > reach || gap > own * AMBIGUOUS_RATIO) continue;
        if (rival === undefined || gap < rival.gap) rival = { element: other, gap };
      }
      if (rival === undefined) continue;
      const xs = inks.flatMap((r) => [r.x, r.x + r.width]);
      const ys = inks.flatMap((r) => [r.y, r.y + r.height]);
      const side = labelSideOf(edge.route ?? [], {
        x: (Math.min(...xs) + Math.max(...xs)) / 2,
        y: (Math.min(...ys) + Math.max(...ys)) / 2,
      });
      const text = JSON.stringify(edge.labels.map((l) => l.texts.join(" ")).join(" "));
      const flip =
        side === undefined
          ? "labelSide (left or right of the direction of travel)"
          : `labelSide: ${side === "left" ? "right" : "left"} (it is now on the ${side} of the direction of travel)`;
      findings.push({
        message: `The label ${text} of ${edge.name} sits ${mmText(context, rival.gap, 1)} from ${rival.element.name}, about as close as to its own line (${mmText(context, own, 1)}), so it can be read as that edge's label.`,
        path: [...edge.docPath, "label"],
        subject: edge.subject,
        hint: `Draw it on its own line with labelStyle: tag, move it to the other side with ${flip}, slide it along the line with labelAt (e.g. 0.3) to where the lines are farther apart, or move the ends apart (fromAnchor / toAnchor, a larger gap).`,
        related: [
          {
            path: rival.element.docPath,
            message: `${capitalize(rival.element.name)} is defined here.`,
          },
        ],
      });
    }
    return findings;
  },
});
