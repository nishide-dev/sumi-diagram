import type { FigureIR } from "../../compiler/ir";
import type { ElementKey } from "../../core/check-state";
import { type LayoutIR, type Rect, roundRect } from "../ir";

/**
 * Routing bounds, distinct from layout/containment bounds. A tokens frame
 * reserves space for annotations attached to its cells, but edges address
 * the sequence itself (#331), not the empty space around those annotations.
 */
export function endpointRects(ir: FigureIR, layout: LayoutIR): Map<ElementKey, Rect> {
  const rects = new Map<ElementKey, Rect>(
    [...layout.nodes, ...layout.groups].map((element) => [element.key, element.rect]),
  );
  const cells = new Map<string, Rect[]>();
  const annotated = new Set(ir.nodes.filter((n) => n.attach !== undefined).map((n) => n.parent));
  for (const node of ir.nodes) {
    if (node.tokens === undefined) continue;
    const rect = rects.get(node.key);
    if (rect === undefined) continue;
    const list = cells.get(node.tokens.id) ?? [];
    list.push(rect);
    cells.set(node.tokens.id, list);
  }
  for (const group of ir.groups) {
    if (group.tokens === undefined || !annotated.has(group.key)) continue;
    const parts = cells.get(group.tokens.id);
    if (parts === undefined || parts.length === 0) continue;
    const x = Math.min(...parts.map((r) => r.x));
    const y = Math.min(...parts.map((r) => r.y));
    rects.set(
      group.key,
      roundRect({
        x,
        y,
        width: Math.max(...parts.map((r) => r.x + r.width)) - x,
        height: Math.max(...parts.map((r) => r.y + r.height)) - y,
      }),
    );
  }
  return rects;
}
