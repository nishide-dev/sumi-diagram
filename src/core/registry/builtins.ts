/**
 * Built-in MVP components (design doc §3). Generic shapes only; nothing here
 * is specific to a research field. D2 lowering (#8, #10) reads `shape`,
 * `direction`, `head` and `tail`; appearance per variant comes from Themes.
 */

import { z } from "zod";
import { didYouMean } from "../diagnostics";
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
/**
 * The variants of every shape node. `outlined` (#177, design doc §6.54)
 * draws the page's background with the outline and text in a tone's line
 * color, so a tone colors the frame and text instead of the fill.
 * `solid` adds an ink fill with white text; `tinted` combines a pastel fill
 * with matching ink for the border and text (#214, design doc §6.63).
 */
const NODE_VARIANTS = ["default", "emphasis", "muted", "outlined", "solid", "tinted"];
/**
 * The variants of the shapes that read as a filled area (#174): `filled`
 * draws the fill without the outline. `stack` is left out, since its
 * outlines are what separate the overlapping rectangles.
 */
const FILLABLE_NODE_VARIANTS = [
  "default",
  "emphasis",
  "muted",
  "filled",
  "outlined",
  "solid",
  "tinted",
];
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
  const { sizing = "auto", variants = FILLABLE_NODE_VARIANTS } = options;
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
    "A rectangular container that groups nodes and other groups. Variant muted: a dashed border in academic (easy to confuse with dashed edges), a white background instead of the shaded fill (without a tone) and a gray title in the other themes. Variant plain: no border and no fill, only the title or caption; filled: a shaded fill without a border; dashed: a dashed border without a fill. A tone sets the fill of any variant.",
  variants: ["default", "muted", "plain", "filled", "dashed"],
  props: noProps,
  shape: "rectangle",
};

function outline(name: "trapezoid" | "stack" | "bowtie", description: string): NodeManifest {
  return {
    ...node(name, "rectangle", description, {
      variants: name === "stack" ? NODE_VARIANTS : FILLABLE_NODE_VARIANTS,
    }),
    since: name === "bowtie" ? "0.7.0" : "0.3.0",
    props:
      name === "bowtie"
        ? sizeProps.extend({
            gap: z
              .number()
              .finite()
              .min(0)
              .max(64)
              .optional()
              .describe(
                "Horizontal separation of the two tapered halves in D2 units (0.5pt each), from 0 to 64; omitted or 0 keeps the joined silhouette. One label is centered across both halves and the gap when readable on the page; low-contrast text (including solid) sits on the sized left painted body. Borderless filled may overlay the bodies, while stroked outline crossings are reported by geometry lint. Clamped to half the drawn width for small explicit sizes.",
              ),
          })
        : name === "trapezoid"
          ? sizeProps.extend({
              narrow: z
                .enum(["south", "north", "east", "west"])
                .optional()
                .describe("Side with the narrow parallel edge; omitted means south (wide top)."),
            })
          : sizeProps,
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
  variants: FILLABLE_NODE_VARIANTS,
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
    "A PNG, JPEG or SVG file embedded as it is, optionally stacked with up-right copies; takes no label.",
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
      layers: z
        .strictObject({
          count: z.int().min(1).max(16).describe("Total images, including the front image (1–16)."),
          offset: SizeLength.describe(
            'Positive distance up and right between copies, e.g. "3pt" (a multiple of 0.5pt).',
          ),
        })
        .optional()
        .describe(
          "Repeat the unchanged image behind the front one, offset up-right. Width and height size each copy; the node footprint includes the whole stack.",
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

/**
 * A legend entry's matrix class (#180): `<matrix>.<class>`, the matrix's ID
 * and one of its class names (which may itself contain dots).
 */
export const LEGEND_CLASS_PATTERN = /^[a-z][a-z0-9_-]{0,63}\.\S{1,16}$/;
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
        tone: z
          .enum(TONE_NAMES)
          .optional()
          .describe("The tone of the sample line, as on an edge. Omitted means none."),
      })
      .optional()
      .describe(
        "Draws a sample line with these edge fields: the same dash, arrowheads, line width and color as the edges that use them.",
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
        "Draws a small sample box with these node fields: the same fill, outline and text color as the nodes that use them.",
      ),
    class: z
      .string()
      .regex(LEGEND_CLASS_PATTERN)
      .optional()
      .describe(
        "Draws the sample box of a class of a matrix, as <matrix>.<class>, e.g. mask.o: the class's tone, variant and hatch pattern. The label defaults to the class's label.",
      ),
    label: z
      .string()
      .min(1)
      .optional()
      .describe(
        "What the sample means, drawn to its right (a label; math allowed). Required, except that a class entry defaults to its class's label.",
      ),
  })
  .superRefine((entry, ctx) => {
    if (entry.label === undefined && entry.class === undefined) {
      // As the message of a missing required string, which label was before #180.
      ctx.addIssue({
        code: "custom",
        path: ["label"],
        message: "Invalid input: expected string, received undefined",
      });
      return;
    }
    const kinds = [entry.edge, entry.node, entry.class].filter((k) => k !== undefined).length;
    if (kinds !== 1) {
      ctx.addIssue({
        code: "custom",
        message: 'an entry needs exactly one of "edge", "node" or "class"',
      });
    }
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
        "The entries, top to bottom. Each has edge (a sample line), node (a sample box) or class (the sample box of a matrix class), and a label.",
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
    separator: z
      .literal("dotted")
      .describe("A dotted divider perpendicular to the token direction."),
    id: z
      .string()
      .regex(ID_PATTERN)
      .optional()
      .describe("The separator cell's name, as for other cells."),
    tone: z
      .enum(TONE_NAMES)
      .optional()
      .describe("The divider's line tone. Omitted inherits the tokens' tone."),
    width: SizeLength.optional().describe(
      "Reserved cell width. Defaults to 6pt for a row, or the tokens' width (14pt if omitted) for a stack.",
    ),
    height: SizeLength.optional().describe(
      "Reserved cell height. Defaults to the tokens' height (14pt if omitted) for a row, or 6pt for a stack.",
    ),
  }),
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
          "The cells in order: labels, objects with id, label, tone, component, variant, width and height, or { separator: dotted, id?, tone?, width?, height? } divider cells (since 0.7.0). Dividers count in positional cell references.",
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

