/** Figure-wide empty rectangles, using conservative body/label/painted-route footprints. */
import { formatMm, mmToPt } from "../../core/units";
import { arrowheadLength } from "../../layout/route/arrowhead";
import { type Rect, unitsToPt } from "../../render/geometry";
import { defineGeometryRule } from "../rule";
import type { GeometryContext } from "./context";
import { unionOf } from "./measure";
import { verifyHints } from "./verified";

export const DEAD_SPACE_THRESHOLD = 0.27;
const MIN_SIDE_PT = mmToPt(10);

/**
 * Exact largest axis-aligned empty rectangle for rectangular obstacles, clipped
 * to the frame. Coordinates are compressed to the obstacle edges; a sweep over
 * the compressed rows keeps a histogram of empty heights and finds the maximal
 * rectangles with a monotonic stack: O(X·Y + n·X) time, O(X + n) memory.
 * Ties prefer the smaller x, then the smaller y, so results are deterministic.
 */
export function largestEmptyRect(
  frame: Rect,
  obstacles: readonly Rect[],
  minSide = 0,
): Rect | undefined {
  if (frame.width <= 0 || frame.height <= 0) return undefined;
  const right = frame.x + frame.width;
  const bottom = frame.y + frame.height;
  const boxes: Rect[] = [];
  for (const box of obstacles) {
    const x = Math.max(frame.x, box.x);
    const y = Math.max(frame.y, box.y);
    const r = Math.min(right, box.x + box.width);
    const b = Math.min(bottom, box.y + box.height);
    if (r > x && b > y) boxes.push({ x, y, width: r - x, height: b - y });
  }
  const order = (a: number, b: number) => a - b;
  const xs = [...new Set([frame.x, right, ...boxes.flatMap((b) => [b.x, b.x + b.width])])].sort(
    order,
  );
  const ys = [...new Set([frame.y, bottom, ...boxes.flatMap((b) => [b.y, b.y + b.height])])].sort(
    order,
  );
  const xIndex = new Map(xs.map((v, i) => [v, i]));
  const yIndex = new Map(ys.map((v, i) => [v, i]));
  const cols = xs.length - 1;
  const rows = ys.length - 1;
  // Per compressed row: the obstacles that start and stop being active there.
  const starts: number[][] = Array.from({ length: rows }, () => []);
  const stops: number[][] = Array.from({ length: rows + 1 }, () => []);
  const spans = boxes.map((box, i) => {
    const y0 = yIndex.get(box.y) as number;
    const y1 = yIndex.get(box.y + box.height) as number;
    (starts[y0] as number[]).push(i);
    (stops[y1] as number[]).push(i);
    return [xIndex.get(box.x) as number, xIndex.get(box.x + box.width) as number] as const;
  });
  const blocked = new Int32Array(cols);
  const height = new Float64Array(cols);
  const stackAt = new Int32Array(cols + 1);
  const stackHeight = new Float64Array(cols + 1);
  let best: Rect | undefined;
  let area = 0;
  const consider = (left: number, end: number, h: number, bottomY: number) => {
    const width = (xs[end] as number) - (xs[left] as number);
    if (width < minSide || h < minSide) return;
    const candidate = width * h;
    const x = xs[left] as number;
    const y = bottomY - h;
    if (
      !best ||
      candidate > area ||
      (candidate === area && (x < best.x || (x === best.x && y < best.y)))
    ) {
      area = candidate;
      best = { x, y, width, height: h };
    }
  };
  for (let row = 0; row < rows; row++) {
    for (const i of stops[row] as number[]) {
      const [l, r] = spans[i] as readonly [number, number];
      for (let c = l; c < r; c++) blocked[c] = (blocked[c] as number) - 1;
    }
    for (const i of starts[row] as number[]) {
      const [l, r] = spans[i] as readonly [number, number];
      for (let c = l; c < r; c++) blocked[c] = (blocked[c] as number) + 1;
    }
    const step = (ys[row + 1] as number) - (ys[row] as number);
    const bottomY = ys[row + 1] as number;
    let top = 0;
    for (let c = 0; c <= cols; c++) {
      const h = c < cols && !blocked[c] ? (height[c] as number) + step : 0;
      if (c < cols) height[c] = h;
      let at = c;
      while (top > 0 && (stackHeight[top - 1] as number) >= h) {
        top--;
        at = stackAt[top] as number;
        const popped = stackHeight[top] as number;
        // A bar equal to the incoming one extends into it instead of closing.
        if (popped > 0 && popped > h) consider(at, c, popped, bottomY);
      }
      if (h > 0) {
        stackAt[top] = at;
        stackHeight[top] = h;
        top++;
      }
    }
  }
  return best;
}

