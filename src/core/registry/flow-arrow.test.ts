import { expect, test } from "bun:test";
import { compileFigure } from "../../compiler/compile";
import { lintFigure } from "../../lint/lint";
import { checkFigure } from "../check";
import { BUILTIN_THEMES } from "../theme/builtin";
import { builtinRegistry, FLOW_ARROW_IDS } from "./builtins";
import { buildCatalog } from "./catalog";

const NAMES = ["block-arrow", "triangle-arrow", "chevron"];

const figure = (node: string, layout = "arrange: { row: { items: [a, ar, b] } }") => `version: 1
figure: { id: f, theme: color, layout: { ${layout} } }
nodes:
  - { id: a, component: box, label: A }
  - { id: ar, component: block-arrow${node} }
  - { id: b, component: box, label: B }
`;

const codes = (source: string) =>
  checkFigure(source).state.diagnostics.map((d) => [d.code, d.path?.join(".")]);

test("manifests, catalog and defaults describe the public flow-marker components (#426)", () => {
  const catalog = buildCatalog(builtinRegistry()).components;
  expect(FLOW_ARROW_IDS).toEqual(NAMES.map((n) => `sumi/${n}`));
  for (const name of NAMES) {
    const resolved = builtinRegistry().resolve(name, "node");
    if (!resolved.ok) throw new Error(JSON.stringify(resolved.diagnostics));
    expect(resolved.value).toMatchObject({
      kind: "node",
      since: "0.16.0",
      engines: ["structured"],
      variants: ["default", "muted", "outlined"],
      render: { type: "outline", renderer: "sumi/flow-arrow" },
    });
    const entry = catalog.find((e) => e.id === `sumi/${name}`);
    expect(Object.keys(entry?.props.properties ?? {}).sort()).toEqual(
      {
        "block-arrow": ["direction", "head", "length", "shaft", "thickness"],
        "triangle-arrow": ["direction", "length", "thickness"],
        chevron: ["direction", "head", "length", "thickness"],
      }[name as "chevron"],
    );
    for (const props of [{ direction: "north" }, { length: 24 }, { label: "x" }])
      expect(builtinRegistry().validateUsage(resolved.value, { props }).ok).toBe(false);
    expect(
      builtinRegistry().validateUsage(resolved.value, {
        props: { direction: "down", length: "24pt", thickness: "12pt" },
      }),
    ).toMatchObject({ ok: true });
  }
  const block = builtinRegistry().resolve("block-arrow", "node");
  if (!block.ok) throw new Error("missing block-arrow");
  for (const props of [{ head: 0 }, { head: 2 }, { shaft: 1 }])
    expect(builtinRegistry().validateUsage(block.value, { props }).ok).toBe(false);
});

test("a flow arrow takes no label, label turn, sublabel, badge, glyphs or weight, and only the structured engine draws it", () => {
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
  expect(codes(figure(", grow: 1"))).toContainEqual(["component/grow-unsupported", "nodes.1.grow"]);
  expect(codes(figure("", "direction: right"))).toContainEqual([
    "layout/structured-only",
    "nodes.1.component",
  ]);
  for (const name of NAMES) expect(codes(figure("").replace("block-arrow", name))).toEqual([]);
});

test("a flow arrow is a marker, not an edge endpoint", () => {
  for (const edge of ["{ from: a, to: ar }", "{ from: ar, to: b }"])
    expect(codes(`${figure("")}edges:\n  - ${edge}\n`)).toEqual([
      ["component/flow-arrow-connection", "nodes.1.component"],
    ]);
  expect(codes(`${figure("")}edges:\n  - { from: a, to: b }\n`)).toEqual([]);
});

test("a flow arrow has no empty-label finding", () => {
  const report = lintFigure(figure(", props: { direction: up }"));
  expect(report.diagnostics.map((d) => d.code)).not.toContain("lint/empty-label");
});

test("the arrow is sized from the theme's text size, and explicit lengths are D2 units", () => {
  for (const [theme, em] of [
    ["academic", 16],
    ["slides", 32],
  ] as const) {
    const result = compileFigure(
      figure(", props: { direction: up, length: 30pt, thickness: 12pt, head: 0.4 }").replace(
        "theme: color",
        `theme: ${theme}`,
      ),
    );
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const node = result.value.ir.nodes.find((n) => n.id === "ar");
    expect(node?.render?.params).toMatchObject({
      form: "block",
      direction: "up",
      em,
      length: 60,
      thickness: 24,
      head: 0.4,
    });
  }
});

test("every theme resolves every variant and tone without fallback: ink by default, no outline, gray when muted", () => {
  for (const [theme, definition] of BUILTIN_THEMES)
    for (const name of NAMES)
      for (const variant of ["default", "muted", "outlined"])
        for (const tone of [undefined, "blue"]) {
          const result = compileFigure(
            figure(`, variant: ${variant}${tone ? `, tone: ${tone}` : ""}`)
              .replace("theme: color", `theme: ${theme}`)
              .replace("block-arrow", name),
          );
          if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
          expect(result.diagnostics).toEqual([]);
          const style = result.value.ir.nodes.find((n) => n.id === "ar")?.style;
          if (style === undefined) throw new Error("missing arrow");
          if (variant === "outlined") {
            expect(style.strokeWidth.pt).toBeGreaterThan(0);
            expect(style.fill).toBe(definition.canvas);
          } else {
            expect(style.strokeWidth.pt).toBe(0);
            expect(style.stroke).toBe(style.fill);
          }
          if (variant === "default" && tone === undefined)
            // The ink is the text color, so it reads against the page.
            expect(style.fill).toBe(style.fontColor);
        }
});
