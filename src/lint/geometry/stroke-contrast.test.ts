import { expect, test } from "bun:test";
import { PALETTE_NAMES } from "../../core/theme/palette";
import { geometryContextFor } from "./lint";
import { strokeContrast } from "./stroke-contrast";
import { compile, inspection, lintSpec } from "./testing";

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

test("warns on an outlined yellow frame inside a filled palette group", () => {
  const compiled = compile(`version: 1
figure: { id: frame, theme: llama, themeOverrides: { palette: cool-blue } }
groups: [{ id: panel, variant: filled }]
nodes: [{ id: frame, component: box, group: panel, variant: outlined, tone: yellow }]
`);
  const findings = lintSpec(
    compiled,
    {
      elements: {
        "g:panel": { bbox: { x: 0, y: 0, width: 200, height: 100 } },
        "n:frame": { bbox: { x: 30, y: 20, width: 120, height: 60 } },
      },
    },
    { code: "geometry/low-stroke-contrast" },
  );
  expect(findings).toHaveLength(1);
  expect(findings[0]?.message).toContain("#acc0dc");
});

test("edges use set fills in paint order, including on the canvas", () => {
  const compiled =
    compile(`${source("cool-blue").replace("theme: llama,", "theme: llama, layout: { arrange: { row: { items: [panel] } } },").replace("variant: filled }", "variant: filled, arrange: { row: { items: [a, b] } } }")}
sets: [{ id: s, members: [a, b], tone: blue }]
`);
  const inspected = inspection(compiled, {
    elements: {
      "g:panel": { bbox: { x: 0, y: 0, width: 200, height: 100 } },
      "e:e": {
        path: [
          { x: 20, y: 50 },
          { x: 180, y: 50 },
        ],
      },
    },
  });
  const base = geometryContextFor({ compiled, inspection: inspected });
  const set = compiled.ir.sets?.[0];
  if (!set) throw new Error("missing set");
  const geometry = {
    id: "s",
    bbox: { x: 0, y: 0, width: 200, height: 100 },
    region: {
      kind: "polygon" as const,
      points: [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
        { x: 200, y: 100 },
        { x: 0, y: 100 },
      ],
    },
    labels: [],
  };
  for (const [fill, group, warnings] of [
    ["#ffffff", true, 0],
    ["#acc0dc", true, 1],
    ["#acc0dc", false, 1],
  ] as const) {
    const context = {
      ...base,
      elements: group ? base.elements : base.elements.filter((e) => e.kind !== "group"),
      sets: [
        {
          ir: { ...set, style: { ...set.style, fill } },
          geometry,
          name: 'set "s"',
          docPath: [],
          subject: { kind: "set" as const, id: "s" },
          labels: [],
        },
      ],
    };
    expect(strokeContrast.run(context, undefined), fill).toHaveLength(warnings);
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
