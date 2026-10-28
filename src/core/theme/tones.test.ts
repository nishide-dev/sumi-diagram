/** Tones (#92, design doc §6.20): theme palettes, validation and resolution order. */

import { describe, expect, test } from "bun:test";
import { checkFigure } from "../check";
import { createBuiltinRegistry } from "../registry/builtins";
import { componentId } from "../registry/manifest";
import {
  BUILTIN_THEMES,
  DEFAULT_FONT_SET_ID,
  getTheme,
  resolveStyle,
  type Theme,
  type ThemeDefinition,
  validateTheme,
} from ".";
import { TONE_NAMES } from "./tones";

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

const codes = (raw: unknown) => validateTheme(raw).diagnostics.map((d) => [d.code, d.path, d.hint]);

function builtin(id: string): Theme {
  const theme = getTheme(id);
  if (!theme) throw new Error(`missing theme ${id}`);
  return theme;
}

describe("theme tones", () => {
  test("every built-in theme defines every tone, with a fill", () => {
    for (const theme of BUILTIN_THEMES.values()) {
      expect([...theme.tones.keys()].sort()).toEqual([...TONE_NAMES].sort());
      for (const layer of theme.tones.values()) expect(Object.keys(layer)).toEqual(["fill"]);
    }
  });

  test("color fills every tone differently; the monochrome themes use three grays", () => {
    const fills = (id: string) => new Set([...builtin(id).tones.values()].map((l) => l.fill));
    expect(fills("color").size).toBe(TONE_NAMES.length);
    for (const id of ["minimal", "academic", "slides"]) {
      const grays = [...fills(id)];
      expect(grays).toHaveLength(3);
      for (const gray of grays) expect(gray).toMatch(/^#([0-9a-f]{2})\1\1$/);
    }
    // Hues usually drawn side by side differ even in grayscale.
    const academic = builtin("academic").tones;
    for (const [a, b] of [
      ["orange", "yellow"],
      ["blue", "yellow"],
      ["purple", "green"],
    ] as const) {
      expect(academic.get(a)?.fill).not.toBe(academic.get(b)?.fill);
    }
  });

  test("tones resolve to token values", () => {
    const theme = valid(
      definition({
        tokens: { color: { warm: "#FFEEDD" } },
        tones: { orange: { fill: "{color.warm}" } },
      }),
    );
    expect(theme.tones.get("orange")).toEqual({ fill: "#ffeedd" });
  });

  test("unknown tone names, non-color properties and unknown properties are errors", () => {
    expect(
      codes(
        definition({
          tones: {
            orang: { fill: "#ffffff" },
            blue: { strokeWidth: "2pt", fontColor: "#000000" },
            red: { colour: "#ff0000" },
          } as NonNullable<ThemeDefinition["tones"]>,
        }),
      ),
    ).toEqual([
      [
        "theme/unknown-property",
        ["tones", "red", "colour"],
        "A tone sets only fill, stroke, fontColor.",
      ],
    ]);
    expect(
      codes(
        definition({
          tones: {
            orang: { fill: "#ffffff" },
            blue: { strokeWidth: "2pt", fontColor: "#000000" },
            green: { fill: "{color.none}" },
          } as NonNullable<ThemeDefinition["tones"]>,
        }),
      ).map(([code, path]) => [code, path]),
    ).toEqual([
      ["theme/unknown-tone", ["tones", "orang"]],
      ["theme/inapplicable-property", ["tones", "blue", "strokeWidth"]],
      ["theme/unknown-token", ["tones", "green", "fill"]],
    ]);
  });

  test("a theme without tones is valid and has none", () => {
    expect(valid(definition()).tones.size).toBe(0);
  });
});

describe("tone resolution", () => {
  const registry = createBuiltinRegistry();
  const target = (name: string, variant: string, tone?: (typeof TONE_NAMES)[number]) => {
    const manifest = registry.get(`sumi/${name}`);
    if (!manifest) throw new Error(name);
    return { kind: manifest.kind, id: componentId(manifest), variant, tone };
  };

  test("the tone layer applies after the variant and changes only its colors", () => {
    const academic = builtin("academic");
    const emphasis = resolveStyle(academic, target("box", "emphasis")).style;
    const toned = resolveStyle(academic, target("box", "emphasis", "orange"));
    expect(toned.missingTone).toBe(false);
    expect(toned.style).toEqual({ ...emphasis, fill: academic.tones.get("orange")?.fill ?? "" });
    // The variant's heavier outline stays.
    expect(toned.style.strokeWidth).toEqual(emphasis.strokeWidth);
  });

  test("groups take tones; edges take the tone's line color (#177)", () => {
    const color = builtin("color");
    const group = resolveStyle(color, target("container", "default", "blue")).style;
    expect(group.fill).toBe(color.tones.get("blue")?.fill ?? "");
    const edge = resolveStyle(color, target("arrow", "default", "blue"));
    const plain = resolveStyle(color, target("arrow", "default"));
    expect(edge).toEqual({
      ...plain,
      style: { ...plain.style, ...color.toneLines.get("blue") },
    });
  });

  test("a tone the theme does not define is left out and reported", () => {
    const theme = valid(definition({ tones: { blue: { fill: "#0000ff" } } }));
    const plain = resolveStyle(theme, target("box", "default"));
    const missing = resolveStyle(theme, target("box", "default", "red"));
    expect(missing).toEqual({ ...plain, missingTone: true });
    expect(resolveStyle(theme, target("box", "default", "blue")).missingTone).toBe(false);
  });

  test("the theme stage applies tones to figure elements", () => {
    const { state } = checkFigure(
      [
        "version: 1",
        "figure: { id: f, theme: color }",
        "groups: [{ id: g, tone: green }]",
        "nodes:",
        "  - { id: a, component: box, label: A, tone: orange, group: g }",
        "  - { id: b, component: box, label: B }",
        "edges: [{ from: a, to: b }]",
        "",
      ].join("\n"),
    );
    expect(state.diagnostics).toEqual([]);
    const color = builtin("color");
    const fill = (key: string) => {
      const style = state.styles?.get(key as `n:${string}`);
      return style?.kind === "edge" ? undefined : style?.fill;
    };
    expect(fill("n:a")).toBe(color.tones.get("orange")?.fill);
    expect(fill("g:g")).toBe(color.tones.get("green")?.fill);
    expect(fill("n:b")).toBe("#ffffff");
  });

  test("an unknown tone in a figure is a schema error with a suggestion", () => {
    const { state } = checkFigure(
      "version: 1\nfigure: { id: f }\nnodes: [{ id: a, component: box, label: A, tone: orang }]\n",
    );
    expect(state.diagnostics.map((d) => [d.code, d.path, d.hint])).toEqual([
      ["schema/invalid-value", ["nodes", 0, "tone"], 'Did you mean "orange"?'],
    ]);
  });
});
