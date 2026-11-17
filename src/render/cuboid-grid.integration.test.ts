import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderOne } from "../../scripts/gallery/render";
import { componentSamples } from "../../scripts/gallery/samples";
import { checkFigure } from "../core/check";
import { cuboid, cuboidBlocks } from "../core/outline/cuboid";
import { getTheme } from "../core/theme/builtin";
import { mixColors } from "../core/theme/cuboid-shade";
import { lintGeometry } from "../lint";
import { svgToPdf } from "./pdf";
import { inspectPdf } from "./pdf/testing";
import { svgToEditablePptx } from "./pptx";
import { readPptx } from "./pptx/testing";
import { renderFigure } from "./render";
import { attribute, childElements, descendants, parseXml } from "./xml";

const NODE_IN = `  - id: vin
    component: cuboid
    tone: blue
    variant: tinted
    props:
      width: 31.2mm
      height: 31.2mm
      depth: 31.2mm
      cells: [6, 6, 6]
      highlight: [{ name: kernel, at: [3, 0, 0], size: [3, 3, 3], tone: orange }]
      dims: { width: "W = 6" }
`;
const NODE_OUT = `  - id: vout
    component: cuboid
    tone: blue
    variant: tinted
    props:
      width: 20.8mm
      height: 20.8mm
      depth: 20.8mm
      cells: [4, 4, 4]
      highlight: [{ name: cell, at: [0, 0, 0], tone: orange }]
`;

/** The conv3d figure; the nodes are declared in `declared` order and placed in `placed` order. */
const convOrdered = (
  declared: "in, out" | "out, in",
  placed: "vin, vout" | "vout, vin",
  edge: string,
) => `version: 1
figure:
  id: conv3d
  theme: sumi
  profile: paper-double
  layout:
    arrange: { row: { gap: 40mm, align: end, items: [${placed}] } }
nodes:
${declared === "in, out" ? NODE_IN + NODE_OUT : NODE_OUT + NODE_IN}edges:
  - ${edge}
`;

const conv = (
  theme = "sumi",
  edge = "{ from: vin.kernel, to: vout.cell, component: zoom, tone: orange }",
) => `version: 1
figure:
  id: conv3d
  theme: ${theme}
  profile: paper-double
  layout:
    arrange: { row: { gap: 40mm, align: end, items: [vin, vout] } }
nodes:
  - id: vin
    component: cuboid
    tone: blue
    variant: tinted
    props:
      width: 31.2mm
      height: 31.2mm
      depth: 31.2mm
      cells: [6, 6, 6]
      highlight: [{ name: kernel, at: [3, 0, 0], size: [3, 3, 3], tone: orange }]
      dims: { width: "W = 6" }
  - id: vout
    component: cuboid
    tone: blue
    variant: tinted
    props:
      width: 20.8mm
      height: 20.8mm
      depth: 20.8mm
      cells: [4, 4, 4]
      highlight: [{ name: cell, at: [0, 0, 0], tone: orange }]
edges:
  - ${edge}
`;

async function render(text: string) {
  const result = await renderFigure(text);
  if (!result.ok || !("layout" in result.value)) throw new Error(JSON.stringify(result));
  return result.value;
}

const codes = (text: string) => checkFigure(text).state.diagnostics.map((d) => d.code);

