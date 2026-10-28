/**
 * Tokens (#181, design doc §6.50): a `sumi/tokens` node is a sequence of
 * cells (tokens of a sequence, keys of a keyboard cluster, …). It is
 * expanded into one ordinary node per cell, and the tokens node's place in
 * its arrange tree becomes the arrange box that lays the cells out: a row
 * (or a stack) of the cells, or with `lines`, a stack (or a row) of such
 * lines. Nothing is drawn for the tokens node itself, so the expanded figure
 * is exactly the figure an author would write by hand with one node per
 * cell (same arrange boxes, same props), and the later stages (asset, theme,
 * profile, lint, IR, layout, routing) see only ordinary nodes.
 *
 * Each cell has a key: its `id`, or its 1-based position (across the lines)
 * when it has none. It is drawn as the node with the reserved ID
 * `<node>-<key>`, and edge endpoints, `attach.to` and `figure.layout.align`
 * address it as `<node>.<key>` (a cell reference; the earlier stages check
 * only its node). The expansion rewrites every cell reference to the cell's
 * ID. A cell reference whose node is not a tokens node, or whose cell is
 * unknown, is `ref/unknown-cell`; the ID of a tokens node itself names no
 * element, so using it as an endpoint, attach target or align item is
 * `ref/tokens-reference`.
 *
 * Like a legend (#131), the expansion runs after the `component` stage (it
 * needs the validated props), resolves the cells through the same stage,
 * and records each cell's origin (`doc.expanded`), so diagnostics about a
 * cell point at the cell as written. Tokens need the structured engine (the
 * manifest's `engines`) and are placed in an arrange tree, never by `attach`.
 */

import {
  type CheckState,
  type ElementKey,
  type ExpandedOrigin,
  edgeKey,
  groupKey,
  invalidateDependents,
  nodeKey,
} from "../check-state";
import { type DocPath, didYouMean } from "../diagnostics";
import { LEGEND_ID, TOKENS_ID } from "../registry/builtins";
import { componentId, type NodeManifest } from "../registry/manifest";
import type { Registry } from "../registry/registry";
import { isBlankForD2, resolveComponents } from "../registry/resolve";
import type { Tone } from "../theme/tones";
import { recordExpanded, reportReservedId, takenIds } from "./expand";
import { errorAt } from "./report";
import {
  type ArrangeAlign,
  type ArrangeBox,
  type ArrangeItem,
  type FigureNode,
  ID_PATTERN,
  refCell,
  refOwner,
} from "./schema";
import type { Locator } from "./yaml";

/** A cell of `props.cells` / `props.lines`, as validated by the manifest. */
export type TokenCell =
  | string
  | {
      id?: string;
      label?: string;
      tone?: Tone;
      component?: string;
      variant?: string;
      /** pt */
      width?: number;
      /** pt */
      height?: number;
    };

/** The props of a tokens node, as validated by the manifest. */
export interface TokensProps {
  cells?: TokenCell[];
  lines?: TokenCell[][];
  direction: "right" | "left" | "down" | "up";
  /** pt */
  gap?: number;
  align?: ArrangeAlign;
  /** pt */
  lineGap?: number;
  lineAlign?: ArrangeAlign;
  component: string;
  variant?: string;
  /** pt */
  width?: number;
  /** pt */
  height?: number;
}

/** One expanded cell of a tokens node. */
export interface TokensCellExpansion {
  /** The cell's key: its `id`, or its 1-based position. */
  key: string;
  /** The ID of the node it was expanded into: `<tokens>-<key>`. */
  id: string;
  /** `["nodes", i, "props", "cells", j]` or `[…, "lines", l, j]`. */
  path: DocPath;
}

/** A tokens node and what it was expanded into (`doc.tokens`). */
export interface TokensExpansion {
  /** The tokens node's ID: names no element after the expansion. */
  id: string;
  /** Where the tokens node is written: `["nodes", i]`. */
  path: DocPath;
  /** The tokens node's variant (the cells have their own). */
  variant: string;
  cells: TokensCellExpansion[];
}

/** The reserved ID of the cell with key `key` of tokens node `id`. */
export function tokensCellId(id: string, key: string): string {
  return `${id}-${key}`;
}

