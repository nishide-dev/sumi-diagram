import { describe, expect, test } from "bun:test";
import {
  exactD2Units,
  formatMm,
  formatPt,
  isD2Representable,
  mmToPt,
  parseLength,
  ptToD2Units,
  ptToMm,
  roundToD2Units,
} from "./units";

const lengthOf = (input: string) => {
  const result = parseLength(input);
  if (!result.ok) throw new Error(result.message);
  return result.length;
};
const ptOf = (input: string) => lengthOf(input).pt;
const failure = (input: unknown) => {
  const result = parseLength(input);
  if (result.ok) throw new Error(`expected ${String(input)} to fail`);
  return result;
};
const round = (input: string) => roundToD2Units(lengthOf(input));
const exact = (input: string) => exactD2Units(lengthOf(input));

describe("parseLength", () => {
  test("accepts every unit and normalizes to pt", () => {
    expect(parseLength("7pt")).toEqual({
      ok: true,
      length: { value: 7, unit: "pt", pt: 7, exactPt: { num: 7n, den: 1n } },
    });
    expect(lengthOf("2mm").exactPt).toEqual({ num: 720n, den: 127n });
    expect(lengthOf("-0.5pt").exactPt).toEqual({ num: -1n, den: 2n });
    expect(ptOf("1in")).toBe(72);
    expect(ptOf("0.5in")).toBe(36);
    expect(ptOf("25.4mm")).toBeCloseTo(72, 12);
    expect(ptOf("2.54cm")).toBeCloseTo(72, 12);
    expect(ptOf("88mm")).toBeCloseTo(249.448819, 6);
    expect(ptOf("0mm")).toBe(0);
    expect(ptOf("-1.5pt")).toBe(-1.5);
  });

  test("rejects px with a hint", () => {
    const result = parseLength("12px");
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('"px"') });
    if (!result.ok) expect(result.hint).toContain("mm, cm, in or pt");
  });

  test("rejects unitless numbers and strings", () => {
    expect(parseLength(2)).toEqual({
      ok: false,
      message: "Expected a length with a unit, got the number 2.",
      hint: 'Add a unit, e.g. "2mm" or "2pt".',
    });
    expect(parseLength("2")).toEqual({
      ok: false,
      message: 'Missing unit in length "2".',
      hint: 'Add a unit, e.g. "2mm" or "2pt".',
    });
  });

  test("rejects other malformed input", () => {
    expect(failure("3em").message).toBe('Unsupported unit "em" in "3em".');
    expect(failure("2MM")).toEqual({
      ok: false,
      message: 'Unsupported unit "MM" in "2MM".',
      hint: 'Units are lowercase; write "2mm".',
    });
    expect(failure("2 mm")).toEqual({
      ok: false,
      message: 'Invalid length "2 mm"; whitespace is not allowed.',
      hint: 'Write "2mm".',
    });
    expect(failure(".5mm").hint).toBe('Write "0.5mm".');
    expect(failure("mm").message).toBe('Invalid length "mm".');
    expect(failure("").message).toBe('Invalid length "".');
    expect(failure(true).message).toBe('Expected a length such as "2mm", got a boolean.');
    expect(failure(null).message).toBe('Expected a length such as "2mm", got null.');
    expect(failure({}).message).toBe('Expected a length such as "2mm", got a mapping.');
  });

  test("rejects lengths that are too large instead of overflowing", () => {
    const huge = `${"9".repeat(309)}pt`;
    expect(Number.parseFloat(huge)).toBe(Number.POSITIVE_INFINITY);
    expect(failure(huge).message).toStartWith(
      `Length "${huge}" is too large; the maximum is 100000pt`,
    );
    // Finite as written, overflowing (or too large) after conversion to pt.
    expect(failure(`${"9".repeat(306)}in`).message).toContain("is too large");
    expect(failure("-100001pt").message).toContain("is too large");
    expect(failure("35278mm").message).toContain("is too large"); // 100006pt
    expect(ptOf("100000pt")).toBe(100000);
    expect(ptOf("-100000pt")).toBe(-100000);
  });

  test("keeps long decimals finite", () => {
    const tiny = `0.${"0".repeat(400)}1pt`;
    expect(ptOf(tiny)).toBe(0);
    expect(ptOf(`1.${"0".repeat(400)}mm`)).toBeCloseTo(360 / 127, 12);
  });
});

describe("D2 units (1 unit = 0.5pt)", () => {
  test("converts without rounding", () => {
    expect(ptToD2Units(8)).toBe(16);
    expect(ptToD2Units(0.75)).toBe(1.5);
  });

  test("rounds to the nearest unit with .5 rounding up", () => {
    expect(round("5.2pt")).toBe(10); // 10.4
    expect(round("5.25pt")).toBe(11); // 10.5
    expect(round("5.75pt")).toBe(12); // 11.5
    expect(round("0.25pt")).toBe(1); // 0.5
    expect(round("0pt")).toBe(0);
    expect(round("-0.25pt")).toBe(0); // -0.5 rounds toward +∞
    expect(round("-0.2500000001pt")).toBe(-1);
  });

  test("rounds exactly at half-unit boundaries", () => {
    expect(round("0.2499999999pt")).toBe(0);
    expect(round("0.2500000001pt")).toBe(1);
    expect(round("5.2499999999999999999pt")).toBe(10);
    expect(round("5.25000000000000000001pt")).toBe(11);
    expect(round("0.0881mm")).toBe(0); // 0.4994… units
    expect(round("0.0882mm")).toBe(1); // 0.5001… units
  });

  test("matches the conversion table of the design doc (§5.2)", () => {
    expect(round("2mm")).toBe(11); // 11.34
    expect(round("10mm")).toBe(57); // 56.69
    expect(round("4mm")).toBe(23); // 22.68
  });

  test("checks exact representability in 0.5pt steps", () => {
    expect(exact("1.5pt")).toBe(3);
    expect(exact("8pt")).toBe(16);
    expect(exact("0pt")).toBe(0);
    expect(exact("-1pt")).toBe(-2);
    expect(exact("0.75pt")).toBeUndefined();
    expect(exact("1mm")).toBeUndefined();
    expect(exact("25.4mm")).toBe(144);
    expect(exact("2.54cm")).toBe(144);
    expect(exact("0.25in")).toBe(36);
    expect(exact("12.7mm")).toBe(72);
  });

  test("does not tolerate values slightly off the 0.5pt grid", () => {
    expect(exact("7.0000000001pt")).toBeUndefined();
    expect(exact("6.9999999999pt")).toBeUndefined();
    expect(exact("7.50000000000000000001pt")).toBeUndefined();
    expect(exact("25.4000000001mm")).toBeUndefined();
    expect(isD2Representable(lengthOf("7pt"))).toBe(true);
    expect(isD2Representable(lengthOf("7.25pt"))).toBe(false);
  });
});

describe("mm and pt", () => {
  test("converts both ways", () => {
    expect(mmToPt(25.4)).toBeCloseTo(72, 12);
    expect(ptToMm(72)).toBeCloseTo(25.4, 12);
  });

  test("formats for messages", () => {
    expect(formatPt(mmToPt(2))).toBe("5.67pt");
    expect(formatPt(7)).toBe("7pt");
    expect(formatMm(mmToPt(88))).toBe("88mm");
    expect(formatMm(mmToPt(338.7))).toBe("338.7mm");
  });
});
