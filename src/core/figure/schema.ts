/**
 * Figure Schema v1 (design doc §2.2). The Zod schemas are the single source of
 * truth for both validation and `schema/figure.v1.schema.json`.
 *
 * Output types are normalized: every defaulted field is filled in.
 */

import { validRange } from "semver";
import { z } from "zod";
import { ICON_REF_MAX_LENGTH, ICON_REF_PATTERN } from "../../assets/icon-ref";
import { PALETTE_NAMES } from "../theme/palette";
import { TONE_NAMES } from "../theme/tones";
import { MAX_LENGTH_PT, parseLength } from "../units";

/** Element ID: lowercase only, because D2 keys are case-insensitive. */
export const ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;

export const FIGURE_SCHEMA_VERSION = 1;

export const LAYOUT_DIRECTIONS = ["right", "down", "left", "up"] as const;

/**
 * A reference to a node or group: its ID, or a cell of a `tokens` node as
 * `<node>.<cell>` (#181, design doc §6.50), where the cell is the cell's `id`
 * or, for a cell without one, its 1-based position. Edge endpoints,
 * `attach.to` and `figure.layout.align` items take references; the `tokens`
 * expansion resolves cell references to the cells' reserved IDs.
 */
export const REF_PATTERN =
  /^[a-z][a-z0-9_-]{0,63}(?:\.(?:[a-z][a-z0-9_-]{0,63}|[1-9][0-9]{0,3}))?$/;

/** The element a reference names: the node of a cell reference, otherwise the reference. */
export function refOwner(ref: string): string {
  const dot = ref.indexOf(".");
  return dot < 0 ? ref : ref.slice(0, dot);
}

/** The cell part of a cell reference `<node>.<cell>`, or `undefined` for a plain ID. */
export function refCell(ref: string): string | undefined {
  const dot = ref.indexOf(".");
  return dot < 0 ? undefined : ref.slice(dot + 1);
}

const Id = z.string().regex(ID_PATTERN);
const Ref = z.string().regex(REF_PATTERN);
const ComponentRef = z.string().min(1);
const Label = z
  .string()
  .default("")
  .describe("Plain text; newlines break lines. Empty or omitted means no label.");
const Variant = z.string().min(1).default("default");
const Tone = z
  .enum(TONE_NAMES)
  .optional()
  .describe(
    "Color category from the theme's palette (e.g. a pastel fill in the color theme, a gray step in monochrome themes). With variant outlined it colors the outline and text instead of the fill. Omitted means none.",
  );
const Props = z
  .record(z.string(), z.unknown())
  .prefault({})
  .describe("Component props, validated against the component manifest.");

export const SemverRange = z
  .string()
  .min(1)
  .refine((range) => validRange(range) !== null, { message: "Invalid semver range" });

export const JsonValue = z.json().meta({ id: "JsonValue" });

/**
 * Layout engines (design doc §6.19): `auto` lays the figure out with D2/ELK;
 * `structured` places elements by the `arrange` trees and `attach` (#86).
 */
export const LAYOUT_ENGINES = ["auto", "structured"] as const;
export type LayoutEngine = (typeof LAYOUT_ENGINES)[number];

/**
 * How edges from different elements that enter the same point of an element
 * (a fan-in) are drawn in structured layout (#134, design doc §6.33): `merge`
 * joins them into one line before the port (the default), `spread` places
 * them side by side along the side, in the order of their other ends.
 */
export const FAN_IN_MODES = ["merge", "spread"] as const;
export type FanInMode = (typeof FAN_IN_MODES)[number];

/**
 * `figure.layout.alignGrowth` (#333): `report` (default) keeps the info
 * `layout/align-grew-figure`; `allow` says the growth is intended and
 * silences it.
 */
export const ALIGN_GROWTH_MODES = ["report", "allow"] as const;
export type AlignGrowthMode = (typeof ALIGN_GROWTH_MODES)[number];

/**
 * How a figure wider than its profile's maximum width is printed (#183,
 * design doc §6.48): `scale` shrinks the whole output, layout unchanged, to
 * that width; text is then checked at its printed size. Never enlarges.
 */
export const FIGURE_FITS = ["scale"] as const;
export type FigureFit = (typeof FIGURE_FITS)[number];

/**
 * Spacing of a structured figure (#182, design doc §6.55): `normal` takes the
 * profile's structured spacing (`layout.arrangeGap`, `groupPadding`,
 * `nodePaddingX` / `nodePaddingY`), `compact` its tighter set
 * (`layout.compact`). Gaps written in the figure are kept as written.
 */
export const LAYOUT_DENSITIES = ["normal", "compact"] as const;
export type LayoutDensity = (typeof LAYOUT_DENSITIES)[number];

/** Sides of a node or group, for `attach.side` and edge anchors. */
export const SIDES = ["north", "east", "south", "west"] as const;
export type Side = (typeof SIDES)[number];
export const CORNERS = ["north-east", "south-east", "south-west", "north-west"] as const;
export type Corner = (typeof CORNERS)[number];
export type AttachSide = Side | Corner;

/**
 * Where a group's label (title) sits inside the group's border (#127, design
 * doc §6.27): along the top or bottom edge, at the left, centre or right.
 */
export const GROUP_LABEL_POSITIONS = [
  "top-left",
  "top",
  "top-right",
  "bottom-left",
  "bottom",
  "bottom-right",
] as const;
export type GroupLabelPosition = (typeof GROUP_LABEL_POSITIONS)[number];

