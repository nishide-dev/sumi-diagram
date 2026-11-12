/**
 * How icons and images are drawn (#94, design doc §6.25), shared by the
 * structured SVG writer and the composition of `auto` (D2) figures:
 *
 * - An icon is a square of 1 em (the node's font size, or its `iconSize`, #424) centered where the
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
import { htmlRadius } from "./html-radius";
import { TABLER_SET } from "./icons";
import { imageLayerRects } from "./layers";
import type { LoadedAsset, LoadedIcon, LoadedImage } from "./load";

const XLINK = "http://www.w3.org/1999/xlink";

/** `preserveAspectRatio` of each fit. */
const FIT: Readonly<Record<ImageFit, string>> = {
  contain: "xMidYMid meet",
  cover: "xMidYMid slice",
  fill: "none",
};

/**
 * The side of a node's icon in units: 1 em, or its `iconSize` (#424). A badge
 * is always 1 em.
 */
export function iconSize(node: Pick<NodeIR, "style" | "iconSize">): number {
  return node.iconSize ?? node.style.fontSize.units;
}

/** A badge's side in units: 1 em (the font size). */
function badgeSize(node: Pick<NodeIR, "style">): number {
  return node.style.fontSize.units;
}

/** The label box an icon takes when the node is sized: a square of {@link iconSize}. */
export function iconBox(
  node: Pick<NodeIR, "icon" | "iconSize" | "style">,
): { width: number; height: number } | undefined {
  if (node.icon === undefined) return undefined;
  const side = iconSize(node);
  return { width: side, height: side };
}

/** Where a node's icon is drawn: centered on the label center of its shape in `rect`. */
export function iconRect(node: Pick<NodeIR, "shape" | "style" | "iconSize">, rect: Rect): Rect {
  const side = iconSize(node);
  const center = labelCenter(node.shape, rect);
  return { x: center.x - side / 2, y: center.y - side / 2, width: side, height: side };
}

/**
 * A sized icon's stroke width (#424): a stroke icon's lines scale with the
 * icon, so at 2 em or 3 em they look heavy. With `em` (the node's font size,
 * given when `iconSize` is set), each `stroke-width` of a bundled Tabler icon
 * is divided by the extra scale, so the printed line stays that of a 1 em
 * icon. Fill-based icons (emoji) and icons at 1 em are left as they are.
 */
function compensateStrokes(icon: LoadedIcon, scale: number, em: number | undefined): string {
  const markup = icon.svg.markup;
  if (em === undefined || icon.set !== TABLER_SET) return markup;
  const [, , vw, vh] = icon.svg.viewBox;
  const reference = em / Math.max(vw, vh);
  if (Math.abs(reference - scale) < 1e-9) return markup;
  return markup.replace(/stroke-width="([\d.]+)"/g, (_, width: string) => {
    return `stroke-width="${n((Number(width) * reference) / scale)}"`;
  });
}

export function iconMarkup(icon: LoadedIcon, box: Rect, em?: number): string {
  const [minX, minY, vw, vh] = icon.svg.viewBox;
  const scale = Math.min(box.width / vw, box.height / vh);
  const tx = box.x + (box.width - vw * scale) / 2 - minX * scale;
  const ty = box.y + (box.height - vh * scale) / 2 - minY * scale;
  return `<g class="sumi-icon" transform="translate(${n(tx)} ${n(ty)}) scale(${n(scale)})">${compensateStrokes(icon, scale, em)}</g>`;
}

