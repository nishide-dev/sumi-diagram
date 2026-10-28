import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { getProfile } from "../profile/builtin";
import { createBuiltinRegistry } from "../registry/builtins";
import { componentId } from "../registry/manifest";
import {
  BUILTIN_FONT_SETS,
  BUILTIN_THEME_DEFINITIONS,
  BUILTIN_THEMES,
  BUNDLED_FONT_SHA256,
  DEFAULT_FONT_SET_ID,
  FONT_SLOTS,
  type FontSet,
  fontSetArgs,
  getFontSet,
  inferValue,
  KIND_DEFAULTS,
  LATIN_FONT_SET_ID,
  resolveStyle,
  resolveTheme,
  sublabelFontSize,
  type Theme,
  type ThemeDefinition,
  type ValidateThemeOptions,
  validateTheme,
} from ".";

const defaultFontSet = (): FontSet => {
  const set = getFontSet(DEFAULT_FONT_SET_ID);
  if (!set) throw new Error("missing default font set");
  return set;
};

const theme = (patch: Partial<ThemeDefinition> = {}): ThemeDefinition => ({
  version: 1,
  id: "test",
  fonts: DEFAULT_FONT_SET_ID,
  ...patch,
});

function valid(definition: unknown, options?: ValidateThemeOptions): Theme {
  const result = validateTheme(definition, options);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  return result.value;
}

const codes = (definition: unknown, options?: ValidateThemeOptions) =>
  validateTheme(definition, options).diagnostics.map((d) => [d.code, d.path]);

const first = (definition: unknown, options?: ValidateThemeOptions) => {
  const [diagnostic] = validateTheme(definition, options).diagnostics;
  if (!diagnostic) throw new Error("expected a diagnostic");
  return diagnostic;
};

describe("font sets", () => {
  test("the built-in font sets are registered by ID with existing absolute TTF paths", () => {
    expect([...BUILTIN_FONT_SETS.keys()]).toEqual(["sumi/biz-ud-gothic", LATIN_FONT_SET_ID]);
    const set = defaultFontSet();
    expect(set.italic).toBeUndefined();
    // The default set has no Latin slots (#172): built-in themes keep their glyphs.
    expect(set.latin).toBeUndefined();
    expect(set.latinBold).toBeUndefined();
    // Only paper (#173) uses the Latin set.
    for (const theme of BUILTIN_THEMES.values()) {
      expect(theme.fontSet.id).toBe(theme.id === "paper" ? LATIN_FONT_SET_ID : DEFAULT_FONT_SET_ID);
    }
    // The Latin set is the default set plus Inter for Latin text.
    const latin = getFontSet(LATIN_FONT_SET_ID);
    expect(latin).toMatchObject({ ...set, id: LATIN_FONT_SET_ID, description: latin?.description });
    expect(basename(latin?.latin ?? "")).toBe("Inter-Regular.ttf");
    expect(basename(latin?.latinBold ?? "")).toBe("Inter-Bold.ttf");
    for (const file of [
      set.regular,
      set.bold,
      set.mono ?? "",
      set.math ?? "",
      set.mathItalic ?? "",
      latin?.latin ?? "",
      latin?.latinBold ?? "",
    ]) {
      expect(isAbsolute(file)).toBe(true);
      expect(file.endsWith(".ttf")).toBe(true);
      expect(existsSync(file)).toBe(true);
    }
  });

  test("every bundled font file has a checksum that matches the file and its README", async () => {
    const files = new Set(
      [...BUILTIN_FONT_SETS.values()].flatMap((set) =>
        FONT_SLOTS.flatMap((slot) => set[slot] ?? []),
      ),
    );
    expect(files.size).toBe(7);
    expect([...BUNDLED_FONT_SHA256.keys()].sort()).toEqual([...files].sort());
    for (const [file, expected] of BUNDLED_FONT_SHA256) {
      // Each font directory's README records its files.
      const readme = await Bun.file(join(dirname(file), "README.md")).text();
      const bytes = await Bun.file(file).bytes();
      expect(new Bun.CryptoHasher("sha256").update(bytes).digest("hex")).toBe(expected);
      expect(readme).toContain(`\`${basename(file)}\` | ${bytes.length} | \`${expected}\``);
    }
  });

  test("fontSetArgs passes all eight flags, filling missing slots with regular", () => {
    const set: FontSet = { id: "x/y", description: "", regular: "/r.ttf", bold: "/b.ttf" };
    expect(fontSetArgs(set)).toEqual([
      "--font-regular",
      "/r.ttf",
      "--font-italic",
      "/r.ttf",
      "--font-bold",
      "/b.ttf",
      "--font-semibold",
      "/b.ttf",
      "--font-mono",
      "/r.ttf",
      "--font-mono-bold",
      "/r.ttf",
      "--font-mono-italic",
      "/r.ttf",
      "--font-mono-semibold",
      "/r.ttf",
    ]);
    const full = fontSetArgs({ ...set, italic: "/i.ttf", mono: "/m.ttf" });
    expect(full.filter((_, i) => i % 2 === 1)).toEqual([
      "/r.ttf",
      "/i.ttf",
      "/b.ttf",
      "/b.ttf",
      "/m.ttf",
      "/m.ttf",
      "/m.ttf",
      "/m.ttf",
    ]);
  });

  test("the built-in font set uses its mono file for every mono flag", () => {
    const set = defaultFontSet();
    const args = fontSetArgs(set);
    expect(args).toHaveLength(16);
    expect(args[args.indexOf("--font-italic") + 1]).toBe(set.regular);
    expect(args[args.indexOf("--font-mono-bold") + 1]).toBe(set.mono);
  });
});