/**
 * Set enclosures (#407, design record 407): the shape fitted around the
 * members. `circle` (the default) is the smallest circle around them and
 * `ellipse` an axis-parallel ellipse up to three times wider than tall (or
 * the reverse); both grow by the padding. `hull` is the convex hull of the
 * members grown by the padding with round corners, and `rect` their bounding
 * box grown by the padding with the theme's group corner radius.
 */
export const SET_SHAPES = ["circle", "ellipse", "hull", "rect"] as const;
export type SetShape = (typeof SET_SHAPES)[number];

/**
 * Where a set's label sits, outside its outline: above, below, left or
 * right of it (centred on that side), or beside one of its four diagonal
 * extremes.
 */
export const SET_LABEL_POSITIONS = [
  "top",
  "top-right",
  "right",
  "bottom-right",
  "bottom",
  "bottom-left",
  "left",
  "top-left",
] as const;
export type SetLabelPosition = (typeof SET_LABEL_POSITIONS)[number];

/**
 * Paint of a set: `default` is a translucent tinted fill with a solid
 * outline, `filled` the tint alone, `outlined` the outline alone and
 * `dashed` the tint with a dashed outline.
 */
export const SET_VARIANTS = ["default", "filled", "outlined", "dashed"] as const;
export type SetVariant = (typeof SET_VARIANTS)[number];

/**
 * Where along its route an edge's label sits (#128, design doc §6.30): beside
 * the first segment (near `from`), the longest segment, or the last segment
 * (near `to`). Structured layout only.
 */
export const EDGE_LABEL_POSITIONS = ["start", "middle", "end"] as const;
export type EdgeLabelPosition = (typeof EDGE_LABEL_POSITIONS)[number];

/**
 * Which side of its line an edge's label sits on, facing the way the edge
 * runs from `from` to `to` (#128). Structured layout only.
 */
export const EDGE_LABEL_SIDES = ["left", "right"] as const;
export type EdgeLabelSide = (typeof EDGE_LABEL_SIDES)[number];

/** Cross-axis alignment inside a stack or row. */
export const ARRANGE_ALIGNS = ["start", "center", "end", "stretch"] as const;
export type ArrangeAlign = (typeof ARRANGE_ALIGNS)[number];

export const STACK_DIRECTIONS = ["down", "up"] as const;
export const ROW_DIRECTIONS = ["right", "left"] as const;

/**
 * An edge anchor: a side, optionally with a position along it from 0 to 1
 * (left to right on north/south, top to bottom on east/west; default 0.5),
 * or `straight` (#179): in line with the other end, on the side facing it.
 * The schema accepts any string so the `layout` stage can report a malformed
 * anchor as `layout/invalid-anchor`; the pattern is for editors.
 */
export const ANCHOR_PATTERN =
  /^(?:straight|(north|east|south|west)(?::(0(?:\.\d+)?|1(?:\.0+)?))?)$/;

/** A non-negative layout length such as `3mm` (or `0`), for the JSON Schema. */
const LAYOUT_LENGTH_PATTERN = /^(0|\d+(\.\d+)?(mm|cm|in|pt))$/;

/**
 * A non-negative length with a unit (`"3mm"`, `"6pt"`), or `0` without one.
 * Normalized to pt. Validation issues carry `params.hint`.
 */
export const LayoutLength = z
  .unknown()
  .meta({
    anyOf: [{ type: "string", pattern: LAYOUT_LENGTH_PATTERN.source }, { const: 0 }],
    description: 'A length with a unit (mm, cm, in or pt), e.g. "3mm"; 0 needs no unit.',
  })
  .transform((input, ctx): number => {
    if (input === 0 || input === "0") return 0;
    const parsed = parseLength(input);
    if (!parsed.ok) {
      ctx.addIssue({
        code: "custom",
        message: parsed.message,
        ...(parsed.hint !== undefined && { params: { hint: parsed.hint } }),
      });
      return z.NEVER;
    }
    if (parsed.length.exactPt.num < 0n) {
      ctx.addIssue({
        code: "custom",
        message: `Length ${JSON.stringify(input)} must not be negative.`,
      });
      return z.NEVER;
    }
    return parsed.length.pt;
  });

const arrangeFields = {
  centerOn: Id.optional().describe(
    "Keep this direct item's center at the box's main-axis center, reserving symmetric space for all items. Use a stack inside a centered row for side inputs. Only compatible with justify: center (the default).",
  ),
  gap: LayoutLength.optional().describe(
    "Space between items. Omitted means the theme/profile default.",
  ),
  align: z
    .enum(ARRANGE_ALIGNS)
    .optional()
    .describe(
      "Cross-axis alignment of the items. Omitted inherits from an enclosing box on the same axis.",
    ),
  justify: z
    .enum(["center", "stretch", "space-between"])
    .optional()
    .describe(
      "Extra main-axis space: center (default), stretch resizable items by grow weights (default 1) in whole 0.5pt increments, or space-between items. Does not inherit or act at natural size; explicit sizes and fixed-aspect shapes are preserved. Sub-unit remainder stays as centered padding.",
    ),
};

