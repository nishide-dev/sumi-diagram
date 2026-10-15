/**
 * JSON-serializable view of themes — the `themes` section of
 * `sumi catalog --json` (#37). Everything is derived from the validated
 * themes, the component registry and the profiles, so a new built-in theme,
 * component or profile shows up without changes here.
 */

import { BUILTIN_PROFILES } from "../profile/builtin";
import type { Profile } from "../profile/schema";
import { createBuiltinRegistry } from "../registry/builtins";
import {
  COMPONENT_KINDS,
  type ComponentId,
  type ComponentKind,
  componentId,
} from "../registry/manifest";
import type { Registry } from "../registry/registry";
import { BUILTIN_THEMES } from "./builtin";
import type { FontSet } from "./fonts";
import { resolveStyle } from "./resolve";
import type { Theme } from "./schema";
import { mergeStyle } from "./style";

/** Font styles a font set provides; `italic: true` / `mono: true` need theirs. */
export type FontStyle = "regular" | "bold" | "italic" | "mono";

export interface ThemeCatalogEntry {
  id: string;
  description: string | null;
  fonts: { id: string; description: string; styles: FontStyle[] };
  /** Effective font sizes in pt. */
  fontSizePt: {
    /** Smallest over every component and variant (and the base sizes). */
    min: number;
    /** Largest over every component and variant (and the base sizes). */
    max: number;
    /** The theme's base size per kind (before variants). */
    base: { [K in ComponentKind]: number };
  };
  /**
   * Variants the theme has no style for, by component (only components with
   * any). They render with the component's default style and a
   * `theme/missing-variant` warning. Every component in the catalog is usable
   * with every theme.
   */
  missingVariants: Record<ComponentId, string[]>;
  /**
   * Profiles whose minimum font size every component and variant of the theme
   * meets, so the theme never causes `profile/font-too-small` with them.
   */
  compatibleProfiles: string[];
}

export interface ThemeCatalogOptions {
  /** Components to derive variants and font sizes from. Defaults to the built-ins. */
  registry?: Registry;
  /** Profiles to check font sizes against. Defaults to the built-ins. */
  profiles?: ReadonlyMap<string, Profile>;
}

function fontStyles(fontSet: FontSet): FontStyle[] {
  return [
    "regular",
    "bold",
    ...(fontSet.italic === undefined ? [] : (["italic"] as const)),
    ...(fontSet.mono === undefined ? [] : (["mono"] as const)),
  ];
}

/** The catalog entry of one theme. */
export function themeCatalogEntry(
  theme: Theme,
  options: ThemeCatalogOptions = {},
): ThemeCatalogEntry {
  const { registry = createBuiltinRegistry(), profiles = BUILTIN_PROFILES } = options;
  const sizes: number[] = [];
  const missingVariants: Record<ComponentId, string[]> = {};
  for (const manifest of registry.list()) {
    const id = componentId(manifest);
    for (const variant of manifest.variants) {
      const { style, missingVariant } = resolveStyle(theme, { kind: manifest.kind, id, variant });
      sizes.push(style.fontSize.pt);
      if (missingVariant) missingVariants[id] = [...(missingVariants[id] ?? []), variant];
    }
  }
  const base = Object.fromEntries(
    COMPONENT_KINDS.map((kind) => [kind, mergeStyle(kind, [theme.base[kind]]).fontSize.pt]),
  ) as ThemeCatalogEntry["fontSizePt"]["base"];
  // The base sizes count too, so a registry without components still has a range.
  sizes.push(...Object.values(base));
  const min = Math.min(...sizes);
  const max = Math.max(...sizes);
  return {
    id: theme.id,
    description: theme.description ?? null,
    fonts: {
      id: theme.fontSet.id,
      description: theme.fontSet.description,
      styles: fontStyles(theme.fontSet),
    },
    fontSizePt: { min, max, base },
    missingVariants,
    compatibleProfiles: [...profiles.values()]
      .filter((profile) => profile.typography.minFontSize.pt <= min)
      .map((profile) => profile.id),
  };
}

/** Catalog entries of `themes` (default: the built-ins), in their order. */
export function buildThemeCatalog(
  themes: ReadonlyMap<string, Theme> = BUILTIN_THEMES,
  options: ThemeCatalogOptions = {},
): ThemeCatalogEntry[] {
  const registry = options.registry ?? createBuiltinRegistry();
  return [...themes.values()].map((theme) => themeCatalogEntry(theme, { ...options, registry }));
}
