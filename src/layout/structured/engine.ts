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
 *    axis, and `stretch` resizes items to the box. Extra main-axis room
 *    centers items by default; opt-in `justify` grows items or their gaps.
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

import { badgeRect, iconBox } from "../../assets/draw";
import { glyphRects } from "../../assets/glyphs";
import type { ArrangeBoxIR, ArrangeItemIR, FigureIR, GroupIR, NodeIR } from "../../compiler/ir";
import type { ElementKey } from "../../core/check-state";
import type { Diagnostic } from "../../core/diagnostics";
import type { EdgeAnchor } from "../../core/figure/layout";
import type { AttachSide, GroupLabelPosition, LabelRotation } from "../../core/figure/schema";
import { getProfile } from "../../core/profile/builtin";
import { type Profile, spacedProfile } from "../../core/profile/schema";
import { SEPARATOR_ID } from "../../core/registry/builtins";
import { getFontSet } from "../../core/theme/fonts";
import { roundToD2Units } from "../../core/units";
import { groupFrontRect, groupLayerSpread } from "../group-layers";
import { hintLayoutOptions, inHintTrial } from "../hint-trials";
import {
  type EdgeLayout,
  type GroupLayout,
  type LayoutIR,
  type NodeLayout,
  type Point,
  type Rect,
  roundRect,
  roundUnits,
  type SetLayout,
  type SetOutline,
  type TextLayout,
  type TextMetrics,
} from "../ir";
import { arrowheadPaddingDeficits, type SidePadding } from "../route/padding";
import { captionGap, fontSetMeasurer, measureText, type TextMeasurer } from "../text";
import {
  type AlignLimits,
  type AlignStats,
  MAX_ALIGN_LAYOUTS,
  NO_STRUTS,
  type Struts,
  solveAlignment,
} from "./align";
import { verifiedAlignHints } from "./align-hint";
import { chatGeometry } from "./chat";
import { fitSets } from "./sets";
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

/** `layout/center-on-void`: the empty room (units) above which it is reported (5mm), and its share of the box. */
const CENTER_VOID_MIN = (5 * 72) / 25.4 / 0.5;
const CENTER_VOID_RATIO = 0.25;

const NO_OVERHANG: Readonly<Overhang> = Object.freeze({ north: 0, east: 0, south: 0, west: 0 });

/** The root container (the figure itself). */
const ROOT = "";
type Container = ElementKey | typeof ROOT;

