/**
 * Stage `layout`: checks the structured-layout fields of a figure (#88,
 * design doc §6.19) and normalizes group membership.
 *
 * - With the `auto` engine, every structured-only field (`figure.layout.arrange`,
 *   `figure.layout.align`, `figure.layout.fanIn` (#134),
 *   `figure.layout.density` (#182),
 *   `group.arrange`, `node.attach`, `node.sublabel` (#184),
 *   `node.labelRotation` (#178), `edge.fromAnchor` / `toAnchor`,
 *   `edge.labelAt` / `labelSide` (#128)) is an error: it would otherwise be
 *   ignored silently.
 * - With the `structured` engine, every node and group must be placed exactly
 *   once: as an item of one arrange tree (`figure.layout.arrange` for the root,
 *   `groups[].arrange` for a group's children) or by `attach`. An item of a
 *   group's arrange tree is a child of that group; an attached node has the
 *   parent of its target. When `group:` is omitted it is filled in from the
 *   placement, so later stages see the membership; when it is written and
 *   disagrees, that is an error.
 * - The constraints of `figure.layout.align` (#132) list at least two known
 *   nodes or groups, each once. Whether they can be met is up to the layout
 *   engine (`layout/unsatisfied-align`).
 *
 * Like every check stage (see `check-state.ts`), elements that are already
 * invalid get no new diagnostics, and elements that depend on an invalid one
 * (its children, nodes attached to it) become invalid silently. The trees and
 * attachments of invalid elements still count as placements, so their items
 * are not reported as unplaced. Errors invalidate the element they are about
 * (the placed element, the attached node, the edge with a bad anchor), never
 * the arrange tree's owner: an unknown ID in a group's arrange tree does not
 * make the group's other children unusable.
 */

import {
  type CheckState,
  type ElementKey,
  edgeKey,
  groupKey,
  invalidateDependents,
  nodeKey,
} from "../check-state";
import type { Diagnostic, DiagnosticSubject, DocPath, SourceLocation } from "../diagnostics";
import { closestMatch, didYouMean } from "../diagnostics";
import { errorAt, relatedAt } from "./report";
import {
  type ArrangeBox,
  type FigureGroup,
  type FigureNode,
  refOwner,
  SIDES,
  type Side,
} from "./schema";
import type { Locator } from "./yaml";

/** A parsed edge anchor. */
export interface Anchor {
  side: Side;
  /** 0..1 along the side: left → right on north/south, top → bottom on east/west. */
  offset: number;
}

/**
 * `straight` (#179, design doc §6.47): the end sits in line with the other
 * end, on the side facing it, so the edge enters (or leaves) straight. The
 * router works out the side and the position after placement.
 */
export const STRAIGHT_ANCHOR = "straight";

/** An edge anchor as written: a side and position, or {@link STRAIGHT_ANCHOR}. */
export type EdgeAnchor = Anchor | typeof STRAIGHT_ANCHOR;

/**
 * Parses `"south"` / `"south:0.25"` / `"straight"`; `undefined` if malformed
 * (see `ANCHOR_PATTERN`).
 */
export function parseAnchor(value: string): EdgeAnchor | undefined {
  if (value === STRAIGHT_ANCHOR) return STRAIGHT_ANCHOR;
  const match = /^([a-z]+)(?::(\d+(?:\.\d+)?))?$/.exec(value);
  if (match === null) return undefined;
  const side = match[1] as Side;
  if (!SIDES.includes(side)) return undefined;
  if (match[2] === undefined) return { side, offset: 0.5 };
  const offset = Number(match[2]);
  if (!/^(0(\.\d+)?|1(\.0+)?)$/.test(match[2]) || offset > 1) return undefined;
  return { side, offset };
}

interface Element {
  kind: "node" | "group";
  value: FigureNode | FigureGroup;
  path: DocPath;
  key: ElementKey;
  subject: DiagnosticSubject;
}

/** One place where an element is placed: an arrange item or an `attach`. */
interface Occurrence {
  id: string;
  /** The arrange item, or the node's `attach` field. */
  path: DocPath;
  via: "arrange" | "attach";
  /** arrange: the group whose tree lists the item (`undefined` = root). */
  owner?: string | undefined;
  /**
   * The tree's owner (arrange) or the attached node (attach) was invalid
   * before this stage: the occurrence counts as a placement but is not
   * reported on.
   */
  silent: boolean;
  /** attach: the target. */
  target?: string;
  location: SourceLocation | undefined;
  order: number;
}

