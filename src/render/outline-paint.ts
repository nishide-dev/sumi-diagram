/** Paint of the faces and inner edges of a solid outline (#575), shared by the SVG and PPTX writers. */
import type { NodeIR } from "../compiler/ir";
import type { OutlineLayer, OutlineShade } from "../core/outline";
import { INNER_EDGE_WIDTH } from "../core/theme/cuboid-shade";
import { n, paint } from "./stroke";

const PARAM: Record<Exclude<OutlineShade, "front">, string> = {
  top: "topFill",
  side: "sideFill",
};

/** The fill of a face: the node's own for the front, the theme's shade for the others. */
export function faceFill(node: NodeIR, shade: OutlineShade): string {
  const shaded = shade === "front" ? undefined : node.render?.params?.[PARAM[shade]];
  return typeof shaded === "string" ? shaded : paint(node.style.fill);
}

/** Color and width (units) of an inner edge: lighter and thinner than the frame. */
export function innerEdge(node: NodeIR): { color: string; width: number } {
  const color = node.render?.params?.innerStroke;
  return {
    color: typeof color === "string" ? color : paint(node.style.stroke),
    width: node.style.strokeWidth.units * INNER_EDGE_WIDTH,
  };
}

/** The paint attributes of a face or inner-edge layer, or `undefined` for any other layer. */
export function solidLayerAttributes(node: NodeIR, layer: OutlineLayer): string | undefined {
  if (layer.shade !== undefined) return ` fill="${faceFill(node, layer.shade)}" stroke="none"`;
  if (layer.inner === true) {
    const { color, width } = innerEdge(node);
    return ` fill="none" stroke="${color}" stroke-width="${n(width)}" stroke-linecap="round" stroke-linejoin="round"`;
  }
  return undefined;
}
