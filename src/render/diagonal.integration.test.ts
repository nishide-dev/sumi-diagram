import { expect, test } from "bun:test";
import { parse, stringify } from "yaml";
import { checkFigure } from "../core/check";
import { BUILTIN_THEMES } from "../core/theme/builtin";
import { checkRoutes } from "../layout/route/check";
import { lintRenderedFigure } from "../lint";
import { svgToPdf } from "./pdf";
import { svgToEditablePptx, svgToPptx } from "./pptx";
import { readPptx } from "./pptx/testing";
import { renderFigure } from "./render";

const fixture = await Bun.file(
  "tests/fixtures/figures/layout/straight-correspondence.sumi.yaml",
).text();
const simple = (
  edge: Record<string, unknown> = {},
  items: unknown[] = ["a", "b"],
  extra: Record<string, unknown>[] = [],
) =>
  stringify({
    version: 1,
    figure: {
      id: "diagonal",
      theme: "paper",
      profile: "paper-double",
      layout: { engine: "structured", arrange: { row: { gap: "16mm", items } } },
    },
    nodes: [
      { id: "a", label: "A", component: "box" },
      { id: "b", label: "B", component: "box" },
      ...extra.map((n) => ({ component: "box", ...n })),
    ],
    edges: [{ id: "ab", from: "a", to: "b", route: "straight", ...edge }],
  });
async function render(text: string, theme?: string) {
  const result = await renderFigure(text, theme === undefined ? {} : { overrides: { theme } });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  if (!("layout" in result.value)) throw new Error("Expected structured");
  return result.value;
}

test("crossing token-cell correspondences are single diagonals under every theme", async () => {
  for (const theme of BUILTIN_THEMES.keys()) {
    const rendered = await render(fixture, theme);
    expect(rendered.layout.edges).toHaveLength(3);
    for (const edge of rendered.layout.edges) {
      const p = edge.route?.points;
      expect(p).toHaveLength(2);
      expect(p?.[0]?.x).not.toBe(p?.[1]?.x);
      expect(p?.[0]?.y).not.toBe(p?.[1]?.y);
      expect(edge.route?.net).toBeUndefined();
    }
    expect(Object.values(checkRoutes(rendered.compiled.ir, rendered.layout)).flat()).toEqual([]);
    expect(rendered.svg.match(/class="sumi-wire"/g)).toHaveLength(3);
    expect(rendered.svg).not.toContain("NaN");
    const lint = await lintRenderedFigure(fixture, { overrides: { theme } });
    expect(
      lint.diagnostics.filter((d) => d.severity === "error" || d.severity === "warning"),
    ).toEqual([]);
  }
});

test("horizontal labels respect the normal of a diagonal, start/middle/end and left/right", async () => {
  for (const labelAt of ["start", "middle", "end"]) {
    for (const labelSide of ["left", "right"]) {
      const text = simple(
        { label: "match", labelAt, labelSide },
        [{ stack: { items: ["a", "spacer"] } }, "b"],
        [{ id: "spacer", label: "space" }],
      );
      const r = await render(text);
      const edge = r.layout.edges[0];
      const [a, b] = edge?.route?.points ?? [];
      const box = edge?.route?.label?.box;
      if (!a || !b || !box) throw new Error("Missing labelled route");
      const cross =
        (b.x - a.x) * (box.y + box.height / 2 - a.y) - (b.y - a.y) * (box.x + box.width / 2 - a.x);
      expect(Math.sign(cross)).toBe(labelSide === "left" ? -1 : 1);
      expect(checkRoutes(r.compiled.ir, r.layout).outside).toEqual([]);
    }
  }
});

test("explicit anchors are exact; automatic circle and diamond ends touch their outlines", async () => {
  const anchored = await render(simple({ fromAnchor: "east:0.25", toAnchor: "west:0.75" }));
  const [a, b] = anchored.layout.nodes;
  expect(anchored.layout.edges[0]?.route?.points).toEqual([
    {
      x: (a?.rect.x ?? 0) + (a?.rect.width ?? 0),
      y: Math.round(((a?.rect.y ?? 0) + (a?.rect.height ?? 0) * 0.25) * 1000) / 1000,
    },
    {
      x: b?.rect.x ?? 0,
      y: Math.round(((b?.rect.y ?? 0) + (b?.rect.height ?? 0) * 0.75) * 1000) / 1000,
    },
  ]);
  for (const component of ["circle", "diamond"]) {
    const text = simple().replace("component: box", `component: ${component}`);
    const r = await render(text);
    expect(checkRoutes(r.compiled.ir, r.layout).endpointMisses).toEqual([]);
  }
});