type Push = (diagnostic: Diagnostic, key?: ElementKey) => void;

const STRUCTURED_HINT =
  'The structured layout is selected by figure.layout.arrange or "engine: structured"; otherwise remove this field.';

/** Runs the `layout` stage on `state.doc`. */
export function checkLayout(state: CheckState, locate: Locator): void {
  const { doc } = state;
  const figure = doc.figure;
  // Without a readable `figure`, the engine is unknown: nothing to check.
  if (figure === undefined) return;
  if (figure.layout.engine === "auto") checkAuto(state, locate);
  else checkStructured(state, locate);
  invalidateDependents(state);
}

/** `auto`: every structured-only field of a valid element is an error. */
function checkAuto(state: CheckState, locate: Locator): void {
  const { doc, invalid } = state;
  const report = (field: string, path: DocPath, key?: ElementKey, subject?: DiagnosticSubject) => {
    state.diagnostics.push(
      errorAt(
        locate,
        "layout/structured-only",
        `"${field}" needs the structured layout engine, but this figure uses the auto engine.`,
        path,
        { atKey: true, subject, hint: STRUCTURED_HINT },
      ),
    );
    if (key !== undefined) invalid.add(key);
  };
  if (doc.figure?.layout.arrange !== undefined) {
    report("arrange", ["figure", "layout", "arrange"]);
  }
  if (doc.figure?.layout.align !== undefined) {
    report("align", ["figure", "layout", "align"]);
  }
  if (doc.figure?.layout.fanIn !== undefined) {
    report("fanIn", ["figure", "layout", "fanIn"]);
  }
  if (doc.figure?.layout.density !== undefined) {
    report("density", ["figure", "layout", "density"]);
  }
  for (const [index, group] of (doc.groups ?? []).entries()) {
    if (group?.arrange === undefined || invalid.has(groupKey(group.id))) continue;
    const subject = { kind: "group", id: group.id } as const;
    report("arrange", ["groups", index, "arrange"], groupKey(group.id), subject);
  }
  for (const [index, node] of (doc.nodes ?? []).entries()) {
    if (node === undefined || invalid.has(nodeKey(node.id))) continue;
    const subject = { kind: "node", id: node.id } as const;
    for (const field of ["attach", "sublabel", "labelRotation"] as const) {
      if (node[field] !== undefined) {
        report(field, ["nodes", index, field], nodeKey(node.id), subject);
      }
    }
  }
  for (const [index, edge] of (doc.edges ?? []).entries()) {
    if (edge === undefined || invalid.has(edgeKey(edge.id, index))) continue;
    const subject = { kind: "edge", id: edge.id ?? `edges[${index}]` } as const;
    for (const field of ["fromAnchor", "toAnchor", "labelAt", "labelSide"] as const) {
      if (edge[field] !== undefined) {
        report(field, ["edges", index, field], edgeKey(edge.id, index), subject);
      }
    }
  }
}

