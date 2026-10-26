/**
 * Natural sizes of nodes in the structured layout (design doc §6.21): each
 * shape is made just large enough that its label, padded by the profile's
 * node padding, fits inside the shape's label area as the geometry lint
 * reconstructs it (`src/lint/geometry/shapes.ts`). Explicit `width` /
 * `height` props win, and outline components use their renderer's footprint
 * ({@link nodeSize}). Sizes are whole units (rounded up), like the #86
 * prototype's leaves.
 */

import type { NodeIR } from "../../compiler/ir";
import { getOutlineRenderer } from "../../core/outline";
import type { NodeShape } from "../../core/registry/manifest";
import {
  CYLINDER_ARC_UNITS,
  DOCUMENT_BODY_RATIO,
  PARALLELOGRAM_WEDGE_UNITS,
} from "../../lint/geometry/shapes";
import type { TextMetrics } from "../ir";

export interface Size {
  width: number;
  height: number;
}

export interface NodePadding {
  /** Left and right, in units. */
  x: number;
  /** Top and bottom, in units. */
  y: number;
}

/**
 * The natural size of a node of `shape` around `label` (none: a 0 × 0 label).
 *
 * With the label box `w × h` and the padded box `P = ⌈w + 2·x⌉ × ⌈h + 2·y⌉`:
 * - rectangle, page (and outline components drawn in a rectangle): `P`;
 * - text: `⌈w⌉ × ⌈h⌉` (no padding, nothing drawn around it);
 * - square: a square of `max(P)`;
 * - circle: diameter `⌈max(h + 2·y, hypot(w + y, h + y))⌉`: at least as tall
 *   as a box with the same lines, and the label box grown by `y / 2` on each
 *   side fits inside the circle;
 * - oval: `⌈P·√2⌉`, the ellipse in which `P` is inscribed with the same aspect;
 * - diamond: `2·P` (`P` inscribed with the same aspect);
 * - hexagon: height `P.h`, width so that the label box padded only
 *   horizontally fits between the slanted sides;
 * - parallelogram: height `P.h`, width so that the padded label box clears
 *   the slanted sides (D2's 26-unit wedge);
 * - cylinder: `P` plus the caps (3 × D2's 24-unit arc) in height;
 * - document: `P` with the height divided by the part above the wavy edge.
 */
export function naturalSize(
  shape: NodeShape,
  label: TextMetrics | undefined,
  padding: NodePadding,
): Size {
  const w = label?.width ?? 0;
  const h = label?.height ?? 0;
  const padded: Size = {
    width: Math.ceil(w + 2 * padding.x),
    height: Math.ceil(h + 2 * padding.y),
  };
  switch (shape) {
    case "rectangle":
    case "page":
      return padded;
    case "text":
      return { width: Math.ceil(w), height: Math.ceil(h) };
    case "square": {
      const side = Math.max(padded.width, padded.height);
      return { width: side, height: side };
    }
    case "circle": {
      const inset = padding.y;
      const d = Math.ceil(Math.max(h + 2 * padding.y, Math.hypot(w + inset, h + inset)));
      return { width: d, height: d };
    }
    case "oval":
      return {
        width: Math.ceil(padded.width * Math.SQRT2),
        height: Math.ceil(padded.height * Math.SQRT2),
      };
    case "diamond":
      return { width: 2 * padded.width, height: 2 * padded.height };
    case "hexagon": {
      // The slanted sides go from (W/4, 0) to (0, H/2): at the label's top
      // (H/2 − h/2 from the middle) the hexagon is W·(2H − h)/(4H) wide on each side.
      const height = padded.height;
      const width =
        height === 0 ? padded.width : Math.ceil((2 * height * padded.width) / (2 * height - h));
      return { width, height };
    }
    case "parallelogram": {
      // The left side runs from (wedge, 0) to (0, H); at the padded label's
      // top (y = padding.y) it is wedge·(1 − y/H) in from the left.
      const height = padded.height;
      const slant =
        height === 0
          ? PARALLELOGRAM_WEDGE_UNITS
          : PARALLELOGRAM_WEDGE_UNITS * (1 - padding.y / height);
      const width = Math.max(
        Math.ceil(w + 2 * padding.x + 2 * slant),
        2 * PARALLELOGRAM_WEDGE_UNITS,
      );
      return { width, height };
    }
    case "cylinder":
      return { width: padded.width, height: padded.height + 3 * CYLINDER_ARC_UNITS };
    case "document":
      return { width: padded.width, height: Math.ceil(padded.height / DOCUMENT_BODY_RATIO) };
    default:
      return unreachable(shape);
  }
}

