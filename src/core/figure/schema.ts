/**
 * Figure Schema v1 (design doc §2.2). The Zod schemas are the single source of
 * truth for both validation and `schema/figure.v1.schema.json`.
 *
 * Output types are normalized: every defaulted field is filled in.
 */

import { validRange } from "semver";
import { z } from "zod";
import { ICON_REF_MAX_LENGTH, ICON_REF_PATTERN } from "../../assets/icon-ref";
import { TONE_NAMES } from "../theme/tones";
import { parseLength } from "../units";

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
    "Color category from the theme's palette (e.g. a pastel fill in the color theme, a gray step in monochrome themes). Omitted means none.",
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
  gap: LayoutLength.optional().describe(
    "Space between items. Omitted means the theme/profile default.",
  ),
  align: z
    .enum(ARRANGE_ALIGNS)
    .optional()
    .describe(
      "Cross-axis alignment of the items. Omitted inherits from an enclosing box on the same axis.",
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
      .describe("Node or group IDs, or nested stack / row boxes.");
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
      .describe("Node or group IDs, or nested stack / row boxes.");
  },
});

/**
 * Issue param marking an "exactly one of these keys" check (an arrange box's
 * `stack` / `row`, an align constraint's `x` / `y`); its value lists the keys.
 */
export const ONE_OF_ISSUE = "sumi-one-of";

/** One box of an arrange tree: exactly one of `stack` or `row`. */
export const ArrangeBoxSchema = z
  .strictObject({
    get stack() {
      return StackSchema.optional();
    },
    get row() {
      return RowSchema.optional();
    },
  })
  .check((ctx) => {
    const kinds = Object.values(ctx.value).filter((v) => v !== undefined).length;
    if (kinds !== 1) {
      ctx.issues.push({
        code: "custom",
        message: 'An arrange box must have exactly one of "stack" or "row".',
        input: ctx.value,
        params: { [ONE_OF_ISSUE]: ["stack", "row"] },
      });
    }
  })
  .meta({
    id: "ArrangeBox",
    description: "A stack (vertical) or row (horizontal) of items.",
    minProperties: 1,
    maxProperties: 1,
  });

/** An item of an arrange box: an element ID or a nested box. */
export const ArrangeItemSchema = z.union([Id, ArrangeBoxSchema]);

export const AttachSchema = z.strictObject({
  to: Ref.describe(
    "The node or group to place this node beside, or a cell of a tokens node as <node>.<cell>.",
  ),
  side: z.enum(SIDES).describe("The side of the target to place this node on."),
  gap: LayoutLength.optional().describe("Space between the target and this node. Omitted means 0."),
});

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
  ({ engine, direction, arrange, align, fanIn, density }) => ({
    engine: engine ?? (arrange !== undefined ? "structured" : "auto"),
    direction,
    ...(arrange !== undefined && { arrange }),
    ...(align !== undefined && { align }),
    ...(fanIn !== undefined && { fanIn }),
    ...(density !== undefined && { density }),
  }),
);

export const FigureMetaSchema = z.strictObject({
  id: Id,
  title: z.string().optional(),
  theme: z.string().min(1).default("minimal").describe("Built-in theme name."),
  profile: z.string().min(1).default("paper-single").describe("Built-in output profile name."),
  fit: z
    .enum(FIGURE_FITS)
    .optional()
    .describe(
      "scale: shrink the whole figure (layout unchanged) to the profile's maximum width if it is wider; text is then checked at its printed size. Omitted means the figure is printed at its natural size.",
    ),
  layout: LayoutSchema.prefault({}),
});

export const GroupSchema = z.strictObject({
  id: Id,
  label: Label,
  labelAt: z
    .enum(GROUP_LABEL_POSITIONS)
    .optional()
    .describe(
      "Where the label sits inside the group's border. Omitted means top (top centre) in structured layout and top-left in auto layout.",
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
  group: Id.optional().describe(
    "Parent group ID. Omitted means the root (or, in structured layout, the group whose arrange lists it).",
  ),
  arrange: ArrangeBoxSchema.optional().describe(
    "Structured layout: places the group's children; listed elements become its children.",
  ),
});

export const NodeSchema = z.strictObject({
  id: Id,
  component: ComponentRef.describe("Component reference (kind: node), e.g. `box` or `sumi/box`."),
  label: Label,
  sublabel: z
    .string()
    .regex(/\S/, { message: "must not be empty or only whitespace" })
    .optional()
    .describe(
      'Structured layout: a second, smaller text under the label, e.g. a size "32 × 32 × 4" under "Noise". Drawn at 7/8 of the label\'s font size (rounded down to 0.5pt); newlines break lines and label math is allowed. Needs a label.',
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
      "A bundled icon drawn in place of the label, as <set>/<name>, e.g. tabler/wave-sine. Drawn in the node's text color.",
    ),
  variant: Variant,
  tone: Tone,
  props: Props,
  group: Id.optional().describe(
    "Containing group ID. Omitted means the root (or, in structured layout, the group whose arrange lists it).",
  ),
  attach: AttachSchema.optional().describe(
    "Structured layout: place this node beside another element instead of in an arrange tree.",
  ),
});

export const EdgeSchema = z.strictObject({
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
      "Where along the route the label sits: beside the first segment (start), the longest segment (middle) or the last segment (end). Omitted means next to the arrowhead, or the middle of a line without arrowheads (structured layout only).",
    ),
  labelSide: z
    .enum(EDGE_LABEL_SIDES)
    .optional()
    .describe(
      "Which side of the line the label sits on, facing from the source to the target. Omitted means above a horizontal segment and right of a vertical one, or the other side when that is clear (structured layout only).",
    ),
  component: ComponentRef.default("arrow").describe("Component reference (kind: edge)."),
  variant: Variant,
  props: Props,
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
export type JsonValue = z.output<typeof JsonValue>;
