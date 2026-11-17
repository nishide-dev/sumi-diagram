/**
 * Which nodes of a projected tilted plane (#577, `props.contents: projected`) are drawn
 * lying on it: their outline is the flat shape mapped by the plane's affine map. The others
 * (outline components, images, marks and junctions, nodes with a badge, glyphs or a turned label,
 * shapes with curved parts such as the cylinder) stay upright, centered on their mapped center.
 */
import type { NodeIR } from "../compiler/ir";
import { SEPARATOR_ID } from "../core/registry/builtins";
import { isProjectableShape, type ProjectableShape } from "./plane";

/** The shape of a node that lies flat on a projected plane, or `undefined` when it stays upright. */
export function projectableShape(node: NodeIR): ProjectableShape | undefined {
  if (
    node.render !== undefined ||
    node.mark !== undefined ||
    node.image !== undefined ||
    node.badge !== undefined ||
    node.glyphs !== undefined ||
    node.labelRotation !== undefined ||
    node.labelBelow === true ||
    node.chatPart !== undefined ||
    node.chatMessage === true ||
    node.tokens !== undefined ||
    node.component === SEPARATOR_ID
  )
    return undefined;
  return isProjectableShape(node.shape) ? node.shape : undefined;
}
