/**
 * Figure Schema v1 (design doc §2.2). The Zod schemas are the single source of
 * truth for both validation and `schema/figure.v1.schema.json`.
 *
 * Output types are normalized: every defaulted field is filled in.
 */

import { validRange } from "semver";
import { z } from "zod";

/** Element ID: lowercase only, because D2 keys are case-insensitive. */
export const ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;

export const FIGURE_SCHEMA_VERSION = 1;

export const LAYOUT_DIRECTIONS = ["right", "down", "left", "up"] as const;

const Id = z.string().regex(ID_PATTERN);
const ComponentRef = z.string().min(1);
const Label = z
  .string()
  .default("")
  .describe("Plain text; newlines break lines. Empty or omitted means no label.");
const Variant = z.string().min(1).default("default");
const Props = z
  .record(z.string(), z.unknown())
  .prefault({})
  .describe("Component props, validated against the component manifest.");

export const SemverRange = z
  .string()
  .min(1)
  .refine((range) => validRange(range) !== null, { message: "Invalid semver range" });

export const JsonValue = z.json().meta({ id: "JsonValue" });

export const LayoutSchema = z.strictObject({
  direction: z
    .enum(LAYOUT_DIRECTIONS)
    .default("right")
    .describe("Flow direction of the root layout."),
});

export const FigureMetaSchema = z.strictObject({
  id: Id,
  title: z.string().optional(),
  theme: z.string().min(1).default("minimal").describe("Built-in theme name."),
  profile: z.string().min(1).default("paper-single").describe("Built-in output profile name."),
  layout: LayoutSchema.prefault({}),
});

export const GroupSchema = z.strictObject({
  id: Id,
  label: Label,
  component: ComponentRef.default("container").describe("Component reference (kind: group)."),
  variant: Variant,
  group: Id.optional().describe("Parent group ID. Omitted means the root."),
});

export const NodeSchema = z.strictObject({
  id: Id,
  component: ComponentRef.describe("Component reference (kind: node), e.g. `box` or `sumi/box`."),
  label: Label,
  variant: Variant,
  props: Props,
  group: Id.optional().describe("Containing group ID. Omitted means the root."),
});

export const EdgeSchema = z.strictObject({
  id: Id.optional().describe("Optional edge ID (separate ID space from nodes and groups)."),
  from: Id.describe("Source node or group ID."),
  to: Id.describe("Target node or group ID."),
  label: Label,
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
export type FigureGroup = z.output<typeof GroupSchema>;
export type FigureNode = z.output<typeof NodeSchema>;
export type FigureEdge = z.output<typeof EdgeSchema>;
export type JsonValue = z.output<typeof JsonValue>;