describe("inferValue (token leaf typing)", () => {
  const typeOf = (raw: unknown) => {
    const result = inferValue(raw);
    return result.ok ? result.value.type : "invalid";
  };

  test("infers types mechanically from the value's form", () => {
    expect(typeOf(4)).toBe("number");
    expect(typeOf(0.5)).toBe("number");
    expect(typeOf(true)).toBe("boolean");
    expect(typeOf("8pt")).toBe("length");
    expect(typeOf("-1.5mm")).toBe("length");
    expect(typeOf("0.25in")).toBe("length");
    expect(typeOf("#fff")).toBe("color");
    expect(typeOf("#1F2328")).toBe("color");
    expect(typeOf("transparent")).toBe("color");
  });

  test("normalizes lengths to pt and colors to lowercase", () => {
    expect(inferValue("0.25in")).toMatchObject({ ok: true, value: { value: { pt: 18 } } });
    expect(inferValue("#ABCDEF")).toEqual({ ok: true, value: { type: "color", value: "#abcdef" } });
  });

  test("rejects anything else", () => {
    for (const raw of ["red", "#ff", "#ggg", "8px", "8", "8 pt", "true", "rgb(0,0,0)", null, []]) {
      expect(typeOf(raw)).toBe("invalid");
    }
    expect(inferValue("rgb(0,0,0)")).toMatchObject({
      hint: 'Write the color as hex, e.g. "#1f2328".',
    });
    expect(inferValue("8")).toMatchObject({ hint: 'Write 8 for a number or "8pt" for a length.' });
    expect(inferValue("8px")).toMatchObject({ ok: false, message: expect.stringContaining("px") });
  });
});

