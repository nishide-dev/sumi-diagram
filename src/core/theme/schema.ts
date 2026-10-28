/**
 * Theme definition format v1 and its validation (design doc §4.3).
 *
 * A theme names a font set, defines typed tokens and gives partial styles per
 * kind (`base`) and per component variant (`components`). Values are literals
 * or token references `{group.name}`; tokens may reference other tokens.
 * Validation resolves every reference, checks types, ranges and fonts, and
 * normalizes component keys to canonical IDs, so a valid {@link Theme} only
 * holds checked, quantized values.
 *
 * `tones` (#92) maps tone names ({@link TONE_NAMES}) to color-only layers
 * applied over the variant of a node or group that sets `tone`.
 *
 * `dim` (#175) gives the colors of a dimmed group and everything inside it:
 * one text color, one line color and how far fills move toward white (see
 * `dim.ts`).
 */

import { z } from "zod";
import {
  type Diagnostic,
  type DocPath,
  didYouMean,
  formatDocPath,
  hasErrors,
} from "../diagnostics";
import { errorAt, relatedAt } from "../figure/report";
import { ID_PATTERN } from "../figure/schema";
import type { Locator } from "../figure/yaml";
import { builtinRegistry } from "../registry/builtins";
import {
  COMPONENT_KINDS,
  type ComponentId,
  type ComponentKind,
  componentId,
} from "../registry/manifest";
import type { Registry } from "../registry/registry";
import type { Result } from "../result";
import type { DimColors } from "./dim";
import { BUILTIN_FONT_SETS, type FontSet } from "./fonts";
import type { Color } from "./style";
import {
  appliesTo,
  checkPropertyValue,
  inferValue,
  mergeStyle,
  STYLE_PROPERTIES,
  STYLE_PROPERTY_NAMES,
  type StyleLayer,
  type StyleProperty,
  type StyleValues,
  type TypedValue,
} from "./style";
import { isTone, TONE_NAMES, type Tone } from "./tones";

export const THEME_FORMAT_VERSION = 1;

/** A token group or leaf name. Dots separate the segments of a reference. */
export const TOKEN_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

/** A token reference such as `{color.fg}`: the whole string, no spaces. */
const TOKEN_REFERENCE_PATTERN = /^\{([a-zA-Z][a-zA-Z0-9_-]*(?:\.[a-zA-Z][a-zA-Z0-9_-]*)*)\}$/;

/** A written value: a literal or a token reference. */
export type ValueInput = string | number | boolean;

/** Nested token groups whose leaves are literals or references. */
export interface TokenTree {
  [name: string]: ValueInput | TokenTree;
}

export type StyleLayerInput = { [P in StyleProperty]?: ValueInput };

/** A theme definition as written. */
export interface ThemeDefinition {
  version: 1;
  id: string;
  description?: string;
  /** Font set ID, e.g. `sumi/biz-ud-gothic`. */
  fonts: string;
  tokens?: TokenTree;
  base?: { [K in ComponentKind]?: StyleLayerInput };
  /** Component reference (short name or canonical ID) → variant → partial style. */
  components?: Record<string, Record<string, StyleLayerInput>>;
  /** Tone name → colors (fill, stroke, fontColor) for nodes and groups with that tone. */
  tones?: Partial<Record<Tone, StyleLayerInput>>;
  /** Colors of dimmed elements (#175): every text, every line, and how pale fills become. */
  dim?: { fontColor: ValueInput; stroke: ValueInput; lighten: ValueInput };
}

/** A validated theme. All values are checked and resolved; component keys are canonical. */
export interface Theme {
  readonly id: string;
  readonly description?: string;
  readonly fontSet: FontSet;
  /** Resolved tokens by dotted name, e.g. `color.fg`. */
  readonly tokens: ReadonlyMap<string, TypedValue>;
  readonly base: { readonly [K in ComponentKind]: StyleLayer };
  readonly components: ReadonlyMap<ComponentId, ReadonlyMap<string, StyleLayer>>;
  /** Color layers by tone; a tone the theme does not define is not here. */
  readonly tones: ReadonlyMap<Tone, StyleLayer>;
  /** Colors of dimmed elements (#175); a theme without them draws `dim` groups as they are. */
  readonly dim?: DimColors;
}

