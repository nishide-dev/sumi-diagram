/**
 * Projected tilted planes (#577, `props.contents: projected`) end to end: the outlines of the
 * nodes, the arrowheads and the matrix cells are the flat shapes mapped by the plane's affine
 * map, edges end on those outlines, labels stay horizontal, and a plane without `contents`
 * (or with `upright`) draws exactly what it drew before.
 */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkFigure } from "../core/check";
import type { Point } from "../layout/ir";
import {
  insideConvex,
  type PlaneFrame,
  planeFrameOf,
  planeQuad,
  unmapPoint,
} from "../layout/plane";
import { lintGeometry } from "../lint";
import { svgToPdf } from "./pdf";
import { source } from "./plane-projected.testing";
import { svgToEditablePptx } from "./pptx";
import { readPptx } from "./pptx/testing";
import { renderFigure } from "./render";
import { attribute, descendants, parseXml } from "./xml";

const ROOT = join(import.meta.dir, "..", "..");

async function render(text: string) {
  const result = await renderFigure(text);
  if (!result.ok || !("layout" in result.value)) throw new Error(JSON.stringify(result));
  return result.value;
}
type Rendered = Awaited<ReturnType<typeof render>>;

const frameOf = (value: Rendered, key: string): PlaneFrame => {
  const plane = value.layout.planes?.find((p) => p.key === key);
  if (!plane) throw new Error(`no plane ${key}`);
  return planeFrameOf(plane);
};

const centerOf = (r: { x: number; y: number; width: number; height: number }): Point => ({
  x: r.x + r.width / 2,
  y: r.y + r.height / 2,
});

