import { describe, expect, test } from "bun:test";
import { checkFigure } from "../core/check";
import { cuboid } from "../core/outline/cuboid";
import { lintGeometry } from "../lint";
import { svgToPdf } from "./pdf";
import { inspectPdf } from "./pdf/testing";
import { svgToEditablePptx } from "./pptx";
import { readPptx } from "./pptx/testing";
import { renderFigure } from "./render";
import { attribute, descendants, parseXml } from "./xml";

type P = { x: number; y: number };
type R = P & { width: number; height: number };

const FIGURE = (arrange: string, edge: string, extra = "") => `version: 1
figure:
  id: blocks
  theme: sumi
  profile: paper-double
  layout:
    arrange: ${arrange}
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
      highlight: [{ name: kernel, at: [1, 2, 0], size: [3, 3, 3], tone: orange }, { name: deep, at: [3, 0, 2], size: [2, 2, 2], tone: orange }]
  - id: vout
    component: cuboid
    tone: blue
    variant: tinted
    props:
      width: 20.8mm
      height: 20.8mm
      depth: 20.8mm
      cells: [4, 4, 4]
      highlight: [{ name: cell, at: [1, 1, 0], tone: orange }]
${extra}edges:
  - ${edge}
`;

const ROW = "{ row: { gap: 34mm, align: end, items: [vin, vout] } }";
const STACK = "{ stack: { gap: 30mm, align: start, items: [vin, vout] } }";
const STACK_REVERSED = "{ stack: { gap: 30mm, align: start, items: [vout, vin] } }";

async function render(text: string) {
  const result = await renderFigure(text);
  if (!result.ok || !("layout" in result.value)) throw new Error(JSON.stringify(result));
  return result.value;
}

const codes = (text: string) => checkFigure(text).state.diagnostics.map((d) => d.code);
type Rendered = Awaited<ReturnType<typeof render>>;

function drawing(value: Rendered, id: string) {
  const node = value.compiled.ir.nodes.find((n) => n.id === id);
  const rect = value.layout.nodes.find((n) => n.key === `n:${id}`)?.rect as R;
  return { rect, drawing: cuboid.draw(rect, cuboid.params.parse(node?.render?.params)) };
}

function part(value: Rendered, id: string, name: string) {
  const found = drawing(value, id).drawing.parts?.[name];
  if (found === undefined) throw new Error(`missing part ${id}.${name}`);
  return found;
}

