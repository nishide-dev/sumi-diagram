/**
 * JSON-serializable view of registered components — the data printed by
 * `sumi catalog --json` (#14). Props are converted to JSON Schema 2020-12
 * (input side: what a figure may write, before defaults are applied).
 */

import { z } from "zod";
import type { ComponentId, ComponentKind, ComponentManifest } from "./manifest";
import { componentId } from "./manifest";
import type { Registry } from "./registry";

export const CATALOG_VERSION = 1;

type JsonSchema = z.core.JSONSchema.JSONSchema;

/** A manifest with `props` as JSON Schema and its canonical `id` added. */
export type CatalogEntry = { id: ComponentId } & DistributiveOmit<
  ComponentManifest,
  "version" | "props"
> & { props: JsonSchema };

export interface Catalog {
  version: typeof CATALOG_VERSION;
  components: CatalogEntry[];
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Converts a props schema to JSON Schema; throws if it is not representable. */
export function propsJsonSchema(props: z.ZodObject): JsonSchema {
  return z.toJSONSchema(props, {
    target: "draft-2020-12",
    io: "input",
    unrepresentable: "throw",
  });
}

export function catalogEntry(manifest: ComponentManifest): CatalogEntry {
  const { version: _version, props, ...rest } = manifest;
  return { id: componentId(manifest), ...rest, props: propsJsonSchema(props) };
}

/** The catalog of `registry`, in registration order, optionally of one kind. */
export function buildCatalog(
  registry: Registry,
  options: { kind?: ComponentKind | undefined } = {},
): Catalog {
  return { version: CATALOG_VERSION, components: registry.list(options).map(catalogEntry) };
}
