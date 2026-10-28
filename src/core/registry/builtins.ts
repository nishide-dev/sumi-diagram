/**
 * Built-in MVP components (design doc §3). Generic shapes only; nothing here
 * is specific to a research field. D2 lowering (#8, #10) reads `shape`,
 * `direction`, `head` and `tail`; appearance per variant comes from Themes.
 */

import { z } from "zod";
import { ARRANGE_ALIGNS, ID_PATTERN, LayoutLength } from "../figure/schema";
import { TONE_NAMES } from "../theme/tones";
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
  description:
    "A rectangular container that groups nodes and other groups, always with a border. Variant muted: a dashed border in academic (easy to confuse with dashed edges), a white background instead of the shaded fill (without a tone) and a gray title in the other themes.",
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

/** Canonical ID of the legend (#131): the one component the `check` stages expand. */
export const LEGEND_ID = "sumi/legend";

/** Most entries a legend takes: keeps the reserved IDs of its parts short (`<id>-20-label`). */
export const LEGEND_MAX_ENTRIES = 20;

const ComponentField = z.string().min(1);
const VariantField = z.string().min(1);

const legendEntry = z
  .strictObject({
    edge: z
      .strictObject({
        component: ComponentField.optional().describe(
          "The edge component of the sample line, as on an edge. Omitted means arrow.",
        ),
        variant: VariantField.optional().describe(
          "The variant of the sample line, as on an edge. Omitted means default.",
        ),
      })
      .optional()
      .describe(
        "Draws a sample line with these edge fields: the same dash, arrowheads and line width as the edges that use them.",
      ),
    node: z
      .strictObject({
        component: ComponentField.optional().describe(
          "The node component of the sample box, as on a node; a shape such as box or circle. Omitted means box.",
        ),
        variant: VariantField.optional().describe(
          "The variant of the sample box, as on a node. Omitted means default.",
        ),
        tone: z
          .enum(TONE_NAMES)
          .optional()
          .describe("The tone of the sample box, as on a node. Omitted means none."),
      })
      .optional()
      .describe(
        "Draws a small sample box with these node fields: the same fill and outline as the nodes that use them.",
      ),
    label: z
      .string()
      .min(1)
      .describe("What the sample means, drawn to its right (a label; math allowed)."),
  })
  .refine((entry) => (entry.edge === undefined) !== (entry.node === undefined), {
    error: 'an entry needs exactly one of "edge" or "node"',
  });

const legend: NodeManifest = {
  ...base,
  since: "0.5.0",
  kind: "node",
  name: "legend",
  description:
    "A key that explains line and fill styles: one sample line or box per entry, drawn with the same fields as the edges or nodes it explains, followed by its text (structured layout only).",
  variants: ["default", "plain"],
  props: z.strictObject({
    entries: z
      .array(legendEntry)
      .min(1)
      .max(LEGEND_MAX_ENTRIES)
      .describe(
        "The entries, top to bottom. Each has edge (a sample line) or node (a sample box), and a label.",
      ),
  }),
  shape: "rectangle",
  sizing: "auto",
  engines: ["structured"],
};

/** Canonical ID of the tokens component (#181): expanded into one node per cell. */
export const TOKENS_ID = "sumi/tokens";

/** Directions a tokens node lays its cells out in (#181): as a row or as a stack. */
export const TOKENS_DIRECTIONS = ["right", "left", "down", "up"] as const;

const tokenCellFields = {
  component: ComponentField.optional().describe(
    "The node component of the cell, e.g. box, square or label (a cell without a border, such as an ellipsis). Omitted means the tokens' component.",
  ),
  variant: VariantField.optional().describe(
    "The variant of the cell, as on a node. Omitted means the tokens' variant.",
  ),
  width: SizeLength.optional().describe(
    "The width of the cell, as a node's width prop. Omitted means the tokens' width.",
  ),
  height: SizeLength.optional().describe(
    "The height of the cell, as a node's height prop. Omitted means the tokens' height.",
  ),
};

const tokenCell = z.union([
  z.string().describe("A cell with this label (math allowed); the other fields as the tokens'."),
  z.strictObject({
    id: z
      .string()
      .regex(ID_PATTERN)
      .optional()
      .describe(
        "The cell's name: edges address it as <node>.<id>, and it is drawn as the node <node>-<id>. Omitted means its 1-based position (<node>.3, <node>-3).",
      ),
    label: z.string().optional().describe("The cell's text (math allowed). Omitted means none."),
    tone: z
      .enum(TONE_NAMES)
      .optional()
      .describe("The tone of the cell, as on a node. Omitted means the tokens node's tone."),
    ...tokenCellFields,
  }),
]);

const tokens: NodeManifest = {
  ...base,
  since: "0.6.0",
  kind: "node",
  name: "tokens",
  description:
    "A sequence of cells side by side, e.g. tokens or keys, each drawn as its own node that edges address as <node>.<cell> (structured layout only).",
  variants: ["default"],
  props: z
    .strictObject({
      cells: z
        .array(tokenCell)
        .min(1)
        .optional()
        .describe(
          "The cells in order: labels, or objects with id, label, tone, component, variant, width and height.",
        ),
      lines: z
        .array(z.array(tokenCell).min(1))
        .min(1)
        .optional()
        .describe(
          "Instead of cells: several lines of cells, each laid out in direction, the lines placed across it (below one another for right / left), e.g. keys [[W], [A, S, D]]. Cells are numbered across the lines.",
        ),
      direction: z
        .enum(TOKENS_DIRECTIONS)
        .default("right")
        .describe("Where the cells run: right, left (a row), down or up (a stack)."),
      gap: LayoutLength.optional().describe(
        "Space between cells, as an arrange gap. Omitted means the layout default.",
      ),
      align: z
        .enum(ARRANGE_ALIGNS)
        .optional()
        .describe(
          "Cross-axis alignment of the cells, as in an arrange box. Omitted inherits from the enclosing box.",
        ),
      lineGap: LayoutLength.optional().describe(
        "Space between lines (with lines). Omitted means gap.",
      ),
      lineAlign: z
        .enum(ARRANGE_ALIGNS)
        .optional()
        .describe(
          "Alignment of the lines across them, e.g. center to centre a short line (with lines). Omitted inherits from the enclosing box.",
        ),
      component: ComponentField.default("box").describe(
        "The node component of every cell. Omitted means box.",
      ),
      variant: VariantField.optional().describe(
        "The variant of every cell. Omitted means default.",
      ),
      width: SizeLength.optional().describe(
        "The width of every cell. Omitted means sized to its label.",
      ),
      height: SizeLength.optional().describe(
        "The height of every cell. Omitted means sized to its label.",
      ),
    })
    .refine((props) => (props.cells === undefined) !== (props.lines === undefined), {
      error: 'tokens need exactly one of "cells" or "lines"',
    }),
  shape: "rectangle",
  sizing: "auto",
  engines: ["structured"],
};

/**
 * A zoom callout (#176, design doc §6.45): two straight lines from corners of
 * the source to the matching corners of the target, which shows the source
 * enlarged. Not routed; dashed by default in every theme.
 */
const zoom: EdgeManifest = {
  ...base,
  since: "0.6.0",
  kind: "edge",
  name: "zoom",
  description:
    "Two straight lines joining the corners of the source to the matching corners of the target, which shows the source zoomed in (structured layout only; no label, no arrowheads).",
  variants: ["default", "solid", "muted"],
  props: noProps,
  direction: "none",
  routing: "zoom",
  engines: ["structured"],
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
  legend,
  tokens,
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
  zoom,
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