interface GridTracks {
  widths: number[];
  heights: number[];
  leading: number[];
  trailing: number[];
  columnGap: number;
  rowGap: number;
  size: Size;
  cells: { item: ArrangeItemIR; span: number; column: number; row: number; size: Size }[];
}

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
  hintLayoutOptions.set(ir, options);
  const base = options.profile ?? getProfile(ir.meta.profileId);
  if (base === undefined) throw new Error(`internal error: unknown profile ${ir.meta.profileId}`);
  // `figure.layout.density: compact` (#182) swaps in the profile's compact spacing.
  const profile = spacedProfile(base, ir.meta.density);
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
  // The solver may return an earlier candidate after running rejected trials
  // or diagnostic probes. Snapshot footprints while each layout owns the caches.
  const placementDiagnostics = new WeakMap<LayoutIR, readonly Diagnostic[]>();
  const run = (struts?: Struts): LayoutIR => {
    const layout = engine.run(struts);
    placementDiagnostics.set(layout, engine.placementDiagnostics());
    return layout;
  };
  const place = (): PlacedStructured => {
    if (ir.align === undefined || ir.align.length === 0) {
      return { layout: run(), diagnostics: [] };
    }
    const solved = solveAlignment(ir, ir.align, run, {
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
  const diagnostics =
    inHintTrial() || placed.diagnostics.length === 0
      ? placed.diagnostics
      : verifiedAlignHints(ir, placed.diagnostics);
  return {
    ...placed,
    diagnostics: [...diagnostics, ...(placementDiagnostics.get(placed.layout) ?? [])],
  };
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
  /** Nodes' sublabels (#184), measured at their own font size. */
  readonly #sublabels = new Map<ElementKey, TextMetrics>();
  readonly #leafSizes = new Map<ElementKey, Size>();
  readonly #badgeOverhangs = new Map<ElementKey, Overhang>();
  /** The text block of a caption drawn below its node's frame (#491, `labelBelow`). */
  readonly #captions = new Map<ElementKey, Size & { gap: number }>();
  readonly #defaultGap: number;
  readonly #groupPadding: number;
  /** Padding added to sides of groups for the room before arrowheads (#171, `growPadding`). */
  readonly #extraPadding = new Map<ElementKey, Overhang>();
  readonly #margin: number;
  readonly #nodePaddingX: number;

  // The state of one pass (`run`).
  #struts: Struts = NO_STRUTS;
  readonly #overhangs = new Map<Container, Overhang>();
  readonly #itemSizes = new Map<ElementKey, Size>();
  readonly #rects = new Map<ElementKey, Rect>();
  readonly #contents = new Map<ElementKey, Rect>();
  readonly #grids = new Map<ArrangeBoxIR, GridTracks>();
  readonly #boxSizes = new Map<ArrangeBoxIR, Size>();
  readonly #chatFrames = new Map<ArrangeBoxIR, Rect>();
  readonly #centerPaddings = new Map<ArrangeBoxIR, { before: number; after: number }>();

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
    this.#nodePaddingX = padding.x;
    for (const node of ir.nodes) {
      this.#nodes.set(node.key, node);
      const label = measureText(node.label, node.style, measurer);
      if (label !== undefined) this.#labels.set(node.key, label);
      const sublabel =
        node.sublabel === undefined
          ? undefined
          : measureText(
              node.sublabel.text,
              { ...node.style, fontSize: node.sublabel.fontSize },
              measurer,
            );
      if (sublabel !== undefined) this.#sublabels.set(node.key, sublabel);
      // An icon (#94) takes the place of the label: a square of 1 em. A
      // sublabel (#184) stacks under the label; a turned label (#178) takes
      // its turned box.
      const text = label === undefined ? undefined : textBlock(label, sublabel);
      const box =
        text !== undefined && node.labelRotation !== undefined
          ? { width: text.height, height: text.width }
          : (text ?? iconBox(node));
      // A separator contributes no size: siblings determine its span and gap
      // supplies the whitespace on either side. This avoids sizing feedback.
      const size =
        node.component === SEPARATOR_ID
          ? { width: 0, height: 0 }
          : nodeSize(
              node,
              box,
              node.chatPart === "divider" || node.chatMessage
                ? { x: padding.x / 2, y: 0 }
                : padding,
            );
      if (node.labelBelow && box !== undefined)
        this.#captions.set(node.key, {
          width: box.width,
          height: box.height,
          gap: captionGap(node.style.fontSize.units),
        });
      const body = { x: 0, y: 0, ...size };
      const extra = overhangOf(body, this.#decorations(node, body));
      this.#badgeOverhangs.set(node.key, extra);
      this.#leafSizes.set(node.key, {
        width: size.width + extra.west + extra.east,
        height: size.height + extra.north + extra.south,
      });
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

  /** The padding (units) of `group`: its own `props.padding` (#517), else the profile's. */
  #padOf(group: GroupIR | undefined): number {
    return group?.paddingPt === undefined ? this.#groupPadding : group.paddingPt * 2;
  }

  /** A group's padding per side: the profile's, plus any `growPadding` added. */
  #padding(key: ElementKey): Overhang {
    // The frame of a tokens node (#281) is exactly its cells, and a flush
    // matrix's frame (#280) has no padding of its own either.
    const group = this.#groups.get(key);
    const p = group?.tokens !== undefined || group?.matrix?.flush === true ? 0 : this.#padOf(group);
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
    this.#grids.clear();
    // Measurements depend on this pass's struts and any grown group padding.
    this.#boxSizes.clear();
    this.#chatFrames.clear();
    this.#centerPaddings.clear();
    const root = this.#ir.arrange as ArrangeBoxIR;
    const size = this.#containerSize(ROOT, root);
    this.#placeContainer(ROOT, root, { x: 0, y: 0, width: size.width, height: size.height });
    return this.#result();
  }

  // --- Measuring -----------------------------------------------------------

  placementDiagnostics(): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    for (const box of this.#boxSizes.keys()) {
      if (box.kind === "chat") diagnostics.push(...this.#chatGeometry(box).diagnostics);
      if (box.centerOn !== undefined) {
        const padding = this.#centerPadding(box);
        const size = this.#boxSize(box);
        const emptyRoom = Math.max(padding.before, padding.after);
        const main = box.kind === "stack" ? size.height : size.width;
        if (emptyRoom > CENTER_VOID_MIN && emptyRoom >= main * CENTER_VOID_RATIO) {
          const name = box.centerOn.slice(2);
          diagnostics.push({
            code: "layout/center-on-void",
            severity: "info",
            message: `centerOn "${name}" reserves ${((emptyRoom * 0.5 * 25.4) / 72).toFixed(1)}mm of empty room on one side of its ${box.kind === "stack" ? "stack" : "row"} to keep "${name}" at the center of the box.`,
            path: ["figure", "layout", "arrange"],
            subject: { kind: "figure", id: this.#ir.meta.id },
            hint: `The box is as long on the empty side as on the side that holds the other items. Drop centerOn and line "${name}" up with an align constraint (x or y) instead, or move some items to the empty side. Keep it if the symmetric room is intended.`,
          });
        }
      }
      if (box.kind !== "place") continue;
      const rects = box.items.map((item, i) =>
        this.#coordinateRect(item, box.positionsPt?.[i] ?? [0, 0]),
      );
      for (const [i, a] of rects.entries())
        for (let j = i + 1; j < rects.length; j++) {
          const b = rects[j] as Rect;
          if (
            Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) <= 0.001 ||
            Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) <= 0.001
          )
            continue;
          const source = box.placementSources?.[j];
          const first = box.placementSources?.[i];
          const position = (k: number) => `(${box.positionsPt?.[k]?.join(", ")})pt`;
          diagnostics.push({
            code: "layout/place-overlap",
            severity: "warning",
            message: `Place item ${i + 1} at ${position(i)} overlaps item ${j + 1} at ${position(j)} (natural footprints).`,
            ...source,
            hint: "Separate the centers or increase place.unit; coordinates are never moved automatically.",
            ...(first && {
              related: [{ ...first, message: "The other item's center is written here." }],
            }),
          });
        }
    }
    return diagnostics;
  }

  #gap(box: ArrangeBoxIR): number {
    return box.gapPt === undefined ? this.#defaultGap : box.gapPt * 2;
  }

  #itemSize(item: ArrangeItemIR): Size {
    if (item === null) return { width: 0, height: 0 };
    if (typeof item !== "string") return this.#boxSize(item);
    const cached = this.#itemSizes.get(item);
    if (cached !== undefined) return cached;
    const leaf = this.#leafSizes.get(item);
    let size = leaf;
    if (size === undefined) {
      const group = this.#group(item);
      size = this.#groupSize(group);
      // A title above the border (#517) hangs outside the frame, like a badge.
      const above = this.#titleAbove(group);
      if (above > 0) {
        this.#badgeOverhangs.set(item, { north: above, east: 0, south: 0, west: 0 });
        size = { width: size.width, height: size.height + above };
      }
    }
    this.#itemSizes.set(item, size);
    return size;
  }

  #boxSize(box: ArrangeBoxIR): Size {
    const cached = this.#boxSizes.get(box);
    if (cached !== undefined) return cached;
    if (box.kind === "chat") {
      const size = this.#chatGeometry(box).size;
      this.#boxSizes.set(box, size);
      return size;
    }
    if (box.kind === "place") {
      const bounds = this.#placeBounds(box);
      const size = { width: bounds.width, height: bounds.height };
      this.#boxSizes.set(box, size);
      return size;
    }
    if (box.kind === "grid") return this.#gridTracks(box).size;
    const sizes = box.items.map((item) => this.#itemSize(item));
    const vertical = box.kind === "stack";
    const main =
      sizes.reduce((sum, s) => sum + (vertical ? s.height : s.width), 0) +
      box.items.reduce((sum, item) => sum + this.#lead(item) + this.#trail(item), 0);
    const gaps = this.#gap(box) * (sizes.length - 1);
    let cross = Math.max(
      0,
      ...box.items.map((item, i) => {
        const size = sizes[i] as Size;
        const length = vertical ? size.width : size.height;
        if (typeof item !== "string") return length;
        const body = this.#bodyRect(item, { x: 0, y: 0, ...size });
        const center = vertical ? body.x + body.width / 2 : body.y + body.height / 2;
        return 2 * Math.max(center, length - center);
      }),
    );
    // An unspecified alignment may inherit start/end from a same-axis parent.
    for (const alignment of box.align === undefined ? ["start", "end"] : [box.align]) {
      if (alignment !== "start" && alignment !== "end") continue;
      const extents = box.items.map((item, i) => {
        const size = sizes[i] as Size;
        const length = vertical ? size.width : size.height;
        const body =
          typeof item === "string"
            ? this.#bodyRect(item, { x: 0, y: 0, ...size })
            : { x: 0, y: 0, ...size };
        const start = vertical ? body.x : body.y;
        const end = start + (vertical ? body.width : body.height);
        return { start, end, length };
      });
      const padding = Math.max(
        0,
        ...extents.map((e) => (alignment === "start" ? e.start : e.length - e.end)),
      );
      const alignedCross = Math.max(
        0,
        ...extents.map((e) => padding + (alignment === "start" ? e.length - e.start : e.end)),
      );
      cross = box.align === undefined ? Math.max(cross, alignedCross) : alignedCross;
    }
    const padding = this.#centerPadding(box);
    const length = main + gaps + padding.before + padding.after;
    const size = vertical ? { width: cross, height: length } : { width: length, height: cross };
    this.#boxSizes.set(box, size);
    return size;
  }

  /** Reserve the complete input bundle symmetrically about its main-path item. */
  #centerPadding(box: ArrangeBoxIR): { before: number; after: number } {
    if (box.centerOn === undefined) return { before: 0, after: 0 };
    const cached = this.#centerPaddings.get(box);
    if (cached !== undefined) return cached;
    const vertical = box.kind === "stack";
    const order =
      box.direction === "up" || box.direction === "left" ? [...box.items].reverse() : box.items;
    let cursor = 0;
    let center = 0;
    for (const item of order) {
      const size = this.#itemSize(item);
      const length = vertical ? size.height : size.width;
      cursor += this.#lead(item);
      if (item === box.centerOn) {
        const body = this.#bodyRect(box.centerOn, { x: 0, y: 0, ...size });
        center = cursor + (vertical ? body.y + body.height / 2 : body.x + body.width / 2);
      } else if (
        item !== null &&
        typeof item !== "string" &&
        item.growFirst === true &&
        item.items[0] === box.centerOn
      ) {
        // Caption expansion wraps a direct group item in a generated stack.
        this.#placeBox(item, { x: 0, y: 0, ...size }, "center", (key, rect) => {
          if (key === box.centerOn)
            center = cursor + (vertical ? rect.y + rect.height / 2 : rect.x + rect.width / 2);
        });
      }
      cursor += length + this.#trail(item) + this.#gap(box);
    }
    const length = cursor - this.#gap(box);
    const padding = {
      before: Math.max(0, length - 2 * center),
      after: Math.max(0, 2 * center - length),
    };
    this.#centerPaddings.set(box, padding);
    return padding;
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
        Math.max(content.width, label === undefined ? 0 : Math.ceil(label.width)) +
        p.west +
        p.east +
        groupLayerSpread(group),
      height:
        content.height +
        p.north +
        p.south +
        (this.#titleAbove(group) > 0 ? 0 : this.#labelSpace(label, group)) +
        groupLayerSpread(group),
    };
  }

  /** The room (units) a title above the border (#517) takes outside the frame, or 0. */
  #titleAbove(group: GroupIR): number {
    const label = this.#labels.get(group.key);
    if (label === undefined || group.labelAt?.startsWith("above") !== true) return 0;
    return Math.ceil(label.height) + this.#padOf(group) / 2;
  }

  /**
   * Height a group's label band takes above (or below) its content: the label
   * and half the padding between it and the content.
   */
  #labelSpace(label: TextMetrics | undefined, group: GroupIR): number {
    return label === undefined ? 0 : Math.ceil(label.height) + this.#padOf(group) / 2;
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

  /** Union of natural footprints around the authored centers, without grid quantization. */
  #placeBounds(box: ArrangeBoxIR): Rect {
    const rects = box.items.map((item, i) =>
      this.#coordinateRect(item, box.positionsPt?.[i] ?? [0, 0], box.bodyCentered?.[i] === true),
    );
    const x = Math.min(...rects.map((r) => r.x));
    const y = Math.min(...rects.map((r) => r.y));
    return {
      x,
      y,
      width: Math.max(...rects.map((r) => r.x + r.width)) - x,
      height: Math.max(...rects.map((r) => r.y + r.height)) - y,
    };
  }

  /** Center a node/group body; its badge or caption still contributes to the footprint. */
  #coordinateRect(
    item: ArrangeItemIR,
    [x, y]: readonly [number, number],
    withoutAttached = false,
  ): Rect {
    const size = this.#itemSize(item);
    let body = { x: 0, y: 0, ...size };
    if (typeof item === "string") {
      body = this.#bodyRect(item, body);
      // #517: a group's frame grows to hold the nodes attached to it; the
      // body is the frame without that room.
      const room = withoutAttached ? this.#overhangs.get(item) : undefined;
      if (room !== undefined) {
        body = {
          x: body.x + room.west,
          y: body.y + room.north,
          width: body.width - room.west - room.east,
          height: body.height - room.north - room.south,
        };
      }
    } else if (item?.growFirst === true) {
      const key = item.items[0];
      this.#placeBox(item, body, "center", (k, rect) => {
        if (k === key) body = rect;
      });
    }
    return { x: x * 2 - body.x - body.width / 2, y: y * 2 - body.y - body.height / 2, ...size };
  }

  #placeCoordinates(
    box: ArrangeBoxIR,
    frame: Rect,
    visit: (key: ElementKey, rect: Rect) => void,
  ): void {
    const bounds = this.#placeBounds(box);
    box.items.forEach((item, i) => {
      const local = this.#coordinateRect(
        item,
        box.positionsPt?.[i] ?? [0, 0],
        box.bodyCentered?.[i] === true,
      );
      const rect = {
        ...local,
        x: frame.x + (frame.width - bounds.width) / 2 - bounds.x + local.x,
        y: frame.y + (frame.height - bounds.height) / 2 - bounds.y + local.y,
      };
      if (typeof item === "string") visit(item, this.#bodyRect(item, rect));
      else if (item !== null) this.#placeBox(item, rect, "center", visit);
    });
  }

  /** Single-column maxima first, then distribute spanning deficits in document order. */
  #gridTracks(box: ArrangeBoxIR): GridTracks {
    const cached = this.#grids.get(box);
    if (cached !== undefined) return cached;
    const columns = box.columns as number;
    const widths: number[] = Array(columns).fill(0);
    const heights: number[] = [];
    const leading: number[] = Array(columns).fill(0);
    const trailing: number[] = Array(columns).fill(0);
    const columnGap = box.columnGapPt === undefined ? this.#defaultGap : box.columnGapPt * 2;
    const rowGap = box.rowGapPt === undefined ? this.#defaultGap : box.rowGapPt * 2;
    let cursor = 0;
    const cells = box.items.map((item, i) => {
      const span = box.spans?.[i] ?? 1;
      const column = cursor % columns;
      const row = Math.floor(cursor / columns);
      const size = this.#itemSize(item);
      const body =
        typeof item === "string"
          ? this.#bodyRect(item, { x: 0, y: 0, ...size })
          : { x: 0, y: 0, ...size };
      const centerX = body.x + body.width / 2;
      const centerY = body.y + body.height / 2;
      leading[column] = Math.max(leading[column] ?? 0, body.x);
      const last = column + span - 1;
      trailing[last] = Math.max(trailing[last] ?? 0, size.width - body.x - body.width);
      const trackWidth =
        (box.align ?? "center") === "center"
          ? 2 * Math.max(centerX, size.width - centerX)
          : size.width;
      const trackHeight = 2 * Math.max(centerY, size.height - centerY);
      heights[row] = Math.max(heights[row] ?? 0, trackHeight);
      if (span === 1) widths[column] = Math.max(widths[column] ?? 0, trackWidth);
      cursor += span;
      return { item, span, column, row, size, trackWidth };
    });
    if (box.align === "start" || box.align === "end") {
      for (const cell of cells) {
        const body =
          typeof cell.item === "string"
            ? this.#bodyRect(cell.item, { x: 0, y: 0, ...cell.size })
            : { x: 0, y: 0, ...cell.size };
        cell.trackWidth =
          box.align === "start"
            ? (leading[cell.column] ?? 0) + cell.size.width - body.x
            : (trailing[cell.column + cell.span - 1] ?? 0) + body.x + body.width;
        if (cell.span === 1)
          widths[cell.column] = Math.max(widths[cell.column] ?? 0, cell.trackWidth);
      }
    }
    for (const cell of cells) {
      if (cell.span === 1) continue;
      const available =
        widths.slice(cell.column, cell.column + cell.span).reduce((a, b) => a + b, 0) +
        columnGap * (cell.span - 1);
      const extra = Math.max(0, cell.trackWidth - available) / cell.span;
      for (let c = cell.column; c < cell.column + cell.span; c++)
        widths[c] = (widths[c] ?? 0) + extra;
    }
    const tracks = {
      widths,
      heights,
      leading,
      trailing,
      columnGap,
      rowGap,
      cells,
      size: {
        width: widths.reduce((a, b) => a + b, 0) + columnGap * (columns - 1),
        height: heights.reduce((a, b) => a + b, 0) + rowGap * (heights.length - 1),
      },
    };
    this.#grids.set(box, tracks);
    return tracks;
  }

  #placeGrid(box: ArrangeBoxIR, frame: Rect, visit: (key: ElementKey, rect: Rect) => void): void {
    const tracks = this.#gridTracks(box);
    const xs = [frame.x + (frame.width - tracks.size.width) / 2];
    const ys = [frame.y + (frame.height - tracks.size.height) / 2];
    for (const w of tracks.widths) xs.push((xs.at(-1) as number) + w + tracks.columnGap);
    for (const h of tracks.heights) ys.push((ys.at(-1) as number) + h + tracks.rowGap);
    for (const [index, cell] of tracks.cells.entries()) {
      if (cell.item === null) continue;
      // A cell's own align (#517) replaces the grid's for this cell.
      const align = box.cellAligns?.[index] ?? box.align ?? "center";
      const available =
        tracks.widths.slice(cell.column, cell.column + cell.span).reduce((a, b) => a + b, 0) +
        tracks.columnGap * (cell.span - 1);
      const width =
        align === "stretch" && this.#stretchable(cell.item, true) ? available : cell.size.width;
      let offset =
        align === "start" ? 0 : align === "end" ? available - width : (available - width) / 2;
      let yOffset = ((tracks.heights[cell.row] as number) - cell.size.height) / 2;
      if (typeof cell.item === "string") {
        const body = this.#bodyRect(cell.item, { x: 0, y: 0, width, height: cell.size.height });
        if (align === "center") offset = available / 2 - body.x - body.width / 2;
        if (align === "start") offset = (tracks.leading[cell.column] ?? 0) - body.x;
        if (align === "end")
          offset =
            available - (tracks.trailing[cell.column + cell.span - 1] ?? 0) - body.x - body.width;
        yOffset = (tracks.heights[cell.row] as number) / 2 - body.y - body.height / 2;
      } else if (align === "start") {
        offset = tracks.leading[cell.column] ?? 0;
      } else if (align === "end") {
        offset = available - (tracks.trailing[cell.column + cell.span - 1] ?? 0) - width;
      }
      const rect = {
        x: (xs[cell.column] as number) + offset,
        y: (ys[cell.row] as number) + yOffset,
        width,
        height: cell.size.height,
      };
      if (typeof cell.item === "string") visit(cell.item, this.#bodyRect(cell.item, rect));
      else this.#placeBox(cell.item, rect, "center", visit);
    }
  }

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
    if (box.kind === "chat") {
      const geometry = this.#chatGeometry(box);
      this.#chatFrames.set(box, {
        x: frame.x + (frame.width - geometry.size.width) / 2,
        y: frame.y + (frame.height - geometry.size.height) / 2,
        ...geometry.size,
      });
      for (const [key, local] of geometry.rects)
        visit(
          key,
          this.#bodyRect(key, {
            ...local,
            x: frame.x + (frame.width - geometry.size.width) / 2 + local.x,
            y: frame.y + (frame.height - geometry.size.height) / 2 + local.y,
          }),
        );
      return;
    }
    if (box.kind === "place") {
      this.#placeCoordinates(box, frame, visit);
      return;
    }
    if (box.kind === "grid") {
      this.#placeGrid(box, frame, visit);
      return;
    }
    const align = box.align ?? inherited;
    const vertical = box.kind === "stack";
    const reversed = box.direction === "up" || box.direction === "left";
    const order = reversed ? [...box.items].reverse() : box.items;
    const natural = this.#boxSize(box);
    let gap = this.#gap(box);
    // Extra main-axis room (from a stretching parent) centers the items; a
    // caption's stack (#130) gives it to its group instead (`growFirst`).
    const extra = vertical ? frame.height - natural.height : frame.width - natural.width;
    let grow = box.growFirst === true ? Math.max(0, extra) : 0;
    const growers =
      box.justify === "stretch" && grow === 0
        ? order.filter((item) => this.#growable(item, vertical))
        : [];
    const rawWeight = (item: ArrangeItemIR) =>
      typeof item === "string" ? (this.#nodes.get(item)?.grow ?? 1) : 1;
    // Normalize first so even very small positive YAML weights stay finite.
    const maxWeight = growers.reduce((max, item) => Math.max(max, rawWeight(item)), 0) || 1;
    const weight = (item: ArrangeItemIR) => rawWeight(item) / maxWeight;
    const totalWeight = growers.reduce((sum, item) => sum + weight(item), 0);
    // Apportion whole D2 units (0.5pt), largest remainder first. `order`
    // is visual order, including for up/left, and breaks equal remainders.
    const budget = totalWeight > 0 ? Math.floor(Math.max(0, extra)) : 0;
    const shares = growers.map((item, index) => {
      const exact = (budget * weight(item)) / totalWeight;
      return { item, index, units: Math.floor(exact), remainder: exact - Math.floor(exact) };
    });
    const remainder = budget - shares.reduce((sum, share) => sum + share.units, 0);
    const ranked = [...shares].sort((a, b) => b.remainder - a.remainder || a.index - b.index);
    for (const share of ranked.slice(0, remainder)) share.units++;
    const additions = new Map(shares.map(({ item, units }) => [item, units]));
    const between = box.justify === "space-between" && order.length > 1 && grow === 0;
    if (between) gap += Math.max(0, extra) / (order.length - 1);
    let cursor =
      (vertical ? frame.y : frame.x) +
      this.#centerPadding(box).before +
      (grow > 0 || between ? 0 : totalWeight > 0 ? (extra - budget) / 2 : extra / 2);
    const crossAvailable = vertical ? frame.width : frame.height;
    const crossPadding =
      align === "start" || align === "end"
        ? Math.max(
            0,
            ...order.map((item) => {
              if (typeof item !== "string") return 0;
              const size = this.#itemSize(item);
              const body = this.#bodyRect(item, { x: 0, y: 0, ...size });
              const start = vertical ? body.x : body.y;
              const end = start + (vertical ? body.width : body.height);
              return align === "start" ? start : (vertical ? size.width : size.height) - end;
            }),
          )
        : 0;
    for (const item of order) {
      if (item === null) continue;
      const itemNatural = this.#itemSize(item);
      const added = grow + (additions.get(item) ?? 0);
      const size = vertical
        ? { ...itemNatural, height: itemNatural.height + added }
        : { ...itemNatural, width: itemNatural.width + added };
      grow = 0;
      const crossNatural = vertical ? size.width : size.height;
      const separator =
        typeof item === "string" && this.#nodes.get(item)?.component === SEPARATOR_ID;
      const cross =
        separator || (align === "stretch" && this.#stretchable(item, vertical))
          ? crossAvailable
          : crossNatural;
      let offset =
        separator || align === "start" || (align === "stretch" && cross === crossAvailable)
          ? 0
          : align === "end"
            ? crossAvailable - cross
            : (crossAvailable - cross) / 2;
      if (align === "center" && typeof item === "string" && !separator) {
        const body = this.#bodyRect(item, { x: 0, y: 0, ...size });
        const center = vertical ? body.x + body.width / 2 : body.y + body.height / 2;
        offset = crossAvailable / 2 - center;
      }
      if ((align === "start" || align === "end") && !separator) {
        const body =
          typeof item === "string"
            ? this.#bodyRect(item, { x: 0, y: 0, ...size })
            : { x: 0, y: 0, ...size };
        const start = vertical ? body.x : body.y;
        const end = start + (vertical ? body.width : body.height);
        offset = align === "start" ? crossPadding - start : crossAvailable - crossPadding - end;
      }
      cursor += this.#lead(item);
      const rect: Rect = vertical
        ? { x: frame.x + offset, y: cursor, width: cross, height: size.height }
        : { x: cursor, y: frame.y + offset, width: size.width, height: cross };
      if (typeof item === "string") visit(item, this.#bodyRect(item, rect));
      else this.#placeBox(item, rect, item.kind === box.kind ? align : "center", visit);
      cursor += (vertical ? size.height : size.width) + gap + this.#trail(item);
    }
  }

  /** Measure and place chat visuals through the same natural-footprint contract. */
  #chatGeometry(box: ArrangeBoxIR) {
    return chatGeometry(
      box,
      (key) => this.#itemSize(key),
      (key) => this.#nodes.get(key),
      this.#defaultGap,
      (key, rect) => this.#bodyRect(key, rect),
    );
  }

  /** Main-axis growth is opt-in; badged boxes retain their reserved footprint. */
  #growable(item: ArrangeItemIR, vertical: boolean): boolean {
    if (item === null) return false;
    if (typeof item !== "string") return true;
    const node = this.#nodes.get(item);
    if (node === undefined) return true;
    if (node.component === SEPARATOR_ID) return false;
    if ((vertical ? node.height : node.width) !== undefined || node.sizing === "fixed-aspect-1")
      return false;
    // Only these outline contracts support independent main-axis growth.
    if (node.render !== undefined)
      return ["sumi/bowtie", "sumi/trapezoid"].includes(node.render.renderer);
    return stretchableShape(node.shape);
  }

  /** Whether `stretch` resizes an item on the cross axis of a stack (`vertical`) or row. */
  #stretchable(item: ArrangeItemIR, vertical: boolean): boolean {
    if (typeof item !== "string") return true;
    const node = this.#nodes.get(item);
    if (node === undefined) return true;
    const explicit = vertical ? node.width : node.height;
    // Outline components keep their footprint: stretching changes the
    // renderer's safe area (e.g. a taller trapezoid has deeper slants).
    return (
      explicit === undefined &&
      node.render === undefined &&
      node.badge === undefined &&
      node.glyphs === undefined &&
      stretchableShape(node.shape)
    );
  }

  /** Convert the reserved badge footprint to the body's own box. */
  #bodyRect(key: ElementKey, rect: Rect): Rect {
    const extra = this.#badgeOverhangs.get(key);
    if (extra === undefined) return rect;
    return {
      x: rect.x + extra.west,
      y: rect.y + extra.north,
      width: rect.width - extra.west - extra.east,
      height: rect.height - extra.north - extra.south,
    };
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
    rect = groupFrontRect(group, rect);
    const p = this.#padding(key);
    const band = this.#titleAbove(group) > 0 ? 0 : this.#labelSpace(this.#labels.get(key), group);
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
      const targetBody = rects.get(to) as Rect;
      const extra = this.#badgeOverhangs.get(to) ?? NO_OVERHANG;
      const target = {
        x: targetBody.x - extra.west,
        y: targetBody.y - extra.north,
        width: targetBody.width + extra.west + extra.east,
        height: targetBody.height + extra.north + extra.south,
      };
      rects.set(
        node.key,
        this.#bodyRect(
          node.key,
          attachedRect(target, this.#attachedSize(node, target, side), side, gapPt * 2),
        ),
      );
    }
  }

  /**
   * The size of an attached node. A bracket (#281) gathers its target, so
   * unless it has an explicit length it is as long as the target's side it is
   * attached to (its depth stays its own).
   */
  #attachedSize(node: NodeIR, target: Rect, side: AttachSide): Size {
    const size = this.#itemSize(node.key);
    if (node.render?.renderer !== "sumi/bracket") return size;
    if (side === "east" || side === "west") {
      return { width: size.width, height: node.height?.units ?? target.height };
    }
    if (side === "north" || side === "south") {
      return { width: node.width?.units ?? target.width, height: size.height };
    }
    return size;
  }

  /**
   * What hangs outside a node's body: its corner badge and glyphs (#408),
   * and a caption below its frame (#491), centred under the body with its
   * line box {@link captionGap} below it.
   */
  #decorations(node: NodeIR, body: Rect): Rect[] {
    const caption = this.#captionRect(node, body);
    return [...decorationRects(node, body), ...(caption === undefined ? [] : [caption])];
  }

  /** The box of a node's caption below its frame (#491), `body` being the frame. */
  #captionRect(node: NodeIR, body: Rect): Rect | undefined {
    const caption = this.#captions.get(node.key);
    if (caption === undefined) return undefined;
    return {
      x: body.x + (body.width - caption.width) / 2,
      y: body.y + body.height + caption.gap,
      width: caption.width,
      height: caption.height,
    };
  }

  #attachedRects(container: Container, rects: Map<ElementKey, Rect>): Rect[] {
    return (this.#attached.get(container) ?? []).flatMap((node) => {
      const rect = rects.get(node.key);
      return rect === undefined ? [] : [rect, ...this.#decorations(node, rect)];
    });
  }

  #group(key: ElementKey): GroupIR {
    const group = this.#groups.get(key);
    if (group === undefined)
      throw new Error(`internal error: ${key} is neither a node nor a group`);
    return group;
  }

  // --- Result ----------------------------------------------------------------

  /**
   * Where the text block of a node goes. The block is centered in the node,
   * but a left or right `textAlign` on a node wider than its text (a fixed
   * `width`, a stretched box) moves the whole block to that side of the
   * padded node, so the alignment shows (#519). Rectangular nodes only.
   */
  #alignedCenter(
    node: NodeIR,
    rect: Rect,
    center: { x: number; y: number },
    metrics: TextMetrics,
    sublabel: TextMetrics | undefined,
  ): { x: number; y: number } {
    const side = node.textAlign;
    const plain = node.shape === "rectangle" || node.shape === "text" || node.shape === "square";
    if ((side !== "left" && side !== "right") || !plain || node.render !== undefined) return center;
    if (node.labelRotation !== undefined || this.#captions.has(node.key)) return center;
    const block = Math.max(metrics.width, sublabel?.width ?? 0);
    const inset = node.shape === "text" ? 0 : this.#nodePaddingX;
    // A node only as wide as its text (the size is rounded up to a whole unit) keeps its center.
    if (rect.width - (block + 2 * inset) <= 1) return center;
    const x =
      side === "left" ? rect.x + inset + block / 2 : rect.x + rect.width - inset - block / 2;
    // Never move toward the middle: a node as wide as its text keeps its center.
    return side === "left"
      ? { ...center, x: Math.min(center.x, x) }
      : { ...center, x: Math.max(center.x, x) };
  }

  #result(): LayoutIR {
    const labels = new Map<ElementKey, TextLayout>();
    const sublabels = new Map<ElementKey, TextLayout>();
    for (const node of this.#ir.nodes) {
      const metrics = this.#labels.get(node.key);
      const rect = this.#rect(node.key);
      if (metrics === undefined) continue;
      const caption = this.#captions.get(node.key);
      const center =
        caption === undefined
          ? nodeLabelCenter(node, rect)
          : {
              x: rect.x + rect.width / 2,
              y: rect.y + rect.height + caption.gap + caption.height / 2,
            };
      const sublabel = this.#sublabels.get(node.key);
      const anchored = this.#alignedCenter(node, rect, center, metrics, sublabel);
      if (sublabel === undefined) {
        labels.set(node.key, placeText(metrics, anchored, node.labelRotation, node.textAlign));
        continue;
      }
      const placed = placeTextBlock(
        metrics,
        sublabel,
        anchored,
        node.labelRotation,
        node.textAlign,
      );
      labels.set(node.key, placed.label);
      sublabels.set(node.key, placed.sublabel);
    }
    for (const group of this.#ir.groups) {
      const metrics = this.#labels.get(group.key);
      const rect = groupFrontRect(group, this.#rect(group.key));
      if (metrics !== undefined) {
        labels.set(group.key, placeText(metrics, this.#groupLabelCenter(group, rect, metrics)));
      }
    }

    // Set enclosures (#407) are fitted around the placed members; the canvas holds them and their labels.
    const fitted = fitSets(
      this.#ir,
      (key) => this.#rect(key),
      this.#measurer,
      this.#groupPadding,
      (key) => {
        const node = this.#nodes.get(key);
        return node === undefined ? undefined : this.#captionRect(node, this.#rect(key));
      },
    );
    const setBoxes = fitted.flatMap(({ rect, label }) => [
      rect,
      ...(label === undefined
        ? []
        : [
            {
              x: label.center.x - label.metrics.width / 2,
              y: label.center.y - label.metrics.height / 2,
              width: label.metrics.width,
              height: label.metrics.height,
            },
          ]),
    ]);
    const all = [
      ...this.#rects.values(),
      ...setBoxes,
      ...this.#ir.nodes.flatMap((node) => this.#decorations(node, this.#rect(node.key))),
      ...[...labels.values(), ...sublabels.values()].map((label) => label.box),
      ...this.#chatFrames.values(),
    ];
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
      const sublabel = sublabels.get(node.key);
      return {
        key: node.key,
        kind: "node",
        ...(node.parent !== undefined && { parent: node.parent }),
        shape: node.shape,
        rect: shift(this.#rect(node.key)),
        placement: node.attach === undefined ? "arrange" : "attach",
        ...(label !== undefined && { label: shiftText(label) }),
        ...(sublabel !== undefined && { sublabel: shiftText(sublabel) }),
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
        ...(edge.fromAnchor !== undefined && { fromAnchor: copyAnchor(edge.fromAnchor) }),
        ...(edge.toAnchor !== undefined && { toAnchor: copyAnchor(edge.toAnchor) }),
        ...(labelMetrics !== undefined && { labelMetrics }),
      };
    });
    const content = shift({ x: minX, y: minY, width: maxX - minX, height: maxY - minY });
    const shiftPoint = (p: Point): Point => ({ x: roundUnits(p.x + dx), y: roundUnits(p.y + dy) });
    const sets: SetLayout[] = fitted.map(({ set, outline, rect, label }) => {
      const placed: SetOutline =
        outline.kind === "ellipse"
          ? {
              kind: "ellipse",
              cx: shiftPoint({ x: outline.cx, y: outline.cy }).x,
              cy: shiftPoint({ x: outline.cx, y: outline.cy }).y,
              rx: roundUnits(outline.rx),
              ry: roundUnits(outline.ry),
              ...(outline.angle !== undefined && { angle: roundUnits(outline.angle) }),
            }
          : outline.kind === "rect"
            ? { kind: "rect", rect: shift(outline.rect), radius: roundUnits(outline.radius) }
            : {
                kind: "path",
                segments: outline.segments.map((s) =>
                  s.command === "C"
                    ? {
                        command: "C",
                        c1: shiftPoint(s.c1),
                        c2: shiftPoint(s.c2),
                        to: shiftPoint(s.to),
                      }
                    : { command: s.command, to: shiftPoint(s.to) },
                ),
              };
      return {
        id: set.id,
        outline: placed,
        rect: shift(rect),
        ...(label !== undefined && {
          label: shiftText(placeText(label.metrics, label.center)),
        }),
      };
    });
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
      ...(sets.length > 0 && { sets }),
    });
  }

  /**
   * Where a group's label is centered: in the band at the top (or, for a
   * bottom `labelAt`, the bottom) of the group, inside the padding, at the
   * left, centre or right (#127). Omitted `labelAt` is top centre. The frame
   * includes attached members; the arrange tree alone is not the reference (#312).
   */
  #groupLabelCenter(group: GroupIR, rect: Rect, metrics: TextMetrics): { x: number; y: number } {
    const p = this.#padOf(group);
    const at = group.labelAt ?? "top";
    const above = at.startsWith("above");
    const x = at.endsWith("-left")
      ? rect.x + p + metrics.width / 2
      : at.endsWith("-right")
        ? rect.x + rect.width - p - metrics.width / 2
        : rect.x + rect.width / 2;
    const y = above
      ? rect.y - p / 2 - metrics.height / 2
      : labelAtBottom(at)
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
/** A copy of an edge anchor (`straight` is a string, copied as is). */
const copyAnchor = (anchor: EdgeAnchor): EdgeAnchor =>
  typeof anchor === "string" ? anchor : { ...anchor };