describe("validateTheme: tokens", () => {
  test("resolves nested tokens and token-to-token references", () => {
    const t = valid(
      theme({
        tokens: {
          color: { ink: "#000", fg: "{color.ink}", text: "{color.fg}" },
          line: { base: "0.5mm", unused: 3 },
        },
        base: { node: { fontColor: "{color.text}", stroke: "{color.fg}" } },
      }),
    );
    expect(t.tokens.get("color.text")).toEqual({ type: "color", value: "#000" });
    expect(t.tokens.get("line.unused")).toEqual({ type: "number", value: 3 });
    expect(t.base.node).toEqual({ fontColor: "#000", stroke: "#000" });
  });

  test("reports reference cycles once, without cascading to dependents", () => {
    const definition = theme({
      tokens: { a: { x: "{a.y}", y: "{a.z}", z: "{a.x}", w: "{a.x}" }, self: "{self}" },
      base: { node: { strokeWidth: "{a.w}" } },
    });
    expect(codes(definition)).toEqual([
      ["theme/token-cycle", ["tokens", "a", "x"]],
      ["theme/token-cycle", ["tokens", "self"]],
    ]);
    expect(first(definition).message).toBe("Token reference cycle: {a.x} → {a.y} → {a.z} → {a.x}.");
    expect(first(definition).related?.map((r) => r.path)).toEqual([
      ["tokens", "a", "y"],
      ["tokens", "a", "z"],
    ]);
  });

  test("reports unknown tokens and references to token groups", () => {
    const definition = theme({
      tokens: { color: { fg: "#000" }, alias: "{color.gf}" },
      base: { node: { stroke: "{color}" } },
    });
    const { diagnostics } = validateTheme(definition);
    expect(diagnostics.map((d) => [d.code, d.path, d.message, d.hint])).toEqual([
      [
        "theme/unknown-token",
        ["tokens", "alias"],
        "Unknown token {color.gf}.",
        'Did you mean "color.fg"?',
      ],
      [
        "theme/unknown-token",
        ["base", "node", "stroke"],
        "Token reference {color} names a token group, not a value.",
        "Reference a token inside it, e.g. {color.fg}.",
      ],
    ]);
  });

  test("reports invalid token values and names", () => {
    expect(
      codes(theme({ tokens: { color: { fg: "red", "bad name": "#000" }, ref: "{color.fg" } })),
    ).toEqual([
      // Names are checked while collecting tokens, values while resolving them.
      ["theme/invalid-token", ["tokens", "color", "bad name"]],
      ["theme/invalid-token", ["tokens", "color", "fg"]],
      ["theme/invalid-token", ["tokens", "ref"]],
    ]);
  });

  test("reports type mismatches between properties and tokens", () => {
    const definition = theme({
      tokens: { size: { text: "8pt" }, dash: 2 },
      base: {
        node: { fill: "{size.text}", fontSize: 8, strokeWidth: "{dash}", bold: "#000" },
      },
    });
    const { diagnostics } = validateTheme(definition);
    expect(diagnostics.map((d) => [d.code, d.path, d.message, d.hint])).toEqual([
      [
        "theme/type-mismatch",
        ["base", "node", "fill"],
        'Property "fill" expects a color, but got a length (from token {size.text}).',
        undefined,
      ],
      [
        "theme/type-mismatch",
        ["base", "node", "strokeWidth"],
        'Property "strokeWidth" expects a length, but got a number (from token {dash}).',
        'Add a unit, e.g. "2pt".',
      ],
      [
        "theme/type-mismatch",
        ["base", "node", "fontSize"],
        'Property "fontSize" expects a length, but got a number.',
        'Add a unit, e.g. "8pt".',
      ],
      [
        "theme/type-mismatch",
        ["base", "node", "bold"],
        'Property "bold" expects a boolean, but got a color.',
        undefined,
      ],
    ]);
    expect(diagnostics[0]?.related?.[0]?.path).toEqual(["tokens", "size", "text"]);
  });
});

describe("validateTheme: values", () => {
  const node = (style: Record<string, unknown>) =>
    validateTheme(theme({ base: { node: style as never } }));

  test("stores lengths as exact multiples of 0.5pt with D2 units", () => {
    const result = node({ strokeWidth: "1.5pt", radius: "2.54cm", fontSize: "0.125in" });
    expect(result.ok && result.value.base.node).toEqual({
      strokeWidth: { pt: 1.5, units: 3 },
      radius: { pt: 72, units: 144 },
      fontSize: { pt: 9, units: 18 },
    });
  });

  test("never rounds unrepresentable lengths", () => {
    const result = node({ strokeWidth: "0.75pt", fontSize: "3mm" });
    expect(result.diagnostics.map((d) => [d.code, d.path, d.message, d.hint])).toEqual([
      [
        "theme/unrepresentable-value",
        ["base", "node", "strokeWidth"],
        "strokeWidth 0.75pt is not a multiple of 0.5pt, the D2 unit.",
        'The nearest representable value is "1pt"; Sumi never rounds visual lengths.',
      ],
      [
        "theme/unrepresentable-value",
        ["base", "node", "fontSize"],
        "fontSize 8.5pt is not a multiple of 0.5pt, the D2 unit.",
        'The nearest representable value is "8.5pt"; Sumi never rounds visual lengths.',
      ],
    ]);
  });

  test("checks D2 ranges", () => {
    const ok = node({
      strokeWidth: "7.5pt",
      strokeDash: 10,
      radius: "0pt",
      opacity: 0,
      fontSize: "4pt",
    });
    expect(ok.ok).toBe(true);
    expect(node({ fontSize: "50pt" }).ok).toBe(true);
    const result = node({
      strokeWidth: "8pt",
      strokeDash: 1.5,
      radius: "-1pt",
      opacity: 1.1,
      fontSize: "3.5pt",
    });
    expect(result.diagnostics.map((d) => [d.code, d.message])).toEqual([
      ["theme/out-of-range", "strokeWidth must be between 0pt and 7.5pt, got 8pt."],
      ["theme/out-of-range", "strokeDash must be an integer between 0 and 10, got 1.5."],
      ["theme/out-of-range", "radius must be at least 0pt, got -1pt."],
      ["theme/out-of-range", "opacity must be between 0 and 1, got 1.1."],
      ["theme/out-of-range", "fontSize must be between 4pt and 50pt, got 3.5pt."],
    ]);
    expect(node({ fontSize: "50.5pt", strokeDash: 11 }).diagnostics).toHaveLength(2);
  });

  test("accepts only hex colors and transparent", () => {
    expect(node({ fill: "transparent", stroke: "#ABC" }).ok).toBe(true);
    expect(codes(theme({ base: { node: { fill: "white", stroke: "rgb(0, 0, 0)" } } }))).toEqual([
      ["theme/invalid-token", ["base", "node", "fill"]],
      ["theme/invalid-token", ["base", "node", "stroke"]],
    ]);
  });

  test("reports properties that do not apply to a kind", () => {
    expect(
      codes(
        theme({
          base: { edge: { fill: "#fff", radius: "1pt" }, node: { filled: true } },
          components: { arrow: { default: { fill: "#fff", radius: "0pt" } } },
        }),
      ),
    ).toEqual([
      ["theme/inapplicable-property", ["base", "node", "filled"]],
      ["theme/inapplicable-property", ["base", "edge", "radius"]],
      ["theme/inapplicable-property", ["components", "arrow", "default", "radius"]],
    ]);
  });
});

