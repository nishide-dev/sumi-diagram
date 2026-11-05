import { expect, test } from "bun:test";
import { stringify } from "yaml";
import { compileFigure } from "../compiler/compile";
import { BUILTIN_THEMES } from "../core/theme/builtin";
import { groupFrontRect } from "../layout/group-layers";
import { lintGeometry } from "../lint/geometry";
import { svgToPdf } from "./pdf";
import { svgToEditablePptx, svgToPptx } from "./pptx";
import { renderFigure } from "./render";

function layeredGroupSource(
  theme = "minimal",
  variant = "default",
  layers: unknown = { count: 4, offset: "3pt" },
) {
  return stringify({
    version: 1,
    figure: {
      id: "group-layers",
      theme,
      layout: { arrange: { row: { gap: "12pt", items: ["input", "panel"] } } },
    },
    groups: [
      {
        id: "panel",
        variant,
        label: "$C$",
        labelAt: "top-left",
        caption: "(a) input features",
        ...(layers === null ? {} : { props: { layers } }),
        arrange: { row: { items: ["a", "b"] } },
      },
    ],
    nodes: [
      { id: "input", component: "box", label: "Input" },
      { id: "a", component: "circle", label: "a" },
      { id: "b", component: "circle", label: "b" },
    ],
    edges: [
      { from: "input", to: "panel", toAnchor: "west" },
      { from: "a", to: "b" },
    ],
  });
}