/** A vertical box: items top to bottom (`down`) or bottom to top (`up`). */
export const StackSchema = z.strictObject({
  direction: z.enum(STACK_DIRECTIONS).default("down"),
  ...arrangeFields,
  get items() {
    return z
      .array(ArrangeItemSchema)
      .min(1)
      .describe("Node or group IDs, or nested arrange boxes (stack / row / grid / place / chat).");
  },
});

/** A horizontal box: items left to right (`right`) or right to left (`left`). */
export const RowSchema = z.strictObject({
  direction: z.enum(ROW_DIRECTIONS).default("right"),
  ...arrangeFields,
  get items() {
    return z
      .array(ArrangeItemSchema)
      .min(1)
      .describe("Node or group IDs, or nested arrange boxes (stack / row / grid / place / chat).");
  },
});

/**
 * Issue param marking an "exactly one of these keys" check (an arrange box's
 * `stack` / `row`, an align constraint's `x` / `y`); its value lists the keys.
 */
export const ONE_OF_ISSUE = "sumi-one-of";

/** A grid item with an optional horizontal span. */
export const GridCellSchema = z.strictObject({
  get item() {
    return ArrangeItemSchema.nullable();
  },
  span: z.int().positive().optional().describe("Number of columns occupied (default 1)."),
});

/** Row-major grid. Rows must be complete; null reserves a blank cell. */
export const GridSchema = z.strictObject({
  columns: z
    .int()
    .positive()
    .describe("Number of columns; items fill left to right, top to bottom."),
  rowGap: LayoutLength.optional(),
  columnGap: LayoutLength.optional(),
  align: z.enum(ARRANGE_ALIGNS).optional(),
  get items() {
    return z.array(z.union([ArrangeItemSchema, GridCellSchema, z.null()])).min(1);
  },
});

/** Rigid coordinate placement; signed, fractional centers in multiples of unit. */
export const PlaceSchema = z
  .strictObject({
    unit: LayoutLength.refine((value) => value > 0, "Placement unit must be positive.").meta({
      anyOf: undefined,
      type: "string",
      pattern: /^(?=\d*(?:\.\d*)?[1-9])\d+(?:\.\d+)?(?:mm|cm|in|pt)$/.source,
      description: "A positive length with a unit (mm, cm, in or pt).",
    }),
    get items() {
      return z
        .array(
          z.strictObject({
            item: ArrangeItemSchema,
            at: z
              .tuple([z.number(), z.number()])
              .describe("Item center [x, y] in units; y grows downward."),
          }),
        )
        .min(1);
    },
  })
  .check((ctx) => {
    for (const [index, cell] of ctx.value.items.entries())
      for (const [axis, coordinate] of cell.at.entries()) {
        if (Math.abs(coordinate * ctx.value.unit) <= MAX_LENGTH_PT) continue;
        ctx.issues.push({
          code: "custom",
          input: coordinate,
          path: ["items", index, "at", axis],
          message: `Coordinate times place.unit must be within ±${MAX_LENGTH_PT}pt.`,
        });
      }
  });

/** Conversation column; message content remains ordinary, addressable bubble nodes. */
const ChatLength = LayoutLength.refine((v) => v > 0, "Chat length must be positive.").meta({
  anyOf: undefined,
  type: "string",
  pattern: /^(?=\d*(?:\.\d*)?[1-9])\d+(?:\.\d+)?(?:mm|cm|in|pt)$/.source,
  description: "A positive length with a unit (mm, cm, in or pt).",
});
export const ChatSchema = z.strictObject({
  width: ChatLength.optional().describe(
    "Column width; omitted uses the profile page width minus margins and one group's padding.",
  ),
  maxWidth: z
    .union([z.number().positive().max(1), ChatLength.transform((pt) => ({ pt }))])
    .optional()
    .describe(
      "Maximum natural bubble width: a column fraction (0, 1] or a positive length. Default: 0.7.",
    ),
  speakers: z.record(
    Id,
    z.strictObject({
      side: z.enum(["left", "right"]),
      avatar: Id.optional(),
      tone: Tone,
      variant: z.string().min(1).optional(),
    }),
  ),
  items: z
    .array(
      z.union([
        z.strictObject({ divider: z.string().min(1) }),
        z.strictObject({
          node: Id,
          from: Id,
          meta: z.union([z.string(), z.array(z.string()).min(1)]).optional(),
        }),
      ]),
    )
    .min(1),
});
export type Chat = z.output<typeof ChatSchema>;

/** One box of an arrange tree: exactly one arrangement kind. */
export const ArrangeBoxSchema = z
  .strictObject({
    get stack() {
      return StackSchema.optional();
    },
    get row() {
      return RowSchema.optional();
    },
    get grid() {
      return GridSchema.optional();
    },
    get place() {
      return PlaceSchema.optional();
    },
    chat: ChatSchema.optional(),
  })
  .check((ctx) => {
    const kinds = Object.values(ctx.value).filter((v) => v !== undefined).length;
    if (kinds !== 1) {
      ctx.issues.push({
        code: "custom",
        message:
          'An arrange box must have exactly one of "stack", "row", "grid", "place" or "chat".',
        input: ctx.value,
        params: { [ONE_OF_ISSUE]: ["stack", "row", "grid", "place", "chat"] },
      });
    }
  })
  .meta({
    id: "ArrangeBox",
    description:
      "A stack (vertical), row (horizontal), row-major grid, rigid coordinate placement, or chat conversation column.",
    minProperties: 1,
    maxProperties: 1,
  });

