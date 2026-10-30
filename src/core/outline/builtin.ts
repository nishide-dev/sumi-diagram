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
  narrow: z.enum(["south", "north", "east", "west"]).optional(),
});

const trapezoid: OutlineRenderer<z.output<typeof trapezoidParams>> = {
  id: "sumi/trapezoid",
  version: 1,
  params: trapezoidParams,
  footprint({ width, height }, { slant, narrow = "south" }) {
    if (narrow === "east" || narrow === "west")
      return { width, height: height + 2 * slant * width };
    return { width: width + 2 * slant * height, height };
  },
  draw({ x, y, width, height }, { slant, narrow = "south" }) {
    if (narrow === "east" || narrow === "west") {
      const inset = Math.min(slant * width, height / 4);
      const outline =
        narrow === "east"
          ? [
              { x, y },
              { x: x + width, y: y + inset },
              { x: x + width, y: y + height - inset },
              { x, y: y + height },
            ]
          : [
              { x, y: y + inset },
              { x: x + width, y },
              { x: x + width, y: y + height },
              { x, y: y + height - inset },
            ];
      return {
        layers: [body(outline)],
        outline,
        safeArea: { x, y: y + inset, width, height: height - 2 * inset },
      };
    }
    const inset = Math.min(slant * height, width / 4);
    const outline = [
      { x, y },
      { x: x + width, y },
      { x: x + width - inset, y: y + height },
      { x: x + inset, y: y + height },
    ];
    if (narrow === "north") {
      outline[0] = { x: x + inset, y };
      outline[1] = { x: x + width - inset, y };
      outline[2] = { x: x + width, y: y + height };
      outline[3] = { x, y: y + height };
    }
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

/** A non-self-intersecting hourglass silhouette with a usable central waist. */
const bowtie: OutlineRenderer = {
  id: "sumi/bowtie",
  version: 1,
  params: z.strictObject({ gap: z.number().finite().min(0).max(64).optional() }),
  footprint({ width, height }, { gap = 0 }) {
    return {
      width: typeof gap === "number" && gap > 0 ? 2 * width + gap : width,
      height: height * 2,
    };
  },
  draw({ x, y, width, height }, { gap = 0 }) {
    if (typeof gap === "number" && gap > 0) {
      const separation = Math.min(gap, width / 2);
      const left = x + (width - separation) / 2;
      const right = left + separation;
      const boundaries = [
        [
          { x, y },
          { x: left, y: y + height / 4 },
          { x: left, y: y + (height * 3) / 4 },
          { x, y: y + height },
        ],
        [
          { x: right, y: y + height / 4 },
          { x: x + width, y },
          { x: x + width, y: y + height },
          { x: right, y: y + (height * 3) / 4 },
        ],
      ];
      return {
        layers: boundaries.map(body),
        boundaries,
        outline: rectangle({ x, y, width, height }),
        safeArea: { x, y: y + height / 4, width: left - x, height: height / 2 },
      };
    }
    const outline = [
      { x, y },
      { x: x + width / 2, y: y + height / 4 },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x: x + width / 2, y: y + (height * 3) / 4 },
      { x, y: y + height },
    ];
    return {
      layers: [body(outline)],
      outline,
      safeArea: { x, y: y + height / 4, width, height: height / 2 },
    };
  },
};

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
  [trapezoid, stack, bowtie].map((renderer) => [renderer.id, Object.freeze(renderer)]),
);

export function getOutlineRenderer(id: string): OutlineRenderer | undefined {
  return BUILTIN_OUTLINE_RENDERERS.get(id);
}
