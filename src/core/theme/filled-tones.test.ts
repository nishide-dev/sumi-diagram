import { describe, expect, test } from "bun:test";
import { renderFigure } from "../../render";
import { checkFigure } from "../check";
import { createBuiltinRegistry } from "../registry/builtins";
import { buildCatalog } from "../registry/catalog";
import { BUILTIN_THEMES } from "./builtin";
import { lightenColor } from "./dim";
import { resolveStyle } from "./resolve";
import { TONE_NAMES } from "./tones";

/** Independent WCAG relative luminance calculation, using the resolved colors. */
function luminance(hex: string): number {
  const linear = (channel: string) => {
    const value = Number.parseInt(channel, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return (
    linear(hex.slice(1, 3)) * 0.2126 +
    linear(hex.slice(3, 5)) * 0.7152 +
    linear(hex.slice(5, 7)) * 0.0722
  );
}

const shapes = buildCatalog(createBuiltinRegistry()).components.filter((entry) =>
  entry.variants.includes("tinted"),
);

describe("solid and tinted nodes", () => {
  test("every shape, theme and tone has both variants and at least 4.5:1 text contrast", () => {
    expect(shapes).toHaveLength(12);
    for (const theme of BUILTIN_THEMES.values()) {
      for (const shape of shapes) {
        for (const variant of ["solid", "tinted"] as const) {
          for (const tone of [undefined, ...TONE_NAMES]) {
            const result = resolveStyle(theme, { kind: "node", id: shape.id, variant, tone });
            expect(result.missingVariant).toBe(false);
            expect(result.missingTone).toBe(false);
            const { fill, stroke, fontColor, strokeWidth } = result.style;
            const a = luminance(fill);
            const b = luminance(fontColor);
            expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toBeGreaterThanOrEqual(4.5);
            expect(strokeWidth.pt).toBeGreaterThan(0);
            if (variant === "solid") {
              expect(fontColor).toBe("#ffffff");
              expect(fill).toBe(theme.toneLines.get(tone ?? "gray")?.stroke ?? "");
              expect(stroke).toBe(fill);
            } else {
              expect(fill).toBe(theme.tones.get(tone ?? "gray")?.fill ?? "");
              expect(fontColor).toBe(stroke);
            }
          }
        }
      }
    }
  });

  const source = (theme: string) => `version: 1
figure:
  id: filled-tone-interactions
  theme: ${theme}
  profile: paper-double
  layout:
    arrange: { stack: { items: [normal, faded] } }
groups:
  - { id: normal, arrange: { row: { items: [cells, key, add] } } }
  - { id: faded, dim: true, arrange: { row: { items: [dimcells, dimkey, dimadd] } } }
nodes:
  - { id: cells, component: tokens, props: { cells: [{ label: A, tone: blue, variant: solid }, { label: B, tone: orange, variant: tinted }] } }
  - { id: dimcells, component: tokens, props: { variant: tinted, cells: [{ label: A, tone: blue, variant: solid }, { label: B, tone: orange }] } }
  - { id: key, component: legend, props: { entries: [{ node: { variant: solid, tone: blue }, label: solid }, { node: { variant: tinted, tone: orange }, label: tinted }] } }
  - { id: dimkey, component: legend, props: { entries: [{ node: { variant: solid, tone: blue }, label: solid }, { node: { variant: tinted, tone: orange }, label: tinted }] } }
  - { id: add, component: operator, variant: solid, tone: blue, props: { symbol: plus } }
  - { id: dimadd, component: operator, variant: solid, tone: blue, props: { symbol: plus } }
`;

  for (const theme of BUILTIN_THEMES.values()) {
    test(`${theme.id}: tokens, legends and operators share colors; dim lightens solid areas instead of erasing text`, async () => {
      const text = source(theme.id);
      const checked = checkFigure(text);
      expect(checked.state.diagnostics).toEqual([]);
      const styles = [...(checked.state.styles?.values() ?? [])];
      const solid = resolveStyle(theme, {
        kind: "node",
        id: "sumi/box",
        variant: "solid",
        tone: "blue",
      }).style;
      const tinted = resolveStyle(theme, {
        kind: "node",
        id: "sumi/box",
        variant: "tinted",
        tone: "orange",
      }).style;
      expect(
        styles.filter((s) => s.fill === solid.fill && s.fontColor === solid.fontColor).length,
      ).toBeGreaterThanOrEqual(3);
      expect(
        styles.filter((s) => s.fill === tinted.fill && s.fontColor === tinted.fontColor).length,
      ).toBeGreaterThanOrEqual(2);
      const dim = theme.dim;
      if (!dim) throw new Error("missing dim");
      const pale = lightenColor(solid.fill, dim.lighten);
      expect(pale).not.toBe(dim.fontColor);
      expect(
        styles.filter(
          (s) => s.fill === pale && s.fontColor === dim.fontColor && s.stroke === dim.stroke,
        ).length,
      ).toBeGreaterThanOrEqual(3);
      const rendered = await renderFigure(text);
      if (!rendered.ok) throw new Error(JSON.stringify(rendered.diagnostics));
      expect(rendered.diagnostics).toEqual([]);
      expect(rendered.value.svg).toContain(solid.fill);
      expect(rendered.value.svg).toContain(tinted.fontColor);
      expect(rendered.value.svg).toContain(pale);
    });
  }
});
