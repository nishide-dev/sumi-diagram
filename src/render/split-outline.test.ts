import { expect, test } from "bun:test";
import { compileFigure, expectD2Figure } from "../compiler/compile";
import { getOutlineRenderer } from "../core/outline";
import { layoutStructuredFigure } from "../layout";
import { resolveEnds } from "../layout/route/ports";
import { composeOutlines } from "./compose";
import { finalizeSvg } from "./finalize";
import { type Point, parsePath, type Rect } from "./geometry";
import { inspectSvg } from "./inspect";
import { rayHit } from "./outline-geometry";
import { correctedOutlineRouteIsSafe } from "./outline-route";
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

function compose(
  path: string,
  reverse = false,
  rect = { x: 0, y: 0, width: 100, height: 100 },
  options: { both?: boolean; obstacle?: Rect; warning?: boolean } = {},
) {
  const input = source(reverse)
    .replace(
      "id: a, component: box",
      options.both ? "id: a, component: bowtie, props: { gap: 64 }" : "id: a, component: box",
    )
    .replace(
      "edges:",
      options.obstacle ? "  - { id: obstacle, component: box }\nedges:" : "edges:",
    );
  const compiled = compileFigure(input);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  const figure = expectD2Figure(compiled.value);
  const svg = tinySvg(
    [
      options.both
        ? '<g class="sumi-k-n--a sumi-kind-node"><g class="shape"><rect x="0" y="-120" width="100" height="100" fill="#ffffff" stroke="#000000"/></g></g>'
        : '<g class="sumi-k-n--a sumi-kind-node"><g class="shape"><rect x="20" y="-60" width="60" height="40" fill="#ffffff" stroke="#000000"/></g></g>',
      `<g class="sumi-k-n--b sumi-kind-node"><g class="shape"><rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" fill="#ffffff" stroke="#000000"/></g></g>`,
      ...(options.obstacle
        ? [
            `<g class="sumi-k-n--obstacle sumi-kind-node"><g class="shape"><rect x="${options.obstacle.x}" y="${options.obstacle.y}" width="${options.obstacle.width}" height="${options.obstacle.height}" fill="#ffffff" stroke="#000000"/></g></g>`,
          ]
        : []),
      `<g class="sumi-k-e--edge sumi-kind-edge"><path class="connection" d="${path}" fill="none" stroke="#000000"/></g>`,
    ],
    { fonts: false, viewBox: "-100 -100 300 300" },
  );
  const finalized = finalizeSvg(artifactFor(figure, svg), figure, { source: input });
  if (!finalized.ok) throw new Error(JSON.stringify(finalized.diagnostics));
  const before = inspectSvg(finalized.value.svg, figure.ir);
  if (!before.ok) throw new Error(JSON.stringify(before.diagnostics));
  const result = composeOutlines(finalized.value.svg, figure.ir, before.value);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  if (options.warning) {
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: "svg/outline-edge-miss",
        severity: "warning",
        path: ["edges", 0],
        subject: { kind: "edge", id: "edge" },
      }),
    ]);
    expect(result.value).toContain(`d="${path}"`);
  } else expect(result.diagnostics).toEqual([]);
  const after = inspectSvg(result.value, figure.ir);
  if (!after.ok) throw new Error(JSON.stringify(after.diagnostics));
  const route = after.value.elements.find((e) => e.key === "e:edge")?.path;
  if (!route) throw new Error("Missing route");
  return { svg: result.value, ir: figure.ir, route, diagnostics: result.diagnostics };
}

test("both shifted ends insert bends in travel order without backtracking", () => {
  const { route } = compose("M 50 -18 L 50 -2", false, undefined, { both: true });
  expect(route.map((s) => s.to)).toEqual([
    { x: 25, y: -43 },
    { x: 25, y: -18 },
    { x: 25, y: -2 },
    { x: 25, y: 23 },
  ]);
});

test("a rounded endpoint ray that misses both painted bodies keeps D2's exact path", () => {
  compose("M 49.663 -18 L 50 -2", false, undefined, { warning: true });
});

test("a failed target correction rolls back a successful source correction", () => {
  const path = "M 50 -18 L 50 -10 L 55 -2";
  const { route } = compose(path, false, undefined, { both: true, warning: true });
  expect(route.map((s) => s.to)).toEqual([
    { x: 50, y: -18 },
    { x: 50, y: -10 },
    { x: 55, y: -2 },
  ]);
});

for (const reverse of [false, true]) {
  test(`a shifted ${reverse ? "source" : "target"} join crossing another footprint keeps D2's exact path`, () => {
    const path = reverse ? "M 50 -2 L 50 -18" : "M 50 -18 L 50 -2";
    const { route } = compose(path, reverse, undefined, {
      obstacle: { x: 30, y: -14, width: 10, height: 8 },
      warning: true,
    });
    expect(route.map((s) => s.to)).toEqual(
      reverse
        ? [
            { x: 50, y: -2 },
            { x: 50, y: -18 },
          ]
        : [
            { x: 50, y: -18 },
            { x: 50, y: -2 },
          ],
    );
  });

  test(`near-vertical ${reverse ? "source" : "target"} ray misses paint despite its x lying in a body span`, () => {
    const path = reverse ? "M 24.99 -2 L 24.67 -18" : "M 24.67 -18 L 24.99 -2";
    const { route } = compose(path, reverse);
    const points = [
      { x: 24.67, y: -18 },
      { x: 24.46, y: -2 },
      { x: 24.96, y: 23 },
    ];
    expect(route.map((s) => s.to)).toEqual(reverse ? points.reverse() : points);
  });
}

test("an overlapping corrected approach falls back instead of adding a backtracking segment", () => {
  const path = "M 25 10 L 50 -18 L 50 -2";
  const { route } = compose(path, false, undefined, { warning: true });
  expect(route.map((s) => s.to)).toEqual([
    { x: 25, y: 10 },
    { x: 50, y: -18 },
    { x: 50, y: -2 },
  ]);
});

test("a degenerate approach keeps D2's path with a warning", () => {
  compose("M 50 -2 L 50 -2", false, undefined, { warning: true });
});

test("corrected route validation rejects collapsed, overlapping and self-touching routes", () => {
  const original = parsePath("M 50 -18 L 50 -2");
  if (!original.ok) throw new Error(original.message);
  for (const d of [
    "M 25 -43 L 25 -18 L 25 -18 L 25 23",
    "M 25 -43 L 25 -2 L 25 -18 L 25 23",
    "M 0 0 L 10 10 L 0 10 L 10 0",
    "M 0 0 L 10 0 L 10 10 L 5 0",
    "M 50 -18 C 50 30 25 -30 25 23",
  ]) {
    const route = parsePath(d);
    if (!route.ok) throw new Error(route.message);
    expect(correctedOutlineRouteIsSafe(route.segments, original.segments, [])).toBe(false);
  }
});

test("curved corrections conservatively reject an obstacle inside their control bounds", () => {
  const path = "M 50 -18 C 50 -12 50 -8 50 -2";
  compose(path, false, undefined, {
    obstacle: { x: 30, y: -14, width: 10, height: 8 },
    warning: true,
  });
});

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
