/**
 * Figure IR (design doc §6): the immutable, normalized form of an error-free
 * figure that D2 generation (and later stages) work from.
 *
 * Built from a {@link FigureCheck} with no errors: every element is valid, has
 * a resolved component and a resolved style. Elements keep document order:
 * groups, nodes and edges each in the order they are written.
 */

import { parseIconRef } from "../assets/icon-ref";
import {
  type CheckState,
  type ElementKey,
  edgeKey,
  groupKey,
  nodeKey,
  type PartialFigure,
} from "../core/check-state";
import { type DocPath, hasErrors, type SourceLocation } from "../core/diagnostics";
import type { FigureCheck } from "../core/figure/check";
import { type EdgeAnchor, parseAnchor } from "../core/figure/layout";
import type {
  AlignConstraint,
  AlignPosition,
  ArrangeAlign,
  ArrangeBox,
  ArrangeItem,
  EdgeLabelPosition,
  EdgeLabelSide,
  FanInMode,
  FigureEdge,
  FigureFit,
  FigureGroup,
  FigureMeta,
  FigureNode,
  GroupLabelPosition,
  LabelRotation,
  LayoutDensity,
  LayoutEngine,
  Side,
} from "../core/figure/schema";
import { nodeOrder } from "../core/figure/tokens";
import { getProfile } from "../core/profile/builtin";
import { spacedProfile } from "../core/profile/schema";

import {
  type Arrowhead,
  type ComponentId,
  type EdgeDirection,
  type EdgeRouting,
  IMAGE_FITS,
  markText,
  type NodeMark,
  type NodeShape,
  type NodeSizing,
  type OutlineRender,
  type ResolvedComponent,
} from "../core/registry/manifest";
import { getTheme } from "../core/theme/builtin";
import type { FontSetId } from "../core/theme/fonts";
import {
  type EdgeStyle,
  type GroupStyle,
  type NodeStyle,
  type ResolvedStyle,
  type StyleLength,
  sublabelFontSize,
} from "../core/theme/style";

export type LayoutDirection = FigureMeta["layout"]["direction"];

export type ImageFit = (typeof IMAGE_FITS)[number];

/** Where an element is written in the source document. */
export interface SourceMapEntry {
  readonly path: DocPath;
  readonly location?: SourceLocation;
}

export type SourceMap = ReadonlyMap<ElementKey, SourceMapEntry>;

export interface FigureMetaIR {
  readonly id: string;
  readonly title?: string;
  readonly themeId: string;
  readonly profileId: string;
  /** `figure.fit` (#183): `scale` shrinks the output to the profile's width. Absent when not written. */
  readonly fit?: FigureFit;
  readonly direction: LayoutDirection;
  /** Layout engine (design doc §6.19); `direction` applies to `auto` only. */
  readonly engine: LayoutEngine;
  /** Structured layout: `figure.layout.fanIn` (#134). Absent when not written (merge). */
  readonly fanIn?: FanInMode;
  /** Structured layout: `figure.layout.density` (#182). Absent when not written (normal). */
  readonly density?: LayoutDensity;
  readonly fontSetId: FontSetId;
}

/**
 * One box of a structured arrange tree (design doc §6.19), with element IDs
 * resolved to keys. `gapPt` and `align` stay `undefined` when omitted: the
 * layout engine supplies the defaults (§6.21).
 */
export interface ArrangeBoxIR {
  readonly kind: "stack" | "row" | "grid";
  /** Grid-only track count, spans (parallel to items), and gaps in pt. */
  readonly columns?: number;
  readonly spans?: readonly number[];
  readonly rowGapPt?: number;
  readonly columnGapPt?: number;
  /** stack: `down` | `up`; row: `right` | `left`. */
  readonly direction: "down" | "up" | "right" | "left";
  /** Space between items in pt, as written; omitted means the profile default. */
  readonly gapPt?: number;
  /** Cross-axis alignment, as written; omitted inherits (same axis only). */
  readonly align?: ArrangeAlign;
  readonly items: readonly ArrangeItemIR[];
  /**
   * Set only on the stack a group's caption is expanded into (#130): extra
   * main-axis room (from a row that stretches its items) goes to the first
   * item, the group, instead of centring the items.
   */
  readonly growFirst?: true;
}

