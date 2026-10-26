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

export const OutlineRenderSchema = z.strictObject({
  type: z.literal("outline"),
  renderer: z.string().refine((id) => parseComponentId(id) !== undefined, {
    error: "must be a canonical renderer ID",
  }),
  params: z.record(z.string(), z.union([z.number(), z.boolean(), z.string()])).optional(),
});
export type OutlineRender = z.output<typeof OutlineRenderSchema>;

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

/**
 * A node drawn as a fixed mark instead of a labeled shape (#92, design doc
 * §6.20). Such a node takes no label (`component/unexpected-label`) and no
 * size props: its width and height (equal) follow from the theme.
 *
 * - `glyph`: the text for the value of prop `prop` (a string enum whose
 *   values are exactly the keys of `glyphs`) is drawn as the label, centered.
 *   The diameter is `size` × the resolved font size.
 * - `point`: only the shape is drawn, e.g. a dot where lines branch. The
 *   diameter is `size` × the resolved stroke width. Tones do not apply
 *   (`component/tone-unsupported`).
 *
 * Sizes are rounded to whole D2 units (0.5pt), at least one unit.
 */
export const NodeMarkSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("glyph"),
    prop: z.string().min(1),
    glyphs: z.record(z.string(), z.string().min(1)),
    size: z.number().positive(),
  }),
  z.strictObject({
    type: z.literal("point"),
    size: z.number().positive(),
  }),
]);
export type NodeMark = z.output<typeof NodeMarkSchema>;

/**
 * The text a mark draws for validated props: the glyph of the prop's value,
 * or `""` for a point. Shared by the IR and the text lint rules, so both see
 * the same drawn text. `undefined` if the props select no glyph.
 */
export function markText(mark: NodeMark, props: Record<string, unknown>): string | undefined {
  if (mark.type === "point") return "";
  return Object.hasOwn(mark.glyphs, String(props[mark.prop]))
    ? mark.glyphs[String(props[mark.prop])]
    : undefined;
}

/** `true` if the props schema (when it is a Zod object) declares any of `names`. */
function hasProp(props: unknown, ...names: string[]): boolean {
  return props instanceof z.ZodObject && names.some((name) => name in props.shape);
}

/** The values of a string enum prop, or `undefined` if the prop is not one. */
function enumValues(props: unknown, prop: string): string[] | undefined {
  if (!(props instanceof z.ZodObject)) return undefined;
  const schema = props.shape[prop];
  if (!(schema instanceof z.ZodEnum)) return undefined;
  const values: unknown[] = schema.options;
  return values.every((v) => typeof v === "string") ? (values as string[]) : undefined;
}

/** How an image fills its node's box (#94); the SVG `preserveAspectRatio` of each. */
export const IMAGE_FITS = ["contain", "cover", "fill"] as const;

/** A prop's schema without its `.optional()` / `.default()` wrappers. */
function unwrapped(props: unknown, prop: string): unknown {
  if (!(props instanceof z.ZodObject)) return undefined;
  let schema: unknown = props.shape[prop];
  while (schema instanceof z.ZodOptional || schema instanceof z.ZodDefault) {
    schema = schema.unwrap();
  }
  return schema;
}

/**
 * The props an image embed needs: `src` a string, `fit` (if any) a string
 * enum of {@link IMAGE_FITS} values, and `width` / `height`.
 */
function imageProps(props: unknown): boolean {
  const fit = unwrapped(props, "fit");
  return (
    // src must always be a string: not optional (a default is fine).
    props instanceof z.ZodObject &&
    !(props.shape.src instanceof z.ZodOptional) &&
    unwrapped(props, "src") instanceof z.ZodString &&
    (fit === undefined ||
      (fit instanceof z.ZodEnum &&
        (fit.options as unknown[]).every((v) => (IMAGE_FITS as readonly unknown[]).includes(v)))) &&
    hasProp(props, "width") &&
    hasProp(props, "height")
  );
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const set = new Set(a);
  return set.size === a.length && a.length === b.length && b.every((v) => set.has(v));
}

/** Shapes D2 always draws with equal width and height. */
export const FIXED_ASPECT_SHAPES: readonly NodeShape[] = ["circle", "square"];

export const NodeManifestSchema = z
  .strictObject({
    kind: z.literal("node"),
    ...ManifestBase,
    shape: z.enum(NODE_SHAPES),
    /** `fixed-aspect-1` keeps width = height; required for, and only for, circle and square. */
    sizing: z.enum(NODE_SIZINGS),
    render: OutlineRenderSchema.optional(),
    mark: NodeMarkSchema.optional(),
    /**
     * `image` (#94): the node embeds the user's image file named by
     * `props.src` (PNG, JPEG or SVG) in its box instead of drawing a label.
     * It takes no label (`component/unexpected-label`) and no icon.
     */
    embed: z.literal("image").optional(),
  })
  .refine((m) => (m.sizing === "fixed-aspect-1") === FIXED_ASPECT_SHAPES.includes(m.shape), {
    error: `must be "fixed-aspect-1" for the shapes ${FIXED_ASPECT_SHAPES.join(" and ")}, and "auto" otherwise`,
    path: ["sizing"],
  })
  .refine((m) => m.render === undefined || m.shape === "rectangle", {
    error: 'outline rendering requires shape "rectangle" and sizing "auto"',
    path: ["shape"],
  })
  .refine((m) => m.mark === undefined || (m.sizing === "fixed-aspect-1" && !m.render), {
    error: 'a mark requires sizing "fixed-aspect-1" and no outline rendering',
    path: ["mark"],
  })
  .refine(
    (m) =>
      m.embed === undefined ||
      (m.shape === "rectangle" &&
        m.render === undefined &&
        m.mark === undefined &&
        imageProps(m.props)),
    {
      error:
        'an image embed requires shape "rectangle", no outline rendering or mark, a string prop src, props width and height, and an optional prop fit of contain / cover / fill',
      path: ["embed"],
    },
  )
  .refine((m) => m.mark === undefined || !hasProp(m.props, "width", "height"), {
    error: "a mark takes its size from the theme, so props must not have width or height",
    path: ["props"],
  })
  .refine(
    (m) => {
      if (m.mark?.type !== "glyph") return true;
      const values = enumValues(m.props, m.mark.prop);
      return values !== undefined && sameSet(values, Object.keys(m.mark.glyphs));
    },
    {
      error: "a glyph mark's prop must be a string enum prop whose values are the keys of glyphs",
      path: ["mark", "glyphs"],
    },
  );

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
