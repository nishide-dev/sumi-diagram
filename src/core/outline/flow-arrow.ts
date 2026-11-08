/**
 * Flow-marker shapes in D2 units (0.5pt): a block arrow, a solid triangle and
 * a chevron (#426). They sit between the stages of a figure and carry no
 * label. Each has the geometry of the PowerPoint preset of the same name
 * (`rightArrow`, `triangle`, `chevron`) so that the editable PPTX can use it.
 */
import { z } from "zod";
import type { Point } from "../geometry";
import type { OutlineRenderer } from "./types";

export const FLOW_ARROW_FORMS = ["block", "triangle", "chevron"] as const;
export const FLOW_ARROW_DIRECTIONS = ["right", "left", "up", "down"] as const;
export type FlowArrowForm = (typeof FLOW_ARROW_FORMS)[number];
export type FlowArrowDirection = (typeof FLOW_ARROW_DIRECTIONS)[number];

/** Length along the arrow, in ems of the theme's text size; the thickness is one em. */
export const FLOW_ARROW_LENGTHS: Readonly<Record<FlowArrowForm, number>> = {
  block: 1.6,
  triangle: 0.9,
  chevron: 0.7,
};
/** Default head (block arrow) or tip depth (chevron), relative to the shorter side. */
export const FLOW_ARROW_HEAD = 0.5;
/** Default shaft thickness of a block arrow, relative to the thickness. */
export const FLOW_ARROW_SHAFT = 0.5;
/** The em of a figure whose theme size is unknown: 8pt in D2 units. */
const DEFAULT_EM = 16;

export const flowArrowParams = z.strictObject({
  form: z.enum(FLOW_ARROW_FORMS).default("block"),
  direction: z.enum(FLOW_ARROW_DIRECTIONS).default("right"),
  /** The theme's text size, which scales the default length and thickness. */
  em: z.number().positive().default(DEFAULT_EM),
  /** Explicit length along the arrow and thickness across it. */
  length: z.number().positive().optional(),
  thickness: z.number().positive().optional(),
  head: z.number().min(0.1).max(1).default(FLOW_ARROW_HEAD),
  shaft: z.number().min(0.1).max(0.9).default(FLOW_ARROW_SHAFT),
});
export type FlowArrowParams = z.output<typeof flowArrowParams>;

const horizontal = (direction: FlowArrowDirection) => direction === "right" || direction === "left";

/** The default or explicit length and thickness along and across the arrow. */
export function flowArrowSize({ form, em, length, thickness }: FlowArrowParams) {
  return { length: length ?? em * FLOW_ARROW_LENGTHS[form], thickness: thickness ?? em };
}

/**
 * Head length (block) or tip depth (chevron): `head` times the shorter side,
 * as in the PowerPoint presets, and at most the length (block) or four
 * fifths of it (chevron, so that its band keeps some width).
 */
export function flowArrowHead({ form, head }: FlowArrowParams, length: number, thickness: number) {
  return Math.min(head * Math.min(length, thickness), form === "chevron" ? 0.8 * length : length);
}

export const flowArrow: OutlineRenderer<FlowArrowParams> = {
  id: "sumi/flow-arrow",
  version: 1,
  labelless: true,
  params: flowArrowParams,
  footprint(_label, params) {
    const { length, thickness } = flowArrowSize(params);
    return horizontal(params.direction)
      ? { width: length, height: thickness }
      : { width: thickness, height: length };
  },
  draw(rect, params) {
    const { form, direction, shaft } = params;
    const flat = horizontal(direction);
    const L = flat ? rect.width : rect.height;
    const T = flat ? rect.height : rect.width;
    const head = flowArrowHead(params, L, T);
    // In the frame of a right-pointing arrow: `u` along it, `v` across it.
    let local: [number, number][];
    if (form === "triangle" || (form === "block" && L - head < 1e-9)) {
      // A head as long as the arrow leaves no shaft: it is a triangle.
      local = [
        [0, 0],
        [L, T / 2],
        [0, T],
      ];
    } else if (form === "block") {
      const lo = (T * (1 - shaft)) / 2;
      const hi = T - lo;
      local = [
        [0, lo],
        [L - head, lo],
        [L - head, 0],
        [L, T / 2],
        [L - head, T],
        [L - head, hi],
        [0, hi],
      ];
    } else {
      local = [
        [0, 0],
        [L - head, 0],
        [L, T / 2],
        [L - head, T],
        [0, T],
        [head, T / 2],
      ];
    }
    const place = ([u, v]: [number, number]): Point => {
      switch (direction) {
        case "right":
          return { x: rect.x + u, y: rect.y + v };
        case "left":
          return { x: rect.x + L - u, y: rect.y + v };
        case "down":
          return { x: rect.x + v, y: rect.y + u };
        case "up":
          return { x: rect.x + v, y: rect.y + L - u };
      }
    };
    const outline = local.map(place);
    // There is no label. The safe area is a small square on the arrow's axis,
    // inside the body for every proportion (the geometry contract wants it
    // there): in the shaft or head, a quarter along; in the chevron's band.
    const half = Math.min(L, T) * 0.02;
    const along = form === "chevron" ? (head + L) / 2 : L / 4;
    const [a, b] = [place([along - half, T / 2 - half]), place([along + half, T / 2 + half])];
    return {
      layers: [{ role: "body", path: { points: outline, closed: true } }],
      outline,
      safeArea: {
        x: Math.min(a.x, b.x),
        y: Math.min(a.y, b.y),
        width: Math.abs(b.x - a.x),
        height: Math.abs(b.y - a.y),
      },
    };
  },
};
