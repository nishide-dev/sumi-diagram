import { expect, test } from "bun:test";
import { compileFigure, expectD2Figure } from "../compiler/compile";
import { getOutlineRenderer } from "../core/outline";
import { layoutStructuredFigure } from "../layout";
import { resolveEnds } from "../layout/route/ports";
import { composeOutlines } from "./compose";
import { finalizeSvg } from "./finalize";
import type { Point, Rect } from "./geometry";
import { inspectSvg } from "./inspect";
import { rayHit } from "./outline-geometry";
import { svgToEditablePptx } from "./pptx";
import { readPptx } from "./pptx/testing";
import { artifactFor, tinySvg } from "./testing";

const source = (reverse = false) => `version: 1
figure: { id: split }
nodes:
  - { id: a, component: box }
  - { id: b, component: bowtie, props: { gap: 64 } }
edges: [{ id: edge, from: ${reverse ? "b" : "a"}, to: ${reverse ? "a" : "b"} }]
`;

function compose(path: string, reverse = false, rect = { x: 0, y: 0, width: 100, height: 100 }) {
  const compiled = compileFigure(source(reverse));
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  const figure = expectD2Figure(compiled.value);
  const svg = tinySvg(
    [
      '<g class="sumi-k-n--a sumi-kind-node"><g class="shape"><rect x="20" y="-60" width="60" height="40" fill="#ffffff" stroke="#000000"/></g></g>',
      `<g class="sumi-k-n--b sumi-kind-node"><g class="shape"><rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" fill="#ffffff" stroke="#000000"/></g></g>`,
      `<g class="sumi-k-e--edge sumi-kind-edge"><path class="connection" d="${path}" fill="none" stroke="#000000"/></g>`,
    ],
    { fonts: false, viewBox: "-100 -100 300 300" },
  );
  const finalized = finalizeSvg(artifactFor(figure, svg), figure, { source: source(reverse) });
  if (!finalized.ok) throw new Error(JSON.stringify(finalized.diagnostics));
  const before = inspectSvg(finalized.value.svg, figure.ir);
  if (!before.ok) throw new Error(JSON.stringify(before.diagnostics));
  const result = composeOutlines(finalized.value.svg, figure.ir, before.value);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  expect(result.diagnostics).toEqual([]);
  const after = inspectSvg(result.value, figure.ir);
  if (!after.ok) throw new Error(JSON.stringify(after.diagnostics));
  const route = after.value.elements.find((e) => e.key === "e:edge")?.path;
  if (!route) throw new Error("Missing route");
  return { svg: result.value, ir: figure.ir, route };
}

function boundaries(rect: Rect) {
  const renderer = getOutlineRenderer("sumi/bowtie");
  if (!renderer) throw new Error("Missing bowtie");
  const drawing = renderer.draw(rect, renderer.params.parse({ gap: 64 }));
  return drawing.boundaries ?? [drawing.outline];
}

