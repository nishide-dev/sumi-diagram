/** Paint of the faces and inner edges of a solid outline (#575), shared by the SVG and PPTX writers. */
import { z } from "zod";
import type { NodeIR } from "../compiler/ir";
import type { OutlineLayer, OutlineShade } from "../core/outline";
import { type Block, blockSchema } from "../core/outline/cuboid";
import { INNER_EDGE_WIDTH } from "../core/theme/cuboid-shade";
import { n, paint } from "./stroke";

const PARAM: Record<Exclude<OutlineShade, "front">, string> = {
  top: "topFill",
  side: "sideFill",
};

const blocksOf = new Map<string, readonly Block[]>();
/** The highlighted blocks of a cuboid node (#576), parsed once per params string. */
function blocks(node: NodeIR): readonly Block[] {
  const json = node.render?.params?.blocks;
  if (typeof json !== "string") return [];
  let parsed = blocksOf.get(json);
  if (parsed === undefined) {
    parsed = z.array(blockSchema).parse(JSON.parse(json));
    blocksOf.set(json, parsed);
  }
  return parsed;
}

/** The fill of a face: the node's own for the front, the theme's shade for the others. */
export function faceFill(node: NodeIR, shade: OutlineShade, block?: number): string {
  if (block !== undefined) {
    const b = blocks(node)[block];
    if (b !== undefined) return shade === "front" ? b.fill : shade === "top" ? b.top : b.side;
  }
  const shaded = shade === "front" ? undefined : node.render?.params?.[PARAM[shade]];
  return typeof shaded === "string" ? shaded : paint(node.style.fill);
}

/** Color and width (units) of an inner edge or a grid line: lighter and thinner than the frame. */
export function innerEdge(
  node: NodeIR,
  kind: "inner" | "grid" = "inner",
  block?: number,
): { color: string; width: number } {
  const b = block === undefined ? undefined : blocks(node)[block];
  const param = node.render?.params?.[kind === "inner" ? "innerStroke" : "gridStroke"];
  const color = b === undefined ? param : b[kind];
  return {
    color: typeof color === "string" ? color : paint(node.style.stroke),
    width: node.style.strokeWidth.units * INNER_EDGE_WIDTH,
  };
}

/** The paint attributes of a face, inner-edge, grid or block-frame layer, or `undefined` for any other. */
export function solidLayerAttributes(node: NodeIR, layer: OutlineLayer): string | undefined {
  if (layer.shade !== undefined)
    return ` fill="${faceFill(node, layer.shade, layer.block)}" stroke="none"`;
  const kind = layer.inner === true ? "inner" : layer.grid === true ? "grid" : undefined;
  if (kind !== undefined) {
    const { color, width } = innerEdge(node, kind, layer.block);
    return ` fill="none" stroke="${color}" stroke-width="${n(width)}" stroke-linecap="round" stroke-linejoin="round"`;
  }
  // The frame of a highlighted block: its own line color at the node's frame width.
  if (layer.block !== undefined) {
    const color = blocks(node)[layer.block]?.line ?? paint(node.style.stroke);
    return ` fill="none" stroke="${color}" stroke-width="${n(node.style.strokeWidth.units)}" stroke-linecap="round" stroke-linejoin="round"`;
  }
  return undefined;
}