function checkStructured(state: CheckState, locate: Locator): void {
  const { doc, invalid } = state;
  const push: Push = (diagnostic, key) => {
    state.diagnostics.push(diagnostic);
    if (key !== undefined) invalid.add(key);
  };

  // Readable nodes and groups: every definition, and by ID the first one
  // (duplicated IDs are already `ref/duplicate-id` and invalid).
  const elements = new Map<string, Element>();
  const groupEntries: Element[] = [];
  const nodeEntries: Element[] = [];
  for (const [index, group] of (doc.groups ?? []).entries()) {
    if (group === undefined) continue;
    const entry: Element = {
      kind: "group",
      value: group,
      path: ["groups", index],
      key: groupKey(group.id),
      subject: { kind: "group", id: group.id },
    };
    groupEntries.push(entry);
    if (!elements.has(group.id)) elements.set(group.id, entry);
  }
  for (const [index, node] of (doc.nodes ?? []).entries()) {
    if (node === undefined) continue;
    const entry: Element = {
      kind: "node",
      value: node,
      path: ["nodes", index],
      key: nodeKey(node.id),
      subject: { kind: "node", id: node.id },
    };
    nodeEntries.push(entry);
    if (!elements.has(node.id)) elements.set(node.id, entry);
  }
  const isInvalidId = (id: string) => invalid.has(nodeKey(id)) || invalid.has(groupKey(id));
  // An ID is unknown only if both collections are readable (an unreadable
  // element with a string ID is in `invalid`, so it counts as known).
  const collectionsReadable = doc.nodes !== undefined && doc.groups !== undefined;
  // "Not placed" needs every arrange tree: none may be in an unreadable element.
  const everyTreeReadable =
    collectionsReadable && !doc.groups?.includes(undefined) && !doc.nodes?.includes(undefined);
  const elementIds = [...elements.keys()];
  const unknownHint = (id: string) =>
    (doc.edges ?? []).some((e) => e?.id === id)
      ? `"${id}" is an edge; only nodes and groups are placed.`
      : didYouMean(id, elementIds);

  // 1. Collect every placement.
  const occurrences: Occurrence[] = [];
  const add = (occurrence: Omit<Occurrence, "location" | "order">) =>
    occurrences.push({
      ...occurrence,
      location: locate(occurrence.path),
      order: occurrences.length,
    });
  const walk = (
    box: ArrangeBox,
    path: DocPath,
    owner: string | undefined,
    ownerSubject: DiagnosticSubject,
    silent: boolean,
  ) => {
    for (const kind of ["stack", "row", "grid"] as const) {
      const spec = box[kind];
      if (spec === undefined) continue;
      let column = 0;
      for (const [index, cell] of spec.items.entries()) {
        let itemPath = [...path, kind, "items", index];
        const wrapped = cell !== null && typeof cell === "object" && "item" in cell;
        const item = wrapped ? cell.item : cell;
        if (kind === "grid" && box.grid !== undefined) {
          const span = wrapped ? (cell.span ?? 1) : 1;
          if (column + span > box.grid.columns && !silent) {
            push(
              errorAt(
                locate,
                "layout/grid-span-overflow",
                `Grid item spans ${span} columns at column ${column + 1}, exceeding ${box.grid.columns} columns.`,
                wrapped ? [...itemPath, "span"] : itemPath,
                {
                  subject: ownerSubject,
                  hint: "Reduce span or complete the current row before starting another.",
                },
              ),
            );
          }
          column = (column + span) % box.grid.columns;
        }
        if (wrapped) itemPath = [...itemPath, "item"];
        if (item === null) continue;
        if (typeof item !== "string") {
          walk(item, itemPath, owner, ownerSubject, silent);
          continue;
        }
        if (!elements.has(item) && !isInvalidId(item)) {
          if (collectionsReadable && !silent) {
            push(
              errorAt(
                locate,
                "layout/unknown-item",
                `Unknown item "${item}" in ${describeOwner(owner)}; arrange items must be node or group IDs.`,
                itemPath,
                { subject: ownerSubject, hint: unknownHint(item) },
              ),
            );
          }
          continue;
        }
        add({ id: item, path: itemPath, via: "arrange", owner, silent });
      }
      if (kind === "grid" && column !== 0 && !silent) {
        push(
          errorAt(
            locate,
            "layout/grid-item-count",
            `The final grid row has ${column} of ${box.grid?.columns} columns filled.`,
            [...path, kind, "items"],
            {
              atKey: true,
              subject: ownerSubject,
              hint: "Complete every row with items or spans; use null for an intentionally empty cell.",
            },
          ),
        );
      }
    }
  };
  const figureSubject = { kind: "figure", id: doc.figure?.id ?? "" } as const;
  const rootArrange = doc.figure?.layout.arrange;
  if (rootArrange !== undefined) {
    walk(rootArrange, ["figure", "layout", "arrange"], undefined, figureSubject, false);
  }
  for (const group of groupEntries) {
    const { arrange } = group.value as FigureGroup;
    if (arrange === undefined) continue;
    const silent = invalid.has(group.key);
    walk(arrange, [...group.path, "arrange"], group.value.id, group.subject, silent);
  }
  for (const node of nodeEntries) {
    const { attach } = node.value as FigureNode;
    if (attach === undefined) continue;
    const silent = invalid.has(node.key);
    const toPath = [...node.path, "attach", "to"];
    // A cell of a tokens node (#181) is placed with its node: the node stands for it here.
    const target = refOwner(attach.to);
    if (!elements.has(target) && !isInvalidId(target)) {
      if (collectionsReadable && !silent) {
        push(
          errorAt(
            locate,
            "layout/unknown-attach-target",
            `Unknown attach target "${target}" in node "${node.value.id}"; attach to a node or group ID.`,
            toPath,
            { subject: node.subject, hint: unknownHint(target) },
          ),
        );
      }
      // Unknown, or unknowable (an unreadable collection): it cannot be placed.
      invalid.add(node.key);
    } else if (target === node.value.id && !silent) {
      push(
        errorAt(
          locate,
          "layout/attach-cycle",
          `Node "${node.value.id}" is attached to itself.`,
          toPath,
          { subject: node.subject, hint: "Attach it to another node or group." },
        ),
        node.key,
      );
    }
    add({
      id: node.value.id,
      path: [...node.path, "attach"],
      via: "attach",
      target,
      silent,
    });
  }
  occurrences.sort(compareLocations);

  // 2. Each element is placed once; the first occurrence in the file counts.
  const placement = new Map<string, Occurrence>();
  // Elements invalid only because this loop reported them: later occurrences
  // are reported too.
  const placedTwice = new Set<string>();
  for (const occurrence of occurrences) {
    const first = placement.get(occurrence.id);
    if (first === undefined) {
      placement.set(occurrence.id, occurrence);
      continue;
    }
    const element = elements.get(occurrence.id);
    if (element === undefined) continue;
    const alreadyInvalid = invalid.has(element.key) && !placedTwice.has(occurrence.id);
    if (alreadyInvalid || first.silent || occurrence.silent) {
      // Already explained by an earlier error, but where it belongs is ambiguous.
      invalid.add(element.key);
      continue;
    }
    push(
      errorAt(
        locate,
        "layout/duplicate-placement",
        `"${occurrence.id}" is placed more than once: ${describeOccurrence(first)} and ${describeOccurrence(occurrence)}.`,
        occurrence.path,
        {
          atKey: occurrence.via === "attach",
          subject: element.subject,
          hint: "Place each node and group exactly once: in one arrange tree, or with attach.",
          related: [
            relatedAt(
              locate,
              first.path,
              first.via === "attach" ? "Attached here." : "First placed here.",
            ),
          ],
        },
      ),
      element.key,
    );
    placedTwice.add(occurrence.id);
  }

  // 3. Attach cycles of more than one node (self-attachment is reported above).
  const attachedTarget = (id: string): string | undefined => {
    const occurrence = placement.get(id);
    return occurrence?.via === "attach" ? occurrence.target : undefined;
  };
  const resolvedChains = new Set<string>();
  for (const occurrence of placement.values()) {
    if (occurrence.via !== "attach") continue;
    const chain: string[] = [];
    let current: string | undefined = occurrence.id;
    while (current !== undefined && !resolvedChains.has(current) && !chain.includes(current)) {
      chain.push(current);
      current = attachedTarget(current);
    }
    if (current !== undefined && chain.includes(current)) {
      const members = chain.slice(chain.indexOf(current));
      if (members.length > 1)
        reportAttachCycle(members, placement, elements, locate, push, invalid);
    }
    for (const id of chain) resolvedChains.add(id);
  }
  // Attached nodes and children of what is invalid so far are invalid before
  // parents are compared.
  invalidateDependents(state);

  // 4. Parents: an arrange item belongs to the tree's owner, an attached node
  // to its target's parent. A written `group:` must agree.
  const parentOf = new Map<string, string | undefined>();
  const parent = (id: string, depth = 0): string | undefined => {
    if (parentOf.has(id)) return parentOf.get(id);
    const occurrence = placement.get(id);
    let result = elements.get(id)?.value.group;
    if (occurrence?.via === "arrange") {
      result = occurrence.owner;
    } else if (occurrence?.via === "attach" && occurrence.target !== undefined) {
      // Attach cycles are invalid and never compared; the depth guards anyway.
      if (depth > elements.size) return result;
      result = parent(occurrence.target, depth + 1);
    }
    parentOf.set(id, result);
    return result;
  };
  const compare = (occurrence: Occurrence) => {
    const element = elements.get(occurrence.id);
    if (element === undefined || invalid.has(element.key)) return;
    // An attached node whose target became invalid above depends on it.
    if (occurrence.via === "attach" && isInvalidId(occurrence.target ?? "")) {
      invalid.add(element.key);
      return;
    }
    const expected = parent(occurrence.id);
    const written = element.value.group;
    if (written === undefined || written === expected) return;
    if (occurrence.silent) {
      invalid.add(element.key);
      return;
    }
    const where =
      occurrence.via === "arrange"
        ? `is listed in ${describeOwner(expected)}`
        : `is attached to "${occurrence.target}", which is ${expected === undefined ? "at the root" : `in group "${expected}"`}`;
    push(
      errorAt(
        locate,
        "layout/group-mismatch",
        `${capitalize(element.kind)} "${element.value.id}" has group "${written}" but ${where}.`,
        occurrence.via === "arrange" ? occurrence.path : [...occurrence.path, "to"],
        {
          subject: element.subject,
          hint:
            occurrence.via === "arrange"
              ? `Remove "group: ${written}" (the arrange tree sets the group), or list it in the arrange of group "${written}".`
              : `Remove "group: ${written}" (an attached node is in its target's group), or attach it to an element of group "${written}".`,
          related: [relatedAt(locate, [...element.path, "group"], "The group is written here.")],
        },
      ),
      element.key,
    );
  };
  for (const occurrence of placement.values()) {
    if (occurrence.via === "arrange") compare(occurrence);
  }
  invalidateDependents(state);
  const compared = new Set<string>();
  const compareAttached = (occurrence: Occurrence, depth = 0) => {
    if (compared.has(occurrence.id)) return;
    compared.add(occurrence.id);
    const target = occurrence.target === undefined ? undefined : placement.get(occurrence.target);
    if (target?.via === "attach" && depth <= elements.size) compareAttached(target, depth + 1);
    compare(occurrence);
  };
  for (const occurrence of placement.values()) {
    if (occurrence.via === "attach") compareAttached(occurrence);
  }

  // 5. Fill in the membership the placement implies. An item of an invalid
  // group's tree becomes its child, and so invalid below.
  for (const element of elements.values()) {
    if (invalid.has(element.key) || element.value.group !== undefined) continue;
    if (!placement.has(element.value.id)) continue;
    const inferred = parent(element.value.id);
    if (inferred !== undefined) element.value.group = inferred;
  }

  // 6. Groups nested inside themselves through arrange trees. A cycle of
  // written `group:` fields is `ref/group-cycle` and its groups are invalid.
  checkArrangeCycles(elements, placement, state, locate, push);
  invalidateDependents(state);

  // 7. Every node and group is placed. An element inside an unplaced group
  // (at any depth, in any declaration order) is invalid without a diagnostic.
  if (everyTreeReadable) {
    const unplaced = new Set<string>();
    for (const element of elements.values()) {
      if (!invalid.has(element.key) && !placement.has(element.value.id)) {
        unplaced.add(element.value.id);
      }
    }
    const insideUnplaced = (element: Element): boolean => {
      const seen = new Set<string>();
      let parentId = element.value.group;
      while (parentId !== undefined && !seen.has(parentId)) {
        if (unplaced.has(parentId)) return true;
        seen.add(parentId);
        parentId = elements.get(parentId)?.value.group;
      }
      return false;
    };
    for (const id of unplaced) {
      const element = elements.get(id);
      if (element === undefined) continue;
      if (insideUnplaced(element)) {
        invalid.add(element.key);
        continue;
      }
      push(
        errorAt(
          locate,
          "layout/unplaced",
          `${capitalize(element.kind)} "${element.value.id}" is not placed; the structured layout places only elements listed in an arrange tree or attached.`,
          [...element.path, "id"],
          { subject: element.subject, hint: unplacedHint(element, elements) },
        ),
        element.key,
      );
    }
    invalidateDependents(state);
  }

  // 8. Anchors of the edges that are still valid.
  for (const [index, edge] of (doc.edges ?? []).entries()) {
    if (edge === undefined || invalid.has(edgeKey(edge.id, index))) continue;
    for (const field of ["fromAnchor", "toAnchor"] as const) {
      const value = edge[field];
      if (value === undefined || parseAnchor(value) !== undefined) continue;
      push(
        errorAt(
          locate,
          "layout/invalid-anchor",
          `Invalid anchor ${JSON.stringify(value)} at edges[${index}].${field}; expected "<side>", "<side>:<position>" or "straight".`,
          ["edges", index, field],
          {
            subject: { kind: "edge", id: edge.id ?? `edges[${index}]` },
            hint: anchorHint(value),
          },
        ),
        edgeKey(edge.id, index),
      );
    }
  }

  // 9. Align constraints (#132): about the figure, so they invalidate nothing.
  if (collectionsReadable) checkAlign(state, locate, elements, isInvalidId, unknownHint);
}

