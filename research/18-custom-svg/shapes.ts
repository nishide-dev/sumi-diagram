/**
 * PoC for #18: two generic custom node shapes, written as the pure "outline
 * renderer" functions the design memo proposes
 * (docs/research/18-custom-svg-components.md §5).
 *
 * A renderer is a pure function of the laid-out footprint (the placeholder
 * rectangle D2/ELK placed) and returns:
 * - `layers`: closed polygons to draw, back to front, all inside the footprint;
 * - `outline`: the silhouette edges must touch (may be non-convex);
 * - `safeArea`: where the label may be drawn;
 * and `footprintFor()` gives the footprint needed to fit a given label box.
 *
 * Coordinates are SVG user units (= D2 units, 1 unit = 0.5pt). Research code:
 * not imported by Sumi's product code.
 */

import type { Point, Rect } from "../../src/render/geometry";

export type Polygon = readonly Point[];

export interface ShapeDrawing {
  /** Closed polygons, drawn back to front with the element's style. */
  layers: Polygon[];
  /** The silhouette where edges should end (the union of the layers). */
  outline: Polygon;
  /** Where the label may go; its center is where the label is drawn. */
  safeArea: Rect;
}

export interface CustomShape {
  name: string;
  /** The drawing for a laid-out footprint. Pure and deterministic. */
  draw(footprint: Rect): ShapeDrawing;
  /**
   * The footprint size whose safe area is at least `label` (D2's own padded
   * label box). Used to give the placeholder an explicit size.
   */
  footprintFor(label: { width: number; height: number }): { width: number; height: number };
}

const rectPolygon = ({ x, y, width, height }: Rect): Polygon => [
  { x, y },
  { x: x + width, y },
  { x: x + width, y: y + height },
  { x, y: y + height },
];

/** Horizontal inset of the trapezoid's short (bottom) side per end: 40% of the height. */
const TRAPEZOID_SLANT = 0.4;

/**
 * A trapezoid with a wide top and a narrower bottom (both sides slanted).
 * The safe area is the full-height rectangle between the bottom corners.
 */
export const trapezoid: CustomShape = {
  name: "trapezoid",
  draw(footprint) {
    const { x, y, width: w, height: h } = footprint;
    const s = Math.min(TRAPEZOID_SLANT * h, w / 4);
    const outline: Polygon = [
      { x, y },
      { x: x + w, y },
      { x: x + w - s, y: y + h },
      { x: x + s, y: y + h },
    ];
    return { layers: [outline], outline, safeArea: { x: x + s, y, width: w - 2 * s, height: h } };
  },
  footprintFor({ width, height }) {
    // s = 0.4·h; the w/4 cap only applies to footprints narrower than this.
    return { width: width + 2 * TRAPEZOID_SLANT * height, height };
  },
};

/** Offset between the stacked layers. */
const STACK_OFFSET = 8;
const STACK_LAYERS = 3;

/**
 * A stack of three equal rectangles ("documents/layers"), offset up and to the
 * right. The front (bottom-left) layer holds the label; the outline is the
 * staircase union of the layers (not convex).
 */
export const stack: CustomShape = {
  name: "stack",
  draw(footprint) {
    const { x, y, width: w, height: h } = footprint;
    const o = STACK_OFFSET;
    const spread = o * (STACK_LAYERS - 1);
    const layer = (i: number): Rect => ({
      // i = 0 is the back layer (top-right), the last one the front (bottom-left).
      x: x + spread - i * o,
      y: y + i * o,
      width: w - spread,
      height: h - spread,
    });
    const layers = Array.from({ length: STACK_LAYERS }, (_, i) => rectPolygon(layer(i)));
    const outline: Polygon = [
      { x: x + 2 * o, y },
      { x: x + w, y },
      { x: x + w, y: y + h - 2 * o },
      { x: x + w - o, y: y + h - 2 * o },
      { x: x + w - o, y: y + h - o },
      { x: x + w - 2 * o, y: y + h - o },
      { x: x + w - 2 * o, y: y + h },
      { x, y: y + h },
      { x, y: y + 2 * o },
      { x: x + o, y: y + 2 * o },
      { x: x + o, y: y + o },
      { x: x + 2 * o, y: y + o },
    ];
    return { layers, outline, safeArea: layer(STACK_LAYERS - 1) };
  },
  footprintFor({ width, height }) {
    const spread = STACK_OFFSET * (STACK_LAYERS - 1);
    return { width: width + spread, height: height + spread };
  },
};

export const CUSTOM_SHAPES: Readonly<Record<string, CustomShape>> = { trapezoid, stack };

/**
 * The first point where the ray `origin + t·direction` (t ≥ 0) crosses the
 * polygon boundary, as `t`; `undefined` if it misses. Works for non-convex
 * polygons (nearest crossing wins).
 */
export function rayHit(polygon: Polygon, origin: Point, direction: Point): number | undefined {
  let best: number | undefined;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i] as Point;
    const b = polygon[(i + 1) % polygon.length] as Point;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const denom = direction.x * ey - direction.y * ex;
    if (Math.abs(denom) < 1e-12) continue; // parallel
    const ax = a.x - origin.x;
    const ay = a.y - origin.y;
    const t = (ax * ey - ay * ex) / denom;
    const u = (ax * direction.y - ay * direction.x) / denom;
    if (t < -1e-9 || u < -1e-9 || u > 1 + 1e-9) continue;
    if (best === undefined || t < best) best = t;
  }
  return best;
}

export { rectPolygon };
