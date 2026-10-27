/**
 * Shared parts of the expansions the check stages run (design doc §6.32,
 * §6.34): a group's caption (#130) and a legend (#131) are drawn as elements
 * with reserved IDs that Sumi adds to the document. Both use the same rules:
 *
 * - an element the author wrote with a reserved ID is `ref/reserved-id`
 *   (error, at its `id`; related: the field that reserves it), and the
 *   expansion that needs the ID does not run;
 * - each added element records where it comes from in `doc.expanded`, so
 *   diagnostics about it carry the path and subject of that field
 *   (`figureElements()`).
 */

import {
  type CheckState,
  type ElementKey,
  type ExpandedOrigin,
  edgeKey,
  groupKey,
  nodeKey,
  type PartialFigure,
} from "../check-state";
import type { DocPath } from "../diagnostics";
import { errorAt, relatedAt } from "./report";
import type { Locator } from "./yaml";

/** The node and group IDs in use, each with the path of its first definition. */
export function takenIds(doc: PartialFigure): Map<string, DocPath> {
  const taken = new Map<string, DocPath>();
  for (const [index, group] of (doc.groups ?? []).entries()) {
    if (group !== undefined && !taken.has(group.id)) taken.set(group.id, ["groups", index]);
  }
  for (const [index, node] of (doc.nodes ?? []).entries()) {
    if (node !== undefined && !taken.has(node.id)) taken.set(node.id, ["nodes", index]);
  }
  return taken;
}

export interface ReservedIdUse {
  /** The reserved ID. */
  id: string;
  /** Where the element that uses it is written: `["groups", i]`, `["nodes", i]` or `["edges", i]`. */
  owner: DocPath;
  /** What the ID is reserved for, e.g. `the caption of group "x"`. */
  reservedFor: string;
  /** The field that reserves it, and what to say there. */
  related: { path: DocPath; message: string };
}

/**
 * Reports `ref/reserved-id` for an element that uses a reserved ID, and
 * marks that element invalid.
 */
export function reportReservedId(state: CheckState, locate: Locator, use: ReservedIdUse): void {
  const { id, owner, reservedFor, related } = use;
  const kind = owner[0] === "groups" ? "group" : owner[0] === "edges" ? "edge" : "node";
  state.diagnostics.push(
    errorAt(
      locate,
      "ref/reserved-id",
      `The ID "${id}" is reserved for ${reservedFor}.`,
      [...owner, "id"],
      {
        subject: { kind, id },
        hint: `Rename this ${kind}: Sumi draws ${reservedFor} as an element with this ID.`,
        related: [relatedAt(locate, related.path, related.message)],
      },
    ),
  );
  state.invalid.add(
    kind === "group" ? groupKey(id) : kind === "edge" ? edgeKey(id, 0) : nodeKey(id),
  );
}

/** Records the origins of newly expanded elements in `doc.expanded`. */
export function recordExpanded(
  doc: PartialFigure,
  origins: Iterable<readonly [ElementKey, ExpandedOrigin]>,
): void {
  const all = new Map(doc.expanded ?? []);
  for (const [key, origin] of origins) all.set(key, origin);
  if (all.size > 0) doc.expanded = all;
}