function footprints(context: GeometryContext): Rect[] {
  return context.elements.flatMap((element) => {
    const boxes = [
      ...(element.bbox
        ? [
            {
              x: element.bbox.x - element.strokeInset,
              y: element.bbox.y - element.strokeInset,
              width: element.bbox.width + element.strokeInset * 2,
              height: element.bbox.height + element.strokeInset * 2,
            },
          ]
        : []),
      ...element.labels.flatMap((label) => (label.box ? [label.box] : [])),
      ...(element.badge ? [element.badge] : []),
    ];
    // A segment's bounding rectangle is conservative for diagonals/curves;
    // unlike a whole-route bbox it leaves the inside of an elbow available.
    const pad = Math.max(element.strokeInset, 1);
    for (const line of element.drawn ?? []) {
      for (let i = 1; i < line.length; i++) {
        const a = line[i - 1];
        const b = line[i];
        if (!a || !b) continue;
        boxes.push({
          x: Math.min(a.x, b.x) - pad,
          y: Math.min(a.y, b.y) - pad,
          width: Math.abs(b.x - a.x) + pad * 2,
          height: Math.abs(b.y - a.y) + pad * 2,
        });
      }
    }
    if (element.ir.kind === "edge") {
      const size =
        context.ir.meta.engine === "structured"
          ? arrowheadLength(element.ir.style.strokeWidth.units)
          : 4 + 3 * element.ir.style.strokeWidth.units;
      for (const source of [true, false]) {
        if ((source ? element.ir.sourceArrowhead : element.ir.targetArrowhead) === undefined)
          continue;
        const tip = source ? element.route?.[0]?.[0] : element.route?.at(-1)?.at(-1);
        if (tip)
          boxes.push({ x: tip.x - size, y: tip.y - size, width: size * 2, height: size * 2 });
      }
    }
    return boxes;
  });
}

/**
 * Unions boxes that share an extent on one axis and touch or overlap on the
 * other (consecutive collinear wire segments, duplicate shared wires). The
 * covered area is unchanged, so the empty-space search is identical, but far
 * fewer obstacles remain.
 */
export function mergeAligned(boxes: readonly Rect[]): Rect[] {
  let current = boxes.map((b) => ({ ...b }));
  for (const horizontal of [true, false, true]) {
    const groups = new Map<string, Rect[]>();
    for (const box of current) {
      const key = horizontal ? `${box.y}:${box.height}` : `${box.x}:${box.width}`;
      const group = groups.get(key);
      if (group) group.push(box);
      else groups.set(key, [box]);
    }
    const next: Rect[] = [];
    for (const group of groups.values()) {
      group.sort((a, b) => (horizontal ? a.x - b.x : a.y - b.y));
      let open = group[0] as Rect;
      for (const box of group.slice(1)) {
        const end = horizontal ? open.x + open.width : open.y + open.height;
        const start = horizontal ? box.x : box.y;
        if (start <= end) {
          const boxEnd = horizontal ? box.x + box.width : box.y + box.height;
          if (boxEnd > end) {
            if (horizontal) open.width = boxEnd - open.x;
            else open.height = boxEnd - open.y;
          }
        } else {
          next.push(open);
          open = box;
        }
      }
      next.push(open);
    }
    current = next;
  }
  return current;
}

/** Ignore outer margins: only search inside the union of the content's extents. */
export function figureDeadSpace(context: GeometryContext): Rect[] {
  const all = footprints(context);
  const boxes = mergeAligned(all);
  const content = unionOf(boxes);
  if (!content || context.canvas.width <= 0 || context.canvas.height <= 0) return [];
  const x = Math.max(content.x, context.canvas.x);
  const y = Math.max(content.y, context.canvas.y);
  const frame = {
    x,
    y,
    width: Math.min(content.x + content.width, context.canvas.x + context.canvas.width) - x,
    height: Math.min(content.y + content.height, context.canvas.y + context.canvas.height) - y,
  };
  const total = context.canvas.width * context.canvas.height;
  const scale = context.inspection.scale ?? 1;
  // The area threshold already implies a minimum extent on each side (the
  // frame never exceeds the canvas), so only the absolute floor is needed.
  const minSide = (MIN_SIDE_PT * 2) / scale;
  const found: Rect[] = [];
  for (let i = 0; i < 3; i++) {
    const rect = largestEmptyRect(frame, [...boxes, ...found], minSide);
    if (!rect || (rect.width * rect.height) / total < DEAD_SPACE_THRESHOLD) break;
    found.push(rect);
  }
  return found;
}

function position(rect: Rect, frame: Rect): string {
  // Compare opposing clearances, so a large corner void is still called
  // left/right even when its centre extends into the middle third.
  const axis = (start: number, size: number, origin: number, extent: number) => {
    const before = start - origin;
    const after = origin + extent - start - size;
    return before + extent * 0.15 < after ? -1 : after + extent * 0.15 < before ? 1 : 0;
  };
  const x = axis(rect.x, rect.width, frame.x, frame.width);
  const y = axis(rect.y, rect.height, frame.y, frame.height);
  return `${y < 0 ? "top" : y > 0 ? "bottom" : "middle"}-${x < 0 ? "left" : x > 0 ? "right" : "center"}`;
}

export const deadSpace = defineGeometryRule({
  id: "geometry/dead-space",
  description:
    "A figure-wide empty rectangle occupies at least 27% of the canvas and is at least 10mm on both sides.",
  defaultSeverity: "info",
  fixable: false,
  run(context) {
    const rects = figureDeadSpace(context);
    if (!rects.length) return [];
    const scale = context.inspection.scale ?? 1;
    const mm = (n: number) => formatMm(unitsToPt(n * scale));
    return [
      {
        message: `The figure has large empty rectangles: ${rects.map((r) => `${position(r, context.canvas)} ${mm(r.width)} × ${mm(r.height)} (${((100 * r.width * r.height) / (context.canvas.width * context.canvas.height)).toFixed(1)}% of the canvas)`).join("; ")}.`,
        path: ["figure", "layout"],
        subject: { kind: "figure", id: context.ir.meta.id },
        hint: `Whitespace can be intentional; review the layout before reducing gaps or scaling. ${verifyHints(context, "empty", (trial) => (figureDeadSpace(trial).length ? 1 : 0))} Suppress with sumi lint --geometry --rule geometry/dead-space=off, or {"rules":{"geometry/dead-space":"off"}} in the --config file.`,
      },
    ];
  },
});
