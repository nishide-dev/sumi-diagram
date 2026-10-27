/** Label math (#93): the parser, its runs, spacing, errors and font coverage. */

import { describe, expect, test } from "bun:test";
import { loadGlyphCoverage } from "../../lint/cmap";
import { fontFileFor } from "../../lint/geometry/measure";
import { DEFAULT_FONT_SET_ID, getFontSet } from "../theme/fonts";
import { looksLikeMath, type MarkupRun, parseLabel } from "./math";
import { isSpaceRun, labelRuns } from "./runs";
import { ACCENT_COMMANDS, ASCII_SYMBOLS, SPACE_COMMANDS, SYMBOL_COMMANDS } from "./symbols";

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

  test("errors point at the cause: the open brace, the script marker, whole code points", () => {
    expect(errors("$x_{i$")[0]).toMatchObject({ at: "{", start: 3 });
    expect(errors("$x_  $")[0]).toMatchObject({ at: "_", start: 2 });
    expect(errors("$\\😀$")[0]).toMatchObject({ at: "\\😀", start: 1 });
    expect(errors("$\\mathrm{ab$")[0]).toMatchObject({ at: "{", start: 8 });
    expect(errors("$\\text{ab$")[0]).toMatchObject({ at: "{", start: 6 });
  });

  test("braces inside \\text count toward the nesting limit", () => {
    const nested = (prefix: string, n: number) => `$${prefix}{${"{".repeat(n)}x${"}".repeat(n)}}$`;
    for (const prefix of ["\\text", "x_\\text"]) {
      expect(parseLabel(nested(prefix, 31)).ok).toBe(true);
      expect(errors(nested(prefix, 32))[0]?.message).toContain("nests more than 32 groups");
      expect(errors(nested(prefix, 20000))[0]?.at).toBe("{");
    }
  });

  test("accents go over one character or command (#129)", () => {
    const a = (
      text: string,
      font: MarkupRun["font"],
      accent: string,
      script: MarkupRun["script"] = "base",
    ) => ({
      text,
      font,
      script,
      accent,
    });
    expect(runs("$\\hat{y}$")).toEqual([[a("y", "math-italic", "̂")]]);
    expect(runs("$\\hat y$")).toEqual(runs("$\\hat{y}$"));
    expect(runs("$\\tilde x \\bar\\theta \\dot{W} \\ddot\\Omega \\vec{1}$")).toEqual([
      [
        a("x", "math-italic", "̃"),
        a("θ", "math-italic", "̄"),
        a("W", "math-italic", "̇"),
        a("Ω", "math", "̈"),
        a("1", "math", "⃗"),
      ],
    ]);
    // A script after the accent is the accented atom's; accents are ordinary atoms.
    expect(runs("$\\hat\\theta_t = \\hat{+}$")).toEqual([
      [
        a("θ", "math-italic", "̂"),
        r("t", "math-italic", "sub"),
        r(" = ", "math"),
        a("+", "math", "̂"),
      ],
    ]);
    // Inside scripts and font commands; never merged with neighbors.
    expect(runs("$x_{\\hat i} \\mathrm{\\bar x}y$")).toEqual([
      [
        r("x", "math-italic"),
        a("i", "math-italic", "̂", "sub"),
        a("x", "math", "̄"),
        r("y", "math-italic"),
      ],
    ]);
  });

  test("accents with more than one character, wide accents and nesting are errors (#129)", () => {
    expect(errors("$\\hat{xy}$")).toEqual([
      {
        at: "{xy}",
        start: 5,
        message: '"\\hat" takes one character or one command, not "{xy}".',
      },
    ]);
    expect(errors("a $\\widehat{xy}$")).toEqual([
      {
        at: "\\widehat",
        start: 3,
        message: 'The wide accent "\\widehat" is not supported in label math.',
      },
    ]);
    expect(errors("$\\hat\\hat x$")[0]).toMatchObject({
      at: "\\hat",
      start: 5,
      message: 'Nested accents are not supported in label math ("\\hat\\hat").',
    });
    expect(errors("$\\hat{\\tilde x}$")[0]?.message).toBe(
      'Nested accents are not supported in label math ("\\hat{\\tilde x}").',
    );
    // Deep unbraced nesting is an error, not a stack overflow.
    expect(errors(`$${"\\hat".repeat(10000)} x$`)[0]).toMatchObject({ at: "\\hat", start: 5 });
    expect(errors(`$${"\\hat{".repeat(10000)}x${"}".repeat(10000)}$`)[0]?.message).toContain(
      "nests more than 32 groups",
    );
    expect(errors("$\\hat$")[0]).toMatchObject({ at: "\\hat", start: 1 });
    expect(errors("$\\hat}$")[0]).toMatchObject({ at: "\\hat", start: 1 });
    expect(errors("$\\hat{}$")[0]).toMatchObject({ at: "{}", start: 5 });
    expect(errors("$\\hat{x_t}$")[0]).toMatchObject({ at: "{x_t}" });
    expect(errors("$\\hat\\log$")[0]).toMatchObject({ at: "\\log" });
    expect(errors("$\\hat\\text{a}$")[0]).toMatchObject({ at: "\\text{a}" });
    expect(errors("$\\hat\\,x$")[0]).toMatchObject({ at: "\\," });
    for (const name of ["widetilde", "overline", "overrightarrow"]) {
      expect(errors(`$\\${name}{x}$`)[0]?.message).toContain("wide accent");
    }
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

  test("an accent follows its base in the lines; spaces after it are a run of their own (#129)", () => {
    const drawn = labelRuns("予測 $\\hat y$ と $\\bar x = 1$", { font: "regular" });
    expect(drawn.lines).toEqual(["予測 ŷ と x̄ = 1"]);
    expect(drawn.runs).toEqual([
      [
        { text: "予測 ", font: "regular", script: "base" },
        { text: "y", font: "math-italic", script: "base", accent: "̂" },
        { text: " ", font: "regular", script: "base" },
        { text: "と ", font: "regular", script: "base" },
        { text: "x", font: "math-italic", script: "base", accent: "̄" },
        { text: " ", font: "math", script: "base" },
        { text: "= 1", font: "math", script: "base" },
      ],
    ]);
    // Past a whitespace-only run in another font, too.
    expect(
      labelRuns("$\\hat y\\,$ と $x$", { font: "regular" }).runs?.[0]?.map((r) => r.text),
    ).toEqual(["y", " ", " ", "と ", "x"]);
    expect(isSpaceRun({ text: " " })).toBe(true);
    expect(isSpaceRun({ text: " a" })).toBe(false);
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
      // Each accent's mark in both fonts (#129).
      ...[...ACCENT_COMMANDS.keys()].map((name) => `$\\${name} x \\${name}\\Omega$`),
    ];
    for (const source of sources) {
      for (const run of runs(source).flat()) {
        if (run.font === "text") continue;
        for (const char of run.text + (run.accent ?? "")) {
          expect(coverage[run.font].has(char.codePointAt(0) ?? 0), `${source}: ${char}`).toBe(true);
        }
      }
    }
  });
});
