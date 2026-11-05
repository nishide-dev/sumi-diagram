import type { EdgeIR } from "../../compiler/ir";
import type { Point, TextLayout, TextMetrics } from "../ir";
import { roundUnits } from "../ir";
import { placeText } from "../structured/engine";
import { arrowheadLength } from "./arrowhead";
import { EDGE_LABEL_GAP } from "./labels";

/** Horizontal text, offset by its support radius along the line's normal. */
export function straightLabel(metrics: TextMetrics, a: Point, b: Point, edge: EdgeIR): TextLayout {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const ux = (b.x - a.x) / length;
  const uy = (b.y - a.y) / length;
  const along = (Math.abs(ux) * metrics.width + Math.abs(uy) * metrics.height) / 2;
  const away = (Math.abs(uy) * metrics.width + Math.abs(ux) * metrics.height) / 2 + EDGE_LABEL_GAP;
  const at = edge.labelAt ?? "middle";
  const head = arrowheadLength(edge.style.strokeWidth.units);
  const start = along + EDGE_LABEL_GAP + (edge.sourceArrowhead === undefined ? 0 : head);
  const end = length - along - EDGE_LABEL_GAP - (edge.targetArrowhead === undefined ? 0 : head);
  const t =
    at === "start"
      ? Math.min(length / 2, start)
      : at === "end"
        ? Math.max(length / 2, end)
        : length / 2;
  const side = edge.labelSide === "right" ? -1 : 1;
  return placeText(metrics, {
    x: roundUnits(a.x + ux * t + uy * away * side),
    y: roundUnits(a.y + uy * t - ux * away * side),
  });
}