/** Canonical ID of the matrix component (#180): expanded into a frame of header labels and cells. */
export const MATRIX_ID = "sumi/matrix";

/** Most rows or columns a matrix takes: keeps its reserved IDs short (`<id>-64-64`). */
export const MATRIX_MAX_SIDE = 64;

/** Where a matrix draws its row headers (#180). */
export const MATRIX_ROW_HEADER_SIDES = ["left", "right"] as const;
/** Where a matrix draws its column headers (#180). */
export const MATRIX_COLUMN_HEADER_SIDES = ["top", "bottom"] as const;
/** Fill patterns of a matrix class (#180): `hatch` draws diagonal lines over the fill. */
export const MATRIX_PATTERNS = ["hatch"] as const;

/** A class name of a matrix (#180): one to 16 characters without whitespace, e.g. `o`, `.` or `masked`. */
export const MATRIX_CLASS_PATTERN = /^\S{1,16}$/;

/**
 * The class names of a row of a matrix's `cells` (#180): a list as written;
 * a string split at whitespace, or, when every class name is one character
 * long, its characters (whitespace ignored), e.g. `"o..L"`.
 */
export function matrixRowClasses(
  row: string | readonly string[],
  classes: readonly string[],
): string[] {
  if (typeof row !== "string") return [...row];
  if (classes.length > 0 && classes.every((c) => Array.from(c).length === 1)) {
    return Array.from(row.replace(/\s+/g, ""));
  }
  return row.split(/\s+/).filter((c) => c !== "");
}

/** An ellipsis symbol of a matrix cell (#280): horizontal, vertical or diagonal dots. */
export const MATRIX_ELLIPSES = ["…", "⋮", "⋱"] as const;

/** One cell of a row of a matrix written as a list (#280). */
export interface MatrixEntry {
  /** The cell's class; omitted only on an ellipsis cell. */
  class?: string | undefined;
  /** Text drawn in the cell (math allowed). */
  text?: string | undefined;
  /** Draws only this symbol instead of a bordered cell. */
  ellipsis?: (typeof MATRIX_ELLIPSES)[number] | undefined;
}

/**
 * The cells of a row of a matrix's `cells` (#280) as entries: a class name is
 * `{ class }`, an object is itself (see {@link matrixRowClasses} for how a
 * string is split).
 */
export function matrixRowEntries(
  row: string | readonly (string | MatrixEntry)[],
  classes: readonly string[],
): MatrixEntry[] {
  if (typeof row === "string") return matrixRowClasses(row, classes).map((c) => ({ class: c }));
  return row.map((entry) => (typeof entry === "string" ? { class: entry } : entry));
}

