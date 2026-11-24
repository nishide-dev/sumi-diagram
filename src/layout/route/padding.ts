/**
 * Group padding the router needs before an arrowhead (#171 / #247, design
 * §§6.42, 6.70). An edge whose ends are both inside a group and which enters (or
 * leaves, with a source arrowhead) a member through the side facing the
 * group's border turns in that group's padding: the route runs straight for
 * the arrowhead's length plus a visible 2pt stem from the port (and room for
 * a 2pt corner radius, #260), then bends along the border. The padding holds both and the clearance (3pt) between
 * the bend and the border: with the `color` theme's 1pt lines (an arrowhead
 * of 12 units) in the paper padding (8pt = 16 units), the line ran 4 units
 * from the border, 0.35mm stroke to stroke (`geometry/edge-near-border`).
 *
 * The structured engine (`placeStructured`) asks for these sides after a
 * first layout and lays the figure out again with them widened by what they
 * lack. `academic` (0.5pt lines) needs 8 + 4 + 6 = 18 units;
 * `color` (1pt lines) needs 12 + 4 + 6 = 22 units.
 */

import type { FigureIR } from "../../compiler/ir";
import type { ElementKey } from "../../core/check-state";
import type { Side } from "../../core/figure/schema";
import type { LayoutIR, Rect } from "../ir";
import {
  ARROWHEAD_STEM_UNITS,
  edgeArrowheadLength,
  GROUP_STEM_CORNER_UNITS,
  WIRE_CORNER_RADIUS,
} from "./arrowhead";
import { bottomOf, DIRS, type End, resolveEnds, rightOf } from "./ports";
import { withoutZoomEdges } from "./zoom";

/**
 * Space kept between the bend before an arrowhead and the group's border:
 * the router's clearance (`ROUTE.clearance`, 3pt; a test checks they match).
 */
export const BORDER_CLEARANCE = 6;

/** {@link BORDER_CLEARANCE} times the figure's `textScale` (#514), in whole units. */
export function borderClearance(style: { readonly textScale?: number }): number {
  return Math.round(BORDER_CLEARANCE * (style.textScale ?? 1));
}

/** Extra padding per side of a group, in units. */
export type SidePadding = Readonly<Record<Side, number>>;

/**
 * Why a side of a group grew (#640, for the width hints and `--explain-width`):
 * - `fan-out`: edges leave one port outside the group for several members
 *   (or the reverse, `fan-in`: they arrive at one port inside from several
 *   places outside), and their shared trunk turns in the padding (#512);
 * - `u-turn`: an edge enters a member through the side facing away from its
 *   other end, so its turn lies in the padding;
 * - `inside`: an edge between two elements of the group ends with an
 *   arrowhead facing the border (#171).
 * `mirrored`: the side grew only because the opposite side did (both sides
 * of an axis grow equally, #247).
 */
export interface PaddingGrowth {
  readonly side: Side;
  readonly kind: "fan-out" | "fan-in" | "u-turn" | "inside" | "mirrored";
  /** The edges (IDs, or `edges[i]`) that need the room; none for `mirrored`. */
  readonly edges: readonly string[];
  /** The room the side lacked, in units. */
  readonly units: number;
}

/** The side a direction index (`DIRS`) points to. */
const DIR_SIDE: readonly Side[] = ["east", "south", "west", "north"];

