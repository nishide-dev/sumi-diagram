/**
 * Block ends (#642, design record `docs/design/decisions/642-block-anchor.md`):
 * an edge end written `block` / `block:<side>` meets a whole element at the
 * middle of a side. On an element that draws no frame of its own (the frame
 * group of a tokens row or a matrix, a plain group), a line at the middle of
 * a side touches one cell and reads as that cell's; a bracket along the side,
 * spanning the content, shows that the line belongs to all of it.
 *
 * The bracket is a bar parallel to the side, spanning the content, with a
 * short tick at each end toward the content: `[` turned to face the block.
 * The bar stands {@link BRACKET_ROOM} from the content: on the frame's side
 * when the frame's padding is at least that, else outside the frame, and the
 * route is shortened to end on the bar (after routing, so the placement and
 * the routes of the figure do not change). A short straight run out of the
 * side (a stub up to a shared trunk) gives what it can, keeping a unit and its
 * arrowhead; under 1pt, the bar sits on the frame's side.
 */

import type { EdgeIR, FigureIR, GroupIR } from "../compiler/ir";
import type { ElementKey } from "../core/check-state";
import type { Side } from "../core/figure/schema";
import type { Point, Rect } from "../core/geometry";
import type { EdgeLayout, LayoutIR } from "./ir";
import { edgeArrowheadLength } from "./route/arrowhead";
import { endpointRects } from "./route/endpoint-rects";

/** Room between the content and the bar on a frame without padding of its own: 3pt, in units. */
export const BRACKET_ROOM = 6;

/** The longest tick toward the content: 2pt, in units. */
export const BRACKET_TICK = 4;

/** The least distance a route is shortened by to stand the bar off the content: 1pt, in units. */
const MIN_ROOM = 2;

/** The least room kept between a tick's end and the content: 1pt, in units. */
const TICK_CLEARANCE = 2;

/** The groups some edge meets with a `block` end (#642). */
export function blockEndKeys(ir: { readonly edges: readonly EdgeIR[] }): Set<ElementKey> {
  const keys = new Set<ElementKey>();
  for (const edge of ir.edges) {
    if (edge.fromBlock === true) keys.add(edge.from);
    if (edge.toBlock === true) keys.add(edge.to);
  }
  return keys;
}

/** Whether a block end on `group` is drawn with a bracket: the group draws no frame of its own. */
export function bracketed(group: GroupIR | undefined): boolean {
  return group !== undefined && group.variant === "plain";
}

/** The side of `rect` that `point` lies on (within half a unit), or `undefined`. */
export function sideAt(rect: Rect, point: Point): Side | undefined {
  const near = (a: number, b: number) => Math.abs(a - b) <= 0.5;
  const withinX = point.x >= rect.x - 0.5 && point.x <= rect.x + rect.width + 0.5;
  const withinY = point.y >= rect.y - 0.5 && point.y <= rect.y + rect.height + 0.5;
  if (withinX && near(point.y, rect.y)) return "north";
  if (withinX && near(point.y, rect.y + rect.height)) return "south";
  if (withinY && near(point.x, rect.x)) return "west";
  if (withinY && near(point.x, rect.x + rect.width)) return "east";
  return undefined;
}

/** The outward normal of a side. */
const NORMAL: Record<Side, Point> = {
  north: { x: 0, y: -1 },
  south: { x: 0, y: 1 },
  west: { x: -1, y: 0 },
  east: { x: 1, y: 0 },
};

/** Room between `content` and the side of `rect`. */
function padOn(rect: Rect, content: Rect, side: Side): number {
  return side === "north"
    ? content.y - rect.y
    : side === "south"
      ? rect.y + rect.height - (content.y + content.height)
      : side === "west"
        ? content.x - rect.x
        : rect.x + rect.width - (content.x + content.width);
}

/**
 * The bracket on `side` of `content`, its bar `distance` from it: a polyline
 * from one tick's tip along the bar to the other tick's tip. Each tick
 * reaches toward the content, at most {@link BRACKET_TICK} long and
 * {@link TICK_CLEARANCE} short of it; without room for a tick, the bar alone.
 */