/** The style properties a tone may set: colors only, so tones never change sizes or fonts. */
export const TONE_PROPERTIES: readonly StyleProperty[] = ["fill", "stroke", "fontColor"];

// Property values are checked by `validateTheme` itself (typing needs tokens),
// so the Zod schema only fixes the structure.
const StyleLayerSchema = z.strictObject(
  Object.fromEntries(STYLE_PROPERTY_NAMES.map((name) => [name, z.unknown().optional()])) as {
    [P in StyleProperty]: z.ZodOptional<z.ZodUnknown>;
  },
);

export const ThemeSchema = z.strictObject({
  version: z.literal(THEME_FORMAT_VERSION),
  id: z.string().regex(ID_PATTERN),
  description: z.string().optional(),
  fonts: z.string(),
  tokens: z.record(z.string(), z.unknown()).optional(),
  base: z
    .strictObject({
      node: StyleLayerSchema.optional(),
      group: StyleLayerSchema.optional(),
      edge: StyleLayerSchema.optional(),
    })
    .optional(),
  components: z.record(z.string(), z.record(z.string(), StyleLayerSchema)).optional(),
  tones: z.record(z.string(), StyleLayerSchema).optional(),
  dim: z
    .strictObject({ fontColor: z.unknown(), stroke: z.unknown(), lighten: z.unknown() })
    .optional(),
});

export interface ValidateThemeOptions {
  /** Components the theme may style. Defaults to the built-in components. */
  registry?: Registry;
  /** Font sets the theme may use. Defaults to the built-in font sets. */
  fontSets?: ReadonlyMap<string, FontSet>;
  /** Maps paths in the definition to source locations, if it came from a file. */
  locate?: Locator;
}

/**
 * Validates a theme definition (stage `theme`) and resolves its tokens and
 * styles. All problems are reported, with paths relative to the definition.
 */
export function validateTheme(raw: unknown, options: ValidateThemeOptions = {}): Result<Theme> {
  const {
    registry = builtinRegistry(),
    fontSets = BUILTIN_FONT_SETS,
    locate = () => undefined,
  } = options;
  const parsed = ThemeSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      diagnostics: parsed.error.issues.flatMap((issue) =>
        structuralDiagnostics(issue, raw, locate),
      ),
    };
  }
  return new ThemeChecker(parsed.data, registry, fontSets, locate).check();
}

type ParsedTheme = z.output<typeof ThemeSchema>;
type ParsedLayer = z.output<typeof StyleLayerSchema>;

interface TokenSource {
  raw: unknown;
  path: DocPath;
}

class ThemeChecker {
  readonly diagnostics: Diagnostic[] = [];
  readonly #tokens = new Map<string, TokenSource>();
  /** Groups of the token tree, e.g. `color`, so references to them are explained. */
  readonly #tokenGroups = new Set<string>();
  /** Resolved tokens; `null` once a token failed (its error is already reported). */
  readonly #resolved = new Map<string, TypedValue | null>();
  readonly #fontSet: FontSet | undefined;

  constructor(
    readonly theme: ParsedTheme,
    readonly registry: Registry,
    readonly fontSets: ReadonlyMap<string, FontSet>,
    readonly locate: Locator,
  ) {
    this.#fontSet = fontSets.get(theme.fonts);
  }