/** An item of an arrange box: an element ID or a nested box. */
export const ArrangeItemSchema = z.union([Id, ArrangeBoxSchema]);

export const AttachSchema = z.strictObject({
  to: Ref.describe(
    "The node or group to place this node beside, or a cell of a tokens node as <node>.<cell>.",
  ),
  side: z
    .enum([...SIDES, ...CORNERS])
    .describe(
      "The side or corner of the target to place this node on; a corner separates the boxes by gap on both axes.",
    ),
  gap: LayoutLength.optional().describe("Space between the target and this node. Omitted means 0."),
});

/**
 * Where a glyph (#408) sits on its node's body: a corner, the middle of a
 * side or (#409, for the sample of a legend entry) the centre.
 */
export const GLYPH_POSITIONS = [
  "center",
  "north",
  "north-east",
  "east",
  "south-east",
  "south",
  "south-west",
  "west",
  "north-west",
] as const;
export type GlyphPosition = (typeof GLYPH_POSITIONS)[number];

/** The kinds of glyph (#408): a feature vector, a dot or a pill. */
export const GLYPH_KINDS = ["vector", "dot", "pill"] as const;
export type GlyphKind = (typeof GLYPH_KINDS)[number];

/** Most cells one feature vector may have. */
export const MAX_GLYPH_CELLS = 16;

const GlyphLength = LayoutLength.refine((pt) => pt > 0, { message: "must be positive" });
const GlyphTone = z.enum([...TONE_NAMES, "none"]);

/**
 * One glyph of `nodes[].glyphs` (#408, design doc `408-node-glyphs`): a small
 * mark drawn over a node's border at a corner or side, apart from its label
 * and without taking part in routing.
 */
export const glyphShape = z.strictObject({
  kind: z
    .enum(GLYPH_KINDS)
    .describe(
      "vector: a short column or row of cells (a feature vector); dot: a small circle; pill: a small rounded bar.",
    ),
  at: z
    .enum(GLYPH_POSITIONS)
    .default("north-east")
    .describe(
      "Where the glyph's center lies on the node's body: a corner, the middle of a side or the center. Omitted means north-east.",
    ),
  dx: z
    .number()
    .min(-10)
    .max(10)
    .optional()
    .describe("Move the glyph right by this many ems (the node's font size); negative moves left."),
  dy: z
    .number()
    .min(-10)
    .max(10)
    .optional()
    .describe("Move the glyph down by this many ems (the node's font size); negative moves up."),
  size: GlyphLength.optional().describe(
    "Side of one vector cell, or the diameter of a dot, or the height of a pill. Omitted means 0.4 em of the node's font size.",
  ),
  width: GlyphLength.optional().describe(
    "pill only: the length of the pill. Omitted means twice its height.",
  ),
  cells: z
    .int()
    .min(1)
    .max(MAX_GLYPH_CELLS)
    .optional()
    .describe("vector only: the number of cells. Omitted means 3 (or the length of tones)."),
  direction: z
    .enum(["down", "right"])
    .optional()
    .describe("vector only: lay the cells out downward (default) or rightward."),
  tone: GlyphTone.optional().describe(
    "The fill of every cell, the dot or the pill, from the theme's palette. none or omitted means the default node fill.",
  ),
  strength: z
    .enum(["soft", "solid"])
    .optional()
    .describe(
      "soft (default): the tone's fill, as for a node. solid: the tone's accent color (its line color: a dark shade of the hue, a gray step in the monochrome themes) with a 0.5pt outline in the theme's ink, for readable small cells. none stays the plain node fill.",
    ),
  tones: z
    .array(GlyphTone)
    .min(1)
    .max(MAX_GLYPH_CELLS)
    .optional()
    .describe(
      "vector only: one tone per cell, in order; its length is the cell count. Not combined with tone.",
    ),
  outline: z
    .boolean()
    .optional()
    .describe("Draw a thin outline around each cell, dot or pill (default true)."),
});

/** The cross-field rules of a glyph, shared by the node's `glyphs` and a legend's `glyph`. */
export function checkGlyph(
  glyph: Pick<
    z.output<typeof glyphShape>,
    "kind" | "tones" | "tone" | "cells" | "direction" | "width"
  >,
  ctx: z.RefinementCtx,
): void {
  {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: "custom", message, path: [path] });
    if (glyph.kind !== "vector") {
      for (const field of ["cells", "direction", "tones"] as const) {
        if (glyph[field] !== undefined) issue(field, `${field} applies to a vector only.`);
      }
    }
    if (glyph.tones !== undefined && glyph.tone !== undefined)
      issue(
        "tones",
        "tones and tone cannot be combined: give one tone per cell, or one tone for all.",
      );
    if (glyph.kind !== "pill" && glyph.width !== undefined)
      issue("width", "width applies to a pill only.");
    if (
      glyph.tones !== undefined &&
      glyph.cells !== undefined &&
      glyph.tones.length !== glyph.cells
    ) {
      issue("tones", `tones has ${glyph.tones.length} entries but cells is ${glyph.cells}.`);
    }
  }
}

export const GlyphSchema = glyphShape.superRefine(checkGlyph);
export type FigureGlyph = z.infer<typeof GlyphSchema>;

const Anchor = z
  .string()
  .meta({ pattern: ANCHOR_PATTERN.source })
  .describe(
    '"<side>" or "<side>:<0..1>", e.g. "south" or "south:0.25"; or "straight": in line with the other end, on the side facing it (structured layout only).',
  );

