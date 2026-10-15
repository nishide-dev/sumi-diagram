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
 * theme values, see {@link exactD2Units}). Both work on the exact rational
 * value of the written decimal ({@link Length.exactPt}), so quantization never
 * depends on floating-point error.
 *
 * This module returns plain results instead of diagnostics: the caller owns the
 * stage, so it picks the code (`profile/invalid-length`, `theme/...`).
 */

export const LENGTH_UNITS = ["mm", "cm", "in", "pt"] as const;
export type LengthUnit = (typeof LENGTH_UNITS)[number];

/** An exact rational number `num / den` with `den > 0`, in lowest terms. */
export interface Rational {
  num: bigint;
  den: bigint;
}

/** Exact points per one of each unit (1in = 72pt = 25.4mm). */
const EXACT_PT_PER: Readonly<Record<LengthUnit, Rational>> = {
  pt: { num: 1n, den: 1n },
  in: { num: 72n, den: 1n },
  mm: { num: 360n, den: 127n },
  cm: { num: 3600n, den: 127n },
};

/** Points per one of each unit, as floats (for reporting). */
export const PT_PER: Readonly<Record<LengthUnit, number>> = {
  pt: 1,
  in: 72,
  mm: 360 / 127,
  cm: 3600 / 127,
};

/** Largest accepted length magnitude in pt (about 35m); larger values are typos. */
export const MAX_LENGTH_PT = 100_000;

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
  /** The length in points as a float, for comparisons and reporting. */
  pt: number;
  /** The exact length in points; all quantization to D2 units uses this. */
  exactPt: Rational;
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
  const quoted = JSON.stringify(input);
  const match = LENGTH_PATTERN.exec(input);
  if (match) {
    const unit = match[2] as LengthUnit;
    const exactPt = multiply(parseDecimal(input.slice(0, -unit.length)), EXACT_PT_PER[unit]);
    const magnitude = exactPt.num < 0n ? -exactPt.num : exactPt.num;
    if (magnitude > BigInt(MAX_LENGTH_PT) * exactPt.den) {
      return {
        ok: false,
        message: `Length ${quoted} is too large; the maximum is ${MAX_LENGTH_PT}pt (about ${formatMm(MAX_LENGTH_PT)}).`,
      };
    }
    const value = Number.parseFloat(input);
    return { ok: true, length: { value, unit, pt: toNumber(exactPt), exactPt } };
  }
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

/**
 * Float helper: converts pt to D2 units without rounding (the result may be
 * fractional). Not for quantization; use {@link roundToD2Units} or
 * {@link exactD2Units} on a {@link Length}.
 */
export const ptToD2Units = (pt: number): number => pt / PT_PER_D2_UNIT;

/** Converts D2 units to pt. */
export const d2UnitsToPt = (units: number): number => units * PT_PER_D2_UNIT;

/**
 * Rounds a length to the nearest integer D2 unit, rounding .5 up (toward +∞).
 * Used for layout values, where the error (at most 0.25pt) is irrelevant.
 * Computed exactly: 0.2499999999pt → 0, 0.25pt → 1.
 */
export function roundToD2Units(length: Length): number {
  const { num, den } = length.exactPt;
  // floor(units + 1/2) with units = 2·num / den.
  return Number(floorDiv(4n * num + den, 2n * den));
}

/**
 * Returns the integer number of D2 units equal to the length, or `undefined`
 * if it is not exactly a multiple of 0.5pt. Used for visual values, which must
 * not be rounded silently. Exact: 25.4mm → 144, 7.0000000001pt → undefined.
 */
export function exactD2Units(length: Length): number | undefined {
  const { num, den } = length.exactPt;
  const units = 2n * num;
  return units % den === 0n ? Number(units / den) : undefined;
}

/** `true` if the length is exactly a whole number of D2 units (a multiple of 0.5pt). */
export const isD2Representable = (length: Length): boolean => exactD2Units(length) !== undefined;

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

/** Parses a decimal such as `-12.5` exactly. */
function parseDecimal(text: string): Rational {
  const [whole = "", fraction = ""] = text.split(".");
  return reduce({ num: BigInt(whole + fraction), den: 10n ** BigInt(fraction.length) });
}

function multiply(a: Rational, b: Rational): Rational {
  return reduce({ num: a.num * b.num, den: a.den * b.den });
}

function reduce({ num, den }: Rational): Rational {
  let a = num < 0n ? -num : num;
  let b = den;
  while (b !== 0n) [a, b] = [b, a % b];
  return a === 0n ? { num: 0n, den: 1n } : { num: num / a, den: den / a };
}

/** Floor division for a positive divisor (BigInt `/` truncates toward zero). */
function floorDiv(a: bigint, b: bigint): bigint {
  const q = a / b;
  return a % b !== 0n && a < 0n ? q - 1n : q;
}

/**
 * The float nearest to a rational. Long decimals can have numerators and
 * denominators beyond the float range, so those are split into an integer and
 * a fraction first.
 */
function toNumber({ num, den }: Rational): number {
  const safe = BigInt(Number.MAX_SAFE_INTEGER);
  if (num <= safe && -num <= safe && den <= safe) return Number(num) / Number(den);
  return Number(num / den) + Number(((num % den) * 10n ** 20n) / den) / 1e20;
}