/** Why a node component cannot draw a cell, or `undefined` if it can. */
function cellProblem(manifest: NodeManifest): string | undefined {
  if (manifest.mark !== undefined) return "is drawn as a fixed mark";
  if (manifest.embed !== undefined) return "embeds an image file";
  const id = componentId(manifest);
  if (id === LEGEND_ID) return "is a legend";
  if (id === TOKENS_ID) return "is a tokens node itself";
  return undefined;
}

interface WrittenCell {
  cell: Exclude<TokenCell, string>;
  /** Where the cell is written. */
  path: DocPath;
  /** The index of its line (0 without lines). */
  line: number;
}

/**
 * Runs the expansion on `state.doc` (see the module comment), then resolves
 * the cell references of edges, attach targets and align constraints.
 * Errors: `layout/attached-tokens` for tokens placed by `attach`,
 * `component/unexpected-label` for tokens with a label,
 * `asset/icon-unsupported` / `component/label-rotation-unsupported` for an
 * icon / `labelRotation`, `component/invalid-prop` for a duplicated cell ID,
 * a cell ID longer than an ID may be or a cell component that cannot draw a
 * cell, and `ref/reserved-id` for an element using a cell's ID. Tokens with
 * an error are not expanded and become invalid (and so does everything
 * referring to their cells, silently).
 */