/**
 * The padding each group of `layout` lacks before an arrowhead, per side
 * (units; only groups and sides that lack some). For every end with an
 * arrowhead at a node or group whose other end lies in the same group, the
 * distance from its port to that group's border straight ahead must hold
 * the straight line the router keeps before the arrowhead (its stub: the
 * arrowhead's length plus the visible stem, and at
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
  /** Filled with why each group's sides lack room (#640); the result is the same without it. */
  reasons?: Map<ElementKey, PaddingGrowth[]>,
): Map<ElementKey, SidePadding> {
  const why = (key: ElementKey, growth: PaddingGrowth) => {
    if (reasons === undefined) return;
    const list = reasons.get(key) ?? [];
    list.push(growth);
    reasons.set(key, list);
  };
  const deficits = new Map<ElementKey, Record<Side, number>>();
  const parents = new Map(layout.groups.map((g) => [g.key, g.parent] as const));
  /** `key`'s ancestors, nearest first, and itself first. */
  const lineage = (key: ElementKey): ElementKey[] => {
    const out: ElementKey[] = [];
    for (let k: ElementKey | undefined = key; k !== undefined; k = parents.get(k)) out.push(k);
    return out;
  };
  // As the router resolves them: without the zoom edges (#176), which have no ports.
  const routed = withoutZoomEdges(ir);
  const resolved = resolveEnds(routed, layout);
  // Edges that fan out of one port outside a group into several members of it
  // (or the reverse) share a trunk that turns in the group's padding (#512).
  const fans = new Map<
    string,
    {
      group: ElementKey;
      side: Side;
      /** The largest `need - free` of its members (order-independent). */
      deficit: number;
      count: number;
      across: Set<number>;
      /** A U-turn: the edge alone puts its trunk beside the border. */
      solo: boolean;
      /** The edges of the fan, by name (#640). */
      edges: Set<string>;
    }
  >();
  routed.edges.forEach((edge, index) => {
    const ends = resolved[index];
    if (ends === undefined || "error" in ends) return;
    const name = edge.id ?? `edges[${edge.index}] ${edge.from.slice(2)} → ${edge.to.slice(2)}`;
    const clearance = borderClearance(edge.style);
    const stub = Math.max(clearance, edgeArrowheadLength(edge.style) + ARROWHEAD_STEM_UNITS);
    // The end segment holds a small rounded corner before the stem (#260).
    const need = stub + GROUP_STEM_CORNER_UNITS + clearance;
    const check = (end: End, other: End) => {
      if (end.junction || end.dir < 0) return;
      let entered: { key: ElementKey; free: number; depth: number } | undefined;
      for (const group of layout.groups) {
        if (!holds(group.rect, end.port) || holds(group.rect, other.port)) continue;
        const up = lineage(group.key);
        if (up.includes(end.key) || up.includes(other.key)) continue;
        const free = freeAhead(group.rect, end);
        if (
          entered === undefined ||
          free < entered.free ||
          (free === entered.free && up.length > entered.depth)
        )
          entered = { key: group.key, free, depth: up.length };
      }
      // Only edges that bend (not `route`d, not already in line with the other
      // end) share an orthogonal trunk that can end up beside the frame.
      const across = end.dir % 2 === 0 ? "y" : "x";
      if (
        entered !== undefined &&
        edge.route === undefined &&
        Math.abs(other.port[across] - end.port[across]) > 0.5
      ) {
        const sharing = (id: string, at: number, wanted: boolean, solo = false) => {
          if (!wanted) return;
          const fan = fans.get(id) ?? {
            group: entered.key,
            side: DIR_SIDE[end.dir] as Side,
            deficit: 0,
            count: 0,
            across: new Set<number>(),
            solo: false,
            edges: new Set<string>(),
          };
          fan.solo ||= solo;
          fan.count++;
          fan.deficit = Math.max(fan.deficit, need - entered.free);
          fan.across.add(at);
          fan.edges.add(name);
          fans.set(id, fan);
        };
        // Edges leaving one port outside the group for several members.
        sharing(
          `out|${other.key}|${other.port.x},${other.port.y}|${entered.key}|${end.dir}`,
          end.port[across],
          true,
        );
        // Edges from several places arriving at one port: the trunk runs
        // `need - clearance - free` units inside the border. Only where that
        // is within the clearance of the border (outside it or inside), the
        // line reads as part of the frame; farther out it stays clear of it.
        sharing(
          `in|${end.key}|${end.port.x},${end.port.y}|${entered.key}|${end.dir}`,
          other.port[across],
          entered.free > need - 2 * clearance,
        );
        // An end that faces away from the other end (a south port reached
        // from above) is entered by a U-turn whose trunk, `need - clearance -
        // free` inside the border, has no other place to be.
        const dir = DIRS[end.dir] as { x: number; y: number };
        const away = (other.port.x - end.port.x) * dir.x + (other.port.y - end.port.y) * dir.y < 0;
        sharing(
          `u|${edge.key}|${end.dir}`,
          end.port[across],
          away && entered.free > need - 2 * clearance,
          true,
        );
      }
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
      why(nearest.key, { side, kind: "inside", edges: [name], units: need - nearest.free });
    };
    if (edge.sourceArrowhead !== undefined) check(ends.from, ends.to);
    if (edge.targetArrowhead !== undefined) check(ends.to, ends.from);
  });
  for (const [id, fan] of fans) {
    if (!fan.solo && (fan.count < 2 || fan.across.size < 2)) continue;
    if (fan.deficit <= 0) continue;
    const sides = deficits.get(fan.group) ?? { north: 0, east: 0, south: 0, west: 0 };
    sides[fan.side] = Math.max(sides[fan.side], fan.deficit);
    deficits.set(fan.group, sides);
    why(fan.group, {
      side: fan.side,
      kind: fan.solo ? "u-turn" : id.startsWith("in|") ? "fan-in" : "fan-out",
      edges: [...fan.edges],
      units: fan.deficit,
    });
  }
  // Grow both sides of the axis equally (#247): the group's border and its
  // content then share a centre line, so outer items that the arrangement
  // centres on the group (a column's trunk above and below it) stay straight
  // with the members inside instead of jogging by half the difference.
  for (const [key, sides] of deficits)
    for (const [a, b] of [
      ["west", "east"],
      ["north", "south"],
    ] as const) {
      const most = Math.max(sides[a], sides[b]);
      for (const side of [a, b])
        if (sides[side] < most)
          why(key, { side, kind: "mirrored", edges: [], units: most - sides[side] });
      sides[a] = most;
      sides[b] = most;
    }
  return deficits;
}

