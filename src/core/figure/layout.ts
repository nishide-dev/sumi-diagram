/**
 * Stage `layout`: checks the structured-layout fields of a figure (#88,
 * design doc §6.19) and normalizes group membership.
 *
 * - With the `auto` engine, every structured-only field (`figure.layout.arrange`,
 *   `group.arrange`, `node.attach`, `edge.fromAnchor` / `toAnchor`) is an
 *   error: it would otherwise be ignored silently.
 * - With the `structured` engine, every node and group must be placed exactly
 *   once: as an item of one arrange tree (`figure.layout.arrange` for the root,
 *   `groups[].arrange` for a group's children) or by `attach`. An item of a
 *   group's arrange tree is a child of that group; an attached node has the
 *   parent of its target. When `group:` is omitted it is filled in from the
 *   placement, so later stages see the membership; when it is written and
 *   disagrees, that is an error.
 *
 * Errors invalidate the element they are about (the placed element, the
 * attached node, the edge with a bad anchor), never the arrange tree's owner:
 * an unknown ID in a group's arrange tree does not make the group's other
 * children unusable.
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
import { type ArrangeBox, type FigureGroup, type FigureNode, SIDES, type Side } from "./schema";
import type { Locator } from "./yaml";

/** A parsed edge anchor. */
export interface Anchor {
  side: Side;
  /** 0..1 along the side: left → right on north/south, top → bottom on east/west. */
  offset: number;
}

/** Parses `"south"` / `"south:0.25"`; `undefined` if malformed (see `ANCHOR_PATTERN`). */
export function parseAnchor(value: string): Anchor | undefined {
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
  /** arrange: the tree's owner, for messages. */
  ownerSubject?: DiagnosticSubject;
  /** attach: the attached node and its target. */
  node?: Element;
  target?: string;
  location: SourceLocation | undefined;
  order: number;
}

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

/** `auto`: every structured-only field is an error. */
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
  for (const [index, group] of (doc.groups ?? []).entries()) {
    if (group?.arrange === undefined) continue;
    const subject = { kind: "group", id: group.id } as const;
    report("arrange", ["groups", index, "arrange"], groupKey(group.id), subject);
  }
  for (const [index, node] of (doc.nodes ?? []).entries()) {
    if (node?.attach === undefined) continue;
    const subject = { kind: "node", id: node.id } as const;
    report("attach", ["nodes", index, "attach"], nodeKey(node.id), subject);
  }
  for (const [index, edge] of (doc.edges ?? []).entries()) {
    if (edge === undefined) continue;
    const subject = { kind: "edge", id: edge.id ?? `edges[${index}]` } as const;
    for (const field of ["fromAnchor", "toAnchor"] as const) {
      if (edge[field] !== undefined) {
        report(field, ["edges", index, field], edgeKey(edge.id, index), subject);
      }
    }
  }
}