/**
 * `figure.layout.align`: each constraint lists at least two nodes or groups,
 * each known and listed once. An ID of an element that is invalid already is
 * explained by its own error and not reported again.
 */
function checkAlign(
  state: CheckState,
  locate: Locator,
  elements: Map<string, Element>,
  isInvalidId: (id: string) => boolean,
  unknownHint: (id: string) => string | undefined,
): void {
  const constraints = state.doc.figure?.layout.align ?? [];
  const figureSubject = { kind: "figure", id: state.doc.figure?.id ?? "" } as const;
  for (const [index, constraint] of constraints.entries()) {
    const axis = constraint.x !== undefined ? "x" : "y";
    const items = constraint[axis] ?? [];
    const path: DocPath = ["figure", "layout", "align", index, axis];
    if (items.length < 2) {
      state.diagnostics.push(
        errorAt(
          locate,
          "layout/invalid-align",
          `figure.layout.align[${index}] lists ${items.length === 0 ? "no elements" : `only "${items[0]}"`}; an align constraint needs at least two.`,
          path,
          {
            atKey: true,
            subject: figureSubject,
            hint: `List two or more node or group IDs in "${axis}", or remove the constraint.`,
          },
        ),
      );
    }
    const first = new Map<string, number>();
    for (const [i, id] of items.entries()) {
      const itemPath = [...path, i];
      // A cell of a tokens node (#181) is checked by the tokens expansion.
      const owner = refOwner(id);
      if (!elements.has(owner) && !isInvalidId(owner)) {
        state.diagnostics.push(
          errorAt(
            locate,
            "layout/unknown-align-item",
            `Unknown element "${owner}" in figure.layout.align[${index}]; align lists node or group IDs.`,
            itemPath,
            { subject: figureSubject, hint: unknownHint(owner) },
          ),
        );
        continue;
      }
      const earlier = first.get(id);
      if (earlier === undefined) {
        first.set(id, i);
        continue;
      }
      state.diagnostics.push(
        errorAt(
          locate,
          "layout/duplicate-align-item",
          `"${id}" is listed more than once in figure.layout.align[${index}].`,
          itemPath,
          {
            subject: figureSubject,
            hint: "List each element once in a constraint.",
            related: [relatedAt(locate, [...path, earlier], "First listed here.")],
          },
        ),
      );
    }
  }
}

