/**
 * Output Profile definition format v1 (design doc §5.2).
 *
 * A profile describes the physical output target: page limits, outer margin,
 * minimum font size and layout spacing. Lengths are written with a unit and
 * normalized to pt ({@link Length}).
 *
 * The spacing between nodes in the same layer is fixed at 20 D2 units (10pt) in
 * D2 v0.9 and cannot be configured, so profiles have no field for it.
 */

import { type core, z } from "zod";
import { type Diagnostic, type DocPath, didYouMean, formatDocPath } from "../diagnostics";
import { errorAt } from "../figure/report";
import { ID_PATTERN, type LayoutDensity } from "../figure/schema";
import type { Locator } from "../figure/yaml";
import type { Result } from "../result";
import { type Length, parseLength } from "../units";

export const PROFILE_FORMAT_VERSION = 1;

/** Code of the diagnostic for a malformed or out-of-range length. */
const INVALID_LENGTH = "profile/invalid-length";

/**
 * A length field. `positive` lengths must be > 0, the others ≥ 0. Failures are
 * reported as `profile/invalid-length` with a hint.
 */
function lengthField(bound: "positive" | "non-negative") {
  return z.union([z.string(), z.number()]).transform((input, ctx): Length => {
    const parsed = parseLength(input);
    if (!parsed.ok) {
      ctx.addIssue({
        code: "custom",
        message: parsed.message,
        params: { code: INVALID_LENGTH, hint: parsed.hint },
      });
      return z.NEVER;
    }
    const { length } = parsed;
    if (bound === "positive" ? length.exactPt.num <= 0n : length.exactPt.num < 0n) {
      ctx.addIssue({
        code: "custom",
        message: `Length ${JSON.stringify(input)} must be ${bound === "positive" ? "greater than zero" : "zero or more"}.`,
        params: { code: INVALID_LENGTH },
      });
      return z.NEVER;
    }
    return length;
  });
}

/**
 * Defaults of the structured-layout spacing (design doc §6.21), so profile
 * definitions written before it stay valid. They are the paper profiles'
 * values, taken from the #86 prototype.
 */
export const STRUCTURED_DEFAULTS = {
  arrangeGap: "4mm",
  groupPadding: "8pt",
  nodePaddingX: "7pt",
  nodePaddingY: "3.5pt",
} as const;

/**
 * Defaults of the compact structured spacing (#182, design doc §6.55): the
 * paper profiles' values for `figure.layout.density: compact`.
 */
export const COMPACT_DEFAULTS = {
  arrangeGap: "2.5mm",
  groupPadding: "6pt",
  nodePaddingX: "7pt",
  nodePaddingY: "1.5pt",
} as const;

export const ProfileSchema = z.strictObject({
  version: z.literal(PROFILE_FORMAT_VERSION),
  id: z.string().regex(ID_PATTERN),
  description: z.string(),
  page: z
    .strictObject({
      /** Upper limit of the output width, margin included. Compared unquantized. */
      maxWidth: lengthField("positive").optional(),
      /** Upper limit of the output height, margin included. Compared unquantized. */
      maxHeight: lengthField("positive").optional(),
    })
    .prefault({}),
  /** Space around the content bounds; D2 `--pad`. */
  margin: lengthField("non-negative"),
  typography: z.strictObject({
    /** Smallest effective font size allowed in a figure. Compared unquantized. */
    minFontSize: lengthField("positive"),
    /**
     * Smallest printed font size in a figure that `figure.fit: scale` shrinks
     * (#183, design doc §6.48). Omitted means `minFontSize` (no relaxation).
     */
    minScaledFontSize: lengthField("positive").optional(),
  }),
  layout: z.strictObject({
    /** Gap between ELK layers: `nodeNodeBetweenLayers`, and half of it as `edgeNodeBetweenLayers`. */
    layerGap: lengthField("non-negative"),
    /** Inner padding of containers; ELK `--elk-padding` (D2 enlarges the top for the label). */
    containerPadding: lengthField("non-negative"),
    /**
     * Structured layout (design doc §6.21): space between the items of a stack
     * or row that omits `gap`. Not quantized (like a written `gap`).
     */
    arrangeGap: lengthField("non-negative").prefault(STRUCTURED_DEFAULTS.arrangeGap),
    /** Structured layout: inner padding of a group on all four sides. */
    groupPadding: lengthField("non-negative").prefault(STRUCTURED_DEFAULTS.groupPadding),
    /** Structured layout: space between a node's label and its shape, left and right. */
    nodePaddingX: lengthField("non-negative").prefault(STRUCTURED_DEFAULTS.nodePaddingX),
    /** Structured layout: space between a node's label and its shape, top and bottom. */
    nodePaddingY: lengthField("non-negative").prefault(STRUCTURED_DEFAULTS.nodePaddingY),
    /**
     * Structured layout: the four values above for a figure with
     * `figure.layout.density: compact` (#182, design doc §6.55).
     */
    compact: z
      .strictObject({
        arrangeGap: lengthField("non-negative"),
        groupPadding: lengthField("non-negative"),
        nodePaddingX: lengthField("non-negative"),
        nodePaddingY: lengthField("non-negative"),
      })
      .prefault(COMPACT_DEFAULTS),
  }),
});

