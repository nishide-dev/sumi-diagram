/**
 * `route: curve` on an edge from a node to itself (#519, docs/design/decisions/519-label-styles.md):
 * a loop out of one side of the node and back into it, drawn as one cubic.
 */
import { expect, test } from "bun:test";
import { stringify } from "yaml";
import type { Point, Rect } from "../layout/ir";
import { checkRoutes } from "../layout/route/check";
import type { Cubic } from "../layout/route/cubic";
import { lintRenderedFigure } from "../lint";
import { svgToPdf } from "./pdf";
import { inspectPdf, PdfRef, parsePdf, textLines } from "./pdf/testing";
import { svgToEditablePptx } from "./pptx";
import { readPptx } from "./pptx/testing";
import { renderFigure } from "./render";

function figure(edge: Record<string, unknown>, component = "box") {
  return stringify({
    version: 1,
    figure: {
      id: "loop",
      theme: "sumi",
      profile: "paper-double",
      layout: { arrange: { row: { gap: "12mm", items: ["a", "b"] } } },
    },
    nodes: [
      { id: "a", component, label: "Agent" },
      { id: "b", component: "box", label: "Tool" },
    ],
    edges: [
      { from: "a", to: "b" },
      { id: "loop", from: "a", to: "a", route: "curve", ...edge },
    ],
  });
}

async function render(text: string) {
  const result = await renderFigure(text);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  if (!("layout" in result.value)) throw new Error("Expected structured");
  return result.value;
}

const loopOf = (r: Awaited<ReturnType<typeof render>>) =>
  r.layout.edges.find((e) => e.key === "e:loop");
const rectOf = (r: Awaited<ReturnType<typeof render>>) =>
  r.layout.nodes.find((n) => n.key === "n:a")?.rect as NonNullable<
    (typeof r.layout.nodes)[number]
  >["rect"];