/** An item of an arrange box: a node or group, a nested box, or a blank grid cell. */
export type ArrangeItemIR = ElementKey | ArrangeBoxIR | null;

/**
 * One constraint of `figure.layout.align` (#132, design doc §6.31), with the
 * IDs resolved to keys: the structured engine places the items so that their
 * `at` coordinate on `axis` is equal.
 */
export interface AlignIR {
  /** `y`: one horizontal line (equal y); `x`: one vertical line. */
  readonly axis: "x" | "y";
  /** The coordinate made equal; omitted in the source means `center`. */
  readonly at: AlignPosition;
  /** Nodes or groups, as written (at least two, each once). */
  readonly items: readonly ElementKey[];
  /** Where the constraint is written (`figure.layout.align[i]`), for diagnostics. */
  readonly srcAt: SourceMapEntry;
}

/** `nodes[].sublabel` (#184): its text and the font size it is drawn at. */
export interface SublabelIR {
  /** As written: newlines break lines, label math is allowed. */
  readonly text: string;
  /** {@link sublabelFontSize} of the node's font size. */
  readonly fontSize: StyleLength;
}

/** `nodes[].attach` with the target resolved to a key. */
export interface AttachIR {
  readonly to: ElementKey;
  readonly side: Side;
  /** Space between the target and the node in pt (0 when omitted). */
  readonly gapPt: number;
}

interface ElementIRBase {
  readonly key: ElementKey;
  /** Plain-text label; `""` means no label. */
  readonly label: string;
  /** Canonical component ID. */
  readonly component: ComponentId;
  readonly variant: string;
  /**
   * Set on the frame group of a legend and on every part it was expanded
   * into (#131, design doc §6.34): the legend node's ID, and how messages
   * name this element (e.g. `the sample line of entry 1 of legend "key"`).
   */
  readonly legend?: LegendPartIR;
  /**
   * Set on every node a tokens node was expanded into (#181, design doc
   * §6.50): the tokens node's ID and variant, and how messages name this
   * cell (e.g. `cell "a1" of tokens "seq"`).
   */
  readonly tokens?: TokensCellIR;
  /**
   * Set on the frame group of a matrix and on every part it was expanded
   * into (#180, design doc §6.56): the matrix node's ID and variant, how
   * messages name this element (e.g. `cell 2, 3 (class "o") of matrix
   * "mask"`) and, for a part, where its fields are written.
   */
  readonly matrix?: TokensCellIR;
}

/** See {@link ElementIRBase.tokens} and {@link ElementIRBase.matrix}. */
export interface TokensCellIR {
  /** The ID of the tokens node (which names no element of its own), or of the matrix. */
  readonly id: string;
  /** The tokens or matrix node's variant. */
  readonly variant: string;
  readonly name: string;
  /**
   * Where each field of the cell's node is written, by its path relative to
   * the node (see `TokensCellExpansion.fields`), so that diagnostics about
   * the cell point at the written field.
   */
  readonly fields: Readonly<Record<string, DocPath>>;
}

/** See {@link ElementIRBase.legend}. */
export interface LegendPartIR {
  /** The ID of the legend node (also its frame group's ID). */
  readonly id: string;
  readonly name: string;
}

/** A node or group: a D2 object addressed by its path through the group tree. */
interface ObjectIRBase extends ElementIRBase {
  readonly id: string;
  /** Containing group, or `undefined` at the root. */
  readonly parent?: ElementKey;
  /** D2 key of this object alone, e.g. `n_api` (§2.4). */
  readonly d2Key: string;
  /** D2 keys from the root down to this object, e.g. `["g_backend", "n_api"]`. */
  readonly d2Path: readonly string[];
}