function reportAttachCycle(
  members: string[],
  placement: Map<string, Occurrence>,
  elements: Map<string, Element>,
  locate: Locator,
  push: Push,
  invalid: Set<ElementKey>,
): void {
  // Reported at the member that comes first in the file, unless a member is
  // already invalid (its own error explains the problem).
  const sorted = [...members].sort((a, b) =>
    compareLocations(placement.get(a) as Occurrence, placement.get(b) as Occurrence),
  );
  const head = sorted[0] as string;
  const start = members.indexOf(head);
  const cycle = [...members.slice(start), ...members.slice(0, start)];
  const headElement = elements.get(head);
  const headOccurrence = placement.get(head);
  const allValid = cycle.every((id) => {
    const element = elements.get(id);
    return element !== undefined && !invalid.has(element.key);
  });
  if (allValid && headElement !== undefined && headOccurrence !== undefined) {
    push(
      errorAt(
        locate,
        "layout/attach-cycle",
        `Node "${head}" is attached to itself through ${[...cycle, head].join(" → ")}.`,
        [...headOccurrence.path, "to"],
        {
          subject: headElement.subject,
          hint: "Place one of these nodes in an arrange tree instead of attaching it.",
          related: cycle.slice(1).map((id) => {
            const path = placement.get(id)?.path ?? [];
            return relatedAt(locate, [...path, "to"], `"${id}" is part of the cycle.`);
          }),
        },
      ),
    );
  }
  // Every member is invalid; the others without a diagnostic of their own.
  for (const id of cycle) {
    const element = elements.get(id);
    if (element !== undefined) invalid.add(element.key);
  }
}