/** The distance from `p` to the closed polygon's boundary. */
function boundaryDistance(polygon: readonly Point[], p: Point): number {
  let best = Number.POSITIVE_INFINITY;
  for (const [i, a] of polygon.entries()) {
    const b = polygon[(i + 1) % polygon.length] as Point;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return best;
}

const outlineOf = (value: Rendered, key: string): Point[] => {
  const outline = value.layout.nodes.find((n) => n.key === key)?.outline;
  if (outline === undefined) throw new Error(`no outline for ${key}`);
  return [...outline];
};

describe("projected planes: shapes lie on the plane", () => {
  test("a circle becomes the ellipse that is the image of the flat circle", async () => {
    const value = await render(source());
    const frame = frameOf(value, "g:ga");
    const plane = value.layout.planes?.find((p) => p.key === "g:ga");
    for (const flat of plane?.flat ?? []) {
      const outline = outlineOf(value, flat.key);
      const c = centerOf(flat.rect);
      const r = flat.rect.width / 2;
      expect(flat.rect.width).toBeCloseTo(flat.rect.height, 2);
      // Mapped back onto the flat frame every outline point is on the flat circle.
      for (const p of outline) {
        const q = unmapPoint(frame, p);
        expect(Math.hypot(q.x - c.x, q.y - c.y)).toBeCloseTo(r, 1);
      }
      // 64 samples, an ellipse: wider than tall by the plane's foreshortening.
      expect(outline).toHaveLength(64);
      const bbox = value.layout.nodes.find((n) => n.key === flat.key)?.rect;
      expect(bbox?.width).toBeGreaterThan((bbox?.height ?? 0) * 2);
      // The node's rectangle is the polygon's bounding box, and the label is at its center.
      const xs = outline.map((p) => p.x);
      const ys = outline.map((p) => p.y);
      expect(bbox?.x).toBeCloseTo(Math.min(...xs), 2);
      expect(bbox?.width).toBeCloseTo(Math.max(...xs) - Math.min(...xs), 2);
      expect(bbox?.y).toBeCloseTo(Math.min(...ys), 2);
      expect(bbox?.height).toBeCloseTo(Math.max(...ys) - Math.min(...ys), 2);
    }
  });

  test("a rectangle is a parallelogram with the plane's edges, inside the plane's frame", async () => {
    const value = await render(source({ shape: "box" }));
    const quad = planeQuad(frameOf(value, "g:ga"));
    for (const key of ["n:a1", "n:b1", "n:c1", "n:d1"]) {
      const outline = outlineOf(value, key);
      expect(outline.length).toBeGreaterThanOrEqual(4);
      // Every corner (rounded corners are samples) is inside the plane's parallelogram.
      for (const p of outline) expect(insideConvex(quad, p)).toBe(true);
    }
    const sharp = await render(
      source({ shape: "box" }).replaceAll("component: box", "component: box, variant: default"),
    );
    expect(sharp.layout.nodes.find((n) => n.key === "n:a1")?.outline).toBeDefined();
    // The drawn polygon is the layout's outline.
    const drawn = value.svg.match(
      /<g class="sumi-k-n--a1 sumi-kind-node"[^>]*><g class="shape"><polygon points="([^"]*)" class="sumi-projected"/,
    )?.[1];
    const points = (drawn ?? "").split(" ").map((p) => p.split(",").map(Number));
    const outline = outlineOf(value, "n:a1");
    expect(points).toHaveLength(outline.length);
    for (const [i, p] of outline.entries()) {
      expect(points[i]?.[0]).toBeCloseTo(p.x, 2);
      expect(points[i]?.[1]).toBeCloseTo(p.y, 2);
    }
  });

  test("a wall maps the flat shape into the depth: the unmapped outline is the flat rectangle", async () => {
    const value = await render(source({ shape: "diamond", plane: "wall" }));
    const frame = frameOf(value, "g:ga");
    const plane = value.layout.planes?.find((p) => p.key === "g:ga");
    for (const flat of plane?.flat ?? []) {
      const c = centerOf(flat.rect);
      const outline = outlineOf(value, flat.key);
      expect(outline).toHaveLength(4);
      const back = outline.map((p) => unmapPoint(frame, p));
      // The four vertices of the flat diamond: top, right, bottom, left of the flat rectangle.
      const expected = [
        { x: c.x, y: flat.rect.y },
        { x: flat.rect.x + flat.rect.width, y: c.y },
        { x: c.x, y: flat.rect.y + flat.rect.height },
        { x: flat.rect.x, y: c.y },
      ];
      for (const [i, q] of back.entries()) {
        expect(q.x).toBeCloseTo((expected[i] as Point).x, 1);
        expect(q.y).toBeCloseTo((expected[i] as Point).y, 1);
      }
    }
  });

  test("labels stay horizontal, centred on the node, and fit inside its mapped outline", async () => {
    const value = await render(source());
    expect(value.svg).not.toMatch(/<text[^>]*transform=/);
    for (const node of value.layout.nodes) {
      const label = node.label;
      if (label === undefined) continue;
      expect(label.rotation).toBeUndefined();
      const c = centerOf(node.rect);
      expect(centerOf(label.box).x).toBeCloseTo(c.x, 1);
      expect(centerOf(label.box).y).toBeCloseTo(c.y, 1);
      // The node grew until its label fits: all four corners of the label box are inside.
      const outline = outlineOf(value, node.key);
      for (const [sx, sy] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ] as const)
        expect(
          insideConvex(outline, {
            x: c.x + (sx * label.box.width) / 2,
            y: c.y + (sy * label.box.height) / 2,
          }),
        ).toBe(true);
    }
  });

  test("a written width keeps its size and the label overflow is the lint's to report", async () => {
    const value = await render(
      source().replaceAll("tone: blue }", "tone: blue, props: { width: 4mm } }"),
    );
    const plane = value.layout.planes?.find((p) => p.key === "g:ga");
    for (const flat of plane?.flat ?? []) expect(flat.rect.width).toBeLessThan(25);
    const text = source().replaceAll("tone: blue }", "tone: blue, props: { width: 4mm } }");
    const codes = lintGeometry(value, { source: text, file: "narrow.sumi.yaml" }).map(
      (d) => d.code,
    );
    expect(codes).toContain("geometry/label-overflow");
  });

  test("outline components, images and nodes with glyphs stay upright", async () => {
    const text = source({ shape: "circle" }).replace(
      "  - { id: a1, component: circle, label: A, tone: blue }",
      "  - { id: a1, component: bubble, label: A, tone: blue }",
    );
    const value = await render(text);
    expect(value.layout.nodes.find((n) => n.key === "n:a1")?.outline).toBeUndefined();
    expect(value.layout.nodes.find((n) => n.key === "n:b1")?.outline).toBeDefined();
  });
});