for (const theme of BUILTIN_THEMES.keys()) {
  for (const variant of ["default", "muted", "filled", "dashed"]) {
    test(`${theme}/${variant}: four frames, front title, whole footprint caption and front endpoint`, async () => {
      const rendered = await renderFigure(layeredGroupSource(theme, variant));
      if (!rendered.ok) throw new Error(JSON.stringify(rendered.diagnostics));
      expect(rendered.diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
      const value = rendered.value;
      if (!("layout" in value)) throw new Error("expected structured layout");
      const placed = value.layout.groups[0];
      const group = value.compiled.ir.groups[0];
      if (!placed || !group || !placed.label) throw new Error("missing group");
      const front = groupFrontRect(group, placed.rect);
      expect(front.y - placed.rect.y).toBe(18);
      expect(placed.rect.width - front.width).toBe(18);
      expect(placed.content.y).toBeGreaterThan(front.y);
      expect(placed.label.box.x - front.x).toBe(16);
      expect(placed.label.box.y).toBeGreaterThan(front.y);
      expect(placed.label.runs?.flat().some((r) => r.font === "math-italic")).toBe(true);
      const caption = value.layout.nodes.find((n) => n.key === "n:panel-caption");
      expect(caption?.label?.anchor.x).toBeCloseTo(placed.rect.x + placed.rect.width / 2, 3);
      expect(caption?.rect.y).toBeCloseTo(placed.rect.y + placed.rect.height + 8, 3);
      const end = value.layout.edges[0]?.route?.points.at(-1);
      expect(end?.x).toBe(front.x);
      expect(end?.y).toBeCloseTo(front.y + front.height / 2, 3);
      const inspected = value.inspection.elements.find((e) => e.key === "g:panel");
      for (const field of ["x", "y", "width", "height"] as const)
        expect(inspected?.bbox?.[field]).toBeCloseTo(placed.rect[field], 6);
      expect(
        lintGeometry(value, { source: layeredGroupSource(theme, variant) }).filter(
          (d) => d.severity !== "info",
        ),
      ).toEqual([]);
      const markup = value.svg.match(/<g class="sumi-k-g--panel[\s\S]*?<\/g>/)?.[0] ?? "";
      expect((markup.match(/<rect /g) ?? []).length).toBe(4);
      expect(svgToPdf(value.svg).ok).toBe(true);
      expect(svgToPptx(value.svg).ok).toBe(true);
      const editable = svgToEditablePptx(value.svg, value.compiled.ir);
      expect(editable.ok).toBe(false);
      expect(editable.diagnostics[0]?.code).toBe("pptx/unsupported-geometry");
      expect(editable.diagnostics[0]?.path).toEqual(["groups", 0, "props", "layers"]);
    });
  }
}

test("count 1 keeps the unlayered SVG byte-identical", async () => {
  const source = layeredGroupSource("minimal", "default", null);
  const ordinary = await renderFigure(source);
  const single = await renderFigure(
    layeredGroupSource("minimal", "default", { count: 1, offset: "3pt" }),
  );
  if (!ordinary.ok || !single.ok) throw new Error("render failed");
  expect(ordinary.value.compiled.ir.groups[0]?.layers).toBeUndefined();
  // Source hash and CSS namespace identify the source, not the drawing.
  const drawing = (svg: string) =>
    svg.replace(/<metadata>[\s\S]*?<\/metadata>/, "").replace(/sumi-\d+/g, "sumi-test");
  expect(drawing(single.value.svg)).toBe(drawing(ordinary.value.svg));
});

test("group layers validate count, offset and unknown fields like image layers", () => {
  for (const layers of [
    { count: 0, offset: "3pt" },
    { count: 17, offset: "3pt" },
    { count: 1.5, offset: "3pt" },
    { count: 4, offset: "0pt" },
    { count: 4, offset: "0.3pt" },
    { count: 4, offset: 3 },
    { count: 4 },
    { count: 4, offset: "3pt", extra: 1 },
  ]) {
    const result = compileFigure(layeredGroupSource("minimal", "default", layers));
    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.some((d) => d.code.startsWith("component/") && d.path?.includes("layers")),
    ).toBe(true);
  }
});

test("plain and auto groups clearly reject layers", () => {
  const plain = compileFigure(layeredGroupSource("minimal", "plain"));
  expect(plain.diagnostics.some((d) => d.code === "component/invalid-prop")).toBe(true);
  const auto = compileFigure(
    "version: 1\nfigure: { id: auto }\ngroups: [{ id: g, props: { layers: { count: 4, offset: 3pt } } }]\nnodes: [{ id: a, component: box, group: g }]\n",
  );
  expect(auto.diagnostics.some((d) => d.code === "layout/structured-only")).toBe(true);
});

test("an edge aimed through the back cards fails clearly instead of ending on them", async () => {
  const source = layeredGroupSource().replace("toAnchor: west", "toAnchor: east");
  const result = await renderFigure(source);
  expect(result.ok).toBe(false);
  expect(result.diagnostics.some((d) => d.code === "layout/no-route")).toBe(true);
});

test("nested layered groups reserve their stack without moving the title into the rear band", async () => {
  const source = stringify({
    version: 1,
    figure: { id: "nested-layers", layout: { arrange: { row: { items: ["outer"] } } } },
    groups: [
      {
        id: "outer",
        label: "Outer",
        props: { layers: { count: 4, offset: "3pt" } },
        arrange: { row: { items: ["inner"] } },
      },
      {
        id: "inner",
        label: "$F$",
        labelAt: "top-left",
        caption: "Features",
        props: { layers: { count: 3, offset: "2pt" } },
        arrange: { row: { items: ["a"] } },
      },
    ],
    nodes: [{ id: "a", component: "circle", label: "a" }],
  });
  const result = await renderFigure(source);
  if (!result.ok || !("layout" in result.value))
    throw new Error(JSON.stringify(result.diagnostics));
  const [outer, inner] = result.value.layout.groups;
  if (!outer || !inner) throw new Error("missing nested groups");
  expect(inner.rect.y).toBeGreaterThan(outer.content.y - 0.001);
  expect(inner.rect.x + inner.rect.width).toBeLessThanOrEqual(
    outer.content.x + outer.content.width,
  );
  expect(lintGeometry(result.value, { source }).filter((d) => d.severity !== "info")).toEqual([]);
});