describe("validateTheme: fonts", () => {
  const withSlots = (slots: { italic?: string; mono?: string }): ValidateThemeOptions => {
    const { italic: _, mono: __, ...required } = defaultFontSet();
    return { fontSets: new Map([["test/fonts", { ...required, id: "test/fonts", ...slots }]]) };
  };

  test("reports unknown font sets", () => {
    const d = first(theme({ fonts: "sumi/biz-ud-gotic" }));
    expect([d.code, d.path, d.hint]).toEqual([
      "theme/unknown-font-set",
      ["fonts"],
      'Did you mean "sumi/biz-ud-gothic"?',
    ]);
  });

  test("italic and mono need the font set slot", () => {
    expect(codes(theme({ base: { node: { italic: true, mono: false } } }))).toEqual([
      ["theme/missing-font", ["base", "node", "italic"]],
    ]);
    expect(
      codes(theme({ fonts: "test/fonts", base: { edge: { mono: true } } }), withSlots({})),
    ).toEqual([["theme/missing-font", ["base", "edge", "mono"]]]);
    expect(valid(theme({ base: { node: { mono: true } } })).base.node.mono).toBe(true);
  });

  test("bold and italic together are unsupported, even across layers", () => {
    const options = withSlots({ italic: "/i.ttf", mono: "/m.ttf" });
    // Groups are bold by default.
    expect(
      codes(theme({ fonts: "test/fonts", base: { group: { italic: true } } }), options),
    ).toEqual([["theme/unsupported-font-combination", ["base", "group"]]]);
    expect(
      codes(
        theme({
          fonts: "test/fonts",
          base: { node: { italic: true } },
          components: { box: { emphasis: { bold: true } }, circle: { default: { bold: false } } },
        }),
        options,
      ),
    ).toEqual([["theme/unsupported-font-combination", ["components", "box", "emphasis"]]]);
    expect(
      valid(theme({ fonts: "test/fonts", base: { edge: { italic: true } } }), options).base.edge,
    ).toEqual({ italic: true });
  });
});

