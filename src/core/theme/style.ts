/**
 * Style properties and the resolved (effective) style of an element (design
 * doc §4.1, §4.3).
 *
 * Only properties D2 can express are exposed. Lengths are written in any unit
 * and stored as exact multiples of 0.5pt, i.e. whole D2 units (k = 0.5,
 * §5.1); a length that is not representable is an error, never rounded.
 */

import type { ComponentKind } from "../registry/manifest";
import {
  d2UnitsToPt,
  exactD2Units,
  formatPt,
  LENGTH_PATTERN,
  type Length,
  parseLength,
  roundToD2Units,
} from "../units";

/** `#rrggbb` / `#rgb` (lowercase) or `transparent`. */
export type Color = string;

/** A length stored as whole D2 units: `pt = units × 0.5`. */
export interface StyleLength {
  readonly pt: number;
  /** Integer D2 units, the value written to D2 (e.g. `style.stroke-width`). */
  readonly units: number;
}

/** Properties shared by every kind. */
export interface CommonStyle {
  readonly stroke: Color;
  readonly strokeWidth: StyleLength;
  /** D2 dash level 0–10 (not a physical length). */
  readonly strokeDash: number;
  readonly opacity: number;
  readonly fontSize: StyleLength;
  readonly fontColor: Color;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly mono: boolean;
}

export interface NodeStyle extends CommonStyle {
  readonly kind: "node";
  readonly fill: Color;
  readonly radius: StyleLength;
}

export interface GroupStyle extends CommonStyle {
  readonly kind: "group";
  readonly fill: Color;
  readonly radius: StyleLength;
}

export interface EdgeStyle extends CommonStyle {
  readonly kind: "edge";
  /**
   * Background of the edge's label (D2 `style.fill` on a connection, #31). D2
   * draws it as a padded box behind the label; `transparent` draws nothing.
   * The structured writer only uses it as a switch: its box takes the color
   * painted beneath the label (#170).
   */
  readonly fill: Color;
  /** Whether arrowheads are filled. */
  readonly filled: boolean;
}

/** The complete, immutable effective style of one element. */
export type ResolvedStyle = NodeStyle | GroupStyle | EdgeStyle;

/** The resolved style type of a given kind. */
export type StyleOf<K extends ComponentKind> = Extract<ResolvedStyle, { kind: K }>;

/** Type of a token leaf or of the value a property expects (§4.3). */
export type ValueType = "color" | "length" | "number" | "boolean";

export type TypedValue =
  | { type: "color"; value: Color }
  | { type: "length"; value: Length }
  | { type: "number"; value: number }
  | { type: "boolean"; value: boolean };

interface PropertySpec {
  type: ValueType;
  kinds: readonly ComponentKind[];
  /** Description of the accepted range, for messages. */
  range?: string;
  /** For lengths: inclusive bounds in pt. For numbers: inclusive bounds. */
  min?: number;
  max?: number;
  integer?: boolean;
}

const ALL: readonly ComponentKind[] = ["node", "group", "edge"];
const SHAPES: readonly ComponentKind[] = ["node", "group"];

/** The style properties, in documentation order (§4.1). */
export const STYLE_PROPERTIES = {
  // On edges, the background of the label (#31).
  fill: { type: "color", kinds: ALL },
  stroke: { type: "color", kinds: ALL },
  strokeWidth: { type: "length", kinds: ALL, min: 0, max: 7.5 },
  strokeDash: { type: "number", kinds: ALL, min: 0, max: 10, integer: true },
  radius: { type: "length", kinds: SHAPES, min: 0 },
  opacity: { type: "number", kinds: ALL, min: 0, max: 1 },
  fontSize: { type: "length", kinds: ALL, min: 4, max: 50 },
  fontColor: { type: "color", kinds: ALL },
  bold: { type: "boolean", kinds: ALL },
  italic: { type: "boolean", kinds: ALL },
  mono: { type: "boolean", kinds: ALL },
  filled: { type: "boolean", kinds: ["edge"] },
} as const satisfies Record<string, PropertySpec>;

export type StyleProperty = keyof typeof STYLE_PROPERTIES;

export const STYLE_PROPERTY_NAMES = Object.keys(STYLE_PROPERTIES) as StyleProperty[];

