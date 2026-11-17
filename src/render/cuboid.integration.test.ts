import { describe, expect, test } from "bun:test";
import { checkFigure } from "../core/check";
import { cuboid, cuboidOffset } from "../core/outline/cuboid";
import { getTheme } from "../core/theme/builtin";
import { cuboidColors, cuboidShadeOf, mixColors } from "../core/theme/cuboid-shade";
import { checkRoutes } from "../layout/route/check";
import { lintGeometry } from "../lint";
import { svgToPdf } from "./pdf";
import { svgToEditablePptx } from "./pptx";
import { readPptx } from "./pptx/testing";
import { renderFigure } from "./render";
import { attribute, descendants, parseXml } from "./xml";

const source = (theme: string, extra = "", dims = '{ width: "64", height: "224²" }') => `version: 1
figure:
  id: cnn
  theme: ${theme}
  profile: paper-double
${extra}  layout:
    arrange: { row: { gap: 8mm, align: end, items: [a, b, c] } }
nodes:
  - { id: a, component: cuboid, tone: blue, variant: tinted, props: { width: 3mm, height: 24mm, depth: 24mm, dims: ${dims} } }
  - { id: b, component: cuboid, tone: orange, variant: tinted, props: { width: 6mm, height: 16mm, depth: 16mm } }
  - { id: c, component: cuboid, tone: green, variant: tinted, label: FC, props: { width: 8mm, height: 12mm, depth: 4mm } }
edges:
  - { from: a, to: b }
  - { from: b, to: c }
`;

async function render(text: string) {
  const result = await renderFigure(text);
  if (!result.ok || !("layout" in result.value)) throw new Error(JSON.stringify(result));
  return result.value;
}

const nodeShape = (svg: string, id: string) =>
  svg.match(
    new RegExp(`<g class="sumi-k-n--${id} sumi-kind-node"><g class="shape">(.*?)</g>`),
  )?.[1] ?? "";