export interface NodeIR extends ObjectIRBase {
  readonly kind: "node";
  readonly shape: NodeShape;
  readonly sizing: NodeSizing;
  /** Fixed, validated outline metadata; omitted for ordinary D2 shapes. */
  readonly render?: Readonly<OutlineRender>;
  /**
   * The manifest's mark (#92): the node is drawn as a glyph or a point, its
   * `label` is the glyph (or `""`) and `width` / `height` are the mark's size.
   */
  readonly mark?: Readonly<NodeMark>;
  /** Outline width/height were both generated at render time, not written in props. */
  readonly autoSized?: boolean;
  /** Explicit width from props or a mark's size; omitted means sized to the label. */
  readonly width?: StyleLength;
  /** Explicit height from props or a mark's size; omitted means sized to the label. */
  readonly height?: StyleLength;
  readonly style: NodeStyle;
  /** Structured layout: placed beside another element instead of in an arrange tree. */
  readonly attach?: AttachIR;
  /**
   * The label is drawn turned by this many degrees about its center (#178),
   * positive clockwise as SVG's `rotate()`. Structured layout only.
   */
  readonly labelRotation?: LabelRotation;
  /**
   * A second, smaller text drawn under the label (#184, design doc §6.51),
   * at `sublabelFontSize(style.fontSize)` in the label's font. Structured
   * layout only.
   */
  readonly sublabel?: SublabelIR;
  /** A bundled icon drawn in place of the label (#94); the node has no label. */
  readonly icon?: IconIR;
  /** The image a `sumi/image` node embeds (#94); the node has no label. */
  readonly image?: ImageIR;
  /**
   * The group whose `caption` this label node was expanded from (#130). Its
   * ID is `<group>-caption`; it has the group's parent.
   */
  readonly captionOf?: ElementKey;
}

/** `icon: <set>/<name>`, checked against the bundled sets. */
export interface IconIR {
  readonly set: string;
  readonly name: string;
}

/** An image node's props.src, sha256 and fit, as written (the file is read when rendering). */
export interface ImageIR {
  /** Relative to the figure's directory, `/`-separated (checked by the `asset` stage). */
  readonly src: string;
  /** Lowercase hex, if written. */
  readonly sha256?: string;
  readonly fit: ImageFit;
  /** Total copies and the up-right step; dimensions size one copy, not the stack. */
  readonly layers?: { readonly count: number; readonly offset: StyleLength };
  /** Where `props.src` is written, for diagnostics about the file. */
  readonly srcAt: SourceMapEntry;
}

export interface GroupIR extends ObjectIRBase {
  readonly kind: "group";
  readonly shape: "rectangle";
  /** Child groups, then child nodes, each in document order. */
  readonly children: readonly ElementKey[];
  readonly style: GroupStyle;
  /** Structured layout: the arrange tree of the group's children. */
  readonly arrange?: ArrangeBoxIR;
  /**
   * Where the label sits inside the border (#127). Absent when not written:
   * each engine keeps its default (structured: top, auto: top-left).
   */
  readonly labelAt?: GroupLabelPosition;
  /** The label node expanded from the group's `caption` (#130). */
  readonly caption?: ElementKey;
}

export interface EdgeIR extends ElementIRBase {
  readonly kind: "edge";
  /** User ID; edges without one are identified by `index`. */
  readonly id?: string;
  /** Index in the document's `edges`. */
  readonly index: number;
  readonly from: ElementKey;
  readonly to: ElementKey;
  readonly direction: EdgeDirection;
  /** Arrowhead at the source end; set exactly when `direction` is `backward` or `both`. */
  readonly sourceArrowhead?: Arrowhead;
  /** Arrowhead at the target end; set exactly when `direction` is `forward` or `both`. */
  readonly targetArrowhead?: Arrowhead;
  readonly style: EdgeStyle;
  /** Structured layout: where the edge leaves the source (`straight`: in line with the target, #179). */
  readonly fromAnchor?: EdgeAnchor;
  /** Structured layout: where the edge enters the target (`straight`: in line with the source, #179). */
  readonly toAnchor?: EdgeAnchor;
  /** Structured layout: where along the route the label sits (#128). Absent when not written. */
  readonly labelAt?: EdgeLabelPosition;
  /** Structured layout: the side of the line, facing from source to target (#128). Absent when not written. */
  readonly labelSide?: EdgeLabelSide;
  /**
   * The manifest's `routing` (#176): `zoom` joins corners of the two ends
   * with straight lines instead of a routed path. Absent for a routed edge.
   */
  readonly routing?: EdgeRouting;
}

export type ElementIR = NodeIR | GroupIR | EdgeIR;

