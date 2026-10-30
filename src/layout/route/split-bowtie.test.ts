import { describe, expect, test } from "bun:test";
import { BUILTIN_THEMES } from "../../core/theme/builtin";
import { layoutStructuredFigure } from "../index";
import { roundUnits } from "../ir";
import { checkRoutes } from "./check";
import { resolveEnds } from "./ports";
import { routeEdges } from "./router";

const source = (axis: "row" | "stack", gap: number, anchors = false) => `version: 1
figure: {id: split, theme: paper, layout: {arrange: {${axis}: {gap: 20pt, items: [a, b, c]}}}}
nodes:
  - {id: a, component: box, label: In, props: {width: 40pt, height: 20pt}}
  - {id: b, component: bowtie, label: LoRA, props: {width: 40pt, height: 40pt, gap: ${gap}}}
  - {id: c, component: box, label: Out, props: {width: 40pt, height: 20pt}}
edges:
  - {from: a, to: b${anchors ? ', fromAnchor: "south:0.5"' : ""}}
  - {from: b, to: c${anchors ? ', toAnchor: "north:0.5"' : ""}}
`;

function layout(text: string, theme = "paper") {
  const result = layoutStructuredFigure(text, { overrides: { theme } });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return { ...result.value, diagnostics: result.diagnostics };
}

describe("split bowtie straight ends (#246)", () => {
  for (const theme of BUILTIN_THEMES.keys()) {
    for (const gap of [1, 4, 8, 64]) {
      test(`${theme}, gap ${gap}: north/south lips align the unshared neighbour`, () => {
        const { ir, layout: placed, diagnostics } = layout(source("stack", gap), theme);
        const [a, b, c] = placed.nodes.map((n) => n.rect);
        if (!a || !b || !c) throw new Error("missing nodes");
        // Width clamps the effective gap to half the width (#233).
        const lip = roundUnits(b.x + b.width / 2 - Math.min(gap, b.width / 2) / 2);
        expect(placed.edges.map((e) => e.route?.points)).toEqual([
          [
            { x: lip, y: roundUnits(a.y + a.height) },
            { x: lip, y: roundUnits(b.y + b.height / 4) },
          ],
          [
            { x: lip, y: roundUnits(b.y + (3 * b.height) / 4) },
            { x: lip, y: c.y },
          ],
        ]);
        expect(diagnostics).toEqual([]);
        expect(Object.values(checkRoutes(ir, placed)).flat()).toEqual([]);
        expect(routeEdges(ir, placed, { verifyLowerBound: true }).diagnostics).toEqual([]);
      });
    }
    test(`${theme}: horizontal row enters/leaves the outer mouths without steps`, () => {
      const { layout: placed, diagnostics } = layout(source("row", 8), theme);
      const [a, b, c] = placed.nodes.map((n) => n.rect);
      if (!a || !b || !c) throw new Error("missing nodes");
      const y = roundUnits(b.y + b.height / 2);
      expect(placed.edges.map((e) => e.route?.points)).toEqual([
        [
          { x: roundUnits(a.x + a.width), y },
          { x: b.x, y },
        ],
        [
          { x: roundUnits(b.x + b.width), y },
          { x: c.x, y },
        ],
      ]);
      expect(diagnostics).toEqual([]);
    });
  }

  test("explicit neighbour anchors keep their position beyond #169's tolerance and report the step", () => {
    const { ir, layout: placed, diagnostics } = layout(source("stack", 8, true));
    expect(diagnostics.map((d) => d.code)).toEqual([
      "layout/unaligned-ends",
      "layout/unaligned-ends",
    ]);
    const ends = resolveEnds(ir, placed);
    const [a, , c] = placed.nodes.map((n) => n.rect);
    if (!a || !c) throw new Error("missing nodes");
    expect(placed.edges[0]?.route?.points[0]).toEqual({ x: a.x + a.width / 2, y: a.y + a.height });
    expect(placed.edges[1]?.route?.points.at(-1)).toEqual({ x: c.x + c.width / 2, y: c.y });
    for (const pair of ends) {
      if ("error" in pair) throw new Error(pair.error);
      expect(Math.abs(pair.from.port.x - pair.to.port.x)).toBe(4);
    }
    expect(Object.values(checkRoutes(ir, placed)).flat()).toEqual([]);
  });

  test("shared neighbour ports keep their nets and report the unavoidable lip steps", () => {
    const text = `${source("stack", 8)}  - {from: a, to: c}\n`;
    const { ir, layout: placed, diagnostics } = layout(text);
    expect(diagnostics.filter((d) => d.code === "layout/unaligned-ends")).toHaveLength(2);
    const ends = resolveEnds(ir, placed);
    const first = ends[0];
    const last = ends[2];
    if (!first || !last || "error" in first || "error" in last) throw new Error("missing ends");
    expect(first.from.port).toEqual(last.from.port);
    expect(placed.edges[0]?.route?.points).toEqual([
      { x: 57, y: 51 },
      { x: 57, y: 75 },
      { x: 53, y: 75 },
      { x: 53, y: 111 },
    ]);
    expect(placed.edges[0]?.route?.net).toBe(placed.edges[2]?.route?.net);
  });

  test("an anchor may still follow a lip within #169's original 2-unit tolerance", () => {
    const { ir, layout: placed, diagnostics } = layout(source("stack", 4, true));
    expect(diagnostics).toEqual([]);
    expect(placed.edges.map((e) => e.route?.points)).toEqual([
      [
        { x: 49, y: 51 },
        { x: 49, y: 111 },
      ],
      [
        { x: 49, y: 151 },
        { x: 49, y: 211 },
      ],
    ]);
    expect(Object.values(checkRoutes(ir, placed)).flat()).toEqual([]);
  });

  test("a lip outside the neighbour's side reports an unaligned end", () => {
    const { ir, layout: placed } = layout(source("stack", 64));
    const nodes = placed.nodes.map((n, index) =>
      index === 1
        ? n
        : {
            ...n,
            rect: { ...n.rect, x: 49, width: 4 },
          },
    );
    const routed = routeEdges(ir, { ...placed, nodes });
    expect(routed.diagnostics.filter((d) => d.code === "layout/unaligned-ends")).toHaveLength(2);
    expect(routed.layout.edges[0]?.route?.points[0]?.x).toBe(51);
    expect(routed.layout.edges[0]?.route?.points.at(-1)?.x).toBe(31);
  });

  test("the checker rejects a contact in the empty gap", () => {
    const { ir, layout: placed } = layout(source("stack", 8));
    const edge = placed.edges[0];
    if (!edge?.route) throw new Error("missing route");
    const points = edge.route.points.map((p) => ({ ...p, x: 51 }));
    const report = checkRoutes(ir, {
      ...placed,
      edges: [{ ...edge, route: { ...edge.route, points } }, ...placed.edges.slice(1)],
    });
    expect(report.endpointMisses).toContain("e:#0 to n:b: 51,111 not on the outline");
  });
});
