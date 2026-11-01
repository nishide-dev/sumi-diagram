import { expect, test } from "bun:test";
import { checkFigure } from "../core/check";
import { getTheme } from "../core/theme/builtin";
import { lintGeometry } from "../lint/geometry";
import { renderFigure } from "./render";
import { paintedEdges } from "./structured";

const source = (overrides = "") => `version: 1
figure:
  id: comb
  theme: paper
  ${overrides}
  layout: { density: compact, arrange: { stack: { items: [panel] } } }
groups:
  - id: panel
    label: Panel
    arrange: { stack: { items: [tokens] } }
nodes:
  - { id: tokens, component: tokens, props: { gap: 0, width: 24pt, height: 20pt, cells: [A, B, C] } }
  - { id: j1, component: junction, variant: hidden, attach: { to: tokens.1, side: north, gap: 16pt } }
  - { id: j2, component: junction, variant: hidden, attach: { to: tokens.2, side: north, gap: 16pt } }
  - { id: j3, component: junction, variant: hidden, attach: { to: tokens.3, side: north, gap: 16pt } }
  - { id: input, component: box, label: Input, attach: { to: j1, side: west, gap: 20pt } }
edges:
  - { from: input, to: j1, component: line }
  - { from: j1, to: j2, component: line }
  - { from: j2, to: j3, component: line }
  - { from: j1, to: tokens.1, toAnchor: north }
  - { from: j2, to: tokens.2, toAnchor: north }
  - { from: j3, to: tokens.3, toAnchor: north }
`;

test("square theme override preserves a continuous comb, sharp T joins and identical arrowheads", async () => {
  const text = source("themeOverrides: { corners: square, groupLabelWeight: regular }");
  const result = await renderFigure(text);
  if (!result.ok || !("layout" in result.value))
    throw new Error(JSON.stringify(result.diagnostics));
  const rendered = result.value;
  expect(result.diagnostics).toEqual([]);
  expect(
    lintGeometry(rendered, { source: text }).filter((diagnostic) => diagnostic.severity !== "info"),
  ).toEqual([]);
  const { ir } = rendered.compiled;
  expect(ir.groups[0]?.style).toMatchObject({ radius: { pt: 0, units: 0 }, bold: false });
  for (const node of ir.nodes) expect(node.style.radius.units).toBe(0);
  const painted = paintedEdges(ir, rendered.layout);
  expect([...painted.values()].every((edge) => edge.arcs.length === 0)).toBe(true);
  const ends = rendered.layout.edges.slice(3).map((edge) => edge.route?.points);
  expect(ends.every((points) => points?.length === 2 && points[0]?.x === points[1]?.x)).toBe(true);
  expect(ends.map((points) => (points?.[1]?.y ?? 0) - (points?.[0]?.y ?? 0))).toEqual([
    32.5, 32.5, 32.5,
  ]);
  const trunk = rendered.layout.edges.slice(0, 3).flatMap((edge) => edge.route?.points ?? []);
  expect(new Set(trunk.map((point) => point.y)).size).toBe(1);
  expect(rendered.svg).toContain('stroke-linecap="butt" stroke-linejoin="miter"');
});

test("overrides are isolated: omitted settings keep built-in styles and rounding", async () => {
  const theme = getTheme("paper");
  const before = JSON.stringify(theme);
  await renderFigure(source("themeOverrides: { corners: square, groupLabelWeight: regular }"));
  const result = await renderFigure(source());
  if (!result.ok || !("layout" in result.value))
    throw new Error(JSON.stringify(result.diagnostics));
  expect(result.value.compiled.ir.meta.themeOverrides).toBeUndefined();
  expect(result.value.compiled.ir.groups[0]?.style).toMatchObject({
    bold: true,
    radius: { pt: 6 },
  });
  expect(result.value.compiled.ir.nodes.find((node) => node.id === "input")?.style.radius.pt).toBe(
    2,
  );
  expect(
    [...paintedEdges(result.value.compiled.ir, result.value.layout).values()].some(
      (edge) => edge.arcs.length > 0,
    ),
  ).toBe(true);
  expect(JSON.stringify(theme)).toBe(before);
});

test.each([
  ["{ corners: rounded }", "corners", "rounded", "schema/invalid-value"],
  ["{ groupLabelWeight: light }", "groupLabelWeight", "light", "schema/invalid-value"],
  ["{ corners: 0 }", "corners", "0", "schema/invalid-value"],
  ["{ groupLabelWeight: false }", "groupLabelWeight", "false", "schema/invalid-value"],
  ["{ color: red }", "color", "color", "schema/unknown-field"],
])("theme override schema locates rejected %s", (overrides, field, token, code) => {
  const text = source(`themeOverrides: ${overrides}`);
  const diagnostics = checkFigure(text).state.diagnostics;
  expect(diagnostics).toHaveLength(1);
  const column = (text.split("\n")[4]?.indexOf(token) ?? -1) + 1;
  expect(column).toBeGreaterThan(0);
  expect(diagnostics[0]).toMatchObject({
    code,
    severity: "error",
    path: ["figure", "themeOverrides", field],
    location: { line: 5, column, endLine: 5, endColumn: column + token.length },
  });
});
