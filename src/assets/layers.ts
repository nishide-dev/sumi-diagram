import type { NodeIR } from "../compiler/ir";
import type { Rect } from "../core/geometry";

/** Painted copy boxes, front to back; `rect` remains the layout/obstacle footprint. */
export function imageLayerRects(node: Pick<NodeIR, "image">, rect: Rect): readonly Rect[] {
  const layers = node.image?.layers;
  if (layers === undefined) return [rect];
  const step = layers.offset.units;
  const spread = (layers.count - 1) * step;
  return Array.from({ length: layers.count }, (_, i) => ({
    x: rect.x + i * step,
    y: rect.y + spread - i * step,
    width: rect.width - spread,
    height: rect.height - spread,
  }));
}
