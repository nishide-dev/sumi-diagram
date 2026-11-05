import { expect, test } from "bun:test";
import { parse, stringify } from "yaml";
import { checkFigure } from "../core/check";
import { BUILTIN_THEMES } from "../core/theme/builtin";
import { checkRoutes } from "../layout/route/check";
import type { Cubic } from "../layout/route/cubic";
import { cubicPoint, sampleCubic, trimCubic } from "../layout/route/cubic";
import { lintRenderedFigure } from "../lint";
import { polylinesCrossRect } from "../lint/geometry/shapes";
import { svgToPdf } from "./pdf";
import { svgToEditablePptx, svgToPptx } from "./pptx";
import { readPptx } from "./pptx/testing";
import { renderFigure } from "./render";

const fixture = await Bun.file("tests/fixtures/figures/layout/curve-bundle.sumi.yaml").text();
async function render(text: string, theme = "paper") {
  const result = await renderFigure(text, { overrides: { theme } });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  if (!("layout" in result.value)) throw new Error("Expected structured");
  return result.value;
}
function simple(edge: Record<string, unknown> = {}, obstacle = false) {
  return stringify({
    version: 1,
    figure: {
      id: "curve",
      theme: "paper",
      profile: "paper-double",
      layout: {
        arrange: { row: { gap: "16mm", items: obstacle ? ["a", "obstacle", "b"] : ["a", "b"] } },
      },
    },
    nodes: [
      { id: "a", component: "circle", label: "A" },
      { id: "b", component: "diamond", label: "B" },
      ...(obstacle ? [{ id: "obstacle", component: "box", label: "Blocker" }] : []),
    ],
    edges: [{ id: "ab", from: "a", to: "b", route: "curve", ...edge }],
  });
}

test("four coloured cubics converge and spread with exact through tangents under every theme", async () => {
  for (const theme of BUILTIN_THEMES.keys()) {
    const r = await render(fixture, theme);
    expect(Object.values(checkRoutes(r.compiled.ir, r.layout)).flat()).toEqual([]);
    const curves = r.layout.edges.filter((e) => e.key !== "e:hidden");
    expect(curves).toHaveLength(8);
    for (const e of curves) {
      const p = e.route?.points as Cubic;
      expect(p).toHaveLength(4);
      if (e.key.startsWith("e:in")) {
        expect(p[2].y).toBe(p[3].y);
        expect(p[2].x).toBeLessThan(p[3].x);
      } else {
        expect(p[0].y).toBe(p[1].y);
        expect(p[1].x).toBeGreaterThan(p[0].x);
      }
      expect(e.route?.net).toBeUndefined();
    }
    const wires = [...r.svg.matchAll(/<path class="sumi-wire"[^>]*>/g)].map((m) => m[0]);
    expect(wires.filter((w) => / C /.test(w))).toHaveLength(8);
    expect(
      new Set(wires.filter((w) => / C /.test(w)).map((w) => /stroke="([^"]+)"/.exec(w)?.[1])),
    ).toEqual(
      new Set(r.compiled.ir.edges.filter((e) => e.route === "curve").map((e) => e.style.stroke)),
    );
    const lint = await lintRenderedFigure(fixture, { overrides: { theme } });
    expect(lint.diagnostics).toEqual([]);
  }
});

test("junction through tangents rotate vertically and remain independent of edge order", async () => {
  const doc = parse(fixture);
  const row = doc.figure.layout.arrange.row;
  for (const i of [0, 3]) {
    row.items[i].row = row.items[i].stack;
    delete row.items[i].stack;
  }
  doc.figure.layout.arrange = { stack: row };
  doc.edges.reverse();
  const r = await render(stringify(doc));
  for (const e of r.layout.edges.filter((e) => e.key !== "e:hidden")) {
    const p = e.route?.points as Cubic;
    const [a, b] = e.key.startsWith("e:in") ? [p[2], p[3]] : [p[0], p[1]];
    expect(a.x).toBe(b.x);
    expect(a.y).toBeLessThan(b.y);
  }
});

test("junctions without a through edge share an axis, and explicit sides override it", async () => {
  const doc = parse(fixture);
  doc.edges = doc.edges.filter((e: { id: string }) => e.id !== "hidden");
  const r = await render(stringify(doc));
  for (const e of r.layout.edges) {
    const p = e.route?.points as Cubic;
    const [a, b] = e.key.startsWith("e:in") ? [p[2], p[3]] : [p[0], p[1]];
    expect(a.y).toBe(b.y);
  }
  doc.edges[0].toAnchor = "north";
  const anchored = await render(stringify(doc));
  const p = anchored.layout.edges[0]?.route?.points as Cubic;
  expect(p[2].x).toBe(p[3].x);
  expect(p[2].y).toBeLessThan(p[3].y);
});

