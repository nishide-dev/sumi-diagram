/**
 * A cuboid in oblique projection (#575, design #574): a front face, a top and a
 * side face. The footprint is the silhouette's bounding box, the front face
 * plus the depth offset (dx right, dy up). Geometry only: the face colors come
 * from the theme and are passed as params for the renderers (`outline-paint`).
 */
import { z } from "zod";
import type { Point } from "../geometry";
import type {
  OutlineDrawing,
  OutlineLayer,
  OutlinePart,
  OutlinePath,
  OutlineRenderer,
} from "./types";

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
  /** Where edges without an anchor touch: the 3D centre's silhouette contact, or the visible faces' centres. */
  ports: z.enum(["center", "face"]).default("center"),
  /** Cells along x (width), y (height) and z (depth) as "nx,ny,nz": grid lines on the visible faces (#576). */
  cells: z
    .string()
    .regex(/^[1-9]\d{0,2},[1-9]\d{0,2},[1-9]\d{0,2}$/)
    .optional(),
  /** The grid lines' color: the frame mixed toward the canvas (internal). */
  gridStroke: color.optional(),
  /** Highlighted sub-blocks as JSON (see {@link blockSchema}); internal, set by the compiler. */
  blocks: z.string().optional(),
  /** Face colors derived from the node's fill by the theme (internal). */
  topFill: color.optional(),
  sideFill: color.optional(),
  innerStroke: color.optional(),
});
export type CuboidParams = z.output<typeof cuboidParams>;

/** A highlighted sub-block (#576): a cell range with its own colors, drawn as a smaller solid. */
export const blockSchema = z.strictObject({
  name: z.string(),
  /** First cell along x (right), y (down) and z (back). */
  at: z.tuple([z.number().int().min(0), z.number().int().min(0), z.number().int().min(0)]),
  /** Cells along x, y and z. */
  size: z.tuple([z.number().int().min(1), z.number().int().min(1), z.number().int().min(1)]),
  fill: color,
  top: color,
  side: color,
  line: color,
  inner: color,
  grid: color,
});
export type Block = z.output<typeof blockSchema>;

/** The cells of a cuboid, as `[nx, ny, nz]`, if it has a grid. */
export function cuboidCells(params: CuboidParams): [number, number, number] | undefined {
  return params.cells === undefined
    ? undefined
    : (params.cells.split(",").map(Number) as [number, number, number]);
}

/** The highlighted blocks of a cuboid (invalid JSON is a bug of the compiler). */
export function cuboidBlocks(params: CuboidParams): Block[] {
  return params.blocks === undefined ? [] : z.array(blockSchema).parse(JSON.parse(params.blocks));
}

/** The offset of the back face from the front face, in units (y grows downward, dy is up). */
export function cuboidOffset({ depth, angle, depthScale }: CuboidParams): {
  dx: number;
  dy: number;
} {
  const a = (angle * Math.PI) / 180;
  return { dx: depthScale * depth * Math.cos(a), dy: depthScale * depth * Math.sin(a) };
}

const pt = (x: number, y: number): Point => ({ x, y });

/** The faces and silhouette of a solid whose front face's top left is (fx, fy). */
function solidShape(fx: number, fy: number, w: number, h: number, dx: number, dy: number) {
  const y = fy - dy;
  return {
    fx,
    fy,
    w,
    h,
    dx,
    dy,
    front: [pt(fx, fy), pt(fx + w, fy), pt(fx + w, fy + h), pt(fx, fy + h)],
    top: [pt(fx, fy), pt(fx + dx, y), pt(fx + w + dx, y), pt(fx + w, fy)],
    side: [pt(fx + w, fy), pt(fx + w + dx, y), pt(fx + w + dx, y + h), pt(fx + w, fy + h)],
    // The hidden left face, and the side as front-top, back-top, back-bottom, front-bottom.
    leftQuad: [pt(fx, fy), pt(fx + dx, y), pt(fx + dx, y + h), pt(fx, fy + h)],
    sideQuad: [pt(fx + w, fy), pt(fx + w + dx, y), pt(fx + w + dx, y + h), pt(fx + w, fy + h)],
    // The top face and the bottom one (hidden) with matching corners: front-left, back-left,
    // back-right, front-right.
    topQuad: [pt(fx, fy), pt(fx + dx, y), pt(fx + w + dx, y), pt(fx + w, fy)],
    bottomQuad: [pt(fx, fy + h), pt(fx + dx, y + h), pt(fx + w + dx, y + h), pt(fx + w, fy + h)],
    // Clockwise from the front's bottom left.
    outline: [
      pt(fx, fy + h),
      pt(fx, fy),
      pt(fx + dx, y),
      pt(fx + w + dx, y),
      pt(fx + w + dx, y + h),
      pt(fx + w, fy + h),
    ],
    box: { x: fx, y, width: w + dx, height: h + dy },
  };
}

type SolidShape = ReturnType<typeof solidShape>;

interface Visible {
  readonly front: boolean;
  readonly top: boolean;
  readonly side: boolean;
}
const ALL: Visible = { front: true, top: true, side: true };

/** The grid lines of `cells` on the given visible faces, as open two-point paths. */
function gridPaths(
  s: SolidShape,
  [nx, ny, nz]: readonly [number, number, number],
  visible: Visible,
) {
  const lines: { points: Point[]; closed: false }[] = [];
  const line = (a: Point, b: Point) => lines.push({ points: [a, b], closed: false });
  const { fx, fy, w, h, dx, dy } = s;
  for (let i = 1; i < nx; i++) {
    const x = fx + (w * i) / nx;
    if (visible.front) line(pt(x, fy), pt(x, fy + h));
    if (visible.top) line(pt(x, fy), pt(x + dx, fy - dy));
  }
  for (let j = 1; j < ny; j++) {
    const y = fy + (h * j) / ny;
    if (visible.front) line(pt(fx, y), pt(fx + w, y));
    if (visible.side) line(pt(fx + w, y), pt(fx + w + dx, y - dy));
  }
  for (let k = 1; k < nz; k++) {
    const a = k / nz;
    if (visible.top) line(pt(fx + dx * a, fy - dy * a), pt(fx + w + dx * a, fy - dy * a));
    if (visible.side) line(pt(fx + w + dx * a, fy - dy * a), pt(fx + w + dx * a, fy + h - dy * a));
  }
  return lines;
}

