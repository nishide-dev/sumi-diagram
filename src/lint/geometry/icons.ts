/**
 * Icon use diagnostics (#606, design doc `605-icon-label-nodes`): two info
 * rules that keep a figure's icons purposeful.
 *
 * - `geometry/icon-family-mix`: node icons from both bundled families, the
 *   outline Tabler set and the colour emoji set, in one figure.
 * - `geometry/icon-overuse`: icons on nearly every labelled node. An icon marks
 *   a concrete actor or object; on every box it stops telling them apart.
 *
 * Legend samples, tokens, matrix cells, captions and badges do not count.
 */

import { defineGeometryRule } from "../rule";
import type { GeometryContext, GeometryElement } from "./context";

/** Report when at least this many nodes show a label or an icon... */
export const ICON_OVERUSE_MIN_NODES = 6;
/** ...and at least this share of them draw an icon. */
export const ICON_OVERUSE_SHARE = 0.8;

const figureSubject = (context: GeometryContext) =>
  ({ kind: "figure", id: context.ir.meta.id }) as const;

/** Content nodes: drawn nodes with a label or an icon, apart from generated parts. */
function contentNodes(context: GeometryContext): GeometryElement[] {
  return context.elements.filter((e) => {
    const ir = e.ir;
    if (ir.kind !== "node") return false;
    if (ir.legend !== undefined || ir.tokens !== undefined || ir.matrix !== undefined) return false;
    if (ir.captionOf !== undefined) return false;
    return ir.icon !== undefined || ir.label.trim() !== "";
  });
}

function iconNodes(nodes: readonly GeometryElement[]): GeometryElement[] {
  return nodes.filter((e) => e.ir.kind === "node" && e.ir.icon !== undefined);
}

export const iconFamilyMix = defineGeometryRule({
  id: "geometry/icon-family-mix",
  description:
    "Node icons from both icon families (outline tabler/* and colour emoji/*) in one figure.",
  defaultSeverity: "info",
  fixable: false,
  run(context) {
    const withIcon = iconNodes(contentNodes(context));
    const tabler = withIcon.filter((e) => e.ir.kind === "node" && e.ir.icon?.set === "tabler");
    const emoji = withIcon.filter((e) => e.ir.kind === "node" && e.ir.icon?.set === "emoji");
    if (tabler.length === 0 || emoji.length === 0) return [];
    return [
      {
        message: `The figure mixes icon families: ${tabler.length} Tabler (outline) and ${emoji.length} emoji (colour) icons.`,
        path: ["figure", "layout"],
        subject: figureSubject(context),
        hint: 'Use one family per figure so the icons read as one set: Tabler for a quiet, theme-coloured look (it takes the text colour or a tone), emoji for friendly full-colour pictures. If the mix is intended (e.g. emoji for people, Tabler for tools), suppress with {"rules":{"geometry/icon-family-mix":"off"}}.',
        related: [...tabler.slice(0, 3), ...emoji.slice(0, 3)].map((e) => ({
          path: [...e.docPath, "icon"],
          message: `${e.name}: ${e.ir.kind === "node" ? `${e.ir.icon?.set}/${e.ir.icon?.name}` : ""}`,
        })),
      },
    ];
  },
});

export const iconOveruse = defineGeometryRule({
  id: "geometry/icon-overuse",
  description: `At least ${ICON_OVERUSE_SHARE * 100}% of ${ICON_OVERUSE_MIN_NODES}+ labelled or icon nodes draw an icon.`,
  defaultSeverity: "info",
  fixable: false,
  run(context) {
    const nodes = contentNodes(context);
    if (nodes.length < ICON_OVERUSE_MIN_NODES) return [];
    const withIcon = iconNodes(nodes);
    if (withIcon.length / nodes.length < ICON_OVERUSE_SHARE) return [];
    return [
      {
        message: `${withIcon.length} of ${nodes.length} nodes draw an icon: an icon on nearly every node stops telling them apart.`,
        path: ["figure", "layout"],
        subject: figureSubject(context),
        hint: 'Keep icons for the concrete actors and objects (a user, a database, a document, a tool, a GPU) and leave operations and abstract steps as plain labelled boxes. If every node is such an object, suppress with {"rules":{"geometry/icon-overuse":"off"}}.',
      },
    ];
  },
});
