import { expect, test } from "bun:test";
import { lintFigure } from "../../lint/lint";
import { checkFigure } from "../check";
import { createBuiltinRegistry } from "./builtins";
import { buildCatalog } from "./catalog";

const registry = createBuiltinRegistry();

const figure = (node: string, layout = "arrange: { row: { items: [a, br] } }") => `version: 1
figure: { id: f, theme: color, layout: { ${layout} } }
nodes:
  - { id: a, component: box, label: A }
  - { id: br, component: bracket${node} }
`;

const codes = (source: string) =>
  checkFigure(source).state.diagnostics.map((d) => [d.code, d.path?.join(".")]);

test("bracket: manifest, catalog and defaults describe the public component (#281)", () => {
  const resolved = registry.resolve("bracket", "node");
  if (!resolved.ok) throw new Error(JSON.stringify(resolved.diagnostics));
  expect(registry.resolve("sumi/bracket", "node")).toEqual(resolved);
  expect(resolved.value).toMatchObject({
    kind: "node",
    shape: "rectangle",
    since: "0.10.0",
    engines: ["structured"],
    variants: ["default", "emphasis", "muted", "outlined"],
    render: {
      type: "outline",
      renderer: "sumi/bracket",
      params: { form: "square", points: "east" },
    },
  });
  const entry = buildCatalog(registry).components.find((e) => e.id === "sumi/bracket");
  expect(Object.keys(entry?.props.properties ?? {}).sort()).toEqual([
    "form",
    "height",
    "points",
    "width",
  ]);
  for (const props of [{ form: "round" }, { points: "up" }, { label: "x" }]) {
    expect(registry.validateUsage(resolved.value, { props }).ok).toBe(false);
  }
  expect(
    registry.validateUsage(resolved.value, {
      props: { form: "curly", points: "west", width: "8pt", height: "40pt" },
    }),
  ).toMatchObject({ ok: true });
});

test("a bracket takes no label, label turn, sublabel or badge, and only the structured engine draws it", () => {
  expect(codes(figure(", label: x"))).toEqual([["component/unexpected-label", "nodes.1.label"]]);
  expect(codes(figure(", labelRotation: 90"))).toEqual([
    ["component/label-rotation-unsupported", "nodes.1.labelRotation"],
  ]);
  expect(codes(figure(", sublabel: s"))).toEqual([
    ["component/sublabel-unsupported", "nodes.1.sublabel"],
  ]);
  expect(codes(figure(", badge: { icon: emoji/fire, corner: north-east }"))).toEqual([
    ["component/badge-unsupported", "nodes.1.badge"],
  ]);
  expect(codes(figure("", "direction: right"))).toContainEqual([
    "layout/structured-only",
    "nodes.1.component",
  ]);
  expect(codes(figure(", props: { form: curly, points: south }"))).toEqual([]);
});

test("a bracket has no empty-label finding (#281)", () => {
  const report = lintFigure(
    figure(", attach: { to: a, side: east }", "arrange: { row: { items: [a] } }"),
  );
  expect(report.diagnostics.map((d) => d.code)).not.toContain("lint/empty-label");
});
