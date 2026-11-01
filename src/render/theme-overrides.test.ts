import { expect, test } from "bun:test";
import { checkFigure } from "../core/check";
import { getTheme } from "../core/theme/builtin";
import { lintGeometry } from "../lint/geometry";
import { svgToEditablePptx } from "./pptx/editable";
import { readPptx } from "./pptx/testing";
import { renderFigure } from "./render";
import { paintedEdges } from "./structured";
import { attribute, childElements, descendants, parseXml } from "./xml";

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
  const text = source(
    "themeOverrides: { nodeCorners: square, edgeCorners: sharp, groupLabelWeight: regular }",
  );
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
  await renderFigure(
    source(
      "themeOverrides: { nodeCorners: square, edgeCorners: sharp, groupLabelWeight: regular }",
    ),
  );
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
  [false, false],
  [true, false],
  [false, true],
  [true, true],
])(
  "independent square nodes=%s / sharp edges=%s in SVG and editable PPTX",
  async (square, sharp) => {
    const overrides = `themeOverrides: { ${[
      ...(square ? ["nodeCorners: square"] : []),
      ...(sharp ? ["edgeCorners: sharp"] : []),
    ].join(", ")} }`;
    const text = source(overrides)
      .replace("items: [tokens]", "items: [tokens, mask, key]")
      .replace(
        "edges:\n",
        `  - id: mask
    component: matrix
    props:
      rows: [A, B]
      columns: [C, D]
      classes: { x: { tone: blue, label: Match } }
      cells: [xx, xx]
  - id: key
    component: legend
    props: { entries: [{ class: mask.x }] }
edges:
  - { from: input, to: tokens }
`,
      );
    const result = await renderFigure(text);
    if (!result.ok || !("layout" in result.value))
      throw new Error(JSON.stringify(result.diagnostics));
    const {
      svg,
      compiled: { ir },
      layout,
    } = result.value;
    expect(result.diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
    // Cover ordinary boxes/groups and expanded tokens, matrix and legend frames/cells.
    expect(ir.groups.some((g) => g.id === "mask")).toBe(true);
    expect(ir.groups.some((g) => g.id === "tokens")).toBe(true);
    expect(
      ir.nodes.filter((n) => n.id.startsWith("mask-") && n.component === "sumi/box"),
    ).toHaveLength(4);
    expect(
      ir.nodes.filter((n) => n.id.startsWith("tokens-") && n.component === "sumi/box"),
    ).toHaveLength(3);
    expect(ir.groups.some((g) => g.component === "sumi/legend")).toBe(true);
    for (const element of [...ir.groups, ...ir.nodes]) {
      if (square) expect(element.style.radius.units).toBe(0);
    }
    expect(ir.nodes.find((n) => n.id === "input")?.style.radius.pt).toBe(square ? 0 : 2);
    expect(ir.groups.find((g) => g.id === "panel")?.style.radius.pt).toBe(square ? 0 : 6);
    expect([...paintedEdges(ir, layout).values()].some((e) => e.arcs.length > 0)).toBe(!sharp);
    expect(svg).toContain(
      sharp
        ? 'stroke-linecap="butt" stroke-linejoin="miter"'
        : 'stroke-linecap="round" stroke-linejoin="round"',
    );
    for (const connectors of ["freeform", "glued"] as const) {
      const exported = svgToEditablePptx(svg, ir, { connectors });
      if (!exported.ok) throw new Error(JSON.stringify(exported.diagnostics));
      const parts = readPptx(exported.value);
      expect([...parts.keys()].some((p) => p.startsWith("ppt/media/"))).toBe(false);
      const parsed = parseXml(new TextDecoder().decode(parts.get("ppt/slides/slide1.xml")));
      if (!parsed.ok) throw new Error(parsed.message);
      const frames = new Set<string>();
      const wires = new Set<string>();
      for (const shape of descendants(parsed.root)) {
        if (!["p:sp", "p:cxnSp"].includes(shape.name)) continue;
        const all = [...descendants(shape)];
        const name = all.find((e) => e.name === "p:cNvPr");
        const element =
          name && [...ir.elements.values()].find((e) => e.key === attribute(name, "name"));
        if (!element) continue;
        const line = all.find((e) => e.name === "a:ln");
        if (!line || childElements(line).some((e) => e.name === "a:noFill")) continue;
        const edge = element.kind === "edge";
        const miter = edge ? sharp : square;
        expect(attribute(line, "cap")).toBe(miter ? "flat" : "rnd");
        expect(childElements(line).some((e) => e.name === "a:miter")).toBe(miter);
        expect(childElements(line).some((e) => e.name === "a:round")).toBe(!miter);
        if (edge) {
          wires.add(element.key);
          expect(shape.name).toBe(connectors === "glued" ? "p:cxnSp" : "p:sp");
        } else frames.add(element.key);
      }
      for (const element of [...ir.groups, ...ir.nodes]) {
        if (
          element.style.strokeWidth.units > 0 &&
          (element.kind === "group" || element.component === "sumi/box")
        )
          expect(frames.has(element.key)).toBe(true);
      }
      expect(wires).toEqual(new Set(ir.edges.map((edge) => edge.key)));
    }
  },
);

test.each([
  ["{ nodeCorners: rounded }", "nodeCorners", "rounded", "schema/invalid-value"],
  ["{ edgeCorners: square }", "edgeCorners", "square", "schema/invalid-value"],
  ["{ edgeCorners: false }", "edgeCorners", "false", "schema/invalid-value"],
  ["{ corners: square }", "corners", "corners", "schema/unknown-field"],
  ["{ groupLabelWeight: light }", "groupLabelWeight", "light", "schema/invalid-value"],
  ["{ nodeCorners: 0 }", "nodeCorners", "0", "schema/invalid-value"],
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