describe("projected planes: edges meet the projected outlines", () => {
  test("straight edges (in a plane and across planes) end on the outlines of both nodes", async () => {
    const value = await render(source());
    for (const edge of value.layout.edges) {
      const route = edge.route?.points ?? [];
      const first = route[0] as Point;
      const last = route[route.length - 1] as Point;
      expect(boundaryDistance(outlineOf(value, edge.from), first)).toBeLessThan(0.6);
      expect(boundaryDistance(outlineOf(value, edge.to), last)).toBeLessThan(0.6);
    }
  });

  test("routed edges in a plane end on the outlines and run along the plane's axes", async () => {
    const value = await render(source({ inPlane: "route: auto" }).replaceAll(", route: auto", ""));
    const frame = frameOf(value, "g:ga");
    const edge = value.layout.edges.find((e) => e.from === "n:a1" && e.to === "n:d1");
    const route = edge?.route?.points ?? [];
    expect(route.length).toBeGreaterThanOrEqual(2);
    expect(boundaryDistance(outlineOf(value, "n:a1"), route[0] as Point)).toBeLessThan(0.6);
    expect(boundaryDistance(outlineOf(value, "n:d1"), route.at(-1) as Point)).toBeLessThan(0.6);
    // In plane coordinates the legs are horizontal or vertical.
    const flat = route.map((p) => unmapPoint(frame, p));
    for (const [i, a] of flat.entries()) {
      const b = flat[i + 1];
      if (b === undefined) continue;
      expect(Math.min(Math.abs(a.x - b.x), Math.abs(a.y - b.y))).toBeLessThan(0.05);
    }
  });

  test("an arrowhead lies flat on the plane: in plane coordinates it is a symmetric triangle", async () => {
    const value = await render(source({ shape: "box" }));
    const frame = frameOf(value, "g:ga");
    const head = [
      ...descendants(
        parseXml(value.svg).ok
          ? (parseXml(value.svg) as never as { root: never }).root
          : (undefined as never),
      ),
    ]
      .filter((e) => (e as { name: string }).name === "polygon")
      .map((e) => e as never)
      .find((e) => (attribute(e, "class") ?? "").includes("sumi-plane-head"));
    if (head === undefined) throw new Error("no flat arrowhead");
    const pts = (attribute(head, "points") ?? "").split(" ").map((p) => {
      const [x, y] = p.split(",").map(Number);
      return unmapPoint(frame, { x: x as number, y: y as number });
    });
    expect(pts).toHaveLength(3);
    const [tip, left, right] = pts as [Point, Point, Point];
    const d = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
    expect(d(tip, left)).toBeCloseTo(d(tip, right), 1);
    // The tip is on the outline of the node it points at.
    const edge = value.layout.edges.find((e) => e.from === "n:a1" && e.to === "n:b1");
    const end = edge?.route?.points.at(-1) as Point;
    expect(unmapPoint(frame, end).x).toBeCloseTo(tip.x, 1);
    expect(unmapPoint(frame, end).y).toBeCloseTo(tip.y, 1);
    // An upright plane draws the ordinary head.
    const upright = await render(source({ contents: "upright", shape: "box" }));
    expect(upright.svg).not.toContain("sumi-plane-head");
  });

  test("lint --geometry has no error or warning on the projected figure", async () => {
    const text = source({ shape: "box" });
    const value = await render(text);
    const found = lintGeometry(value, { source: text, file: "projected.sumi.yaml" });
    expect(found.filter((d) => d.severity !== "info").map((d) => `${d.code} ${d.message}`)).toEqual(
      [],
    );
  });
});