/** A validated profile with every length normalized to pt. */
export type Profile = z.output<typeof ProfileSchema>;

/** A profile definition as written (lengths as strings such as `"88mm"`). */
export type ProfileDefinition = z.input<typeof ProfileSchema>;

export interface ValidateProfileOptions {
  /** Maps paths in the definition to source locations, if it came from a file. */
  locate?: Locator;
}

/**
 * Validates a profile definition (stage `profile`). All problems are reported,
 * with paths relative to the definition.
 */
export function validateProfile(
  raw: unknown,
  options: ValidateProfileOptions = {},
): Result<Profile> {
  const locate = options.locate ?? (() => undefined);
  const parsed = ProfileSchema.safeParse(raw);
  if (parsed.success) return { ok: true, value: parsed.data, diagnostics: [] };
  // Every issue maps to an error, so the result always fails.
  return {
    ok: false,
    diagnostics: parsed.error.issues.flatMap((i) => toDiagnostics(i, raw, locate)),
  };
}

function toDiagnostics(issue: core.$ZodIssue, raw: unknown, locate: Locator): Diagnostic[] {
  const path: DocPath = issue.path.filter((s) => typeof s !== "symbol");
  const at = formatDocPath(path);
  const actual = valueAt(raw, path);
  const error = (code: string, message: string, hint?: string) =>
    errorAt(locate, code, message, path, { hint });

  switch (issue.code) {
    case "unrecognized_keys": {
      const known = keysAt(path);
      return issue.keys.map((key) =>
        errorAt(
          locate,
          "profile/unknown-field",
          `Unknown field "${key}" in ${at}.`,
          [...path, key],
          {
            atKey: true,
            hint: didYouMean(key, known),
          },
        ),
      );
    }
    case "custom": {
      const params = issue.params as { code?: string; hint?: string } | undefined;
      return [
        error(params?.code ?? "profile/invalid-value", `${at}: ${issue.message}`, params?.hint),
      ];
    }
    case "invalid_union":
    case "invalid_type":
      if (actual === undefined && path.length > 0) {
        return [
          error(
            "profile/missing-field",
            `Missing required field "${String(path.at(-1))}" in ${formatDocPath(path.slice(0, -1))}.`,
          ),
        ];
      }
      if (issue.code === "invalid_union") {
        // Only length fields are unions (string | number); anything else fails parsing.
        const parsed = parseLength(actual);
        const message = parsed.ok ? "Invalid length." : parsed.message;
        return [error(INVALID_LENGTH, `${at}: ${message}`, parsed.ok ? undefined : parsed.hint)];
      }
      return [error("profile/invalid-type", `Expected ${typeName(issue.expected)} at ${at}.`)];
    case "invalid_value":
      if (at === "version") {
        return [
          error(
            "profile/unsupported-version",
            `Unsupported profile format version ${JSON.stringify(actual)}; this Sumi supports version ${PROFILE_FORMAT_VERSION}.`,
          ),
        ];
      }
      break;
    case "invalid_format":
      return [
        error(
          "profile/invalid-value",
          `Invalid profile ID ${JSON.stringify(actual)}; IDs must match ${ID_PATTERN.source}.`,
        ),
      ];
  }
  return [error("profile/invalid-value", `Invalid value at ${at}: ${issue.message}.`)];
}

/** Known keys of the object at `path` in {@link ProfileSchema}. */
function keysAt(path: DocPath): string[] {
  let current: unknown = ProfileSchema;
  for (const segment of [...path, undefined]) {
    while (current instanceof z.ZodOptional || current instanceof z.ZodPrefault) {
      current = current.unwrap();
    }
    if (!(current instanceof z.ZodObject)) return [];
    if (segment === undefined) return Object.keys(current.shape);
    current = current.shape[segment];
  }
  return [];
}

function valueAt(value: unknown, path: DocPath): unknown {
  let current = value;
  for (const segment of path) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string | number, unknown>)[segment];
  }
  return current;
}

function typeName(expected: string): string {
  if (expected === "object") return "a mapping";
  return `a ${expected}`;
}

/**
 * The profile a structured figure is laid out with (#182, design doc §6.55):
 * `profile` itself, or for `density: compact` a copy whose structured
 * spacing (`arrangeGap`, `groupPadding`, `nodePaddingX` / `nodePaddingY`) is
 * `layout.compact`. Page limits, margin, typography and the auto engine's
 * values are unchanged.
 */
export function spacedProfile(profile: Profile, density: LayoutDensity | undefined): Profile {
  if (density !== "compact") return profile;
  return { ...profile, layout: { ...profile.layout, ...profile.layout.compact } };
}
