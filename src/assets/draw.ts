/**
 * How icons and images are drawn (#94, design doc §6.25), shared by the
 * structured SVG writer and the composition of `auto` (D2) figures:
 *
 * - An icon is a square of 1 em (the node's font size) centered where the
 *   label would be (`labelCenter()`), drawn as the importer's shapes under
 *   one `<g class="sumi-icon" transform="…">` (no nested `<svg>`), in the
 *   node's text color (Tabler icons stroke `currentColor`).
 * - An image is one `<image class="sumi-image">` filling the node's box with
 *   the `data:` URI, `preserveAspectRatio` from `props.fit`, and its frame
 *   drawn again over it (`framed`). With `layers` (#187), one definition is
 *   reused up-right and the measured box contains the whole stack.
 *
 * Both are children of the element's `<g>` right after its `g.shape` (over
 * the shape's fill, e.g. a tone behind an image), so the
 * inspection (`inspectSvg()`), which reads only `g.shape`, `text` and
 * `path.connection`, and the geometry lint treat the node as its box.
 */

import type { ImageFit, NodeIR } from "../compiler/ir";
import type { Rect } from "../core/geometry";
import { labelCenter } from "../layout/structured/sizing";
import { n, strokeAttributes } from "../render/stroke";
import { imageLayerRects } from "./layers";
import type { LoadedAsset, LoadedIcon, LoadedImage } from "./load";

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

export function iconMarkup(icon: LoadedIcon, box: Rect): string {
  const [minX, minY, vw, vh] = icon.svg.viewBox;
  const scale = Math.min(box.width / vw, box.height / vh);
  const tx = box.x + (box.width - vw * scale) / 2 - minX * scale;
  const ty = box.y + (box.height - vh * scale) / 2 - minY * scale;
  return `<g class="sumi-icon" transform="translate(${n(tx)} ${n(ty)}) scale(${n(scale)})">${icon.svg.markup}</g>`;
}

/** A badge's full footprint: one em centered on the selected bounding-box corner. */
export function badgeRect(node: Pick<NodeIR, "badge" | "style">, rect: Rect): Rect | undefined {
  if (node.badge === undefined) return undefined;
  const side = iconSize(node);
  return {
    x: rect.x + (node.badge.corner.endsWith("east") ? rect.width : 0) - side / 2,
    y: rect.y + (node.badge.corner.startsWith("south") ? rect.height : 0) - side / 2,
    width: side,
    height: side,
  };
}

export function badgeMarkup(node: NodeIR, icon: LoadedIcon | undefined, rect: Rect): string {
  const box = badgeRect(node, rect);
  if (box === undefined) return "";
  if (icon === undefined) throw new Error(`internal error: badge of ${node.key} was not loaded`);
  return `<g class="sumi-badge">${iconMarkup(icon, box)}</g>`;
}

/**
 * The image over the node's shape (its background: transparent, or a tone),
 * and the frame again over the image (the `framed` variant), so neither hides
 * the other.
 */
function imageMarkup(
  image: LoadedImage,
  fit: ImageFit,
  rect: Rect,
  style: NodeIR["style"],
): string {
  const picture = `<image class="sumi-image" xmlns:xlink="${XLINK}" x="${n(rect.x)}" y="${n(rect.y)}" width="${n(rect.width)}" height="${n(rect.height)}" preserveAspectRatio="${FIT[fit]}" xlink:href="${image.href}"/>`;
  if (style.strokeWidth.units <= 0 || style.stroke === "transparent") return picture;
  const radius = Math.min(style.radius.units, rect.width / 2, rect.height / 2);
  const rx = radius > 0 ? ` rx="${n(radius)}"` : "";
  return `${picture}<rect class="sumi-image-frame" x="${n(rect.x)}" y="${n(rect.y)}" width="${n(rect.width)}" height="${n(rect.height)}"${rx} fill="none"${strokeAttributes(style)}/>`;
}

/** Keep the union box measurable for layout/inspection, but paint each copy separately. */
export function imagePlaceholder<T extends NodeIR>(node: T): T {
  if (node.image?.layers === undefined) return node;
  return {
    ...node,
    style: { ...node.style, fill: "transparent", stroke: "transparent" },
  };
}

function layeredImageMarkup(
  node: Pick<NodeIR, "key" | "image" | "style">,
  image: LoadedImage,
  rect: Rect,
): string {
  const layers = node.image?.layers;
  if (layers === undefined || node.image === undefined) return "";
  const boxes = imageLayerRects(node, rect);
  const { width, height } = boxes[0] as Rect;
  const radius = Math.min(node.style.radius.units, width / 2, height / 2);
  const rx = radius > 0 ? ` rx="${n(radius)}"` : "";
  const id = `sumi-image-${node.key}`;
  // A single image definition keeps the original bytes once, even for many copies.
  const definition = `<defs><image id="${id}" class="sumi-image" xmlns:xlink="${XLINK}" width="${n(width)}" height="${n(height)}" preserveAspectRatio="${FIT[node.image.fit]}" xlink:href="${image.href}"/></defs>`;
  const copies: string[] = [];
  for (const { x, y } of [...boxes].reverse()) {
    const background = `<rect width="${n(width)}" height="${n(height)}"${rx} fill="${node.style.fill}"/>`;
    const picture = `<use xmlns:xlink="${XLINK}" xlink:href="#${id}"/>`;
    const frame =
      node.style.strokeWidth.units > 0 && node.style.stroke !== "transparent"
        ? `<rect class="sumi-image-frame" width="${n(width)}" height="${n(height)}"${rx} fill="none"${strokeAttributes(node.style)}/>`
        : "";
    copies.push(
      `<g class="sumi-image-layer" transform="translate(${n(x)} ${n(y)})">${background}${picture}${frame}</g>`,
    );
  }
  return definition + copies.join("");
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
  if (node.image.layers !== undefined) return layeredImageMarkup(node, asset, rect);
  return imageMarkup(asset, node.image.fit, rect, node.style);
}