describe("projected planes: an upright node among projected ones", () => {
  const mixed = () =>
    source({ inPlane: "" })
      .replace("  - { id: b1, component: circle,", "  - { id: b1, component: bubble,")
      .replaceAll(", route: straight, ", ", ")
      .replace(
        "  - { from: a2, to: d2, component: line, }",
        "  - { from: a2, to: d2, component: line }",
      );

  test("routed edges to and past it end on, and keep out of, its box", async () => {
    const value = await render(mixed());
    const upright = value.layout.nodes.find((n) => n.key === "n:b1");
    expect(upright?.outline).toBeUndefined();
    expect(value.layout.nodes.find((n) => n.key === "n:a1")?.outline).toBeDefined();
    const rect = upright?.rect as { x: number; y: number; width: number; height: number };
    const within = (p: Point, margin: number) =>
      p.x > rect.x + margin &&
      p.x < rect.x + rect.width - margin &&
      p.y > rect.y + margin &&
      p.y < rect.y + rect.height - margin;
    const toIt = value.layout.edges.filter((e) => e.from === "n:b1" || e.to === "n:b1");
    expect(toIt.length).toBeGreaterThan(0);
    for (const edge of value.layout.edges) {
      const pts = edge.route?.points ?? [];
      if (pts.length < 2 || edge.from === "n:a2") continue;
      const ends = edge.from === "n:b1" || edge.to === "n:b1";
      for (const [i, p] of pts.entries()) {
        const isEnd = ends && (i === 0 || i === pts.length - 1);
        // An end touches the box (within 2 units of its edge); no other point is inside it.
        if (isEnd && (edge.from === "n:b1") === (i === 0)) {
          const dx = Math.min(Math.abs(p.x - rect.x), Math.abs(p.x - rect.x - rect.width));
          const dy = Math.min(Math.abs(p.y - rect.y), Math.abs(p.y - rect.y - rect.height));
          expect(Math.min(dx, dy)).toBeLessThan(2.5);
        } else if (edge.from !== "n:b1" && edge.to !== "n:b1") {
          expect(within(p, 1)).toBe(false);
        }
      }
    }
  });
});

