/**
 * Outlined tones and edge tones (#177, design doc §6.54): the themes' line
 * colors per tone (`toneLines`), their validation, and which tone layer an
 * element takes.
 */

import { describe, expect, test } from "bun:test";
import { lintFigure } from "../../lint/lint";
import { checkFigure } from "../check";
import { createBuiltinRegistry } from "../registry/builtins";
import { componentId } from "../registry/manifest";
import {
  BUILTIN_THEMES,
  buildThemeCatalog,
  DEFAULT_FONT_SET_ID,
  getTheme,
  OUTLINED_VARIANT,
  resolveStyle,
  type Theme,
  type ThemeDefinition,
  toneField,
  validateTheme,
} from ".";
import { TONE_NAMES, type Tone } from "./tones";

const definition = (patch: Partial<ThemeDefinition> = {}): ThemeDefinition => ({
  version: 1,
  id: "test",
  fonts: DEFAULT_FONT_SET_ID,
  ...patch,
});

function valid(raw: unknown): Theme {
  const result = validateTheme(raw);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  return result.value;
}

function builtin(id: string): Theme {
  const theme = getTheme(id);
  if (!theme) throw new Error(`missing theme ${id}`);
  return theme;
}

const registry = createBuiltinRegistry();
const target = (name: string, variant: string, tone?: Tone) => {
  const manifest = registry.get(`sumi/${name}`);
  if (!manifest) throw new Error(name);
  return { kind: manifest.kind, id: componentId(manifest), variant, tone };
};

