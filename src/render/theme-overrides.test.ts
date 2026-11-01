import { expect, test } from "bun:test";
import { checkFigure } from "../core/check";
import { getTheme } from "../core/theme/builtin";
import { DEFAULT_FONT_SET_ID, getFontSet } from "../core/theme/fonts";
import { lintGeometry } from "../lint/geometry";
import { svgToPdf } from "./pdf";
import { parsePdf } from "./pdf/testing";
import { svgToPptx } from "./pptx";
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

test("figure color refinements reach expanded solids, preserve other variants, and respect dimming", async () => {
  const text = `version: 1
figure:
  id: palette
  theme: paper
  themeOverrides:
    edgeCorners: sharp
    solidFills: { blue: '#3d9df5', orange: '#e8a20c', red: '#e04848' }
    dashedGroupStroke: '#527da5'
  layout: { arrange: { stack: { items: [panel, regular] } } }
groups:
  - id: panel
    variant: dashed
    tone: gray
    arrange: { row: { items: [tokens, outline] } }
nodes:
  - { id: tokens, component: tokens, props: { variant: solid, cells: [{tone: blue}, {tone: orange}, {tone: red}] } }
  - { id: outline, component: box, variant: outlined, tone: blue, label: Outline }
  - { id: regular, component: box, variant: solid, tone: blue, label: Readable }
`;
  const result = await renderFigure(text);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const ir = result.value.compiled.ir;
  expect(ir.groups.find((g) => g.id === "panel")?.style).toMatchObject({
    stroke: "#527da5",
    fill: "#dcdee6",
    radius: { pt: 6 },
  });
  const cells = ir.nodes.filter((node) => node.tokens !== undefined);
  expect(cells.map((node) => node.style.fill)).toEqual(["#3d9df5", "#e8a20c", "#e04848"]);
  expect(ir.nodes.find((node) => node.id === "outline")?.style.stroke).toBe("#2f62b0");
  const regular = ir.nodes.find((node) => node.id === "regular");
  expect(regular?.style.fill).toBe("#3d9df5");
  expect(regular?.style.fontColor).not.toBe("#ffffff");
  const dim = await renderFigure(text.replace("variant: dashed", "variant: dashed\n    dim: true"));
  if (!dim.ok) throw new Error(JSON.stringify(dim.diagnostics));
  expect(dim.value.compiled.ir.groups[0]?.style.stroke).toBe("#949494");
  expect(
    dim.value.compiled.ir.nodes
      .filter((node) => node.tokens !== undefined)
      .every((node) => node.style.fill !== "#3d9df5"),
  ).toBe(true);
  // Refinements do not mutate the selected built-in theme.
  expect(getTheme("paper")?.toneLines.get("blue")?.stroke).toBe("#2f62b0");
});

function pdfStreams(svg: string): string {
  const fontSet = getFontSet(DEFAULT_FONT_SET_ID);
  if (!fontSet) throw new Error("Missing default font set");
  const pdf = svgToPdf(svg, { fontSet });
  if (!pdf.ok) throw new Error(JSON.stringify(pdf.diagnostics));
  return [...parsePdf(pdf.value).objects.values()]
    .filter((object) => object.stream !== undefined)
    .map((object) => new TextDecoder().decode(object.stream))
    .join("\n");
}

test.each([
  "{ solidFills: { cyan: '#123456' } }",
  "{ solidFills: { blue: red } }",
  "{ solidFills: { red: '#abc' } }",
  "{ dashedGroupStroke: 'url(other.svg)' }",
])("rejects invalid figure palette refinements: %s", (overrides) => {
  const diagnostics = checkFigure(source(`themeOverrides: ${overrides}`)).state.diagnostics;
  expect(
    diagnostics.some((d) => d.severity === "error" && d.path?.includes("themeOverrides")),
  ).toBe(true);
});

