/** Freeze a trapezoid's natural slant before opt-in main-axis growth (#270). */
import { getOutlineRenderer } from "../core/outline";
import { getProfile } from "../core/profile/builtin";
import { spacedProfile } from "../core/profile/schema";
import { getFontSet } from "../core/theme/fonts";
import { textBlock } from "../layout/structured/engine";
import { nodeSize } from "../layout/structured/sizing";
import { fontSetMeasurer, measureText } from "../layout/text";
import { type ArrangeBoxIR, type FigureIR, readonlyMap } from "./ir";

export function withStretchOutlines(ir: FigureIR): FigureIR {
  const candidates = new Set<string>();
  const visit = (box: ArrangeBoxIR) => {
    for (const item of box.items) {
      if (typeof item === "string") {
        if (box.justify === "stretch") candidates.add(item);
      } else if (item !== null) visit(item);
    }
  };
  if (ir.arrange) visit(ir.arrange);
  for (const group of ir.groups) if (group.arrange) visit(group.arrange);
  if (!ir.nodes.some((n) => candidates.has(n.key) && n.render?.renderer === "sumi/trapezoid"))
    return ir;
  const profile = getProfile(ir.meta.profileId);
  const fonts = getFontSet(ir.meta.fontSetId);
  if (!profile || !fonts) throw new Error("Missing built-in profile or fonts");
  const { layout } = spacedProfile(profile, ir.meta.density);
  const padding = { x: layout.nodePaddingX.pt * 2, y: layout.nodePaddingY.pt * 2 };
  const measurer = fontSetMeasurer(fonts);
  const nodes = ir.nodes.map((node) => {
    if (!candidates.has(node.key) || node.render?.renderer !== "sumi/trapezoid") return node;
    const label = measureText(node.label, node.style, measurer);
    const sub =
      node.sublabel &&
      measureText(
        node.sublabel.text,
        { ...node.style, fontSize: node.sublabel.fontSize },
        measurer,
      );
    const text = label && textBlock(label, sub);
    const content =
      text && node.labelRotation !== undefined
        ? { width: text.height, height: text.width }
        : (text ??
          (node.icon
            ? { width: node.style.fontSize.units, height: node.style.fontSize.units }
            : undefined));
    const size = nodeSize(node, content, padding);
    const renderer = getOutlineRenderer(node.render.renderer);
    if (!renderer) throw new Error("Missing trapezoid renderer");
    const params = renderer.params.parse(node.render.params);
    const safe = renderer.draw({ x: 0, y: 0, ...size }, params).safeArea;
    const maxInset = Math.max(safe.x, safe.y);
    return Object.freeze({
      ...node,
      render: Object.freeze({
        ...node.render,
        params: Object.freeze({ ...node.render.params, maxInset }),
      }),
    });
  });
  return Object.freeze({
    ...ir,
    nodes: Object.freeze(nodes),
    elements: readonlyMap([...ir.groups, ...nodes, ...ir.edges].map((e) => [e.key, e] as const)),
  });
}