/** The resolved value type of each property. */
export interface StyleValues {
  fill: Color;
  stroke: Color;
  strokeWidth: StyleLength;
  strokeDash: number;
  radius: StyleLength;
  opacity: number;
  fontSize: StyleLength;
  fontColor: Color;
  bold: boolean;
  italic: boolean;
  mono: boolean;
  filled: boolean;
}

/** A validated, partial style: one layer of a theme (`base.<kind>` or a variant). */
export type StyleLayer = Readonly<Partial<StyleValues>>;

/** `true` if `property` applies to elements of `kind`. */
export function appliesTo(property: StyleProperty, kind: ComponentKind): boolean {
  return (STYLE_PROPERTIES[property].kinds as readonly ComponentKind[]).includes(kind);
}

const length = (pt: number): StyleLength => ({ pt, units: pt * 2 });

const COMMON_DEFAULTS = {
  stroke: "#000000",
  strokeWidth: length(1),
  strokeDash: 0,
  opacity: 1,
  fontColor: "#000000",
  italic: false,
  mono: false,
} as const;

/**
 * Sumi's built-in defaults per kind (§4.3): the lowest layer, independent of
 * any theme and of D2's own defaults.
 */
export const KIND_DEFAULTS: { readonly [K in ComponentKind]: StyleOf<K> } = deepFreeze({
  node: {
    kind: "node",
    ...COMMON_DEFAULTS,
    fill: "#ffffff",
    radius: length(0),
    fontSize: length(8),
    bold: false,
  },
  group: {
    kind: "group",
    ...COMMON_DEFAULTS,
    fill: "transparent",
    radius: length(0),
    fontSize: length(9),
    bold: true,
  },
  edge: {
    kind: "edge",
    ...COMMON_DEFAULTS,
    fill: "#ffffff",
    fontSize: length(7),
    bold: false,
    filled: true,
  },
});

/**
 * A node's sublabel (#184, design doc §6.51) is drawn at this fraction of
 * the node's font size: 7/8, the ratio of the original DiT figure's sizes
 * (7.35pt under 8.4pt), which also gives `size.small` from `size.text` in
 * every built-in theme (8pt → 7pt, 16pt → 14pt).
 */
export const SUBLABEL_SCALE = 7 / 8;

/**
 * The font size of a node's sublabel (#184): {@link SUBLABEL_SCALE} of the
 * label's, rounded down to whole D2 units (0.5pt). A theme length that is
 * not a multiple of 0.5pt is an error, never rounded (§4.1); this size is
 * derived, not written, so rounding it down is this rule's own choice (it
 * keeps the size in whole units and never above 7/8).
 */
export function sublabelFontSize(fontSize: StyleLength): StyleLength {
  const units = Math.floor(fontSize.units * SUBLABEL_SCALE);
  return { pt: units / 2, units };
}

/**
 * Merges layers over the kind defaults, property by property (later wins), and
 * freezes the result. Layers must only contain properties applicable to `kind`.
 */
export function mergeStyle<K extends ComponentKind>(
  kind: K,
  layers: readonly (StyleLayer | undefined)[],
): StyleOf<K> {
  const merged = Object.assign({}, KIND_DEFAULTS[kind], ...layers) as StyleOf<K>;
  return Object.freeze(merged) as StyleOf<K>;
}

const COLOR_PATTERN = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** The result of reading a written value: its type, or why it has none. */
export type InferResult =
  | { ok: true; value: TypedValue }
  | { ok: false; message: string; hint?: string };

/**
 * Infers the type of a written literal mechanically (§4.3): numbers, booleans,
 * length strings (normalized to pt) and color strings (normalized to
 * lowercase). Anything else is invalid.
 */
