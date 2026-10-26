/**
 * How icons and images are drawn (#94, design doc §6.25), shared by the
 * structured SVG writer and the composition of `auto` (D2) figures:
 *
 * - An icon is a square of 1 em (the node's font size) centered where the
 *   label would be (`labelCenter()`), drawn as the importer's shapes under
 *   one `<g class="sumi-icon" transform="…">` (no nested `<svg>`), in the
 *   node's text color (Tabler icons stroke `currentColor`).
 * - An image is one `<image class="sumi-image">` filling the node's box with
 *   the `data:` URI, `preserveAspectRatio` from `props.fit`.
 *
 * Both are children of the element's `<g>` next to its `g.shape` (an icon
 * after it, over the fill; an image before it, under the frame), so the
 * inspection (`inspectSvg()`), which reads only `g.shape`, `text` and
 * `path.connection`, and the geometry lint treat the node as its box.
 */

import type { ImageFit, NodeIR } from "../compiler/ir";
import type { Rect } from "../core/geometry";
import { labelCenter } from "../layout/structured/sizing";
import type { LoadedAsset, LoadedIcon, LoadedImage } from "./load";

/** At most 6 decimals, never `-0` (as the structured writer). */
const n = (value: number): string => String(Number(value.toFixed(6)) || 0);

const XLINK = "http://www.w3.org/1999/xlink";

/** `preserveAspectRatio` of each fit. */
const FIT: Readonly<Record<ImageFit, string>> = {
  contain: "xMidYMid meet",
  cover: "xMidYMid slice",
  fill: "none",
};

/** The side of a node's icon in units: 1 em. */
export function iconSize(node: Pick<NodeIR, "style">): number {
  return node.style.fontSize.units;
}

/** The label box an icon takes when the node is sized: a square of {@link iconSize}. */
export function iconBox(
  node: Pick<NodeIR, "icon" | "style">,
): { width: number; height: number } | undefined {
  if (node.icon === undefined) return undefined;
  const side = iconSize(node);
  return { width: side, height: side };
}

/** Where a node's icon is drawn: centered on the label center of its shape in `rect`. */
export function iconRect(node: Pick<NodeIR, "shape" | "style">, rect: Rect): Rect {
  const side = iconSize(node);
  const center = labelCenter(node.shape, rect);
  return { x: center.x - side / 2, y: center.y - side / 2, width: side, height: side };
}

function iconMarkup(icon: LoadedIcon, box: Rect): string {
  const [minX, minY, vw, vh] = icon.svg.viewBox;
  const scale = Math.min(box.width / vw, box.height / vh);
  const tx = box.x + (box.width - vw * scale) / 2 - minX * scale;
  const ty = box.y + (box.height - vh * scale) / 2 - minY * scale;
  return `<g class="sumi-icon" transform="translate(${n(tx)} ${n(ty)}) scale(${n(scale)})">${icon.svg.markup}</g>`;
}

function imageMarkup(image: LoadedImage, fit: ImageFit, rect: Rect): string {
  return `<image class="sumi-image" xmlns:xlink="${XLINK}" x="${n(rect.x)}" y="${n(rect.y)}" width="${n(rect.width)}" height="${n(rect.height)}" preserveAspectRatio="${FIT[fit]}" xlink:href="${image.href}"/>`;
}

/**
 * The markup of a node's asset in its box `rect` (the shape's bounding box),
 * or `""` if the node has none.
 */
export function assetMarkup(
  node: Pick<NodeIR, "key" | "shape" | "style" | "icon" | "image">,
  asset: LoadedAsset | undefined,
  rect: Rect,
): string {
  if (asset === undefined) {
    if (node.icon !== undefined || node.image !== undefined) {
      throw new Error(`internal error: the asset of ${node.key} was not loaded`);
    }
    return "";
  }
  if (asset.kind === "icon") return iconMarkup(asset, iconRect(node, rect));
  if (node.image === undefined) throw new Error(`internal error: ${node.key} is not an image`);
  return imageMarkup(asset, node.image.fit, rect);
}