/**
 * Which coordinate of the items an align constraint makes equal (#132): the
 * center (default), the start (top / left) or the end (bottom / right).
 */
export const ALIGN_POSITIONS = ["center", "start", "end"] as const;
export type AlignPosition = (typeof ALIGN_POSITIONS)[number];

/**
 * One constraint of `figure.layout.align` (#132, design doc §6.31): exactly
 * one of `x` (the items share an x: one vertical line) or `y` (one
 * horizontal line). The layout stage checks the IDs (known, placed, listed
 * once, at least two).
 */
export const AlignConstraintSchema = z
  .strictObject({
    x: z
      .array(Ref)
      .optional()
      .describe(
        "Node or group IDs (or tokens cells as <node>.<cell>) whose x (center, left or right edge) is made equal.",
      ),
    y: z
      .array(Ref)
      .optional()
      .describe(
        "Node or group IDs (or tokens cells as <node>.<cell>) whose y (center, top or bottom edge) is made equal.",
      ),
    at: z
      .enum(ALIGN_POSITIONS)
      .optional()
      .describe("Which coordinate: center (default), start (top / left) or end (bottom / right)."),
  })
  .check((ctx) => {
    const axes = [ctx.value.x, ctx.value.y].filter((v) => v !== undefined).length;
    if (axes !== 1) {
      ctx.issues.push({
        code: "custom",
        message: 'An align constraint must have exactly one of "x" or "y".',
        input: ctx.value,
        params: { [ONE_OF_ISSUE]: ["x", "y"] },
      });
    }
  })
  .meta({
    id: "AlignConstraint",
    description: "Elements of any arrange trees placed on one line (structured layout only).",
    oneOf: [{ required: ["x"] }, { required: ["y"] }],
  });

/** `figure.layout` as written; {@link LayoutSchema} adds the effective engine. */
export const LayoutFieldsSchema = z.strictObject({
  engine: z
    .enum(LAYOUT_ENGINES)
    .optional()
    .describe(
      "auto: D2/ELK. structured: arrange trees and attach. Omitted means structured if arrange is given, else auto.",
    ),
  direction: z
    .enum(LAYOUT_DIRECTIONS)
    .default("right")
    .describe("Flow direction of the root layout (auto engine only)."),
  arrange: ArrangeBoxSchema.optional().describe(
    "Structured layout: places the root-level nodes and groups.",
  ),
  align: z
    .array(AlignConstraintSchema)
    .optional()
    .describe(
      "Structured layout: elements of different arrange trees placed on one horizontal (y) or vertical (x) line.",
    ),
  alignGrowth: z
    .enum(ALIGN_GROWTH_MODES)
    .optional()
    .describe(
      "allow: the space the align constraints add is intended, so the info layout/align-grew-figure is not reported. Omitted means report (structured layout only).",
    ),
  fanIn: z
    .enum(FAN_IN_MODES)
    .optional()
    .describe(
      "Edges from different elements entering the same point of an element without an anchor: merge joins them into one line, spread enters them side by side in the order of their other ends. Omitted means merge (structured layout only).",
    ),
  density: z
    .enum(LAYOUT_DENSITIES)
    .optional()
    .describe(
      "compact: the profile's tighter default gap, group padding and node padding, for dense paper figures (usually with fit: scale); gaps written in the figure stay as written. Omitted means normal (structured layout only).",
    ),
});

/**
 * `figure.layout`, normalized: `engine` is always set. It is inferred from
 * `figure.layout` alone (design doc §6.19), so later stages never guess.
 */
export const LayoutSchema = LayoutFieldsSchema.transform(
  ({ engine, direction, arrange, align, alignGrowth, fanIn, density }) => ({
    engine: engine ?? (arrange !== undefined ? "structured" : "auto"),
    direction,
    ...(arrange !== undefined && { arrange }),
    ...(align !== undefined && { align }),
    ...(alignGrowth !== undefined && { alignGrowth }),
    ...(fanIn !== undefined && { fanIn }),
    ...(density !== undefined && { density }),
  }),
);

/**
 * One entry of `figure.assets` (#310, design doc §6.91): an inline SVG or an
 * image file defined once and drawn by any number of `image` nodes through
 * `props.asset`. It is checked and imported once per asset.
 */
export const FigureAssetSchema = z
  .strictObject({
    src: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Path of the image file relative to the figure\'s YAML file, with "/" between directories, as image props.src.',
      ),
    svg: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Inline SVG document, as image props.svg (a YAML block scalar with a viewBox). Exactly one of src or svg is required.",
      ),
    sha256: z
      .string()
      .regex(/^[0-9a-fA-F]{64}$/)
      .optional()
      .describe(
        "Expected sha256 of the file bytes or UTF-8 inline SVG source in hex. Rendering fails if the input has changed. Omitted means not checked.",
      ),
  })
  .refine(({ src, svg }) => (src !== undefined) !== (svg !== undefined), {
    error: "an asset needs exactly one of src or svg",
    path: ["svg"],
  });

/** Target budgets require units and exclude every spelling of zero. */
const PositiveTargetLength = z
  .string()
  .regex(/^(?=\d*(?:\.)?\d*[1-9])\d+(?:\.\d+)?(?:mm|cm|in|pt)$/)
  .pipe(LayoutLength as unknown as z.ZodType<number, string>);

