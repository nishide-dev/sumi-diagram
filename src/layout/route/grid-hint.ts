import type { ArrangeBoxIR, FigureIR } from "../../compiler/ir";
import type { ElementKey } from "../../core/check-state";
import type { LayoutIR } from "../ir";
import { stretchableShape } from "../structured/sizing";
import { straightPlacement } from "./ports";

/** Explain a failed vertical straight anchor on a direct spanning grid cell. */
export function gridSpanHint(
  ir: FigureIR,
  layout: LayoutIR,
  key: ElementKey,
  other: ElementKey,
): string | undefined {
  const rect = (k: ElementKey) =>
    layout.nodes.find((n) => n.key === k)?.rect ?? layout.groups.find((g) => g.key === k)?.rect;
  const selfRect = rect(key);
  const otherRect = rect(other);
  if (
    selfRect === undefined ||
    otherRect === undefined ||
    !(selfRect.y + selfRect.height <= otherRect.y || otherRect.y + otherRect.height <= selfRect.y)
  )
    return undefined;
  const placement = straightPlacement(selfRect, otherRect);
  if (!("off" in placement) || placement.off === "overlap") return undefined;

  const find = (box: ArrangeBoxIR): { box: ArrangeBoxIR; span: number } | undefined => {
    for (const [i, item] of box.items.entries()) {
      if (item === key && box.kind === "grid" && (box.spans?.[i] ?? 1) > 1)
        return { box, span: box.spans?.[i] ?? 1 };
      if (item !== null && typeof item !== "string") {
        const found = find(item);
        if (found !== undefined) return found;
      }
    }
    return undefined;
  };
  const cell = [ir.arrange, ...ir.groups.map((g) => g.arrange)]
    .flatMap((box) => (box === undefined ? [] : [box]))
    .map(find)
    .find((found) => found !== undefined);
  if (cell === undefined) return undefined;
  const element = ir.elements.get(key);
  if (element === undefined || element.kind === "edge") return undefined;
  const name = `"${element.id}"`;
  const prefix = `${name} spans ${cell.span} grid columns, but span reserves tracks rather than stretching the cell's item.`;
  if (element.kind === "node" && element.width !== undefined)
    return `${prefix} Its explicit width prevents stretching: remove props.width and set grid.align: stretch on its containing grid, or increase props.width to cover the connected columns.`;
  if (
    element.kind === "node" &&
    (element.render !== undefined ||
      element.badge !== undefined ||
      !stretchableShape(element.shape))
  )
    return `${prefix} This component keeps its width under grid.align: stretch; use a resizable box without an explicit width, or rearrange the endpoints or use side anchors.`;
  if (cell.box.align === "stretch") return undefined;
  return `${prefix} With grid.align: ${cell.box.align ?? "center (default)"}, it keeps its natural width, so the outer columns can lie beyond its sides. Set grid.align: stretch on its containing grid so the box covers those columns; straight anchors do not resize it.`;
}
