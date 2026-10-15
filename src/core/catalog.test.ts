import { describe, expect, test } from "bun:test";
import { buildFullCatalog, CATALOG_SECTIONS } from "./catalog";
import {
  BUILTIN_PROFILES,
  buildProfileCatalog,
  type Profile,
  profileCatalogEntry,
  validateProfile,
} from "./profile";
import { createBuiltinRegistry } from "./registry/builtins";
import { buildCatalog } from "./registry/catalog";
import { componentId } from "./registry/manifest";
import {
  BUILTIN_THEMES,
  buildThemeCatalog,
  DEFAULT_FONT_SET_ID,
  type Theme,
  themeCatalogEntry,
  validateTheme,
} from "./theme";

function theme(definition: object): Theme {
  const result = validateTheme({
    version: 1,
    id: "test",
    fonts: DEFAULT_FONT_SET_ID,
    ...definition,
  });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.value;
}

function profile(definition: object): Profile {
  const result = validateProfile({
    version: 1,
    id: "test",
    description: "Test",
    margin: "0pt",
    typography: { minFontSize: "7pt" },
    layout: { layerGap: "0pt", containerPadding: "0pt" },
    ...definition,
  });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.value;
}

describe("buildThemeCatalog", () => {
  test("lists every built-in theme, in order, as JSON-safe data", () => {
    const catalog = buildThemeCatalog();
    expect(catalog.map((t) => t.id)).toEqual([...BUILTIN_THEMES.keys()]);
    expect(JSON.parse(JSON.stringify(catalog))).toEqual(catalog);
  });

  test("built-in themes style every variant and use the bundled font set", () => {
    for (const entry of buildThemeCatalog()) {
      expect(entry.missingVariants).toEqual({});
      expect(entry.fonts.id).toBe(DEFAULT_FONT_SET_ID);
      expect(entry.fonts.styles).toEqual(["regular", "bold", "mono"]);
      expect(entry.description).toEqual(expect.any(String));
    }
  });

  test("minimal: font sizes and the profiles they satisfy", () => {
    const minimal = buildThemeCatalog().find((t) => t.id === "minimal");
    expect(minimal).toMatchObject({
      fontSizePt: { min: 7, max: 9, base: { node: 8, group: 9, edge: 7 } },
      compatibleProfiles: ["paper-single", "paper-double"],
    });
  });

  test("compatibleProfiles holds the profiles whose minimum the smallest size meets", () => {
    const entry = themeCatalogEntry(
      theme({ base: { node: { fontSize: "14pt" }, group: { fontSize: "14pt" } } }),
    );
    // Edges keep Sumi's default 7pt, so only the 7pt profiles fit.
    expect(entry.fontSizePt.min).toBe(7);
    expect(entry.compatibleProfiles).toEqual(["paper-single", "paper-double"]);

    const largeTheme = theme({
      base: {
        node: { fontSize: "14pt" },
        group: { fontSize: "16pt" },
        edge: { fontSize: "14pt" },
      },
    });
    const large = themeCatalogEntry(largeTheme);
    expect(large.fontSizePt).toEqual({
      min: 14,
      max: 16,
      base: { node: 14, group: 16, edge: 14 },
    });
    expect(large.compatibleProfiles).toEqual([...BUILTIN_PROFILES.keys()]);
    // Custom profiles are honored.
    const custom = new Map([
      ["exact", profile({ id: "exact", typography: { minFontSize: "14pt" } })],
      ["big", profile({ id: "big", typography: { minFontSize: "15pt" } })],
    ]);
    expect(themeCatalogEntry(largeTheme, { profiles: custom }).compatibleProfiles).toEqual([
      "exact",
    ]);
  });

  test("variants without a style are listed by component", () => {
    const entry = themeCatalogEntry(theme({ components: { box: { emphasis: { bold: true } } } }));
    const registry = createBuiltinRegistry();
    const box = registry.list().find((m) => m.name === "box");
    if (box === undefined) throw new Error("no box");
    expect(entry.missingVariants[componentId(box)]).toEqual(["muted"]);
    // Every non-default variant of every other component is missing.
    const expected = registry
      .list()
      .filter((m) => m.name !== "box" && m.variants.length > 1)
      .map((m) => componentId(m));
    expect(Object.keys(entry.missingVariants).sort()).toEqual(
      [componentId(box), ...expected].sort(),
    );
  });
});

describe("buildProfileCatalog", () => {
  test("lists every built-in profile, in order, as JSON-safe data", () => {
    const catalog = buildProfileCatalog();
    expect(catalog.map((p) => p.id)).toEqual([...BUILTIN_PROFILES.keys()]);
    expect(JSON.parse(JSON.stringify(catalog))).toEqual(catalog);
  });

  test("paper-single: lengths as written, in pt and mm, and the D2 units", () => {
    expect(buildProfileCatalog().find((p) => p.id === "paper-single")).toEqual({
      id: "paper-single",
      description: "Single-column figure in a two-column paper",
      page: {
        maxWidth: { written: "88mm", pt: 249.45, mm: 88 },
        maxHeight: { written: "220mm", pt: 623.62, mm: 220 },
      },
      margin: { written: "2mm", pt: 5.67, mm: 2, d2Units: 11 },
      typography: { minFontSize: { written: "7pt", pt: 7, mm: 2.47 } },
      layout: {
        layerGap: { written: "8mm", pt: 22.68, mm: 8, d2Units: 45 },
        containerPadding: { written: "4mm", pt: 11.34, mm: 4, d2Units: 23 },
      },
    });
  });

  test("a missing page limit is null", () => {
    const entry = profileCatalogEntry(profile({ page: { maxWidth: "1in" } }));
    expect(entry.page).toEqual({ maxWidth: { written: "1in", pt: 72, mm: 25.4 }, maxHeight: null });
  });
});

describe("buildFullCatalog", () => {
  const registry = createBuiltinRegistry();

  test("has every section by default; components equal buildCatalog()", () => {
    const catalog = buildFullCatalog(registry);
    expect(Object.keys(catalog)).toEqual(["version", ...CATALOG_SECTIONS]);
    expect(catalog.version).toBe(1);
    expect(catalog.components).toEqual(buildCatalog(registry).components);
    expect(catalog.themes).toEqual(buildThemeCatalog());
    expect(catalog.profiles).toEqual(buildProfileCatalog());
  });

  test("selected sections only, in a fixed order; kind filters components", () => {
    expect(Object.keys(buildFullCatalog(registry, { sections: ["profiles", "themes"] }))).toEqual([
      "version",
      "themes",
      "profiles",
    ]);
    expect(buildFullCatalog(registry, { sections: ["components"], kind: "group" })).toEqual(
      buildCatalog(registry, { kind: "group" }),
    );
  });
});
