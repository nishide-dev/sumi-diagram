/** Label math (#93): the parser, its runs, spacing, errors and font coverage. */

import { describe, expect, test } from "bun:test";
import { loadGlyphCoverage } from "../../lint/cmap";
import { fontFileFor } from "../../lint/geometry/measure";
import { DEFAULT_FONT_SET_ID, getFontSet } from "../theme/fonts";
import { looksLikeMath, type MarkupRun, parseLabel } from "./math";
import { labelRuns } from "./runs";
import { ASCII_SYMBOLS, SPACE_COMMANDS, SYMBOL_COMMANDS } from "./symbols";

const fonts = getFontSet(DEFAULT_FONT_SET_ID);
if (fonts === undefined) throw new Error("no default font set");

function runs(label: string): MarkupRun[][] {
  const parsed = parseLabel(label);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  return parsed.value.lines.map((line) => [...line]);
}

const r = (text: string, font: MarkupRun["font"], script: MarkupRun["script"] = "base") => ({
  text,
  font,
  script,
});

function errors(label: string) {
  const parsed = parseLabel(label);
  if (parsed.ok) throw new Error(`"${label}" parsed`);
  return parsed.errors.map((e) => ({
    at: label.slice(e.start, e.end),
    start: e.start,
    message: e.message,
  }));
}

describe("parseLabel", () => {
  test("text outside $...$ is literal; \\$ is a dollar sign", () => {
    expect(runs("Cost \\$5, a\\b")).toEqual([[r("Cost $5, a\\b", "text")]]);
    expect(runs("a\nb")).toEqual([[r("a", "text")], [r("b", "text")]]);
  });

  test("variables are italic, digits and symbols upright, scripts are runs of their own", () => {
    expect(runs("Scale $\\gamma_1,\\beta_1$")).toEqual([
      [
        r("Scale ", "text"),
        r("γ", "math-italic"),
        r("1", "math", "sub"),
        r(",", "math"),
        r("β", "math-italic"),
        r("1", "math", "sub"),
      ],
    ]);
    expect(runs("$x^{2}_i \\Omega$")).toEqual([
      [r("x", "math-italic"), r("2", "math", "sup"), r("i", "math-italic", "sub"), r("Ω", "math")],
    ]);
    // Typed Unicode means the same as the command.
    expect(runs("$γ_1$")).toEqual(runs("$\\gamma_1$"));
  });

  test("spaces are ignored; binary operators and relations get TeX's spaces", () => {
    expect(runs("$32 \\times 32$")).toEqual([[r("32 × 32", "math")]]);
    expect(
      runs("$a=b$")[0]
        ?.map((x) => x.text)
        .join(""),
    ).toBe("a = b");
    // A binary operator without a left operand is unary: no spaces.
    expect(runs("$-1$")).toEqual([[r("−1", "math")]]);
    expect(
      runs("$(-x)$")[0]
        ?.map((x) => x.text)
        .join(""),
    ).toBe("(−x)");
    // Punctuation gets no space, so text extraction reads "γ1,β1".
    expect(
      runs("$a,b$")[0]
        ?.map((x) => x.text)
        .join(""),
    ).toBe("a,b");
    // Explicit spaces.
    expect(
      runs("$a\\,b\\quad c~d$")[0]
        ?.map((x) => x.text)
        .join(""),
    ).toBe("a b c d");
    // No automatic spaces inside scripts.
    expect(runs("$x_{i+1}$")).toEqual([
      [r("x", "math-italic"), r("i", "math-italic", "sub"), r("+1", "math", "sub")],
    ]);
  });

  test("font commands and \\text", () => {
    expect(runs("$\\mathrm{d}x$")).toEqual([[r("d", "math"), r("x", "math-italic")]]);
    expect(runs("$\\mathit{\\Gamma 2}$")).toEqual([[r("Γ2", "math-italic")]]);
    expect(runs("$x_\\text{in put}$")).toEqual([
      [r("x", "math-italic"), r("in put", "text", "sub")],
    ]);
    expect(runs("$\\log x$")).toEqual([[r("log", "math"), r("x", "math-italic")]]);
    expect(runs("$\\text{a \\{b\\}}$")).toEqual([[r("a {b}", "text")]]);
  });

  test("unsupported or malformed math is an error at its position", () => {
    expect(errors("ab $\\frac{a}{b}$")).toEqual([
      { at: "\\frac", start: 4, message: 'The command "\\frac" is not supported in label math.' },
    ]);
    expect(errors("Cost $5")[0]).toMatchObject({ at: "$", start: 5 });
    expect(errors("x $$ y")[0]).toMatchObject({ at: "$$", start: 2 });
    expect(errors("$x_{i_1}$")[0]).toMatchObject({ at: "_", start: 5 });
    expect(errors("$x_1_2$")[0]).toMatchObject({ at: "_", start: 4 });
    expect(errors("$x^$")[0]?.message).toContain("missing");
    expect(errors("$x_{}$")[0]?.message).toContain("Empty subscript");
    expect(errors("$a}$")[0]).toMatchObject({ at: "}", start: 2 });
    expect(errors("$\\mathrm x$")[0]?.message).toContain("braces");
    expect(errors("$a@b$")[0]).toMatchObject({ at: "@", start: 2 });
    expect(errors("$a😀$")[0]).toMatchObject({ at: "😀", start: 2 });
    expect(errors("$a\nb$")[0]).toMatchObject({ at: "$", start: 0 });
    // Positions count from the start of the label, across lines.
    expect(errors("ok\n$\\sqrt{2}$")[0]).toMatchObject({ at: "\\sqrt", start: 4 });
    // One error per span; later spans are still checked.
    expect(errors("$\\a$ and $\\b$").map((e) => e.at)).toEqual(["\\a", "\\b"]);
  });

  test("looksLikeMath finds math syntax, not dollar amounts", () => {
    expect(looksLikeMath("$5 or $10")).toBe(false);
    expect(looksLikeMath("costs $5")).toBe(false);
    expect(looksLikeMath("$\\alpha$")).toBe(true);
    expect(looksLikeMath("$x_1$")).toBe(true);
    expect(looksLikeMath("\\$x_1\\$")).toBe(false);
  });
});

