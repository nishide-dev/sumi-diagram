import type { FigureIR } from "../../compiler/ir";
import type { ElementKey } from "../../core/check-state";
import { groupFrontRect } from "../group-layers";
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
    const footprint = rects.get(group.key);
    if (footprint !== undefined && group.layers !== undefined)
      rects.set(group.key, groupFrontRect(group, footprint));
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

/**
 * `inside(inner, outer)`: `inner` lies (transitively) in the group `outer`. A
 * cell annotation is a member of a tokens layout frame but outside the
 * sequence's routing bounds, so for a tokens frame `inner`'s centre must also
 * lie in `outer`'s rectangle: edges approach the cells from outside (#331).
 */
export function makeInside(
  rects: ReadonlyMap<ElementKey, Rect>,
  parents: ReadonlyMap<ElementKey, ElementKey | undefined>,
  tokenFrames: ReadonlySet<ElementKey>,
): (inner: ElementKey, outer: ElementKey) => boolean {
  return (inner, outer) => {
    if (tokenFrames.has(outer)) {
      const a = rects.get(inner) as Rect;
      const b = rects.get(outer) as Rect;
      const x = a.x + a.width / 2;
      const y = a.y + a.height / 2;
      if (x < b.x || x > b.x + b.width || y < b.y || y > b.y + b.height) return false;
    }
    for (let p = parents.get(inner); p !== undefined; p = parents.get(p)) {
      if (p === outer) return true;
    }
    return false;
  };
}