describe("validateTheme: structure and components", () => {
  test("normalizes component keys to canonical IDs", () => {
    const t = valid(
      theme({
        components: {
          box: { emphasis: { bold: true } },
          "sumi/arrow": { dashed: { strokeDash: 4 } },
        },
      }),
    );
    expect([...t.components.keys()]).toEqual(["sumi/box", "sumi/arrow"]);
    expect(t.components.get("sumi/box")?.get("emphasis")).toEqual({ bold: true });
  });

  test("reports unknown and duplicate components and unknown variants", () => {
    const { diagnostics } = validateTheme(
      theme({
        components: {
          boxx: {},
          box: { loud: {} },
          "sumi/box": {},
          "acme/widget": {},
        },
      }),
    );
    expect(diagnostics.map((d) => [d.code, d.path, d.hint])).toEqual([
      ["theme/unknown-component", ["components", "boxx"], 'Did you mean "box"?'],
      [
        "theme/unknown-variant",
        ["components", "box", "loud"],
        "Variants of sumi/box: default, emphasis, muted, filled.",
      ],
      ["theme/duplicate-component", ["components", "sumi/box"], "Merge the two entries into one."],
      [
        "theme/unknown-component",
        ["components", "acme/widget"],
        expect.stringContaining("Known components:"),
      ],
    ]);
  });

  test("reports structural errors", () => {
    expect(codes({ version: 2, id: "Bad", fonts: 3, colour: {} })).toEqual([
      ["theme/unsupported-version", ["version"]],
      ["theme/invalid-value", ["id"]],
      ["theme/invalid-type", ["fonts"]],
      ["theme/unknown-field", ["colour"]],
    ]);
    expect(codes({ version: 1, id: "x" })).toEqual([["theme/missing-field", ["fonts"]]]);
    const d = first(theme({ base: { node: { stroek: "#000" } as never, edges: {} } as never }));
    expect([d.code, d.path, d.hint]).toEqual([
      "theme/unknown-property",
      ["base", "node", "stroek"],
      'Did you mean "stroke"?',
    ]);
    expect(codes(theme({ base: { edges: {} } as never }))).toEqual([
      ["theme/unknown-field", ["base", "edges"]],
    ]);
  });
});

describe("resolveStyle", () => {
  const t = valid(
    theme({
      tokens: { line: { bold: "2pt" } },
      base: { node: { stroke: "#111111", fill: "#eeeeee", fontSize: "9pt" } },
      components: {
        box: {
          default: { fill: "#dddddd", radius: "2pt" },
          emphasis: { fill: "#cccccc", strokeWidth: "{line.bold}" },
        },
      },
    }),
  );

  test("applies kind defaults, base, default and variant property by property", () => {
    const { style, missingVariant } = resolveStyle(t, {
      kind: "node",
      id: "sumi/box",
      variant: "emphasis",
    });
    expect(missingVariant).toBe(false);
    expect(style).toEqual({
      ...KIND_DEFAULTS.node,
      stroke: "#111111", // base
      fontSize: { pt: 9, units: 18 }, // base
      radius: { pt: 2, units: 4 }, // default
      fill: "#cccccc", // variant over default over base
      strokeWidth: { pt: 2, units: 4 }, // variant
    });
    expect(Object.isFrozen(style)).toBe(true);
  });

  test("unstyled components use the kind defaults and base", () => {
    const { style } = resolveStyle(t, { kind: "node", id: "sumi/circle", variant: "default" });
    expect(style).toEqual({
      ...KIND_DEFAULTS.node,
      stroke: "#111111",
      fill: "#eeeeee",
      fontSize: { pt: 9, units: 18 },
    });
    expect(resolveStyle(t, { kind: "edge", id: "sumi/arrow", variant: "default" }).style).toEqual(
      KIND_DEFAULTS.edge,
    );
  });

  test("a variant missing from the theme falls back to default", () => {
    const fallback = resolveStyle(t, { kind: "node", id: "sumi/box", variant: "muted" });
    const plain = resolveStyle(t, { kind: "node", id: "sumi/box", variant: "default" });
    expect(fallback.missingVariant).toBe(true);
    expect(fallback.style).toEqual(plain.style);
    expect(plain.missingVariant).toBe(false);
  });

  test("kind defaults match the design doc table", () => {
    expect(KIND_DEFAULTS.group).toMatchObject({
      fill: "transparent",
      bold: true,
      fontSize: { pt: 9 },
    });
    expect(KIND_DEFAULTS.edge).toMatchObject({ filled: true, fontSize: { pt: 7, units: 14 } });
    // On edges, fill is the label background (#31).
    expect(KIND_DEFAULTS.edge.fill).toBe("#ffffff");
  });
});