export interface FigureIR {
  readonly meta: FigureMetaIR;
  readonly groups: readonly GroupIR[];
  readonly nodes: readonly NodeIR[];
  readonly edges: readonly EdgeIR[];
  /** Top-level groups, then top-level nodes, each in document order. */
  readonly roots: readonly ElementKey[];
  /** Structured layout: the arrange tree of the root-level elements (`figure.layout.arrange`). */
  readonly arrange?: ArrangeBoxIR;
  /** Structured layout: `figure.layout.align` (#132); absent when not written. */
  readonly align?: readonly AlignIR[];
  readonly elements: ReadonlyMap<ElementKey, ElementIR>;
  readonly sourceMap: SourceMap;
}

/** Arrowhead D2 draws when a manifest leaves an arrow end unspecified. */
const DEFAULT_ARROWHEAD: Arrowhead = "triangle";

/**
 * Builds the IR from a completed check (`checkFigure`). Throws if the check
 * has errors or is incomplete: generation stages only run on error-free input
 * (design doc §0).
 */
export function buildFigureIR(check: FigureCheck): FigureIR {
  const { state, locate } = check;
  if (hasErrors(state.diagnostics)) {
    throw new Error("internal error: cannot build the figure IR from a check with errors");
  }
  const { doc } = state;
  const figure = doc.figure;
  const theme = figure && getTheme(figure.theme);
  const profile = figure && getProfile(figure.profile);
  if (!figure || !theme || !profile || !doc.groups || !doc.nodes || !doc.edges) {
    throw new Error("internal error: incomplete figure without error diagnostics");
  }

  const sourceMap = new Map<ElementKey, SourceMapEntry>();
  const sourceEntry = (path: DocPath): SourceMapEntry => {
    const location = locate(path);
    return freeze({
      path: freeze([...path]),
      ...(location !== undefined && { location: freeze({ ...location }) }),
    });
  };
  // An expanded element (a caption, #130; a legend's part, #131; a tokens cell, #181) maps to the field it stands for.
  const mapSource = (key: ElementKey, path: DocPath) =>
    sourceMap.set(key, sourceEntry(doc.expanded?.get(key)?.path ?? path));

  const groupsById = new Map<string, FigureGroup>();
  for (const g of present(doc.groups)) groupsById.set(g.id, g);
  const endpointKey = (id: string): ElementKey => (groupsById.has(id) ? groupKey(id) : nodeKey(id));
  // Group ID → its caption node's ID (#130).
  const captions = new Map<string, string>();
  for (const [index, origin] of doc.captions ?? []) {
    const node = doc.nodes[index];
    if (node !== undefined) captions.set(origin.group, node.id);
  }
  const auto = figure.layout.engine === "auto";
  // In D2, a captioned group is drawn inside a container that is its
  // caption node (design doc §6.32): the caption's key comes before the group's.
  const d2KeysOfGroup = (id: string): string[] => {
    const caption = auto ? captions.get(id) : undefined;
    return caption === undefined ? [`g_${id}`] : [`n_${caption}`, `g_${id}`];
  };
  const d2PathOf = (prefix: "n" | "g", id: string, parent: string | undefined): string[] => {
    const ancestors: string[] = [];
    for (let p = parent; p !== undefined; p = groupsById.get(p)?.group) {
      ancestors.unshift(...d2KeysOfGroup(p));
    }
    return [...ancestors, ...(prefix === "g" ? d2KeysOfGroup(id) : [`n_${id}`])];
  };
  const objectBase = (
    key: ElementKey,
    prefix: "n" | "g",
    element: FigureGroup | FigureNode,
  ): ObjectIRBase => {
    const component = componentOf(state, key);
    return {
      key,
      id: element.id,
      label: element.label,
      component: component.id,
      variant: component.variant,
      ...legendPartOf(doc, key),
      ...tokensCellOf(doc, key),
      ...matrixPartOf(doc, key),
      ...(element.group !== undefined && { parent: groupKey(element.group) }),
      d2Key: `${prefix}_${element.id}`,
      d2Path: freeze(d2PathOf(prefix, element.id, element.group)),
    };
  };

  const childrenOf = new Map<string | undefined, ElementKey[]>();
  const addChild = (parent: string | undefined, key: ElementKey) => {
    const list = childrenOf.get(parent) ?? [];
    list.push(key);
    childrenOf.set(parent, list);
  };

  const groupEntries = present(doc.groups.map((g, index) => g && { g, index }));
  for (const { g, index } of groupEntries) {
    mapSource(groupKey(g.id), ["groups", index]);
    addChild(g.group, groupKey(g.id));
  }

  const nodes: NodeIR[] = [];
  const captionGapPt = spacedProfile(profile, figure.layout.density).layout.groupPadding.pt / 2;
  const attachTarget = (attach: NonNullable<FigureNode["attach"]>): ElementKey => {
    // Below a captioned group is its caption: attach there instead (#130).
    const caption = attach.side === "south" ? captions.get(attach.to) : undefined;
    return caption === undefined ? endpointKey(attach.to) : nodeKey(caption);
  };
  const arrangeOf = (box: ArrangeBox) => arrangeIR(box, endpointKey, captions, captionGapPt);

  // Document order, with the cells of tokens nodes (#181) in their tokens node's place.
  for (const index of nodeOrder(doc)) {
    const n = doc.nodes[index];
    if (n === undefined) continue;
    const key = nodeKey(n.id);
    const caption = doc.captions?.get(index);
    const component = componentOf(state, key);
    if (component.manifest.kind !== "node") throw kindMismatch(key);
    const { width, height } = component.props;
    const style = styleOf(state, key, "node");
    const { mark } = component.manifest;
    const markSize = mark && markSizeOf(mark, style);
    nodes.push(
      freeze({
        ...objectBase(key, "n", n),
        ...(mark !== undefined && { label: markLabel(mark, component.props) }),
        kind: "node",
        shape: component.manifest.shape,
        sizing: component.manifest.sizing,
        ...(component.manifest.render !== undefined && {
          render: freeze({
            ...component.manifest.render,
            ...(component.manifest.render.params !== undefined && {
              params: freeze({ ...component.manifest.render.params }),
            }),
          }),
        }),
        ...(mark !== undefined && { mark: freezeMark(mark) }),
        ...(typeof width === "number" && { width: lengthOf(width) }),
        ...(typeof height === "number" && { height: lengthOf(height) }),
        ...(markSize !== undefined && { width: markSize, height: markSize }),
        style,
        ...(n.attach !== undefined && {
          attach: freeze({
            to: attachTarget(n.attach),
            side: n.attach.side,
            gapPt: n.attach.gap ?? 0,
          }),
        }),
        ...(n.labelRotation !== undefined && { labelRotation: n.labelRotation }),
        ...(n.sublabel !== undefined && {
          sublabel: freeze({ text: n.sublabel, fontSize: sublabelFontSize(style.fontSize) }),
        }),
        ...(n.icon !== undefined && { icon: iconIR(n.icon) }),
        ...(component.manifest.embed === "image" && {
          image: imageIR(component.props, sourceEntry(["nodes", index, "props", "src"])),
        }),
        ...(caption !== undefined && { captionOf: groupKey(caption.group) }),
      }),
    );
    mapSource(key, ["nodes", index]);
    addChild(n.group, key);
  }

  const groups: GroupIR[] = groupEntries.map(({ g }) => {
    const key = groupKey(g.id);
    if (componentOf(state, key).manifest.kind !== "group") throw kindMismatch(key);
    return freeze({
      ...objectBase(key, "g", g),
      kind: "group",
      shape: "rectangle",
      children: freeze(childrenOf.get(g.id) ?? []),
      style: styleOf(state, key, "group"),
      ...(g.arrange !== undefined && { arrange: arrangeOf(g.arrange) }),
      ...(g.labelAt !== undefined && { labelAt: g.labelAt }),
      ...(captions.has(g.id) && { caption: nodeKey(captions.get(g.id) as string) }),
    });
  });

  const edges: EdgeIR[] = [];
  for (const [index, e] of doc.edges.entries()) {
    if (e === undefined) continue;
    edges.push(edgeIR(state, e, index, endpointKey, legendPartOf(doc, edgeKey(e.id, index))));
    mapSource(edgeKey(e.id, index), ["edges", index]);
  }

  const elements = readonlyMap([...groups, ...nodes, ...edges].map((e) => [e.key, e] as const));

  return freeze({
    meta: freeze({
      id: figure.id,
      ...(figure.title !== undefined && { title: figure.title }),
      themeId: theme.id,
      profileId: profile.id,
      ...(figure.fit !== undefined && { fit: figure.fit }),
      direction: figure.layout.direction,
      engine: figure.layout.engine,
      ...(figure.layout.fanIn !== undefined && { fanIn: figure.layout.fanIn }),
      ...(figure.layout.density !== undefined && { density: figure.layout.density }),
      fontSetId: theme.fontSet.id,
    }),
    groups: freeze(groups),
    nodes: freeze(nodes),
    edges: freeze(edges),
    roots: freeze(childrenOf.get(undefined) ?? []),
    ...(figure.layout.arrange !== undefined && {
      arrange: arrangeOf(figure.layout.arrange),
    }),
    ...(figure.layout.align !== undefined && {
      align: freeze(
        figure.layout.align.map((c, index) =>
          alignIR(c, endpointKey, sourceEntry(["figure", "layout", "align", index])),
        ),
      ),
    }),
    elements,
    sourceMap: readonlyMap(sourceMap),
  });
}

