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
import { attribute, childElements, descendants, parseXml } from "./xml";

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

  test("the silhouette is the collision outline: an edge ends on it, at the projected 3D centre height when unanchored", async () => {
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
    const { dx, dy } = cuboidOffset(cuboid.params.parse(node?.render?.params));
    const frontHeight = a.height - dy;
    const centreY = a.y + dy + frontHeight / 2 - dy / 2;
    // The projected centre is the front's centre moved by (dx/2, -dy/2): the middle of the box.
    expect(centreY).toBeCloseTo(a.y + a.height / 2, 9);
    // The right port: where the line through the centre meets the silhouette (the back right edge).
    expect(route[0]?.x).toBeCloseTo(a.x + a.width, 1);
    expect(route[0]?.y).toBeCloseTo(centreY, 1);
    // The left port of the target: its front face's left edge, at the same height.
    expect(route.at(-1)?.x).toBeCloseTo(b.x, 1);
    expect(route.at(-1)?.y).toBeCloseTo(b.y + b.height / 2, 1);
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
  const centreOf = (value: Awaited<ReturnType<typeof render>>, id: string) => {
    const rect = value.layout.nodes.find((n) => n.key === `n:${id}`)?.rect;
    if (!rect) throw new Error("missing layout");
    return { rect, y: rect.y + rect.height / 2 };
  };

  for (const route of ["", ", route: straight", ", route: curve"]) {
    test(`unanchored ends aim at the 3D centres (route${route || ": default"})`, async () => {
      // Equal cuboids side by side: both ends at the same height, through both projected centres.
      const value = await render(pair(["24mm", "24mm"], route));
      const points = value.layout.edges[0]?.route?.points ?? [];
      const a = centreOf(value, "a");
      const b = centreOf(value, "b");
      expect(points[0]?.y).toBeCloseTo(a.y, 0);
      expect(points.at(-1)?.y).toBeCloseTo(b.y, 0);
      expect(points[0]?.y).toBeCloseTo(points.at(-1)?.y ?? Number.NaN, 6);
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

  test("unequal bottom-aligned neighbours get one horizontal segment at the middle of their overlap", async () => {
    const value = await render(pair(["28mm", "16mm"]));
    const points = value.layout.edges[0]?.route?.points ?? [];
    expect(points).toHaveLength(2);
    expect(points[0]?.y).toBeCloseTo(points[1]?.y ?? Number.NaN, 6);
    const a = centreOf(value, "a").rect;
    const b = centreOf(value, "b").rect;
    const lo = Math.max(a.y, b.y);
    const hi = Math.min(a.y + a.height, b.y + b.height);
    expect(points[0]?.y).toBeCloseTo((lo + hi) / 2, 1);
  });

  test("vertical neighbours: top and bottom ports are at the 3D centre's x", async () => {
    const value = await render(`version: 1
figure:
  id: column
  theme: sumi
  profile: paper-double
  layout:
    arrange: { stack: { gap: 14mm, align: center, items: [a, b] } }
nodes:
  - { id: a, component: cuboid, props: { width: 4mm, height: 12mm, depth: 24mm } }
  - { id: b, component: cuboid, props: { width: 4mm, height: 12mm, depth: 24mm } }
edges:
  - { from: a, to: b }
`);
    const points = value.layout.edges[0]?.route?.points ?? [];
    const a = centreOf(value, "a").rect;
    const b = centreOf(value, "b").rect;
    expect(points).toHaveLength(2);
    expect(points[0]?.x).toBeCloseTo(a.x + a.width / 2, 1);
    expect(points.at(-1)?.x).toBeCloseTo(b.x + b.width / 2, 1);
    // The bottom of the source meets the silhouette's lower edge; the top of the target its upper edge.
    expect(points[0]?.y).toBeLessThanOrEqual(a.y + a.height + 0.5);
    expect(points.at(-1)?.y).toBeGreaterThanOrEqual(b.y - 0.5);
  });

  /** Distance from a point to the boundary of a cuboid's silhouette polygon. */
  const distanceToSilhouette = (
    value: Awaited<ReturnType<typeof render>>,
    id: string,
    point: { x: number; y: number },
  ) => {
    const rect = value.layout.nodes.find((n) => n.key === `n:${id}`)?.rect;
    const node = value.compiled.ir.nodes.find((n) => n.id === id);
    if (!rect) throw new Error("missing layout");
    const { outline } = cuboid.draw(rect, cuboid.params.parse(node?.render?.params));
    let best = Number.POSITIVE_INFINITY;
    for (const [i, a] of outline.entries()) {
      const b = outline[(i + 1) % outline.length] as { x: number; y: number };
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const t = Math.max(
        0,
        Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)),
      );
      best = Math.min(best, Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy)));
    }
    return best;
  };

  // A thin plate with a deep projection: the horizontal line through its 3D centre meets the
  // slanted top-left (west) and lower-right (east) edges, the vertical one the slanted
  // top-left (north) and lower-right (south) edges.
  const plates = (axis: "row" | "stack", route: string, anchors = "") => `version: 1
figure:
  id: plates
  theme: sumi
  profile: paper-double
  layout:
    arrange: { ${axis}: { gap: 16mm, align: ${axis === "row" ? "end" : "start"}, items: [a, b] } }
nodes:
  - { id: a, component: cuboid, props: { width: 1.5mm, height: 6mm, depth: 28mm } }
  - { id: b, component: cuboid, props: { width: 1.5mm, height: 4mm, depth: 28mm } }
edges:
  - { from: a, to: b${route}${anchors} }
`;
  for (const axis of ["row", "stack"] as const)
    for (const route of ["", ", route: straight", ", route: curve"]) {
      test(`ends lie on the silhouette, on its slanted edges for a thin deep plate (${axis}, route${route || ": default"})`, async () => {
        const value = await render(plates(axis, route));
        const points = value.layout.edges[0]?.route?.points ?? [];
        expect(distanceToSilhouette(value, "a", points[0] ?? { x: 1e9, y: 1e9 })).toBeLessThan(0.6);
        expect(distanceToSilhouette(value, "b", points.at(-1) ?? { x: 1e9, y: 1e9 })).toBeLessThan(
          0.6,
        );
        // The slanted edge, not the vertical or horizontal one: the end is off the box's side.
        const a = centreOf(value, "a").rect;
        const b = centreOf(value, "b").rect;
        const start = points[0];
        const end = points.at(-1);
        if (axis === "row") {
          expect(start?.x).toBeLessThan(a.x + a.width - 1);
          expect(end?.x).toBeGreaterThan(b.x + 0.3);
        } else {
          expect(start?.y).toBeLessThan(a.y + a.height - 1);
          expect(end?.y).toBeGreaterThan(b.y + 0.3);
        }
      });
    }

  for (const route of ["straight", "curve"]) {
    test(`unequal centres: a direct route (${route}) ends on both silhouettes`, async () => {
      const value = await render(pair(["28mm", "10mm"], `, route: ${route}`));
      const points = value.layout.edges[0]?.route?.points ?? [];
      expect(distanceToSilhouette(value, "a", points[0] ?? { x: 1e9, y: 1e9 })).toBeLessThan(0.6);
      expect(distanceToSilhouette(value, "b", points.at(-1) ?? { x: 1e9, y: 1e9 })).toBeLessThan(
        0.6,
      );
    });

    test(`a written anchor keeps projecting toward the front centre (route: ${route})`, async () => {
      const value = await render(pair(["24mm", "24mm"], `, route: ${route}, fromAnchor: east:0.3`));
      const points = value.layout.edges[0]?.route?.points ?? [];
      const a = centreOf(value, "a").rect;
      const node = value.compiled.ir.nodes.find((n) => n.id === "a");
      const front = cuboid.draw(a, cuboid.params.parse(node?.render?.params)).safeArea;
      // The ray runs from the anchor, 30% down the east side, toward the middle of the front face.
      const anchor = { x: a.x + a.width, y: a.y + 0.3 * a.height };
      const target = { x: front.x + front.width / 2, y: front.y + front.height / 2 };
      const start = points[0];
      if (!start) throw new Error("missing route");
      const cross =
        (start.x - anchor.x) * (target.y - anchor.y) - (start.y - anchor.y) * (target.x - anchor.x);
      expect(Math.abs(cross) / Math.hypot(target.x - anchor.x, target.y - anchor.y)).toBeLessThan(
        0.6,
      );
      expect(distanceToSilhouette(value, "a", start)).toBeLessThan(0.6);
      // It is not where an unanchored end (aimed at the 3D centre) would leave.
      const plain = await render(pair(["24mm", "24mm"], `, route: ${route}`));
      expect(Math.abs((plain.layout.edges[0]?.route?.points[0]?.y ?? 0) - start.y)).toBeGreaterThan(
        1,
      );
    });
  }

  const faces = (axis: "row" | "stack", route: string, ports = "face", label = "") => `version: 1
figure:
  id: faces
  theme: sumi
  profile: paper-double
  layout:
    arrange: { ${axis}: { gap: 16mm, align: ${axis === "row" ? "end" : "center"}, items: [${axis === "row" ? "a, b" : "b, a"}] } }
nodes:
  - { id: a, component: cuboid, label: "${label}", props: { ports: ${ports}, width: 6mm, height: 20mm, depth: 20mm } }
  - { id: b, component: cuboid, label: "${label}", props: { ports: ${ports}, width: 6mm, height: 20mm, depth: 20mm } }
edges:
  - { from: a, to: b${route} }
`;
  for (const route of ["", ", route: straight", ", route: curve"]) {
    test(`ports: face ends an east edge at the side face's centroid (route${route || ": default"})`, async () => {
      const value = await render(faces("row", route));
      const points = value.layout.edges[0]?.route?.points ?? [];
      const a = centreOf(value, "a").rect;
      const node = value.compiled.ir.nodes.find((n) => n.id === "a");
      const { dx, dy } = cuboidOffset(cuboid.params.parse(node?.render?.params));
      // The side face's centroid: the front's right edge moved by half the depth offset, at the box's middle height.
      expect(points[0]?.x).toBeCloseTo(a.x + a.width - dx / 2, 0);
      expect(points[0]?.y).toBeCloseTo(a.y + a.height / 2, 0);
      expect(dy).toBeGreaterThan(0);
      // The target's west face is hidden: it keeps the silhouette contact.
      const b = centreOf(value, "b").rect;
      expect(distanceToSilhouette(value, "b", points.at(-1) ?? { x: 1e9, y: 1e9 })).toBeLessThan(
        0.6,
      );
      expect(points.at(-1)?.x).toBeCloseTo(b.x, 0);
    });

    test(`ports: face ends a north edge at the top face's centroid; south keeps the silhouette (route${route || ": default"})`, async () => {
      const value = await render(faces("stack", route));
      const points = value.layout.edges[0]?.route?.points ?? [];
      const a = centreOf(value, "a").rect;
      const node = value.compiled.ir.nodes.find((n) => n.id === "a");
      const { dy } = cuboidOffset(cuboid.params.parse(node?.render?.params));
      // a is below b: its edge leaves its top face, at the middle x and half the depth offset down.
      expect(points[0]?.x).toBeCloseTo(a.x + a.width / 2, 0);
      expect(points[0]?.y).toBeCloseTo(a.y + dy / 2, 0);
      // b's south end is on the silhouette's lower edge.
      expect(distanceToSilhouette(value, "b", points.at(-1) ?? { x: 1e9, y: 1e9 })).toBeLessThan(
        0.6,
      );
    });
  }

  test("ports: face keeps written anchors", async () => {
    const anchored = await render(
      faces("row", ", fromAnchor: east:0.3").replace("ports: face", "ports: face"),
    );
    const start = anchored.layout.edges[0]?.route?.points[0];
    const a = centreOf(anchored, "a").rect;
    expect(distanceToSilhouette(anchored, "a", start ?? { x: 1e9, y: 1e9 })).toBeLessThan(0.6);
    expect(start?.y).toBeCloseTo(a.y + 0.3 * a.height, 0);
  });

  test("ports: face ends slide along their faces so unequal neighbours get one horizontal segment", async () => {
    const value = await render(`version: 1
figure:
  id: slide
  theme: sumi
  profile: paper-double
  layout:
    arrange: { row: { gap: 16mm, align: end, items: [a, b] } }
nodes:
  - { id: a, component: cuboid, props: { ports: face, width: 6mm, height: 28mm, depth: 20mm } }
  - { id: b, component: cuboid, props: { ports: face, width: 6mm, height: 12mm, depth: 12mm } }
edges:
  - { from: a, to: b }
`);
    const points = value.layout.edges[0]?.route?.points ?? [];
    expect(points).toHaveLength(2);
    expect(points[0]?.y).toBeCloseTo(points[1]?.y ?? Number.NaN, 6);
    // The start is inside a's side face: right of its front's right edge, left of the silhouette.
    const rect = centreOf(value, "a").rect;
    const node = value.compiled.ir.nodes.find((n) => n.id === "a");
    const { dx } = cuboidOffset(cuboid.params.parse(node?.render?.params));
    const frontRight = rect.x + rect.width - dx;
    expect(points[0]?.x).toBeGreaterThan(frontRight + 1);
    expect(points[0]?.x).toBeLessThan(rect.x + rect.width - 1);
    // The target's west face is hidden: its end stays on the silhouette.
    expect(distanceToSilhouette(value, "b", points.at(-1) ?? { x: 1e9, y: 1e9 })).toBeLessThan(0.6);
  });

  test("glued editable PPTX connectors start on the face centroid, not the silhouette", async () => {
    const value = await render(faces("row", ""));
    const pptx = svgToEditablePptx(value.svg, value.compiled.ir, { connectors: "glued" });
    if (!pptx.ok) throw new Error(JSON.stringify(pptx.diagnostics));
    const slide = parseXml(
      new TextDecoder().decode(readPptx(pptx.value).get("ppt/slides/slide1.xml")),
    );
    if (!slide.ok) throw new Error(slide.message);
    const all = [...descendants(slide.root)];
    const named = (name: string) =>
      all.find(
        (e) =>
          ["p:sp", "p:cxnSp"].includes(e.name) &&
          [...descendants(e)].some((n) => n.name === "p:cNvPr" && attribute(n, "name") === name),
      );
    const xfrm = (name: string) => {
      const t = [...descendants(named(name) as never)].find((e) => e.name === "a:xfrm");
      const [off, ext] = childElements(t as never);
      return {
        x: Number(attribute(off as never, "x")),
        cx: Number(attribute(ext as never, "cx")),
        flipH: attribute(t as never, "flipH") === "1",
      };
    };
    const [ra, rb] = [centreOf(value, "a").rect, centreOf(value, "b").rect];
    const [pa, pb] = [xfrm("n:a"), xfrm("n:b")];
    const scale = (pb.x - pa.x) / (rb.x - ra.x);
    const edge = value.layout.edges[0]?.route?.points ?? [];
    const connector = xfrm(value.compiled.ir.edges[0]?.key as string);
    const startX = connector.flipH ? connector.x + connector.cx : connector.x;
    expect(startX).toBeCloseTo(pa.x + ((edge[0]?.x ?? 0) - ra.x) * scale, -2);
    // It is inside the silhouette (the face centroid), well left of its right edge.
    expect(edge[0]?.x).toBeLessThan(ra.x + ra.width - 3);
  });

  const placed = (route: string, ports = "face", height = "3mm", at = "[1, 0]") => `version: 1
figure:
  id: placed
  theme: sumi
  profile: paper-double
  layout:
    arrange:
      place:
        unit: 20mm
        items:
          - { item: a, at: [0, 0] }
          - { item: b, at: ${at} }
nodes:
  - { id: a, component: cuboid, props: { ports: ${ports}, width: 6mm, height: ${height}, depth: 28mm } }
  - { id: b, component: box, label: B }
edges:
  - { from: a, to: b${route} }
`;

  test("ports: face north ends slide along the top face so unequal stacked solids get one vertical segment", async () => {
    const value = await render(`version: 1
figure:
  id: slide-north
  theme: sumi
  profile: paper-double
  layout:
    arrange: { stack: { gap: 16mm, align: start, items: [b, a] } }
nodes:
  - { id: a, component: cuboid, props: { ports: face, width: 8mm, height: 12mm, depth: 24mm } }
  - { id: b, component: cuboid, props: { ports: face, width: 24mm, height: 12mm, depth: 10mm } }
edges:
  - { from: a, to: b }
`);
    const points = value.layout.edges[0]?.route?.points ?? [];
    expect(points).toHaveLength(2);
    expect(points[0]?.x).toBeCloseTo(points[1]?.x ?? Number.NaN, 6);
    // The start is inside a's top face, below its silhouette's top edge.
    const rect = centreOf(value, "a").rect;
    expect(points[0]?.y).toBeGreaterThan(rect.y + 1);
    const node = value.compiled.ir.nodes.find((n) => n.id === "a");
    const { dy } = cuboidOffset(cuboid.params.parse(node?.render?.params));
    expect(points[0]?.y).toBeLessThan(rect.y + dy);
  });

  test("ports: face keeps the centroid when the face cannot hold the straightened line with a margin", async () => {
    const value = await render(`version: 1
figure:
  id: thin-face
  theme: sumi
  profile: paper-double
  layout:
    arrange: { row: { gap: 16mm, align: end, items: [a, b] } }
nodes:
  - { id: a, component: cuboid, props: { ports: face, width: 6mm, height: 28mm, depth: 2mm } }
  - { id: b, component: cuboid, props: { width: 6mm, height: 12mm, depth: 2mm } }
edges:
  - { from: a, to: b }
`);
    const rect = centreOf(value, "a").rect;
    const node = value.compiled.ir.nodes.find((n) => n.id === "a");
    const { dx } = cuboidOffset(cuboid.params.parse(node?.render?.params));
    // dx is about 1mm: the side face is too narrow to slide along; the end stays at its centroid.
    expect(value.layout.edges[0]?.route?.points[0]?.x).toBeCloseTo(rect.x + rect.width - dx / 2, 0);
  });

  test("ports: face with fan-out keeps the shared silhouette contact; written anchors keep their meaning", async () => {
    const value = await render(
      fan("merge", true).replaceAll("depth: 6mm", "ports: face, depth: 6mm"),
    );
    const starts = value.layout.edges.map((e) => e.route?.points[0] ?? { x: 1e9, y: 1e9 });
    expect(starts[0]?.y).toBeCloseTo(starts[1]?.y ?? Number.NaN, 6);
    // The shared end (one trunk) starts at the face centroid for every edge, never slid.
    const big = centreOf(value, "big").rect;
    const bigNode = value.compiled.ir.nodes.find((n) => n.id === "big");
    const { dx } = cuboidOffset(cuboid.params.parse(bigNode?.render?.params));
    for (const start of starts) expect(start.x).toBeCloseTo(big.x + big.width - dx / 2, 0);
    expect(Object.values(checkRoutes(value.compiled.ir, value.layout)).flat()).toEqual([]);
    const fanIn = await render(fan("merge").replaceAll("depth: 6mm", "ports: face, depth: 6mm"));
    const ends = fanIn.layout.edges.map((e) => e.route?.points.at(-1)?.y ?? Number.NaN);
    expect(ends[0]).toBeCloseTo(ends[1] ?? Number.NaN, 6);
    // A written anchor on a direct route is a silhouette contact, not the face centre.
    for (const route of ["straight", "curve"]) {
      const anchored = await render(
        placed(`, route: ${route}, fromAnchor: east:0.4`, "face", "20mm"),
      );
      const start = anchored.layout.edges[0]?.route?.points[0] ?? { x: 1e9, y: 1e9 };
      expect(distanceToSilhouette(anchored, "a", start)).toBeLessThan(0.6);
    }
  });

  for (const route of ["straight", "curve"]) {
    test(`a ${route} route from a face end that leaves through the silhouette is accepted`, async () => {
      const fine = await renderFigure(placed(`, route: ${route}`, "face", "3mm", "[1, 0]"));
      expect(fine.ok).toBe(true);
    });
  }

  test("ports: face has no lint findings (the stretch over its own face is intended), centre unchanged by default", async () => {
    for (const label of ["", "L"]) {
      const value = await render(faces("row", "", "face", label));
      expect(lintGeometry(value).filter((d) => d.severity !== "info")).toEqual([]);
    }
    const plain = await render(faces("row", "", "center"));
    const dflt = await render(faces("row", "", "center").replace("ports: center, ", ""));
    expect(dflt.layout.edges[0]?.route).toEqual(plain.layout.edges[0]?.route);
    const a = centreOf(plain, "a").rect;
    expect(plain.layout.edges[0]?.route?.points[0]?.x).toBeCloseTo(a.x + a.width, 0);
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

  test("fan-out from a cuboid keeps one shared source port at its 3D centre", async () => {
    const value = await render(fan("merge", true));
    const starts = value.layout.edges.map((e) => e.route?.points[0]?.y ?? Number.NaN);
    expect(starts[0]).toBeCloseTo(starts[1] ?? Number.NaN, 6);
    const big = centreOf(value, "big");
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
