/**
 * The structured layout engine (#89, design doc §6.21; #86 §3.2): places the
 * nodes and groups of a structured figure by its arrange trees and `attach`,
 * and returns the {@link LayoutIR}. Edges are not routed here (#90).
 *
 * A deterministic single pass, without search or iteration:
 * 1. Measure bottom-up. A leaf node's natural size comes from its label
 *    (measured with the theme's TTF files) and the profile's node padding
 *    (`sizing.ts`). A stack / row is as long as its items plus the gaps and as
 *    wide as its widest item. A group is its content plus padding (and its
 *    label above the content, or below it for a bottom `labelAt`).
 * 2. Place top-down. Items follow each other along the main axis
 *    (`direction` reverses the order); `align` places them on the cross
 *    axis, and `stretch` widens resizable items to the box. A box given more
 *    main-axis room than it needs centers its items.
 * 3. Attach: an attached node is centered on the `side` of its target, `gap`
 *    away. It belongs to the target's parent, and that parent's content is
 *    the union of its arrange tree and its attached nodes: a group grows to
 *    hold them. The overhang is measured on the natural layout; the extra room
 *    a stretched group (or a group with a wide label) gets goes to its arrange
 *    tree. That never needs more overhang: extra room only centers items
 *    (moving them away from both edges), keeps `start` / `end` items at their
 *    edge, or widens `stretch` items that already reach the edges, so an
 *    attached node, centered on its target's side, can only end up further
 *    inside. Put precisely: when the frame grows by Δ on an axis, every
 *    arranged edge moves by an amount in [0, Δ] (nested boxes compose), and an
 *    attached node of fixed size follows one target edge or the mean of two,
 *    so it does too, through chains. (A seeded randomized test checks the
 *    containment.)
 * 4. Normalize: shift so the content starts at the margin, round every
 *    coordinate to 1/1000 unit; the canvas is the content plus the margins,
 *    rounded up to whole units.
 *
 * `figure.layout.align` (#132) wraps this pass in a fixed-point loop
 * (`align.ts`): the pass takes struts, extra main-axis space before or after
 * an item of a box, and the loop adds struts until the constraints are met.
 * Without struts the pass is exactly the one above.
 *
 * Alignment inherits only between boxes of the same axis (a stack inside a
 * stack); a box of the other axis, a group's arrange tree and the root start
 * from `center`. All of this matches the #86 prototype
 * (`research/86-paper-figures/proto/layout.ts`); the differences are listed
 * in the design doc.
 */

import { iconBox } from "../../assets/draw";
import type { ArrangeBoxIR, ArrangeItemIR, FigureIR, GroupIR, NodeIR } from "../../compiler/ir";
import type { ElementKey } from "../../core/check-state";
import type { Diagnostic } from "../../core/diagnostics";
import type { GroupLabelPosition, Side } from "../../core/figure/schema";
import { getProfile } from "../../core/profile/builtin";
import type { Profile } from "../../core/profile/schema";
import { getFontSet } from "../../core/theme/fonts";
import { roundToD2Units } from "../../core/units";
import {
  type EdgeLayout,
  type GroupLayout,
  type LayoutIR,
  type NodeLayout,
  type Rect,
  roundRect,
  roundUnits,
  type TextLayout,
  type TextMetrics,
} from "../ir";
import { arrowheadPaddingDeficits, type SidePadding } from "../route/padding";
import { fontSetMeasurer, measureText, type TextMeasurer } from "../text";
import {
  type AlignLimits,
  type AlignStats,
  MAX_ALIGN_LAYOUTS,
  NO_STRUTS,
  type Struts,
  solveAlignment,
} from "./align";
import { nodeLabelCenter, nodeSize, type Size, stretchableShape } from "./sizing";

/** The engine name recorded in the Layout IR. */
export const STRUCTURED_ENGINE = "sumi-structured";