const holds = (r: Rect, q: { x: number; y: number }) =>
  q.x >= r.x && q.x <= rightOf(r) && q.y >= r.y && q.y <= bottomOf(r);

/**
 * Ends approaching through tight group padding (#247). Share this selection
 * between the router's hard stub and the writer's rounding reserve. Ports
 * facing the content boundary retain a stem even with already-wide padding;
 * interior approaches outside the padding budget keep their old behavior.
 * Growing an end's own group cannot help, so use the same exclusion as the
 * padding pass. The tight budget includes the preferred rounding radius:
 * smaller members can sit slightly inward from the content boundary.
 */
export function groupArrowheadStems(ir: FigureIR, layout: LayoutIR) {
  const stems = new Map<ElementKey, { source: number; target: number }>();
  const parents = new Map(layout.groups.map((g) => [g.key, g.parent] as const));
  const routed = withoutZoomEdges(ir);
  const resolved = resolveEnds(routed, layout);
  routed.edges.forEach((edge, index) => {
    const ends = resolved[index];
    if (ends === undefined || "error" in ends) return;
    const clearance = borderClearance(edge.style);
    const need =
      Math.max(clearance, edgeArrowheadLength(edge.style) + ARROWHEAD_STEM_UNITS) + clearance;
    const stem = (end: End, other: End) => {
      if (end.junction || end.dir < 0) return 0;
      return layout.groups.some((group) => {
        if (!holds(group.rect, end.port) || !holds(group.rect, other.port)) return false;
        for (
          let key: ElementKey | undefined = group.key;
          key !== undefined;
          key = parents.get(key)
        ) {
          if (key === end.key) return false;
        }
        return (
          freeAhead(group.rect, end) <= need + WIRE_CORNER_RADIUS + 0.002 ||
          freeAhead(group.content, end) <= 0.002
        );
      })
        ? ARROWHEAD_STEM_UNITS
        : 0;
    };
    const source = edge.sourceArrowhead === undefined ? 0 : stem(ends.from, ends.to);
    const target = edge.targetArrowhead === undefined ? 0 : stem(ends.to, ends.from);
    if (source || target) stems.set(edge.key, { source, target });
  });
  return stems;
}

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
