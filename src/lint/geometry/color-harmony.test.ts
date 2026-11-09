import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fromOklch, toOklch } from "../../core/theme/color-math";
import { BUILTIN_PALETTES } from "../../core/theme/palette";
import { type PaintedColor, paintedColors } from "./color-census";
import { assessColors, FILL_CHROMA_RATIO, hueFamilies, MAX_HUES } from "./color-harmony";
import { compile, lintSpec } from "./testing";

const CODE = "geometry/color-harmony";
const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
const painted = (source: string) => paintedColors(compile(source).ir);
const slate = BUILTIN_PALETTES.get("slate");

const paint = (color: string, role: PaintedColor["role"], where = "node"): PaintedColor => ({
  color,
  role,
  oklch: toOklch(color),
  where,
});

/**
 * The figure of #412: the `paper` theme's tones under the `slate` palette. Since #423 the palette
 * derives its own tones; the colors #412 drew are the theme's, written as explicit tone colors,
 * which win over the palette.
 */
const PAPER_TONES = `tones:
      gray: { fill: "#dcdee6", line: "#6b6e78" }
      red: { fill: "#f6dcdb", line: "#c0392b" }
      orange: { fill: "#f9e0bc", line: "#bd5410" }
      yellow: { fill: "#f1f4c6", line: "#857500" }
      green: { fill: "#d0e6cd", line: "#3f7d3a" }
      blue: { fill: "#cddff6", line: "#2f62b0" }
      purple: { fill: "#dfdcef", line: "#7240a8" }
      pink: { fill: "#f6d8e5", line: "#b8336a" }`;

/** A small figure in every tone: tinted nodes, a vector glyph, a set, an edge. */
const figure = (overrides: string) => `version: 1
figure:
  id: harmony
  theme: paper
  themeOverrides:
    ${overrides}
  layout:
    arrange:
      row: { gap: 6mm, items: [a, b, c, d, e] }
nodes:
  - { id: a, component: box, label: A, tone: blue, variant: tinted }
  - { id: b, component: box, label: B, tone: green, variant: tinted }
  - { id: c, component: box, label: C, tone: orange, variant: tinted, glyphs: [ { kind: vector, tone: orange } ] }
  - { id: d, component: box, label: D, tone: purple, variant: solid }
  - { id: e, component: box, label: E, tone: red, variant: outlined }
edges:
  - { from: a, to: b, tone: blue }
  - { from: d, to: e, tone: red }
sets:
  - { id: s, label: Set, members: [a, b], tone: green, shape: rect }
`;

describe("geometry/color-harmony (#423): calibration", () => {
  test("the LLaDA reproduction and the Llama 4 figure pass", () => {
    for (const path of [
      "examples/llada/llada.sumi.yaml",
      "examples/llama4-moe/llama4-moe.sumi.yaml",
    ]) {
      expect(assessColors(painted(read(path))), path).toEqual([]);
    }
  });

  test("the muted LLaDA fills (cool blues, peach and yellow at one lightness and chroma) are in harmony", () => {
    const fills = ["#94a9d8", "#f1cdb1", "#fbe7a3", "#a5c2e3", "#b1d095", "#b8c6e4", "#eab48a"];
    expect(assessColors(fills.map((c) => paint(c, "fill")))).toEqual([]);
  });

  test("a palette figure whose tones are the paper theme's (#412) is reported, naming the colors", () => {
    const problems = assessColors(painted(figure(`palette: slate\n    ${PAPER_TONES}`)), slate);
    expect(problems.map((p) => p.signal)).toEqual(["palette"]);
    expect(problems[0]?.message).toContain('palette "slate"');
    expect(problems[0]?.message).toContain("#2f62b0");
  });

  test("the same figure with the tones the palette derives is in harmony, for every palette", () => {
    for (const palette of BUILTIN_PALETTES.values()) {
      expect(assessColors(painted(figure(`palette: ${palette.id}`)), palette), palette.id).toEqual(
        [],
      );
    }
  });

  test("a figure in a theme alone (no palette) is not judged against one", () => {
    expect(assessColors(painted(figure("{}")))).toEqual([]);
  });
});

