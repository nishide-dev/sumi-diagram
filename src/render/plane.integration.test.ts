import { describe, expect, test } from "bun:test";
import { checkFigure } from "../core/check";
import type { Point } from "../layout/ir";
import { mapFlatPoint, type PlaneFrame, planeExtent, planeQuad, unmapPoint } from "../layout/plane";
import { checkRoutes } from "../layout/route/check";
import { lintGeometry } from "../lint";
import { svgToPdf } from "./pdf";
import { svgToEditablePptx } from "./pptx";
import { readPptx } from "./pptx/testing";
import { renderFigure } from "./render";
import { attribute, descendants, parseXml } from "./xml";

const NODES = { a: [18, 14], b: [50, 14], c: [82, 14], d: [18, 42], e: [50, 42], f: [82, 42] };

/** Two stacked planes with the same six nodes; in-plane edges straight or routed, dotted correspondences. */
function source({
  plane = "floor",
  inPlane = ", route: straight",
  extra = "",
  projection = "",
}: {
  plane?: string;
  inPlane?: string;
  extra?: string;
  projection?: string;
} = {}): string {
  const place = (s: string) =>
    Object.entries(NODES)
      .map(([n, [u, v]]) => `            - { item: ${n}${s}, at: [${u}, ${56 - (v as number)}] }`)
      .join("\n");
  const nodes = (s: string, tone: string) =>
    Object.keys(NODES)
      .map(
        (n) =>
          `  - { id: ${n}${s}, component: circle, label: ${n.toUpperCase()}, tone: ${tone}, props: { width: 8.6mm } }`,
      )
      .join("\n");
  return `version: 1
figure:
  id: planes
  theme: sumi
  profile: paper-double
${projection}  layout:
    arrange: { stack: { gap: 18mm, align: start, items: [ga, gb] } }
groups:
  - id: ga
    label: (a) Graph A
    props: { plane: ${plane}, padding: 10mm }
    arrange:
      place:
        unit: 1mm
        items:
${place("1")}
  - id: gb
    label: (b) Graph B
    props: { plane: ${plane}, padding: 10mm }
    arrange:
      place:
        unit: 1mm
        items:
${place("2")}
nodes:
${nodes("1", "blue")}
${nodes("2", "green")}
edges:
  - { from: a1, to: b1, component: line${inPlane} }
  - { from: b1, to: c1, component: line${inPlane} }
  - { from: a1, to: d1, component: line${inPlane} }
  - { from: d2, to: e2, component: line${inPlane} }
${Object.keys(NODES)
  .map((n) => `  - { from: ${n}2, to: ${n}1, component: line, route: straight, variant: dotted }`)
  .join("\n")}
${extra}`;
}

async function render(text: string) {
  const result = await renderFigure(text);
  if (!result.ok || !("layout" in result.value)) throw new Error(JSON.stringify(result));
  return result.value;
}

type Rendered = Awaited<ReturnType<typeof render>>;

const frameOf = (value: Rendered, key: string): PlaneFrame => {
  const plane = value.layout.planes?.find((p) => p.key === key);
  if (!plane) throw new Error(`no plane ${key}`);
  return {
    projection: {
      orientation: plane.orientation,
      angle: plane.angle,
      depthScale: plane.depthScale,
    },
    frame: plane.frame,
    origin: plane.origin,
  };
};

const center = (r: { x: number; y: number; width: number; height: number }): Point => ({
  x: r.x + r.width / 2,
  y: r.y + r.height / 2,
});

