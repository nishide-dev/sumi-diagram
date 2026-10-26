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
  IMAGE_FITS,
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
    "A point where lines branch or merge, drawn as a small dot (variant hidden: no dot, for a smooth split or a line that ends in open space); takes no label and no tone.",
  variants: ["default", "muted", "hidden"],
  props: noProps,
  shape: "circle",
  sizing: "fixed-aspect-1",
  // Three stroke widths: a dot that scales with the theme's line weight.
  mark: { type: "point", size: 3 },
};

export { IMAGE_FITS };

const image: NodeManifest = {
  ...base,
  since: "0.4.0",
  kind: "node",
  name: "image",
  description:
    "A PNG, JPEG or SVG file embedded as it is and scaled to the node's box; takes no label.",
  variants: ["default", "framed"],
  props: z
    .strictObject({
      src: z
        .string()
        .min(1)
        .describe(
          'Path of the image file relative to the figure\'s YAML file, with "/" between directories, e.g. "img/photo.png". Absolute paths, URLs and paths outside that directory are not allowed.',
        ),
      sha256: z
        .string()
        .regex(/^[0-9a-fA-F]{64}$/)
        .optional()
        .describe(
          "Expected sha256 of the file in hex. Rendering fails if the file has changed. Omitted means not checked.",
        ),
      fit: z
        .enum(IMAGE_FITS)
        .default("contain")
        .describe(
          "contain: the whole image, centered, keeping its aspect ratio (the default). cover: fills the box, keeping the aspect ratio and clipping the overflow. fill: stretched to the box.",
        ),
      width: SizeLength.optional().describe(
        'Width as a length such as "30mm" (a multiple of 0.5pt). Omitted means from the height and the image\'s aspect ratio.',
      ),
      height: SizeLength.optional().describe(
        'Height as a length such as "20mm" (a multiple of 0.5pt). Omitted means from the width and the image\'s aspect ratio.',
      ),
    })
    .refine(({ width, height }) => width !== undefined || height !== undefined, {
      error: "an image needs a width or a height (or both)",
      path: ["width"],
    }),
  shape: "rectangle",
  sizing: "auto",
  embed: "image",
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
  image,
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

/**
 * A new, mutable registry containing the built-in components. Use it when
 * custom components are registered on top; read-only callers should share
 * {@link builtinRegistry} instead.
 */
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

let shared: Registry | undefined;

/**
 * The shared, sealed registry of the built-in components: built on first use
 * and reused afterwards (#106). It is sealed (see {@link Registry.seal}):
 * registering into it throws and its manifest data is frozen, so callers
 * cannot change what later calls see. The `props` schemas are not frozen and
 * must be treated as immutable.
 */
export function builtinRegistry(): Registry {
  shared ??= createBuiltinRegistry().seal();
  return shared;
}