describe("geometry/color-harmony (#423): signals", () => {
  test("hue families: hues within 30 degrees are one family; more than seven are too many", () => {
    expect(hueFamilies([])).toBe(0);
    expect(hueFamilies([10])).toBe(1);
    expect(hueFamilies([10, 30, 350])).toBe(1);
    expect(hueFamilies([0, 90, 180, 270])).toBe(4);
    const eight = [0, 45, 90, 135, 180, 225, 270, 315];
    expect(hueFamilies(eight)).toBe(8);
    const colors = eight.map((h) => paint(fromOklch({ l: 0.6, c: 0.12, h }), "line"));
    expect(hueFamilies(colors.map((c) => c.oklch.h))).toBeGreaterThan(MAX_HUES);
    const problems = assessColors(colors);
    expect(problems.map((p) => p.signal)).toContain("hues");
    // The seven tones of a theme are not too many.
    expect(assessColors(colors.slice(0, 7)).map((p) => p.signal)).not.toContain("hues");
  });

  test("pastel next to saturated fills is reported, with the chroma range", () => {
    const fills = ["#cddff6", "#d0e6cd", "#f6dcdb", "#00b3ff"].map((c) => paint(c, "fill"));
    const problems = assessColors(fills);
    expect(problems.map((p) => p.signal)).toEqual(["fills"]);
    expect(problems[0]?.message).toContain("Pastel and saturated");
    const ratio =
      Math.max(...fills.map((f) => f.oklch.c)) / Math.min(...fills.map((f) => f.oklch.c));
    expect(ratio).toBeGreaterThanOrEqual(FILL_CHROMA_RATIO);
  });

  test("a pale and a heavy fill side by side are reported by lightness", () => {
    const fills = ["#fff3c4", "#e8d0f0", "#8a6bb0", "#9bb7ff"].map((c) => paint(c, "fill"));
    expect(assessColors(fills).map((p) => p.signal)).toEqual(["fills"]);
  });

  test("neutral colors (gray, black, white) take no part", () => {
    const colors = ["#000000", "#ffffff", "#d9d9d9", "#737373", "#f3f3f5"].map((c) =>
      paint(c, "fill"),
    );
    expect(assessColors(colors)).toEqual([]);
  });

  test("a darker frame on a palette tone stays inside the palette's band", () => {
    // A tinted node's frame is darkened to read on its fill: darker and duller than the line color.
    expect(slate).toBeDefined();
    const frame = paint("#274466", "line", 'node "x" frame');
    expect(assessColors([frame, paint("#234c32", "line")], slate)).toEqual([]);
  });
});

describe("geometry/color-harmony (#423): the rule", () => {
  test("is info by default and reports once per signal, at the figure", () => {
    const source = figure(`palette: slate\n    ${PAPER_TONES}`);
    const findings = lintSpec(compile(source), { elements: {} }, { code: CODE, source });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("info");
    expect(findings[0]?.path).toEqual(["figure", "themeOverrides", "tones"]);
    expect(findings[0]?.subject).toEqual({ kind: "figure", id: "harmony" });
    expect(findings[0]?.hint).toContain("themeOverrides.tones");
  });

  test("is quiet for a palette figure, for a figure without colors and for the llama theme", () => {
    for (const source of [
      figure("palette: slate"),
      figure("{}"),
      `version: 1\nfigure: { id: plain }\nnodes:\n  - { id: a, component: box, label: A }\n`,
    ]) {
      expect(lintSpec(compile(source), { elements: {} }, { code: CODE, source })).toEqual([]);
    }
  });

  test("can be turned off", () => {
    const source = figure(`palette: slate\n    ${PAPER_TONES}`);
    expect(
      lintSpec(
        compile(source),
        { elements: {} },
        {
          code: CODE,
          source,
          config: { rules: { [CODE]: "off" } },
        },
      ),
    ).toEqual([]);
  });
});
