/**
 * Edge labels (#90): placed after routing, next to the arrowhead on the last
 * segment (the reference figures label adaLN taps this way; #86 prototype
 * `edge-labels.ts`). Collisions are reported by the checks, not resolved.
 */

import type { EdgeIR } from "../../compiler/ir";
import type { Point, TextLayout, TextMetrics } from "../ir";
import { placeText } from "../structured/engine";

/** Space between a label and its line, and between the label and the arrowhead, in units. */
export const EDGE_LABEL_GAP = 3;

/**
 * Places `metrics` beside the route:
 * - with an arrowhead at the target (or else at the source), on that end's
 *   last segment, just behind the arrowhead (`arrowhead` units long):
 *   above a horizontal segment, right of a vertical one;
 * - without arrowheads, at the middle of the longest segment, on the same side.
 */
export function placeEdgeLabel(
  metrics: TextMetrics,
  points: readonly Point[],
  edge: EdgeIR,
  arrowhead: number,
): TextLayout {
  const atSource = edge.targetArrowhead === undefined && edge.sourceArrowhead !== undefined;
  const line = atSource ? [...points].reverse() : points;
  const w = metrics.width;
  const h = metrics.height;
  const g = EDGE_LABEL_GAP;
  let tip: Point;
  let prev: Point;
  let back: number;
  if (edge.targetArrowhead !== undefined || edge.sourceArrowhead !== undefined) {
    tip = line[line.length - 1] as Point;
    prev = line[line.length - 2] as Point;
    back = arrowhead + g;
  } else {
    // The middle of the longest segment (the first of equals).
    let best = 1;
    let bestLength = -1;
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1] as Point;
      const b = line[i] as Point;
      const length = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      if (length > bestLength) {
        best = i;
        bestLength = length;
      }
    }
    const a = line[best - 1] as Point;
    const b = line[best] as Point;
    prev = a;
    tip = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    // Centered on the middle along the segment.
    back = -(Math.abs(b.x - a.x) > 0 ? w : h) / 2;
  }
  let center: Point;
  if (Math.abs(prev.y - tip.y) < 1e-9) {
    const dir = Math.sign(tip.x - prev.x) || 1;
    const x = dir > 0 ? tip.x - back - w : tip.x + back;
    center = { x: x + w / 2, y: tip.y - g - h / 2 };
  } else {
    const dir = Math.sign(tip.y - prev.y) || 1;
    const y = dir > 0 ? tip.y - back - h : tip.y + back;
    center = { x: tip.x + g + w / 2, y: y + h / 2 };
  }
  return placeText(metrics, center);
}
