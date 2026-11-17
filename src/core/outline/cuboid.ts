/**
 * A cuboid in oblique projection (#575, design #574): a front face, a top and a
 * side face. The footprint is the silhouette's bounding box, the front face
 * plus the depth offset (dx right, dy up). Geometry only: the face colors come
 * from the theme and are passed as params for the renderers (`outline-paint`).
 */
import { z } from "zod";
import type { Point } from "../geometry";
import type { OutlineDrawing, OutlineRenderer } from "./types";

export const DEFAULT_PROJECTION_ANGLE = 45;
export const DEFAULT_DEPTH_SCALE = 0.5;

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const cuboidParams = z.strictObject({
  /** Front face size in D2 units; the label may make it larger. */
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  /** Depth in D2 units, before the projection's scale. */
  depth: z.number().positive().default(16),
  angle: z.number().min(10).max(80).default(DEFAULT_PROJECTION_ANGLE),
  depthScale: z.number().positive().max(2).default(DEFAULT_DEPTH_SCALE),
  /** Face colors derived from the node's fill by the theme (internal). */
  topFill: color.optional(),
  sideFill: color.optional(),
  innerStroke: color.optional(),
});
export type CuboidParams = z.output<typeof cuboidParams>;

/** The offset of the back face from the front face, in units (y grows downward, dy is up). */
export function cuboidOffset({ depth, angle, depthScale }: CuboidParams): {
  dx: number;
  dy: number;
} {
  const a = (angle * Math.PI) / 180;
  return { dx: depthScale * depth * Math.cos(a), dy: depthScale * depth * Math.sin(a) };
}

const pt = (x: number, y: number): Point => ({ x, y });

export const cuboid: OutlineRenderer<CuboidParams> = {
  id: "sumi/cuboid",
  version: 1,
  params: cuboidParams,
  footprint(label, params) {
    const { dx, dy } = cuboidOffset(params);
    return {
      width: Math.max(params.width ?? 0, label.width) + dx,
      height: Math.max(params.height ?? 0, label.height) + dy,
    };
  },
  draw({ x, y, width, height }, params): OutlineDrawing {
    const offset = cuboidOffset(params);
    // A very small explicit footprint keeps a front face of positive size.
    // The requested projection is drawn whenever the footprint holds it beside a front face
    // of positive size; only a footprint that is genuinely smaller shares its size.
    const dx = offset.dx < width ? offset.dx : width / 2;
    const dy = offset.dy < height ? offset.dy : height / 2;
    const w = width - dx;
    const h = height - dy;
    const fx = x;
    const fy = y + dy;
    const front = [pt(fx, fy), pt(fx + w, fy), pt(fx + w, fy + h), pt(fx, fy + h)];
    const top = [pt(fx, fy), pt(fx + dx, y), pt(fx + w + dx, y), pt(fx + w, fy)];
    const side = [pt(fx + w, fy), pt(fx + w + dx, y), pt(fx + w + dx, y + h), pt(fx + w, fy + h)];
    // Clockwise from the front's bottom left.
    const outline = [
      pt(fx, fy + h),
      pt(fx, fy),
      pt(fx + dx, y),
      pt(fx + w + dx, y),
      pt(fx + w + dx, y + h),
      pt(fx + w, fy + h),
    ];
    const face = (points: Point[], shade: "front" | "top" | "side") => ({
      role: "body" as const,
      shade,
      path: { points, closed: true },
    });
    // The front's top and right edges and the near corner: the three edges inside the silhouette.
    const inner = [
      { points: [pt(fx + dx, y), pt(fx, fy), pt(fx + w, fy), pt(fx + w, fy + h)], closed: false },
      { points: [pt(fx + w, fy), pt(fx + w + dx, y)], closed: false },
    ];
    return {
      layers: [
        face(top, "top"),
        face(side, "side"),
        face(front, "front"),
        ...inner.map((path) => ({ role: "line" as const, inner: true as const, path })),
        { role: "line", path: { points: outline, closed: true } },
      ],
      outline,
      // Edges aim at the projected centre, the middle of the box (the front's centre moved by
      // (dx/2, -dy/2)), and meet the silhouette on the way in.
      solid: true,
      safeArea: { x: fx, y: fy, width: w, height: h },
    };
  },
};