export function inferValue(raw: unknown): InferResult {
  if (typeof raw === "number") return { ok: true, value: { type: "number", value: raw } };
  if (typeof raw === "boolean") return { ok: true, value: { type: "boolean", value: raw } };
  if (typeof raw !== "string") {
    return {
      ok: false,
      message: `Expected a color, length, number or boolean, got ${describe(raw)}.`,
    };
  }
  if (raw === "transparent" || COLOR_PATTERN.test(raw)) {
    return { ok: true, value: { type: "color", value: raw.toLowerCase() } };
  }
  if (LENGTH_PATTERN.test(raw)) {
    const parsed = parseLength(raw);
    if (parsed.ok) return { ok: true, value: { type: "length", value: parsed.length } };
    return { ok: false, message: parsed.message, ...(parsed.hint && { hint: parsed.hint }) };
  }
  const quoted = JSON.stringify(raw);
  if (/^rgba?\(/i.test(raw)) {
    return {
      ok: false,
      message: `Unsupported color ${quoted}; D2 does not accept rgb().`,
      hint: 'Write the color as hex, e.g. "#1f2328".',
    };
  }
  if (/^(true|false|yes|no)$/i.test(raw)) {
    return {
      ok: false,
      message: `Invalid value ${quoted}; booleans must not be quoted.`,
      hint: `Write ${/^(true|yes)$/i.test(raw)} without quotes.`,
    };
  }
  if (/^-?\d+(\.\d+)?$/.test(raw)) {
    return {
      ok: false,
      message: `Invalid value ${quoted}; numbers must not be quoted and lengths need a unit.`,
      hint: `Write ${raw} for a number or "${raw}pt" for a length.`,
    };
  }
  const length = parseLength(raw);
  const hint = length.ok
    ? undefined
    : /\d/.test(raw)
      ? length.hint
      : 'Use a hex color such as "#1f2328", "transparent", a length such as "1pt", a number, a boolean or a token reference such as "{color.fg}".';
  return {
    ok: false,
    message: `Invalid value ${quoted}; expected a color, length, number or boolean.`,
    ...(hint && { hint }),
  };
}

/** A property value checked against its range: the stored value, or the problem. */
export type CheckedValue<P extends StyleProperty> =
  | { ok: true; value: StyleValues[P] }
  | {
      ok: false;
      code: "theme/out-of-range" | "theme/unrepresentable-value";
      message: string;
      hint?: string;
    };

/**
 * Checks a value of the property's type against the D2 range (§4.1) and
 * quantizes lengths to whole D2 units. Lengths that are not a multiple of
 * 0.5pt fail with `theme/unrepresentable-value` and are never rounded.
 */
export function checkPropertyValue<P extends StyleProperty>(
  property: P,
  typed: TypedValue,
): CheckedValue<P> {
  const spec: PropertySpec = STYLE_PROPERTIES[property];
  const ok = (value: unknown): CheckedValue<P> => ({ ok: true, value: value as StyleValues[P] });
  switch (typed.type) {
    case "color":
    case "boolean":
      return ok(typed.value);
    case "number": {
      const { value } = typed;
      const outside =
        !Number.isFinite(value) ||
        (spec.min !== undefined && value < spec.min) ||
        (spec.max !== undefined && value > spec.max);
      if (outside || (spec.integer === true && !Number.isInteger(value))) {
        return {
          ok: false,
          code: "theme/out-of-range",
          message: `${property} must be ${spec.integer ? "an integer " : ""}${rangeText(spec, false)}, got ${value}.`,
        };
      }
      return ok(value);
    }
    case "length": {
      const { value } = typed;
      const tooSmall = spec.min !== undefined && value.pt < spec.min;
      const tooLarge = spec.max !== undefined && value.pt > spec.max;
      if (tooSmall || tooLarge) {
        return {
          ok: false,
          code: "theme/out-of-range",
          message: `${property} must be ${rangeText(spec, true)}, got ${formatPt(value.pt)}.`,
        };
      }
      const units = exactD2Units(value);
      if (units === undefined) {
        const nearest = d2UnitsToPt(roundToD2Units(value));
        return {
          ok: false,
          code: "theme/unrepresentable-value",
          message: `${property} ${formatPt(value.pt)} is not a multiple of 0.5pt, the D2 unit.`,
          hint: `The nearest representable value is "${nearest}pt"; Sumi never rounds visual lengths.`,
        };
      }
      return ok({ pt: d2UnitsToPt(units), units });
    }
  }
}

function rangeText(spec: PropertySpec, pt: boolean): string {
  const show = (n: number) => (pt ? formatPt(n) : String(n));
  const min = show(spec.min ?? 0);
  return spec.max === undefined ? `at least ${min}` : `between ${min} and ${show(spec.max)}`;
}

function describe(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (Array.isArray(value)) return "a list";
  if (typeof value === "object") return "a mapping";
  return `a ${typeof value}`;
}

function deepFreeze<T extends object>(value: T): T {
  for (const child of Object.values(value)) {
    if (typeof child === "object" && child !== null) deepFreeze(child);
  }
  return Object.freeze(value);
}
