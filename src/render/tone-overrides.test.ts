import { expect, test } from "bun:test";
import { checkFigure } from "../core/check";
import { getTheme } from "../core/theme/builtin";
import { contrastRatio, readableInk } from "../core/theme/node-variants";
import { renderFigure } from "./render";

const BLUE = { fill: "#dfe1ea", line: "#5f6a95" };

const figure = (overrides: string, body: string) => `version: 1
figure:
  id: tones
  theme: paper
  themeOverrides: ${overrides}
  layout: { arrange: { stack: { items: [panel] } } }
${body}`;

const toned = `groups:
  - id: panel
    arrange: { row: { items: [plain, tinted, outlined, solid, auto, mask, key] } }
nodes:
  - { id: plain, component: box, tone: blue, label: Plain }
  - { id: tinted, component: box, variant: tinted, tone: blue, label: Tinted }
  - { id: outlined, component: box, variant: outlined, tone: blue, label: '$\\textcolor{blue}{\\text{Outlined}}$' }
  - { id: solid, component: box, variant: solid, tone: blue, label: Solid }
  - { id: auto, component: box, variant: tinted, tone: orange, label: Auto }
  - id: mask
    component: matrix
    props:
      rows: [A]
      columns: [B, C]
      classes: { x: { tone: blue, label: Match }, h: { tone: blue, pattern: hatch, label: Hatched } }
      cells: [xh]
  - id: key
    component: legend
    props: { entries: [{ class: mask.x }, { class: mask.h }] }
edges:
  - { from: plain, to: tinted, tone: blue, label: toned }
`;

async function render(text: string) {
  const result = await renderFigure(text);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result;
}

test("a tone override reaches every variant, edge, matrix class, legend sample and inline run", async () => {
  const result = await render(
    figure(
      `{ tones: { blue: { fill: '${BLUE.fill}', line: '${BLUE.line}', text: '#000000' }, orange: { fill: '#ffe6d3', line: '#fc8226' } } }`,
      toned,
    ),
  );
  const { ir } = result.value.compiled;
  const node = (id: string) => ir.nodes.find((n) => n.id === id)?.style;
  // Default: the tone's pale fill; text stays the theme's (not tone-colored).
  expect(node("plain")).toMatchObject({
    fill: BLUE.fill,
    fontColor: getTheme("paper")?.base.node.fontColor ?? "?",
  });
  // Tinted: pale fill, the line as written, the explicit text as written.
  expect(node("tinted")).toMatchObject({
    fill: BLUE.fill,
    stroke: BLUE.line,
    fontColor: "#000000",
  });
  // Without text, tinted text is the line darkened to 4.5:1; the frame keeps the line.
  const auto = node("auto");
  expect(auto).toMatchObject({ fill: "#ffe6d3", stroke: "#fc8226" });
  expect(auto?.fontColor).toBe(readableInk("#ffe6d3", "#fc8226"));
  expect(contrastRatio("#ffe6d3", auto?.fontColor ?? "")).toBeGreaterThanOrEqual(4.5);
  // Outlined: line and text from the override.
  expect(node("outlined")).toMatchObject({ stroke: BLUE.line, fontColor: "#000000" });
  // Solid: the line fills; white text is contrast-adjusted, `text` does not apply.
  const solid = node("solid");
  expect(solid).toMatchObject({ fill: BLUE.line, stroke: BLUE.line });
  expect(solid?.fontColor).toBe(readableInk(BLUE.line, "#ffffff"));
  // Toned edge: line and label text.
  const edge = ir.edges[0]?.style;
  expect(edge).toMatchObject({ stroke: BLUE.line, fontColor: "#000000" });
  // Matrix class cells and legend samples take the fill; hatches take the line.
  const cells = ir.nodes.filter((n) => n.id.startsWith("mask-") && n.style.fill === BLUE.fill);
  expect(cells.length).toBeGreaterThanOrEqual(2);
  expect(ir.nodes.filter((n) => n.id.startsWith("key-") && n.style.fill === BLUE.fill).length).toBe(
    2,
  );
  expect(ir.nodes.some((n) => n.style.hatch === BLUE.line)).toBe(true);
  // The SVG draws the overridden colors, including the arrowhead and the inline tone run.
  const { svg } = result.value;
  expect(svg).toContain(`fill="${BLUE.line}"`);
  expect(svg).not.toContain(getTheme("paper")?.toneLines.get("blue")?.stroke ?? "?");
  expect(result.diagnostics.filter((d) => d.severity === "warning")).toEqual([]);
  // The built-in theme is not changed.
  expect(getTheme("paper")?.tones.get("blue")?.fill).toBe("#d1e7ff");
});