function checkStructured(state: CheckState, locate: Locator): void {
  const { doc, invalid } = state;
  const push = (diagnostic: Diagnostic, key?: ElementKey) => {
    state.diagnostics.push(diagnostic);
    if (key !== undefined) invalid.add(key);
  };

  // Readable nodes and groups by ID (the first definition; duplicates are
  // already `ref/duplicate-id` and invalid).
  const elements = new Map<string, Element>();
  for (const [index, group] of (doc.groups ?? []).entries()) {
    if (group === undefined || elements.has(group.id)) continue;
    elements.set(group.id, {
      kind: "group",
      value: group,
      path: ["groups", index],
      key: groupKey(group.id),
      subject: { kind: "group", id: group.id },
    });
  }
  for (const [index, node] of (doc.nodes ?? []).entries()) {
    if (node === undefined || elements.has(node.id)) continue;
    elements.set(node.id, {
      kind: "node",
      value: node,
      path: ["nodes", index],
      key: nodeKey(node.id),
      subject: { kind: "node", id: node.id },
    });
  }
  const isInvalidId = (id: string) => invalid.has(nodeKey(id)) || invalid.has(groupKey(id));
  // Unknown IDs are reported only if both collections are readable (an
  // unreadable element with a string ID is in `invalid`, so it counts as known).
  const collectionsReadable = doc.nodes !== undefined && doc.groups !== undefined;
  // "Not placed" needs every arrange tree: none may be in an unreadable element.
  const everyTreeReadable =
    collectionsReadable && !doc.groups?.includes(undefined) && !doc.nodes?.includes(undefined);
  const elementIds = [...elements.keys()];
  const unknownHint = (id: string) =>
    (doc.edges ?? []).some((e) => e?.id === id)
      ? `"${id}" is an edge; only nodes and groups are placed.`
      : didYouMean(id, elementIds);

  // 1. Collect every placement, in source order.
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
  ) => {
    for (const kind of ["stack", "row"] as const) {
      const spec = box[kind];
      if (spec === undefined) continue;
      for (const [index, item] of spec.items.entries()) {
        const itemPath = [...path, kind, "items", index];
        if (typeof item !== "string") {
          walk(item, itemPath, owner, ownerSubject);
          continue;
        }
        if (!elements.has(item) && !isInvalidId(item)) {
          if (collectionsReadable) {
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
        add({ id: item, path: itemPath, via: "arrange", owner, ownerSubject });
      }
    }
  };
  const figureSubject = { kind: "figure", id: doc.figure?.id ?? "" } as const;
  const rootArrange = doc.figure?.layout.arrange;
  if (rootArrange !== undefined) {
    walk(rootArrange, ["figure", "layout", "arrange"], undefined, figureSubject);
  }
  for (const element of elements.values()) {
    if (element.kind !== "group") continue;
    const { arrange } = element.value as FigureGroup;
    if (arrange !== undefined) {
      walk(arrange, [...element.path, "arrange"], element.value.id, element.subject);
    }
  }
  for (const element of elements.values()) {
    if (element.kind !== "node") continue;
    const { attach } = element.value as FigureNode;
    if (attach === undefined) continue;
    const toPath = [...element.path, "attach", "to"];
    if (!elements.has(attach.to) && !isInvalidId(attach.to)) {
      if (collectionsReadable) {
        push(
          errorAt(
            locate,
            "layout/unknown-attach-target",
            `Unknown attach target "${attach.to}" in node "${element.value.id}"; attach to a node or group ID.`,
            toPath,
            { subject: element.subject, hint: unknownHint(attach.to) },
          ),
          element.key,
        );
      }
    } else if (attach.to === element.value.id) {
      push(
        errorAt(
          locate,
          "layout/attach-cycle",
          `Node "${element.value.id}" is attached to itself.`,
          toPath,
          { subject: element.subject, hint: "Attach it to another node or group." },
        ),
        element.key,
      );
    }
    add({
      id: element.value.id,
      path: [...element.path, "attach"],
      via: "attach",
      node: element,
      target: attach.to,
    });
  }
  occurrences.sort((a, b) => compareLocations(a, b));

  // 2. Each element is placed once; the first occurrence in the file counts.
  const placement = new Map<string, Occurrence>();
  for (const occurrence of occurrences) {
    const first = placement.get(occurrence.id);
    if (first === undefined) {
      placement.set(occurrence.id, occurrence);
      continue;
    }
    const element = elements.get(occurrence.id);
    push(
      errorAt(
        locate,
        "layout/duplicate-placement",
        `"${occurrence.id}" is placed more than once: ${describeOccurrence(first)} and ${describeOccurrence(occurrence)}.`,
        occurrence.path,
        {
          atKey: occurrence.via === "attach",
          subject: element?.subject,
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
      element?.key,
    );
  }

  // 3. Attach chains: find cycles and resolve each attached node's parent.
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
    if (current !== undefined && chain.includes(current) && !resolvedChains.has(current)) {
      const members = chain.slice(chain.indexOf(current));
      // A self-attachment is already reported.
      if (members.length > 1) {
        reportAttachCycle(members, placement, elements, locate, push, invalid);
      }
    }
    for (const id of chain) resolvedChains.add(id);
  }

  // 4. Parents: an arrange item belongs to the tree's owner, an attached node
  // to its target's parent. A written `group:` must agree.
  const parentOf = new Map<string, string | undefined>();
  const resolving = new Set<string>();
  const parent = (id: string): string | undefined => {
    if (parentOf.has(id)) return parentOf.get(id);
    const element = elements.get(id);
    const occurrence = placement.get(id);
    let result = element?.value.group;
    if (occurrence?.via === "arrange") {
      result = occurrence.owner;
    } else if (occurrence?.via === "attach" && occurrence.target !== undefined) {
      if (resolving.has(id)) return element?.value.group; // a cycle; already reported
      resolving.add(id);
      result = parent(occurrence.target);
      resolving.delete(id);
    }
    parentOf.set(id, result);
    return result;
  };
  for (const occurrence of placement.values()) {
    const element = elements.get(occurrence.id);
    if (element === undefined || invalid.has(element.key)) continue;
    if (occurrence.via === "attach" && isInvalidId(occurrence.target ?? "")) continue;
    const expected = parent(occurrence.id);
    const written = element.value.group;
    if (written === undefined || written === expected) continue;
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
  }

  // 5. Fill in the membership the placement implies.
  for (const element of elements.values()) {
    if (invalid.has(element.key) || element.value.group !== undefined) continue;
    if (!placement.has(element.value.id)) continue;
    const inferred = parent(element.value.id);
    if (inferred !== undefined) element.value.group = inferred;
  }

  // 6. Groups nested inside themselves through arrange trees. A cycle of
  // written `group:` fields is `ref/group-cycle` and its groups are invalid.
  checkArrangeCycles(elements, placement, state, locate, push);

  // A node attached to an invalid element is invalid too (no diagnostic).
  let changed = true;
  while (changed) {
    changed = false;
    for (const occurrence of placement.values()) {
      const node = occurrence.node;
      if (occurrence.via !== "attach" || node === undefined || invalid.has(node.key)) continue;
      if (isInvalidId(occurrence.target ?? "")) {
        invalid.add(node.key);
        changed = true;
      }
    }
  }

  // 7. Every node and group is placed.
  // Groups come first, so the children of an unplaced group are skipped.
  const insideInvalidGroup = (element: Element): boolean => {
    const seen = new Set<string>();
    let parentId = element.value.group;
    while (parentId !== undefined && !seen.has(parentId)) {
      seen.add(parentId);
      if (invalid.has(groupKey(parentId))) return true;
      parentId = elements.get(parentId)?.value.group;
    }
    return false;
  };
  if (everyTreeReadable) {
    for (const element of elements.values()) {
      if (invalid.has(element.key) || placement.has(element.value.id)) continue;
      if (insideInvalidGroup(element)) {
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
  }

  // 8. Edge anchors.
  for (const [index, edge] of (doc.edges ?? []).entries()) {
    if (edge === undefined) continue;
    for (const field of ["fromAnchor", "toAnchor"] as const) {
      const value = edge[field];
      if (value === undefined || parseAnchor(value) !== undefined) continue;
      push(
        errorAt(
          locate,
          "layout/invalid-anchor",
          `Invalid anchor ${JSON.stringify(value)} at edges[${index}].${field}; expected "<side>" or "<side>:<position>".`,
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
}

function reportAttachCycle(
  members: string[],
  placement: Map<string, Occurrence>,
  elements: Map<string, Element>,
  locate: Locator,
  push: (diagnostic: Diagnostic, key?: ElementKey) => void,
  invalid: Set<ElementKey>,
): void {
  // Report at the member that comes first in the file.
  const sorted = [...members].sort((a, b) =>
    compareLocations(placement.get(a) as Occurrence, placement.get(b) as Occurrence),
  );
  const head = sorted[0] as string;
  const start = members.indexOf(head);
  const cycle = [...members.slice(start), ...members.slice(0, start)];
  const headElement = elements.get(head);
  const headOccurrence = placement.get(head);
  if (headElement === undefined || headOccurrence === undefined) return;
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
    headElement.key,
  );
  // The other members are invalid too, without a diagnostic of their own.
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
  push: (diagnostic: Diagnostic, key?: ElementKey) => void,
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
  const suggestion = side === undefined ? undefined : closestMatch(side, SIDES);
  const sides = `Sides: ${SIDES.join(", ")}; the position is a number from 0 to 1 (default 0.5), e.g. "south:0.25".`;
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