/** Decimal >= a positive, fractional threshold below 10, allowing leading zeros. */
function decimalFloorPattern(threshold: string): string {
  const [whole = "", fraction = ""] = threshold.split(".");
  const greaterFractions = [...fraction].flatMap((digit, index) =>
    digit === "9" ? [] : [`${fraction.slice(0, index)}[${Number(digit) + 1}-9]\\d*`],
  );
  return `0*(?:[1-9]\\d+(?:\\.\\d+)?|[${Number(whole) + 1}-9](?:\\.\\d+)?|${whole}\\.(?:${[...greaterFractions, `${fraction}\\d*`].join("|")}))`;
}

// Exact equivalents of 4.5pt. Input patterns survive JSON Schema generation,
// unlike refinements after the normalization transform.
const TargetFontLength = z
  .string()
  .regex(
    new RegExp(
      `^(?:${Object.entries({ pt: "4.5", mm: "1.5875", cm: "0.15875", in: "0.0625" })
        .map(([unit, floor]) => `${decimalFloorPattern(floor)}${unit}`)
        .join("|")})$`,
    ),
  )
  .pipe(LayoutLength as unknown as z.ZodType<number, string>);

export const FigureTargetSchema = z.strictObject({
  height: PositiveTargetLength.refine((pt) => pt > 0, "Height budget must be positive.")
    .optional()
    .describe("Printed height budget, including margins; exceeding it warns but never rescales."),
  minFontSize: TargetFontLength.refine(
    (pt) => pt >= 4.5,
    "Minimum font size must be at least 4.5pt.",
  )
    .optional()
    .describe("Minimum final text size (at least 4.5pt), overriding both profile font minima."),
  minLineWidth: PositiveTargetLength.refine((pt) => pt > 0, "Minimum line width must be positive.")
    .optional()
    .describe(
      "Minimum final diagram border/wire width; thinner lines warn. Excludes image content.",
    ),
});

