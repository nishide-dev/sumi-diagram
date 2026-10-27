/**
 * Label-position prototypes (#124 §1–§2) on top of the product layout:
 *
 * - `groups[].labelAt: top-left | top-right`: the engine already reserves the
 *   label band at the top of the group (design doc §6.21), so these two only
 *   move the label within it: its box to the content's left / right edge.
 *   The router then sees the label box where it is drawn (it routes around
 *   `group.label.box`). `bottom*` needs the band at the bottom (an engine
 *   change) and is not prototyped.
 * - `edges[].labelAt: start | middle | end`: the router variant's
 *   `HOOKS.labelEdge` hands the label placement (`placeEdgeLabel`) a stand-in
 *   edge: without arrowheads (the product's mid-line rule for `line`) for
 *   `middle`, with the arrowhead at the source for `start`. `labelSide` (which
 *   side of the line) needs a change inside `placeEdgeLabel` and is not
 *   prototyped.
 */

import type { EdgeIR } from "../../src/compiler/ir";
import type { LayoutIR } from "../../src/layout/ir";
import { roundUnits } from "../../src/layout/ir";

export function applyGroupLabelAt(layout: LayoutIR, at: ReadonlyMap<string, string>): LayoutIR {
  const groups = layout.groups.map((g) => {
    const where = at.get(g.key);
    if (g.label === undefined || (where !== "top-left" && where !== "top-right")) return g;
    const box = g.label.box;
    const x = where === "top-left" ? g.content.x : g.content.x + g.content.width - box.width;
    const dx = x - box.x;
    return {
      ...g,
      label: {
        ...g.label,
        box: { ...box, x: roundUnits(box.x + dx) },
        anchor: { ...g.label.anchor, x: roundUnits(g.label.anchor.x + dx) },
      },
    };
  });
  return { ...layout, groups };
}

export function labelEdgeFor(at: ReadonlyMap<string, string>) {
  return (edge: EdgeIR): EdgeIR => {
    const where = at.get(edge.key);
    if (where === "middle") {
      const { targetArrowhead: _t, sourceArrowhead: _s, ...rest } = edge;
      return rest as EdgeIR;
    }
    if (where === "start" && edge.targetArrowhead !== undefined) {
      const { targetArrowhead, ...rest } = edge;
      return { ...rest, sourceArrowhead: targetArrowhead } as EdgeIR;
    }
    return edge;
  };
}
