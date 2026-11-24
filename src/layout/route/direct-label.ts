import type { EdgeIR } from "../../compiler/ir";
import type { Point, TextLayout, TextMetrics } from "../ir";
import { roundUnits } from "../ir";
import { placeText } from "../structured/engine";
import { edgeArrowheadLength } from "./arrowhead";
import { isTagLabel, labelGap, tagPadding } from "./labels";

/**
 * The default side of a straight or curved label (#610), as the factor of the
 * left normal `(uy, -ux)`: above the line whichever way it runs (as the
 * orthogonal router places labels beside horizontal segments), and right of
 * a vertical one. A line within {@link STEEP_DEGREES} of vertical counts as
 * vertical, so a label does not jump sides as a near-vertical line tips over.
 */
export function readingSide(ux: number, uy: number): 1 | -1 {
  // The left normal (uy, -ux) points up by ux, and right by uy.
  if (Math.abs(ux) > Math.sin((STEEP_DEGREES * Math.PI) / 180)) return ux > 0 ? 1 : -1;
  return uy > 0 ? 1 : -1;
}

/** How close to vertical (degrees) a straight or curved line counts as vertical for its label's side. */
export const STEEP_DEGREES = 5;

/**
 * Horizontal text, offset by its support radius along the line's normal; a
 * tag (#610) is centred on the line (its framed box, `tagBox`, kept off the
 * arrowheads). `labelAt` as a fraction (#610) is of the line's length, kept
 * off the arrowheads like `start` / `end`.
 */
export function straightLabel(metrics: TextMetrics, a: Point, b: Point, edge: EdgeIR): TextLayout {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const ux = (b.x - a.x) / length;
  const uy = (b.y - a.y) / length;
  const gap = labelGap(edge.style);
  const tag = isTagLabel(edge);
  const pad = tag ? tagPadding(metrics, edge) : { x: 0, y: 0 };
  const width = metrics.width + 2 * pad.x;
  const height = metrics.height + 2 * pad.y;
  const along = (Math.abs(ux) * width + Math.abs(uy) * height) / 2;
  const away = tag ? 0 : (Math.abs(uy) * width + Math.abs(ux) * height) / 2 + gap;
  const at = edge.labelAt ?? "middle";
  const head = edgeArrowheadLength(edge.style);
  const start = along + gap + (edge.sourceArrowhead === undefined ? 0 : head);
  const end = length - along - gap - (edge.targetArrowhead === undefined ? 0 : head);
  const t =
    typeof at === "number"
      ? start <= end
        ? Math.min(end, Math.max(start, at * length))
        : length / 2
      : at === "start"
        ? Math.min(length / 2, start)
        : at === "end"
          ? Math.max(length / 2, end)
          : length / 2;
  const side =
    edge.labelSide === undefined ? readingSide(ux, uy) : edge.labelSide === "right" ? -1 : 1;
  return placeText(metrics, {
    x: roundUnits(a.x + ux * t + uy * away * side),
    y: roundUnits(a.y + uy * t - ux * away * side),
  });
}