const distanceToBoundary = (p: P, polygon: readonly P[]) => {
  let best = Number.POSITIVE_INFINITY;
  for (const [i, a] of polygon.entries()) {
    const b = polygon[(i + 1) % polygon.length] as P;
    const [dx, dy] = [b.x - a.x, b.y - a.y];
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return best;
};
const distanceToLine = (p: P, a: P, b: P) =>
  Math.abs((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) /
  Math.hypot(b.x - a.x, b.y - a.y);
const centre = (box: R): P => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
const routePoints = (value: Rendered): P[] => [...(value.layout.edges[0]?.route?.points ?? [])];
const nonInfo = (value: Rendered) => lintGeometry(value).filter((d) => d.severity !== "info");

describe("ordinary edges to cuboid blocks (#584)", () => {
  for (const component of ["arrow", "line"]) {
    test(`${component}: both ends lie on the blocks' silhouettes and aim at their centres; no lint findings`, async () => {
      const value = await render(
        FIGURE(ROW, `{ from: vin.kernel, to: vout.cell, component: ${component} }`),
      );
      expect(nonInfo(value)).toEqual([]);
      const points = routePoints(value);
      expect(points).toHaveLength(2);
      const [kernel, cell] = [part(value, "vin", "kernel"), part(value, "vout", "cell")];
      expect(distanceToBoundary(points[0] as P, kernel.outline)).toBeLessThan(0.6);
      expect(distanceToBoundary(points[1] as P, cell.outline)).toBeLessThan(0.6);
      // The line is the one through both blocks' 3D centres (their boxes' middles).
      expect(distanceToLine(centre(kernel.box), points[0] as P, points[1] as P)).toBeLessThan(0.6);
      expect(distanceToLine(centre(cell.box), points[0] as P, points[1] as P)).toBeLessThan(0.6);
    });
  }

  test("a block to a plain node, and a block of a cuboid with ports: face", async () => {
    const extra = "  - { id: note, component: label, label: note }\n";
    const to = await render(
      FIGURE(
        "{ stack: { gap: 10mm, items: [{ row: { gap: 30mm, align: end, items: [vin, vout] } }, note] } }",
        "{ from: vin.kernel, to: note, component: arrow }",
        extra,
      ),
    );
    expect(nonInfo(to)).toEqual([]);
    const [a] = routePoints(to);
    expect(distanceToBoundary(a as P, part(to, "vin", "kernel").outline)).toBeLessThan(0.6);
    // The other way round, onto a cuboid whose own ends would use faces: the block still wins.
    const face = await render(
      FIGURE(ROW, "{ from: vout.cell, to: vin.kernel, component: arrow }").replace(
        "      width: 20.8mm",
        "      ports: face\n      width: 20.8mm",
      ),
    );
    expect(nonInfo(face)).toEqual([]);
    const points = routePoints(face);
    expect(distanceToBoundary(points[0] as P, part(face, "vout", "cell").outline)).toBeLessThan(
      0.6,
    );
    expect(distanceToBoundary(points[1] as P, part(face, "vin", "kernel").outline)).toBeLessThan(
      0.6,
    );
  });

  // The block's contact is aimed from the other end's actual contact, so the drawn line passes
  // through the block's centre whether that end is automatic, anchored or a face port.
  for (const [name, edge, face] of [
    ["face port, block first", "{ from: vout.cell, to: vin, component: arrow }", true],
    ["face port, block last", "{ from: vin, to: vout.cell, component: arrow }", true],
    [
      "anchor, block first",
      "{ from: vout.cell, to: vin, toAnchor: east, component: arrow }",
      false,
    ],
    [
      "anchor, block last",
      "{ from: vin, to: vout.cell, fromAnchor: east, component: arrow }",
      false,
    ],
  ] as const)
    test(`the line passes through the block's centre (${name})`, async () => {
      const text = FIGURE(ROW, edge);
      const value = await render(
        face ? text.replace("      width: 31.2mm", "      ports: face\n      width: 31.2mm") : text,
      );
      expect(nonInfo(value)).toEqual([]);
      const [a, b] = routePoints(value) as [P, P];
      const cell = part(value, "vout", "cell");
      expect(distanceToLine(centre(cell.box), a, b)).toBeLessThan(0.6);
      const own = edge.startsWith("{ from: vout") ? a : b;
      expect(distanceToBoundary(own, cell.outline)).toBeLessThan(0.6);
    });

  test("route: curve draws a cubic that meets the block's silhouette", async () => {
    const value = await render(
      FIGURE(ROW, "{ from: vin.kernel, to: vout.cell, component: arrow, route: curve }"),
    );
    expect(nonInfo(value)).toEqual([]);
    const points = routePoints(value);
    expect(points).toHaveLength(4);
    expect(distanceToBoundary(points[0] as P, part(value, "vin", "kernel").outline)).toBeLessThan(
      0.6,
    );
    expect(distanceToBoundary(points[3] as P, part(value, "vout", "cell").outline)).toBeLessThan(
      0.6,
    );
  });

  test("a block deep inside the volume keeps its centre and silhouette", async () => {
    const value = await render(FIGURE(ROW, "{ from: vin.deep, to: vout.cell, component: arrow }"));
    expect(nonInfo(value)).toEqual([]);
    const [a] = routePoints(value);
    expect(distanceToBoundary(a as P, part(value, "vin", "deep").outline)).toBeLessThan(0.6);
  });

  test("validation: an unknown block, an anchor on a block, route: curve is accepted", () => {
    expect(codes(FIGURE(ROW, "{ from: vin.nope, to: vout.cell }"))).toContain("ref/unknown-cell");
    const unknown = checkFigure(FIGURE(ROW, "{ from: vin.nope, to: vout.cell }")).state.diagnostics;
    expect(unknown.find((d) => d.code === "ref/unknown-cell")?.message).toContain("Unknown block");
    expect(codes(FIGURE(ROW, "{ from: vin.kernel, to: vout.cell, toAnchor: west }"))).toContain(
      "layout/part-anchor",
    );
    expect(codes(FIGURE(ROW, "{ from: vin.kernel, to: vout.cell }"))).toEqual([]);
  });

  test("PDF and editable PPTX draw the same line as the SVG", async () => {
    const value = await render(FIGURE(ROW, "{ from: vin.kernel, to: vout.cell, component: line }"));
    const [a, b] = routePoints(value);
    const pdf = svgToPdf(value.svg);
    if (!pdf.ok) throw new Error(JSON.stringify(pdf.diagnostics));
    const inspected = inspectPdf(pdf.value);
    const [pageW, pageH] = [
      inspected.pages[0]?.mediaBox[2] ?? 0,
      inspected.pages[0]?.mediaBox[3] ?? 0,
    ];
    const k = pageW / value.layout.canvas.width;
    const want: [number, number][] = [
      [(a as P).x * k, pageH - (a as P).y * k],
      [(b as P).x * k, pageH - (b as P).y * k],
    ];
    const match = inspected.strokes.some((st) =>
      st.subpaths.some(
        (sub) =>
          sub.length === 2 &&
          sub.every((p, j) => {
            const w = want[j] as [number, number];
            return Math.abs(p[0] - w[0]) < 0.1 && Math.abs(p[1] - w[1]) < 0.1;
          }),
      ),
    );
    expect(match).toBe(true);

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
    const [ra, rb] = [drawing(value, "vin").rect, drawing(value, "vout").rect];
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
    expect(points).toHaveLength(2);
    for (const [j, p] of [a as P, b as P].entries()) {
      const got = points[j] as P;
      expect(Math.abs(got.x - (pa.x + (p.x - ra.x) * scale))).toBeLessThan(3000);
      expect(Math.abs(got.y - (pa.y + (p.y - ra.y) * scale))).toBeLessThan(3000);
    }
  });
});

describe("receptive field between vertically separated blocks (#584)", () => {
  for (const [name, arrange, edge] of [
    ["source above", STACK, "{ from: vin.kernel, to: vout.cell, component: zoom }"],
    ["source below", STACK_REVERSED, "{ from: vin.kernel, to: vout.cell, component: zoom }"],
    ["reversed edge, source above", STACK, "{ from: vout.cell, to: vin.kernel, component: zoom }"],
    [
      "reversed edge, source below",
      STACK_REVERSED,
      "{ from: vout.cell, to: vin.kernel, component: zoom }",
    ],
  ] as const) {
    test(`${name}: four lines join the corresponding corners; hidden ends are cut at the silhouette`, async () => {
      const value = await render(FIGURE(arrange, edge));
      expect(nonInfo(value)).toEqual([]);
      const lines = value.layout.edges[0]?.route?.lines ?? [];
      expect(lines).toHaveLength(4);
      const fromIn = edge.includes("from: vin");
      const [src, dst] = fromIn
        ? [
            { id: "vin", name: "kernel" },
            { id: "vout", name: "cell" },
          ]
        : [
            { id: "vout", name: "cell" },
            { id: "vin", name: "kernel" },
          ];
      const sp = part(value, src.id, src.name);
      const dp = part(value, dst.id, dst.name);
      const sourceAbove = sp.box.y < dp.box.y;
      const [srcFace, dstFace] = sourceAbove
        ? [sp.faces.bottom, dp.faces.top]
        : [sp.faces.top, dp.faces.bottom];
      const [srcVolume, dstVolume] = [
        drawing(value, src.id).drawing.outline,
        drawing(value, dst.id).drawing.outline,
      ];
      lines.forEach(([a, b], i) => {
        const [from, to] = [srcFace[i] as P, dstFace[i] as P];
        for (const [end, original, volume, hidden, front] of [
          [a, from, srcVolume, sourceAbove, sp.frontPlane],
          [b, to, dstVolume, !sourceAbove, dp.frontPlane],
        ] as const) {
          // Along the line the corners define.
          expect(distanceToLine(end, from, to)).toBeLessThan(0.6);
          const moved = Math.hypot(end.x - original.x, end.y - original.y);
          if (!hidden || (front && sourceAbove === (end === a) && (i === 0 || i === 3))) {
            expect(moved).toBeLessThan(0.01);
          } else if (moved > 0.01) {
            expect(distanceToBoundary(end, volume)).toBeLessThan(0.6);
          } else {
            expect(distanceToBoundary(original, volume)).toBeLessThan(0.6);
          }
        }
        // Corresponding corners: the front-left one goes to the front-left one.
        expect(
          Math.sign(to.x - from.x) === Math.sign(b.x - a.x) || Math.abs(to.x - from.x) < 0.01,
        ).toBe(true);
      });
      // Corners 1 and 2 of the hidden face are behind the volume, so those lines are cut.
      const hiddenIndex = sourceAbove ? 0 : 1;
      const cut = lines.filter(([a, b], i) => {
        const original = (hiddenIndex === 0 ? srcFace : dstFace)[i] as P;
        const end = hiddenIndex === 0 ? a : b;
        return Math.hypot(end.x - original.x, end.y - original.y) > 0.01;
      });
      expect(cut.length).toBeGreaterThan(0);
    });
  }

  test("PDF and editable PPTX draw the same four lines as the SVG", async () => {
    const value = await render(
      FIGURE(STACK, "{ from: vin.kernel, to: vout.cell, component: zoom }"),
    );
    const lines = value.layout.edges[0]?.route?.lines ?? [];
    expect(lines).toHaveLength(4);
    const pdf = svgToPdf(value.svg);
    if (!pdf.ok) throw new Error(JSON.stringify(pdf.diagnostics));
    const inspected = inspectPdf(pdf.value);
    const [pageW, pageH] = [
      inspected.pages[0]?.mediaBox[2] ?? 0,
      inspected.pages[0]?.mediaBox[3] ?? 0,
    ];
    const k = pageW / value.layout.canvas.width;
    const dashed = inspected.strokes.filter((st) => st.dash.length > 0 && st.subpaths.length === 4);
    expect(dashed).toHaveLength(1);
    dashed[0]?.subpaths.forEach((sub, i) => {
      expect(sub).toHaveLength(2);
      for (const j of [0, 1]) {
        const p = (lines[i] as [P, P])[j] as P;
        const got = sub[j] as [number, number];
        expect(got[0]).toBeCloseTo(p.x * k, 1);
        expect(got[1]).toBeCloseTo(pageH - p.y * k, 1);
      }
    });

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
    const [ra, rb] = [drawing(value, "vin").rect, drawing(value, "vout").rect];
    const [pa, pb] = [offOf(shapeNamed("n:vin")), offOf(shapeNamed("n:vout"))];
    const scale = (pb.y - pa.y) / (rb.y - ra.y);
    const edge = shapeNamed("e:#0");
    const origin = offOf(edge);
    const points = [...descendants(edge)]
      .filter((e) => e.name === "a:pt")
      .map((e) => ({
        x: Number(attribute(e, "x")) + origin.x,
        y: Number(attribute(e, "y")) + origin.y,
      }));
    expect(points).toHaveLength(8);
    lines.forEach(([a, b], i) => {
      for (const [j, p] of [a, b].entries()) {
        const got = points[2 * i + j] as P;
        expect(Math.abs(got.x - (pa.x + (p.x - ra.x) * scale))).toBeLessThan(3000);
        expect(Math.abs(got.y - (pa.y + (p.y - ra.y) * scale))).toBeLessThan(3000);
      }
    });
  });
});
