/** Rules on the figure's structure: element counts and edges. */

import { edgeKey, nodeKey } from "../../core/check-state";
import type { DiagnosticSubject } from "../../core/diagnostics";
import { parseAnchor } from "../../core/figure/layout";
import { defineRule, type LintContext, type LintFinding, type ValidElement } from "../rule";

function figureSubject(context: LintContext): DiagnosticSubject | undefined {
  const id = context.state.doc.figure?.id;
  return id === undefined ? undefined : { kind: "figure", id };
}

export const emptyFigure = defineRule({
  id: "lint/empty-figure",
  description: "The figure has no nodes.",
  defaultSeverity: "warning",
  fixable: false,
  run(context) {
    const { nodes, expanded } = context.state.doc;
    // `undefined` means `nodes` could not be read (already an error). Group
    // captions (#130) and the parts of legends (#131) are expanded into nodes
    // after the written ones; a legend's own entry is left `undefined`.
    if (nodes === undefined) return [];
    if (nodes.some((n) => n === undefined || !expanded?.has(nodeKey(n.id)))) return [];
    const subject = figureSubject(context);
    return [
      {
        message: "The figure has no nodes.",
        path: ["nodes"],
        ...(subject !== undefined && { subject }),
        hint: "Add nodes, or turn off lint/empty-figure if an empty figure is intended.",
      },
    ];
  },
});

export const noEdges = defineRule({
  id: "lint/no-edges",
  description: "The figure has two or more valid nodes but no edges.",
  defaultSeverity: "warning",
  fixable: false,
  run(context) {
    // Any edge, even an invalid one, means the author did draw edges; the
    // sample lines of a legend (#131) are not the author's.
    const { edges, expanded } = context.state.doc;
    if (edges === undefined) return [];
    if (edges.some((e, i) => e === undefined || !expanded?.has(edgeKey(e.id, i)))) return [];
    // Invalid nodes already have errors; count only the valid ones, and not
    // the captions of groups (#130) or the parts of legends (#131).
    const nodeCount = context.elements.filter(
      (e) => e.kind === "node" && e.origin === undefined,
    ).length;
    if (nodeCount < 2) return [];
    const subject = figureSubject(context);
    return [
      {
        message: `The figure has ${nodeCount} nodes but no edges.`,
        path: ["edges"],
        ...(subject !== undefined && { subject }),
        hint: "Connect the nodes with edges, or turn off lint/no-edges if unconnected nodes are intended.",
      },
    ];
  },
});

type EdgeElement = Extract<ValidElement, { kind: "edge" }>;
type GroupElement = Extract<ValidElement, { kind: "group" }>;

/** `"id"` for edges with an ID, `edges[<index>]` otherwise. */
const edgeName = (edge: EdgeElement): string =>
  edge.element.id === undefined ? edge.subject.id : `"${edge.element.id}"`;

const edgesOf = (context: LintContext): EdgeElement[] =>
  context.elements.filter((e): e is EdgeElement => e.kind === "edge");

export const ancestorEdge = defineRule({
  id: "lint/ancestor-edge",
  description: "An edge connects a group with an element inside it.",
  defaultSeverity: "warning",
  fixable: false,
  run(context) {
    const groups = new Map<string, GroupElement>();
    const parents = new Map<string, string | undefined>();
    for (const element of context.elements) {
      if (element.kind === "edge") continue;
      if (element.kind === "group") groups.set(element.element.id, element);
      parents.set(element.element.id, element.element.group);
    }
    /** `true` if `id` is (transitively) inside group `groupId`. */
    const isInside = (id: string, groupId: string): boolean => {
      const seen = new Set<string>();
      for (let p = parents.get(id); p !== undefined && !seen.has(p); p = parents.get(p)) {
        if (p === groupId) return true;
        seen.add(p);
      }
      return false;
    };

    const findings: LintFinding[] = [];
    for (const edge of edgesOf(context)) {
      const { from, to } = edge.element;
      const pairs: [string, string][] = [
        [from, to],
        [to, from],
      ];
      for (const [ancestor, descendant] of pairs) {
        const group = groups.get(ancestor);
        if (group === undefined || !isInside(descendant, ancestor)) continue;
        findings.push({
          message: `Edge ${edgeName(edge)} connects group "${ancestor}" with "${descendant}", which is inside it.`,
          path: edge.path,
          subject: edge.subject,
          hint: "D2 draws such an edge across the group's border and label; connect elements that are both inside or both outside the group instead.",
          related: [{ path: group.path, message: `Group "${ancestor}" is defined here.` }],
        });
        break;
      }
    }
    return findings;
  },
});

export const selfLoop = defineRule({
  id: "lint/self-loop",
  description: "An edge starts and ends at the same element.",
  defaultSeverity: "info",
  fixable: false,
  run(context) {
    return edgesOf(context)
      .filter((edge) => edge.element.from === edge.element.to)
      .map((edge) => ({
        message: `Edge ${edgeName(edge)} connects "${edge.element.from}" to itself.`,
        path: edge.path,
        subject: edge.subject,
        hint: "Self-loops are allowed; remove the edge if it is unintended.",
      }));
  },
});

export const duplicateEdge = defineRule({
  id: "lint/duplicate-edge",
  description: "Two edges have the same endpoints, component and label.",
  defaultSeverity: "warning",
  fixable: false,
  run(context) {
    const first = new Map<string, EdgeElement>();
    const findings: LintFinding[] = [];
    for (const edge of edgesOf(context)) {
      const { component } = edge;
      if (component === undefined || component.manifest.kind !== "edge") continue;
      const { from, to, fromAnchor, toAnchor, label } = edge.element;
      // Edges without a direction or with both directions are symmetric.
      const { direction } = component.manifest;
      const symmetric = direction === "none" || direction === "both";
      // Edges to different anchors of the same nodes (structured layout) are distinct.
      const end = (id: string, anchor: string | undefined) => {
        const parsed = anchor === undefined ? undefined : parseAnchor(anchor);
        return parsed === undefined ? id : `${id}@${parsed.side}:${parsed.offset}`;
      };
      const pair = [end(from, fromAnchor), end(to, toAnchor)];
      const ends = symmetric ? pair.sort() : pair;
      const key = JSON.stringify([...ends, component.id, label]);
      const original = first.get(key);
      if (original === undefined) {
        first.set(key, edge);
        continue;
      }
      findings.push({
        message: `Edge ${edgeName(edge)} duplicates edge ${edgeName(original)} (same endpoints, component and label).`,
        path: edge.path,
        subject: edge.subject,
        hint: "Remove one of the edges, or give them different labels if both are intended.",
        related: [{ path: original.path, message: `Edge ${edgeName(original)} is defined here.` }],
      });
    }
    return findings;
  },
});