/**
 * A map that cannot be changed: a frozen object over a private `Map`, with
 * only the reading methods. (`Object.freeze` on a `Map` itself would not stop
 * `set`, `delete` or `clear`.)
 */
class ReadonlyMapView<K, V> implements ReadonlyMap<K, V> {
  readonly #map: Map<K, V>;

  constructor(entries: Iterable<readonly [K, V]>) {
    this.#map = new Map(entries);
    Object.freeze(this);
  }

  get size(): number {
    return this.#map.size;
  }

  get(key: K): V | undefined {
    return this.#map.get(key);
  }

  has(key: K): boolean {
    return this.#map.has(key);
  }

  forEach(callback: (value: V, key: K, map: ReadonlyMap<K, V>) => void, thisArg?: unknown): void {
    for (const [key, value] of this.#map) callback.call(thisArg, value, key, this);
  }

  keys() {
    return this.#map.keys();
  }

  values() {
    return this.#map.values();
  }

  entries() {
    return this.#map.entries();
  }

  [Symbol.iterator]() {
    return this.#map.entries();
  }
}

/** An immutable map with the given entries, in order. */
export function readonlyMap<K, V>(entries: Iterable<readonly [K, V]>): ReadonlyMap<K, V> {
  return new ReadonlyMapView(entries);
}

function edgeIR(
  state: CheckState,
  e: FigureEdge,
  index: number,
  endpointKey: (id: string) => ElementKey,
  legend: { legend?: LegendPartIR },
): EdgeIR {
  const key = edgeKey(e.id, index);
  const component = componentOf(state, key);
  const { manifest } = component;
  if (manifest.kind !== "edge") throw kindMismatch(key);
  const { direction } = manifest;
  const source = direction === "backward" || direction === "both";
  const target = direction === "forward" || direction === "both";
  return freeze({
    key,
    kind: "edge",
    ...(e.id !== undefined && { id: e.id }),
    index,
    label: e.label,
    component: component.id,
    variant: component.variant,
    ...legend,
    from: endpointKey(e.from),
    to: endpointKey(e.to),
    direction,
    ...(source && { sourceArrowhead: manifest.tail ?? DEFAULT_ARROWHEAD }),
    ...(target && { targetArrowhead: manifest.head ?? DEFAULT_ARROWHEAD }),
    style: styleOf(state, key, "edge"),
    ...anchorIR("fromAnchor", e.fromAnchor),
    ...anchorIR("toAnchor", e.toAnchor),
    ...(e.labelAt !== undefined && { labelAt: e.labelAt }),
    ...(e.labelSide !== undefined && { labelSide: e.labelSide }),
    ...(manifest.routing !== undefined && { routing: manifest.routing }),
  });
}

function anchorIR<F extends "fromAnchor" | "toAnchor">(
  field: F,
  value: string | undefined,
): Partial<Record<F, EdgeAnchor>> {
  if (value === undefined) return {};
  // The layout stage reports malformed anchors, so an error-free figure has none.
  const anchor = parseAnchor(value);
  if (anchor === undefined) throw new Error(`internal error: invalid anchor "${value}"`);
  return { [field]: typeof anchor === "string" ? anchor : freeze(anchor) } as Partial<
    Record<F, EdgeAnchor>
  >;
}

/**
 * Converts an arrange tree (checked by the layout stage) to its IR. A
 * captioned group (#130, design doc §6.32) becomes a stack of the group and
 * its caption node, `captionGapPt` apart. The stack centres the caption under
 * the group; in a stack that stretches its items, it stretches too, so the
 * group keeps the width it has without a caption; in a row that stretches
 * its items, the extra height goes to the group (`growFirst`), so the group
 * keeps that height too, its caption below. `inherited` is the
 * alignment the layout engine gives a box that omits `align` (§6.21: only
 * from a box on the same axis).
 */
function arrangeIR(
  box: ArrangeBox,
  keyOf: (id: string) => ElementKey,
  captions: ReadonlyMap<string, string>,
  captionGapPt: number,
  inherited: ArrangeAlign = "center",
): ArrangeBoxIR {
  const spec = box.stack ?? box.row ?? box.grid;
  if (spec === undefined) throw new Error("internal error: arrange box without stack, row or grid");
  const kind = box.stack !== undefined ? "stack" : box.row !== undefined ? "row" : "grid";
  const align = spec.align ?? (kind === "grid" ? "center" : inherited);
  const item = (item: ArrangeItem | null): ArrangeItemIR => {
    if (item === null) return null;
    if (typeof item !== "string") {
      const nested = item.stack !== undefined ? "stack" : item.row !== undefined ? "row" : "grid";
      return arrangeIR(item, keyOf, captions, captionGapPt, nested === kind ? align : "center");
    }
    const caption = captions.get(item);
    if (caption === undefined) return keyOf(item);
    return freeze({
      kind: "stack",
      direction: "down",
      gapPt: captionGapPt,
      align: (kind === "stack" || kind === "grid") && align === "stretch" ? "stretch" : "center",
      items: freeze([keyOf(item), nodeKey(caption)]),
      growFirst: true,
    });
  };
  if (box.grid !== undefined) {
    const grid = box.grid;
    return freeze({
      kind: "grid",
      direction: "right",
      columns: grid.columns,
      ...(grid.rowGap !== undefined && { rowGapPt: grid.rowGap }),
      ...(grid.columnGap !== undefined && { columnGapPt: grid.columnGap }),
      ...(grid.align !== undefined && { align: grid.align }),
      spans: freeze(
        grid.items.map((c) =>
          c !== null && typeof c === "object" && "item" in c ? (c.span ?? 1) : 1,
        ),
      ),
      items: freeze(
        grid.items.map((c) =>
          item(c !== null && typeof c === "object" && "item" in c ? c.item : c),
        ),
      ),
    });
  }
  const linear = box.stack ?? box.row;
  if (linear === undefined) throw new Error("internal error: missing linear box");
  return freeze({
    kind,
    direction: linear.direction,
    ...(linear.gap !== undefined && { gapPt: linear.gap }),
    ...(spec.align !== undefined && { align: spec.align }),
    items: freeze(linear.items.map(item)),
  });
}

/** Converts an align constraint (checked by the layout stage) to its IR. */
function alignIR(
  constraint: AlignConstraint,
  keyOf: (id: string) => ElementKey,
  srcAt: SourceMapEntry,
): AlignIR {
  const axis = constraint.x !== undefined ? "x" : "y";
  return freeze({
    axis,
    at: constraint.at ?? "center",
    items: freeze((constraint[axis] ?? []).map(keyOf)),
    srcAt,
  });
}

/** `{ legend }` for the frame or a part of a legend (#131), otherwise `{}`. */
function legendPartOf(doc: PartialFigure, key: ElementKey): { legend?: LegendPartIR } {
  const origin = doc.expanded?.get(key);
  if (origin?.from !== "legend") return {};
  return { legend: freeze({ id: origin.subject.id, name: origin.name }) };
}

/** `{ tokens }` for a cell of a tokens node (#181), otherwise `{}`. */
function tokensCellOf(doc: PartialFigure, key: ElementKey): { tokens?: TokensCellIR } {
  const origin = doc.expanded?.get(key);
  if (origin?.from !== "tokens") return {};
  const id = origin.subject.id;
  const expansion = doc.tokens?.find((t) => t.id === id);
  const variant = expansion?.variant ?? "default";
  const fields = expansion?.cells.find((c) => nodeKey(c.id) === key)?.fields ?? {};
  return { tokens: freeze({ id, variant, name: origin.name, fields: freeze({ ...fields }) }) };
}

/** `{ matrix }` for the frame or a part of a matrix (#180), otherwise `{}`. */
function matrixPartOf(doc: PartialFigure, key: ElementKey): { matrix?: TokensCellIR } {
  const origin = doc.expanded?.get(key);
  if (origin?.from !== "matrix") return {};
  const id = origin.subject.id;
  const expansion = doc.matrices?.find((m) => m.id === id);
  const variant = expansion?.variant ?? "default";
  const fields = expansion?.parts.find((p) => nodeKey(p.id) === key)?.fields ?? {};
  return { matrix: freeze({ id, variant, name: origin.name, fields: freeze({ ...fields }) }) };
}

function componentOf(state: CheckState, key: ElementKey): ResolvedComponent {
  const component = state.components?.get(key);
  if (component === undefined) throw new Error(`internal error: ${key} has no component`);
  return component;
}

function styleOf<K extends ResolvedStyle["kind"]>(
  state: CheckState,
  key: ElementKey,
  kind: K,
): Extract<ResolvedStyle, { kind: K }> {
  const style = state.styles?.get(key);
  if (style?.kind !== kind) throw new Error(`internal error: ${key} has no ${kind} style`);
  return style as Extract<ResolvedStyle, { kind: K }>;
}

/**
 * The width and height of a mark (manifest `mark`, #92): `size` times the
 * resolved font size (glyph) or stroke width (point), rounded to whole D2
 * units, at least one.
 */
export function markSizeOf(mark: NodeMark, style: NodeStyle): StyleLength {
  const basis = mark.type === "glyph" ? style.fontSize : style.strokeWidth;
  const units = Math.max(1, Math.round(mark.size * basis.units));
  return freeze({ pt: units / 2, units });
}

/** The text a mark draws: the glyph for the prop's value, or nothing for a point. */
function markLabel(mark: NodeMark, props: Record<string, unknown>): string {
  const text = markText(mark, props);
  if (text === undefined) throw new Error("internal error: the props select no glyph");
  return text;
}

function freezeMark(mark: NodeMark): Readonly<NodeMark> {
  return mark.type === "glyph"
    ? freeze({ ...mark, glyphs: freeze({ ...mark.glyphs }) })
    : freeze({ ...mark });
}

function iconIR(ref: string): IconIR {
  const parsed = parseIconRef(ref);
  if (parsed === undefined) throw new Error(`internal error: malformed icon "${ref}"`);
  return freeze(parsed);
}

function imageIR(props: Record<string, unknown>, srcAt: SourceMapEntry): ImageIR {
  const { src, sha256, fit = "contain" } = props;
  const layers = props.layers as { count: number; offset: number } | undefined;
  // The registry checks src is a string prop and fit one of IMAGE_FITS (manifest `embed`).
  if (typeof src !== "string" || !(IMAGE_FITS as readonly unknown[]).includes(fit)) {
    throw new Error("internal error: image props without src or with an unknown fit");
  }
  return freeze({
    src,
    ...(typeof sha256 === "string" && { sha256: sha256.toLowerCase() }),
    fit: fit as ImageFit,
    ...(layers !== undefined && {
      layers: freeze({ count: layers.count, offset: lengthOf(layers.offset) }),
    }),
    srcAt,
  });
}

/** A size prop in pt (an exact multiple of 0.5pt, checked by the manifest). */
function lengthOf(pt: number): StyleLength {
  return freeze({ pt, units: pt * 2 });
}

function kindMismatch(key: ElementKey): Error {
  return new Error(`internal error: ${key} resolved to a component of another kind`);
}

function present<T>(list: readonly (T | undefined)[]): T[] {
  return list.filter((item): item is T => item !== undefined);
}

function freeze<T>(value: T): T {
  return Object.freeze(value);
}