describe("projected planes: default output is unchanged", () => {
  test("no contents, contents: upright and the old drawing are the same SVG", async () => {
    const plain = await render(source({ contents: "" }));
    const upright = await render(source({ contents: "upright" }));
    // Only the hash of the written source differs.
    const body = (svg: string) => svg.replace(/input-sha256="[^"]*"/, "");
    expect(body(upright.svg)).toBe(body(plain.svg));
    expect(plain.svg).not.toContain("sumi-projected");
    expect(plain.layout.nodes.every((n) => n.outline === undefined)).toBe(true);
  });

  // SHA-256 of the SVG (input hash stripped) that origin/main (before #586) drew for the same
  // sources: planes without `contents` must keep drawing exactly that.
  const BASELINE: Record<string, string> = {
    "circle/floor/route: straight":
      "9769f82c90565d73efd413066ba20572fc56549893ff49a226319ffa46699062",
    "circle/floor/route: auto": "a4b94ed1cf0ad39efc63c90b9011ce83c1807a379ae308f6e478e97c118b5b3a",
    "circle/wall/route: straight":
      "ada03c3ddb1ca18c97192ae40ad9af7b8ae2573c4905cf439ad10054a7fb3a47",
    "circle/wall/route: auto": "4c5a4f683a2976854eacb63dca0238f09cb50d0d3c313a71bbfafb0e6c020cea",
    "box/floor/route: straight": "7a6899f1bee8152a011921214be1ff6b38b4ba4c25331209bd77cce2de423c44",
    "box/floor/route: auto": "4e447bad83dbd3631677b8c6fdfeda468bbaedcc603446aa6554caed66c629f6",
    "box/wall/route: straight": "63401f1ec55c9d203eabe15792743ed7d5a4aeffa69d013ac6167a4f707bb980",
    "box/wall/route: auto": "d94d5a4115618bbfb90499b9abac4cf76a59b3ea4b870290878dc655d54e9f29",
  };
  test.each(Object.keys(BASELINE))("%s: the SVG is the one origin/main drew", async (name) => {
    const [shape, plane, inPlane] = name.split("/") as [string, string, string];
    for (const contents of ["", "upright"]) {
      const text = source({ contents, shape, plane, inPlane }).replaceAll(", route: auto", "");
      const value = await render(text);
      const hash = createHash("sha256")
        .update(value.svg.replace(/input-sha256="[^"]*"/, ""))
        .digest("hex");
      expect(hash).toBe(BASELINE[name] as string);
    }
  });

  test("a projected plane differs and the upright one keeps its upright circles", async () => {
    const projected = await render(source());
    const plain = await render(source({ contents: "" }));
    expect(projected.svg).not.toBe(plain.svg);
    expect(plain.svg.match(/<circle /g)).toHaveLength(8);
    expect(projected.svg.match(/<circle /g)).toBeNull();
  });
});

/** A plane that holds a matrix. */
function matrixSource(contents: string): string {
  return `version: 1
figure:
  id: matrix-plane
  theme: sumi
  profile: paper-double
  layout:
    arrange: { stack: { gap: 8mm, align: start, items: [sheet, key] } }
groups:
  - id: sheet
    label: Attention
    props: { plane: floor, contents: ${contents}, padding: 6mm }
    arrange:
      place:
        unit: 1mm
        items: [{ item: m, at: [0, 0] }]
nodes:
  - id: m
    component: matrix
    props:
      columns: [A, B, C]
      rows: [A, B, C]
      cellWidth: 30pt
      cellHeight: 34pt
      gap: 2pt
      headerGap: 12pt
      classes:
        h: { tone: orange, variant: tinted, label: high }
        l: { variant: muted, label: low }
      cells: [hll, lhl, llh]
  - id: key
    component: legend
    variant: plain
    props: { flow: row, entries: [{ class: m.h }, { class: m.l }] }
`;
}

describe("projected planes: a matrix on a plane", () => {
  test("projected: every cell is the flat cell mapped, on a regular flat grid", async () => {
    const value = await render(matrixSource("projected"));
    const frame = frameOf(value, "g:sheet");
    const plane = value.layout.planes?.find((p) => p.key === "g:sheet");
    const cells = (plane?.flat ?? []).filter((f) => /^n:m-\d-\d$/.test(f.key));
    expect(cells).toHaveLength(9);
    const pitchX = (cells[1]?.rect.x ?? 0) - (cells[0]?.rect.x ?? 0);
    const pitchY = (cells[3]?.rect.y ?? 0) - (cells[0]?.rect.y ?? 0);
    expect(pitchX).toBeGreaterThan(0);
    for (const [i, cell] of cells.entries()) {
      expect(cell.rect.x).toBeCloseTo((cells[0]?.rect.x ?? 0) + (i % 3) * pitchX, 1);
      expect(cell.rect.y).toBeCloseTo((cells[0]?.rect.y ?? 0) + Math.floor(i / 3) * pitchY, 1);
      const outline = outlineOf(value, cell.key);
      expect(outline).toHaveLength(4);
      const back = outline.map((p) => unmapPoint(frame, p));
      const xs = back.map((p) => p.x);
      const ys = back.map((p) => p.y);
      expect(Math.min(...xs)).toBeCloseTo(cell.rect.x, 1);
      expect(Math.max(...xs)).toBeCloseTo(cell.rect.x + cell.rect.width, 1);
      expect(Math.min(...ys)).toBeCloseTo(cell.rect.y, 1);
      expect(Math.max(...ys)).toBeCloseTo(cell.rect.y + cell.rect.height, 1);
    }
    // The cells are inside the plane and, apart from the sheared boxes, do not overlap.
    const quad = planeQuad(frame);
    for (const cell of cells)
      for (const p of outlineOf(value, cell.key)) expect(insideConvex(quad, p)).toBe(true);
    // The matrix's frame is a group whose box is the mapped box.
    const frameGroup = value.layout.groups.find((g) => g.key === "g:m");
    expect(frameGroup).toBeDefined();
    expect(frameGroup?.rect.width).toBeGreaterThan(0);
  });

  test("projected: no error or warning from the geometry lint", async () => {
    const text = matrixSource("projected");
    const value = await render(text);
    const found = lintGeometry(value, { source: text, file: "matrix.sumi.yaml" });
    expect(found.filter((d) => d.severity !== "info").map((d) => `${d.code} ${d.message}`)).toEqual(
      [],
    );
  });

  test("upright: the cells keep their size, centred on the mapped centres", async () => {
    const value = await render(matrixSource("upright"));
    const frame = frameOf(value, "g:sheet");
    const plane = value.layout.planes?.find((p) => p.key === "g:sheet");
    const cells = (plane?.flat ?? []).filter((f) => /^n:m-\d-\d$/.test(f.key));
    expect(cells).toHaveLength(9);
    for (const cell of cells) {
      const node = value.layout.nodes.find((n) => n.key === cell.key);
      expect(node?.outline).toBeUndefined();
      expect(node?.rect.width).toBeCloseTo(cell.rect.width, 2);
      const mapped = centerOf(node?.rect as never);
      const flat = unmapPoint(frame, mapped);
      expect(flat.x).toBeCloseTo(centerOf(cell.rect).x, 1);
      expect(flat.y).toBeCloseTo(centerOf(cell.rect).y, 1);
    }
  });

  test("a hatched cell's lines are mapped onto the plane", async () => {
    const text = matrixSource("projected").replace(
      "h: { tone: orange, variant: tinted, label: high }",
      "h: { tone: orange, variant: tinted, pattern: hatch, label: high }",
    );
    const value = await render(text);
    const frame = frameOf(value, "g:sheet");
    const hatch = value.svg.match(/<path class="sumi-hatch" d="([^"]*)"/g) ?? [];
    expect(hatch.length).toBeGreaterThan(0);
    // The first hatched cell's segments are 45° lines in the flat frame.
    const d = hatch[0]?.match(/d="([^"]*)"/)?.[1] ?? "";
    const nums = [...d.matchAll(/M ([-\d.]+) ([-\d.]+) L ([-\d.]+) ([-\d.]+)/g)];
    expect(nums.length).toBeGreaterThan(3);
    for (const m of nums) {
      const a = unmapPoint(frame, { x: Number(m[1]), y: Number(m[2]) });
      const b = unmapPoint(frame, { x: Number(m[3]), y: Number(m[4]) });
      expect(Math.abs(b.x - a.x)).toBeCloseTo(Math.abs(b.y - a.y), 1);
    }
  });
});

