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

const ptOf = (input: string) => {
  const result = parseLength(input);
  if (!result.ok) throw new Error(result.message);
  return result.length.pt;
};

describe("parseLength", () => {
  test("accepts every unit and normalizes to pt", () => {
    expect(parseLength("7pt")).toEqual({ ok: true, length: { value: 7, unit: "pt", pt: 7 } });
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
    const failure = (input: unknown) => {
      const result = parseLength(input);
      if (result.ok) throw new Error(`expected ${String(input)} to fail`);
      return result;
    };
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
});

describe("D2 units (1 unit = 0.5pt)", () => {
  test("converts without rounding", () => {
    expect(ptToD2Units(8)).toBe(16);
    expect(ptToD2Units(0.75)).toBe(1.5);
  });

  test("rounds to the nearest unit with .5 rounding up", () => {
    expect(roundToD2Units(5.2)).toBe(10); // 10.4
    expect(roundToD2Units(5.25)).toBe(11); // 10.5
    expect(roundToD2Units(5.75)).toBe(12); // 11.5
    expect(roundToD2Units(0.25)).toBe(1); // 0.5
    expect(roundToD2Units(0)).toBe(0);
    expect(roundToD2Units(-0.25)).toBe(0); // -0.5 rounds toward +∞
    expect(roundToD2Units(ptOf("2mm"))).toBe(11); // 11.34
    expect(roundToD2Units(ptOf("10mm"))).toBe(57); // 56.69
    expect(roundToD2Units(ptOf("4mm"))).toBe(23); // 22.68
  });

  test("checks exact representability in 0.5pt steps", () => {
    expect(exactD2Units(1.5)).toBe(3);
    expect(exactD2Units(8)).toBe(16);
    expect(exactD2Units(0)).toBe(0);
    expect(exactD2Units(0.75)).toBeUndefined();
    expect(exactD2Units(ptOf("1mm"))).toBeUndefined();
    // Exact after conversion despite floating-point noise.
    expect(exactD2Units(ptOf("25.4mm"))).toBe(144);
    expect(exactD2Units(ptOf("2.54cm"))).toBe(144);
    expect(exactD2Units(ptOf("0.25in"))).toBe(36);
    expect(isD2Representable(7)).toBe(true);
    expect(isD2Representable(7.25)).toBe(false);
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