describe("built-in themes", () => {
  const registry = createBuiltinRegistry();

  test("minimal, academic, slides, color and paper are registered with their font sets", () => {
    expect([...BUILTIN_THEMES.keys()]).toEqual(["minimal", "academic", "slides", "color", "paper"]);
    for (const t of BUILTIN_THEMES.values()) {
      expect(t.fontSet.id).toBe(t.id === "paper" ? LATIN_FONT_SET_ID : DEFAULT_FONT_SET_ID);
    }
    for (const definition of BUILTIN_THEME_DEFINITIONS) {
      expect(validateTheme(definition).diagnostics).toEqual([]);
    }
  });

  for (const t of BUILTIN_THEMES.values()) {
    test(`${t.id} styles every built-in component × variant completely`, () => {
      for (const manifest of registry.list()) {
        for (const variant of manifest.variants) {
          const target = { kind: manifest.kind, id: componentId(manifest), variant };
          const { style, missingVariant } = resolveStyle(t, target);
          expect(missingVariant).toBe(false);
          expect(Object.keys(style).sort()).toEqual(
            Object.keys(KIND_DEFAULTS[manifest.kind]).sort(),
          );
          expect(style.bold && style.italic).toBe(false);
          // Paper profiles require at least 7pt.
          expect(style.fontSize.pt).toBeGreaterThanOrEqual(7);
          for (const length of [style.fontSize, style.strokeWidth]) {
            expect(Number.isInteger(length.units)).toBe(true);
            expect(length.pt * 2).toBe(length.units);
          }
        }
      }
    });
  }

  test("variants differ from the default style", () => {
    for (const t of BUILTIN_THEMES.values()) {
      for (const manifest of registry.list()) {
        const id = componentId(manifest);
        const base = resolveStyle(t, { kind: manifest.kind, id, variant: "default" }).style;
        for (const variant of manifest.variants.filter((v) => v !== "default")) {
          const { style } = resolveStyle(t, { kind: manifest.kind, id, variant });
          expect(style).not.toEqual(base);
        }
      }
    }
  });

  test("slides meets presentation-16x9's minimum font size everywhere (#36)", () => {
    const slides = BUILTIN_THEMES.get("slides");
    const min = getProfile("presentation-16x9")?.typography.minFontSize.pt;
    if (slides === undefined || min === undefined) throw new Error("missing slides or profile");
    expect(min).toBe(14);
    for (const manifest of registry.list()) {
      for (const variant of manifest.variants) {
        const target = { kind: manifest.kind, id: componentId(manifest), variant };
        const { style } = resolveStyle(slides, target);
        expect({ ...target, fontSize: style.fontSize.pt >= min }).toEqual({
          ...target,
          fontSize: true,
        });
        // D2's limits after the ×2 conversion (design doc §4.1).
        expect(style.fontSize.pt).toBeLessThanOrEqual(50);
        expect(style.strokeWidth.pt).toBeLessThanOrEqual(7.5);
      }
    }
  });

  test("paper rounds boxes and groups, keeps edges thin and fills tones with pastels (#173)", () => {
    const paper = BUILTIN_THEMES.get("paper");
    if (paper === undefined) throw new Error("missing paper");
    const style = (id: string, variant = "default") => {
      const manifest = registry.get(`sumi/${id}`);
      if (manifest === undefined) throw new Error(`missing ${id}`);
      return resolveStyle(paper, { kind: manifest.kind, id: componentId(manifest), variant }).style;
    };
    const radius = (s: ReturnType<typeof style>) => ("radius" in s ? s.radius.pt : undefined);
    // Rectangular nodes are rounded in every variant; other shapes are not.
    for (const id of ["box", "square"]) {
      for (const variant of ["default", "emphasis", "muted"])
        expect(radius(style(id, variant))).toBe(2);
    }
    for (const id of ["circle", "diamond", "operator", "stack", "label", "image"]) {
      expect(radius(style(id))).toBe(0);
    }
    expect(radius(style("container"))).toBe(6);
    expect(radius(style("container", "muted"))).toBe(6);
    expect(radius(style("legend"))).toBe(3);
    // #174's variants: borderless rounded fills and panels, a dashed rounded panel.
    expect(style("box", "filled")).toMatchObject({ strokeWidth: { pt: 0 }, fill: "#dcdee6" });
    expect(radius(style("box", "filled"))).toBe(2);
    for (const variant of ["plain", "filled", "dashed"]) {
      expect(radius(style("container", variant))).toBe(6);
    }
    expect(style("container", "filled")).toMatchObject({ strokeWidth: { pt: 0 }, fill: "#f3f3f5" });
    expect(style("container", "plain")).toMatchObject({
      strokeWidth: { pt: 0 },
      fill: "transparent",
    });
    expect(style("container", "dashed")).toMatchObject({ strokeDash: 3, fill: "transparent" });
    // Black 1pt frames, 0.5pt edges: arrowheads as small as academic's.
    expect(style("box").strokeWidth.pt).toBe(1);
    expect(style("box").stroke).toBe("#000000");
    expect(style("container").fill).toBe("#f3f3f5");
    for (const id of ["arrow", "line", "double-arrow"]) {
      expect(style(id).strokeWidth.pt).toBe(0.5);
      expect(style(id, "emphasis").strokeWidth.pt).toBe(1);
    }
    const academic = BUILTIN_THEMES.get("academic");
    if (academic === undefined) throw new Error("missing academic");
    const academicArrow = resolveStyle(academic, {
      kind: "edge",
      id: "sumi/arrow",
      variant: "default",
    });
    expect(style("arrow").strokeWidth).toEqual(academicArrow.style.strokeWidth);
    // Eight distinct pastel tones.
    const fills = [...paper.tones.values()].map((layer) => layer.fill);
    expect(new Set(fills).size).toBe(8);
  });

  test("resolveTheme suggests the closest theme name", () => {
    expect(resolveTheme("academic").ok).toBe(true);
    const result = resolveTheme("minimall");
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((d) => [d.code, d.path, d.hint])).toEqual([
      [
        "theme/unknown",
        ["figure", "theme"],
        'Did you mean "minimal"? Available themes: minimal, academic, slides, color, paper.',
      ],
    ]);
  });
});