describe("tilted planes: geometry", () => {
  test("a plane's frame is a parallelogram whose box is the group's rect", async () => {
    const value = await render(source());
    const group = value.layout.groups.find((g) => g.key === "g:ga");
    if (!group?.quad) throw new Error("no quad");
    const [fl, fr, br, bl] = group.quad;
    // Front edge horizontal, back edge parallel and shifted right and up by depth.
    expect(fl.y).toBe(fr.y);
    expect(bl.y).toBe(br.y);
    expect(br.x - bl.x).toBeCloseTo(fr.x - fl.x, 2);
    const k = 0.5 * Math.cos(Math.PI / 4);
    const flat = value.layout.planes?.find((p) => p.key === "g:ga")?.frame;
    if (!flat) throw new Error("no flat frame");
    expect(bl.x - fl.x).toBeCloseTo(flat.height * k, 1);
    expect(fl.y - bl.y).toBeCloseTo(flat.height * k, 1);
    const extent = planeExtent(frameOf(value, "g:ga").projection, flat.width, flat.height);
    expect(group.rect.width).toBeCloseTo(extent.width, 1);
    expect(group.rect.height).toBeCloseTo(extent.height, 1);
    expect(group.rect.x).toBeCloseTo(Math.min(fl.x, bl.x), 2);
    // The SVG draws exactly that quadrilateral.
    const polygon = value.svg.match(
      /<g class="sumi-k-g--ga sumi-kind-group"[^>]*><g class="shape"><polygon points="([^"]*)"/,
    )?.[1];
    const drawn = (polygon ?? "").split(" ").map((p) => p.split(",").map(Number));
    expect(drawn).toHaveLength(4);
    for (const [i, p] of group.quad.entries()) {
      expect(drawn[i]?.[0]).toBeCloseTo(p.x, 2);
      expect(drawn[i]?.[1]).toBeCloseTo(p.y, 2);
    }
  });

  test("children are laid out in plane coordinates, then only their centers are mapped", async () => {
    const value = await render(source());
    const plane = value.layout.planes?.find((p) => p.key === "g:ga");
    if (!plane) throw new Error("no plane");
    const frame = frameOf(value, "g:ga");
    const flat = new Map(plane.flat.map((n) => [n.key, n.rect]));
    // The authored coordinates (mm) survive as flat distances: a at u=18, b at u=50 (32mm apart).
    const mm = (units: number) => (units * 0.5 * 25.4) / 72;
    const a = flat.get("n:a1");
    const b = flat.get("n:b1");
    const d = flat.get("n:d1");
    if (!a || !b || !d) throw new Error("missing flat rects");
    expect(mm(center(b).x - center(a).x)).toBeCloseTo(32, 1);
    expect(mm(center(a).y - center(d).y)).toBeCloseTo(28, 1);
    for (const node of value.layout.nodes.filter((n) => n.parent === "g:ga")) {
      const rect = flat.get(node.key);
      if (!rect) throw new Error(`no flat rect for ${node.key}`);
      // Upright and unscaled: a circle stays a circle of the same size.
      expect(node.rect.width).toBeCloseTo(rect.width, 2);
      expect(node.rect.height).toBeCloseTo(rect.height, 2);
      expect(node.rect.width).toBeCloseTo(node.rect.height, 2);
      const mapped = mapFlatPoint(frame, center(rect));
      expect(center(node.rect).x).toBeCloseTo(mapped.x, 1);
      expect(center(node.rect).y).toBeCloseTo(mapped.y, 1);
    }
    // Labels stay horizontal and inside their node.
    expect(value.svg).not.toMatch(/<text[^>]*transform="rotate/);
    expect(value.svg.match(/<circle /g)).toHaveLength(12);
  });

  test("the title sits under the front edge, left-aligned, outside the frame", async () => {
    const value = await render(source());
    const group = value.layout.groups.find((g) => g.key === "g:ga");
    if (!group?.label || !group.quad) throw new Error("no label");
    expect(group.label.textAlign).toBe("left");
    expect(group.label.box.x).toBeCloseTo(group.rect.x, 1);
    expect(group.label.box.y).toBeGreaterThan(group.rect.y + group.rect.height);
    expect(group.label.box.y + group.label.box.height).toBeLessThanOrEqual(
      (value.layout.groups.find((g) => g.key === "g:gb")?.rect.y ?? 0) + 0.01,
    );
  });

  test("planes stack vertically by their projected height, not their flat one", async () => {
    const value = await render(source());
    const upper = value.layout.groups.find((g) => g.key === "g:ga");
    const lower = value.layout.groups.find((g) => g.key === "g:gb");
    if (!upper || !lower) throw new Error("missing groups");
    const flat = value.layout.planes?.find((p) => p.key === "g:ga")?.frame;
    expect(upper.rect.height).toBeLessThan((flat?.height ?? 0) * 0.5);
    expect(lower.rect.y).toBeGreaterThan(upper.rect.y + upper.rect.height);
    expect(lower.rect.x).toBeCloseTo(upper.rect.x, 2);
  });

  test("a wall maps its flat x axis into the depth and its flat y axis up", async () => {
    const value = await render(source({ plane: "wall" }));
    const group = value.layout.groups.find((g) => g.key === "g:ga");
    const flat = value.layout.planes?.find((p) => p.key === "g:ga");
    if (!group?.quad || !flat) throw new Error("no wall");
    const k = 0.5 * Math.cos(Math.PI / 4);
    const [fl, fr, br, bl] = group.quad;
    // The front edge is vertical, the near-left corner is at the bottom of the box.
    expect(bl.x).toBeCloseTo(fl.x, 2);
    expect(fl.y - bl.y).toBeCloseTo(flat.frame.height, 1);
    expect(fr.x - fl.x).toBeCloseTo(flat.frame.width * k, 1);
    expect(fl.y - fr.y).toBeCloseTo(flat.frame.width * k, 1);
    expect(br.x - bl.x).toBeCloseTo(fr.x - fl.x, 2);
    const extent = planeExtent(
      frameOf(value, "g:ga").projection,
      flat.frame.width,
      flat.frame.height,
    );
    expect(group.rect.width).toBeCloseTo(extent.width, 1);
    expect(group.rect.height).toBeCloseTo(extent.height, 1);
  });

  test("the plane uses figure.projection", async () => {
    const value = await render(
      source({ projection: "  projection: { angle: 30, depthScale: 0.7 }\n" }),
    );
    const plane = value.layout.planes?.find((p) => p.key === "g:ga");
    expect(plane?.angle).toBe(30);
    expect(plane?.depthScale).toBe(0.7);
    const group = value.layout.groups.find((g) => g.key === "g:ga");
    const quad = planeQuad(frameOf(value, "g:ga"));
    const [, , br] = group?.quad ?? [];
    expect(br?.x).toBeCloseTo(quad[2]?.x ?? Number.NaN, 1);
    expect(br?.y).toBeCloseTo(quad[2]?.y ?? Number.NaN, 1);
  });
});

