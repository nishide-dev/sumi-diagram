/**
 * Built-in MVP components (design doc §3). Generic shapes only; nothing here
 * is specific to a research field. D2 lowering (#8, #10) reads `shape`,
 * `direction`, `head` and `tail`; appearance per variant comes from Themes.
 */

import { z } from "zod";
import { PositiveLength } from "./length";
import {
  BUILTIN_NAMESPACE,
  type ComponentManifest,
  type EdgeManifest,
  type GroupManifest,
  MANIFEST_VERSION,
  type NodeManifest,
  type NodeShape,
  type NodeSizing,
} from "./manifest";
import { Registry } from "./registry";

const SINCE = "0.1.0";
const NODE_VARIANTS = ["default", "emphasis", "muted"];
const EDGE_VARIANTS = ["default", "dashed", "emphasis", "muted"];

const sizeProps = z.strictObject({
  width: PositiveLength.optional().describe(
    'Explicit width in pt, or a length such as "30mm". Omitted means sized to the label.',
  ),
  height: PositiveLength.optional().describe(
    'Explicit height in pt, or a length such as "10mm". Omitted means sized to the label.',
  ),
});

const squareSizeProps = sizeProps.refine(
  ({ width, height }) => width === undefined || height === undefined || width === height,
  { error: "width and height must be equal for a fixed aspect ratio", path: ["height"] },
);

const noProps = z.strictObject({});

const base = { version: MANIFEST_VERSION, namespace: BUILTIN_NAMESPACE, since: SINCE } as const;

function node(
  name: string,
  shape: NodeShape,
  description: string,
  options: { sizing?: NodeSizing; variants?: string[] } = {},
): NodeManifest {
  const { sizing = "auto", variants = NODE_VARIANTS } = options;
  return {
    ...base,
    kind: "node",
    name,
    description,
    variants,
    props: sizing === "auto" ? sizeProps : squareSizeProps,
    shape,
    sizing,
  };
}

function edge(
  name: string,
  description: string,
  arrows: Pick<EdgeManifest, "direction" | "head" | "tail">,
): EdgeManifest {
  return {
    ...base,
    kind: "edge",
    name,
    description,
    variants: EDGE_VARIANTS,
    props: noProps,
    ...arrows,
  };
}

const container: GroupManifest = {
  ...base,
  kind: "group",
  name: "container",
  description: "A rectangular container that groups nodes and other groups.",
  variants: ["default", "muted"],
  props: noProps,
  shape: "rectangle",
};

/** The built-in manifests, in catalog order. */
export const BUILTIN_MANIFESTS: readonly ComponentManifest[] = [
  node("box", "rectangle", "A rectangle; the general-purpose node."),
  node("square", "square", "A square.", { sizing: "fixed-aspect-1" }),
  node("circle", "circle", "A circle.", { sizing: "fixed-aspect-1" }),
  node("ellipse", "oval", "An ellipse."),
  node("diamond", "diamond", "A diamond, e.g. for decisions."),
  node("hexagon", "hexagon", "A hexagon."),
  node("parallelogram", "parallelogram", "A parallelogram, e.g. for input or output."),
  node("cylinder", "cylinder", "A cylinder, e.g. for storage."),
  node("document", "document", "A page with a wavy bottom edge, e.g. for documents."),
  node("label", "text", "Text without a border.", { variants: ["default", "muted"] }),
  container,
  edge("arrow", "A line with an arrowhead at the target.", {
    direction: "forward",
    head: "triangle",
  }),
  edge("line", "A line without arrowheads.", { direction: "none" }),
  edge("double-arrow", "A line with arrowheads at both ends.", {
    direction: "both",
    head: "triangle",
    tail: "triangle",
  }),
];

/** A new registry containing the built-in components. */
export function createBuiltinRegistry(): Registry {
  const registry = new Registry();
  for (const manifest of BUILTIN_MANIFESTS) {
    const result = registry.register(manifest);
    if (!result.ok) {
      const messages = result.diagnostics.map((d) => d.message).join(" ");
      throw new Error(`internal error: invalid built-in component: ${messages}`);
    }
  }
  return registry;
}