  check(): Result<Theme> {
    const { theme } = this;
    if (this.#fontSet === undefined) {
      const known = [...this.fontSets.keys()];
      this.error("theme/unknown-font-set", `Unknown font set "${theme.fonts}".`, ["fonts"], {
        hint: didYouMean(theme.fonts, known) ?? `Available font sets: ${known.join(", ")}.`,
      });
    }

    this.#collectTokens(theme.tokens ?? {}, [], ["tokens"]);
    for (const name of this.#tokens.keys()) this.#resolveToken(name, []);

    const base = {} as Record<ComponentKind, StyleLayer>;
    for (const kind of COMPONENT_KINDS) {
      base[kind] = this.#checkLayer(theme.base?.[kind] ?? {}, kind, ["base", kind]);
    }

    const components = new Map<ComponentId, Map<string, StyleLayer>>();
    /** The reference each component is written as, for diagnostic paths. */
    const refs = new Map<ComponentId, string>();
    for (const [ref, variants] of Object.entries(theme.components ?? {})) {
      const path = ["components", ref];
      const resolved = this.registry.resolve(ref);
      if (!resolved.ok) {
        this.error("theme/unknown-component", `Unknown component "${ref}".`, path, {
          atKey: true,
          hint: resolved.diagnostics[0]?.hint,
        });
        continue;
      }
      const manifest = resolved.value;
      const id = componentId(manifest);
      const previous = refs.get(id);
      if (previous !== undefined) {
        this.error(
          "theme/duplicate-component",
          `Component ${id} is styled twice, as "${previous}" and "${ref}".`,
          path,
          {
            atKey: true,
            hint: "Merge the two entries into one.",
            related: [relatedAt(this.locate, ["components", previous], "First defined here.")],
          },
        );
        continue;
      }
      refs.set(id, ref);
      const layers = new Map<string, StyleLayer>();
      for (const [variant, layer] of Object.entries(variants)) {
        if (!manifest.variants.includes(variant)) {
          this.error(
            "theme/unknown-variant",
            `Unknown variant "${variant}" for ${id}.`,
            [...path, variant],
            {
              atKey: true,
              hint:
                didYouMean(variant, manifest.variants) ??
                `Variants of ${id}: ${manifest.variants.join(", ")}.`,
            },
          );
          continue;
        }
        layers.set(variant, this.#checkLayer(layer, manifest.kind, [...path, variant]));
      }
      components.set(id, layers);
    }

    const tones = new Map<Tone, StyleLayer>();
    for (const [name, layer] of Object.entries(theme.tones ?? {})) {
      const path = ["tones", name];
      if (!isTone(name)) {
        this.error("theme/unknown-tone", `Unknown tone "${name}".`, path, {
          atKey: true,
          hint: didYouMean(name, TONE_NAMES) ?? `Tones: ${TONE_NAMES.join(", ")}.`,
        });
        continue;
      }
      const colors: ParsedLayer = {};
      for (const [property, value] of Object.entries(layer) as [StyleProperty, unknown][]) {
        if (value === undefined) continue;
        if (TONE_PROPERTIES.includes(property)) {
          colors[property] = value;
          continue;
        }
        this.error(
          "theme/inapplicable-property",
          `Property "${property}" does not apply to tones; a tone sets only ${TONE_PROPERTIES.join(", ")}.`,
          [...path, property],
          { atKey: true },
        );
      }
      tones.set(name, this.#checkLayer(colors, "node", path));
    }

    const dim = theme.dim === undefined ? undefined : this.#checkDim(theme.dim);

    this.#checkFontCombinations(base, components, refs);

    if (hasErrors(this.diagnostics) || this.#fontSet === undefined) {
      return { ok: false, diagnostics: this.diagnostics };
    }
    const tokens = new Map<string, TypedValue>();
    for (const [name, value] of this.#resolved) if (value) tokens.set(name, value);
    return {
      ok: true,
      value: deepFreeze({
        id: theme.id,
        ...(theme.description !== undefined && { description: theme.description }),
        fontSet: this.#fontSet,
        tokens,
        base,
        components,
        tones,
        ...(dim !== undefined && { dim }),
      }),
      diagnostics: this.diagnostics,
    };
  }

  error(
    code: string,
    message: string,
    path: DocPath,
    details: Parameters<typeof errorAt>[4] = {},
  ): void {
    this.diagnostics.push(errorAt(this.locate, code, message, path, details));
  }

  #collectTokens(tree: Record<string, unknown>, prefix: string[], path: DocPath): void {
    for (const [key, value] of Object.entries(tree)) {
      if (!TOKEN_NAME_PATTERN.test(key)) {
        this.error("theme/invalid-token", `Invalid token name "${key}".`, [...path, key], {
          atKey: true,
          hint: `Token names must match ${TOKEN_NAME_PATTERN.source}.`,
        });
        continue;
      }
      const name = [...prefix, key];
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        this.#tokenGroups.add(name.join("."));
        this.#collectTokens(value as Record<string, unknown>, name, [...path, key]);
      } else {
        this.#tokens.set(name.join("."), { raw: value, path: [...path, key] });
      }
    }
  }

  /** Resolves a token through references; `null` if it failed (already reported). */
  #resolveToken(name: string, stack: string[]): TypedValue | null {
    const done = this.#resolved.get(name);
    if (done !== undefined) return done;
    const source = this.#tokens.get(name);
    if (source === undefined) return null;
    const start = stack.indexOf(name);
    if (start >= 0) {
      const cycle = [...stack.slice(start), name];
      this.error(
        "theme/token-cycle",
        `Token reference cycle: ${cycle.map((n) => `{${n}}`).join(" → ")}.`,
        source.path,
        {
          related: cycle
            .slice(1, -1)
            .map((n) => relatedAt(this.locate, this.#tokens.get(n)?.path ?? [], `{${n}} is here.`)),
        },
      );
      for (const member of cycle) this.#resolved.set(member, null);
      return null;
    }

    let result: TypedValue | null;
    const target = tokenReference(source.raw);
    if (target !== undefined) {
      result = this.#tokens.has(target)
        ? this.#resolveToken(target, [...stack, name])
        : this.#unknownToken(target, source.path);
    } else {
      result = this.#literal(source.raw, source.path);
    }
    // A cycle through this token has already recorded `null`.
    if (!this.#resolved.has(name)) this.#resolved.set(name, result);
    return this.#resolved.get(name) ?? null;
  }

  #unknownToken(target: string, path: DocPath): null {
    if (this.#tokenGroups.has(target)) {
      this.error(
        "theme/unknown-token",
        `Token reference {${target}} names a token group, not a value.`,
        path,
        {
          hint: `Reference a token inside it, e.g. {${target}.${this.#firstTokenIn(target) ?? "name"}}.`,
        },
      );
    } else {
      this.error("theme/unknown-token", `Unknown token {${target}}.`, path, {
        hint:
          didYouMean(target, this.#tokens.keys()) ??
          (this.#tokens.size === 0
            ? "The theme defines no tokens."
            : `Known tokens: ${[...this.#tokens.keys()].join(", ")}.`),
      });
    }
    return null;
  }

  #firstTokenIn(group: string): string | undefined {
    const prefix = `${group}.`;
    const first = [...this.#tokens.keys()].find((name) => name.startsWith(prefix));
    return first?.slice(prefix.length);
  }

  #literal(raw: unknown, path: DocPath): TypedValue | null {
    const inferred = inferValue(raw);
    if (inferred.ok) return inferred.value;
    const reference = typeof raw === "string" && /[{}]/.test(raw);
    this.error(
      "theme/invalid-token",
      reference ? `Invalid token reference ${JSON.stringify(raw)}.` : inferred.message,
      path,
      { hint: reference ? 'A reference is the whole value, e.g. "{color.fg}".' : inferred.hint },
    );
    return null;
  }

  /**
   * Checks `dim` (#175): two colors (not `transparent`: a dimmed line or
   * text must stay visible) and `lighten`, a number from 0 to 1.
   */
  #checkDim(raw: NonNullable<ParsedTheme["dim"]>): DimColors | undefined {
    const color = (property: "fontColor" | "stroke"): Color | undefined => {
      const path = ["dim", property];
      const value = this.#checkValue(property, raw[property], path);
      if (value !== "transparent") return value;
      this.error("theme/invalid-value", `dim.${property} must be a color, not transparent.`, path, {
        hint: 'Dimmed text and lines stay visible; use a gray such as "#8c959f".',
      });
      return undefined;
    };
    const fontColor = color("fontColor");
    const stroke = color("stroke");
    const path = ["dim", "lighten"];
    const target = tokenReference(raw.lighten);
    let typed: TypedValue | null;
    if (target === undefined) typed = this.#literal(raw.lighten, path);
    else if (this.#tokens.has(target)) typed = this.#resolveToken(target, []);
    else typed = this.#unknownToken(target, path);
    let lighten: number | undefined;
    if (typed !== null && typed.type !== "number") {
      this.error(
        "theme/type-mismatch",
        `dim.lighten expects a number, but got ${article(typed.type)} ${typed.type}.`,
        path,
        { hint: "Write how far fills move toward white, from 0 to 1, e.g. 0.5." },
      );
    } else if (typed !== null && !(typed.value >= 0 && typed.value <= 1)) {
      this.error(
        "theme/out-of-range",
        `dim.lighten must be between 0 and 1, got ${typed.value}.`,
        path,
      );
    } else if (typed !== null) {
      lighten = typed.value;
    }
    if (fontColor === undefined || stroke === undefined || lighten === undefined) return undefined;
    return { fontColor, stroke, lighten };
  }

  /** Checks one partial style; invalid properties are reported and left out. */
  #checkLayer(layer: ParsedLayer, kind: ComponentKind, path: DocPath): StyleLayer {
    const result: Partial<Record<StyleProperty, StyleValues[StyleProperty]>> = {};
    for (const property of STYLE_PROPERTY_NAMES) {
      const raw = layer[property];
      if (raw === undefined) continue;
      const at = [...path, property];
      if (!appliesTo(property, kind)) {
        const kinds = STYLE_PROPERTIES[property].kinds.join(" and ");
        this.error(
          "theme/inapplicable-property",
          `Property "${property}" does not apply to ${kind} components; it applies to ${kinds} components only.`,
          at,
          { atKey: true },
        );
        continue;
      }
      const value = this.#checkValue(property, raw, at);
      if (value !== undefined) result[property] = value;
    }
    return result as StyleLayer;
  }

  #checkValue<P extends StyleProperty>(
    property: P,
    raw: unknown,
    path: DocPath,
  ): StyleValues[P] | undefined {
    const target = tokenReference(raw);
    const token = target === undefined ? undefined : this.#tokens.get(target);
    let typed: TypedValue | null;
    if (target === undefined) typed = this.#literal(raw, path);
    else if (token === undefined) typed = this.#unknownToken(target, path);
    else typed = this.#resolveToken(target, []);
    if (typed === null) return undefined;

    const source = target === undefined ? "" : ` (from token {${target}})`;
    const related =
      token === undefined
        ? undefined
        : [relatedAt(this.locate, token.path, `Token {${target}} is defined here.`)];
    const expected = STYLE_PROPERTIES[property].type;
    if (typed.type !== expected) {
      this.error(
        "theme/type-mismatch",
        `Property "${property}" expects ${article(expected)} ${expected}, but got ${article(typed.type)} ${typed.type}${source}.`,
        path,
        {
          hint:
            expected === "length" && typed.type === "number"
              ? `Add a unit, e.g. "${typed.value}pt".`
              : undefined,
          related,
        },
      );
      return undefined;
    }
    const checked = checkPropertyValue(property, typed);
    if (!checked.ok) {
      this.error(checked.code, `${checked.message.replace(/\.$/, "")}${source}.`, path, {
        hint: checked.hint,
        related,
      });
      return undefined;
    }
    const fontSet = this.#fontSet;
    if ((property === "italic" || property === "mono") && checked.value === true && fontSet) {
      if (fontSet[property as "italic" | "mono"] === undefined) {
        this.error(
          "theme/missing-font",
          `Property "${property}" is true, but font set ${fontSet.id} has no ${property} font.`,
          path,
          {
            hint: `Use a font set with ${article(property)} ${property} font, or set ${property} to false.`,
          },
        );
        return undefined;
      }
    }
    return checked.value;
  }

  /**
   * Reports `theme/unsupported-font-combination` where bold and italic are both
   * true after merging: for each kind's base, and each styled component's
   * default and variants. The error points at the most specific layer that
   * sets either to true.
   */
  #checkFontCombinations(
    base: Record<ComponentKind, StyleLayer>,
    components: Map<ComponentId, Map<string, StyleLayer>>,
    refs: Map<ComponentId, string>,
  ): void {
    const reported = new Set<string>();
    const check = (
      kind: ComponentKind,
      chain: [StyleLayer | undefined, DocPath][],
      what: string,
    ) => {
      const style = mergeStyle(
        kind,
        chain.map(([layer]) => layer),
      );
      if (!style.bold || !style.italic) return;
      const culprit = [...chain]
        .reverse()
        .find(([layer]) => layer?.bold === true || layer?.italic === true);
      const path = culprit?.[1] ?? chain[0]?.[1] ?? [];
      const key = formatDocPath(path);
      if (reported.has(key)) return;
      reported.add(key);
      this.error(
        "theme/unsupported-font-combination",
        `bold and italic are both true for ${what}; D2 has no bold italic font.`,
        path,
        { hint: "Set bold or italic to false." },
      );
    };
    for (const kind of COMPONENT_KINDS) check(kind, [[base[kind], ["base", kind]]], `${kind}s`);
    for (const [id, layers] of components) {
      const kind = this.registry.get(id)?.kind;
      if (kind === undefined) continue;
      const chain = (variant: string): [StyleLayer | undefined, DocPath] => [
        layers.get(variant),
        ["components", refs.get(id) ?? id, variant],
      ];
      const baseLayer: [StyleLayer, DocPath] = [base[kind], ["base", kind]];
      check(kind, [baseLayer, chain("default")], `${id}`);
      for (const variant of layers.keys()) {
        if (variant === "default") continue;
        check(kind, [baseLayer, chain("default"), chain(variant)], `${id} variant "${variant}"`);
      }
    }
  }
}

