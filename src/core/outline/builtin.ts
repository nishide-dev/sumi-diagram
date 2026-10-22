/** Built-in geometric renderers; components using them are added in #55. */
import { z } from "zod";
import type { Point, Rect } from "../geometry";
import type { OutlineDrawing, OutlineRenderer } from "./types";

const rectangle = ({ x, y, width, height }: Rect): Point[] => [
  { x, y },
  { x: x + width, y },
  { x: x + width, y: y + height },
  { x, y: y + height },
];
const body = (points: readonly Point[]): OutlineDrawing["layers"][number] => ({
  role: "body",
  path: { points, closed: true },
});

const trapezoidParams = z.strictObject({
  slant: z.number().min(0).max(1).default(0.4),
});

const trapezoid: OutlineRenderer<z.output<typeof trapezoidParams>> = {
  id: "sumi/trapezoid",
  version: 1,
  params: trapezoidParams,
  footprint({ width, height }, { slant }) {
    return { width: width + 2 * slant * height, height };
  },
  draw({ x, y, width, height }, { slant }) {
    const inset = Math.min(slant * height, width / 4);
    const outline = [
      { x, y },
      { x: x + width, y },
      { x: x + width - inset, y: y + height },
      { x: x + inset, y: y + height },
    ];
    return {
      layers: [body(outline)],
      outline,
      safeArea: { x: x + inset, y, width: width - 2 * inset, height },
    };
  },
};

const stackParams = z.strictObject({
  layers: z.number().int().min(1).max(8).default(3),
  offset: z.number().positive().max(64).default(8),
});

const stack: OutlineRenderer<z.output<typeof stackParams>> = {
  id: "sumi/stack",
  version: 1,
  params: stackParams,
  footprint({ width, height }, { layers, offset }) {
    const spread = offset * (layers - 1);
    return { width: width + spread, height: height + spread };
  },
  draw({ x, y, width, height }, { layers, offset }) {
    // All rectangles overlap even for a very small explicit footprint. This
    // prevents negative dimensions, disconnected bodies and holes in the union.
    const step = Math.min(offset, width / (2 * layers), height / (2 * layers));
    const spread = step * (layers - 1);
    const layer = (i: number): Rect => ({
      x: x + spread - i * step,
      y: y + i * step,
      width: width - spread,
      height: height - spread,
    });
    const outline: Point[] = [
      { x: x + spread, y },
      { x: x + width, y },
    ];
    for (let i = 0; i < layers; i++) {
      const right = x + width - i * step;
      const bottom = y + height - spread + i * step;
      outline.push({ x: right, y: bottom });
      if (i < layers - 1) outline.push({ x: right - step, y: bottom });
    }
    outline.push({ x, y: y + height });
    for (let i = layers - 1; i > 0; i--) {
      const left = x + spread - i * step;
      const top = y + i * step;
      outline.push({ x: left, y: top }, { x: left + step, y: top });
    }
    return {
      layers: Array.from({ length: layers }, (_, i) => body(rectangle(layer(i)))),
      outline,
      safeArea: layer(layers - 1),
    };
  },
};

/** Closed set of renderers bundled with Sumi; no external code loading. */
export const BUILTIN_OUTLINE_RENDERERS: ReadonlyMap<string, OutlineRenderer> = new Map(
  [trapezoid, stack].map((renderer) => [renderer.id, Object.freeze(renderer)]),
);

export function getOutlineRenderer(id: string): OutlineRenderer | undefined {
  return BUILTIN_OUTLINE_RENDERERS.get(id);
}