function checkArrangeCycles(
  elements: Map<string, Element>,
  placement: Map<string, Occurrence>,
  state: CheckState,
  locate: Locator,
  push: Push,
): void {
  const { invalid } = state;
  const parentGroup = (id: string): string | undefined => {
    const element = elements.get(id);
    if (element === undefined || invalid.has(element.key)) return undefined;
    return element.value.group;
  };
  const done = new Set<string>();
  for (const element of elements.values()) {
    if (element.kind !== "group") continue;
    const chain: string[] = [];
    let current: string | undefined = element.value.id;
    while (current !== undefined && !done.has(current) && !chain.includes(current)) {
      chain.push(current);
      current = parentGroup(current);
    }
    if (current !== undefined && chain.includes(current)) {
      const members = chain.slice(chain.indexOf(current));
      const located = members
        .map((id) => ({ id, occurrence: placement.get(id) }))
        .filter((m): m is { id: string; occurrence: Occurrence } => m.occurrence !== undefined)
        .sort((a, b) => compareLocations(a.occurrence, b.occurrence));
      const head = located[0];
      if (head !== undefined) {
        const start = members.indexOf(head.id);
        const cycle = [...members.slice(start), ...members.slice(0, start)];
        push(
          errorAt(
            locate,
            "layout/group-cycle",
            `Group "${head.id}" is nested inside itself through arrange: ${[...cycle, head.id].join(" → ")}.`,
            head.occurrence.path,
            {
              subject: elements.get(head.id)?.subject,
              hint: "List each group in the arrange tree of its parent (or figure.layout.arrange for the root), not of its own descendants.",
              related: cycle.slice(1).flatMap((id) => {
                const occurrence = placement.get(id);
                return occurrence === undefined
                  ? []
                  : [relatedAt(locate, occurrence.path, `"${id}" is part of the cycle.`)];
              }),
            },
          ),
        );
      }
      for (const id of members) {
        const member = elements.get(id);
        if (member !== undefined) invalid.add(member.key);
      }
    }
    for (const id of chain) done.add(id);
  }
}