describe("sublabelFontSize (#184)", () => {
  test("is 7/8 of the label's size, rounded down to 0.5pt", () => {
    const at = (pt: number) => sublabelFontSize({ pt, units: pt * 2 });
    expect([8, 9, 16, 7, 4, 50].map((pt) => at(pt))).toEqual([
      { pt: 7, units: 14 },
      { pt: 7.5, units: 15 },
      { pt: 14, units: 28 },
      { pt: 6, units: 12 },
      { pt: 3.5, units: 7 },
      { pt: 43.5, units: 87 },
    ]);
  });

  test("gives size.small from size.text in every built-in theme", () => {
    for (const theme of BUILTIN_THEMES.values()) {
      const node = resolveStyle(theme, { kind: "node", id: "sumi/box", variant: "default" });
      const edge = resolveStyle(theme, { kind: "edge", id: "sumi/arrow", variant: "default" });
      expect(sublabelFontSize(node.style.fontSize)).toEqual(edge.style.fontSize);
    }
  });
});

describe("borderless and dashed variants (#174)", () => {
  for (const [id, theme] of BUILTIN_THEMES) {
    test(`${id}: filled nodes, plain / filled / dashed containers`, () => {
      const node = (variant: string, tone?: "yellow") =>
        resolveStyle(theme, { kind: "node", id: "sumi/box", variant, tone }).style;
      const group = (variant: string, tone?: "yellow") =>
        resolveStyle(theme, { kind: "group", id: "sumi/container", variant, tone }).style;
      // A filled node: no outline, tone gray's fill unless a tone sets one.
      expect(node("filled").strokeWidth.pt).toBe(0);
      expect(node("filled").fill).toBe(theme.tones.get("gray")?.fill ?? "");
      expect(node("filled", "yellow").fill).toBe(theme.tones.get("yellow")?.fill ?? "");
      expect(node("filled").fontColor).toBe(node("default").fontColor);
      // Containers: plain has neither border nor fill, filled a fill only,
      // dashed a dashed border only; the title is the default one.
      expect(group("plain")).toMatchObject({ fill: "transparent", strokeWidth: { pt: 0 } });
      expect(group("filled").strokeWidth.pt).toBe(0);
      expect(group("filled").fill).not.toBe("transparent");
      expect(group("dashed")).toMatchObject({
        fill: "transparent",
        strokeWidth: group("default").strokeWidth,
        stroke: group("default").stroke,
      });
      expect(group("dashed").strokeDash).toBeGreaterThan(0);
      for (const variant of ["plain", "filled", "dashed"]) {
        expect(group(variant).fontColor).toBe(group("default").fontColor);
        expect(group(variant).bold).toBe(group("default").bold);
        // A tone sets the fill of any of them.
        expect(group(variant, "yellow").fill).toBe(theme.tones.get("yellow")?.fill ?? "");
      }
    });
  }
});
