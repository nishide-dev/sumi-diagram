import { describe, expect, test } from "bun:test";
import { glyphRects } from "../assets/glyphs";
import type { Point } from "../layout/ir";
import { outlinePolygon } from "../layout/set-shape";
import { lintGeometry } from "../lint/geometry";
import { regionIntersectsRect } from "../lint/geometry/shapes";
import { svgToPdf } from "./pdf";
import { svgToEditablePptx, svgToPptx } from "./pptx";
import { readPptx } from "./pptx/testing";
import { type RenderedStructuredFigure, renderFigure } from "./render";
import { attribute, descendants, parseXml } from "./xml";

/**
 * Hyperedges around diagonal members (#430, design record 430): three members
 * on the main diagonal, and a non-member in the empty corner of the diagonal's
 * bounding box. Unit 10mm.
 */
const diagonal = (set: string, stray = true) => `version: 1
figure:
  id: oriented
  theme: color
  profile: paper-double
  layout:
    arrange:
      place:
        unit: 10mm
        items:
          - { item: m1, at: [0, 0] }
          - { item: m2, at: [1.6, 1.4] }
          - { item: m3, at: [3.2, 3] }
${stray ? "          - { item: stray, at: [3.2, 0] }\n" : ""}nodes:
  - { id: m1, component: box, label: A }
  - { id: m2, component: circle, label: B }
  - { id: m3, component: box, label: C }
${stray ? "  - { id: stray, component: box, label: X }\n" : ""}sets:
  - ${set}
`;

const TILTED =
  "{ id: e, label: Edge, members: [m1, m2, m3], shape: ellipse, angle: auto, padding: 4mm }";
const LEGACY = "{ id: e, label: Edge, members: [m1, m2, m3], shape: ellipse, padding: 4mm }";

async function render(source: string): Promise<RenderedStructuredFigure> {
  const result = await renderFigure(source);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  if (!("layout" in result.value)) throw new Error("expected a structured figure");
  return result.value;
}

