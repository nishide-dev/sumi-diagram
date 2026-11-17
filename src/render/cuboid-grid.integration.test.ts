import { describe, expect, test } from "bun:test";
import { checkFigure } from "../core/check";
import { cuboid, cuboidBlocks } from "../core/outline/cuboid";
import { lintGeometry } from "../lint";
import { svgToPdf } from "./pdf";
import { svgToEditablePptx } from "./pptx";
import { readPptx } from "./pptx/testing";
import { renderFigure } from "./render";
import { attribute, descendants, parseXml } from "./xml";

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
        expect(from).toEqual(kernel.faces.side[i] as never);
        expect(to).toEqual(cell.faces.left[i] as never);
      });
    });
  }

  test("the grid and block colors come from the theme: grid = frame mixed 45% toward the canvas, block = tinted tone", async () => {
    const value = await render(conv());
    const node = value.compiled.ir.nodes.find((n) => n.id === "vin");
    const params = node?.render?.params ?? {};
    expect(params.cells).toBe("6,6,6");
    expect(params.gridStroke).toMatch(/^#[0-9a-f]{6}$/);
    const [kernel] = cuboidBlocks(cuboid.params.parse(params));
    // sumi's orange tone: pale fill, #814b2d line.
    expect(kernel?.line).toBe("#814b2d");
    expect(kernel?.fill).toBe("#efdfce");
    expect(kernel?.top).not.toBe(kernel?.fill);
  });

  test("the receptive field is painted over its source and under its target", async () => {
    const value = await render(conv());
    const at = (needle: string) => value.svg.indexOf(needle);
    const source = at("sumi-k-n--vin ");
    const edge = at("sumi-k-e--_0 ");
    const target = at("sumi-k-n--vout ");
    expect(source).toBeGreaterThan(-1);
    expect(edge).toBeGreaterThan(source);
    expect(target).toBeGreaterThan(edge);
  });

  test("a cuboid without cells draws exactly as before (no marked outline, no grid)", async () => {
    const value = await render(`version: 1
figure: { id: plain, theme: sumi, profile: paper-double, layout: { arrange: { row: { items: [a] } } } }
nodes:
  - { id: a, component: cuboid, props: { width: 6mm, height: 12mm, depth: 8mm } }
`);
    expect(value.svg).not.toContain("sumi-solid-outline");
    const shape =
      value.svg.match(/<g class="sumi-k-n--a sumi-kind-node"><g class="shape">(.*?)<\/g>/)?.[1] ??
      "";
    expect([...shape.matchAll(/<path /g)]).toHaveLength(6);
  });

  test("PDF and editable PPTX follow the SVG: the blocks are freeforms over the cuboid's outline", async () => {
    const value = await render(conv());
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
    const own = names.filter((n) => n?.startsWith("n:vin")) as string[];
    // The outline shape (named after the node) is neither first nor last: the grid and faces come
    // before it, the kernel's faces and frame after it.
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

  test("references: an unknown block, a block of another node, and an edge that is not a zoom", () => {
    expect(codes(conv("sumi", "{ from: vin.nope, to: vout.cell, component: zoom }"))).toContain(
      "ref/unknown-cell",
    );
    expect(codes(conv("sumi", "{ from: vin.cell, to: vout.cell, component: zoom }"))).toContain(
      "ref/unknown-cell",
    );
    expect(codes(conv("sumi", "{ from: vin.kernel, to: vout.cell }"))).toContain(
      "layout/part-needs-direct-route",
    );
    expect(codes(conv())).toEqual([]);
    // A zoom may join one block and a plain box too.
    expect(codes(conv("sumi", "{ from: vin.kernel, to: vout, component: zoom }"))).toEqual([]);
  });
});