export function expandTokens(state: CheckState, registry: Registry, locate: Locator): void {
  const { doc, invalid } = state;
  const { groups, nodes, edges } = doc;
  const components = state.components;
  if (groups === undefined || nodes === undefined || edges === undefined) return;
  if (components === undefined) return;
  const structured = doc.figure?.layout.engine === "structured";

  const taken = takenIds(doc);
  // A reserved ID held by an expanded element is reported where that element is written.
  const ownerPath = (path: DocPath): DocPath => {
    if (path[0] !== "nodes" || typeof path[1] !== "number") return path;
    const node = nodes[path[1]];
    return (node && doc.expanded?.get(nodeKey(node.id))?.path) ?? path;
  };
  const added = new Set<ElementKey>();
  const origins: [ElementKey, ExpandedOrigin][] = [];
  const expansions: TokensExpansion[] = [];
  /** Tokens node ID → the arrange item its cells are laid out by. */
  const items = new Map<string, ArrangeItem>();
  /** Tokens nodes that were valid before the expansion (expanded or not). */
  const tokensIds = new Set<string>();

  for (const [index, node] of nodes.entries()) {
    if (node === undefined) continue;
    const key = nodeKey(node.id);
    const component = components.get(key);
    if (component?.id !== TOKENS_ID || invalid.has(key)) continue;
    tokensIds.add(node.id);
    if (!structured) continue;
    const tokensPath: DocPath = ["nodes", index];
    const subject = { kind: "node", id: node.id } as const;
    const fail = (code: string, message: string, at: DocPath, hint: string) => {
      state.diagnostics.push(errorAt(locate, code, message, at, { subject, hint }));
      invalid.add(key);
    };
    if (node.attach !== undefined) {
      fail(
        "layout/attached-tokens",
        `Tokens "${node.id}" are laid out as a row or stack of cells, so they cannot be attached.`,
        [...tokensPath, "attach"],
        "Remove attach and list the tokens node in an arrange tree; attach a node to one of its cells as <node>.<cell> instead.",
      );
      continue;
    }
    if (!isBlankForD2(node.label)) {
      fail(
        "component/unexpected-label",
        `${TOKENS_ID} draws only its cells, so it takes no label.`,
        [...tokensPath, "label"],
        "Remove the label; give the cells labels, or put a title next to the tokens with a label node.",
      );
      continue;
    }
    if (node.icon !== undefined) {
      fail(
        "asset/icon-unsupported",
        `${TOKENS_ID} cannot draw an icon; icons go on plain shapes such as box, circle or label.`,
        [...tokensPath, "icon"],
        "Remove the icon.",
      );
      continue;
    }
    if (node.labelRotation !== undefined) {
      fail(
        "component/label-rotation-unsupported",
        `Tokens "${node.id}" have no label to turn.`,
        [...tokensPath, "labelRotation"],
        "Remove labelRotation.",
      );
      continue;
    }

    const props = component.props as unknown as TokensProps;
    const propsPath: DocPath = [...tokensPath, "props"];
    const written: WrittenCell[] = [];
    const lines = props.lines ?? [props.cells ?? []];
    for (const [l, line] of lines.entries()) {
      for (const [j, cell] of line.entries()) {
        const path: DocPath =
          props.lines === undefined ? [...propsPath, "cells", j] : [...propsPath, "lines", l, j];
        written.push({ cell: typeof cell === "string" ? { label: cell } : cell, path, line: l });
      }
    }

    // 1. Keys: unique, and short enough to make IDs.
    let blocked = false;
    const keys: string[] = [];
    const firstById = new Map<string, DocPath>();
    for (const [n, { cell, path }] of written.entries()) {
      const cellKey = cell.id ?? String(n + 1);
      keys.push(cellKey);
      if (cell.id !== undefined) {
        const first = firstById.get(cell.id);
        if (first !== undefined) {
          fail(
            "component/invalid-prop",
            `Invalid prop "${propName(path)}.id" for ${TOKENS_ID}: cell ID "${cell.id}" is already used by ${propName(first)}.`,
            [...path, "id"],
            "Give each cell of a tokens node its own ID.",
          );
          blocked = true;
          continue;
        }
        firstById.set(cell.id, path);
      }
      const id = tokensCellId(node.id, cellKey);
      if (!ID_PATTERN.test(id)) {
        fail(
          "component/invalid-prop",
          `Invalid prop "${propName(path)}" for ${TOKENS_ID}: the cell is drawn as the node "${id}", which is longer than an ID may be (64 characters).`,
          cell.id !== undefined ? [...path, "id"] : path,
          "Shorten the tokens node's ID or the cell's ID.",
        );
        blocked = true;
      }
    }
    // 2. Every cell's ID must be free.
    for (const [n, { path }] of written.entries()) {
      const id = tokensCellId(node.id, keys[n] as string);
      const owner = taken.get(id);
      const related = { path, message: "The cell is written here." };
      if (owner !== undefined) {
        const reservedFor = `cell ${JSON.stringify(keys[n])} of tokens "${node.id}"`;
        reportReservedId(state, locate, { id, owner: ownerPath(owner), reservedFor, related });
        blocked = true;
      } else if (invalid.has(nodeKey(id)) || invalid.has(groupKey(id))) {
        // An unreadable element may hold the ID: its own error explains the figure.
        blocked = true;
      }
    }
    // 3. Every cell's component must be a shape or text.
    for (const { cell, path } of written) {
      const at: DocPath =
        cell.component !== undefined ? [...path, "component"] : [...propsPath, "component"];
      const resolved = registry.resolve(cell.component ?? props.component, "node");
      if (!resolved.ok) {
        for (const d of resolved.diagnostics) {
          state.diagnostics.push(errorAt(locate, d.code, d.message, at, { subject, hint: d.hint }));
        }
        invalid.add(key);
        blocked = true;
        break;
      }
      if (resolved.value.kind !== "node") continue;
      const problem = cellProblem(resolved.value);
      if (problem === undefined) continue;
      fail(
        "component/invalid-prop",
        `Invalid prop "${propName(at)}" for ${TOKENS_ID}: ${componentId(resolved.value)} ${problem}, so it cannot be a cell.`,
        at,
        "Use a shape such as box or square, or label for a cell without a border (e.g. an ellipsis).",
      );
      blocked = true;
      break;
    }
    if (blocked) {
      invalid.add(key);
      continue;
    }

    // 4. Expand.
    const expansion: TokensExpansion = {
      id: node.id,
      path: tokensPath,
      variant: component.variant,
      cells: [],
    };
    const lineItems: ArrangeItem[][] = lines.map(() => []);
    for (const [n, { cell, path, line }] of written.entries()) {
      const cellKey = keys[n] as string;
      const id = tokensCellId(node.id, cellKey);
      const width = cell.width ?? props.width;
      const height = cell.height ?? props.height;
      const tone = cell.tone ?? node.tone;
      // Written as in a figure: the component stage validates them like any props.
      const cellProps: Record<string, unknown> = {
        ...(width !== undefined && { width: `${width}pt` }),
        ...(height !== undefined && { height: `${height}pt` }),
      };
      const part: FigureNode = {
        id,
        component: cell.component ?? props.component,
        label: cell.label ?? "",
        variant: cell.variant ?? props.variant ?? "default",
        ...(tone !== undefined && { tone }),
        props: cellProps,
        ...(node.group !== undefined && { group: node.group }),
      };
      nodes.push(part);
      const partKey = nodeKey(id);
      added.add(partKey);
      origins.push([
        partKey,
        {
          from: "tokens",
          path,
          subject,
          name: `cell ${JSON.stringify(cellKey)} of tokens "${node.id}"`,
        },
      ]);
      taken.set(id, path);
      expansion.cells.push({ key: cellKey, id, path });
      lineItems[line]?.push(id);
    }
    items.set(node.id, cellsItem(props, lineItems));
    nodes[index] = undefined;
    components.delete(key);
    expansions.push(expansion);
  }

  if (expansions.length > 0) {
    replaceArrangeItems(state, items);
    doc.tokens = expansions;
    recordExpanded(doc, origins);
  }
  resolveCellRefs(state, locate, expansions, tokensIds);
  invalidateDependents(state);
  if (added.size > 0) resolveComponents(state, registry, locate, { only: added });
}

