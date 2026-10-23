/**
 * Figure IR (design doc §6): the immutable, normalized form of an error-free
 * figure that D2 generation (and later stages) work from.
 *
 * Built from a {@link FigureCheck} with no errors: every element is valid, has
 * a resolved component and a resolved style. Elements keep document order:
 * groups, nodes and edges each in the order they are written.
 */

import { type CheckState, type ElementKey, edgeKey, groupKey, nodeKey } from "../core/check-state";
import { type DocPath, hasErrors, type SourceLocation } from "../core/diagnostics";
import type { FigureCheck } from "../core/figure/check";
import type { FigureEdge, FigureGroup, FigureMeta, FigureNode } from "../core/figure/schema";
import { getProfile } from "../core/profile/builtin";
import type {
  Arrowhead,
  ComponentId,
  EdgeDirection,
  NodeShape,
  NodeSizing,
  OutlineRender,
  ResolvedComponent,
} from "../core/registry/manifest";
import { getTheme } from "../core/theme/builtin";
import type { FontSetId } from "../core/theme/fonts";
import type {
  EdgeStyle,
  GroupStyle,
  NodeStyle,
  ResolvedStyle,
  StyleLength,
} from "../core/theme/style";

export type LayoutDirection = FigureMeta["layout"]["direction"];

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
  readonly direction: LayoutDirection;
  readonly fontSetId: FontSetId;
}

interface ElementIRBase {
  readonly key: ElementKey;
  /** Plain-text label; `""` means no label. */
  readonly label: string;
  /** Canonical component ID. */
  readonly component: ComponentId;
  readonly variant: string;
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
  /** Explicit width from props; omitted means sized to the label. */
  readonly width?: StyleLength;
  /** Explicit height from props; omitted means sized to the label. */
  readonly height?: StyleLength;
  readonly style: NodeStyle;
}

export interface GroupIR extends ObjectIRBase {
  readonly kind: "group";
  readonly shape: "rectangle";
  /** Child groups, then child nodes, each in document order. */
  readonly children: readonly ElementKey[];
  readonly style: GroupStyle;
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
}

export type ElementIR = NodeIR | GroupIR | EdgeIR;

export interface FigureIR {
  readonly meta: FigureMetaIR;
  readonly groups: readonly GroupIR[];
  readonly nodes: readonly NodeIR[];
  readonly edges: readonly EdgeIR[];
  /** Top-level groups, then top-level nodes, each in document order. */
  readonly roots: readonly ElementKey[];
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
  const mapSource = (key: ElementKey, path: DocPath) => {
    const location = locate(path);
    sourceMap.set(
      key,
      freeze({
        path: freeze([...path]),
        ...(location !== undefined && { location: freeze({ ...location }) }),
      }),
    );
  };

  const groupsById = new Map<string, FigureGroup>();
  for (const g of present(doc.groups)) groupsById.set(g.id, g);
  const d2PathOf = (prefix: string, id: string, parent: string | undefined): string[] => {
    const ancestors: string[] = [];
    for (let p = parent; p !== undefined; p = groupsById.get(p)?.group) ancestors.unshift(`g_${p}`);
    return [...ancestors, `${prefix}_${id}`];
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
  for (const [index, n] of doc.nodes.entries()) {
    if (n === undefined) continue;
    const key = nodeKey(n.id);
    const component = componentOf(state, key);
    if (component.manifest.kind !== "node") throw kindMismatch(key);
    const { width, height } = component.props;
    nodes.push(
      freeze({
        ...objectBase(key, "n", n),
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
        ...(typeof width === "number" && { width: lengthOf(width) }),
        ...(typeof height === "number" && { height: lengthOf(height) }),
        style: styleOf(state, key, "node"),
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
    });
  });

  const endpointKey = (id: string): ElementKey => (groupsById.has(id) ? groupKey(id) : nodeKey(id));
  const edges: EdgeIR[] = [];
  for (const [index, e] of doc.edges.entries()) {
    if (e === undefined) continue;
    edges.push(edgeIR(state, e, index, endpointKey));
    mapSource(edgeKey(e.id, index), ["edges", index]);
  }

  const elements = readonlyMap([...groups, ...nodes, ...edges].map((e) => [e.key, e] as const));

  return freeze({
    meta: freeze({
      id: figure.id,
      ...(figure.title !== undefined && { title: figure.title }),
      themeId: theme.id,
      profileId: profile.id,
      direction: figure.layout.direction,
      fontSetId: theme.fontSet.id,
    }),
    groups: freeze(groups),
    nodes: freeze(nodes),
    edges: freeze(edges),
    roots: freeze(childrenOf.get(undefined) ?? []),
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
    from: endpointKey(e.from),
    to: endpointKey(e.to),
    direction,
    ...(source && { sourceArrowhead: manifest.tail ?? DEFAULT_ARROWHEAD }),
    ...(target && { targetArrowhead: manifest.head ?? DEFAULT_ARROWHEAD }),
    style: styleOf(state, key, "edge"),
  });
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