describe("labelRuns", () => {
  test("collapses whitespace like an SVG <text> and keeps plain labels plain", () => {
    expect(labelRuns("  plain   text ", { font: "bold" })).toEqual({ lines: ["plain text"] });
    expect(labelRuns("Cost \\$5", { font: "regular" })).toEqual({ lines: ["Cost $5"] });
    const math = labelRuns(" a  $x$  b ", { font: "regular" });
    expect(math.lines).toEqual(["a x b"]);
    expect(math.runs?.[0]?.map((r) => r.font)).toEqual(["regular", "math-italic", "regular"]);
  });

  test("text the label font lacks falls back to the math font", () => {
    const covers = (font: string, cp: number) =>
      loadGlyphCoverage(fontFileFor(font, fonts)).has(cp);
    expect(labelRuns("α₂ x", { font: "regular", covers }).runs).toEqual([
      [
        { text: "α", font: "regular", script: "base" },
        { text: "₂", font: "math", script: "base" },
        { text: " x", font: "regular", script: "base" },
      ],
    ]);
    expect(labelRuns("plain", { font: "regular", covers })).toEqual({ lines: ["plain"] });
  });
});

describe("the bundled math fonts cover everything label math draws", () => {
  const coverage = {
    math: loadGlyphCoverage(fontFileFor("math", fonts)),
    "math-italic": loadGlyphCoverage(fontFileFor("math-italic", fonts)),
  };
  test("every command, ASCII symbol, letter and digit in both fonts it can use", () => {
    const sources = [
      ...[...SYMBOL_COMMANDS.keys()].map((name) => `$\\${name}$`),
      ...[...SPACE_COMMANDS.keys()].map((name) => `$a\\${name} b$`),
      ...[...ASCII_SYMBOLS.keys()].map((c) => `$a${c}b$`),
      "$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789$",
      "$\\mathrm{abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ}$",
      "$\\mathit{0123456789 \\Gamma\\Delta\\Theta\\Lambda\\Xi\\Pi\\Sigma\\Upsilon\\Phi\\Psi\\Omega}$",
      "$\\mathrm{\\alpha\\beta\\gamma}$",
    ];
    for (const source of sources) {
      for (const run of runs(source).flat()) {
        if (run.font === "text") continue;
        for (const char of run.text) {
          expect(coverage[run.font].has(char.codePointAt(0) ?? 0), `${source}: ${char}`).toBe(true);
        }
      }
    }
  });
});