describe("tilted planes: edges", () => {
  test("a straight edge inside a plane is a straight line between the mapped nodes, ending on their outlines", async () => {
    const value = await render(source());
    const edge = value.layout.edges.find((e) => e.from === "n:a1" && e.to === "n:b1");
    const route = edge?.route;
    if (!route) throw new Error("not routed");
    expect(route.points).toHaveLength(2);
    const nodes = new Map(value.layout.nodes.map((n) => [n.key, n.rect]));
    const [p, q] = route.points as [Point, Point];
    for (const [point, key] of [
      [p, "n:a1"],
      [q, "n:b1"],
    ] as const) {
      const rect = nodes.get(key);
      if (!rect) throw new Error("missing node");
      const c = center(rect);
      expect(Math.hypot(point.x - c.x, point.y - c.y)).toBeCloseTo(rect.width / 2, 1);
    }
  });

  test("a routed edge inside a plane runs along the plane's axes and ends on the node outlines", async () => {
    const value = await render(source({ inPlane: "" }));
    const nodes = new Map(value.layout.nodes.map((n) => [n.key, n.rect]));
    let checked = 0;
    for (const edge of value.layout.edges) {
      const plane = value.layout.planes?.find(
        (pl) => pl.flat.some((n) => n.key === edge.from) && pl.flat.some((n) => n.key === edge.to),
      );
      const points = edge.route?.points;
      if (!plane || points === undefined) continue;
      checked++;
      expect(points.length).toBeGreaterThanOrEqual(2);
      // Back in plane coordinates the route is orthogonal.
      const frame = frameOf(value, plane.key);
      const flat = points.map((p) => unmapPoint(frame, p));
      for (const [i, p] of flat.slice(1).entries()) {
        const q = flat[i] as Point;
        expect(Math.min(Math.abs(p.x - q.x), Math.abs(p.y - q.y))).toBeLessThan(0.01);
      }
      // On the page its legs are parallel to the frame's sides: horizontal, or along depth.
      const k = 0.5 * Math.cos(Math.PI / 4);
      for (const [i, p] of points.slice(1).entries()) {
        const q = points[i] as Point;
        const dx = p.x - q.x;
        const dy = p.y - q.y;
        const horizontal = Math.abs(dy) < 0.01;
        const slanted = Math.abs(dx * k + dy * k) < 0.01 + 0.001 * Math.hypot(dx, dy);
        expect(horizontal || slanted).toBe(true);
      }
      for (const [point, key] of [
        [points[0], edge.from],
        [points[points.length - 1], edge.to],
      ] as const) {
        const rect = nodes.get(key);
        if (!rect || !point) throw new Error("missing node");
        const c = center(rect);
        expect(Math.hypot(point.x - c.x, point.y - c.y)).toBeCloseTo(rect.width / 2, 1);
      }
    }
    expect(checked).toBe(4);
  });

  test("a correspondence edge is straight between the mapped nodes of two planes", async () => {
    const value = await render(source());
    const edge = value.layout.edges.find((e) => e.from === "n:a2" && e.to === "n:a1");
    const points = edge?.route?.points;
    if (!points) throw new Error("not routed");
    expect(points).toHaveLength(2);
    const nodes = new Map(value.layout.nodes.map((n) => [n.key, n.rect]));
    const lower = center(nodes.get("n:a2") as never);
    const upper = center(nodes.get("n:a1") as never);
    // Same (u, v) in both planes: straight up, from the lower node's top to the upper node's bottom.
    expect(points[0]?.x).toBeCloseTo(lower.x, 1);
    expect(points[1]?.x).toBeCloseTo(upper.x, 1);
    expect(lower.x).toBeCloseTo(upper.x, 1);
    expect(points[0]?.y).toBeLessThan(lower.y);
    expect(points[1]?.y).toBeGreaterThan(upper.y);
  });

  test("correspondences are painted behind the upper plane and faintly over it", async () => {
    const value = await render(source());
    const svg = value.svg;
    const lowerFrame = svg.indexOf('class="sumi-k-g--gb sumi-kind-group"');
    const upperFrame = svg.indexOf('class="sumi-k-g--ga sumi-kind-group"');
    expect(lowerFrame).toBeGreaterThan(-1);
    expect(upperFrame).toBeGreaterThan(lowerFrame);
    const dotted = [...svg.matchAll(/<path class="sumi-wire"[^>]*stroke-dasharray="0,[^"]*"/g)].map(
      (m) => m.index ?? -1,
    );
    expect(dotted).toHaveLength(6);
    // Painted after the lower plane and before the upper one, which hides the part they cross.
    for (const at of dotted) {
      expect(at).toBeGreaterThan(lowerFrame);
      expect(at).toBeLessThan(upperFrame);
    }
    // One faint copy per line over the upper plane, in a lighter color, after its frame.
    const ghosts = [...svg.matchAll(/<path class="sumi-plane-ghost"[^>]*>/g)];
    expect(ghosts).toHaveLength(6);
    for (const g of ghosts) expect(g.index).toBeGreaterThan(upperFrame);
    const ink = (s: string) => s.match(/stroke="(#[0-9a-f]{6})"/)?.[1];
    const lum = (hex?: string) => Number.parseInt((hex ?? "#000000").slice(1, 3), 16);
    const wire = svg.slice(dotted[0] ?? 0).match(/<path class="sumi-wire"[^>]*>/)?.[0] ?? "";
    expect(lum(ink(ghosts[0]?.[0] ?? ""))).toBeGreaterThan(lum(ink(wire)));
    // The ghost is not an element of the figure: the key's class appears once per edge.
    expect(svg.match(/sumi-kind-edge/g)).toHaveLength(value.layout.edges.length);
  });

  test("the geometry lint is clean on the transformed figure, and the routes check", async () => {
    const value = await render(source());
    expect(lintGeometry(value).filter((d) => d.severity !== "info")).toEqual([]);
    expect(Object.values(checkRoutes(value.compiled.ir, value.layout)).flat()).toEqual([]);
  });

  test("every node center lies inside its plane's parallelogram", async () => {
    const value = await render(source());
    const quad = value.layout.groups.find((g) => g.key === "g:ga")?.quad;
    if (!quad) throw new Error("no quad");
    for (const node of value.layout.nodes.filter((n) => n.parent === "g:ga")) {
      const c = center(node.rect);
      for (const [i, p] of quad.entries()) {
        const q = quad[(i + 1) % 4] as Point;
        const cross = (q.x - p.x) * (c.y - p.y) - (q.y - p.y) * (c.x - p.x);
        expect(cross).toBeLessThanOrEqual(0.001);
      }
    }
  });

  test("the geometry lint judges the mapped geometry: nodes apart in the flat frame can overlap on the page", async () => {
    // 9mm apart along u and 20mm along v: disjoint in plane coordinates (8.6mm circles),
    // but 1.9mm apart across and 7.1mm along the page, so the circles overlap.
    const text = `version: 1
figure: { id: x, theme: sumi, profile: paper-double, layout: { arrange: { row: { items: [p] } } } }
groups:
  - id: p
    props: { plane: floor, padding: 8mm }
    arrange: { place: { unit: 1mm, items: [{ item: a, at: [9, 20] }, { item: b, at: [0, 0] }] } }
nodes:
  - { id: a, component: circle, label: A, props: { width: 8.6mm } }
  - { id: b, component: circle, label: B, props: { width: 8.6mm } }
`;
    const value = await render(text);
    const flat = value.layout.planes?.[0]?.flat ?? [];
    const [a, b] = flat;
    if (!a || !b) throw new Error("missing flat rects");
    expect(
      Math.max(
        Math.abs(center(a.rect).x - center(b.rect).x),
        Math.abs(center(a.rect).y - center(b.rect).y),
      ),
    ).toBeGreaterThan(a.rect.width);
    const codes = lintGeometry(value).map((d) => d.code);
    expect(codes.some((c) => c.startsWith("geometry/") && /overlap|collision/.test(c))).toBe(true);
  });

  test("a straight correspondence that runs through a mapped node is reported", async () => {
    // On walls the stacked nodes' vertical lines run through the nodes above them.
    const value = await render(source({ plane: "wall" }));
    expect(lintGeometry(value).map((d) => d.code)).toContain("geometry/edge-through-node");
  });
});

