/**
 * Stage `ref`: checks ID uniqueness and references between elements — group
 * parents, group cycles and edge endpoints (design doc §2.2).
 *
 * Component references are resolved later by the `component` stage.
 */

import { type CheckState, type ElementKey, edgeKey, groupKey, nodeKey } from "../check-state";
import type { Diagnostic, DiagnosticSubject, DocPath, SourceLocation } from "../diagnostics";
import { didYouMean } from "../diagnostics";
import { errorAt, relatedAt } from "./report";
import type { FigureEdge, FigureGroup, FigureNode } from "./schema";
import type { Locator } from "./yaml";

interface Entry<T> {
  value: T;
  path: DocPath;
  key: ElementKey;
  subject: DiagnosticSubject;
}

/** Runs the `ref` stage on `state.doc`. */
export function linkFigure(state: CheckState, locate: Locator): void {
  const { doc, invalid } = state;
  const report = (diagnostic: Diagnostic, key: ElementKey) => {
    state.diagnostics.push(diagnostic);
    invalid.add(key);
  };

  const groups = entries(doc.groups, "groups", (g) => groupKey(g.id), "group");
  const nodes = entries(doc.nodes, "nodes", (n) => nodeKey(n.id), "node");
  const edges = entries(doc.edges, "edges", (e, i) => edgeKey(e.id, i), "edge");

  // Duplicate IDs. Nodes and groups share one ID space; edges have their own.
  // A duplicated ID makes its keys ambiguous, so every definition is marked
  // invalid (for nodes and groups, both the `n:` and the `g:` key).
  const groupById = new Map<string, Entry<FigureGroup>>();
  const nodeById = new Map<string, Entry<FigureNode>>();
  const firstById = new Map<string, Entry<FigureGroup | FigureNode>>();
  for (const entry of sortBySource<FigureGroup | FigureNode>([...groups, ...nodes], locate)) {
    const first = firstById.get(entry.value.id);
    if (first) {
      report(duplicate(locate, entry, first), entry.key);
      invalid.add(first.key);
      continue;
    }
    firstById.set(entry.value.id, entry);
    if (entry.subject.kind === "group") groupById.set(entry.value.id, entry as Entry<FigureGroup>);
    else nodeById.set(entry.value.id, entry as Entry<FigureNode>);
  }

  // Parent groups.
  for (const entry of [...groups, ...nodes]) {
    const parent = entry.value.group;
    if (parent === undefined || invalid.has(entry.key) || groupById.has(parent)) continue;
    if (doc.groups === undefined || invalid.has(groupKey(parent))) continue;
    const hint = nodeById.has(parent)
      ? `"${parent}" is a node; only groups can contain elements.`
      : didYouMean(parent, groupById.keys());
    report(
      errorAt(
        locate,
        "ref/unknown-group",
        `Unknown group "${parent}" in ${entry.subject.kind} "${entry.value.id}".`,
        [...entry.path, "group"],
        { subject: entry.subject, hint },
      ),
      entry.key,
    );
  }

  // Group cycles: follow parent links from each group; a revisit within the
  // current walk is a cycle.
  const parentOf = (entry: Entry<FigureGroup>) => {
    const parent = entry.value.group;
    if (parent === undefined || invalid.has(entry.key)) return undefined;
    return groupById.get(parent);
  };
  const done = new Set<Entry<FigureGroup>>();
  for (const start of groupById.values()) {
    const chain: Entry<FigureGroup>[] = [];
    let current: Entry<FigureGroup> | undefined = start;
    while (current && !done.has(current) && !chain.includes(current)) {
      chain.push(current);
      current = parentOf(current);
    }
    if (current && chain.includes(current)) {
      // Report at the cycle member that comes first in the file.
      const members = chain.slice(chain.indexOf(current));
      const order = [...groupById.values()];
      const first = members.reduce((a, b) => (order.indexOf(b) < order.indexOf(a) ? b : a));
      const at = members.indexOf(first);
      const cycle = [...members.slice(at), ...members.slice(0, at)];
      const [head, ...rest] = cycle;
      if (head) {
        const names = [...cycle, head].map((g) => g.value.id).join(" → ");
        state.diagnostics.push(
          errorAt(
            locate,
            "ref/group-cycle",
            `Group "${head.value.id}" is nested inside itself: ${names}.`,
            [...head.path, "group"],
            {
              subject: head.subject,
              related: rest.map((g) =>
                relatedAt(locate, [...g.path, "group"], `"${g.value.id}" is part of the cycle.`),
              ),
            },
          ),
        );
        for (const g of cycle) invalid.add(g.key);
      }
    }
    for (const g of chain) done.add(g);
  }

  // Elements inside an invalid group are invalid too (transitively), so later
  // stages skip them. No diagnostic: the group already has one.
  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of [...groups, ...nodes]) {
      const parent = entry.value.group;
      if (parent !== undefined && !invalid.has(entry.key) && invalid.has(groupKey(parent))) {
        invalid.add(entry.key);
        changed = true;
      }
    }
  }

  // Edge endpoints. An endpoint that is invalid (or unknowable because its
  // collection is unreadable) produces no diagnostic but makes the edge
  // invalid; an unknown endpoint is reported even if the other one is invalid.
  const endpointIds = [...firstById.keys()];
  for (const entry of edges) {
    if (invalid.has(entry.key)) continue;
    for (const end of ["from", "to"] as const) {
      const id = entry.value[end];
      if (
        doc.nodes === undefined ||
        doc.groups === undefined ||
        invalid.has(nodeKey(id)) ||
        invalid.has(groupKey(id))
      ) {
        invalid.add(entry.key);
        continue;
      }
      if (firstById.has(id)) continue;
      report(
        errorAt(
          locate,
          "ref/unknown-endpoint",
          `Unknown ${end === "from" ? "source" : "target"} "${id}" in edge ${entry.subject.id}; endpoints must be node or group IDs.`,
          [...entry.path, end],
          { subject: entry.subject, hint: didYouMean(id, endpointIds) },
        ),
        entry.key,
      );
    }
  }

  // Duplicate edge IDs.
  const edgeById = new Map<string, Entry<FigureEdge>>();
  for (const entry of sortBySource(edges, locate)) {
    const id = entry.value.id;
    if (id === undefined) continue;
    const first = edgeById.get(id);
    if (first) {
      report(duplicate(locate, entry, first), entry.key);
      invalid.add(first.key);
    } else {
      edgeById.set(id, entry);
    }
  }
}