test("sharp routed elbows remain connected in SVG and PDF after trunk deduplication", async () => {
  const result = await renderFigure(
    source("themeOverrides: { edgeCorners: sharp }").replace(
      "edges:\n",
      "edges:\n  - { from: input, to: tokens }\n",
    ),
  );
  if (!result.ok || !("layout" in result.value))
    throw new Error(JSON.stringify(result.diagnostics));
  const { svg, layout } = result.value;
  expect(layout.edges.some((edge) => (edge.route?.points.length ?? 0) > 2)).toBe(true);
  const wires = [...svg.matchAll(/<path class="sumi-wire"[^>]*>/g)].map((m) => m[0]);
  const elbow = wires.find((wire) => /d="M [^ML"]+ L [^ML"]+ L /.test(wire));
  expect(elbow).toBeDefined();
  expect(elbow).toContain('stroke-linejoin="miter"');
  // Test the actual writer's wire alone so frame joins cannot satisfy PDF assertions.
  const wireSvg = svg.replace(/(<svg[^>]*>)[\s\S]*(<\/svg>)/, `$1${elbow}$2`);
  const streams = pdfStreams(wireSvg);
  // PDF defaults are butt/miter; the serializer may omit explicit zero operators.
  expect(streams).not.toMatch(/[12] [Jj]/);
  // Require a stroked polyline, not the page's rectangular clipping path.
  expect(streams).toMatch(
    /[-\d.]+ [-\d.]+ m\s+[-\d.]+ [-\d.]+ l\s+[-\d.]+ [-\d.]+ l(?:\s+[-\d.]+ [-\d.]+ l)*\s+S/,
  );
});

test.each([false, true])(
  "zoom wires honour sharp=%s in SVG, PDF and picture PPTX",
  async (sharp) => {
    const result = await renderFigure(`version: 1
figure:
  id: zoom-corners
  theme: paper
  ${sharp ? "themeOverrides: { edgeCorners: sharp }" : ""}
  layout: { arrange: { row: { gap: 40pt, items: [a, b] } } }
nodes:
  - { id: a, component: box, label: A }
  - { id: b, component: box, label: B }
edges:
  - { from: a, to: b, component: zoom }
`);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const { svg } = result.value;
    const wire = /<path class="sumi-wire"[^>]*>/.exec(svg)?.[0];
    expect(wire).toBeDefined();
    expect(wire).toContain("stroke-dasharray");
    expect(wire).toContain(`stroke-linecap="${sharp ? "butt" : "round"}"`);
    expect(wire).toContain(`stroke-linejoin="${sharp ? "miter" : "round"}"`);
    const wireSvg = svg.replace(/(<svg[^>]*>)[\s\S]*(<\/svg>)/, `$1${wire}$2`);
    if (sharp) expect(pdfStreams(wireSvg)).not.toMatch(/[12] [Jj]/);
    else expect(pdfStreams(wireSvg)).toMatch(/1 J\s+1 j/);
    const picture = svgToPptx(svg);
    if (!picture.ok) throw new Error(JSON.stringify(picture.diagnostics));
    const media = [...readPptx(picture.value)]
      .filter(([path]) => path.startsWith("ppt/media/") && path.endsWith(".svg"))
      .map(([, bytes]) => new TextDecoder().decode(bytes));
    expect(media).toHaveLength(1);
    const mediaWire = /<path[^>]*stroke-dasharray="[^"]+"[^>]*>/.exec(media[0] ?? "")?.[0];
    expect(mediaWire).toBeDefined();
    // Outlined SVG omits attributes with SVG's default butt/miter values.
    expect(/stroke-linecap="([^"]+)"/.exec(mediaWire ?? "")?.[1] ?? "butt").toBe(
      sharp ? "butt" : "round",
    );
    expect(/stroke-linejoin="([^"]+)"/.exec(mediaWire ?? "")?.[1] ?? "miter").toBe(
      sharp ? "miter" : "round",
    );
  },
);

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