export interface StructuredLayoutOptions {
  /** Defaults to the figure's profile (`ir.meta.profileId`). */
  profile?: Profile;
  /** Defaults to the TTF files of the figure theme's font set. */
  measurer?: TextMeasurer;
  /** Bounds of the `figure.layout.align` search (#132); for tests. */
  alignLimits?: AlignLimits;
}

type Align = NonNullable<ArrangeBoxIR["align"]>;

/** Overhang of a container's attached nodes beyond its arrange tree, per side. */
interface Overhang {
  north: number;
  east: number;
  south: number;
  west: number;
}

const NO_OVERHANG: Readonly<Overhang> = Object.freeze({ north: 0, east: 0, south: 0, west: 0 });

/** The root container (the figure itself). */
const ROOT = "";
type Container = ElementKey | typeof ROOT;

/**
 * Lays out a structured figure. Throws for a figure that is not structured
 * (or whose IR is inconsistent): callers check `ir.meta.engine` first.
 */
export function layoutStructured(ir: FigureIR, options: StructuredLayoutOptions = {}): LayoutIR {
  return placeStructured(ir, options).layout;
}

/** A structured layout and the diagnostics of placing it (`layout/unsatisfied-align`). */
export interface PlacedStructured {
  readonly layout: LayoutIR;
  readonly diagnostics: readonly Diagnostic[];
  /** Present when the figure has `figure.layout.align`: how the constraints were solved. */
  readonly align?: AlignStats;
}

/**
 * Lays out a structured figure like {@link layoutStructured}, solving its
 * `figure.layout.align` constraints (#132) and reporting the ones it cannot
 * meet as `layout/unsatisfied-align` (warning).
 */
export function placeStructured(
  ir: FigureIR,
  options: StructuredLayoutOptions = {},
): PlacedStructured {
  if (ir.meta.engine !== "structured" || ir.arrange === undefined) {
    throw new Error("internal error: the structured layout needs a structured figure");
  }
  const profile = options.profile ?? getProfile(ir.meta.profileId);
  if (profile === undefined)
    throw new Error(`internal error: unknown profile ${ir.meta.profileId}`);
  let measurer = options.measurer;
  if (measurer === undefined) {
    const fonts = getFontSet(ir.meta.fontSetId);
    if (fonts === undefined)
      throw new Error(`internal error: unknown font set ${ir.meta.fontSetId}`);
    measurer = fontSetMeasurer(fonts);
  }
  const engine = new StructuredLayout(ir, profile, measurer);
  // The align budget (`MAX_ALIGN_LAYOUTS`) is the figure's, shared by the
  // solves of the re-layouts below; the stats count them all.
  const budget = options.alignLimits?.maxLayouts ?? MAX_ALIGN_LAYOUTS;
  let spent = 0;
  const place = (): PlacedStructured => {
    if (ir.align === undefined || ir.align.length === 0) {
      return { layout: engine.run(), diagnostics: [] };
    }
    const solved = solveAlignment(ir, ir.align, (struts) => engine.run(struts), {
      ...options.alignLimits,
      maxLayouts: budget - spent,
    });
    spent += solved.stats.layouts;
    return {
      layout: solved.layout,
      diagnostics: solved.diagnostics,
      align: { ...solved.stats, layouts: spent },
    };
  };
  // Room before arrowheads in group padding (#171, design doc §6.42): widen
  // the sides of groups where an edge turns in the padding right before an
  // arrowhead, and lay out again (at most `ARROWHEAD_PADDING_RELAYOUTS`
  // times, and only while the align budget lasts). Usually there is nothing
  // to widen, so one layout; widening moves ports only away from those
  // borders, so a second re-layout is rare.
  let placed = place();
  for (let round = 0; round < ARROWHEAD_PADDING_RELAYOUTS; round++) {
    if (ir.align !== undefined && ir.align.length > 0 && spent >= budget) break;
    const deficits = arrowheadPaddingDeficits(ir, placed.layout);
    if (deficits.size === 0) break;
    engine.growPadding(deficits);
    placed = place();
  }
  return placed;
}

