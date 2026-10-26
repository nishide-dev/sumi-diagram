/**
 * Built-in MVP components (design doc §3). Generic shapes only; nothing here
 * is specific to a research field. D2 lowering (#8, #10) reads `shape`,
 * `direction`, `head` and `tail`; appearance per variant comes from Themes.
 */

import { z } from "zod";
import { SizeLength } from "./length";
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
  width: SizeLength.optional().describe(
    'Explicit width as a length such as "30mm" or "40pt" (a multiple of 0.5pt). Omitted means sized to the label.',
  ),
  height: SizeLength.optional().describe(
    'Explicit height as a length such as "10mm" or "20pt" (a multiple of 0.5pt). Omitted means sized to the label.',
  ),
});

// Sizes parse to exact multiples of 0.5pt, so comparing them is exact.
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

function outline(name: "trapezoid" | "stack", description: string): NodeManifest {
  return {
    ...node(name, "rectangle", description),
    since: "0.3.0",
    render: { type: "outline", renderer: `sumi/${name}` },
  };
}

/** Glyphs of `sumi/operator`, by `symbol` (all in the bundled font set). */
export const OPERATOR_GLYPHS = {
  plus: "+",
  minus: "−", // − MINUS SIGN
  times: "×", // × MULTIPLICATION SIGN
  dot: "•", // • BULLET
  concat: "‖", // ‖ DOUBLE VERTICAL LINE
} as const;

const operator: NodeManifest = {
  ...base,
  since: "0.4.0",
  kind: "node",
  name: "operator",
  description:
    "A small circle with an operator symbol, e.g. where inputs are added or combined; takes no label.",
  variants: NODE_VARIANTS,
  props: z.strictObject({
    symbol: z
      .enum(Object.keys(OPERATOR_GLYPHS) as [keyof typeof OPERATOR_GLYPHS])
      .describe(
        "The operator drawn in the circle: plus (+), minus (−), times (×), dot (•) or concat (‖).",
      ),
  }),
  shape: "circle",
  sizing: "fixed-aspect-1",
  // Twice the font size: the glyph's advance box (up to 1em square) fits the
  // inscribed circle with room for the outline.
  mark: { type: "glyph", prop: "symbol", glyphs: OPERATOR_GLYPHS, size: 2 },
};

const junction: NodeManifest = {
  ...base,
  since: "0.4.0",
  kind: "node",
  name: "junction",
  description:
    "A point where lines branch or merge, drawn as a small dot; takes no label and no tone.",
  variants: ["default", "muted"],
  props: noProps,
  shape: "circle",
  sizing: "fixed-aspect-1",
  // Three stroke widths: a dot that scales with the theme's line weight.
  mark: { type: "point", size: 3 },
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
  outline("trapezoid", "A trapezoid with a wider top and a narrower bottom."),
  outline("stack", "Three overlapping rectangles, e.g. for a collection of documents or layers."),
  node("label", "text", "Text without a border.", { variants: ["default", "muted"] }),
  operator,
  junction,
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