/** `cells[2]` / `lines[0][1]` from a cell's path. */
function propName(path: DocPath): string {
  const at = path.indexOf("props");
  const [field, ...rest] = path.slice(at + 1);
  return `${String(field)}${rest.map((p) => `[${String(p)}]`).join("")}`;
}

/** The arrange box of a single run of cells: the cell itself when it is alone. */
function run(
  direction: TokensProps["direction"],
  gap: number | undefined,
  align: ArrangeAlign | undefined,
  cells: ArrangeItem[],
): ArrangeItem {
  if (cells.length === 1) return cells[0] as ArrangeItem;
  const fields = {
    ...(gap !== undefined && { gap }),
    ...(align !== undefined && { align }),
    items: cells,
  };
  return direction === "right" || direction === "left"
    ? { row: { direction, ...fields } }
    : { stack: { direction, ...fields } };
}

/**
 * The arrange item that lays out a tokens node's cells: one run in
 * `direction`, or with `lines` the runs placed across it (below one another
 * for a row, side by side for a stack), as an author would write them.
 */
function cellsItem(props: TokensProps, lines: ArrangeItem[][]): ArrangeItem {
  const { direction, gap, align } = props;
  const runs = lines.map((cells) => run(direction, gap, align, cells));
  if (props.lines === undefined) return runs[0] as ArrangeItem;
  const across = direction === "right" || direction === "left" ? "down" : "right";
  return run(across, props.lineGap ?? gap, props.lineAlign, runs);
}

/** Replaces every arrange item naming an expanded tokens node with its cells' box. */
function replaceArrangeItems(state: CheckState, items: ReadonlyMap<string, ArrangeItem>): void {
  const { doc } = state;
  const replace = (box: ArrangeBox): ArrangeBox => {
    const kind = box.stack !== undefined ? "stack" : "row";
    const spec = box[kind];
    if (spec === undefined) return box;
    let changed = false;
    const next = spec.items.map((item): ArrangeItem => {
      if (typeof item === "string") {
        const replacement = items.get(item);
        if (replacement === undefined) return item;
        changed = true;
        return replacement;
      }
      const inner = replace(item);
      if (inner !== item) changed = true;
      return inner;
    });
    return changed ? ({ [kind]: { ...spec, items: next } } as ArrangeBox) : box;
  };
  const figure = doc.figure;
  const root = figure?.layout.arrange;
  if (figure !== undefined && root !== undefined) {
    const arrange = replace(root);
    if (arrange !== root) doc.figure = { ...figure, layout: { ...figure.layout, arrange } };
  }
  for (const [index, group] of (doc.groups ?? []).entries()) {
    if (group?.arrange === undefined) continue;
    const arrange = replace(group.arrange);
    if (arrange !== group.arrange && doc.groups) doc.groups[index] = { ...group, arrange };
  }
}

/**
 * Rewrites every cell reference (`<node>.<cell>`) of an edge endpoint, an
 * attach target and an align item to the cell's ID, and reports references
 * that name no cell (`ref/unknown-cell`) or a tokens node itself
 * (`ref/tokens-reference`). A reference to tokens that were not expanded
 * (they have an error of their own) is left to `invalidateDependents()`.
 */
