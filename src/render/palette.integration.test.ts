import { describe, expect, test } from "bun:test";
import { htmlThemeVariables } from "../assets/html-render";
import { buildFullCatalog } from "../core/catalog";
import { checkFigure } from "../core/check";
import { createBuiltinRegistry } from "../core/registry/builtins";
import { getTheme } from "../core/theme/builtin";
import { getPalette, PALETTE_NAMES } from "../core/theme/palette";
import { renderFigure } from "./render";

const source = (theme: string, overrides = "") => `version: 1
figure:
  id: palette
  theme: ${theme}
${overrides}  layout:
    arrange:
      row: { gap: 8mm, align: center, items: [panel, out, green, gray] }
groups:
  - id: panel
    label: Panel
    arrange: { row: { gap: 6mm, items: [a, b, c] } }
nodes:
  - { id: a, component: box, label: Plain }
  - { id: b, component: box, label: Solid, variant: solid }
  - { id: c, component: box, label: Filled, variant: filled }
  - { id: out, component: box, label: Emphasis, variant: emphasis }
  - { id: green, component: box, label: Green, tone: green }
  - { id: gray, component: box, label: Gray, tone: gray }
edges:
  - { from: a, to: b }
  - { from: b, to: c }
  - { from: c, to: out, variant: emphasis }
`;

const withPalette = (theme: string, palette: string, extra = "") =>
  source(theme, `  themeOverrides:\n    palette: ${palette}\n${extra}`);

async function render(text: string) {
  const result = await renderFigure(text);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.value;
}

describe("figure.themeOverrides.palette (#417)", () => {
  test("a figure without a palette is drawn as before, also with empty overrides", async () => {
    for (const theme of ["minimal", "color", "paper", "llama"]) {
      const plain = await render(source(theme));
      const empty = await render(source(theme, "  themeOverrides: {}\n"));
      // Only the metadata's hash of the source differs.
      const unhashed = (svg: string) => svg.replace(/input-sha256="[0-9a-f]+"/, "");
      expect(unhashed(empty.svg)).toBe(unhashed(plain.svg));
      expect(plain.svg).not.toContain("#3f72af");
    }
  });

  test("a named palette recolors the whole figure in every theme", async () => {
    for (const theme of ["minimal", "academic", "slides", "color", "paper", "llama"]) {
      const palette = getPalette("cool-blue");
      if (palette === undefined) throw new Error("cool-blue");
      const result = await render(withPalette(theme, "cool-blue"));
      const { ir } = result.compiled;
      const node = (id: string) => ir.nodes.find((n) => n.id === id)?.style;
      expect(node("a")?.fontColor, theme).toBe(palette.roles.ink);
      expect(node("b")?.fill, theme).toBe(palette.roles.strong);
      expect(node("c")?.fill, theme).toBe(palette.roles.tint);
      expect(node("out")?.stroke, theme).toBe(palette.roles.accent);
      // The other tones stay the theme's.
      const plain = (await render(source(theme))).compiled.ir;
      expect(node("green")?.fill, theme).toBe(
        plain.nodes.find((n) => n.id === "green")?.style.fill,
      );
      // The gray tone is the palette's neutral.
      expect(node("gray")?.fill, theme).toBe(palette.roles.tint);
      expect(result.svg).not.toBe((await render(source(theme))).svg);
    }
  });

  test("every palette renders without a diagnostic and with its own colors", async () => {
    const svgs = new Set<string>();
    for (const name of PALETTE_NAMES) {
      const result = await renderFigure(withPalette("paper", name));
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
      expect(result.diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
      const palette = getPalette(name);
      if (palette === undefined) throw new Error(name);
      expect(result.value.svg).toContain(palette.roles.ink);
      expect(result.value.svg).toContain(palette.roles.accent);
      svgs.add(result.value.svg);
    }
    expect(svgs.size).toBe(PALETTE_NAMES.length);
  });

  test("tone colors written in the figure win over the palette", async () => {
    const result = await render(
      withPalette("paper", "coral", "    tones:\n      gray: { fill: '#ccddee' }\n"),
    );
    expect(result.compiled.ir.nodes.find((n) => n.id === "gray")?.style.fill).toBe("#ccddee");
    // The rest of the palette still applies.
    expect(result.compiled.ir.nodes.find((n) => n.id === "a")?.style.fontColor).toBe(
      getPalette("coral")?.roles.ink,
    );
  });

  test("an unknown palette is a schema error that suggests the closest name", () => {
    const { diagnostics } = checkFigure(withPalette("paper", "coolblue")).state;
    const error = diagnostics.find((d) => d.severity === "error");
    expect(error?.code).toBe("schema/invalid-value");
    expect(error?.path).toEqual(["figure", "themeOverrides", "palette"]);
    expect(error?.hint).toContain("cool-blue");
  });
});

describe("palettes section of the catalog (#417)", () => {
  test("lists every palette with its colors, roles and source", () => {
    const catalog = buildFullCatalog(createBuiltinRegistry(), { sections: ["palettes"] });
    expect(Object.keys(catalog)).toEqual(["version", "palettes"]);
    expect(catalog.palettes?.path).toBe("figure.themeOverrides.palette");
    expect(catalog.palettes?.source).toContain("2026-11-08");
    expect(catalog.palettes?.palettes.map((p) => p.id)).toEqual([...PALETTE_NAMES]);
    for (const p of catalog.palettes?.palettes ?? []) {
      expect(p.colors).toHaveLength(4);
      expect(Object.keys(p.roles)).toEqual([
        "panel",
        "tint",
        "accent",
        "ink",
        "muted",
        "strong",
        "soft",
        "frame",
      ]);
    }
  });
});

describe("glyphs and HTML embeds follow the figure's colors (#417)", () => {
  const glyphSource = (overrides: string) => `version: 1
figure:
  id: glyphs
  theme: paper
  themeOverrides:
${overrides}
  layout: { arrange: { row: { items: [a] } } }
nodes:
  - id: a
    component: box
    label: A
    glyphs: [{ kind: vector, cells: 2, tone: orange }, { kind: dot, tone: gray }]
`;
  const fills = async (overrides: string) => {
    const node = (await render(glyphSource(overrides))).compiled.ir.nodes[0];
    return node?.glyphs?.flatMap((g) => g.parts.map((part) => part.fill)) ?? [];
  };

  test("a glyph takes the overridden tone colors, with or without a palette", async () => {
    const tones = "    tones: { orange: { fill: '#aabbcc' } }";
    expect(await fills(tones)).toContain("#aabbcc");
    expect(await fills(`${tones}\n    palette: coral`)).toContain("#aabbcc");
    // And the palette's gray tone for a gray glyph.
    expect(await fills("    palette: coral")).toContain(getPalette("coral")?.roles.tint as string);
    expect(await fills("    nodeCorners: square")).not.toContain("#aabbcc");
  });

  test("--sumi-accent is the palette's accent when a palette is set, the theme's blue otherwise", () => {
    const theme = getTheme("paper");
    if (theme === undefined) throw new Error("paper");
    const plain = htmlThemeVariables(theme)["--sumi-accent"];
    expect(plain).toBe(theme.toneLines.get("blue")?.stroke as string);
    for (const name of PALETTE_NAMES)
      expect(htmlThemeVariables(theme, name)["--sumi-accent"]).toBe(
        getPalette(name)?.roles.accent as string,
      );
    expect(htmlThemeVariables(theme, undefined)["--sumi-accent"]).toBe(plain);
  });
});
