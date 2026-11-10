import { expect, test } from "bun:test";
import { PALETTE_NAMES } from "../../core/theme/palette";
import { compile, lintSpec } from "./testing";

const source = (palette: string, variant = "filled") => `version: 1
figure: { id: contrast, theme: llama, themeOverrides: { palette: ${palette} } }
groups: [{ id: panel, variant: ${variant} }]
nodes:
  - { id: a, component: box, group: panel }
  - { id: b, component: box, group: panel }
edges: [{ id: e, from: a, to: b, tone: yellow }]
`;

test("warns for yellow edges on resolved llama palette filled panels", () => {
  for (const palette of PALETTE_NAMES) {
    const compiled = compile(source(palette));
    const panel = compiled.ir.elements.get("g:panel");
    expect(panel?.style.fill).not.toBe("transparent");
    const diagnostics = lintSpec(
      compiled,
      {
        elements: {
          "g:panel": { bbox: { x: 0, y: 0, width: 200, height: 100 } },
          "e:e": {
            path: [
              { x: 20, y: 50 },
              { x: 180, y: 50 },
            ],
          },
        },
      },
      { code: "geometry/low-stroke-contrast" },
    );
    expect(diagnostics, palette).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain(panel?.style.fill ?? "missing");
    expect(diagnostics[0]?.hint).toContain("lighter panel");
  }
});

test("does not warn for a route outside the panel or on the default panel", () => {
  for (const [variant, y] of [
    ["filled", 150],
    ["default", 50],
  ] as const) {
    const compiled = compile(source("cool-blue", variant));
    expect(
      lintSpec(
        compiled,
        {
          elements: {
            "g:panel": { bbox: { x: 0, y: 0, width: 200, height: 100 } },
            "e:e": {
              path: [
                { x: 20, y },
                { x: 180, y },
              ],
            },
          },
        },
        { code: "geometry/low-stroke-contrast" },
      ),
    ).toEqual([]);
  }
});