const matrixCell = z
  .strictObject({
    class: z
      .string()
      .regex(MATRIX_CLASS_PATTERN)
      .optional()
      .describe("The cell's class. Omitted only with ellipsis."),
    text: z
      .string()
      .min(1)
      .optional()
      .describe("Text in the cell (math allowed), e.g. '$I_1\\cdot T_2$'."),
    ellipsis: z
      .enum(MATRIX_ELLIPSES)
      .optional()
      .describe(
        "Draws only this symbol (… ⋮ ⋱) in the cell's slot: no border, fill or hatch, and the cell's size is kept.",
      ),
  })
  .superRefine((cell, ctx) => {
    if (cell.class === undefined && cell.ellipsis === undefined) {
      ctx.addIssue({ code: "custom", message: "a cell needs a class (or ellipsis)" });
    }
    if (cell.text !== undefined && cell.ellipsis !== undefined) {
      ctx.addIssue({ code: "custom", message: "a cell has text or ellipsis, not both" });
    }
  });

const matrixHeader = z.union([
  z.string().min(1).describe("A header with this text (math allowed)."),
  z.strictObject({
    label: z.string().min(1).describe("The header's text (math allowed)."),
    tone: z
      .enum(TONE_NAMES)
      .optional()
      .describe(
        "Draws the text in the tone's line color (toneLines), e.g. to color a group of headers.",
      ),
  }),
]);

const matrixClass = z.strictObject({
  tone: z
    .enum(TONE_NAMES)
    .optional()
    .describe("The tone of the class's cells, as on a node. Omitted means none."),
  variant: VariantField.optional().describe(
    "The variant of the class's cells, as on a box (e.g. filled or outlined). Omitted means the matrix's variant.",
  ),
  pattern: z
    .enum(MATRIX_PATTERNS)
    .optional()
    .describe(
      "hatch: diagonal lines over the cell's fill, in the tone's line color (gray's without a tone), e.g. for masked entries. Omitted means the fill alone.",
    ),
  label: z
    .string()
    .min(1)
    .optional()
    .describe(
      "What the class means, the text of a legend entry { class: <matrix>.<class> } (math allowed).",
    ),
});

