/**
 * JSON-serializable view of output profiles — the `profiles` section of
 * `sumi catalog --json` (#37). Every length is given as written and in pt and
 * mm (rounded to 0.01 for reading; the CLI compares unrounded values). Layout
 * values also carry the integer D2 units they are passed to D2 as (§5.2).
 */

import { formatLength, type Length, ptToMm } from "../units";
import { BUILTIN_PROFILES } from "./builtin";
import { toD2LayoutArgs } from "./d2";
import type { Profile } from "./schema";

/** A length of a profile: as written (`"88mm"`) and in pt and mm. */
export interface CatalogLength {
  written: string;
  pt: number;
  mm: number;
}

/** A layout length plus the integer D2 units it becomes (rounded, §5.2). */
export interface CatalogLayoutLength extends CatalogLength {
  d2Units: number;
}

export interface ProfileCatalogEntry {
  id: string;
  description: string;
  /** Upper limits of the output size, margin included; `null` = no limit. */
  page: { maxWidth: CatalogLength | null; maxHeight: CatalogLength | null };
  /** Space around the content (D2 `--pad`). */
  margin: CatalogLayoutLength;
  typography: { minFontSize: CatalogLength };
  layout: {
    /** Gap between layers (ELK `nodeNodeBetweenLayers`; half of it between edges and nodes). */
    layerGap: CatalogLayoutLength;
    /** Inner padding of containers (ELK `--elk-padding`). */
    containerPadding: CatalogLayoutLength;
  };
}

/** Rounds to 0.01, for reporting physical sizes. */
export const round2 = (value: number): number => Math.round(value * 100) / 100;

function catalogLength(length: Length): CatalogLength {
  return { written: formatLength(length), pt: round2(length.pt), mm: round2(ptToMm(length.pt)) };
}

/** The catalog entry of one profile. */
export function profileCatalogEntry(profile: Profile): ProfileCatalogEntry {
  const { effective } = toD2LayoutArgs(profile);
  const layout = (length: Length, d2Units: number): CatalogLayoutLength => ({
    ...catalogLength(length),
    d2Units,
  });
  return {
    id: profile.id,
    description: profile.description,
    page: {
      maxWidth: profile.page.maxWidth === undefined ? null : catalogLength(profile.page.maxWidth),
      maxHeight:
        profile.page.maxHeight === undefined ? null : catalogLength(profile.page.maxHeight),
    },
    margin: layout(profile.margin, effective.pad.units),
    typography: { minFontSize: catalogLength(profile.typography.minFontSize) },
    layout: {
      layerGap: layout(profile.layout.layerGap, effective.nodeNodeBetweenLayers.units),
      containerPadding: layout(profile.layout.containerPadding, effective.padding.units),
    },
  };
}

/** Catalog entries of `profiles` (default: the built-ins), in their order. */
export function buildProfileCatalog(
  profiles: ReadonlyMap<string, Profile> = BUILTIN_PROFILES,
): ProfileCatalogEntry[] {
  return [...profiles.values()].map(profileCatalogEntry);
}