test("overlaps retain source-located node and label warnings", async () => {
  const text = simple({}, ["a", "obstacle", "b"], [{ id: "obstacle", label: "obstacle" }]);
  const lint = await lintRenderedFigure(text);
  for (const code of ["geometry/edge-through-node", "geometry/edge-crosses-label"]) {
    const d = lint.diagnostics.find((d) => d.code === code);
    expect(d?.severity).toBe("warning");
    expect(d?.path).toEqual(["edges", 0]);
    expect(d?.location?.line).toBeGreaterThan(0);
    expect(d?.related?.length).toBeGreaterThan(0);
  }
});

test("straight is structured-only and unsupported route values are rejected", () => {
  const auto = checkFigure(
    simple()
      .replace("engine: structured", "engine: auto")
      .replace(/ {4}arrange:[\s\S]*?(?=nodes:)/, ""),
  );
  expect(
    auto.state.diagnostics.some(
      (d) => d.code === "layout/structured-only" && d.path?.at(-1) === "route",
    ),
  ).toBe(true);
  expect(
    checkFigure(simple({ route: "curved" })).state.diagnostics.some(
      (d) => d.code === "schema/invalid-value",
    ),
  ).toBe(true);
});

test("a fixed straight-edge label overlapping a node is diagnosed at its source", async () => {
  const lint = await lintRenderedFigure(
    simple(
      { label: "match" },
      ["a", "obstacle", "b"],
      [{ id: "obstacle", label: "", props: { height: "72pt" } }],
    ),
  );
  const warning = lint.diagnostics.find((d) => d.code === "geometry/label-collision");
  expect(warning?.severity).toBe("warning");
  expect(warning?.path).toEqual(["edges", 0, "label"]);
  expect(warning?.location?.line).toBeGreaterThan(0);
});

test("self-loops, reverse-facing anchors and zoom conflicts get layout/no-route", async () => {
  for (const edge of [{ to: "a" }, { fromAnchor: "west" }, { component: "zoom" }]) {
    const result = await renderFigure(simple(edge));
    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.some((d) => d.code === "layout/no-route" && d.location !== undefined),
    ).toBe(true);
  }
});

test("a straight edge coexists with unchanged orthogonal routes and a zoom callout", async () => {
  const doc = parse(simple({}, ["a", "b", "c"], [{ id: "c", label: "C" }]));
  doc.edges = [
    { id: "orthogonal", from: "b", to: "c" },
    { id: "zoom", from: "a", to: "b", component: "zoom" },
  ];
  const before = await render(stringify(doc));
  doc.edges.splice(1, 0, { id: "diagonal", from: "a", to: "b", route: "straight" });
  const after = await render(stringify(doc));
  expect(after.layout.nodes).toEqual(before.layout.nodes);
  for (const edge of before.layout.edges) {
    expect(after.layout.edges.find((e) => e.key === edge.key)).toEqual(edge);
  }
  expect(after.layout.edges.map((e) => e.key)).toEqual(["e:orthogonal", "e:diagonal", "e:zoom"]);
});

test("a too-short double arrow fails rather than reversing its painted wire", async () => {
  const result = await renderFigure(
    simple({ component: "double-arrow" }).replace("gap: 16mm", "gap: 1pt"),
  );
  expect(result.ok).toBe(false);
  expect(result.diagnostics.some((d) => d.code === "layout/no-route")).toBe(true);
});

test("PDF, picture PPTX and both editable modes preserve straight correspondences and arrows", async () => {
  const r = await render(fixture);
  expect(svgToPdf(r.svg).ok).toBe(true);
  expect(svgToPptx(r.svg).ok).toBe(true);
  for (const connectors of ["freeform", "glued"] as const) {
    const result = svgToEditablePptx(r.svg, r.compiled.ir, { connectors });
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const slide = new TextDecoder().decode(readPptx(result.value).get("ppt/slides/slide1.xml"));
    for (const id of ["az", "bx", "cy"]) expect(slide).toContain(`name="e:${id}"`);
    expect(slide).toContain("<a:tailEnd");
    expect(slide).toContain("<a:headEnd");
    if (connectors === "glued") expect(slide.match(/prst="straightConnector1"/g)).toHaveLength(3);
    else expect(slide.match(/<a:lnTo>/g)?.length).toBeGreaterThanOrEqual(3);
  }
});