function entries<T>(
  list: (T | undefined)[] | undefined,
  name: string,
  toKey: (value: T, index: number) => ElementKey,
  kind: DiagnosticSubject["kind"],
): Entry<T>[] {
  const result: Entry<T>[] = [];
  for (const [index, value] of (list ?? []).entries()) {
    if (value === undefined) continue;
    const id = (value as { id?: string }).id ?? `${name}[${index}]`;
    result.push({ value, path: [name, index], key: toKey(value, index), subject: { kind, id } });
  }
  return result;
}

function duplicate<T extends { id?: string | undefined }>(
  locate: Locator,
  entry: Entry<T>,
  first: Entry<T>,
): Diagnostic {
  const what = entry.subject.kind === "edge" ? "Edge ID" : "ID";
  return errorAt(
    locate,
    "ref/duplicate-id",
    `${what} "${entry.value.id}" is already used by ${first.subject.kind} ${first.path[0]}[${first.path[1]}].`,
    [...entry.path, "id"],
    {
      subject: entry.subject,
      hint:
        entry.subject.kind === "edge"
          ? "Edge IDs must be unique among edges."
          : "Node and group IDs share one namespace and must be unique.",
      related: [relatedAt(locate, [...first.path, "id"], "First defined here.")],
    },
  );
}

/** Orders entries by source position so "first defined" matches the file. */
function sortBySource<T>(list: Entry<T>[], locate: Locator): Entry<T>[] {
  const position = (entry: Entry<T>): SourceLocation | undefined => locate(entry.path);
  return list
    .map((entry) => ({ entry, at: position(entry) }))
    .sort((a, b) => {
      if (!a.at || !b.at) return 0;
      return a.at.line - b.at.line || a.at.column - b.at.column;
    })
    .map(({ entry }) => entry);
}