/** A badge's full footprint: one em centered on the selected bounding-box corner. */
export function badgeRect(node: Pick<NodeIR, "badge" | "style">, rect: Rect): Rect | undefined {
  if (node.badge === undefined) return undefined;
  const side = badgeSize(node);
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
  html?: { source: string; viewport: { width: number; height: number } },
): string {
  const picture = `<image class="sumi-image" xmlns:xlink="${XLINK}" x="${n(rect.x)}" y="${n(rect.y)}" width="${n(rect.width)}" height="${n(rect.height)}" preserveAspectRatio="${FIT[fit]}" xlink:href="${image.href}"/>`;
  if (style.strokeWidth.units <= 0 || style.stroke === "transparent") return picture;
  if (html) {
    const corners = htmlRadius(
      html.source,
      image.htmlRootSize?.width ?? html.viewport.width,
      image.htmlRootSize?.height ?? html.viewport.height,
    );
    if (corners.some(([x, y]) => x > 0 && y > 0)) {
      const xScale = rect.width / html.viewport.width,
        yScale = rect.height / html.viewport.height;
      const sx =
        fit === "fill"
          ? xScale
          : fit === "cover"
            ? Math.max(xScale, yScale)
            : Math.min(xScale, yScale);
      const sy = fit === "fill" ? yScale : sx;
      const [[tlx, tly], [trx, try_], [brx, bry], [blx, bly]] = corners.map(([x, y]) => [
        x * sx,
        y * sy,
      ]) as [[number, number], [number, number], [number, number], [number, number]];
      const x = rect.x,
        y = rect.y,
        r = x + rect.width,
        b = y + rect.height;
      const arc = (rx: number, ry: number, ex: number, ey: number) =>
        rx && ry ? `A ${n(rx)} ${n(ry)} 0 0 1 ${n(ex)} ${n(ey)}` : `L ${n(ex)} ${n(ey)}`;
      const d = `M ${n(x + tlx)} ${n(y)} L ${n(r - trx)} ${n(y)} ${arc(trx, try_, r, y + try_)} L ${n(r)} ${n(b - bry)} ${arc(brx, bry, r - brx, b)} L ${n(x + blx)} ${n(b)} ${arc(blx, bly, x, b - bly)} L ${n(x)} ${n(y + tly)} ${arc(tlx, tly, x + tlx, y)} Z`;
      return `${picture}<path class="sumi-image-frame" d="${d}" fill="none"${strokeAttributes(style)}/>`;
    }
  }
  const radius = html ? 0 : Math.min(style.radius.units, rect.width / 2, rect.height / 2);
  const rx = radius > 0 ? ` rx="${n(radius)}"` : "";
  return `${picture}<rect class="sumi-image-frame" x="${n(rect.x)}" y="${n(rect.y)}" width="${n(rect.width)}" height="${n(rect.height)}"${rx} fill="none"${strokeAttributes(style)}/>`;
}

/** Keep the union box measurable for layout/inspection, but paint each copy separately. */
export function imagePlaceholder<T extends NodeIR>(node: T): T {
  const html = node.image?.html;
  const viewport = node.image?.viewport;
  const roundedHtml =
    html !== undefined &&
    viewport !== undefined &&
    node.style.strokeWidth.units > 0 &&
    node.style.stroke !== "transparent" &&
    (node.style.radius.units > 0 ||
      htmlRadius(html, viewport.width, viewport.height).some(([x, y]) => x > 0 && y > 0));
  if (node.image?.layers === undefined && !roundedHtml) return node;
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
  node: Pick<NodeIR, "key" | "shape" | "style" | "icon" | "iconSize" | "image">,
  asset: LoadedAsset | undefined,
  rect: Rect,
): string {
  if (asset === undefined) {
    if (node.icon !== undefined || node.image !== undefined) {
      throw new Error(`internal error: the asset of ${node.key} was not loaded`);
    }
    return "";
  }
  if (asset.kind === "icon") {
    return iconMarkup(
      asset,
      iconRect(node, rect),
      node.iconSize === undefined ? undefined : node.style.fontSize.units,
    );
  }
  if (node.image === undefined) throw new Error(`internal error: ${node.key} is not an image`);
  if (node.image.layers !== undefined) return layeredImageMarkup(node, asset, rect);
  return imageMarkup(
    asset,
    node.image.fit,
    rect,
    node.style,
    node.image.html !== undefined && node.image.viewport
      ? { source: node.image.html, viewport: node.image.viewport }
      : undefined,
  );
}