const matrix: NodeManifest = {
  ...base,
  since: "0.6.0",
  kind: "node",
  name: "matrix",
  description:
    "A grid of cells colored by class, e.g. an attention mask or a similarity matrix, with optional row and column headers, cell text and ellipsis rows, columns and cells; each class is a tone, a variant and a hatch pattern, and a legend explains it as { class: <matrix>.<class> } (structured layout only).",
  variants: ["default"],
  props: z
    .strictObject({
      cells: z
        .array(
          z.union([
            z.string(),
            z.array(z.union([z.string().regex(MATRIX_CLASS_PATTERN), matrixCell])).min(1),
          ]),
        )
        .min(1)
        .max(MATRIX_MAX_SIDE)
        .describe(
          'The rows, top to bottom, each the class names of its cells from left to right: a list, or a string of names separated by spaces (when every class name is one character, the characters themselves, e.g. "o..L"). In a list a cell may also be { class, text } (text drawn in the cell, math allowed) or { ellipsis: "…" | "⋮" | "⋱" } (only the symbol). Every row has the same number of cells.',
        ),
      ellipsisRows: z
        .array(z.number().int().min(1).max(MATRIX_MAX_SIDE))
        .min(1)
        .optional()
        .describe(
          "1-based rows drawn as ellipsis: every cell shows ⋮ (⋱ where it crosses an ellipsis column) with no border or fill, at the cells' size. The written class there is not drawn.",
        ),
      ellipsisColumns: z
        .array(z.number().int().min(1).max(MATRIX_MAX_SIDE))
        .min(1)
        .optional()
        .describe(
          "1-based columns drawn as ellipsis: every cell shows … (⋱ where it crosses an ellipsis row) with no border or fill, at the cells' size.",
        ),
      classes: z
        .record(z.string().regex(MATRIX_CLASS_PATTERN), matrixClass)
        .refine((classes) => Object.keys(classes).length > 0, {
          error: "a matrix needs at least one class",
        })
        .describe(
          "The classes by name (1 to 16 characters without spaces): each a tone, a variant and a pattern for its cells, and a label for a legend.",
        ),
      rows: z
        .array(matrixHeader)
        .optional()
        .describe(
          "The row headers, one per row: text, or { label, tone }. Omitted means no row headers.",
        ),
      columns: z
        .array(matrixHeader)
        .optional()
        .describe(
          "The column headers, one per column: text, or { label, tone }. Omitted means no column headers.",
        ),
      corner: z
        .string()
        .min(1)
        .optional()
        .describe(
          'Text in the corner between the row and the column headers, e.g. "Q / K" (needs both). Omitted means none.',
        ),
      rowsAt: z
        .enum(MATRIX_ROW_HEADER_SIDES)
        .default("left")
        .describe("The side of the row headers: left or right."),
      columnsAt: z
        .enum(MATRIX_COLUMN_HEADER_SIDES)
        .default("top")
        .describe("The side of the column headers: top or bottom."),
      cellWidth: SizeLength.optional().describe(
        "The width of every cell (and column header). Omitted means 10pt.",
      ),
      cellHeight: SizeLength.optional().describe(
        "The height of every cell. Omitted means the cell width.",
      ),
      gap: LayoutLength.optional().describe(
        "Space between neighboring cells, across and down. Omitted means 0 (cells touch).",
      ),
      headerGap: LayoutLength.optional().describe(
        "Space between the headers and the cells. Omitted means gap.",
      ),
      headerWidth: SizeLength.optional().describe(
        "The width of every row header. Omitted means each is as wide as its text (aligned to the cells).",
      ),
      variant: VariantField.optional().describe(
        "The variant of every cell, as on a box (a class's variant overrides it). Omitted means default.",
      ),
      flush: z
        .boolean()
        .optional()
        .describe(
          "true: no group padding around the cells, so neighboring elements (e.g. a header row of tokens) touch the matrix's edge. Needs a matrix without a label. Omitted means the profile's group padding.",
        ),
    })
    .superRefine((props, ctx) => {
      const issue = (path: (string | number)[], message: string, hint?: string) =>
        ctx.addIssue({
          code: "custom",
          path,
          message,
          ...(hint !== undefined && { params: { hint } }),
        });
      const names = Object.keys(props.classes ?? {});
      if (names.length === 0 || !Array.isArray(props.cells)) return;
      let width: number | undefined;
      for (const [r, row] of props.cells.entries()) {
        const entries = matrixRowEntries(row, names);
        for (const [c, entry] of entries.entries()) {
          const name = entry.class;
          if (name === undefined || names.includes(name)) continue;
          issue(
            typeof row === "string"
              ? ["cells", r]
              : [...["cells", r, c], ...(typeof row[c] === "string" ? [] : ["class"])],
            `cell ${c + 1} of row ${r + 1} has the unknown class "${name}"`,
            didYouMean(name, names) ?? `Classes of the matrix: ${names.join(", ")}.`,
          );
          break;
        }
        if (entries.length === 0) {
          issue(["cells", r], `row ${r + 1} has no cells`);
        } else if (entries.length > MATRIX_MAX_SIDE) {
          issue(
            ["cells", r],
            `row ${r + 1} has ${entries.length} cells, more than ${MATRIX_MAX_SIDE}`,
          );
        } else if (width === undefined) {
          width = entries.length;
        } else if (entries.length !== width) {
          issue(
            ["cells", r],
            `row ${r + 1} has ${entries.length} cells, but row 1 has ${width}`,
            "Give every row of a matrix the same number of cells.",
          );
        }
      }
      for (const [prop, limit, what] of [
        ["ellipsisRows", props.cells.length, "rows"],
        ["ellipsisColumns", width, "columns"],
      ] as const) {
        const list = props[prop];
        if (list === undefined || limit === undefined) continue;
        for (const [i, n] of list.entries()) {
          if (n > limit) {
            issue([prop, i], `${prop} names ${n}, but the matrix has ${limit} ${what}`);
          } else if (list.indexOf(n) !== i) {
            issue([prop, i], `${prop} names ${n} twice`);
          }
        }
      }
      for (const [r, row] of props.cells.entries()) {
        if (typeof row === "string") continue;
        for (const [c, entry] of row.entries()) {
          if (typeof entry === "string" || entry.text === undefined) continue;
          if (props.ellipsisRows?.includes(r + 1) || props.ellipsisColumns?.includes(c + 1)) {
            issue(
              ["cells", r, c, "text"],
              `cell ${c + 1} of row ${r + 1} has text, but its row or column is an ellipsis`,
              "Remove the text, or take the row or column out of ellipsisRows / ellipsisColumns.",
            );
          }
        }
      }
      if (props.rows !== undefined && props.rows.length !== props.cells.length) {
        issue(
          ["rows"],
          `${props.rows.length} row headers for ${props.cells.length} rows`,
          "Give one row header per row of cells.",
        );
      }
      if (props.columns !== undefined && width !== undefined && props.columns.length !== width) {
        issue(
          ["columns"],
          `${props.columns.length} column headers for ${width} columns`,
          "Give one column header per cell of a row.",
        );
      }
      if (props.corner !== undefined && (props.rows === undefined || props.columns === undefined)) {
        issue(
          ["corner"],
          "a corner needs both row and column headers",
          "Add rows and columns, or remove corner.",
        );
      }
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
  outline("bowtie", "A bowtie silhouette with two opposing tapered halves and a central waist."),
  outline("stack", "Three overlapping rectangles, e.g. for a collection of documents or layers."),
  node("label", "text", "Text without a border.", { variants: ["default", "muted"] }),
  operator,
  junction,
  image,
  legend,
  tokens,
  matrix,
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
