/**
 * The whole catalog printed by `sumi catalog --json` (#14, #37): components
 * (`buildCatalog()`), themes (`buildThemeCatalog()`), profiles
 * (`buildProfileCatalog()`) and the bundled icon sets (`iconSets()`, #94) in
 * one envelope with `version: CATALOG_VERSION`.
 *
 * Compatibility: within a version, fields and sections are only added, never
 * removed or changed (design doc §6.10). The `themes` and `profiles` sections
 * were added to version 1 in #37, `icons` in #94, `targets` in #347 and `sets` in #407; a reader of
 * `{ version: 1, components }` keeps working.
 */

import { z } from "zod";
import { type IconSetInfo, iconSets } from "../assets/icons";
import {
  FigureTargetSchema,
  SET_LABEL_POSITIONS,
  SET_SHAPES,
  SET_VARIANTS,
  SetSchema,
} from "./figure/schema";
import { buildProfileCatalog, type ProfileCatalogEntry } from "./profile/catalog";
import { buildCatalog, CATALOG_VERSION, type CatalogEntry } from "./registry/catalog";
import type { ComponentKind } from "./registry/manifest";
import type { Registry } from "./registry/registry";
import { buildThemeCatalog, type ThemeCatalogEntry } from "./theme/catalog";

export const CATALOG_SECTIONS = [
  "components",
  "themes",
  "profiles",
  "icons",
  "targets",
  "sets",
] as const;
export type CatalogSection = (typeof CATALOG_SECTIONS)[number];

/** The catalog; a section is present only if it was selected. */
export interface FullCatalog {
  version: typeof CATALOG_VERSION;
  components?: CatalogEntry[];
  themes?: ThemeCatalogEntry[];
  profiles?: ProfileCatalogEntry[];
  /** The bundled icon sets (names: `sumi catalog --icons <words>`). */
  icons?: IconSetInfo[];
  /** Input schema for figure.target: optional placement-specific lint values. */
  targets?: ReturnType<typeof buildTargetCatalog>;
  /** Input schema for the figure's `sets`: enclosures that may overlap (#407). */
  sets?: ReturnType<typeof buildSetCatalog>;
}

export function buildTargetCatalog() {
  return {
    path: "figure.target",
    description:
      "Placement-specific lint targets; height is a budget, fitting remains width-only. Font minima override the profile at final size; math scripts (0.7x) are checked against minFontSize (geometry/script-below-target).",
    schema: z.toJSONSchema(FigureTargetSchema, { io: "input" }),
  };
}

export function buildSetCatalog() {
  return {
    path: "sets",
    description:
      "Set enclosures for Venn diagrams and hyperedges: a translucent circle, ellipse, rounded hull or rounded rectangle fitted around nodes and groups after they are placed. A node can be a member of several sets; sets may overlap, are drawn below nodes and edges, take no space in the arrange trees and need the structured layout. Place the members with arrange (place for exact positions); a node inside the outline that is not a member is reported (geometry/set-contains-non-member).",
    shapes: [...SET_SHAPES],
    variants: [...SET_VARIANTS],
    labelAt: [...SET_LABEL_POSITIONS],
    schema: z.toJSONSchema(SetSchema, { io: "input" }),
  };
}

export interface FullCatalogOptions {
  /** Sections to include, in any order (output order is fixed). Default: all. */
  sections?: readonly CatalogSection[];
  /** Only components of this kind (the `components` section only). */
  kind?: ComponentKind | undefined;
}

/** The catalog of the built-in themes and profiles and the components of `registry`. */
export function buildFullCatalog(
  registry: Registry,
  options: FullCatalogOptions = {},
): FullCatalog {
  const sections = new Set(options.sections ?? CATALOG_SECTIONS);
  return {
    version: CATALOG_VERSION,
    ...(sections.has("components") && {
      components: buildCatalog(registry, { kind: options.kind }).components,
    }),
    ...(sections.has("themes") && { themes: buildThemeCatalog(undefined, { registry }) }),
    ...(sections.has("profiles") && { profiles: buildProfileCatalog() }),
    ...(sections.has("icons") && { icons: iconSets() }),
    ...(sections.has("targets") && { targets: buildTargetCatalog() }),
    ...(sections.has("sets") && { sets: buildSetCatalog() }),
  };
}