test("the default loop leaves the north side to the right of the middle and comes back left of it", async () => {
  const r = await render(figure({ label: "repeat T times" }));
  const rect = rectOf(r);
  const p = loopOf(r)?.route?.points as Cubic;
  expect(p).toHaveLength(4);
  expect(p[0].y).toBeCloseTo(rect.y, 1);
  expect(p[3].y).toBeCloseTo(rect.y, 1);
  expect(p[0].x).toBeCloseTo(rect.x + rect.width * 0.7, 1);
  expect(p[3].x).toBeCloseTo(rect.x + rect.width * 0.3, 1);
  // Both handles rise away from the node and the loop is wider than the chord there.
  expect(p[1].y).toBeLessThan(rect.y);
  expect(p[2].y).toBeLessThan(rect.y);
  expect(p[1].x).toBeGreaterThan(p[0].x);
  expect(p[2].x).toBeLessThan(p[3].x);
  // The label sits outside the loop, above the node, and the canvas holds it.
  const label = loopOf(r)?.route?.label;
  expect(label).toBeDefined();
  if (label === undefined) return;
  expect(label.box.y + label.box.height).toBeLessThanOrEqual(rect.y);
  expect(label.box.y).toBeGreaterThanOrEqual(0);
  expect(Object.values(checkRoutes(r.compiled.ir, r.layout)).flat()).toEqual([]);
  // A real cubic with an arrowhead on its end.
  expect(r.svg).toMatch(/<path class="sumi-wire"[^>]* C /);
  const lint = await lintRenderedFigure(figure({ label: "repeat T times" }));
  expect(lint.diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
});

test("anchors choose the side and the direction, and a loop mirrors a lone anchor", async () => {
  const south = await render(figure({ fromAnchor: "south:0.3", toAnchor: "south:0.7" }));
  const rect = rectOf(south);
  const p = loopOf(south)?.route?.points as Cubic;
  expect(p[0].y).toBeCloseTo(rect.y + rect.height, 1);
  expect(p[1].y).toBeGreaterThan(rect.y + rect.height);
  // Leaving at 0.3 and entering at 0.7: counter-clockwise under a box.
  expect(p[0].x).toBeLessThan(p[3].x);

  const east = await render(figure({ fromAnchor: "east:0.2" }));
  const q = loopOf(east)?.route?.points as Cubic;
  const eastRect = rectOf(east);
  expect(q[0].x).toBeCloseTo(eastRect.x + eastRect.width, 1);
  expect(q[0].y).toBeCloseTo(eastRect.y + eastRect.height * 0.2, 1);
  expect(q[3].y).toBeCloseTo(eastRect.y + eastRect.height * 0.8, 1);
});

test("on a circle and a diamond the loop starts and ends on the outline", async () => {
  for (const component of ["circle", "diamond"]) {
    const r = await render(figure({}, component));
    const p = loopOf(r)?.route?.points as Cubic;
    const rect = rectOf(r);
    const c = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    for (const end of [p[0], p[3]]) {
      // On or inside the bounding box, above the middle, and not at its center.
      expect(end.y).toBeLessThanOrEqual(c.y);
      expect(end.y).toBeGreaterThanOrEqual(rect.y - 0.01);
    }
    expect(Object.values(checkRoutes(r.compiled.ir, r.layout)).flat()).toEqual([]);
  }
});

test("a loop that cannot be drawn is a positioned layout/no-route error", async () => {
  for (const edge of [
    { fromAnchor: "north", toAnchor: "south" },
    { fromAnchor: "north:0.5", toAnchor: "north:0.5" },
    { fromAnchor: "straight" },
  ]) {
    const result = await renderFigure(figure(edge));
    expect(result.ok).toBe(false);
    if (result.ok) continue;
    const found = result.diagnostics.find((d) => d.code === "layout/no-route");
    expect(found?.location).toBeDefined();
    expect(found?.path).toEqual(["edges", 1]);
  }
});

test("a loop survives PDF and editable PPTX as a curve; glued connectors refuse it", async () => {
  const r = await render(figure({ label: "retry" }));
  const pdf = svgToPdf(r.svg);
  expect(pdf.ok).toBe(true);
  if (!pdf.ok) throw new Error("pdf");
  expect(inspectPdf(pdf.value).images).toBe(0);
  expect(textLines(inspectPdf(pdf.value).glyphs).some((l) => l.text === "retry")).toBe(true);
  const freeform = svgToEditablePptx(r.svg, r.compiled.ir);
  expect(freeform.ok).toBe(true);
  if (!freeform.ok) throw new Error("pptx");
  const xml = new TextDecoder().decode(readPptx(freeform.value).get("ppt/slides/slide1.xml"));
  expect(xml).toContain("a:cubicBezTo");
  // The SVG's arrowhead on the loop has its tip at the loop's end and points along the end tangent.
  const p = loopOf(r)?.route?.points as Cubic;
  const length = Math.hypot(p[3].x - p[2].x, p[3].y - p[2].y);
  const dir = { x: (p[3].x - p[2].x) / length, y: (p[3].y - p[2].y) / length };
  const heads = [...r.svg.matchAll(/<polygon points="([^"]+)" fill="[^"]+" stroke="none"/g)].map(
    (m) =>
      (m[1] as string).split(" ").map((pt) => {
        const [x, y] = pt.split(",").map(Number);
        return { x: x as number, y: y as number };
      }),
  );
  const head = heads.find(
    (h) => Math.hypot((h[0] as Point).x - p[3].x, (h[0] as Point).y - p[3].y) < 0.5,
  );
  expect(head).toBeDefined();
  if (head === undefined) return;
  const baseMid = {
    x: ((head[1] as Point).x + (head[2] as Point).x) / 2,
    y: ((head[1] as Point).y + (head[2] as Point).y) / 2,
  };
  const back = Math.hypot((head[0] as Point).x - baseMid.x, (head[0] as Point).y - baseMid.y);
  const along =
    (((head[0] as Point).x - baseMid.x) * dir.x + ((head[0] as Point).y - baseMid.y) * dir.y) /
    back;
  expect(along).toBeGreaterThan(0.99);
  expect(dir.y).toBeGreaterThan(0.5); // entering the north side: pointing down
  const glued = svgToEditablePptx(r.svg, r.compiled.ir, { connectors: "glued" });
  expect(glued.diagnostics.some((d) => d.code === "pptx/unsupported-geometry")).toBe(true);
});