function resolveCellRefs(
  state: CheckState,
  locate: Locator,
  expansions: readonly TokensExpansion[],
  tokensIds: ReadonlySet<string>,
): void {
  const { doc, invalid } = state;
  const cells = new Map<string, Map<string, string>>();
  for (const expansion of expansions) {
    cells.set(expansion.id, new Map(expansion.cells.map((c) => [c.key, c.id])));
  }
  const ownerInvalid = (id: string) => invalid.has(nodeKey(id)) || invalid.has(groupKey(id));

  /**
   * The ID `ref` stands for, `ref` unchanged when it needs nothing, or
   * `undefined` after reporting an error.
   */
  const resolve = (
    ref: string,
    at: DocPath,
    subject: { kind: "edge" | "node" | "figure"; id: string },
    what: string,
  ): string | undefined => {
    const owner = refOwner(ref);
    const cell = refCell(ref);
    const tokens = cells.get(owner);
    if (cell === undefined) {
      if (tokens === undefined) return ref;
      state.diagnostics.push(
        errorAt(
          locate,
          "ref/tokens-reference",
          `"${owner}" is a tokens node, which is drawn as its cells, so it cannot be ${what}.`,
          at,
          {
            subject,
            hint: `Name one of its cells as <node>.<cell>, e.g. "${owner}.${tokens.keys().next().value ?? "1"}".`,
          },
        ),
      );
      return undefined;
    }
    const id = tokens?.get(cell);
    if (id !== undefined) return id;
    // Tokens with an error of their own (not expanded): the reference just depends on them.
    if (tokens === undefined && (tokensIds.has(owner) || ownerInvalid(owner))) return ref;
    state.diagnostics.push(
      errorAt(
        locate,
        "ref/unknown-cell",
        tokens === undefined
          ? `"${ref}" names a cell, but "${owner}" is not a tokens node.`
          : `Unknown cell "${cell}" of tokens "${owner}" in ${subject.kind === "figure" ? "figure.layout.align" : `${subject.kind} ${subject.kind === "edge" ? subject.id : `"${subject.id}"`}`}.`,
        at,
        {
          subject,
          hint:
            tokens === undefined
              ? `Only the cells of a tokens node are named as <node>.<cell>; name the element itself as "${owner}".`
              : `A cell is named by its id, or by its 1-based position when it has none.${didYouMean(cell, tokens.keys()) === undefined ? "" : ` ${didYouMean(cell, tokens.keys())}`}`,
        },
      ),
    );
    return undefined;
  };

  // Edge endpoints.
  for (const [index, edge] of (doc.edges ?? []).entries()) {
    if (edge === undefined) continue;
    const key = edgeKey(edge.id, index);
    if (invalid.has(key)) continue;
    const subject = { kind: "edge", id: edge.id ?? `edges[${index}]` } as const;
    const from = resolve(edge.from, ["edges", index, "from"], subject, "an edge's source");
    const to = resolve(edge.to, ["edges", index, "to"], subject, "an edge's target");
    if (from === undefined || to === undefined) {
      invalid.add(key);
      continue;
    }
    if (from !== edge.from || to !== edge.to) {
      (doc.edges ?? [])[index] = { ...edge, from, to };
    }
  }
  // Attach targets.
  for (const [index, node] of (doc.nodes ?? []).entries()) {
    if (node?.attach === undefined) continue;
    const key = nodeKey(node.id);
    if (invalid.has(key)) continue;
    const subject = { kind: "node", id: node.id } as const;
    const to = resolve(node.attach.to, ["nodes", index, "attach", "to"], subject, "attached to");
    if (to === undefined) {
      invalid.add(key);
      continue;
    }
    if (to !== node.attach.to) {
      (doc.nodes ?? [])[index] = { ...node, attach: { ...node.attach, to } };
    }
  }
  // Align constraints: about the figure, so they invalidate nothing.
  const figure = doc.figure;
  const align = figure?.layout.align;
  if (figure === undefined || align === undefined) return;
  let changed = false;
  const subject = { kind: "figure", id: figure.id } as const;
  const next = align.map((constraint, index) => {
    const axis = constraint.x !== undefined ? "x" : "y";
    const list = constraint[axis] ?? [];
    const resolved = list.map(
      (ref, i) =>
        resolve(ref, ["figure", "layout", "align", index, axis, i], subject, "aligned") ?? ref,
    );
    if (resolved.every((id, i) => id === list[i])) return constraint;
    changed = true;
    return { ...constraint, [axis]: resolved };
  });
  if (changed) doc.figure = { ...figure, layout: { ...figure.layout, align: next } };
}