describe("an ellipse turned to its members", () => {
  test("angle: auto tilts along the diagonal; the layout carries the angle", async () => {
    const { layout } = await render(diagonal(TILTED));
    const outline = layout.sets?.[0]?.outline;
    if (outline?.kind !== "ellipse") throw new Error("expected an ellipse");
    expect(outline.angle).toBeGreaterThan(30);
    expect(outline.angle).toBeLessThan(60);
    expect(outline.rx).toBeGreaterThan(outline.ry);
    // The bounds cover the rotated outline, so the canvas holds it.
    const rect = layout.sets?.[0]?.rect;
    if (rect === undefined) throw new Error("missing set");
    for (const p of outlinePolygon(outline)) {
      expect(p.x).toBeGreaterThanOrEqual(rect.x - 0.01);
      expect(p.x).toBeLessThanOrEqual(rect.x + rect.width + 0.01);
      expect(p.y).toBeGreaterThanOrEqual(rect.y - 0.01);
      expect(p.y).toBeLessThanOrEqual(rect.y + rect.height + 0.01);
    }
  });

  test("every member keeps the padding clear, in the layout and in the drawn path", async () => {
    const rendered = await render(diagonal(TILTED));
    const outline = rendered.layout.sets?.[0]?.outline;
    if (outline?.kind !== "ellipse") throw new Error("expected an ellipse");
    const padding = 4 * (72 / 25.4) * 2;
    const drawn = parseXml(rendered.svg);
    if (!drawn.ok) throw new Error(drawn.message);
    const shape = [...descendants(drawn.root)].find((e) =>
      (attribute(e, "class") ?? "").includes("sumi-set-shape"),
    );
    expect(shape?.name).toBe("path");
    // The cubics of the drawn path, sampled, are as close as the outline.
    const numbers = (attribute(shape as never, "d") ?? "").match(/-?\d+(?:\.\d+)?/g)?.map(Number);
    expect(numbers?.length).toBe(2 + 8 * 6);
    const polygon = outlinePolygon(outline);
    for (const node of rendered.layout.nodes.filter((n) => n.key !== "n:stray")) {
      const { x, y, width, height } = node.rect;
      const corners: Point[] = [
        { x, y },
        { x: x + width, y },
        { x, y: y + height },
        { x: x + width, y: y + height },
      ];
      for (const c of corners) {
        const gap = Math.min(...polygon.map((q) => Math.hypot(q.x - c.x, q.y - c.y)));
        expect(gap).toBeGreaterThanOrEqual(padding - 0.5);
      }
    }
  });

  test("without angle the ellipse is the axis-parallel <ellipse> or <circle>, as before", async () => {
    const { svg, layout } = await render(diagonal(LEGACY));
    const outline = layout.sets?.[0]?.outline;
    if (outline?.kind !== "ellipse") throw new Error("expected an ellipse");
    expect("angle" in outline).toBe(false);
    expect(svg).toMatch(/<(circle|ellipse) class="sumi-set-shape"/);
    expect(svg).not.toContain("transform=");
  });

  test("lint follows the rotated shape: the corner node is covered by the axis-parallel ellipse only", async () => {
    const legacy = diagonal(LEGACY);
    const flagged = lintGeometry(await render(legacy), { source: legacy }).filter(
      (d) => d.code === "geometry/set-contains-non-member",
    );
    expect(flagged).toHaveLength(1);
    const tilted = diagonal(TILTED);
    const clear = lintGeometry(await render(tilted), { source: tilted }).filter(
      (d) => d.code === "geometry/set-contains-non-member",
    );
    expect(clear).toEqual([]);
    // A node on the diagonal that is not a member is still found inside the tilted outline.
    const onAxis = tilted.replace("members: [m1, m2, m3]", "members: [m1, m3]");
    const found = lintGeometry(await render(onAxis), { source: onAxis }).filter(
      (d) => d.code === "geometry/set-contains-non-member",
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain('node "m2"');
  });

  test("all eight label positions clear the rotated outline", async () => {
    for (const at of [
      "top",
      "top-right",
      "right",
      "bottom-right",
      "bottom",
      "bottom-left",
      "left",
      "top-left",
    ]) {
      const { layout } = await render(
        diagonal(TILTED.replace("padding:", `labelAt: ${at}, padding:`), false),
      );
      const set = layout.sets?.[0];
      if (set?.outline.kind !== "ellipse" || set.label === undefined) throw new Error("missing");
      const box = set.label.box;
      const inside = outlinePolygon(set.outline).filter(
        (p) => p.x > box.x && p.x < box.x + box.width && p.y > box.y && p.y < box.y + box.height,
      );
      expect(inside, `label at ${at}`).toEqual([]);
    }
  });

  test("an explicit angle is used as written", async () => {
    const { layout } = await render(diagonal(TILTED.replace("auto", "-20"), false));
    const outline = layout.sets?.[0]?.outline;
    if (outline?.kind !== "ellipse") throw new Error("expected an ellipse");
    expect(outline.angle).toBe(-20);
  });

  test("output is deterministic", async () => {
    expect((await render(diagonal(TILTED))).svg).toBe((await render(diagonal(TILTED))).svg);
  });
});

describe("PDF and PPTX", () => {
  test("PDF and picture PPTX draw the tilted ellipse", async () => {
    const { svg } = await render(diagonal(TILTED));
    expect(svgToPdf(svg).ok).toBe(true);
    expect(svgToPptx(svg).ok).toBe(true);
  });

  test("editable PPTX: a freeform with the tilt built in, no rotation attribute", async () => {
    const rendered = await render(diagonal(TILTED));
    const result = svgToEditablePptx(rendered.svg, rendered.compiled.ir);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const slide = new TextDecoder().decode(readPptx(result.value).get("ppt/slides/slide1.xml"));
    expect(slide).toContain("custGeom");
    expect(slide).toContain('name="set e"');
    expect(slide).not.toContain("rot=");
  });
});

describe("glyph footprint enclosures", () => {
  test("label overlap detects containment and crossings without enclosed polygon vertices", () => {
    const polygon = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const region = { kind: "polygon" as const, points: polygon };
    expect(regionIntersectsRect(region, { x: 4, y: 4, width: 2, height: 2 }, 0)).toBe(true);
    expect(regionIntersectsRect(region, { x: -1, y: 4, width: 12, height: 2 }, 0)).toBe(true);
    expect(regionIntersectsRect(region, { x: 11, y: 4, width: 2, height: 2 }, 0)).toBe(false);
  });
  const source = (shape: string, extra = "") => `version: 1
figure:
  id: footprints
  theme: slides
  layout:
    arrange:
      place:
        unit: 10mm
        items:
          - { item: a, at: [0, 0] }
          - { item: b, at: [2, 2] }
          - { item: c, at: [4, 4] }
nodes:
  - id: a
    component: label
    icon: tabler/file-text
    glyphs:
      - { kind: vector, at: north, dy: -0.35 }
      - { kind: vector, at: west, dx: -0.35 }
  - { id: b, component: box, label: B }
  - id: c
    component: label
    icon: tabler/file-text
    glyphs:
      - { kind: vector, at: south, dy: 0.35 }
      - { kind: vector, at: east, dx: 0.35 }
sets:
  - { id: s, label: Members, members: [a, b, c], shape: ${shape}, enclose: footprint, padding: 3mm${extra} }
`;
  const insidePolygon = (p: Point, polygon: Point[]) => {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[i] as Point,
        b = polygon[j] as Point;
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
        inside = !inside;
    }
    return inside;
  };
  for (const [shape, extra] of [
    ["circle", ""],
    ["ellipse", ", angle: auto"],
    ["hull", ""],
    ["rect", ""],
  ] as const) {
    test(`${shape} encloses all four glyph footprints and places its label`, async () => {
      const rendered = await render(source(shape, extra));
      const set = rendered.layout.sets?.[0];
      if (!set?.label) throw new Error("missing set or label");
      const polygon = outlinePolygon(set.outline);
      if (shape === "ellipse" && set.outline.kind === "ellipse")
        expect(Math.abs(set.outline.angle ?? 0)).toBeGreaterThan(10);
      for (const id of ["a", "c"]) {
        const node = rendered.compiled.ir.nodes.find((n) => n.key === `n:${id}`);
        const placed = rendered.layout.nodes.find((n) => n.key === `n:${id}`);
        if (!node || !placed) throw new Error("missing node");
        for (const r of glyphRects(node, placed.rect))
          for (const p of [
            { x: r.x, y: r.y },
            { x: r.x + r.width, y: r.y },
            { x: r.x, y: r.y + r.height },
            { x: r.x + r.width, y: r.y + r.height },
          ])
            expect(insidePolygon(p, polygon)).toBe(true);
      }
      const label = set.label.box;
      expect(regionIntersectsRect({ kind: "polygon", points: polygon }, label, 0)).toBe(false);
    });
  }
  test("footprints export to PDF and PPTX and detect non-members", async () => {
    const text = source("ellipse", ", angle: auto").replace(
      "members: [a, b, c]",
      "members: [a, c]",
    );
    const rendered = await render(text);
    expect(
      lintGeometry(rendered, { source: text }).some(
        (d) => d.code === "geometry/set-contains-non-member",
      ),
    ).toBe(true);
    expect(svgToPdf(rendered.svg).ok).toBe(true);
    expect(svgToPptx(rendered.svg).ok).toBe(true);
  });
});