/** Re-layouts for the padding before arrowheads (#171); the first nearly always settles it. */
const ARROWHEAD_PADDING_RELAYOUTS = 3;

class StructuredLayout {
  readonly #ir: FigureIR;
  readonly #measurer: TextMeasurer;
  readonly #nodes = new Map<ElementKey, NodeIR>();
  readonly #groups = new Map<ElementKey, GroupIR>();
  /** Attached nodes by container (their target's parent), in document order. */
  readonly #attached = new Map<Container, NodeIR[]>();
  readonly #labels = new Map<ElementKey, TextMetrics>();
  readonly #leafSizes = new Map<ElementKey, Size>();
  readonly #defaultGap: number;
  readonly #groupPadding: number;
  /** Padding added to sides of groups for the room before arrowheads (#171, `growPadding`). */
  readonly #extraPadding = new Map<ElementKey, Overhang>();
  readonly #margin: number;

  // The state of one pass (`run`).
  #struts: Struts = NO_STRUTS;
  readonly #overhangs = new Map<Container, Overhang>();
  readonly #itemSizes = new Map<ElementKey, Size>();
  readonly #rects = new Map<ElementKey, Rect>();
  readonly #contents = new Map<ElementKey, Rect>();

  constructor(ir: FigureIR, profile: Profile, measurer: TextMeasurer) {
    this.#ir = ir;
    this.#measurer = measurer;
    const units = (pt: number) => pt * 2;
    this.#defaultGap = units(profile.layout.arrangeGap.pt);
    this.#groupPadding = units(profile.layout.groupPadding.pt);
    // Like the auto engine's D2 `--pad`: the margin in whole units.
    this.#margin = roundToD2Units(profile.margin);
    const padding = {
      x: units(profile.layout.nodePaddingX.pt),
      y: units(profile.layout.nodePaddingY.pt),
    };
    for (const node of ir.nodes) {
      this.#nodes.set(node.key, node);
      const label = measureText(node.label, node.style, measurer);
      if (label !== undefined) this.#labels.set(node.key, label);
      // An icon (#94) takes the place of the label: a square of 1 em.
      this.#leafSizes.set(node.key, nodeSize(node, label ?? iconBox(node), padding));
      if (node.attach !== undefined) {
        const container = node.parent ?? ROOT;
        const list = this.#attached.get(container) ?? [];
        list.push(node);
        this.#attached.set(container, list);
      }
    }
    for (const group of ir.groups) {
      this.#groups.set(group.key, group);
      const label = measureText(group.label, group.style, measurer);
      if (label !== undefined) this.#labels.set(group.key, label);
    }
  }

  /**
   * Widens sides of groups by `extra` (units) for the passes that follow:
   * the room an edge needs before an arrowhead in a group's padding (#171,
   * `arrowheadPaddingDeficits`). Adds to what earlier calls added.
   */
  growPadding(extra: ReadonlyMap<ElementKey, SidePadding>): void {
    for (const [key, sides] of extra) {
      const current = this.#extraPadding.get(key) ?? { ...NO_OVERHANG };
      current.north += sides.north;
      current.east += sides.east;
      current.south += sides.south;
      current.west += sides.west;
      this.#extraPadding.set(key, current);
    }
  }