for (const reverse of [false, true]) {
  for (const slope of [-0.02, 0, 0.02, -Math.tan(Math.PI / 36), Math.tan(Math.PI / 36)]) {
    test(`split auto ${reverse ? "source" : "target"}: slope ${slope} preserves tangent and painted contact`, () => {
      const start = { x: 50 - slope * 16, y: -18 };
      const end = { x: 50, y: -2 };
      const path = reverse
        ? `M ${end.x} ${end.y} L ${start.x} ${start.y}`
        : `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
      const { route } = compose(path, reverse);
      expect(route).toHaveLength(3);
      const p = reverse ? route[0]?.to : route.at(-1)?.to;
      const neighbour = route[1]?.to;
      if (!p || !neighbour) throw new Error("Missing end");
      expect((p.x - neighbour.x) / (p.y - neighbour.y)).toBeCloseTo(slope, 4);
      const direction = { x: (p.x - neighbour.x) / (p.y - neighbour.y), y: 1 };
      const hits = boundaries({ x: 0, y: 0, width: 100, height: 100 }).flatMap((outline) => {
        const hit = rayHit(outline, p, direction);
        return hit === undefined ? [] : [hit];
      });
      // The resulting end ray reaches the left painted lip at (25,25),
      // retaining the original two-unit vertical clearance.
      expect(hits.length).toBeGreaterThan(0);
      const hit = Math.min(...hits);
      expect(hit).toBeCloseTo(2, 2);
      expect(p.x + direction.x * hit).toBeCloseTo(25, 2);
      expect(p.y + hit).toBeCloseTo(25, 2);
      if (slope === 0) {
        expect(p).toEqual({ x: 25, y: 23 });
        expect(neighbour).toEqual({ x: 25, y: -2 });
        // The approach crosses y=0 at x=25, never through the central gap.
        expect(neighbour.x + ((p.x - neighbour.x) * (0 - neighbour.y)) / (p.y - neighbour.y)).toBe(
          25,
        );
      }
    });
  }
}

for (const reverse of [false, true]) {
  for (const curved of [false, true]) {
    test(`split auto south ${reverse ? "source" : "target"}/${curved ? "cubic" : "line"} keeps its approach outside the gap`, () => {
      const path = curved
        ? reverse
          ? "M 50 102 C 50 108 50 112 50 118"
          : "M 50 118 C 50 112 50 108 50 102"
        : reverse
          ? "M 50 102 L 50 118"
          : "M 50 118 L 50 102";
      const { route } = compose(path, reverse);
      const p = reverse ? route[0]?.to : route.at(-1)?.to;
      const segment = reverse ? route[1] : route.at(-1);
      const neighbour =
        segment?.command === "C" ? (reverse ? segment.c1 : segment.c2) : route[1]?.to;
      expect(p).toEqual({ x: 25, y: 77 });
      expect(neighbour?.x).toBe(25);
      expect(neighbour?.y).toBeGreaterThan(77);
      expect(
        rayHit(
          boundaries({ x: 0, y: 0, width: 100, height: 100 })[0] as readonly Point[],
          p as Point,
          { x: 0, y: -1 },
        ),
      ).toBe(2);
    });
  }
}

test("auto split outline sites project clearance onto the painted lip in editable PPTX", () => {
  const { svg, ir, route } = compose("M 50 -18 L 50 -2");
  expect(route.at(-1)?.to).toEqual({ x: 25, y: 23 });
  for (const connectors of ["freeform", "glued"] as const) {
    const pptx = svgToEditablePptx(svg, ir, { connectors });
    if (!pptx.ok) throw new Error(JSON.stringify(pptx.diagnostics));
    const xml = new TextDecoder().decode(readPptx(pptx.value).get("ppt/slides/slide1.xml"));
    const shape = xml.match(/<p:sp>.*?name="n:b".*?<\/p:sp>/)?.[0];
    const firstSite = shape?.match(/<a:cxnLst><a:cxn ang="0"><a:pos x="(\d+)" y="(\d+)"/);
    expect(firstSite?.slice(1)).toEqual(["158750", "158750"]);
    if (connectors === "glued") expect(xml).toContain('<a:endCxn id="3" idx="0"/>');
  }
});

test("fractional centre ports choose the left lip on geometric ties in both engines", () => {
  const rect = { x: 58.677, y: 0, width: 73, height: 100 };
  const centre = 95.177;
  const auto = compose(`M ${centre} -18 L ${centre} -2`, false, rect);
  expect(auto.route.at(-1)?.to).toEqual({ x: 76.927, y: 23 });
  const structured = layoutStructuredFigure(
    source()
      .replace("to: b", "to: b, toAnchor: north")
      .replace(
        "figure: { id: split }",
        "figure: { id: split, layout: { arrange: { stack: { items: [a, b] } } } }",
      ),
  );
  if (!structured.ok) throw new Error(JSON.stringify(structured.diagnostics));
  const layout = structured.value.layout;
  const pair = resolveEnds(structured.value.ir, {
    ...layout,
    nodes: layout.nodes.map((n) => (n.key === "n:b" ? { ...n, rect } : n)),
  })[0];
  if (!pair || "error" in pair) throw new Error("Missing ends");
  expect(pair.to.port.x).toBe(76.927);
  expect(pair.to.outline).toEqual({ x: 76.927, y: 25 });
  expect(
    rayHit(boundaries(rect)[0] as readonly Point[], pair.to.outline, { x: -1, y: 0 }),
  ).toBeCloseTo(0, 9);
});

test("PPTX projects a rounded contact locally instead of onto the far side of the body", () => {
  const { svg, ir } = compose("M 50 -18 L 50 -2");
  const pptx = svgToEditablePptx(svg.replace("L 25 23", "L 24.999 25.001"), ir, {
    connectors: "glued",
  });
  if (!pptx.ok) throw new Error(JSON.stringify(pptx.diagnostics));
  const xml = new TextDecoder().decode(readPptx(pptx.value).get("ppt/slides/slide1.xml"));
  const shape = [...xml.matchAll(/<p:sp>.*?<\/p:sp>/g)].find((m) =>
    m[0].includes('name="n:b"'),
  )?.[0];
  expect(shape).toContain('<a:cxnLst><a:cxn ang="0"><a:pos x="158750" y="158756"/>');
});
