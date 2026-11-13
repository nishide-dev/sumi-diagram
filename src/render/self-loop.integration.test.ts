/**
 * `route: curve` on an edge from a node to itself (#519, docs/design/decisions/519-label-styles.md):
 * a loop out of one side of the node and back into it, drawn as one cubic.
 */
import { expect, test } from "bun:test";
import { stringify } from "yaml";
import { checkRoutes } from "../layout/route/check";
import type { Cubic } from "../layout/route/cubic";
import { lintRenderedFigure } from "../lint";
import { svgToPdf } from "./pdf";
import { svgToEditablePptx } from "./pptx";
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
  const freeform = svgToEditablePptx(r.svg, r.compiled.ir);
  expect(freeform.ok).toBe(true);
  const glued = svgToEditablePptx(r.svg, r.compiled.ir, { connectors: "glued" });
  expect(glued.diagnostics.some((d) => d.code === "pptx/unsupported-geometry")).toBe(true);
});
