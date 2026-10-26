/**
 * The whole catalog printed by `sumi catalog --json` (#14, #37): components
 * (`buildCatalog()`), themes (`buildThemeCatalog()`), profiles
 * (`buildProfileCatalog()`) and the bundled icon sets (`iconSets()`, #94) in
 * one envelope with `version: CATALOG_VERSION`.
 *
 * Compatibility: within a version, fields and sections are only added, never
 * removed or changed (design doc §6.10). The `themes` and `profiles` sections
 * were added to version 1 in #37 and `icons` in #94; a reader of
 * `{ version: 1, components }` keeps working.
 */

import { type IconSetInfo, iconSets } from "../assets/icons";
import { buildProfileCatalog, type ProfileCatalogEntry } from "./profile/catalog";
import { buildCatalog, CATALOG_VERSION, type CatalogEntry } from "./registry/catalog";
import type { ComponentKind } from "./registry/manifest";
import type { Registry } from "./registry/registry";
import { buildThemeCatalog, type ThemeCatalogEntry } from "./theme/catalog";

export const CATALOG_SECTIONS = ["components", "themes", "profiles", "icons"] as const;
export type CatalogSection = (typeof CATALOG_SECTIONS)[number];

/** The catalog; a section is present only if it was selected. */
export interface FullCatalog {
  version: typeof CATALOG_VERSION;
  components?: CatalogEntry[];
  themes?: ThemeCatalogEntry[];
  profiles?: ProfileCatalogEntry[];
  /** The bundled icon sets (names: `sumi catalog --icons <words>`). */
  icons?: IconSetInfo[];
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
  };
}