/** WCAG contrast ratio of `color` (`#rrggbb`) on white. */
function contrastOnWhite(color: string): number {
  const channel = (i: number) => {
    const v = Number.parseInt(color.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return 1.05 / (luminance + 0.05);
}

describe("built-in tone lines", () => {
  test("every built-in theme gives every tone a line color for the stroke and the text", () => {
    for (const theme of BUILTIN_THEMES.values()) {
      expect([...theme.toneLines.keys()]).toEqual([...TONE_NAMES]);
      for (const layer of theme.toneLines.values()) {
        expect(Object.keys(layer).sort()).toEqual(["fontColor", "stroke"]);
        expect(layer.fontColor).toBe(layer.stroke ?? "");
        // Readable as text on the white of an outlined node.
        expect(contrastOnWhite(layer.stroke ?? "")).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  test("color and paper use eight hues; the monochrome themes three grays in the fills' steps", () => {
    const lines = (id: string) => [...builtin(id).toneLines.values()].map((l) => l.stroke);
    for (const id of ["color", "paper"]) expect(new Set(lines(id)).size).toBe(TONE_NAMES.length);
    for (const id of ["minimal", "academic", "slides"]) {
      const theme = builtin(id);
      expect(new Set(lines(id)).size).toBe(3);
      for (const gray of lines(id)) expect(gray).toMatch(/^#([0-9a-f]{2})\1\1$/);
      // Tones that share a fill share a line color, and a lighter fill has a lighter line.
      for (const a of TONE_NAMES) {
        for (const b of TONE_NAMES) {
          const fill = (t: Tone) => theme.tones.get(t)?.fill ?? "";
          const line = (t: Tone) => theme.toneLines.get(t)?.stroke ?? "";
          expect(fill(a) === fill(b)).toBe(line(a) === line(b));
          if (fill(a) > fill(b)) expect(line(a) > line(b)).toBe(true);
        }
      }
    }
  });

  test("the catalog lists the tones with line colors", () => {
    for (const entry of buildThemeCatalog()) expect(entry.toneLines).toEqual([...TONE_NAMES]);
  });
});

describe("tone layer of an element", () => {
  test("outlined nodes and groups and every edge take toneLines; the rest take tones", () => {
    expect(OUTLINED_VARIANT).toBe("outlined");
    expect(toneField("node", "outlined")).toBe("toneLines");
    expect(toneField("group", "outlined")).toBe("toneLines");
    expect(toneField("edge", "default")).toBe("toneLines");
    expect(toneField("node", "filled")).toBe("tones");
    expect(toneField("group", "default")).toBe("tones");
  });

  test("an outlined node keeps the page's fill and takes the tone's line for outline and text", () => {
    for (const theme of BUILTIN_THEMES.values()) {
      const plain = resolveStyle(theme, target("box", "default")).style;
      const outlined = resolveStyle(theme, target("box", "outlined", "orange"));
      const line = theme.toneLines.get("orange");
      expect(outlined.missingTone).toBe(false);
      expect(outlined.style).toEqual({
        ...plain,
        stroke: line?.stroke ?? "",
        fontColor: line?.fontColor ?? "",
      });
    }
  });

  test("an outlined node without a tone uses tone gray's line", () => {
    for (const theme of BUILTIN_THEMES.values()) {
      const style = resolveStyle(theme, target("box", "outlined")).style;
      expect(style.stroke).toBe(theme.toneLines.get("gray")?.stroke ?? "");
      expect(style.fontColor).toBe(style.stroke);
    }
  });

  test("an edge's tone colors its line and label, nothing else", () => {
    for (const theme of BUILTIN_THEMES.values()) {
      for (const variant of ["default", "dashed", "emphasis", "muted"]) {
        const plain = resolveStyle(theme, target("arrow", variant)).style;
        const toned = resolveStyle(theme, target("arrow", variant, "blue")).style;
        const line = theme.toneLines.get("blue");
        expect(toned).toEqual({
          ...plain,
          stroke: line?.stroke ?? "",
          fontColor: line?.fontColor ?? "",
        });
      }
    }
  });

  test("a missing tone line is left out and reported with the toneLines hint", () => {
    const theme = valid(definition({ tones: { red: { fill: "#ff0000" } } }));
    expect(resolveStyle(theme, target("box", "default", "red")).missingTone).toBe(false);
    expect(resolveStyle(theme, target("box", "outlined", "red")).missingTone).toBe(true);
    expect(resolveStyle(theme, target("arrow", "default", "red")).missingTone).toBe(true);
  });
});

describe("toneLines validation", () => {
  const codes = (raw: unknown) =>
    validateTheme(raw).diagnostics.map((d) => [d.code, d.path, d.message]);

  test("accepts stroke and fontColor, with token references", () => {
    const theme = valid(
      definition({
        tokens: { ink: { red: "#c00000" } },
        toneLines: { red: { stroke: "{ink.red}", fontColor: "#900000" } },
      }),
    );
    expect(theme.toneLines.get("red")).toEqual({ stroke: "#c00000", fontColor: "#900000" });
    expect(theme.tones.size).toBe(0);
  });

  test("rejects a fill, other properties and unknown tones", () => {
    expect(
      codes(
        definition({
          toneLines: {
            red: { fill: "#ff0000", stroke: "#c00000" },
            blue: { strokeWidth: "2pt" },
            ["orang" as Tone]: { stroke: "#ff8000" },
          },
        }),
      ),
    ).toEqual([
      [
        "theme/inapplicable-property",
        ["toneLines", "red", "fill"],
        'Property "fill" does not apply to tone lines; a tone line sets only stroke, fontColor.',
      ],
      [
        "theme/inapplicable-property",
        ["toneLines", "blue", "strokeWidth"],
        'Property "strokeWidth" does not apply to tone lines; a tone line sets only stroke, fontColor.',
      ],
      ["theme/unknown-tone", ["toneLines", "orang"], 'Unknown tone "orang".'],
    ]);
  });

  test("an unknown property in a tone line is reported with the tone line's properties", () => {
    const result = validateTheme(
      definition({ toneLines: { red: { colour: "#c00000" } as never } }),
    );
    expect(result.diagnostics.map((d) => [d.code, d.path, d.hint])).toEqual([
      [
        "theme/unknown-property",
        ["toneLines", "red", "colour"],
        "A tone line sets only stroke, fontColor.",
      ],
    ]);
  });
});

describe("figures", () => {
  test("the theme stage colors outlined nodes, toned edges and legend samples", () => {
    const { state } = checkFigure(
      [
        "version: 1",
        "figure: { id: f, theme: color, layout: { arrange: { row: { items: [a, b, key] } } } }",
        "nodes:",
        "  - { id: a, component: box, label: A, tone: orange, variant: outlined }",
        "  - { id: b, component: box, label: B, tone: orange }",
        "  - id: key",
        "    component: legend",
        "    props:",
        "      entries:",
        "        - { node: { variant: outlined, tone: orange }, label: outlined }",
        "        - { edge: { tone: purple }, label: purple line }",
        "edges: [{ from: a, to: b, tone: purple, label: x }]",
        "",
      ].join("\n"),
    );
    expect(state.diagnostics).toEqual([]);
    const color = builtin("color");
    const style = (key: string) => state.styles?.get(key as `n:${string}`);
    const orange = color.toneLines.get("orange")?.stroke;
    const purple = color.toneLines.get("purple")?.stroke;
    expect(style("n:a")).toMatchObject({ fill: "#ffffff", stroke: orange, fontColor: orange });
    expect(style("n:b")).toMatchObject({ fill: color.tones.get("orange")?.fill });
    expect(style("e:#0")).toMatchObject({ stroke: purple, fontColor: purple });
    expect(style("n:key-1-box")).toEqual(style("n:a"));
    const sample = [...(state.styles?.entries() ?? [])].find(([key]) => key.startsWith("e:key"));
    expect(sample?.[1]).toEqual(style("e:#0"));
  });

  test("a legend entry is used only by elements with its tone", () => {
    const report = lintFigure(
      [
        "version: 1",
        "figure: { id: f, theme: paper, layout: { arrange: { row: { items: [a, b, key] } } } }",
        "nodes:",
        "  - { id: a, component: box, label: A }",
        "  - { id: b, component: box, label: B }",
        "  - id: key",
        "    component: legend",
        "    props: { entries: [{ edge: { tone: purple }, label: purple line }] }",
        "edges: [{ from: a, to: b, tone: orange }]",
        "",
      ].join("\n"),
    );
    expect(report.diagnostics.map((d) => [d.code, d.message])).toEqual([
      [
        "lint/unused-legend-entry",
        'Entry 1 of legend "key" ("purple line") explains no edge: no edge of the figure has sumi/arrow, variant "default", tone "purple".',
      ],
    ]);
  });

  test("inside a dimmed group (#175), outlined nodes and toned edges take the dim colors", () => {
    const { state } = checkFigure(
      [
        "version: 1",
        "figure: { id: f, theme: paper, layout: { arrange: { row: { items: [g, c] } } } }",
        "groups: [{ id: g, dim: true, arrange: { row: { items: [a, b] } } }]",
        "nodes:",
        "  - { id: a, component: box, label: A, tone: purple, variant: outlined }",
        "  - { id: b, component: box, label: B }",
        "  - { id: c, component: box, label: C, tone: purple, variant: outlined }",
        "edges:",
        "  - { from: a, to: b, tone: orange }",
        "  - { from: b, to: c, tone: orange }",
        "",
      ].join("\n"),
    );
    expect(state.diagnostics).toEqual([]);
    const paper = builtin("paper");
    const dim = paper.dim;
    if (dim === undefined) throw new Error("paper has no dim");
    const style = (key: string) => state.styles?.get(key as `n:${string}`);
    expect(style("n:a")).toMatchObject({
      fill: "#ffffff",
      stroke: dim.stroke,
      fontColor: dim.fontColor,
    });
    expect(style("e:#0")).toMatchObject({ stroke: dim.stroke, fontColor: dim.fontColor });
    // Outside the dimmed group (or crossing its border), as written.
    const purple = paper.toneLines.get("purple")?.stroke;
    const orange = paper.toneLines.get("orange")?.stroke;
    expect(style("n:c")).toMatchObject({ stroke: purple, fontColor: purple });
    expect(style("e:#1")).toMatchObject({ stroke: orange, fontColor: orange });
  });

  test("an unknown tone on an edge is a schema error with a suggestion", () => {
    const { state } = checkFigure(
      "version: 1\nfigure: { id: f }\nnodes: [{ id: a, component: box, label: A }, { id: b, component: box, label: B }]\nedges: [{ from: a, to: b, tone: purpel }]\n",
    );
    expect(state.diagnostics.map((d) => [d.code, d.path, d.hint])).toEqual([
      ["schema/invalid-value", ["edges", 0, "tone"], 'Did you mean "purple"?'],
    ]);
  });
});