test("outline endpoints, explicit anchors and arrow tangents survive native exports", async () => {
  const r = await render(
    simple({ fromAnchor: "east", toAnchor: "west", component: "double-arrow", label: "flow" }),
  );
  expect(checkRoutes(r.compiled.ir, r.layout).endpointMisses).toEqual([]);
  const p = r.layout.edges[0]?.route?.points as Cubic;
  expect(p[0].y).toBe(p[1].y);
  expect(p[2].y).toBe(p[3].y);
  expect(svgToPdf(r.svg).ok).toBe(true);
  expect(svgToPptx(r.svg).ok).toBe(true);
  const exported = svgToEditablePptx(r.svg, r.compiled.ir);
  if (!exported.ok) throw new Error(JSON.stringify(exported.diagnostics));
  const slide = new TextDecoder().decode(readPptx(exported.value).get("ppt/slides/slide1.xml"));
  expect(slide).toContain("<a:cubicBezTo>");
  expect(slide).toContain("<a:headEnd");
  expect(slide).toContain("<a:tailEnd");
  const glued = svgToEditablePptx(r.svg, r.compiled.ir, { connectors: "glued" });
  expect(glued.ok).toBe(false);
  expect(
    glued.diagnostics.some(
      (d) => d.code === "pptx/unsupported-geometry" && d.message.includes("freeform"),
    ),
  ).toBe(true);
});

test("curved labels stay horizontal on either side at start, middle and end", async () => {
  for (const labelAt of ["start", "middle", "end"]) {
    const left = await render(
      simple({ fromAnchor: "north", toAnchor: "north", label: "flow", labelAt }),
    );
    const right = await render(
      simple({
        fromAnchor: "north",
        toAnchor: "north",
        label: "flow",
        labelAt,
        labelSide: "right",
      }),
    );
    const a = left.layout.edges[0]?.route?.label;
    const b = right.layout.edges[0]?.route?.label;
    expect(a?.box.y).toBeLessThan(b?.box.y ?? 0);
    expect(a?.box.width).toBe(b?.box.width);
    expect(checkRoutes(left.compiled.ir, left.layout).outside).toEqual([]);
  }
});

test("node and label crossings on a cubic report YAML and related positions", async () => {
  const result = await lintRenderedFigure(simple({}, true));
  for (const code of ["geometry/edge-through-node", "geometry/edge-crosses-label"]) {
    const finding = result.diagnostics.find((d) => d.code === code);
    expect(finding?.path).toEqual(["edges", 0]);
    expect(finding?.location?.line).toBeGreaterThan(0);
    expect(finding?.related?.[0]?.location?.line).toBeGreaterThan(0);
    expect(finding?.hint).toContain("route: curve");
  }
});

test("lint detects a bowed curve crossing an obstacle that its chord clears", async () => {
  const doc = {
    version: 1,
    figure: {
      id: "bowed-obstacle",
      theme: "paper",
      profile: "paper-double",
      layout: {
        arrange: {
          row: {
            gap: "16mm",
            items: ["a", { stack: { gap: "66pt", items: ["obstacle", "spacer"] } }, "b"],
          },
        },
      },
    },
    nodes: ["a", "b", "obstacle", "spacer"].map((id) => ({
      id,
      component: "box",
      label: id === "obstacle" ? "O" : "",
      props: { width: "20pt", height: "20pt" },
    })),
    edges: [{ from: "a", to: "b", route: "curve", fromAnchor: "north", toAnchor: "north" }],
  };
  const curved = await lintRenderedFigure(stringify(doc));
  for (const code of ["geometry/edge-through-node", "geometry/edge-crosses-label"]) {
    expect(curved.diagnostics.some((d) => d.code === code && d.location !== undefined)).toBe(true);
  }
  const edge = doc.edges[0];
  if (!edge) throw new Error("Missing edge");
  edge.route = "straight";
  const straight = await lintRenderedFigure(stringify(doc));
  expect(
    straight.diagnostics.some((d) =>
      ["geometry/edge-through-node", "geometry/edge-crosses-label"].includes(d.code),
    ),
  ).toBe(false);
});

test("sampling follows the bow rather than the chord, trimming retains exact subcurves", () => {
  const p: Cubic = [
    { x: 0, y: 100 },
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
  ];
  const box = { x: 45, y: 20, width: 10, height: 10 };
  expect(polylinesCrossRect([[p[0], p[3]]], box, 0)).toBe(false);
  expect(polylinesCrossRect([sampleCubic(p)], box, 0)).toBe(true);
  const trimmed = trimCubic(p, 8, 8);
  expect(trimmed[0].y).toBeLessThan(p[0].y);
  expect(trimmed[3].y).toBeLessThan(p[3].y);
  expect(cubicPoint(trimmed, 0.5).y).toBeCloseTo(cubicPoint(p, 0.5).y, 5);
});

test("invalid curve routes fail with source-located diagnostics", async () => {
  for (const edge of [{ to: "a" }, { fromAnchor: "west" }, { component: "zoom" }]) {
    const result = await renderFigure(simple(edge));
    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.some((d) => d.code === "layout/no-route" && d.location !== undefined),
    ).toBe(true);
  }
  const doc = parse(simple());
  doc.figure.layout = { engine: "auto" };
  expect(
    checkFigure(stringify(doc)).state.diagnostics.some(
      (d) => d.code === "layout/structured-only" && d.path?.at(-1) === "route",
    ),
  ).toBe(true);
});
