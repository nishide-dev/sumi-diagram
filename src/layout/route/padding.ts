/**
 * Group padding the router needs before an arrowhead (#171, design doc
 * §6.42). An edge whose ends are both inside a group and which enters (or
 * leaves, with a source arrowhead) a member through the side facing the
 * group's border turns in that group's padding: the route runs straight for
 * the arrowhead's length from the port, then bends along the border. The
 * padding must hold the arrowhead and the router's clearance (3pt) between
 * the bend and the border: with the `color` theme's 1pt lines (an arrowhead
 * of 12 units) in the paper padding (8pt = 16 units), the line ran 4 units
 * from the border, 0.35mm stroke to stroke (`geometry/edge-near-border`).
 *
 * The structured engine (`placeStructured`) asks for these sides after a
 * first layout and lays the figure out again with them widened by what they
 * lack. `academic` (0.5pt lines: an arrowhead of 8 units, 14 with the
 * clearance) needs nothing in the paper padding.
 */

import type { FigureIR } from "../../compiler/ir";
import type { ElementKey } from "../../core/check-state";
import type { Side } from "../../core/figure/schema";
import type { LayoutIR, Rect } from "../ir";
import { arrowheadLength } from "./arrowhead";
import { bottomOf, type End, resolveEnds, rightOf } from "./ports";

/**
 * Space kept between the bend before an arrowhead and the group's border:
 * the router's clearance (`ROUTE.clearance`, 3pt; a test checks they match).
 */
export const BORDER_CLEARANCE = 6;

/** Extra padding per side of a group, in units. */
export type SidePadding = Readonly<Record<Side, number>>;

/** The side a direction index (`DIRS`) points to. */
const DIR_SIDE: readonly Side[] = ["east", "south", "west", "north"];

/**
 * The padding each group of `layout` lacks before an arrowhead, per side
 * (units; only groups and sides that lack some). For every end with an
 * arrowhead at a node or group whose other end lies in the same group, the
 * distance from its port to that group's border straight ahead must hold
 * the straight line the router keeps before the arrowhead (its stub: the
 * arrowhead's length, `arrowheadLength()` of the edge's stroke, and at
 * least the clearance) and the clearance beyond the bend. Only the
 * innermost such group (the nearest border; on a tie, the deepest, since
 * nested groups can share a border) is grown; an enclosing group grows with
 * it. The end's own element, and the groups inside it, are skipped: a port
 * on a group's border stays on it however wide that group's padding is
 * (a self-loop `g → g`), so growing them would not move the bend.
 */
export function arrowheadPaddingDeficits(
  ir: FigureIR,
  layout: LayoutIR,
): Map<ElementKey, SidePadding> {
  const deficits = new Map<ElementKey, Record<Side, number>>();
  const parents = new Map(layout.groups.map((g) => [g.key, g.parent] as const));
  /** `key`'s ancestors, nearest first, and itself first. */
  const lineage = (key: ElementKey): ElementKey[] => {
    const out: ElementKey[] = [];
    for (let k: ElementKey | undefined = key; k !== undefined; k = parents.get(k)) out.push(k);
    return out;
  };
  const resolved = resolveEnds(ir, layout);
  ir.edges.forEach((edge, index) => {
    const ends = resolved[index];
    if (ends === undefined || "error" in ends) return;
    const stub = Math.max(BORDER_CLEARANCE, arrowheadLength(edge.style.strokeWidth.units));
    const need = stub + BORDER_CLEARANCE;
    const check = (end: End, other: End) => {
      if (end.junction || end.dir < 0) return;
      let nearest: { key: ElementKey; free: number; depth: number } | undefined;
      for (const group of layout.groups) {
        if (!holds(group.rect, end.port) || !holds(group.rect, other.port)) continue;
        const up = lineage(group.key);
        // The end's own group, or a group inside it: growing it cannot help.
        if (up.includes(end.key)) continue;
        const free = freeAhead(group.rect, end);
        const depth = up.length;
        if (
          nearest === undefined ||
          free < nearest.free ||
          (free === nearest.free && depth > nearest.depth)
        ) {
          nearest = { key: group.key, free, depth };
        }
      }
      if (nearest === undefined || nearest.free >= need) return;
      const side = DIR_SIDE[end.dir] as Side;
      const sides = deficits.get(nearest.key) ?? { north: 0, east: 0, south: 0, west: 0 };
      sides[side] = Math.max(sides[side], need - nearest.free);
      deficits.set(nearest.key, sides);
    };
    if (edge.sourceArrowhead !== undefined) check(ends.from, ends.to);
    if (edge.targetArrowhead !== undefined) check(ends.to, ends.from);
  });
  return deficits;
}

const holds = (r: Rect, q: { x: number; y: number }) =>
  q.x >= r.x && q.x <= rightOf(r) && q.y >= r.y && q.y <= bottomOf(r);

/** The distance from an end's port to the border of `rect` along the end's direction. */
function freeAhead(rect: Rect, end: End): number {
  const p = end.port;
  switch (end.dir) {
    case 0:
      return rightOf(rect) - p.x;
    case 1:
      return bottomOf(rect) - p.y;
    case 2:
      return p.x - rect.x;
    default:
      return p.y - rect.y;
  }
}