  /** A group's padding per side: the profile's, plus any `growPadding` added. */
  #padding(key: ElementKey): Overhang {
    const p = this.#groupPadding;
    const extra = this.#extraPadding.get(key) ?? NO_OVERHANG;
    return {
      north: p + extra.north,
      east: p + extra.east,
      south: p + extra.south,
      west: p + extra.west,
    };
  }

  /** One pass; `struts` add main-axis space around items (#132, `align.ts`). */
  run(struts: Struts = NO_STRUTS): LayoutIR {
    this.#struts = struts;
    this.#overhangs.clear();
    this.#itemSizes.clear();
    this.#rects.clear();
    this.#contents.clear();
    const root = this.#ir.arrange as ArrangeBoxIR;
    const size = this.#containerSize(ROOT, root);
    this.#placeContainer(ROOT, root, { x: 0, y: 0, width: size.width, height: size.height });
    return this.#result();
  }

  // --- Measuring -----------------------------------------------------------

  #gap(box: ArrangeBoxIR): number {
    return box.gapPt === undefined ? this.#defaultGap : box.gapPt * 2;
  }

  #itemSize(item: ArrangeItemIR): Size {
    if (typeof item !== "string") return this.#boxSize(item);
    const cached = this.#itemSizes.get(item);
    if (cached !== undefined) return cached;
    const leaf = this.#leafSizes.get(item);
    const size = leaf ?? this.#groupSize(this.#group(item));
    this.#itemSizes.set(item, size);
    return size;
  }

  #boxSize(box: ArrangeBoxIR): Size {
    const sizes = box.items.map((item) => this.#itemSize(item));
    const vertical = box.kind === "stack";
    const main =
      sizes.reduce((sum, s) => sum + (vertical ? s.height : s.width), 0) +
      box.items.reduce((sum, item) => sum + this.#lead(item) + this.#trail(item), 0);
    const gaps = this.#gap(box) * (sizes.length - 1);
    const cross = Math.max(0, ...sizes.map((s) => (vertical ? s.width : s.height)));
    return vertical ? { width: cross, height: main + gaps } : { width: main + gaps, height: cross };
  }

  /** Strut before `item` along its box's main axis, in visual order (above / left of it). */
  #lead(item: ArrangeItemIR): number {
    return this.#struts.lead.get(item) ?? 0;
  }

  /** Strut after `item` (below / right of it). */
  #trail(item: ArrangeItemIR): number {
    return this.#struts.trail.get(item) ?? 0;
  }

  #groupSize(group: GroupIR): Size {
    const content = this.#containerSize(group.key, group.arrange);
    const label = this.#labels.get(group.key);
    const p = this.#padding(group.key);
    return {
      width:
        Math.max(content.width, label === undefined ? 0 : Math.ceil(label.width)) + p.west + p.east,
      height: content.height + p.north + p.south + this.#labelSpace(label),
    };
  }

  /**
   * Height a group's label band takes above (or below) its content: the label
   * and half the padding between it and the content.
   */
  #labelSpace(label: TextMetrics | undefined): number {
    return label === undefined ? 0 : Math.ceil(label.height) + this.#groupPadding / 2;
  }

  /**
   * The natural size of a container's content: its arrange tree plus the
   * overhang of its attached nodes, measured in a local layout of the tree at
   * its natural size (see the module comment for why that is enough).
   */
  #containerSize(container: Container, arrange: ArrangeBoxIR | undefined): Size {
    const box = arrange === undefined ? { width: 0, height: 0 } : this.#boxSize(arrange);
    let overhang = this.#overhangs.get(container);
    if (overhang === undefined) {
      const frame = { x: 0, y: 0, width: box.width, height: box.height };
      const local = new Map<ElementKey, Rect>();
      if (arrange !== undefined) {
        this.#placeBox(arrange, frame, "center", (key, rect) => local.set(key, rect));
      }
      this.#placeAttached(container, local);
      overhang = overhangOf(frame, this.#attachedRects(container, local));
      this.#overhangs.set(container, overhang);
    }
    return {
      width: box.width + overhang.west + overhang.east,
      height: box.height + overhang.north + overhang.south,
    };
  }

  // --- Placing ---------------------------------------------------------------

  /**
   * Places a box's items in `frame`; calls `visit` for every node or group
   * item (nested boxes are placed recursively, groups are not entered).
   */
  #placeBox(
    box: ArrangeBoxIR,
    frame: Rect,
    inherited: Align,
    visit: (key: ElementKey, rect: Rect) => void,
  ): void {
    const align = box.align ?? inherited;
    const vertical = box.kind === "stack";
    const reversed = box.direction === "up" || box.direction === "left";
    const order = reversed ? [...box.items].reverse() : box.items;
    const natural = this.#boxSize(box);
    const gap = this.#gap(box);
    // Extra main-axis room (from a stretching parent) centers the items; a
    // caption's stack (#130) gives it to its group instead (`growFirst`).
    const extra = vertical ? frame.height - natural.height : frame.width - natural.width;
    let grow = box.growFirst === true ? Math.max(0, extra) : 0;
    let cursor = (vertical ? frame.y : frame.x) + (grow > 0 ? 0 : extra / 2);
    const crossAvailable = vertical ? frame.width : frame.height;
    for (const item of order) {
      const itemNatural = this.#itemSize(item);
      const size = vertical
        ? { ...itemNatural, height: itemNatural.height + grow }
        : { ...itemNatural, width: itemNatural.width + grow };
      grow = 0;
      const crossNatural = vertical ? size.width : size.height;
      const cross =
        align === "stretch" && this.#stretchable(item, vertical) ? crossAvailable : crossNatural;
      const offset =
        align === "start" || (align === "stretch" && cross === crossAvailable)
          ? 0
          : align === "end"
            ? crossAvailable - cross
            : (crossAvailable - cross) / 2;
      cursor += this.#lead(item);
      const rect: Rect = vertical
        ? { x: frame.x + offset, y: cursor, width: cross, height: size.height }
        : { x: cursor, y: frame.y + offset, width: size.width, height: cross };
      if (typeof item === "string") visit(item, rect);
      else this.#placeBox(item, rect, item.kind === box.kind ? align : "center", visit);
      cursor += (vertical ? size.height : size.width) + gap + this.#trail(item);
    }
  }

  /** Whether `stretch` resizes an item on the cross axis of a stack (`vertical`) or row. */
  #stretchable(item: ArrangeItemIR, vertical: boolean): boolean {
    if (typeof item !== "string") return true;
    const node = this.#nodes.get(item);
    if (node === undefined) return true;
    const explicit = vertical ? node.width : node.height;
    // Outline components keep their footprint: stretching changes the
    // renderer's safe area (e.g. a taller trapezoid has deeper slants).
    return explicit === undefined && node.render === undefined && stretchableShape(node.shape);
  }

  /** Places a container's arrange tree and attached nodes in its content area. */
  #placeContainer(container: Container, arrange: ArrangeBoxIR | undefined, area: Rect): void {
    const overhang = this.#overhangs.get(container) ?? NO_OVERHANG;
    const frame: Rect = {
      x: area.x + overhang.west,
      y: area.y + overhang.north,
      width: area.width - overhang.west - overhang.east,
      height: area.height - overhang.north - overhang.south,
    };
    if (arrange !== undefined) {
      this.#placeBox(arrange, frame, "center", (key, rect) => this.#placeElement(key, rect));
    }
    this.#placeAttached(container, this.#rects);
  }

  #placeElement(key: ElementKey, rect: Rect): void {
    this.#rects.set(key, rect);
    const group = this.#groups.get(key);
    if (group === undefined) return;
    const p = this.#padding(key);
    const band = this.#labelSpace(this.#labels.get(key));
    // The label band is above the content, or below it for a bottom label (#127).
    const top = labelAtBottom(group.labelAt) ? 0 : band;
    const content: Rect = {
      x: rect.x + p.west,
      y: rect.y + p.north + top,
      width: rect.width - p.west - p.east,
      height: rect.height - p.north - p.south - band,
    };
    this.#contents.set(key, content);
    this.#placeContainer(key, group.arrange, content);
  }

  /** Places the attached nodes of `container` into `rects`, each after its target. */
  #placeAttached(container: Container, rects: Map<ElementKey, Rect>): void {
    const pending = [...(this.#attached.get(container) ?? [])];
    while (pending.length > 0) {
      // The first (in document order) whose target is placed; the result does
      // not depend on the order, since each node depends only on its target.
      const index = pending.findIndex((node) => node.attach && rects.has(node.attach.to));
      const node = pending[index];
      // The layout stage rejects attach cycles, and a target is in the same container.
      if (node?.attach === undefined)
        throw new Error("internal error: an attach target is never placed");
      pending.splice(index, 1);
      const { to, side, gapPt } = node.attach;
      const target = rects.get(to) as Rect;
      rects.set(node.key, attachedRect(target, this.#itemSize(node.key), side, gapPt * 2));
    }
  }

  #attachedRects(container: Container, rects: Map<ElementKey, Rect>): Rect[] {
    return (this.#attached.get(container) ?? []).flatMap((node) => {
      const rect = rects.get(node.key);
      return rect === undefined ? [] : [rect];
    });
  }

  #group(key: ElementKey): GroupIR {
    const group = this.#groups.get(key);
    if (group === undefined)
      throw new Error(`internal error: ${key} is neither a node nor a group`);
    return group;
  }

  // --- Result ----------------------------------------------------------------

  #result(): LayoutIR {
    const labels = new Map<ElementKey, TextLayout>();
    for (const node of this.#ir.nodes) {
      const metrics = this.#labels.get(node.key);
      const rect = this.#rect(node.key);
      if (metrics !== undefined) {
        labels.set(node.key, placeText(metrics, nodeLabelCenter(node, rect)));
      }
    }
    for (const group of this.#ir.groups) {
      const metrics = this.#labels.get(group.key);
      const rect = this.#rect(group.key);
      if (metrics !== undefined) {
        labels.set(group.key, placeText(metrics, this.#groupLabelCenter(group, rect, metrics)));
      }
    }

    const all = [...this.#rects.values(), ...[...labels.values()].map((label) => label.box)];
    const minX = Math.min(...all.map((r) => r.x));
    const minY = Math.min(...all.map((r) => r.y));
    const maxX = Math.max(...all.map((r) => r.x + r.width));
    const maxY = Math.max(...all.map((r) => r.y + r.height));
    const m = this.#margin;
    const dx = m - minX;
    const dy = m - minY;
    const shift = (r: Rect): Rect => roundRect({ ...r, x: r.x + dx, y: r.y + dy });
    const shiftText = (label: TextLayout): TextLayout => ({
      ...label,
      box: shift(label.box),
      anchor: { x: roundUnits(label.anchor.x + dx), y: roundUnits(label.anchor.y + dy) },
    });

    const nodes: NodeLayout[] = this.#ir.nodes.map((node) => {
      const label = labels.get(node.key);
      return {
        key: node.key,
        kind: "node",
        ...(node.parent !== undefined && { parent: node.parent }),
        shape: node.shape,
        rect: shift(this.#rect(node.key)),
        placement: node.attach === undefined ? "arrange" : "attach",
        ...(label !== undefined && { label: shiftText(label) }),
      };
    });
    const groups: GroupLayout[] = groupPreOrder(this.#ir).map((group) => {
      const label = labels.get(group.key);
      return {
        key: group.key,
        kind: "group",
        ...(group.parent !== undefined && { parent: group.parent }),
        rect: shift(this.#rect(group.key)),
        content: shift(this.#contents.get(group.key) as Rect),
        ...(label !== undefined && { label: shiftText(label) }),
      };
    });
    const edges: EdgeLayout[] = this.#ir.edges.map((edge) => {
      const labelMetrics = measureText(edge.label, edge.style, this.#measurer);
      return {
        key: edge.key,
        kind: "edge",
        from: edge.from,
        to: edge.to,
        ...(edge.fromAnchor !== undefined && { fromAnchor: { ...edge.fromAnchor } }),
        ...(edge.toAnchor !== undefined && { toAnchor: { ...edge.toAnchor } }),
        ...(labelMetrics !== undefined && { labelMetrics }),
      };
    });
    const content = shift({ x: minX, y: minY, width: maxX - minX, height: maxY - minY });
    return deepFreeze({
      engine: STRUCTURED_ENGINE,
      canvas: {
        width: Math.ceil(roundUnits(maxX - minX) + 2 * m),
        height: Math.ceil(roundUnits(maxY - minY) + 2 * m),
      },
      margin: m,
      content,
      groups,
      nodes,
      edges,
    });
  }

  /**
   * Where a group's label is centered: in the band at the top (or, for a
   * bottom `labelAt`, the bottom) of the group, inside the padding, at the
   * left, centre or right (#127). Omitted `labelAt` is top centre.
   */
  #groupLabelCenter(group: GroupIR, rect: Rect, metrics: TextMetrics): { x: number; y: number } {
    const p = this.#groupPadding;
    const at = group.labelAt ?? "top";
    const x = at.endsWith("-left")
      ? rect.x + p + metrics.width / 2
      : at.endsWith("-right")
        ? rect.x + rect.width - p - metrics.width / 2
        : rect.x + rect.width / 2;
    const y = labelAtBottom(at)
      ? rect.y + rect.height - p - metrics.height / 2
      : rect.y + p + metrics.height / 2;
    return { x, y };
  }

  #rect(key: ElementKey): Rect {
    const rect = this.#rects.get(key);
    if (rect === undefined) throw new Error(`internal error: ${key} was not placed`);
    return rect;
  }
}

