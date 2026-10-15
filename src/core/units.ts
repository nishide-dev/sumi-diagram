/**
 * Physical lengths and the D2 unit scale (design doc §5.1).
 *
 * Lengths are written as `<number><unit>` with unit `mm`, `cm`, `in` or `pt`
 * and normalized to pt (1in = 72pt = 25.4mm). `px` and unitless values are
 * rejected because their physical size is ambiguous.
 *
 * One D2 unit is fixed at 0.5pt. Values passed to D2 must be integers, so a
 * length is either rounded to the nearest unit (layout hints, see
 * {@link roundToD2Units}) or required to be exactly representable (visual
 * theme values, see {@link exactD2Units}).
 *
 * This module returns plain results instead of diagnostics: the caller owns the
 * stage, so it picks the code (`profile/invalid-length`, `theme/...`).
 */

export const LENGTH_UNITS = ["mm", "cm", "in", "pt"] as const;
export type LengthUnit = (typeof LENGTH_UNITS)[number];

/** Points per one of each unit. */
export const PT_PER: Readonly<Record<LengthUnit, number>> = {
  pt: 1,
  in: 72,
  mm: 72 / 25.4,
  cm: 720 / 25.4,
};

/** Points per D2 unit (k in the design doc). */
export const PT_PER_D2_UNIT = 0.5;

/**
 * A length string: optional `-`, decimal digits, an optional fraction and a
 * unit, with no spaces (the `length` token rule of design doc §4.3).
 */
export const LENGTH_PATTERN = /^-?\d+(\.\d+)?(mm|cm|in|pt)$/;

export interface Length {
  /** The number as written, e.g. `88` for `88mm`. */
  value: number;
  unit: LengthUnit;
  /** The length in points. */
  pt: number;
}

export type ParseLengthResult =
  | { ok: true; length: Length }
  | { ok: false; message: string; hint?: string };

const ACCEPTED = "Use one of mm, cm, in or pt, e.g. 2mm or 7pt.";

/**
 * Parses a length such as `"88mm"`, `"0.5in"` or `"7pt"`. Accepts any input so
 * callers can pass raw YAML values; failures carry an English sentence
 * describing `input` and an optional hint.
 */
export function parseLength(input: unknown): ParseLengthResult {
  if (typeof input === "number") {
    return {
      ok: false,
      message: `Expected a length with a unit, got the number ${input}.`,
      hint: `Add a unit, e.g. "${input}mm" or "${input}pt".`,
    };
  }
  if (typeof input !== "string") {
    return { ok: false, message: `Expected a length such as "2mm", got ${describe(input)}.` };
  }
  const match = LENGTH_PATTERN.exec(input);
  if (match) {
    const value = Number.parseFloat(input);
    const unit = match[2] as LengthUnit;
    return { ok: true, length: { value, unit, pt: value * PT_PER[unit] } };
  }
  const quoted = JSON.stringify(input);
  const trimmed = input.trim();
  if (/^-?\d+(\.\d+)?px$/.test(trimmed)) {
    return {
      ok: false,
      message: `Unsupported unit "px" in ${quoted}; pixel sizes depend on the display.`,
      hint: `${ACCEPTED} At 96 dpi, 1px = 0.75pt.`,
    };
  }
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return {
      ok: false,
      message: `Missing unit in length ${quoted}.`,
      hint: `Add a unit, e.g. "${trimmed}mm" or "${trimmed}pt".`,
    };
  }
  if (trimmed !== input || /\s/.test(input)) {
    const compact = input.replace(/\s+/g, "");
    if (LENGTH_PATTERN.test(compact)) {
      return {
        ok: false,
        message: `Invalid length ${quoted}; whitespace is not allowed.`,
        hint: `Write "${compact}".`,
      };
    }
  }
  const leadingZero = input.replace(/^(-?)\./, "$10.");
  if (leadingZero !== input && LENGTH_PATTERN.test(leadingZero)) {
    return {
      ok: false,
      message: `Invalid length ${quoted}; a leading zero is required.`,
      hint: `Write "${leadingZero}".`,
    };
  }
  const unit = /^-?\d+(?:\.\d+)?([a-zA-Z%]+)$/.exec(trimmed)?.[1];
  if (unit !== undefined) {
    const lower = trimmed.toLowerCase();
    return {
      ok: false,
      message: `Unsupported unit "${unit}" in ${quoted}.`,
      hint: LENGTH_PATTERN.test(lower) ? `Units are lowercase; write "${lower}".` : ACCEPTED,
    };
  }
  return { ok: false, message: `Invalid length ${quoted}.`, hint: ACCEPTED };
}

export const mmToPt = (mm: number): number => mm * PT_PER.mm;
export const ptToMm = (pt: number): number => pt / PT_PER.mm;

/** Converts pt to D2 units without rounding (the result may be fractional). */
export const ptToD2Units = (pt: number): number => pt / PT_PER_D2_UNIT;

/** Converts D2 units to pt. */
export const d2UnitsToPt = (units: number): number => units * PT_PER_D2_UNIT;

/**
 * Rounds a length in pt to the nearest integer D2 unit, rounding .5 up (toward
 * +∞). Used for layout values, where the error (at most 0.25pt) is irrelevant.
 */
export function roundToD2Units(pt: number): number {
  return Math.floor(snap(ptToD2Units(pt)) + 0.5);
}

/**
 * Returns the integer number of D2 units equal to `pt`, or `undefined` if `pt`
 * is not a multiple of 0.5pt. Used for visual values, which must not be
 * rounded silently.
 */
export function exactD2Units(pt: number): number | undefined {
  const units = snap(ptToD2Units(pt));
  return Number.isInteger(units) ? units : undefined;
}

/** `true` if `pt` is exactly a whole number of D2 units (a multiple of 0.5pt). */
export const isD2Representable = (pt: number): boolean => exactD2Units(pt) !== undefined;

/**
 * Formats pt for messages with at most two decimals: `5.669…` → `"5.67pt"`.
 */
export const formatPt = (pt: number): string => `${trimNumber(pt)}pt`;

/** Formats pt as millimetres for messages: `249.448…` → `"88mm"`. */
export const formatMm = (pt: number): string => `${trimNumber(ptToMm(pt))}mm`;

/** Formats a parsed length as written: `{ value: 88, unit: "mm" }` → `"88mm"`. */
export const formatLength = (length: Length): string => `${length.value}${length.unit}`;

function describe(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (Array.isArray(value)) return "a list";
  if (typeof value === "object") return "a mapping";
  return `a ${typeof value}`;
}

function trimNumber(value: number): string {
  return String(Number(value.toFixed(2)));
}

/**
 * Removes floating-point noise from unit conversions so values that are meant
 * to be exact (e.g. 0.75pt → 1.5 units, 25.4mm → 144 units) stay exact.
 */
function snap(value: number): number {
  return Math.round(value * 1e9) / 1e9;
}
