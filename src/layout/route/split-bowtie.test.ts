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
  for (const offset of [0.5, 0.501]) {
    for (const gap of [1, 8, 64]) {
      test(`bowtie-side explicit anchors use the ${offset === 0.5 ? "left" : "right"} lip, gap ${gap} (#251)`, () => {
        const text = source("stack", gap)
          .replace("{from: a, to: b}", `{from: a, to: b, toAnchor: "north:${offset}"}`)
          .replace("{from: b, to: c}", `{from: b, to: c, fromAnchor: "south:${offset}"}`);
        const { ir, layout: placed, diagnostics } = layout(text);
        const [a, b, c] = placed.nodes.map((n) => n.rect);
        if (!a || !b || !c) throw new Error("missing nodes");
        const halfGap = Math.min(gap, b.width / 2) / 2;
        const center = b.x + b.width / 2;
        const along = roundUnits(center + (offset === 0.5 ? -halfGap : halfGap));
        expect(placed.edges.map((e) => e.route?.points)).toEqual([
          [
            { x: along, y: a.y + a.height },
            { x: along, y: b.y + b.height / 4 },
          ],
          [
            { x: along, y: b.y + (3 * b.height) / 4 },
            { x: along, y: c.y },
          ],
        ]);
        expect(diagnostics).toEqual([]);
        expect(Object.values(checkRoutes(ir, placed)).flat()).toEqual([]);
      });
    }
  }

  test("mandatory lip correction also accepts bent anchored routes (#251)", () => {
    const text = source("stack", 8, true)
      .replace('fromAnchor: "south:0.5"', 'fromAnchor: "south:0.5", toAnchor: "north:0.5"')
      .replace("{from: b, to: c,", '{from: b, to: c, fromAnchor: "south:0.5",');
    const { ir, layout: placed } = layout(text);
    // Offsets are relative to the stack's left edge: the figure's x origin
    // follows the split bowtie's label sizing (#245), not these routes.
    const dx = placed.nodes[0]?.rect.x ?? Number.NaN;
    const at = (x: number, y: number) => ({ x: roundUnits(dx + x), y });
    expect(placed.edges.map((e) => e.route?.points)).toEqual([
      [at(40, 51), at(40, 75), at(36, 75), at(36, 111)],
      [at(36, 151), at(36, 195), at(40, 195), at(40, 211)],
    ]);
    expect(Object.values(checkRoutes(ir, placed)).flat()).toEqual([]);
  });

  for (const kind of ["spread", "parallel", "trapezoids"] as const) {
    test(`${kind}: split bowtie route points (#251)`, () => {
      let text = source("stack", 8);
      if (kind === "spread")
        text = text
          .replace("layout: {", "layout: {fanIn: spread,")
          .replace("items: [a, b, c]", "items: [{row: {gap: 20pt, items: [a, c]}}, b]")
          .replace("{from: b, to: c}", "{from: c, to: b}");
      if (kind === "parallel") text += "  - {from: a, to: b}\n";
      if (kind === "trapezoids")
        text = text
          .replace("component: box, label: In", "component: trapezoid, label: In")
          .replace("component: box, label: Out", "component: trapezoid, label: Out")
          .replace("width: 40pt, height: 20pt}", "width: 40pt, height: 20pt, narrow: south}")
          .replace("width: 40pt, height: 20pt}", "width: 40pt, height: 20pt, narrow: north}");
      const { ir, layout: placed } = layout(text);
      // The stack kinds are relative to the stack's left edge (the figure's x
      // origin follows the split bowtie's label sizing, #245); spread's row
      // coordinates are absolute.
      const left = placed.nodes[0]?.rect.x ?? Number.NaN;
      const at = (x: number, y: number) => ({ x: roundUnits(left + x), y });
      const expected = {
        spread: [
          [
            { x: 51, y: 51 },
            { x: 51, y: 75 },
            { x: 97.667, y: 75 },
            { x: 97.667, y: 105.815 },
          ],
          [
            { x: 171, y: 51 },
            { x: 171, y: 75 },
            { x: 124.333, y: 75 },
            { x: 124.333, y: 105.815 },
          ],
        ],
        parallel: [
          [at(26.667, 51), at(26.667, 105.815)],
          [at(36, 151), at(36, 211)],
          [at(53.333, 51), at(53.333, 105.815)],
        ],
        trapezoids: [
          [at(36, 51), at(36, 111)],
          [at(36, 151), at(36, 211)],
        ],
      };
      expect(placed.edges.map((e) => e.route?.points)).toEqual(expected[kind]);
      expect(Object.values(checkRoutes(ir, placed)).flat()).toEqual([]);
    });
  }

  test("lip correction does not excuse the wrong lip, side, or a shifted ordinary anchor (#251)", () => {
    const text = source("stack", 8, true).replace(
      'fromAnchor: "south:0.5"',
      'fromAnchor: "south:0.5", toAnchor: "north:0.5"',
    );
    const { ir, layout: placed } = layout(text);
    const first = placed.edges[0];
    if (!first?.route) throw new Error("missing route");
    const changed = (edge: typeof first) =>
      checkRoutes(ir, { ...placed, edges: [edge] }).endpointMisses;
    expect(changed({ ...first, toAnchor: { side: "north", offset: 0.501 } })).toContain(
      "e:#0 to n:b: not at the anchor north:0.501",
    );
    expect(changed({ ...first, toAnchor: { side: "south", offset: 0.5 } })).toContain(
      "e:#0 to n:b: not at the anchor south:0.5",
    );
    // The ordinary neighbour stays at its requested x=51. A bent route may
    // not borrow #169's tolerance, even though its bowtie end needed a snap.
    const points = first.route.points.map((p, i) => (i < 2 ? { ...p, x: p.x + 1 } : p));
    expect(changed({ ...first, route: { ...first.route, points } })).toContain(
      "e:#0 from n:a: not at the anchor south:0.5",
    );
  });

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
    const [a, b, c] = placed.nodes.map((n) => n.rect);
    if (!a || !b || !c) throw new Error("missing nodes");
    // Split-label bounds can translate the layout; the lip stays 2 units off the anchors.
    const lip = roundUnits(b.x + b.width / 2 - 2);
    expect(roundUnits(a.x + a.width / 2 - lip)).toBe(2);
    expect(roundUnits(c.x + c.width / 2 - lip)).toBe(2);
    expect(diagnostics).toEqual([]);
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
    expect(Object.values(checkRoutes(ir, placed)).flat()).toEqual([]);
  });

  test("a lip outside the neighbour's side reports an unaligned end", () => {
    const { ir, layout: placed } = layout(source("stack", 64));
    const b = placed.nodes[1]?.rect;
    if (!b) throw new Error("missing bowtie");
    const center = roundUnits(b.x + b.width / 2);
    const lip = roundUnits(center - Math.min(64, b.width / 2) / 2);
    // Keep the narrow neighbours centered on the gap, independent of label-bound translation.
    expect(lip).toBeLessThan(center - 2);
    const nodes = placed.nodes.map((n, index) =>
      index === 1
        ? n
        : {
            ...n,
            rect: { ...n.rect, x: roundUnits(center - 2), width: 4 },
          },
    );
    const routed = routeEdges(ir, { ...placed, nodes });
    expect(routed.diagnostics.filter((d) => d.code === "layout/unaligned-ends")).toHaveLength(2);
    expect(routed.layout.edges[0]?.route?.points[0]?.x).toBe(center);
    expect(routed.layout.edges[0]?.route?.points.at(-1)?.x).toBe(lip);
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