describe("tilted planes: congested routed edges", () => {
  const cases: [string, string][] = [
    [
      "a crossing pair",
      "  - { from: b2, to: d2, component: line }\n  - { from: a2, to: e2, component: line }\n",
    ],
    [
      "a column of links",
      "  - { from: d1, to: a1, component: line }\n  - { from: e1, to: b1, component: line }\n  - { from: f1, to: c1, component: line }\n",
    ],
    ["a link beside the grid", "  - { from: c2, to: d2, component: line }\n"],
  ];
  for (const [name, extra] of cases) {
    test(`${name}: routes keep clear of upright nodes, never re-enter their own ends and are not drawn on top of one another`, async () => {
      const value = await render(source({ inPlane: "", extra }));
      const warnings = lintGeometry(value).filter((d) => d.severity !== "info");
      expect(warnings.map((d) => `${d.code}: ${d.message}`)).toEqual([]);
      const regions = new Map(value.layout.nodes.map((n) => [n.key, n.rect] as const));
      for (const edge of value.layout.edges) {
        const plane = value.layout.planes?.find(
          (pl) =>
            pl.flat.some((n) => n.key === edge.from) && pl.flat.some((n) => n.key === edge.to),
        );
        const points = edge.route?.points;
        if (!plane || !points || edge.route?.net === undefined) continue;
        for (const [i, p] of points.slice(1).entries()) {
          const q = points[i] as Point;
          for (const [key, rect] of regions) {
            if (key === edge.from && i === 0) continue;
            if (key === edge.to && i === points.length - 2) continue;
            const c = center(rect);
            // Distance from the node's center to the segment, against the circle's radius.
            const dx = p.x - q.x;
            const dy = p.y - q.y;
            const len2 = dx * dx + dy * dy;
            const t =
              len2 === 0
                ? 0
                : Math.max(0, Math.min(1, ((c.x - q.x) * dx + (c.y - q.y) * dy) / len2));
            const d = Math.hypot(q.x + t * dx - c.x, q.y + t * dy - c.y);
            expect(d, `${edge.key} segment ${i} vs ${key}`).toBeGreaterThanOrEqual(
              rect.width / 2 - 0.05,
            );
          }
        }
      }
    });
  }
});

