/** Figure-wide empty rectangles, using conservative body/label/painted-route footprints. */
import { formatMm, mmToPt } from "../../core/units";
import { arrowheadLength } from "../../layout/route/arrowhead";
import { type Rect, unitsToPt } from "../../render/geometry";
import { defineGeometryRule } from "../rule";
import type { GeometryContext } from "./context";
import { unionOf } from "./measure";
import { verifyHints } from "./verified";

export const DEAD_SPACE_THRESHOLD = 0.25;
const MIN_SIDE_PT = mmToPt(10);

/** Exact largest axis-aligned empty rectangle for rectangular obstacles, clipped to frame. */
export function largestEmptyRect(
  frame: Rect,
  obstacles: readonly Rect[],
  minSide = 0,
): Rect | undefined {
  if (frame.width <= 0 || frame.height <= 0) return undefined;
  const right = frame.x + frame.width;
  const bottom = frame.y + frame.height;
  const boxes = obstacles.flatMap((box) => {
    const x = Math.max(frame.x, box.x);
    const y = Math.max(frame.y, box.y);
    const r = Math.min(right, box.x + box.width);
    const b = Math.min(bottom, box.y + box.height);
    return r > x && b > y ? [{ x, y, width: r - x, height: b - y }] : [];
  });
  const xs = [...new Set([frame.x, right, ...boxes.flatMap((b) => [b.x, b.x + b.width])])].sort(
    (a, b) => a - b,
  );
  const byY = [...boxes].sort((a, b) => a.y - b.y);
  let best: Rect | undefined;
  let area = 0;
  for (let i = 0; i < xs.length - 1; i++) {
    const left = xs[i] as number;
    for (let j = i + 1; j < xs.length; j++) {
      const end = xs[j] as number;
      const width = end - left;
      if (width < minSide) continue;
      if (width * frame.height <= area) continue;
      let y = frame.y;
      const consider = (stop: number) => {
        const height = stop - y;
        if (height >= minSide && width * height > area) {
          area = width * height;
          best = { x: left, y, width, height };
        }
      };
      for (const box of byY) {
        if (box.x >= end || box.x + box.width <= left) continue;
        consider(box.y);
        y = Math.max(y, box.y + box.height);
      }
      consider(bottom);
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

/** Ignore outer margins: only search inside the union of the content's extents. */
export function figureDeadSpace(context: GeometryContext): Rect[] {
  const all = footprints(context);
  // Whole group frames already occupy their descendants; remove redundant
  // rectangles before the exact search, including duplicate shared wires.
  const boxes = all.filter(
    (a, i) =>
      !all.some(
        (b, j) =>
          i !== j &&
          b.x <= a.x &&
          b.y <= a.y &&
          b.x + b.width >= a.x + a.width &&
          b.y + b.height >= a.y + a.height &&
          (j < i || b.width * b.height > a.width * a.height),
      ),
  );
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
  const found: Rect[] = [];
  for (let i = 0; i < 3; i++) {
    const rect = largestEmptyRect(frame, [...boxes, ...found], (MIN_SIDE_PT * 2) / scale);
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
    "A figure-wide empty rectangle occupies at least 25% of the canvas and is at least 10mm on both sides.",
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
        hint: `Whitespace can be intentional; review the layout before reducing gaps or scaling. ${verifyHints(context, "empty", (trial) => (figureDeadSpace(trial).length ? 1 : 0))} Suppress with geometry/dead-space: off in the lint configuration.`,
      },
    ];
  },
});
