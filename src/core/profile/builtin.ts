/**
 * Built-in output profiles (design doc §5.2) and lookup by name.
 *
 * Paper profiles use a 2mm margin, a 10mm layer gap and 4mm container padding
 * (the design doc example). The presentation profile doubles every spacing
 * value, matching its doubled minimum font size (14pt vs 7pt).
 */

import { type DocPath, didYouMean } from "../diagnostics";
import { errorAt } from "../figure/report";
import type { Locator } from "../figure/yaml";
import type { Result } from "../result";
import { type Profile, type ProfileDefinition, validateProfile } from "./schema";

const PAPER_SPACING = {
  margin: "2mm",
  layout: { layerGap: "10mm", containerPadding: "4mm" },
} as const;

export const BUILTIN_PROFILE_DEFINITIONS: readonly ProfileDefinition[] = [
  {
    version: 1,
    id: "paper-single",
    description: "Single-column figure in a two-column paper",
    page: { maxWidth: "88mm" },
    ...PAPER_SPACING,
    typography: { minFontSize: "7pt" },
  },
  {
    version: 1,
    id: "paper-double",
    description: "Full-width (double-column) figure in a two-column paper",
    page: { maxWidth: "180mm" },
    ...PAPER_SPACING,
    typography: { minFontSize: "7pt" },
  },
  {
    version: 1,
    id: "presentation-16x9",
    description: "16:9 presentation slide (13.33in × 7.5in); used as an upper bound only",
    page: { maxWidth: "338.7mm", maxHeight: "190.5mm" },
    margin: "4mm",
    typography: { minFontSize: "14pt" },
    layout: { layerGap: "20mm", containerPadding: "8mm" },
  },
];

/** Built-in profiles by ID, validated once at load. */
export const BUILTIN_PROFILES: ReadonlyMap<string, Profile> = new Map(
  BUILTIN_PROFILE_DEFINITIONS.map((definition) => {
    const result = validateProfile(definition);
    if (!result.ok) {
      const messages = result.diagnostics.map((d) => d.message).join(" ");
      throw new Error(`internal error: invalid built-in profile "${definition.id}": ${messages}`);
    }
    return [result.value.id, result.value];
  }),
);

/** Returns the built-in profile with the given ID, if any. */
export function getProfile(id: string): Profile | undefined {
  return BUILTIN_PROFILES.get(id);
}

/**
 * Resolves a profile name such as `figure.profile`. An unknown name is reported
 * as `profile/unknown` at `path`, with the closest built-in name as a hint.
 */
export function resolveProfile(
  name: string,
  path: DocPath = ["figure", "profile"],
  locate: Locator = () => undefined,
): Result<Profile> {
  const profile = getProfile(name);
  if (profile) return { ok: true, value: profile, diagnostics: [] };
  const names = [...BUILTIN_PROFILES.keys()];
  const available = `Available profiles: ${names.join(", ")}.`;
  const suggestion = didYouMean(name, names);
  return {
    ok: false,
    diagnostics: [
      errorAt(locate, "profile/unknown", `Unknown profile "${name}".`, path, {
        hint: suggestion ? `${suggestion} ${available}` : available,
      }),
    ],
  };
}