function unplacedHint(element: Element, elements: Map<string, Element>): string {
  const id = element.value.id;
  const attach = element.kind === "node" ? ", or place it beside another element with attach" : "";
  const parent = element.value.group;
  if (parent === undefined) return `Add "${id}" to the items of figure.layout.arrange${attach}.`;
  const group = elements.get(parent);
  if (group?.kind === "group" && (group.value as FigureGroup).arrange === undefined) {
    return `Group "${parent}" has no arrange; add one that lists "${id}"${attach}.`;
  }
  return `Add "${id}" to the items of the arrange of group "${parent}"${attach}.`;
}

function anchorHint(value: string): string {
  const side = /^([a-z]+)/.exec(value.toLowerCase())?.[1];
  const suggestion =
    side === undefined ? undefined : closestMatch(side, [...SIDES, STRAIGHT_ANCHOR]);
  const sides = `Sides: ${SIDES.join(", ")}; the position is a number from 0 to 1 (default 0.5), e.g. "south:0.25". Or "straight": in line with the other end, on the side facing it.`;
  return suggestion !== undefined && suggestion !== side
    ? `Did you mean "${suggestion}"? ${sides}`
    : sides;
}

function describeOwner(owner: string | undefined): string {
  return owner === undefined ? "figure.layout.arrange" : `the arrange of group "${owner}"`;
}

function describeOccurrence(occurrence: Occurrence): string {
  return occurrence.via === "attach"
    ? `attached to "${occurrence.target}"`
    : `in ${describeOwner(occurrence.owner)}`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Source order (line, column), then collection order for unlocated entries. */
function compareLocations(a: Occurrence, b: Occurrence): number {
  if (a.location !== undefined && b.location !== undefined) {
    const byPosition = a.location.line - b.location.line || a.location.column - b.location.column;
    if (byPosition !== 0) return byPosition;
  }
  return a.order - b.order;
}
