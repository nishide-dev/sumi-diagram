/** Rules on the figure's structure: element counts and edges. */

import type { DiagnosticSubject } from "../../core/diagnostics";
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
    const { nodes } = context.state.doc;
    // `undefined` means `nodes` could not be read (already an error).
    if (nodes === undefined || nodes.length > 0) return [];
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
  description: "The figure has two or more nodes but no edges.",
  defaultSeverity: "warning",
  fixable: false,
  run(context) {
    const { nodes, edges } = context.state.doc;
    if (nodes === undefined || edges === undefined || nodes.length < 2 || edges.length > 0) {
      return [];
    }
    const subject = figureSubject(context);
    return [
      {
        message: `The figure has ${nodes.length} nodes but no edges.`,
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
      const { from, to, label } = edge.element;
      // Edges without a direction or with both directions are symmetric.
      const { direction } = component.manifest;
      const symmetric = direction === "none" || direction === "both";
      const ends = symmetric ? [from, to].sort() : [from, to];
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