describe("cuboid rendering", () => {
  for (const theme of ["sumi", "sumi-dark", "paper", "minimal"]) {
    test(`${theme}: faces are shaded from the fill, the figure is lint-clean and routes check`, async () => {
      const value = await render(source(theme));
      expect(lintGeometry(value).filter((d) => d.severity !== "info")).toEqual([]);
      expect(Object.values(checkRoutes(value.compiled.ir, value.layout)).flat()).toEqual([]);
      const node = value.compiled.ir.nodes.find((n) => n.id === "a");
      if (!node) throw new Error("missing node");
      const colors = cuboidColors(
        node.style.fill,
        node.style.stroke,
        cuboidShadeOf(getTheme(theme) as never),
      );
      expect(colors).toBeDefined();
      const shape = nodeShape(value.svg, "a");
      // top and side faces are painted without a stroke, in the derived fills; the front keeps the fill.
      const paths = [...shape.matchAll(/<path [^>]*\/>/g)].map((m) => m[0]);
      expect(paths).toHaveLength(6);
      expect(paths[0]).toContain(`fill="${colors?.top}"`);
      expect(paths[0]).toContain('stroke="none"');
      expect(paths[1]).toContain(`fill="${colors?.side}"`);
      expect(paths[2]).toContain(`fill="${node.style.fill}"`);
      // inner edges: the frame mixed toward the fill, half as wide; the silhouette is the frame itself.
      expect(paths[3]).toContain(`stroke="${colors?.inner}"`);
      expect(paths[3]).toContain(`stroke-width="${node.style.strokeWidth.units * 0.5}"`);
      expect(paths[5]).toContain(`stroke-width="${node.style.strokeWidth.units}"`);
      expect(paths[5]).toContain('fill="none"');
      // corners are never rounded.
      expect(shape).not.toContain("<rect");
      expect(shape).not.toContain(" C ");
    });
  }

  test("the top is lighter and the side darker than the front on a light theme, the top lighter on sumi-dark too", () => {
    const light = cuboidColors("#d9e4e6", "#3d5d77", cuboidShadeOf(getTheme("sumi") as never));
    expect(light?.top).toBe(mixColors("#d9e4e6", "#ffffff", 0.55));
    const dark = cuboidColors("#3e5068", "#b9d0e5", cuboidShadeOf(getTheme("sumi-dark") as never));
    expect(dark?.side).toBe(mixColors("#3e5068", "#1c2033", 0.35));
  });

  test("dims are horizontal label nodes attached to the cuboid, seen by the geometry lint", async () => {
    const value = await render(source("sumi"));
    const ids = value.compiled.ir.nodes.map((n) => n.id);
    expect(ids).toContain("a-dim-width");
    expect(ids).toContain("a-dim-height");
    const rect = (id: string) => value.layout.nodes.find((n) => n.key === `n:${id}`)?.rect;
    const body = rect("a");
    const width = rect("a-dim-width");
    const height = rect("a-dim-height");
    if (!body || !width || !height) throw new Error("missing layout");
    // above the silhouette, and below the front face.
    expect(width.y + width.height).toBeLessThanOrEqual(body.y);
    expect(height.y).toBeGreaterThanOrEqual(body.y + body.height);
    expect(svgText(value.svg)).toEqual(expect.arrayContaining(["64", "224²"]));
    // Text is never rotated.
    expect(value.svg).not.toMatch(/<text[^>]*transform="rotate/);
  });

  test("a dimension that runs into a neighbour is reported by the geometry lint", async () => {
    const crowded = `version: 1
figure:
  id: crowded
  theme: sumi
  profile: paper-double
  layout:
    arrange: { row: { gap: 2mm, align: end, items: [a, b] } }
nodes:
  - { id: a, component: cuboid, props: { width: 3mm, height: 12mm, depth: 8mm, dims: { width: "a long dimension" } } }
  - { id: b, component: cuboid, props: { width: 3mm, height: 12mm, depth: 8mm, dims: { width: "another one" } } }
`;
    const value = await render(crowded);
    expect(lintGeometry(value).map((d) => d.code)).toContain("geometry/label-collision");
  });

  test("figure.projection changes the silhouette; the default is 45 degrees and 0.5", async () => {
    const base = await render(source("sumi"));
    const same = await render(source("sumi", "  projection: { angle: 45, depthScale: 0.5 }\n"));
    expect(same.layout.nodes.map((n) => n.rect)).toEqual(base.layout.nodes.map((n) => n.rect));
    expect(nodeShape(same.svg, "a")).toBe(nodeShape(base.svg, "a"));
    const flat = await render(source("sumi", "  projection: { angle: 30, depthScale: 0.5 }\n"));
    const size = (v: typeof base) => v.layout.nodes.find((n) => n.key === "n:a")?.rect;
    // Depth 24mm: dx = 12mm * cos(a), dy = 12mm * sin(a) (D2 units are 0.5pt).
    const [bw, fw] = [size(base)?.width ?? 0, size(flat)?.width ?? 0];
    const [bh, fh] = [size(base)?.height ?? 0, size(flat)?.height ?? 0];
    expect(fw).toBeGreaterThan(bw);
    expect(fh).toBeLessThan(bh);
  });

  test("the silhouette is the collision outline: an edge ends on it, at the front's middle height when unanchored", async () => {
    const same = `version: 1
figure:
  id: pair
  theme: sumi
  profile: paper-double
  layout:
    arrange: { row: { gap: 12mm, align: end, items: [a, b] } }
nodes:
  - { id: a, component: cuboid, props: { width: 3mm, height: 24mm, depth: 24mm } }
  - { id: b, component: cuboid, props: { width: 3mm, height: 24mm, depth: 24mm } }
edges:
  - { from: a, to: b }
`;
    const value = await render(same);
    const edge = value.compiled.ir.edges[0];
    const a = value.layout.nodes.find((n) => n.key === "n:a")?.rect;
    const b = value.layout.nodes.find((n) => n.key === "n:b")?.rect;
    const route = value.layout.edges.find((e) => e.key === edge?.key)?.route?.points;
    if (!a || !b || !route) throw new Error("missing layout");
    const node = value.compiled.ir.nodes.find((n) => n.id === "a");
    const params = cuboid.params.parse(node?.render?.params);
    const { dx, dy } = cuboidOffset(params);
    const frontHeight = a.height - dy;
    // The right port: where the front's middle-height line meets the silhouette (the back right edge).
    expect(route[0]?.x).toBeCloseTo(a.x + a.width, 1);
    expect(route[0]?.y).toBeCloseTo(a.y + dy + frontHeight / 2, 1);
    // The left port of the target: its front face's left edge at the middle.
    expect(route.at(-1)?.x).toBeCloseTo(b.x, 1);
    expect(route.at(-1)?.y).toBeCloseTo(b.y + dy + frontHeight / 2, 1);
    expect(dx).toBeGreaterThan(0);
  });

  const pair = (sizes: [string, string], route = "") => `version: 1
figure:
  id: pair
  theme: sumi
  profile: paper-double
  layout:
    arrange: { row: { gap: 14mm, align: end, items: [a, b] } }
nodes:
  - { id: a, component: cuboid, props: { width: 3mm, height: ${sizes[0]}, depth: 24mm } }
  - { id: b, component: cuboid, props: { width: 3mm, height: ${sizes[1]}, depth: 24mm } }
edges:
  - { from: a, to: b${route} }
`;
  const frontCentre = (value: Awaited<ReturnType<typeof render>>, id: string) => {
    const rect = value.layout.nodes.find((n) => n.key === `n:${id}`)?.rect;
    const node = value.compiled.ir.nodes.find((n) => n.id === id);
    if (!rect) throw new Error("missing layout");
    const { dy } = cuboidOffset(cuboid.params.parse(node?.render?.params));
    return { rect, y: rect.y + dy + (rect.height - dy) / 2 };
  };

  for (const route of ["", ", route: straight", ", route: curve"]) {
    test(`unanchored ends meet the front faces' middle height (route${route || ": default"})`, async () => {
      // Equal cuboids side by side: both ends at the same, front-middle height.
      const value = await render(pair(["24mm", "24mm"], route));
      const points = value.layout.edges[0]?.route?.points ?? [];
      const a = frontCentre(value, "a");
      const b = frontCentre(value, "b");
      expect(points[0]?.y).toBeCloseTo(a.y, 0);
      expect(points.at(-1)?.y).toBeCloseTo(b.y, 0);
      // The bounding-box middle is a different height.
      expect(Math.abs(a.y - (a.rect.y + a.rect.height / 2))).toBeGreaterThan(5);
    });
    test(`unequal neighbours end on their silhouettes (route${route || ": default"})`, async () => {
      const value = await render(pair(["28mm", "16mm"], route));
      const points = value.layout.edges[0]?.route?.points ?? [];
      const a = value.layout.nodes.find((n) => n.key === "n:a")?.rect;
      const b = value.layout.nodes.find((n) => n.key === "n:b")?.rect;
      if (!a || !b) throw new Error("missing layout");
      expect(points[0]?.x).toBeGreaterThan(a.x);
      expect(points[0]?.x).toBeLessThanOrEqual(a.x + a.width + 0.5);
      expect(points.at(-1)?.x).toBeGreaterThanOrEqual(b.x - 0.5);
      expect(points.at(-1)?.x).toBeLessThan(b.x + b.width);
      if (route === "") {
        expect(Object.values(checkRoutes(value.compiled.ir, value.layout)).flat()).toEqual([]);
      }
    });
  }

  test("unequal neighbours with overlapping front faces get one horizontal segment inside both", async () => {
    const value = await render(pair(["28mm", "16mm"]));
    const points = value.layout.edges[0]?.route?.points ?? [];
    expect(points).toHaveLength(2);
    expect(points[0]?.y).toBeCloseTo(points[1]?.y ?? Number.NaN, 6);
    for (const id of ["a", "b"]) {
      const node = value.compiled.ir.nodes.find((n) => n.id === id);
      const rect = value.layout.nodes.find((n) => n.key === `n:${id}`)?.rect;
      if (!rect) throw new Error("missing layout");
      const front = cuboid.draw(rect, cuboid.params.parse(node?.render?.params)).safeArea;
      expect(points[0]?.y).toBeGreaterThan(front.y);
      expect(points[0]?.y).toBeLessThan(front.y + front.height);
    }
  });

  test("fronts that do not overlap keep their front-face middles", async () => {
    const value = await render(`version: 1
figure:
  id: apart
  theme: sumi
  profile: paper-double
  layout:
    arrange: { row: { gap: 14mm, align: start, items: [a, b] } }
nodes:
  - { id: a, component: cuboid, props: { width: 3mm, height: 6mm, depth: 24mm } }
  - { id: b, component: cuboid, props: { width: 3mm, height: 6mm, depth: 2mm } }
edges:
  - { from: a, to: b }
`);
    const a = frontCentre(value, "a");
    const points = value.layout.edges[0]?.route?.points ?? [];
    expect(points[0]?.y).toBeCloseTo(a.y, 0);
  });

  const fan = (mode: string, out = false) => `version: 1
figure:
  id: fan
  theme: sumi
  profile: paper-double
  layout:
    fanIn: ${mode}
    arrange:
      row:
        gap: 16mm
        align: center
        items: [${out ? "big, { stack: { gap: 10mm, items: [u, v] } }" : "{ stack: { gap: 10mm, items: [u, v] } }, big"}]
nodes:
  - { id: u, component: cuboid, props: { width: 3mm, height: 8mm, depth: 6mm } }
  - { id: v, component: cuboid, props: { width: 3mm, height: 8mm, depth: 6mm } }
  - { id: big, component: cuboid, props: { width: 3mm, height: 40mm, depth: 6mm } }
edges:
${out ? "  - { from: big, to: u }\n  - { from: big, to: v }" : "  - { from: u, to: big }\n  - { from: v, to: big }"}
`;
  for (const mode of ["merge", "spread"]) {
    test(`fan-in (${mode}) into a cuboid is left to the fan-in rules, not straightened per edge`, async () => {
      const value = await render(fan(mode));
      const ends = value.layout.edges.map((e) => e.route?.points.at(-1)?.y ?? Number.NaN);
      expect(ends).toHaveLength(2);
      if (mode === "merge") expect(ends[0]).toBeCloseTo(ends[1] ?? Number.NaN, 6);
      else expect(Math.abs((ends[0] ?? 0) - (ends[1] ?? 0))).toBeGreaterThan(5);
      expect(Object.values(checkRoutes(value.compiled.ir, value.layout)).flat()).toEqual([]);
    });
  }

  test("fan-out from a cuboid keeps one shared source port", async () => {
    const value = await render(fan("merge", true));
    const starts = value.layout.edges.map((e) => e.route?.points[0]?.y ?? Number.NaN);
    expect(starts[0]).toBeCloseTo(starts[1] ?? Number.NaN, 6);
    const big = frontCentre(value, "big");
    expect(starts[0]).toBeCloseTo(big.y, 0);
  });

  test("a thin plate keeps its requested front width and projection", async () => {
    const value = await render(`version: 1
figure:
  id: plate
  theme: sumi
  profile: paper-double
  layout:
    arrange: { row: { items: [p] } }
nodes:
  - { id: p, component: cuboid, props: { width: 1.5mm, height: 28mm, depth: 28mm } }
`);
    const node = value.compiled.ir.nodes.find((n) => n.id === "p");
    const { dx } = cuboidOffset(cuboid.params.parse(node?.render?.params));
    const rect = value.layout.nodes.find((n) => n.key === "n:p")?.rect;
    if (!rect) throw new Error("missing layout");
    // 1.5mm = 8.5 units of front width, not half the silhouette.
    expect(dx).toBeGreaterThan(40);
    const front = cuboid.draw(rect, cuboid.params.parse(node?.render?.params)).safeArea;
    expect(front.width).toBeLessThan(12);
    expect(rect.width - front.width).toBeCloseTo(dx, 6);
  });

  test("a cuboid ID too long for a derived dimension ID is a located error", () => {
    const id = `c${"x".repeat(58)}`;
    const checked = checkFigure(`version: 1
figure: { id: x, theme: sumi, profile: paper-double, layout: { arrange: { row: { items: [${id}] } } } }
nodes:
  - { id: ${id}, component: cuboid, props: { width: 3mm, height: 8mm, depth: 8mm, dims: { width: "8" } } }
`);
    const found = checked.state.diagnostics.find((d) => d.code === "schema/invalid-id");
    expect(found?.path).toEqual(["nodes", 0, "props", "dims", "width"]);
    expect(found?.location).toBeDefined();
  });

  test("PDF and editable PPTX render: faces are freeforms with their own fills", async () => {
    const value = await render(source("sumi-dark"));
    expect(svgToPdf(value.svg).ok).toBe(true);
    const pptx = svgToEditablePptx(value.svg, value.compiled.ir, { connectors: "freeform" });
    if (!pptx.ok) throw new Error(JSON.stringify(pptx.diagnostics));
    const slide = parseXml(
      new TextDecoder().decode(readPptx(pptx.value).get("ppt/slides/slide1.xml")),
    );
    if (!slide.ok) throw new Error(slide.message);
    const names = [...descendants(slide.root)]
      .filter((e) => e.name === "p:cNvPr")
      .map((e) => attribute(e, "name"));
    for (const part of ["top", "side", "front", "edge"]) expect(names).toContain(`n:a ${part}`);
    expect(names.filter((n) => n === "n:a")).toHaveLength(1);
    const fills = new Map<string, string>();
    for (const sp of [...descendants(slide.root)].filter((e) => e.name === "p:sp")) {
      const nv = [...descendants(sp)].find((e) => e.name === "p:cNvPr");
      const color = [...descendants(sp)].find((e) => e.name === "a:srgbClr");
      if (nv && color) fills.set(attribute(nv, "name") ?? "", attribute(color, "val") ?? "");
    }
    // The top and the side differ from the front.
    expect(
      new Set([fills.get("n:a top"), fills.get("n:a side"), fills.get("n:a front")]).size,
    ).toBe(3);
  });

  test("the cuboid needs the structured layout and its dimension IDs are reserved", () => {
    const auto = checkFigure(`version: 1
figure: { id: x, theme: sumi, profile: paper-double }
nodes:
  - { id: a, component: cuboid, props: { width: 3mm, height: 8mm, depth: 8mm } }
`);
    expect(auto.state.diagnostics.map((d) => d.code)).toContain("layout/structured-only");

    const clash = checkFigure(`version: 1
figure: { id: x, theme: sumi, profile: paper-double, layout: { arrange: { row: { items: [a, a-dim-width] } } } }
nodes:
  - { id: a, component: cuboid, props: { width: 3mm, height: 8mm, depth: 8mm, dims: { width: "8" } } }
  - { id: a-dim-width, component: box, label: mine }
`);
    expect(clash.state.diagnostics.map((d) => d.code)).toContain("ref/reserved-id");
  });

  test("projection is validated: the angle and scale have ranges", () => {
    const check = (projection: string) =>
      checkFigure(`version: 1
figure: { id: x, theme: sumi, profile: paper-double, projection: ${projection}, layout: { arrange: { row: { items: [a] } } } }
nodes:
  - { id: a, component: cuboid, props: { width: 3mm, height: 8mm, depth: 8mm } }
`).state.diagnostics.filter((d) => d.severity === "error");
    expect(check("{ angle: 30, depthScale: 0.35 }")).toEqual([]);
    expect(check("{}")).toEqual([]);
    expect(check("{ angle: 95 }").length).toBeGreaterThan(0);
    expect(check("{ depthScale: 0 }").length).toBeGreaterThan(0);
    expect(check("{ skew: 1 }").length).toBeGreaterThan(0);
  });
});

function svgText(svg: string): string[] {
  const parsed = parseXml(svg);
  if (!parsed.ok) throw new Error(parsed.message);
  return [...descendants(parsed.root)]
    .filter((e) => e.name === "text" || e.name === "tspan")
    .map((e) =>
      svg
        .slice(e.startTagEnd, e.end)
        .replace(/<[^>]*>/g, "")
        .trim(),
    )
    .filter(Boolean);
}