test("solidFills wins over a tone's line for the solid fill", async () => {
  const result = await render(
    figure(
      `{ solidFills: { blue: '#3d9df5' }, tones: { blue: { line: '${BLUE.line}' } } }`,
      `groups: [{ id: panel, arrange: { row: { items: [solid, outlined] } } }]
nodes:
  - { id: solid, component: box, variant: solid, tone: blue, label: Solid }
  - { id: outlined, component: box, variant: outlined, tone: blue, label: Outlined }
`,
    ),
  );
  const [solid, outlined] = result.value.compiled.ir.nodes;
  expect(solid?.style.fill).toBe("#3d9df5");
  expect(outlined?.style).toMatchObject({ stroke: BLUE.line, fontColor: BLUE.line });
});

test("dimming applies on top of overridden tones", async () => {
  const body = `groups:
  - { id: panel, dim: true, arrange: { row: { items: [tinted] } } }
nodes:
  - { id: tinted, component: box, variant: tinted, tone: blue, label: Tinted }
`;
  const plain = await render(figure("{}", body));
  const result = await render(
    figure(`{ tones: { blue: { fill: '${BLUE.fill}', line: '${BLUE.line}' } } }`, body),
  );
  const style = result.value.compiled.ir.nodes[0]?.style;
  const dim = getTheme("paper")?.dim;
  expect(style?.stroke).toBe(dim?.stroke ?? "?");
  expect(style?.fill).not.toBe(BLUE.fill);
  expect(style?.fill).not.toBe(plain.value.compiled.ir.nodes[0]?.style.fill);
});

test("groupFill and groupStroke paint container cards, including stacked rear cards", async () => {
  const result = await render(
    figure(
      "{ groupFill: '#fffff0', groupStroke: '#000000', dashedGroupStroke: '#527da5' }",
      `groups:
  - id: panel
    variant: plain
    arrange: { row: { items: [card, toned, dashed] } }
  - id: card
    variant: muted
    props: { layers: { count: 3, offset: 2pt } }
    arrange: { row: { items: [a] } }
  - { id: toned, tone: blue, arrange: { row: { items: [b] } } }
  - { id: dashed, variant: dashed, arrange: { row: { items: [c] } } }
nodes:
  - { id: a, component: box, label: A }
  - { id: b, component: box, label: B }
  - { id: c, component: box, label: C }
`,
    ),
  );
  const group = (id: string) => result.value.compiled.ir.groups.find((g) => g.id === id)?.style;
  expect(group("card")).toMatchObject({ fill: "#fffff0", stroke: "#000000" });
  // A toned group keeps its tone fill; a borderless/unfilled one keeps "transparent".
  expect(group("toned")).toMatchObject({ fill: "#d1e7ff", stroke: "#000000" });
  expect(group("panel")?.fill).toBe("transparent");
  // dashedGroupStroke is the more specific setting.
  expect(group("dashed")).toMatchObject({ fill: "transparent", stroke: "#527da5" });
  // Three cards: the front frame and two rear cards, all in the overridden colors.
  const cards = [...result.value.svg.matchAll(/fill="#fffff0"[^>]*stroke="#000000"/g)];
  expect(cards.length).toBeGreaterThanOrEqual(3);
});

test("empty overrides and a groupFill equal to the theme's change nothing", async () => {
  const base = await render(figure("{ groupLabelWeight: bold }", toned));
  const empty = await render(
    figure("{ groupLabelWeight: bold, tones: { blue: {} }, groupFill: '#ffffff' }", toned),
  );
  // The input hash in the metadata differs; the drawing does not.
  const drawing = (svg: string) =>
    svg.replace(/<metadata>.*?<\/metadata>/s, "").replace(/sumi-\d+/g, "");
  expect(drawing(empty.value.svg)).toBe(drawing(base.value.svg));
});

test("an explicit low-contrast text warns but is drawn as written", async () => {
  const result = await render(
    figure(
      `{ tones: { blue: { fill: '${BLUE.fill}', text: '#c0c0c0' } } }`,
      `groups: [{ id: panel, arrange: { row: { items: [n] } } }]
nodes:
  - { id: n, component: box, variant: tinted, tone: blue, label: Pale }
`,
    ),
  );
  expect(result.value.compiled.ir.nodes[0]?.style.fontColor).toBe("#c0c0c0");
  expect(result.diagnostics.filter((d) => d.code === "theme/low-contrast")).toEqual([
    expect.objectContaining({
      severity: "warning",
      path: ["figure", "themeOverrides", "tones", "blue", "text"],
      message: expect.stringContaining("on its fill #dfe1ea"),
      location: expect.objectContaining({ line: 5 }),
    }),
  ]);
});

const ORANGE_LINE = "{ tones: { orange: { line: '#fc8226' } } }";
const oneNode = (
  node: string,
  edges = "",
) => `groups: [{ id: panel, arrange: { row: { items: [n, m] } } }]
nodes:
  - ${node}
  - { id: m, component: box, label: M }
${edges}`;

