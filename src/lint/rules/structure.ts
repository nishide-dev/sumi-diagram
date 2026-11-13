/** Rules on the figure's structure: element counts and edges. */

import { edgeKey, nodeKey } from "../../core/check-state";
import type { DiagnosticSubject } from "../../core/diagnostics";
import { chatKeys } from "../../core/figure/chat";
import { parseAnchor } from "../../core/figure/layout";
import { SEPARATOR_ID } from "../../core/registry/builtins";
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
  description:
    "The figure has two or more valid nodes but no edges (set members count as related by membership).",
  defaultSeverity: "warning",
  fixable: false,
  run(context) {
    // Any edge, even an invalid one, means the author did draw edges; the
    // sample lines of a legend (#131) are not the author's.
    const { edges, expanded } = context.state.doc;
    if (edges === undefined) return [];
    if (edges.some((e, i) => e === undefined || !expanded?.has(edgeKey(e.id, i)))) return [];
    // Sets (#407) relate nodes by membership: a node in a set (directly or through a
    // member group) needs no edge, so only the other nodes are counted.
    const doc = context.state.doc;
    const memberIds = new Set<string>();
    for (const set of doc.sets ?? []) for (const m of set?.members ?? []) memberIds.add(m);
    const parents = new Map(
      (doc.groups ?? []).flatMap((g) => (g ? [[g.id, g.group] as const] : [])),
    );
    const inSet = (id: string, parent: string | undefined): boolean => {
      if (memberIds.has(id)) return true;
      for (let p = parent, n = 0; p !== undefined && n < 1000; p = parents.get(p), n++)
        if (memberIds.has(p)) return true;
      return false;
    };
    // Invalid nodes already have errors; count only the valid ones, and not
    // the captions of groups (#130) or the parts of legends (#131). The
    // cells of tokens nodes (#181) are the author's nodes.
    const chatNodes = new Set(
      (doc.chats ?? []).flatMap((chat) => chat.rows.flatMap(chatKeys)).map(nodeKey),
    );
    const authored = context.elements.filter(
      (e): e is Extract<ValidElement, { kind: "node" }> =>
        e.kind === "node" &&
        !chatNodes.has(e.key) &&
        e.component?.id !== SEPARATOR_ID &&
        (e.origin === undefined || e.origin.from === "tokens"),
    );
    const nodeCount = authored.filter((e) => !inSet(e.element.id, e.element.group)).length;
    if (nodeCount < 2) return [];
    // Say so when set members were left out, so the count is not read as the
    // figure's node total (#521).
    const inSets = authored.length - nodeCount;
    const subject = figureSubject(context);
    return [
      {
        message:
          inSets > 0
            ? `The figure has ${nodeCount} nodes outside any set (${inSets} more are set members) but no edges.`
            : `The figure has ${nodeCount} nodes but no edges.`,
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
        if (parsed === undefined) return id;
        return typeof parsed === "string"
          ? `${id}@${parsed}`
          : `${id}@${parsed.side}:${parsed.offset}`;
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

/** The frames an author wraps around an icon to enlarge it (#424). */
const ICON_FRAMES: ReadonlySet<string> = new Set(["circle", "box"]);

export const iconEnclosure = defineRule({
  id: "lint/icon-enclosure",
  description:
    "A plain circle or box whose only content is an icon: an icon wrapped in a frame just to make it bigger. Nodes with a tone, a variant, an explicit size or an iconSize are not reported.",
  defaultSeverity: "info",
  fixable: false,
  run(context) {
    const findings: LintFinding[] = [];
    for (const element of context.elements) {
      const manifest = element.component?.manifest;
      if (
        element.kind !== "node" ||
        manifest?.kind !== "node" ||
        manifest.namespace !== "sumi" ||
        !ICON_FRAMES.has(manifest.name) ||
        element.origin !== undefined
      ) {
        continue;
      }
      const node = element.element;
      // The shape carries meaning when the author colors it, styles it or
      // sizes it: a category marker, not a stand-in for a bigger icon.
      if (
        node.icon === undefined ||
        node.iconSize !== undefined ||
        node.tone !== undefined ||
        node.variant !== "default" ||
        node.glyphs !== undefined ||
        node.badge !== undefined ||
        node.props?.width !== undefined ||
        node.props?.height !== undefined
      ) {
        continue;
      }
      findings.push({
        message: `Node "${node.id}" wraps its icon in a plain ${manifest.name}, which only makes the icon look bigger.`,
        path: [...element.path, "component"],
        subject: element.subject,
        hint: "Draw a bare icon larger instead: component: label with icon and iconSize (e.g. iconSize: 2). Keep the frame only if its shape carries meaning: give it a tone or variant.",
      });
    }
    return findings;
  },
});