/** An exact `#RRGGBB` color in a figure (`themeOverrides`). */
const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const FigureMetaSchema = z.strictObject({
  id: Id,
  title: z.string().optional(),
  theme: z.string().min(1).default("minimal").describe("Built-in theme name."),
  themeOverrides: z
    .strictObject({
      palette: z
        .enum(PALETTE_NAMES)
        .optional()
        .describe(
          "Built-in color palette (sumi catalog --section palettes): recolors text, frames, lines, panels, filled and tinted nodes, the gray tone and emphasis of the theme. Other tones, sizes and fonts stay the theme's; tones, groupFill and groupStroke below refine it.",
        ),
      nodeCorners: z
        .literal("square")
        .optional()
        .describe(
          "Square node/group frames, including expanded matrix/tokens cells and legends. Intrinsically curved shapes are preserved.",
        ),
      edgeCorners: z
        .literal("sharp")
        .optional()
        .describe(
          "Sharp structured wires, including hidden junctions/forks, with butt caps and miter joins. Editable PPTX wires use flat caps and miter joins in both connector modes.",
        ),
      groupLabelWeight: z
        .enum(["regular", "bold"])
        .optional()
        .describe("Weight of group headings, overriding the theme's group variants."),
      solidFills: z
        .partialRecord(z.enum(TONE_NAMES), z.string().regex(/^#[0-9a-fA-F]{6}$/))
        .optional()
        .describe(
          "Exact #RRGGBB fills for solid tone nodes, including expanded token cells. Text remains contrast-adjusted.",
        ),
      dashedGroupStroke: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .optional()
        .describe(
          "Exact #RRGGBB border color for dashed groups; fill and heading color are preserved.",
        ),
      tones: z
        .partialRecord(
          z.enum(TONE_NAMES),
          z.strictObject({
            fill: HexColor.optional().describe(
              "The tone's pale fill: default, filled and tinted variants, toned groups, matrix classes.",
            ),
            line: HexColor.optional().describe(
              "The tone's line color: outlined/tinted frames, toned edges and arrowheads, hatches, solid fills (unless solidFills sets one).",
            ),
            text: HexColor.optional().describe(
              "The tone's text color, used as written: outlined/tinted text, toned edge labels, toned header text. Omitted: the line color (darkened to 4.5:1 on tinted fills).",
            ),
          }),
        )
        .optional()
        .describe(
          "Exact #RRGGBB colors of tones, applied wherever the tone is used; dimming still applies.",
        ),
      groupFill: HexColor.optional().describe(
        "Exact #RRGGBB fill for container groups (and their stacked layers) that have a fill and no tone.",
      ),
      groupStroke: HexColor.optional().describe(
        "Exact #RRGGBB frame color for container groups (and their stacked layers); dashedGroupStroke wins for dashed groups.",
      ),
    })
    .optional()
    .describe(
      "Figure-wide refinements of the selected built-in theme. Omitted fields preserve the theme.",
    ),
  profile: z.string().min(1).default("paper-single").describe("Built-in output profile name."),
  target: FigureTargetSchema.optional().describe(
    "Placement-specific lint targets; do not change layout, fonts, or width-only fitting.",
  ),
  fit: z
    .enum(FIGURE_FITS)
    .optional()
    .describe(
      "scale: shrink the whole figure (layout unchanged) to the profile's maximum width if it is wider; text is then checked at its printed size. Omitted means the figure is printed at its natural size.",
    ),
  layout: LayoutSchema.prefault({}),
  assets: z
    .record(Id, FigureAssetSchema)
    .optional()
    .describe(
      "Images and inline SVGs defined once by name (an ID) and drawn by `image` nodes with props.asset, optionally cut with props.crop. Each is imported and checked once.",
    ),
});

export const GroupSchema = z.strictObject({
  id: Id,
  props: Props.unwrap()
    .optional()
    .describe(
      "Component options. Container supports layers: { count, offset } for stacked frames in structured layout; count includes the front card (1–16), offset is a positive 0.5pt-grid length up-right.",
    ),
  label: Label,
  labelAt: z
    .enum(GROUP_LABEL_POSITIONS)
    .optional()
    .describe(
      "Where the label sits inside the group's border, relative to the full frame including attached members, not just the arrange tree. Omitted means top (top centre) in structured layout and top-left in auto layout.",
    ),
  caption: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Text drawn centred below the group\'s border, e.g. "(a) encoder". Drawn as a label with the reserved ID <id>-caption.',
    ),
  component: ComponentRef.default("container").describe("Component reference (kind: group)."),
  variant: Variant,
  tone: Tone,
  dim: z
    .literal(true)
    .optional()
    .describe(
      "Draw the group and everything inside it (nodes, edges between them, nested groups, the caption, legends) in the theme's pale dim colors: gray text and lines, paler fills. Keeps the group's variant and tone; inherited and cannot be turned off inside. Omit it to draw the group as it is.",
    ),
  group: Id.optional().describe(
    "Parent group ID. Omitted means the root (or, in structured layout, the group whose arrange lists it).",
  ),
  arrange: ArrangeBoxSchema.optional().describe(
    "Structured layout: places the group's children; listed elements become its children.",
  ),
});

export const NodeSchema = z.strictObject({
  id: Id,
  grow: z
    .number()
    .positive()
    .max(1000)
    .optional()
    .describe(
      "Structured layout: relative weight of extra main-axis space under the immediate row/stack's justify: stretch (0 < grow <= 1000, default 1), apportioned in whole 0.5pt increments, not a final-size ratio. No effect without extra space, under other justification modes, in grid or attach, or on explicit main-axis sizes and non-stretchable shapes. Does not inherit. Rejected on expanded tokens, matrix and legend components.",
    ),
  component: ComponentRef.describe("Component reference (kind: node), e.g. `box` or `sumi/box`."),
  label: Label,
  sublabel: z
    .string()
    .regex(/\S/, { message: "must not be empty or only whitespace" })
    .optional()
    .describe(
      'Structured layout: a second, smaller text under the label, e.g. a size "32 × 32 × 4" under "Noise". Drawn at 7/8 of the label\'s font size (rounded down to 0.5pt); newlines break lines and label math is allowed. Needs a label.',
    ),
  textAlign: z
    .enum(["left", "center", "right"])
    .optional()
    .describe(
      "Horizontal alignment of the node's label and sublabel within their shared text block (structured layout, or bubble in either layout). Omitted means center (left for bubbles and the entries of a legend).",
    ),
  labelRotation: z
    .literal([90, -90])
    .optional()
    .describe(
      "Structured layout: draw the label turned by 90 (clockwise, reading top to bottom) or -90 degrees (counter-clockwise, reading bottom to top), e.g. a title along a tall box. The node is sized to the turned label.",
    ),
  icon: z
    .string()
    .max(ICON_REF_MAX_LENGTH)
    .regex(ICON_REF_PATTERN)
    .optional()
    .describe(
      "A bundled icon drawn in place of the label, e.g. tabler/wave-sine (text color) or emoji/fire (original multicolour palette).",
    ),
  badge: z
    .strictObject({
      icon: z
        .string()
        .max(ICON_REF_MAX_LENGTH)
        .regex(ICON_REF_PATTERN)
        .describe("Bundled icon, e.g. emoji/fire or emoji/snowflake."),
      corner: z
        .enum(CORNERS)
        .describe("Corner of the node's bounding box on which the badge is centered."),
    })
    .optional()
    .describe(
      "A one-em corner badge, independent of the node label; its overhang reserves layout space.",
    ),
  glyphs: z
    .array(GlyphSchema)
    .min(1)
    .max(8)
    .optional()
    .describe(
      "Small marks over the node's border, e.g. a three-cell feature vector at a corner of an icon; their overhang reserves layout space.",
    ),
  variant: Variant,
  tone: Tone,
  mono: z
    .boolean()
    .optional()
    .describe(
      "Draw the node's label and sublabel in the theme's monospace font (e.g. a class name or a prompt). false turns off a variant's monospace text. Math stays in the math fonts; \\textcolor spans keep their colors. On a tokens node it is the default of its cells. Omitted means the variant's own setting (normally proportional text).",
    ),
  props: Props,
  group: Id.optional().describe(
    "Containing group ID. Omitted means the root (or, in structured layout, the group whose arrange lists it).",
  ),
  attach: AttachSchema.optional().describe(
    "Structured layout: place this node beside another element instead of in an arrange tree.",
  ),
});

export const EdgeSchema = z.strictObject({
  route: z
    .enum(["straight", "curve"])
    .optional()
    .describe(
      "Join endpoints with one straight segment (straight) or cubic Bézier (curve), without obstacle avoidance or shared trunks (structured layout only). Curves share the through tangent at junctions. Omitted keeps orthogonal routing.",
    ),
  id: Id.optional().describe("Optional edge ID (separate ID space from nodes and groups)."),
  from: Ref.describe("Source node or group ID, or a cell of a tokens node as <node>.<cell>."),
  fromAnchor: Anchor.optional().describe(
    "Where the edge leaves the source (structured layout only).",
  ),
  to: Ref.describe("Target node or group ID, or a cell of a tokens node as <node>.<cell>."),
  toAnchor: Anchor.optional().describe(
    "Where the edge enters the target (structured layout only).",
  ),
  label: Label,
  labelAt: z
    .enum(EDGE_LABEL_POSITIONS)
    .optional()
    .describe(
      "Where along the route the label sits: beside the first segment (start), the longest segment (middle) or the last segment (end). Omitted means next to the arrowhead, or the middle of a line without arrowheads. With route: straight or curve, start/end are near that endpoint and the default is the arc-length midpoint (structured layout only).",
    ),
  labelSide: z
    .enum(EDGE_LABEL_SIDES)
    .optional()
    .describe(
      "Which side of the line the label sits on, facing from the source to the target. Omitted means above a horizontal segment and right of a vertical one, or the other side when that is clear. With route: straight or curve, the default is left of the local tangent and labels stay horizontal without obstacle avoidance (structured layout only).",
    ),
  component: ComponentRef.default("arrow").describe("Component reference (kind: edge)."),
  variant: Variant,
  tone: z
    .enum(TONE_NAMES)
    .optional()
    .describe(
      "Color category from the theme's palette for the line, its arrowheads and its label (the tone's line color, e.g. a dark orange in the color theme, a gray step in monochrome themes). Omitted means none.",
    ),
  props: Props,
});

/**
 * One entry of `sets` (#407): an enclosure drawn around nodes and groups
 * that may overlap another set's. Membership is many to many and independent
 * of the group tree: a node can be a member of several sets.
 */
export const SetSchema = z.strictObject({
  id: Id.describe("Set ID (its own ID space, separate from nodes, groups and edges)."),
  label: Label,
  members: z
    .array(Id)
    .min(1)
    .describe(
      "IDs of the nodes and groups the set encloses (each listed once). A group stands for its whole frame; the nodes inside it are members too.",
    ),
  shape: z
    .enum(SET_SHAPES)
    .default("circle")
    .describe(
      "circle (default; the smallest circle around the members), ellipse (axis-parallel, up to 3:1), hull (rounded convex hull) or rect (rounded rectangle).",
    ),
  labelAt: z
    .enum(SET_LABEL_POSITIONS)
    .optional()
    .describe(
      "Where the label sits outside the outline: top, top-right, right, bottom-right, bottom, bottom-left, left or top-left. Omitted means top.",
    ),
  padding: LayoutLength.optional().describe(
    "Room between the members and the outline. Omitted means the profile's group padding.",
  ),
  fillOpacity: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe(
      "Opacity of the tinted fill (0..1) so that overlapping sets show through each other. Omitted means the variant's own (0.2 for default and dashed, 0.28 for filled).",
    ),
  variant: z
    .enum(SET_VARIANTS)
    .default("default")
    .describe("default (tint and outline), filled (tint), outlined (outline) or dashed."),
  tone: Tone.describe(
    "Color category from the theme's palette: its line color draws the outline and the label and, at low opacity, the tint, in every theme. Omitted means gray.",
  ),
});

export const FigureDocumentSchema = z
  .strictObject({
    version: z.literal(FIGURE_SCHEMA_VERSION),
    requires: SemverRange.optional().describe(
      'Minimum Sumi version as a semver range, e.g. ">=0.4.0".',
    ),
    figure: FigureMetaSchema,
    groups: z.array(GroupSchema).prefault([]),
    nodes: z.array(NodeSchema).prefault([]),
    edges: z.array(EdgeSchema).prefault([]),
    sets: z
      .array(SetSchema)
      .optional()
      .describe(
        "Set enclosures (#407): translucent shapes around nodes and groups that may overlap, for Venn diagrams and hyperedges. Structured layout only; they are drawn below the nodes and edges and take no space in the arrange trees.",
      ),
    metadata: JsonValue.optional().describe("Arbitrary JSON-compatible data; not interpreted."),
  })
  .meta({ title: "Sumi figure (schema v1)" });

export type FigureDocument = z.output<typeof FigureDocumentSchema>;
export type FigureMeta = z.output<typeof FigureMetaSchema>;
export type FigureLayout = z.output<typeof LayoutSchema>;
export type ArrangeBox = z.output<typeof ArrangeBoxSchema>;
export type ArrangeItem = z.output<typeof ArrangeItemSchema>;
export type AlignConstraint = z.output<typeof AlignConstraintSchema>;
export type StackBox = z.output<typeof StackSchema>;
export type RowBox = z.output<typeof RowSchema>;
export type Attach = z.output<typeof AttachSchema>;
export type FigureGroup = z.output<typeof GroupSchema>;
export type FigureNode = z.output<typeof NodeSchema>;
/** `nodes[].labelRotation` (#178): degrees, positive clockwise as in SVG's `rotate()`. */
export type LabelRotation = NonNullable<FigureNode["labelRotation"]>;
export type FigureEdge = z.output<typeof EdgeSchema>;
export type FigureSet = z.output<typeof SetSchema>;
export type JsonValue = z.output<typeof JsonValue>;