describe("tilted planes: routes the projection squeezes together", () => {
  test("two long parallel routes that the projection pulls onto one line are reported by the geometry lint", async () => {
    const value = await render(
      source({
        inPlane: "",
        extra:
          "  - { from: a2, to: f2, component: line }\n  - { from: c2, to: d2, component: line }\n",
      }),
    );
    expect(lintGeometry(value).map((d) => d.code)).toContain("geometry/edge-near-edge");
  });
});

describe("tilted planes: outputs", () => {
  test("PDF and editable PPTX draw the parallelogram frames and the mapped edges", async () => {
    const value = await render(source({ inPlane: "" }));
    expect(svgToPdf(value.svg).ok).toBe(true);
    const pptx = svgToEditablePptx(value.svg, value.compiled.ir, { connectors: "freeform" });
    if (!pptx.ok) throw new Error(JSON.stringify(pptx.diagnostics));
    const slide = parseXml(
      new TextDecoder().decode(readPptx(pptx.value).get("ppt/slides/slide1.xml")),
    );
    if (!slide.ok) throw new Error(slide.message);
    const shapes = [...descendants(slide.root)].filter((e) => e.name === "p:sp");
    const named = (name: string) =>
      shapes.find((sp) =>
        [...descendants(sp)].some((e) => e.name === "p:cNvPr" && attribute(e, "name") === name),
      );
    const frame = named("g:ga");
    if (!frame) throw new Error("no frame shape");
    const points = [...descendants(frame)].filter((e) => e.name === "a:pt");
    // moveTo + three lineTo of a closed parallelogram, not a rectangle.
    expect(points).toHaveLength(4);
    expect([...descendants(frame)].some((e) => e.name === "a:prstGeom")).toBe(false);
    const xs = points.map((p) => Number(attribute(p, "x")));
    expect(new Set(xs).size).toBe(4);
    // A bent in-plane route: its freeform holds exactly the mapped points of the layout.
    const bent = await render(
      source({ inPlane: "", extra: "  - { from: b2, to: d2, component: line }\n" }),
    );
    const bentPptx = svgToEditablePptx(bent.svg, bent.compiled.ir, { connectors: "freeform" });
    if (!bentPptx.ok) throw new Error(JSON.stringify(bentPptx.diagnostics));
    const bentSlide = parseXml(
      new TextDecoder().decode(readPptx(bentPptx.value).get("ppt/slides/slide1.xml")),
    );
    if (!bentSlide.ok) throw new Error(bentSlide.message);
    const edge = bent.layout.edges.find((e) => e.from === "n:b2" && e.to === "n:d2");
    const route = edge?.route?.points ?? [];
    expect(route.length).toBeGreaterThan(2);
    const index = bent.compiled.ir.edges.findIndex((e) => e.key === edge?.key);
    const edgeShape = [...descendants(bentSlide.root)]
      .filter((e) => e.name === "p:sp")
      .find((sp) =>
        [...descendants(sp)].some(
          (e) => e.name === "p:cNvPr" && attribute(e, "name") === `e:#${index}`,
        ),
      );
    if (!edgeShape) throw new Error("no edge shape");
    const off = [...descendants(edgeShape)].find((e) => e.name === "a:off");
    const pts = [...descendants(edgeShape)].filter((e) => e.name === "a:pt");
    expect(pts).toHaveLength(route.length);
    const EMU = 6350;
    for (const [i, pt] of pts.entries()) {
      const x = Number(attribute(off as never, "x")) + Number(attribute(pt, "x"));
      const y = Number(attribute(off as never, "y")) + Number(attribute(pt, "y"));
      expect(Math.abs(x - (route[i]?.x ?? 0) * EMU)).toBeLessThan(40);
      expect(Math.abs(y - (route[i]?.y ?? 0) * EMU)).toBeLessThan(40);
    }
    // Glued connectors render too.
    const glued = svgToEditablePptx(value.svg, value.compiled.ir, { connectors: "glued" });
    expect(glued.ok).toBe(true);
  });
});

