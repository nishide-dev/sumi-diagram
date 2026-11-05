import { expect, test } from "bun:test";
import { stringify } from "yaml";
import { compileFigure } from "../compiler/compile";
import { BUILTIN_THEMES } from "../core/theme/builtin";
import { groupFrontRect, groupLayerObstacles } from "../layout/group-layers";
import { lintGeometry } from "../lint/geometry";
import { geometryContextFor } from "../lint/geometry/lint";
import { labelCollision } from "../lint/geometry/rules";
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

test("an edge aimed through the back cards still ends on the front frame", async () => {
  const source = layeredGroupSource().replace("toAnchor: west", "toAnchor: east");
  const result = await renderFigure(source);
  if (!result.ok || !("layout" in result.value))
    throw new Error(JSON.stringify(result.diagnostics));
  const group = result.value.compiled.ir.groups[0];
  const placed = result.value.layout.groups[0];
  if (!group || !placed) throw new Error("missing group");
  const front = groupFrontRect(group, placed.rect);
  expect(result.value.layout.edges[0]?.route?.points.at(-1)?.x).toBe(front.x + front.width);
});

for (const route of [undefined, "straight"] as const) {
  for (const direction of ["east", "north"] as const) {
    test(`${direction}-bound ${route ?? "orthogonal"} edge crosses four-card decoration`, async () => {
      const source = stringify({
        version: 1,
        figure: {
          id: "leave-stack",
          layout: {
            arrange: {
              [direction === "east" ? "row" : "stack"]: {
                gap: "50pt",
                items:
                  direction === "east"
                    ? ["g", { stack: { items: ["b"] } }]
                    : [{ row: { items: ["b"] } }, "g"],
              },
            },
            align: [{ [direction === "east" ? "y" : "x"]: ["a", "b"] }],
          },
        },
        groups: [
          {
            id: "g",
            props: { layers: { count: 4, offset: "6pt" } },
            arrange: { row: { items: ["a"] } },
          },
        ],
        nodes: [
          { id: "a", component: "circle", label: "a" },
          { id: "b", component: "circle", label: "b" },
        ],
        edges: [
          {
            from: "a",
            to: "b",
            fromAnchor: direction,
            toAnchor: direction === "east" ? "west" : "south",
            ...(route && { route }),
            variant: "dashed",
          },
        ],
      });
      const result = await renderFigure(source);
      if (!result.ok || !("layout" in result.value))
        throw new Error(JSON.stringify(result.diagnostics));
      const { value } = result;
      const points = value.layout.edges[0]?.route?.points;
      const placed = value.layout.groups[0];
      const group = value.compiled.ir.groups[0];
      if (!points || !placed || !group) throw new Error("missing geometry");
      const [start, end] = points;
      if (!start || !end) throw new Error("missing endpoints");
      const front = groupFrontRect(group, placed.rect);
      // A direct departure crosses the front boundary and the rear band; no detour around the stack.
      expect(points).toHaveLength(2);
      if (direction === "east") {
        expect(points[0]?.x).toBeLessThan(front.x + front.width);
        expect(points[1]?.x).toBeGreaterThan(placed.rect.x + placed.rect.width);
        expect(start.y).toBeCloseTo(end.y, 1);
      } else {
        expect(points[0]?.y).toBeGreaterThan(front.y);
        expect(points[1]?.y).toBeLessThan(placed.rect.y);
        expect(start.x).toBeCloseTo(end.x, 1);
      }
      expect(value.svg.indexOf('class="sumi-k-g--g')).toBeLessThan(
        value.svg.indexOf('class="sumi-k-e--'),
      );
      expect(lintGeometry(value, { source }).filter((d) => d.severity !== "info")).toEqual([]);
    });
  }
}

test("Layer/Weights label reports a collision when no clear place exists inside the stack", async () => {
  const source = `version: 1
figure:
  id: label-stack
  layout: { arrange: { row: { items: [g] } } }
groups:
  - id: g
    props: { layers: { count: 4, offset: 6pt } }
    arrange: { row: { gap: 70pt, items: [a, b] } }
nodes:
  - { id: a, component: junction }
  - { id: b, component: junction }
edges:
  - { from: a, to: b, label: "Layer\\nWeights" }
`;
  const result = await renderFigure(source);
  if (!result.ok || !("layout" in result.value))
    throw new Error(JSON.stringify(result.diagnostics));
  const { value } = result;
  const placed = value.layout.groups[0];
  const group = value.compiled.ir.groups[0];
  const box = value.layout.edges[0]?.route?.label?.box;
  if (!placed || !group || !box) throw new Error("missing geometry");
  const front = groupFrontRect(group, placed.rect);
  expect(
    lintGeometry(value, { source }).filter((d) => d.code === "geometry/label-collision"),
  ).toHaveLength(1);

  // Recreate an unavoidable/externally placed collision wholly inside the footprint.
  // Both the front stroke and rear band must be checked independently of containment.
  for (const y of [front.y - 10, placed.rect.y + 4]) {
    const context = geometryContextFor(value);
    const edge = context.elements.find((element) => element.kind === "edge");
    if (!edge) throw new Error("missing edge");
    for (const label of edge.labels) {
      if (!label.box) throw new Error("missing label box");
      label.box = { ...label.box, y, height: 12 };
      label.visibleLines = [label.box];
    }
    expect(labelCollision.run(context, undefined).some((f) => f.subject?.kind === "edge")).toBe(
      true,
    );
  }
  expect(groupLayerObstacles(group, placed.rect)).toHaveLength(2);

  const roomySource = source
    .replace("gap: 70pt, items: [a, b]", "gap: 70pt, align: start, items: [a, b, tall]")
    .replace("edges:\n", "  - { id: tall, component: box, props: { height: 80pt } }\nedges:\n");
  const roomy = await renderFigure(roomySource);
  if (!roomy.ok || !("layout" in roomy.value)) throw new Error(JSON.stringify(roomy.diagnostics));
  const route = roomy.value.layout.edges[0]?.route;
  expect(route?.label?.box.y).toBeGreaterThan(route?.points[0]?.y ?? Number.POSITIVE_INFINITY);
  expect(
    lintGeometry(roomy.value, { source: roomySource }).filter(
      (d) => d.code === "geometry/label-collision",
    ),
  ).toEqual([]);
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