test.each([
  [
    "outlined text",
    ORANGE_LINE,
    oneNode("{ id: n, component: box, variant: outlined, tone: orange, label: N }"),
    "line",
  ],
  [
    "a toned edge label",
    ORANGE_LINE,
    oneNode(
      "{ id: n, component: box, label: N }",
      "edges: [{ from: n, to: m, tone: orange, label: go }]",
    ),
    "line",
  ],
  [
    "a \\textcolor run",
    ORANGE_LINE,
    oneNode("{ id: n, component: box, label: 'A $\\textcolor{orange}{N}$' }"),
    "line",
  ],
  [
    "an explicit text",
    "{ tones: { orange: { text: '#aaaaaa' } } }",
    oneNode("{ id: n, component: box, variant: outlined, tone: orange, label: N }"),
    "text",
  ],
])("tone text on white under 4.5:1 warns: %s", async (_, overrides, body, field) => {
  const result = await render(figure(overrides, body));
  expect(result.diagnostics.filter((d) => d.code === "theme/low-contrast")).toEqual([
    expect.objectContaining({
      severity: "warning",
      path: ["figure", "themeOverrides", "tones", "orange", field],
      message: expect.stringContaining("on white"),
    }),
  ]);
});

test.each([
  [
    "only tinted nodes (text darkened automatically)",
    ORANGE_LINE,
    oneNode("{ id: n, component: box, variant: tinted, tone: orange, label: N }"),
  ],
  [
    "an unused tone",
    "{ tones: { orange: { line: '#fc8226', text: '#eeeeee' } } }",
    oneNode("{ id: n, component: box, variant: outlined, tone: blue, label: N }"),
  ],
  [
    "a dark explicit text",
    "{ tones: { orange: { line: '#fc8226', text: '#000000' } } }",
    oneNode(
      "{ id: n, component: box, variant: outlined, tone: orange, label: N }",
      "edges: [{ from: n, to: m, tone: orange, label: go }]",
    ),
  ],
  [
    "an unlabelled toned edge",
    ORANGE_LINE,
    oneNode("{ id: n, component: box, label: N }", "edges: [{ from: n, to: m, tone: orange }]"),
  ],
])("no contrast warning for %s", async (_, overrides, body) => {
  const result = await render(figure(overrides, body));
  expect(result.diagnostics.filter((d) => d.code === "theme/low-contrast")).toEqual([]);
});

test.each([
  ["{ tones: { cyan: { fill: '#123456' } } }", "tones"],
  ["{ tones: { blue: { stroke: '#123456' } } }", "tones"],
  ["{ tones: { blue: { fill: '#abc' } } }", "tones"],
  ["{ tones: { blue: { line: red } } }", "tones"],
  ["{ groupFill: white }", "groupFill"],
  ["{ groupStroke: '#0000000' }", "groupStroke"],
])("rejects invalid tone and group overrides: %s", (overrides, field) => {
  const diagnostics = checkFigure(
    figure(
      overrides,
      "groups: [{ id: panel, arrange: { row: { items: [n] } } }]\nnodes: [{ id: n, component: box }]\n",
    ),
  ).state.diagnostics;
  expect(
    diagnostics.some(
      (d) =>
        d.severity === "error" &&
        d.code.startsWith("schema/") &&
        d.path?.[1] === "themeOverrides" &&
        d.path?.[2] === field,
    ),
  ).toBe(true);
});

test("a coloured run reads at 4.5:1 on another tone's fill (#465)", async () => {
  const source = `version: 1
figure:
  id: runs
  theme: paper
  layout: { arrange: { row: { items: [red, purple] } } }
nodes:
  - { id: red, component: box, variant: tinted, tone: red, label: 'A $\\textcolor{yellow}{\\text{warm}}$' }
  - { id: purple, component: box, variant: tinted, tone: purple, label: 'A $\\textcolor{yellow}{\\text{warm}}$' }
`;
  const result = await renderFigure(source);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const svg = result.value.svg;
  for (const fill of ["#f9c7bb", "#d8cdf8"]) expect(svg).toContain(`fill="${fill}"`);
  const colours = [...svg.matchAll(/<tspan[^>]*fill="(#[0-9a-f]{6})"/gi)].map(
    (m) => m[1] as string,
  );
  const golden = colours.filter((c) => c.toLowerCase() !== "#000000");
  expect(golden.length).toBeGreaterThanOrEqual(2);
  // In document order: the red node's run, then the purple node's.
  golden.forEach((colour, i) =>
    expect(
      contrastRatio(colour, ["#f9c7bb", "#d8cdf8"][i] ?? "#ffffff"),
      colour,
    ).toBeGreaterThanOrEqual(4.5),
  );
});