/**
 * The center of the area a node's label is drawn in: the middle of the
 * shape, except for the cylinder (between the caps) and the document (above
 * the wavy edge), matching the lint's `labelArea()`.
 */
export function labelCenter(
  shape: NodeShape,
  rect: { x: number; y: number; width: number; height: number },
) {
  const x = rect.x + rect.width / 2;
  switch (shape) {
    case "cylinder": {
      const arc = Math.min(CYLINDER_ARC_UNITS, rect.height / 3);
      return { x, y: rect.y + 2 * arc + (rect.height - 3 * arc) / 2 };
    }
    case "document":
      return { x, y: rect.y + (rect.height * DOCUMENT_BODY_RATIO) / 2 };
    default:
      return { x, y: rect.y + rect.height / 2 };
  }
}

/**
 * Whether `align: stretch` may resize a node of `shape`: every shape but
 * text and the fixed-aspect circle and square.
 */
export function stretchableShape(shape: NodeShape): boolean {
  return shape !== "text" && shape !== "circle" && shape !== "square";
}

function unreachable(value: never): never {
  throw new Error(`internal error: unknown node shape ${String(value)}`);
}

/** The outline renderer of a node and its parsed params; `undefined` for ordinary shapes. */
function outlineOf(node: Pick<NodeIR, "key" | "render">) {
  if (node.render === undefined) return undefined;
  const renderer = getOutlineRenderer(node.render.renderer);
  // The registry only accepts manifests whose renderer is bundled.
  if (renderer === undefined) {
    throw new Error(`internal error: ${node.key} has an unknown outline renderer`);
  }
  return { renderer, params: renderer.params.parse(node.render.params ?? {}) };
}

/**
 * The size of a node in the layout: explicit `width` / `height` props win
 * (for a fixed-aspect node, either one sets both); otherwise the natural
 * size. An outline component (#53) takes its renderer's footprint around the
 * padded label box (the padded box is what its `safeArea` must hold, like the
 * auto engine's two-pass sizing), rounded up to whole units.
 */
export function nodeSize(
  node: Pick<NodeIR, "key" | "shape" | "sizing" | "render" | "width" | "height">,
  label: TextMetrics | undefined,
  padding: NodePadding,
): Size {
  if (node.sizing === "fixed-aspect-1") {
    const side = node.width?.units ?? node.height?.units;
    if (side !== undefined) return { width: side, height: side };
  }
  let natural = naturalSize(node.shape, label, padding);
  const outline = outlineOf(node);
  if (outline !== undefined) {
    // Footprints need a positive label box.
    const box = { width: Math.max(natural.width, 1), height: Math.max(natural.height, 1) };
    const footprint = outline.renderer.footprint(box, outline.params);
    natural = { width: Math.ceil(footprint.width), height: Math.ceil(footprint.height) };
  }
  return {
    width: node.width?.units ?? natural.width,
    height: node.height?.units ?? natural.height,
  };
}

/**
 * The center of a node's label: the center of its outline renderer's
 * `safeArea` for an outline component (what the geometry lint checks it
 * against), otherwise {@link labelCenter} of its shape.
 */
export function nodeLabelCenter(
  node: Pick<NodeIR, "key" | "shape" | "render">,
  rect: { x: number; y: number; width: number; height: number },
) {
  const outline = outlineOf(node);
  if (outline === undefined) return labelCenter(node.shape, rect);
  const { safeArea } = outline.renderer.draw(rect, outline.params);
  return { x: safeArea.x + safeArea.width / 2, y: safeArea.y + safeArea.height / 2 };
}