describe("cuboid grids, highlighted blocks and receptive fields", () => {
  for (const theme of ["sumi", "sumi-dark", "paper"]) {
    test(`${theme}: the conv3d figure renders lint-clean with a grid, blocks and four receptive-field lines`, async () => {
      const value = await render(conv(theme));
      expect(lintGeometry(value).filter((d) => d.severity !== "info")).toEqual([]);
      const edge = value.layout.edges[0];
      // Four lines: the right face's corners of the kernel to the left face's corners of the cell.
      expect(edge?.route?.lines).toHaveLength(4);
      const kernel = cuboid.draw(
        value.layout.nodes.find((n) => n.key === "n:vin")?.rect as never,
        cuboid.params.parse(value.compiled.ir.nodes.find((n) => n.id === "vin")?.render?.params),
      ).parts?.kernel;
      const cell = cuboid.draw(
        value.layout.nodes.find((n) => n.key === "n:vout")?.rect as never,
        cuboid.params.parse(value.compiled.ir.nodes.find((n) => n.id === "vout")?.render?.params),
      ).parts?.cell;
      if (!kernel || !cell) throw new Error("missing parts");
      edge?.route?.lines?.forEach(([from, to], i) => {
        // From the kernel's right face corner; toward the cell's left face corner, seen from where
        // it enters the output volume (the corner is hidden behind it).
        const corner = cell.faces.left[i] as { x: number; y: number };
        expect(from).toEqual(kernel.faces.side[i] as never);
        const cross = (to.x - from.x) * (corner.y - from.y) - (to.y - from.y) * (corner.x - from.x);
        expect(Math.abs(cross) / Math.hypot(corner.x - from.x, corner.y - from.y)).toBeLessThan(
          0.6,
        );
        expect(Math.hypot(to.x - from.x, to.y - from.y)).toBeLessThanOrEqual(
          Math.hypot(corner.x - from.x, corner.y - from.y) + 0.01,
        );
      });
    });
  }

  test("the grid and block colors come from the theme: grid = frame mixed 45% toward the canvas, block = tinted tone", async () => {
    const value = await render(conv());
    const node = value.compiled.ir.nodes.find((n) => n.id === "vin");
    const params = node?.render?.params ?? {};
    expect(params.cells).toBe("6,6,6");
    // The grid is the frame's color mixed 45% toward the canvas, exactly.
    const canvas = getTheme("sumi")?.canvas as string;
    expect(params.gridStroke).toBe(mixColors(node?.style.stroke as string, canvas, 0.45));
    const [kernel] = cuboidBlocks(cuboid.params.parse(params));
    expect(kernel?.grid).toBe(mixColors(kernel?.line as string, canvas, 0.45));
    // sumi's orange tone: pale fill, #814b2d line.
    expect(kernel?.line).toBe("#814b2d");
    expect(kernel?.fill).toBe("#efdfce");
    expect(kernel?.top).not.toBe(kernel?.fill);
  });

  type P = { x: number; y: number };
  const distanceToBoundary = (p: P, polygon: readonly P[]) => {
    let best = Number.POSITIVE_INFINITY;
    for (const [i, a] of polygon.entries()) {
      const b = polygon[(i + 1) % polygon.length] as P;
      const [dx, dy] = [b.x - a.x, b.y - a.y];
      const t = Math.max(
        0,
        Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)),
      );
      best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
    }
    return best;
  };
  const distanceToLine = (p: P, a: P, b: P) =>
    Math.abs((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) /
    Math.hypot(b.x - a.x, b.y - a.y);

  // The volume hides what lies behind it whichever is declared or placed first and whichever way
  // the edge goes: a line end at a hidden (left) face corner is seen from where its line meets the
  // volume's silhouette, along the line it would have had.
  for (const declared of ["in, out", "out, in"] as const)
    for (const placed of ["vin, vout", "vout, vin"] as const)
      for (const edge of [
        "{ from: vin.kernel, to: vout.cell, component: zoom }",
        "{ from: vout.cell, to: vin.kernel, component: zoom }",
      ]) {
        test(`hidden ends sit on the silhouette along their lines (declared ${declared}; placed ${placed}; ${edge.slice(2, 30)})`, async () => {
          const value = await render(convOrdered(declared, placed, edge));
          const lines = value.layout.edges[0]?.route?.lines ?? [];
          expect(lines).toHaveLength(4);
          const volume = (id: string) => {
            const node = value.compiled.ir.nodes.find((n) => n.id === id);
            const rect = value.layout.nodes.find((n) => n.key === `n:${id}`)?.rect as {
              x: number;
              y: number;
              width: number;
              height: number;
            };
            return { drawing: cuboid.draw(rect, cuboid.params.parse(node?.render?.params)), rect };
          };
          const ends = {
            vin: { ...volume("vin"), part: "kernel" },
            vout: { ...volume("vout"), part: "cell" },
          };
          const [fromId, toId] = edge.includes("from: vin")
            ? (["vin", "vout"] as const)
            : (["vout", "vin"] as const);
          const [src, dst] = [ends[fromId], ends[toId]];
          const sp = src.drawing.parts?.[src.part];
          const dp = dst.drawing.parts?.[dst.part];
          if (!sp || !dp) throw new Error("missing parts");
          const right = dst.rect.x > src.rect.x;
          const [srcFace, dstFace] = right
            ? [sp.faces.side, dp.faces.left]
            : [sp.faces.left, dp.faces.side];
          lines.forEach(([a, b], i) => {
            const [from, to] = [srcFace[i] as P, dstFace[i] as P];
            for (const [end, original, volumeOutline, hidden] of [
              [a, from, src.drawing.outline, !right],
              [b, to, dst.drawing.outline, right],
            ] as const) {
              // On the line it would have had, between its corners.
              expect(distanceToLine(end, from, to)).toBeLessThan(0.6);
              const near = Math.hypot(end.x - original.x, end.y - original.y);
              if (!hidden) {
                // A visible face's corner is kept as it is.
                expect(near).toBeLessThan(0.01);
              } else if (near > 0.01) {
                // A hidden corner behind its volume: trimmed to the silhouette.
                expect(distanceToBoundary(end, volumeOutline)).toBeLessThan(0.6);
              } else {
                // Kept only if it was already on or outside the silhouette.
                expect(distanceToBoundary(original, volumeOutline)).toBeLessThan(0.6);
              }
            }
          });
          expect(lintGeometry(value).filter((d) => d.severity !== "info")).toEqual([]);
        });
      }

  test("a cuboid without cells draws exactly as the pinned gallery sample", async () => {
    // The gallery's sumi-cuboid.sumi.svg is pinned by gallery:check and the PDF / PPTX goldens.
    const sample = componentSamples().find((s) => s.entry.id === "sumi/cuboid");
    const rendering = sample?.renderings.find((r) => r.theme === "sumi");
    if (!sample || !rendering) throw new Error("missing gallery sample");
    const outcome = await renderOne({ file: sample.fileName, source: sample.source, rendering });
    expect(outcome.svg).toBe(
      readFileSync(resolve(import.meta.dir, "../..", rendering.output), "utf8"),
    );
    expect(outcome.svg).not.toContain("sumi-solid-outline");
  });

  test("PDF and editable PPTX follow the SVG: the four trimmed receptive-field lines and the block shapes", async () => {
    const value = await render(conv());
    const lines = value.layout.edges[0]?.route?.lines ?? [];
    expect(lines).toHaveLength(4);

    // PDF: the dashed stroke holds four two-point subpaths at the layout's lines (pt, y up).
    const pdf = svgToPdf(value.svg);
    if (!pdf.ok) throw new Error(JSON.stringify(pdf.diagnostics));
    const inspected = inspectPdf(pdf.value);
    const [pageW, pageH] = [
      inspected.pages[0]?.mediaBox[2] ?? 0,
      inspected.pages[0]?.mediaBox[3] ?? 0,
    ];
    const k = pageW / value.layout.canvas.width;
    const wanted: [number, number][][] = lines.map(([a, b]) => [
      [a.x * k, pageH - a.y * k],
      [b.x * k, pageH - b.y * k],
    ]);
    const dashed = inspected.strokes.filter((st) => st.dash.length > 0 && st.subpaths.length === 4);
    expect(dashed).toHaveLength(1);
    dashed[0]?.subpaths.forEach((sub, i) => {
      expect(sub).toHaveLength(2);
      for (const j of [0, 1]) {
        const want = (wanted[i] as [number, number][])[j] as [number, number];
        const got = sub[j] as [number, number];
        expect(got[0]).toBeCloseTo(want[0], 1);
        expect(got[1]).toBeCloseTo(want[1], 1);
      }
    });

    // Editable PPTX: the edge's freeform has the same four lines (EMU, from the shapes' scale).
    const pptx = svgToEditablePptx(value.svg, value.compiled.ir, { connectors: "freeform" });
    if (!pptx.ok) throw new Error(JSON.stringify(pptx.diagnostics));
    const slide = parseXml(
      new TextDecoder().decode(readPptx(pptx.value).get("ppt/slides/slide1.xml")),
    );
    if (!slide.ok) throw new Error(slide.message);
    const all = [...descendants(slide.root)];
    const shapeNamed = (name: string) =>
      all.find(
        (e) =>
          e.name === "p:sp" &&
          [...descendants(e)].some((n) => n.name === "p:cNvPr" && attribute(n, "name") === name),
      ) as never;
    const offOf = (shape: never) => {
      const off = [...descendants(shape)].find((e) => e.name === "a:off");
      return { x: Number(attribute(off as never, "x")), y: Number(attribute(off as never, "y")) };
    };
    const [ra, rb] = ["vin", "vout"].map(
      (id) =>
        value.layout.nodes.find((n) => n.key === `n:${id}`)?.rect as never as {
          x: number;
          y: number;
        },
    ) as [{ x: number; y: number }, { x: number; y: number }];
    const [pa, pb] = [offOf(shapeNamed("n:vin")), offOf(shapeNamed("n:vout"))];
    const scale = (pb.x - pa.x) / (rb.x - ra.x);
    const edge = shapeNamed("e:#0");
    const origin = offOf(edge);
    const points = [...descendants(edge)]
      .filter((e) => e.name === "a:pt")
      .map((e) => ({
        x: Number(attribute(e, "x")) + origin.x,
        y: Number(attribute(e, "y")) + origin.y,
      }));
    expect(points).toHaveLength(8);
    // Four separate lines, not a connected zigzag: exactly moveTo, lnTo four times, nothing else.
    const path = [...descendants(edge)].find((e) => e.name === "a:path");
    expect(childElements(path as never).map((e) => e.name)).toEqual(
      Array.from({ length: 4 }, () => ["a:moveTo", "a:lnTo"]).flat(),
    );
    lines.forEach(([a, b], i) => {
      for (const [j, p] of [a, b].entries()) {
        const got = points[2 * i + j] as { x: number; y: number };
        expect(Math.abs(got.x - (pa.x + (p.x - ra.x) * scale))).toBeLessThan(3000);
        expect(Math.abs(got.y - (pa.y + (p.y - ra.y) * scale))).toBeLessThan(3000);
      }
    });

    // The cuboid's shapes: the outline between its grid and faces and its kernel.
    const names = all.filter((e) => e.name === "p:cNvPr").map((e) => attribute(e, "name"));
    const own = names.filter((n) => n?.startsWith("n:vin")) as string[];
    const at = own.indexOf("n:vin");
    expect(at).toBeGreaterThan(3);
    expect(at).toBeLessThan(own.indexOf("n:vin-dim-width"));
    expect(own.slice(0, at).filter((n) => n === "n:vin edge").length).toBeGreaterThan(0);
    expect(own.slice(at + 1).filter((n) => n.startsWith("n:vin ")).length).toBeGreaterThan(5);
  });

  test("validation: ranges, names and the grid", () => {
    const base = (highlight: string, cells = "cells: [4, 4, 4],") => `version: 1
figure: { id: x, theme: sumi, profile: paper-double, layout: { arrange: { row: { items: [a] } } } }
nodes:
  - { id: a, component: cuboid, props: { width: 6mm, height: 6mm, depth: 6mm, ${cells} highlight: ${highlight} } }
`;
    expect(
      codes(base("[{ name: k, tone: orange, at: [0, 0, 0], size: [4, 4, 4] }]")),
    ).not.toContain("component/invalid-prop");
    // Out of range along x (3 + 2 > 4), z, and a block of no cells.
    expect(codes(base("[{ name: k, tone: orange, at: [3, 0, 0], size: [2, 1, 1] }]"))).toContain(
      "component/invalid-prop",
    );
    expect(codes(base("[{ name: k, tone: orange, at: [0, 0, 4] }]"))).toContain(
      "component/invalid-prop",
    );
    expect(codes(base("[{ name: k, tone: orange, at: [0, 0, 0], size: [0, 1, 1] }]"))).toContain(
      "component/invalid-prop",
    );
    // Duplicate names, no grid, a name that is not an ID.
    expect(
      codes(
        base(
          "[{ name: k, tone: orange, at: [0, 0, 0] }, { name: k, tone: orange, at: [1, 0, 0] }]",
        ),
      ),
    ).toContain("component/invalid-prop");
    expect(codes(base("[{ name: k, tone: orange, at: [0, 0, 0] }]", ""))).toContain(
      "component/invalid-prop",
    );
    expect(codes(base("[{ name: Kernel, tone: orange, at: [0, 0, 0] }]"))).toContain(
      "component/invalid-prop",
    );
    const located = checkFigure(
      base("[{ name: k, tone: orange, at: [3, 0, 0], size: [2, 1, 1] }]"),
    ).state.diagnostics.find((d) => d.code === "component/invalid-prop");
    expect(located?.path).toEqual(["nodes", 0, "props", "highlight", 0, "at"]);
  });

  test("references: an unknown block, a block of another node, and an anchor on a block", () => {
    expect(codes(conv("sumi", "{ from: vin.nope, to: vout.cell, component: zoom }"))).toContain(
      "ref/unknown-cell",
    );
    expect(codes(conv("sumi", "{ from: vin.cell, to: vout.cell, component: zoom }"))).toContain(
      "ref/unknown-cell",
    );
    // An ordinary edge may join a block (#584), but not with an anchor on that end.
    expect(codes(conv("sumi", "{ from: vin.kernel, to: vout.cell }"))).toEqual([]);
    expect(codes(conv("sumi", "{ from: vin.kernel, to: vout.cell, fromAnchor: east }"))).toContain(
      "layout/part-anchor",
    );
    expect(codes(conv())).toEqual([]);
    // A zoom may join one block and a plain box too.
    expect(codes(conv("sumi", "{ from: vin.kernel, to: vout, component: zoom }"))).toEqual([]);
  });
});