describe("projected planes: PDF and editable PPTX", () => {
  test("PDF renders; PPTX draws projected shapes and flat heads as freeforms", async () => {
    const value = await render(source({ shape: "box" }));
    expect(svgToPdf(value.svg).ok).toBe(true);
    for (const connectors of ["freeform", "glued"] as const) {
      const pptx = svgToEditablePptx(value.svg, value.compiled.ir, { connectors });
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
      // A projected node is a freeform of its mapped outline (not a preset rectangle).
      const node = named("n:a1");
      expect(node).toBeDefined();
      expect([...descendants(node as never)].some((e) => e.name === "a:custGeom")).toBe(true);
      const outline = outlineOf(value, "n:a1");
      const points = [...descendants(node as never)].filter((e) => e.name === "a:pt");
      expect(points.length).toBeGreaterThanOrEqual(outline.length);
      // The arrowhead of a1 → b1 is a freeform of its own whose points are the SVG's flat head.
      const xml = new TextDecoder().decode(readPptx(pptx.value).get("ppt/slides/slide1.xml"));
      const index = value.compiled.ir.edges.findIndex((e) => e.from === "n:a1" && e.to === "n:b1");
      expect(index).toBeGreaterThanOrEqual(0);
      const head = value.svg
        .match(/<polygon points="([^"]*)" class="sumi-plane-head"/)?.[1]
        ?.split(" ")
        .map((p) => p.split(",").map(Number)) as number[][];
      expect(head).toHaveLength(3);
      const EMU = 6350;
      const forEdge = shapes.filter((sp) =>
        [...descendants(sp)].some(
          (e) => e.name === "p:cNvPr" && attribute(e, "name") === `e:#${index}`,
        ),
      );
      const absolute = forEdge.map((sp) => {
        const off = [...descendants(sp)].find((e) => e.name === "a:off");
        return [...descendants(sp)]
          .filter((e) => e.name === "a:pt")
          .map((pt) => [
            (Number(attribute(off as never, "x")) + Number(attribute(pt, "x"))) / EMU,
            (Number(attribute(off as never, "y")) + Number(attribute(pt, "y"))) / EMU,
          ]);
      });
      const matches = absolute.filter((pts) =>
        head.every(([hx, hy]) =>
          pts.some(
            ([x, y]) =>
              Math.abs((x as number) - (hx as number)) < 0.1 &&
              Math.abs((y as number) - (hy as number)) < 0.1,
          ),
        ),
      );
      expect(matches.length, connectors).toBe(1);
      expect(xml).not.toMatch(/tailEnd type="triangle"/);
    }
  });
});