/**
 * Faces back to front, the cells' grid, the inner edges and the silhouette of one solid. `block`
 * marks the layers of a highlighted sub-block (#576); `visible` limits it to the faces that show
 * (a block inside the volume has only the faces on the volume's top and right surfaces: the
 * volume's front hides it), each framed on its own.
 */
function solidLayers(
  s: SolidShape,
  cells: readonly [number, number, number] | undefined,
  block?: number,
  visible: Visible = ALL,
): OutlineLayer[] {
  const tag = block === undefined ? {} : { block };
  const face = (points: Point[], shade: "front" | "top" | "side"): OutlineLayer => ({
    role: "body",
    shade,
    path: { points, closed: true },
    ...tag,
  });
  const { fx, fy, w, h, dx, dy } = s;
  const y = fy - dy;
  const grid = cells === undefined ? [] : gridPaths(s, cells, visible);
  const whole = visible.front && visible.top && visible.side;
  const faces: [boolean, Point[], "front" | "top" | "side"][] = [
    [visible.top, s.top, "top"],
    [visible.side, s.side, "side"],
    [visible.front, s.front, "front"],
  ];
  const shown = faces.filter(([on]) => on);
  if (shown.length === 0) return [];
  const gridLayer: OutlineLayer[] =
    grid.length > 0
      ? [
          {
            role: "line",
            grid: true,
            path: grid[0] as OutlinePath,
            more: grid.slice(1),
            ...tag,
          },
        ]
      : [];
  if (!whole) {
    const [first, ...rest] = shown;
    return [
      ...shown.map(([, points, shade]) => face(points, shade)),
      ...gridLayer,
      {
        role: "line",
        path: { points: (first as (typeof shown)[number])[1], closed: true },
        more: rest.map(([, points]) => ({ points, closed: true })),
        ...tag,
      },
    ];
  }
  return [
    ...shown.map(([, points, shade]) => face(points, shade)),
    ...gridLayer,
    // The front's top and right edges and the near corner: the three edges inside the silhouette.
    {
      role: "line",
      inner: true,
      path: {
        points: [pt(fx + dx, y), pt(fx, fy), pt(fx + w, fy), pt(fx + w, fy + h)],
        closed: false,
      },
      ...tag,
    },
    {
      role: "line",
      inner: true,
      path: { points: [pt(fx + w, fy), pt(fx + w + dx, y)], closed: false },
      ...tag,
    },
    { role: "line", path: { points: s.outline, closed: true }, ...tag },
  ];
}

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
    const solid = solidShape(fx, fy, w, h, dx, dy);
    const { top, side, outline } = solid;
    const cells = cuboidCells(params);
    const blocks = cuboidBlocks(params);
    // Highlighted blocks: far ones first (larger z), then left to right and bottom to top.
    const order = blocks
      .map((block, index) => ({ block, index }))
      .sort(
        (p, q) =>
          q.block.at[2] - p.block.at[2] ||
          p.block.at[0] - p.block.at[1] - (q.block.at[0] - q.block.at[1]),
      );
    const parts: Record<string, OutlinePart> = {};
    const blockLayers = order.flatMap(({ block, index }) => {
      const [nx, ny, nz] = cells ?? [1, 1, 1];
      const [cw, ch] = [w / nx, h / ny];
      const [cdx, cdy] = [dx / nz, dy / nz];
      const [i, j, k] = block.at;
      const part = solidShape(
        fx + i * cw + k * cdx,
        fy + j * ch - k * cdy,
        block.size[0] * cw,
        block.size[1] * ch,
        block.size[2] * cdx,
        block.size[2] * cdy,
      );
      parts[block.name] = {
        box: part.box,
        frontPlane: k === 0,
        outline: part.outline,
        faces: {
          front: part.front,
          side: part.sideQuad,
          left: part.leftQuad,
          top: part.topQuad,
          bottom: part.bottomQuad,
        },
      };
      // A block at the front plane stands out whole (as a highlight); one behind it shows only
      // the faces on the volume's top and right surfaces, the volume's front hides the rest.
      const visible: Visible =
        k === 0 ? ALL : { front: false, top: j === 0, side: i + block.size[0] === nx };
      return solidLayers(part, params.cells === undefined ? undefined : block.size, index, visible);
    });
    const parent = solidLayers(solid, cells);
    return {
      layers: [...parent, ...blockLayers],
      outline,
      // Edges aim at the projected centre, the middle of the box (the front's centre moved by
      // (dx/2, -dy/2)), and meet the silhouette on the way in.
      solid: true,
      ...(blocks.length > 0 && { parts }),
      // Opt-in (`ports: face`): the top and the side face are visible, so an edge on them ends at
      // the centroid of the face (the other two faces are hidden and keep the silhouette contact).
      ...(params.ports === "face" && {
        faces: { north: top, east: side },
        faceContacts: {
          north: pt(fx + w / 2 + dx / 2, y + dy / 2),
          east: pt(fx + w + dx / 2, y + (dy + h) / 2),
        },
      }),
      safeArea: { x: fx, y: fy, width: w, height: h },
    };
  },
};
