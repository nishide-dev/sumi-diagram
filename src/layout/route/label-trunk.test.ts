import { expect, test } from "bun:test";
import type { EdgeIR } from "../../compiler/ir";
import type { Point, Rect, TextMetrics } from "../ir";
import { EDGE_LABEL_GAP, placeEdgeLabel } from "./labels";

const metrics: TextMetrics = {
  lines: ["+e"],
  lineWidths: [30],
  font: "regular",
  fontSizeUnits: 12,
  lineHeightUnits: 14,
  ascentUnits: 10,
  descentUnits: 4,
  width: 30,
  height: 14,
};
const edge = { targetArrowhead: "triangle" } as unknown as EdgeIR;
const p = (x: number, y: number): Point => ({ x, y });
const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

// A branch leaves a junction on a trunk that runs 10 units above the bottom
// border of a group, then turns up into a box after a short stem (#411). The
// place beside the trunk that faces away from the stem is across the border;
// the label must take the free side above the trunk.
test("a label beside a trunk near a group's border takes the free side (#411)", () => {
  const group: Rect = { x: 0, y: 0, width: 400, height: 310 };
  const target: Rect = { x: 80, y: 240, width: 40, height: 45 };
  const route = [p(300, 300), p(100, 300), p(100, 285)];
  const layout = placeEdgeLabel(metrics, route, edge, 8, {
    groups: [group],
    nodes: [target],
  });
  const box = layout.box;
  const bottomBorder: Rect = { x: 0, y: 310, width: 400, height: 0 };
  expect(overlaps(box, bottomBorder)).toBe(false);
  expect(box.y + box.height).toBeLessThanOrEqual(300 - EDGE_LABEL_GAP + 1e-6);
  expect(overlaps(box, target)).toBe(false);
});