describe("projected planes: checks and docs", () => {
  test("props.contents needs props.plane", () => {
    const found = checkFigure(`version: 1
figure: { id: x, theme: sumi, profile: paper-double, layout: { arrange: { row: { items: [g] } } } }
groups:
  - { id: g, props: { contents: projected }, arrange: { row: { items: [a] } } }
nodes:
  - { id: a, component: box, label: A }
`).state.diagnostics.filter((d) => d.severity === "error");
    expect(found.map((d) => d.code)).toEqual(["component/invalid-prop"]);
    expect(found[0]?.path).toEqual(["groups", 0, "props", "contents"]);
  });

  test("the value is validated and a matrix is not a nested-group error", () => {
    const bad = checkFigure(`version: 1
figure: { id: x, theme: sumi, profile: paper-double, layout: { arrange: { row: { items: [g] } } } }
groups:
  - { id: g, props: { plane: floor, contents: flat }, arrange: { row: { items: [a] } } }
nodes:
  - { id: a, component: box, label: A }
`).state.diagnostics.filter((d) => d.severity === "error");
    expect(bad.length).toBeGreaterThan(0);
    const ok = checkFigure(matrixSource("projected")).state.diagnostics.filter(
      (d) => d.severity === "error",
    );
    expect(ok).toEqual([]);
  });

  test("the Skill documents contents and its layout reads the same source", () => {
    const doc = readFileSync(join(ROOT, "skills/sumi/references/structured.md"), "utf8");
    expect(doc).toContain("contents: projected");
    const layout = readFileSync(
      join(ROOT, "skills/sumi/layouts/projected-planes/projected-planes.sumi.yaml"),
      "utf8",
    );
    expect(layout).toContain("contents: projected");
  });
});
