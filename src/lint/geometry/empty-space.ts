/** Bounding-box occupancy, not an ink/pixel estimate. Edges do not fill a panel. */
import type { Rect } from "../../render/geometry";
import type { GeometryContext, GeometryElement } from "./context";

/** Exact rectangle-union area, clipped to the group's frame. */
export function occupiedArea(frame: Rect, boxes: readonly Rect[]): number {
  const clipped = boxes.flatMap((box) => {
    const x = Math.max(frame.x, box.x);
    const y = Math.max(frame.y, box.y);
    const right = Math.min(frame.x + frame.width, box.x + box.width);
    const bottom = Math.min(frame.y + frame.height, box.y + box.height);
    return right > x && bottom > y ? [{ x, y, width: right - x, height: bottom - y }] : [];
  });
  const xs = [...new Set(clipped.flatMap((r) => [r.x, r.x + r.width]))].sort((a, b) => a - b);
  let area = 0;
  for (let i = 1; i < xs.length; i++) {
    const left = xs[i - 1] as number;
    const right = xs[i] as number;
    const intervals = clipped
      .filter((r) => r.x < right && r.x + r.width > left)
      .map((r) => [r.y, r.y + r.height] as const)
      .sort((a, b) => a[0] - b[0]);
    let end = -Infinity;
    let height = 0;
    for (const [start, stop] of intervals) {
      height += Math.max(0, stop - Math.max(start, end));
      end = Math.max(end, stop);
    }
    area += (right - left) * height;
  }
  return area;
}

/** Direct children occupy their whole footprint; nested groups are measured separately. */
export function groupEmptySpace(
  context: GeometryContext,
  group: GeometryElement,
): number | undefined {
  const frame = group.bbox;
  if (group.kind !== "group" || frame === undefined || frame.width <= 0 || frame.height <= 0)
    return undefined;
  const children = context.elements.filter(
    (e) => e.ir.kind !== "edge" && e.ir.parent === group.key,
  );
  // Empty groups have no sibling-sizing problem; generated frames are implementation details.
  if (
    children.length === 0 ||
    group.ir.tokens !== undefined ||
    group.ir.matrix !== undefined ||
    group.ir.legend !== undefined
  )
    return undefined;
  const childrenBoxes = children.flatMap((e) => [
    ...(e.bbox === undefined ? [] : [e.bbox]),
    ...e.labels.flatMap((l) => (l.box === undefined ? [] : [l.box])),
    ...(e.badge === undefined ? [] : [e.badge]),
  ]);
  // A partial inspection without measured children is not evidence of whitespace.
  if (childrenBoxes.length === 0) return undefined;
  const boxes = [
    ...group.labels.flatMap((l) => (l.box === undefined ? [] : [l.box])),
    ...childrenBoxes,
  ];
  return 1 - occupiedArea(frame, boxes) / (frame.width * frame.height);
}