describe("tilted planes: checks", () => {
  const diagnostics = (text: string) =>
    checkFigure(text).state.diagnostics.filter((d) => d.severity === "error");

  test("a plane needs the structured layout", () => {
    const found = diagnostics(`version: 1
figure: { id: x, theme: sumi, profile: paper-double }
groups:
  - { id: g, props: { plane: floor } }
nodes:
  - { id: a, group: g, component: box, label: A }
`);
    expect(found.map((d) => d.code)).toContain("layout/structured-only");
  });

  test("a plane cannot have layers or be plain", () => {
    const found = diagnostics(`version: 1
figure: { id: x, theme: sumi, profile: paper-double, layout: { arrange: { row: { items: [g, h] } } } }
groups:
  - { id: g, props: { plane: floor, layers: { count: 2, offset: 3pt } }, arrange: { row: { items: [a] } } }
  - { id: h, variant: plain, props: { plane: wall }, arrange: { row: { items: [b] } } }
nodes:
  - { id: a, component: box, label: A }
  - { id: b, component: box, label: B }
`);
    expect(found.map((d) => d.code)).toEqual(["component/invalid-prop", "component/invalid-prop"]);
    expect(found.map((d) => d.path?.[1])).toEqual([0, 1]);
  });

  test("a group inside a plane is a located error; the plane stays valid", () => {
    const found = diagnostics(`version: 1
figure: { id: x, theme: sumi, profile: paper-double, layout: { arrange: { row: { items: [p] } } } }
groups:
  - { id: p, props: { plane: floor }, arrange: { row: { items: [inner] } } }
  - { id: inner, arrange: { row: { items: [a] } } }
nodes:
  - { id: a, component: box, label: A }
`);
    expect(found.map((d) => d.code)).toEqual(["layout/plane-nested-group"]);
    expect(found[0]?.subject).toEqual({ kind: "group", id: "inner" });
    expect(found[0]?.location).toBeDefined();
  });

  test("the plane value is validated", () => {
    expect(
      diagnostics(`version: 1
figure: { id: x, theme: sumi, profile: paper-double, layout: { arrange: { row: { items: [p] } } } }
groups:
  - { id: p, props: { plane: ceiling }, arrange: { row: { items: [a] } } }
nodes:
  - { id: a, component: box, label: A }
`).length,
    ).toBeGreaterThan(0);
  });
});
