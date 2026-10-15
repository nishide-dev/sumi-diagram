/**
 * Component manifests (design doc §3): a declarative contract per component,
 * discriminated by `kind`. The Zod schemas below are the single source of
 * truth for both the manifest types and their self-validation in
 * `Registry.register`.
 *
 * Manifests carry meaning, shape and constraints only; appearance comes from
 * Themes (#6) and D2 lowering from the compiler (#8).
 */

import { valid as validVersion } from "semver";
import { z } from "zod";

export const MANIFEST_VERSION = 1;

/** Namespace of the built-in components; short names resolve only here. */
export const BUILTIN_NAMESPACE = "sumi";

export const COMPONENT_KINDS = ["node", "group", "edge"] as const;
export type ComponentKind = (typeof COMPONENT_KINDS)[number];

/** Canonical component ID: `<namespace>/<name>`, e.g. `sumi/box`. */
export type ComponentId = `${string}/${string}`;

/** Namespace, name and variant names: lowercase kebab-case. */
export const COMPONENT_NAME_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;

/** Generic node shapes supported by the MVP (D2 `shape` values). */
export const NODE_SHAPES = [
  "rectangle",
  "square",
  "oval",
  "circle",
  "diamond",
  "hexagon",
  "parallelogram",
  "cylinder",
  "document",
  "page",
  "text",
] as const;
export type NodeShape = (typeof NODE_SHAPES)[number];

export const NODE_SIZINGS = ["auto", "fixed-aspect-1"] as const;
export type NodeSizing = (typeof NODE_SIZINGS)[number];

export const EDGE_DIRECTIONS = ["forward", "backward", "both", "none"] as const;
export type EdgeDirection = (typeof EDGE_DIRECTIONS)[number];

export const ARROWHEADS = [
  "triangle",
  "arrow",
  "diamond",
  "circle",
  "box",
  "cross",
  "none",
] as const;
export type Arrowhead = (typeof ARROWHEADS)[number];

const Name = z.string().regex(COMPONENT_NAME_PATTERN, {
  error: `must match ${COMPONENT_NAME_PATTERN.source}`,
});
const Version = z
  .string()
  .refine((v) => validVersion(v) !== null, { error: "must be a semver version" });

/** True for `z.strictObject(...)` (unknown keys are rejected, not stripped). */
function isStrictObject(value: unknown): value is z.ZodObject {
  return value instanceof z.ZodObject && value.def.catchall?._zod.def.type === "never";
}

const ManifestBase = {
  version: z.literal(MANIFEST_VERSION),
  namespace: Name,
  name: Name,
  description: z.string().min(1, { error: "must not be empty" }),
  variants: z
    .array(Name)
    .refine((variants) => variants.includes("default"), { error: 'must include "default"' })
    .refine((variants) => new Set(variants).size === variants.length, {
      error: "must not contain duplicates",
    }),
  /** Component-specific props (never `label`), as a strict Zod object. */
  props: z.custom<z.ZodObject>(isStrictObject, {
    error: "must be a strict Zod object (z.strictObject)",
  }),
  /** Sumi version that introduced the component. */
  since: Version,
  deprecated: z
    .strictObject({
      since: Version,
      replacement: z
        .string()
        .refine((id) => parseComponentId(id) !== undefined, {
          error: "must be a canonical component ID",
        })
        .optional(),
    })
    .optional(),
};

/** Shapes D2 always draws with equal width and height. */
export const FIXED_ASPECT_SHAPES: readonly NodeShape[] = ["circle", "square"];

export const NodeManifestSchema = z
  .strictObject({
    kind: z.literal("node"),
    ...ManifestBase,
    shape: z.enum(NODE_SHAPES),
    /** `fixed-aspect-1` keeps width = height; required for, and only for, circle and square. */
    sizing: z.enum(NODE_SIZINGS),
  })
  .refine((m) => (m.sizing === "fixed-aspect-1") === FIXED_ASPECT_SHAPES.includes(m.shape), {
    error: `must be "fixed-aspect-1" for the shapes ${FIXED_ASPECT_SHAPES.join(" and ")}, and "auto" otherwise`,
    path: ["sizing"],
  });

export const GroupManifestSchema = z.strictObject({
  kind: z.literal("group"),
  ...ManifestBase,
  shape: z.literal("rectangle"),
});

/**
 * `head` is the arrowhead at the target end and `tail` the one at the source
 * end; each may only be set on an end that `direction` gives an arrow.
 */
export const EdgeManifestSchema = z
  .strictObject({
    kind: z.literal("edge"),
    ...ManifestBase,
    direction: z.enum(EDGE_DIRECTIONS),
    head: z.enum(ARROWHEADS).optional(),
    tail: z.enum(ARROWHEADS).optional(),
  })
  .refine((m) => m.head === undefined || m.direction === "forward" || m.direction === "both", {
    error: 'is only allowed when direction is "forward" or "both"',
    path: ["head"],
  })
  .refine((m) => m.tail === undefined || m.direction === "backward" || m.direction === "both", {
    error: 'is only allowed when direction is "backward" or "both"',
    path: ["tail"],
  });

export const ComponentManifestSchema = z.discriminatedUnion("kind", [
  NodeManifestSchema,
  GroupManifestSchema,
  EdgeManifestSchema,
]);

export type NodeManifest = z.output<typeof NodeManifestSchema>;
export type GroupManifest = z.output<typeof GroupManifestSchema>;
export type EdgeManifest = z.output<typeof EdgeManifestSchema>;
export type ComponentManifest = z.output<typeof ComponentManifestSchema>;

/** The manifest type for a given kind. */
export type ManifestOf<K extends ComponentKind> = Extract<ComponentManifest, { kind: K }>;

/** Canonical ID of a manifest. */
export function componentId(manifest: Pick<ComponentManifest, "namespace" | "name">): ComponentId {
  return `${manifest.namespace}/${manifest.name}`;
}

/** Splits a canonical ID, or returns `undefined` if `id` is not one. */
export function parseComponentId(id: string): { namespace: string; name: string } | undefined {
  const [namespace, name, ...rest] = id.split("/");
  if (namespace === undefined || name === undefined || rest.length > 0) return undefined;
  if (!COMPONENT_NAME_PATTERN.test(namespace) || !COMPONENT_NAME_PATTERN.test(name)) {
    return undefined;
  }
  return { namespace, name };
}

/** A component resolved for one element by the `component` stage. */
export interface ResolvedComponent {
  /** Canonical ID; later stages (theme, IR) use this, never the original reference. */
  id: ComponentId;
  manifest: ComponentManifest;
  variant: string;
  /** Props validated against the manifest, with its defaults applied. */
  props: Record<string, unknown>;
}
