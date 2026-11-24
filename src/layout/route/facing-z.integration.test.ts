/**
 * #657: an edge with one written anchor whose other end lies beyond it takes a
 * Z into the side facing the anchor where the default side would need three
 * bends; `geometry/avoidable-bend` names the ones the router keeps. Needs no D2.
 */
import { describe, expect, test } from "bun:test";
import { lintGeometry } from "../../lint/geometry/lint";
import { renderFigure } from "../../render/render";
import type { Point } from "../ir";
import { FACING_Z_BUDGET, routeBends } from "./facing-z";

async function render(source: string) {
  const result = await renderFigure(source);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  if (!("layout" in result.value)) throw new Error("not structured");
  return result.value;
}

type Rendered = Awaited<ReturnType<typeof render>>;

const edgeOf = (value: Rendered, from: string, to: string) => {
  const edge = value.layout.edges.find((e) => e.from === `n:${from}` && e.to === `n:${to}`);
  if (edge?.route === undefined) throw new Error(`no route ${from} → ${to}`);
  return edge;
};

const rectOf = (value: Rendered, id: string) => {
  const rect = value.layout.nodes.find((n) => n.key === `n:${id}`)?.rect;
  if (rect === undefined) throw new Error(`no node ${id}`);
  return rect;
};

const avoidable = (value: Rendered) =>
  lintGeometry(value).filter((d) => d.code === "geometry/avoidable-bend");

// The reduced figure of #657 (#639 run 9): working → completed leaves
// working's south side at 0.25; failed sits right below that point.
const RUN9 = (failed = true) => `
version: 1
figure:
  id: run9
  theme: sumi
  profile: screen-doc
  themeOverrides: {textScale: 1.5}
  layout:
    arrange:
      place:
        unit: 1mm
        items:
          - {item: input, at: [20, 10]}
          - {item: working, at: [70, 10]}
          - {item: completed, at: [35, 45]}
${failed ? "          - {item: failed, at: [70, 45]}" : ""}
nodes:
  - {id: input, component: box, label: input-required}
  - {id: working, component: box, label: working}
  - {id: completed, component: box, label: completed}
${failed ? "  - {id: failed, component: box, label: failed}" : ""}
edges:
  - {from: working, to: input, fromAnchor: "west:0.3", toAnchor: "east:0.3"}
  - {from: input, to: working, fromAnchor: "east:0.7", toAnchor: "west:0.7"}
  - {from: working, to: completed, fromAnchor: "south:0.25", label: success}
${failed ? "  - {from: working, to: failed, label: error}" : ""}
`;

describe("a Z into the side facing a written anchor (#657)", () => {
  test("the edge enters completed's north side with two bends; the anchor stays", async () => {
    const value = await render(RUN9());
    const edge = edgeOf(value, "working", "completed");
    const points = edge.route?.points as Point[];
    expect(edge.facingEnd).toBe("to");
    expect(routeBends(edge)).toBe(2);
    const working = rectOf(value, "working");
    const completed = rectOf(value, "completed");
    // Written: south at 0.25 of working.
    expect(points[0]?.y).toBeCloseTo(working.y + working.height, 3);
    expect(points[0]?.x).toBeCloseTo(working.x + working.width * 0.25, 3);
    // Into completed's north side.
    expect(points.at(-1)?.y).toBeCloseTo(completed.y, 3);
    expect(routeBends(edgeOf(value, "working", "failed"))).toBe(0);
    expect(avoidable(value)).toEqual([]);
  });

  test("with nothing in the way the default side's L stays", async () => {
    const value = await render(RUN9(false));
    const edge = edgeOf(value, "working", "completed");
    expect(edge.facingEnd).toBeUndefined();
    expect(routeBends(edge)).toBe(1);
  });

  test("ends the router keeps are reported, with a verified anchor", async () => {
    // More such edges than the router tries: the last one keeps its side entry.
    const n = FACING_Z_BUDGET + 1;
    const items = Array.from({ length: n }, (_, k) =>
      [
        `          - {item: w${k}, at: [70, ${10 + 60 * k}]}`,
        `          - {item: c${k}, at: [28, ${45 + 60 * k}]}`,
        `          - {item: f${k}, at: [70, ${45 + 60 * k}]}`,
      ].join("\n"),
    ).join("\n");
    const nodes = Array.from(
      { length: n },
      (_, k) =>
        `  - {id: w${k}, component: box, label: working}\n  - {id: c${k}, component: box, label: completed}\n  - {id: f${k}, component: box, label: failed}`,
    ).join("\n");
    const edges = (last: string) =>
      Array.from(
        { length: n },
        (_, k) =>
          `  - {from: w${k}, to: c${k}, fromAnchor: "south:0.25"${k === n - 1 ? last : ""}}\n  - {from: w${k}, to: f${k}}`,
      ).join("\n");
    const source = (last = "") => `
version: 1
figure:
  id: many
  theme: sumi
  profile: paper-double
  themeOverrides: {textScale: 1.5}
  layout:
    straighten: false
    arrange:
      place:
        unit: 1mm
        items:
${items}
nodes:
${nodes}
edges:
${edges(last)}
`;
    const value = await render(source());
    for (let k = 0; k < n - 1; k++) expect(routeBends(edgeOf(value, `w${k}`, `c${k}`))).toBe(2);
    const last = edgeOf(value, `w${n - 1}`, `c${n - 1}`);
    expect(routeBends(last)).toBe(3);
    const findings = avoidable(value);
    expect(findings).toHaveLength(1);
    const [finding] = findings;
    expect(finding?.message).toContain(`bends 3 times into the east side of node "c${n - 1}"`);
    expect(finding?.message).toContain('facing the written fromAnchor "south:0.25"');
    expect(finding?.hint).toStartWith('Write toAnchor "north": routed again');
    // Applied, the edge is a Z.
    const fixed = await render(source(', toAnchor: "north"'));
    expect(routeBends(edgeOf(fixed, `w${n - 1}`, `c${n - 1}`))).toBe(2);
  });
});
