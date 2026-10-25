/**
 * Edge labels next to the arrowhead (the reference figures label adaLN taps
 * this way): on the last segment, just past the arrowhead, on the upper /
 * outer side of the line. Placed after routing; collisions are reported by
 * the checks, not resolved here.
 */
import { type Rect, STYLE } from "./layout";
import type { Point, RoutedEdge } from "./route";
import { type MeasuredLabel, measureLabel } from "./text";

export const LABEL_GAP = 3;
export const ARROW_LENGTH = 9;

export interface PlacedLabel {
  edge: number;
  rect: Rect;
  label: MeasuredLabel;
}

export function placeEdgeLabels(routed: RoutedEdge[]): PlacedLabel[] {
  const out: PlacedLabel[] = [];
  for (const e of routed) {
    if (e.edge.label === "") continue;
    const label = measureLabel(e.edge.label, STYLE.fontSize * 0.875); // 7pt, the themes' edge label size
    const tip = e.points.at(-1) as Point;
    const prev = e.points.at(-2) as Point;
    const horizontal = Math.abs(prev.y - tip.y) < 1e-9;
    const w = Math.ceil(label.width);
    const h = Math.ceil(label.height);
    const back = ARROW_LENGTH + LABEL_GAP;
    let rect: Rect;
    if (horizontal) {
      const dir = Math.sign(tip.x - prev.x); // +1: path goes right
      const x = dir > 0 ? tip.x - back - w : tip.x + back;
      rect = { x, y: tip.y - LABEL_GAP - h, w, h };
    } else {
      const dir = Math.sign(tip.y - prev.y);
      const y = dir > 0 ? tip.y - back - h : tip.y + back;
      rect = { x: tip.x + LABEL_GAP, y, w, h };
    }
    out.push({ edge: e.edge.index, rect, label });
  }
  return out;
}