function labelAtBottom(at: GroupLabelPosition | undefined): boolean {
  return at === "bottom-left" || at === "bottom" || at === "bottom-right";
}

/** The rectangle of a node of `size` attached to `target` on `side`, `gap` away, centered on that side. */
function attachedRect(target: Rect, size: Size, side: AttachSide, gap: number): Rect {
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
    default:
      return {
        x: side.endsWith("east") ? target.x + target.width + gap : target.x - gap - width,
        y: side.startsWith("north") ? target.y - gap - height : target.y + target.height + gap,
        width,
        height,
      };
  }
}

/** A node's corner badge and glyphs (#408): what hangs over its body's border. */
function decorationRects(node: NodeIR, body: Rect): Rect[] {
  const badge = badgeRect(node, body);
  return [...(badge === undefined ? [] : [badge]), ...glyphRects(node, body)];
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

/**
 * Places measured text centered on `center`, turned by `rotation` (#178)
 * about it: the anchor stays in the label's own frame, the box is the
 * turned one (width and height swapped).
 */
export function placeText(
  metrics: TextMetrics,
  center: { x: number; y: number },
  rotation?: LabelRotation,
  textAlign?: "left" | "center" | "right",
): TextLayout {
  const box: Rect = {
    x: center.x - metrics.width / 2,
    y: center.y - metrics.height / 2,
    width: metrics.width,
    height: metrics.height,
  };
  const halfLeading = (metrics.lineHeightUnits - (metrics.ascentUnits + metrics.descentUnits)) / 2;
  const anchor = {
    x:
      center.x +
      (textAlign === "left" ? -metrics.width / 2 : textAlign === "right" ? metrics.width / 2 : 0),
    y: box.y + halfLeading + metrics.ascentUnits,
  };
  const align = textAlign === undefined || textAlign === "center" ? {} : { textAlign };
  if (rotation === undefined) return { ...metrics, box, anchor, ...align };
  const turned: Rect = {
    x: center.x - metrics.height / 2,
    y: center.y - metrics.width / 2,
    width: metrics.height,
    height: metrics.width,
  };
  return { ...metrics, box: turned, anchor, rotation, ...align };
}

/**
 * The box of a label with its sublabel under it (#184): their line boxes
 * stacked without a gap (like the lines of one label: each line's
 * half-leading spaces them), as wide as the wider. Without a sublabel, the
 * label's own size.
 */
export function textBlock(
  label: TextMetrics,
  sublabel: TextMetrics | undefined,
): { width: number; height: number } {
  if (sublabel === undefined) return { width: label.width, height: label.height };
  return {
    width: Math.max(label.width, sublabel.width),
    height: label.height + sublabel.height,
  };
}

/**
 * Places a label and its sublabel (#184) as one block centered on `center`:
 * the label on top, the sublabel right under it, both centered
 * horizontally. A turned block (#178) turns about `center` as a whole: each
 * text is placed at its turned center and turned about it, which is the
 * same turn (`placeText()`), so `-90` puts the label on the left.
 */
export function placeTextBlock(
  label: TextMetrics,
  sublabel: TextMetrics,
  center: Point,
  rotation?: LabelRotation,
  textAlign?: "left" | "center" | "right",
): { label: TextLayout; sublabel: TextLayout } {
  // Offsets of the two centers from the block's center, before the turn.
  const labelDy = -sublabel.height / 2;
  const sublabelDy = label.height / 2;
  // SVG's rotate(a): (x, y) → (x cos a − y sin a, x sin a + y cos a); for
  // (0, dy) and a = ±90°, (∓dy, 0).
  const at = (dy: number): Point =>
    rotation === undefined
      ? { x: center.x, y: center.y + dy }
      : { x: center.x - Math.sign(rotation) * dy, y: center.y };
  return {
    label: placeText(
      textAlign === undefined || textAlign === "center"
        ? label
        : { ...label, width: Math.max(label.width, sublabel.width) },
      at(labelDy),
      rotation,
      textAlign,
    ),
    sublabel: placeText(
      textAlign === undefined || textAlign === "center"
        ? sublabel
        : { ...sublabel, width: Math.max(label.width, sublabel.width) },
      at(sublabelDy),
      rotation,
      textAlign,
    ),
  };
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