test("a loop that overflows the content moves the sets with the nodes", async () => {
  const text = (loop: boolean) =>
    stringify({
      version: 1,
      figure: {
        id: "loop-set",
        theme: "sumi",
        profile: "paper-double",
        layout: { arrange: { row: { gap: "12mm", items: ["a", "b"] } } },
      },
      nodes: [
        { id: "a", component: "box", label: "Agent" },
        { id: "b", component: "box", label: "Tool" },
      ],
      sets: [
        { id: "s", members: ["a"], shape: "rect", label: "Loop" },
        { id: "t", members: ["b"], shape: "circle" },
        { id: "u", members: ["a", "b"], shape: "hull" },
        { id: "v", members: ["a"], shape: "ellipse" },
      ],
      edges: [
        { from: "a", to: "b" },
        ...(loop ? [{ from: "a", to: "a", route: "curve", label: "repeat many times over" }] : []),
      ],
    });
  const plain = await render(text(false));
  const looped = await render(text(true));
  const members: Record<string, string[]> = { s: ["a"], t: ["b"], u: ["a", "b"], v: ["a"] };
  const nodeRect = (r: typeof plain, id: string) =>
    r.layout.nodes.find((n) => n.key === `n:${id}`)?.rect as Rect;
  const shift = (id: string) => ({
    dx: nodeRect(looped, id).x - nodeRect(plain, id).x,
    dy: nodeRect(looped, id).y - nodeRect(plain, id).y,
  });
  const a = shift("a");
  expect(a.dx !== 0 || a.dy !== 0).toBe(true); // the loop did overflow and move things
  for (const set of plain.layout.sets ?? []) {
    const moved = looped.layout.sets?.find((s) => s.id === set.id);
    const own = members[set.id] ?? [];
    if (own.length === 1) {
      // A set with one member moves with that member, whichever way it went.
      const { dx, dy } = shift(own[0] as string);
      expect(moved?.rect.x).toBeCloseTo(set.rect.x + dx, 1);
      expect(moved?.rect.y).toBeCloseTo(set.rect.y + dy, 1);
      if (set.label !== undefined) {
        expect(moved?.label?.anchor.x).toBeCloseTo(set.label.anchor.x + dx, 1);
        expect(moved?.label?.anchor.y).toBeCloseTo(set.label.anchor.y + dy, 1);
      }
    } else {
      // A shared set is fitted again: it still encloses all its members.
      const r = moved?.rect as Rect;
      for (const id of own) {
        const m = nodeRect(looped, id);
        expect(r.x).toBeLessThanOrEqual(m.x + 0.01);
        expect(r.y).toBeLessThanOrEqual(m.y + 0.01);
        expect(r.x + r.width).toBeGreaterThanOrEqual(m.x + m.width - 0.01);
        expect(r.y + r.height).toBeGreaterThanOrEqual(m.y + m.height - 0.01);
      }
    }
  }
});

/** Every stream of the PDF as text (inflated), where the page's operators are; binary fonts add no operator lines. */
function content(pdf: Uint8Array): string {
  return [...parsePdf(pdf).objects.values()]
    .map((o) => (o.stream === undefined ? "" : new TextDecoder("latin1").decode(o.stream)))
    .join("\n");
}

test("the PDF draws the loop as a curve operator and its arrowhead as a filled polygon", async () => {
  const count = (text: string, op: string) =>
    text.split("\n").filter((l) => l.trimEnd().endsWith(` ${op}`) || l.trim() === op).length;
  const withLoop = await render(figure({}));
  const plain = await render(figure({}).replace(/\n {2}- id: loop[\s\S]*$/, "\n"));
  const a = svgToPdf(withLoop.svg);
  const b = svgToPdf(plain.svg);
  if (!a.ok || !b.ok) throw new Error("pdf");
  const [x, y] = [content(a.value), content(b.value)];
  expect(count(x, "c")).toBeGreaterThan(count(y, "c"));
  expect(count(x, "f") + count(x, "f*")).toBeGreaterThan(count(y, "f") + count(y, "f*"));
});

test("the editable PPTX loop is a freeform curve with an arrowhead end", async () => {
  const r = await render(figure({}));
  const pptx = svgToEditablePptx(r.svg, r.compiled.ir);
  if (!pptx.ok) throw new Error("pptx");
  const xml = new TextDecoder().decode(readPptx(pptx.value).get("ppt/slides/slide1.xml"));
  const shape =
    /<p:sp>(?:(?!<\/p:sp>).)*name="e:loop"(?:(?!<\/p:sp>).)*<\/p:sp>/s.exec(xml)?.[0] ?? "";
  expect(shape).toContain("a:cubicBezTo");
  expect(shape).toContain("<a:tailEnd");
});