/** The token name of a reference such as `{color.fg}`, or `undefined`. */
function tokenReference(raw: unknown): string | undefined {
  return typeof raw === "string" ? TOKEN_REFERENCE_PATTERN.exec(raw)?.[1] : undefined;
}

function structuralDiagnostics(
  issue: z.core.$ZodIssue,
  raw: unknown,
  locate: Locator,
): Diagnostic[] {
  const path: DocPath = issue.path.filter((s) => typeof s !== "symbol");
  const at = formatDocPath(path);
  const actual = valueAt(raw, path);
  const error = (code: string, message: string, hint?: string) =>
    errorAt(locate, code, message, path, { hint });

  switch (issue.code) {
    case "unrecognized_keys": {
      const isLayer =
        (path[0] === "base" && path.length === 2) ||
        (path[0] === "components" && path.length === 3) ||
        (path[0] === "tones" && path.length === 2);
      return issue.keys.map((key) =>
        isLayer
          ? errorAt(
              locate,
              "theme/unknown-property",
              `Unknown style property "${key}".`,
              [...path, key],
              {
                atKey: true,
                hint:
                  path[0] === "tones"
                    ? (didYouMean(key, TONE_PROPERTIES) ??
                      `A tone sets only ${TONE_PROPERTIES.join(", ")}.`)
                    : (didYouMean(key, STYLE_PROPERTY_NAMES) ??
                      `Style properties: ${STYLE_PROPERTY_NAMES.join(", ")}.`),
              },
            )
          : errorAt(
              locate,
              "theme/unknown-field",
              `Unknown field "${key}" in ${at}.`,
              [...path, key],
              {
                atKey: true,
                hint: didYouMean(
                  key,
                  path[0] === "base" ? COMPONENT_KINDS : Object.keys(ThemeSchema.shape),
                ),
              },
            ),
      );
    }
    case "invalid_type":
      if (actual === undefined && path.length > 0) {
        return [
          error(
            "theme/missing-field",
            `Missing required field "${String(path.at(-1))}" in ${formatDocPath(path.slice(0, -1))}.`,
          ),
        ];
      }
      return [error("theme/invalid-type", `Expected ${typeName(issue.expected)} at ${at}.`)];
    case "invalid_value":
      if (at === "version") {
        return [
          error(
            "theme/unsupported-version",
            `Unsupported theme format version ${JSON.stringify(actual)}; this Sumi supports version ${THEME_FORMAT_VERSION}.`,
          ),
        ];
      }
      break;
    case "invalid_format":
      return [
        error(
          "theme/invalid-value",
          `Invalid theme ID ${JSON.stringify(actual)}; IDs must match ${ID_PATTERN.source}.`,
        ),
      ];
  }
  return [error("theme/invalid-value", `Invalid value at ${at}: ${issue.message}.`)];
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
  return expected === "object" || expected === "record" ? "a mapping" : `a ${expected}`;
}

function article(word: string): string {
  return /^[aeiou]/.test(word) ? "an" : "a";
}

function deepFreeze<T>(value: T): T {
  if (value instanceof Map) {
    for (const child of value.values()) deepFreeze(child);
  } else if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return Object.freeze(value);
}