export function bracketPoints(content: Rect, side: Side, distance: number): Point[] {
  const tick = Math.max(0, Math.min(BRACKET_TICK, distance - TICK_CLEARANCE));
  const vertical = side === "north" || side === "south";
  const normal = NORMAL[side];
  if (vertical) {
    const y = (side === "north" ? content.y : content.y + content.height) + normal.y * distance;
    const [x0, x1] = [content.x, content.x + content.width];
    const tip = y - normal.y * tick;
    return tick === 0
      ? [
          { x: x0, y },
          { x: x1, y },
        ]
      : [
          { x: x0, y: tip },
          { x: x0, y },
          { x: x1, y },
          { x: x1, y: tip },
        ];
  }
  const x = (side === "west" ? content.x : content.x + content.width) + normal.x * distance;
  const [y0, y1] = [content.y, content.y + content.height];
  const tip = x - normal.x * tick;
  return tick === 0
    ? [
        { x, y: y0 },
        { x, y: y1 },
      ]
    : [
        { x: tip, y: y0 },
        { x, y: y0 },
        { x, y: y1 },
        { x: tip, y: y1 },
      ];
}

/**
 * Adds the brackets of the `block` ends (#642) on frames without a border to
 * the routed layout (`EdgeRoute.brackets`), shortening a route that ends on
 * the frame so it ends on the bar. Nothing changes for a figure without them.
 */
export function withBlockBrackets(ir: FigureIR, layout: LayoutIR): LayoutIR {
  if (!ir.edges.some((e) => e.fromBlock === true || e.toBlock === true)) return layout;
  const groups = new Map(ir.groups.map((g) => [g.key, g]));
  const placed = new Map(layout.groups.map((g) => [g.key, g]));
  // A tokens frame is met at its cells' bounds (#331), not at the room it keeps for notes.
  const ends = endpointRects(ir, layout);
  const edgeIRs = new Map(ir.edges.map((e) => [e.key, e]));
  const edges = layout.edges.map((edge): EdgeLayout => {
    const e = edgeIRs.get(edge.key);
    const route = edge.route;
    if (e === undefined || route === undefined || route.lines !== undefined) return edge;
    if (e.fromBlock !== true && e.toBlock !== true) return edge;
    const points = [...route.points];
    const brackets: Point[][] = [];
    for (const [block, key, atStart] of [
      [e.fromBlock, e.from, true],
      [e.toBlock, e.to, false],
    ] as const) {
      const frame = placed.get(key);
      const group = groups.get(key);
      if (block !== true || frame === undefined || !bracketed(group)) continue;
      const rect = ends.get(key) ?? frame.rect;
      const content = group?.tokens !== undefined ? rect : frame.content;
      const end = atStart ? 0 : points.length - 1;
      const next = atStart ? 1 : points.length - 2;
      const point = points[end] as Point;
      const side = sideAt(rect, point);
      if (side === undefined) continue;
      const pad = padOn(rect, content, side);
      let out = Math.max(0, BRACKET_ROOM - pad);
      if (out > 0) {
        // Only along a straight run out of the side, long enough to keep its arrowhead whole.
        const normal = NORMAL[side];
        const q = points[next] as Point;
        const along = (q.x - point.x) * normal.x + (q.y - point.y) * normal.y;
        const aside = Math.abs((q.x - point.x) * normal.y - (q.y - point.y) * normal.x);
        const head = atStart ? e.sourceArrowhead : e.targetArrowhead;
        // The run keeps at least a unit (and its arrowhead): a short run, e.g. a stub up to a
        // shared trunk, gives the bracket what it can.
        const keep = head === undefined || head === "none" ? 2 : edgeArrowheadLength(e.style) + 2;
        out = e.route === "curve" || aside > 0.5 ? 0 : Math.min(out, along - keep);
        if (out < MIN_ROOM) out = 0;
        else points[end] = { x: point.x + normal.x * out, y: point.y + normal.y * out };
      }
      brackets.push(bracketPoints(content, side, pad + out));
    }
    if (brackets.length === 0) return edge;
    return { ...edge, route: { ...route, points, brackets } };
  });
  return { ...layout, edges };
}