/** Whether a group's label band is at the bottom of the group (#127). */
function labelAtBottom(at: GroupLabelPosition | undefined): boolean {
  return at === "bottom-left" || at === "bottom" || at === "bottom-right";
}

/** The rectangle of a node of `size` attached to `target` on `side`, `gap` away, centered on that side. */
function attachedRect(target: Rect, size: Size, side: Side, gap: number): Rect {
  const { width, height } = size;
  const cx = target.x + (target.width - width) / 2;
  const cy = target.y + (target.height - height) / 2;
  switch (side) {
    case "west":
      return { x: target.x - gap - width, y: cy, width, height };
    case "east":
      return { x: target.x + target.width + gap, y: cy, width, height };
    case "north":
      return { x: cx, y: target.y - gap - height, width, height };
    case "south":
      return { x: cx, y: target.y + target.height + gap, width, height };
  }
}

/** How far `rects` reach beyond `frame` on each side (0 where they stay inside). */
function overhangOf(frame: Rect, rects: readonly Rect[]): Overhang {
  const overhang = { ...NO_OVERHANG };
  for (const r of rects) {
    overhang.west = Math.max(overhang.west, frame.x - r.x);
    overhang.north = Math.max(overhang.north, frame.y - r.y);
    overhang.east = Math.max(overhang.east, r.x + r.width - (frame.x + frame.width));
    overhang.south = Math.max(overhang.south, r.y + r.height - (frame.y + frame.height));
  }
  return overhang;
}

/** Places measured text centered on `center`. */
export function placeText(metrics: TextMetrics, center: { x: number; y: number }): TextLayout {
  const box: Rect = {
    x: center.x - metrics.width / 2,
    y: center.y - metrics.height / 2,
    width: metrics.width,
    height: metrics.height,
  };
  const halfLeading = (metrics.lineHeightUnits - (metrics.ascentUnits + metrics.descentUnits)) / 2;
  return { ...metrics, box, anchor: { x: center.x, y: box.y + halfLeading + metrics.ascentUnits } };
}

/** Groups in pre-order of the group tree: roots in document order, each followed by its subtree. */
function groupPreOrder(ir: FigureIR): GroupIR[] {
  const children = new Map<ElementKey | undefined, GroupIR[]>();
  for (const group of ir.groups) {
    const list = children.get(group.parent) ?? [];
    list.push(group);
    children.set(group.parent, list);
  }
  const out: GroupIR[] = [];
  const visit = (parent: ElementKey | undefined) => {
    for (const group of children.get(parent) ?? []) {
      out.push(group);
      visit(group.key);
    }
  };
  visit(undefined);
  return out;
}

export function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
