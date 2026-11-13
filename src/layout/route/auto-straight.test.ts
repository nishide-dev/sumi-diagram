/**
 * An unanchored end on a wide node drops straight onto a narrower node
 * (#512): a wide box fanning out to narrower boxes below keeps one straight
 * segment per edge instead of one trunk with jogs.
 */

import { describe, expect, test } from "bun:test";
import type { Diagnostic } from "../../core/diagnostics";
import type { RenderedStructuredFigure } from "../../render/render";
import { renderFigure } from "../../render/render";
import type { Point, Rect } from "../ir";
import { routeEdges, withMergedFanIn } from "./router";

const box = (id: string, width = 40, extra = "") =>
  `  - { id: ${id}, component: box, label: ${id}, props: { width: ${width}pt }${extra} }`;

const doc = (arrange: string, nodes: string[], edges: string[], layoutExtra = "", more = "") => `
version: 1
figure:
  id: auto-straight
  layout:
${layoutExtra}    arrange:
${arrange}
${more}nodes:
${nodes.join("\n")}
edges:
${edges.map((e) => `  - ${e}`).join("\n")}
`;

async function render(text: string) {
  const result = await renderFigure(text, {});
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  return result;
}

function routesOf(value: RenderedStructuredFigure) {
  return value.compiled.ir.edges.map(
    (e) => value.layout.edges.find((l) => l.key === e.key)?.route?.points as Point[],
  );
}

const rectOf = (value: RenderedStructuredFigure, id: string): Rect => {
  const node = value.compiled.ir.nodes.find((n) => n.id === id);
  return value.layout.nodes.find((n) => n.key === node?.key)?.rect as Rect;
};

const errors = (diagnostics: readonly Diagnostic[]) =>
  diagnostics.filter((d) => d.severity === "error").map((d) => d.code);

const fan = (extra = "") =>
  doc(
    `      stack:
        gap: 12mm
        items:
          - wide
          - row: { gap: 6mm, items: [ a, b ] }`,
    [box("wide", 200), box("a"), box("b")],
    ["{ from: wide, to: a }", "{ from: wide, to: b }"],
    extra,
  );

describe("auto straight ends (#512)", () => {
  test("fan-out from a wide box drops straight onto each narrower box, at its centre", async () => {
    const result = await render(fan());
    const value = result.value as RenderedStructuredFigure;
    const wide = rectOf(value, "wide");
    for (const [i, id] of ["a", "b"].entries()) {
      const points = routesOf(value)[i] as Point[];
      const r = rectOf(value, id);
      expect(points).toHaveLength(2);
      const [p, q] = points as [Point, Point];
      expect(p.x).toBe(q.x);
      expect(p.x).toBeCloseTo(r.x + r.width / 2, 1);
      expect(p.y).toBeCloseTo(wide.y + wide.height, 0);
    }
  });

  test("fanIn merge keeps the trunk: one point on the wide box", async () => {
    const value = (await render(fan("    fanIn: merge\n"))).value as RenderedStructuredFigure;
    const [p, q] = routesOf(value).map((r) => (r as Point[])[0]) as [Point, Point];
    expect(p).toEqual(q);
  });

  test("an explicit anchor on either end keeps the written route", async () => {
    const text = fan().replace("{ from: wide, to: a }", "{ from: wide, to: a, fromAnchor: south }");
    const value = (await render(text)).value as RenderedStructuredFigure;
    const a = routesOf(value)[0] as Point[];
    const wide = rectOf(value, "wide");
    expect(a[0]?.x).toBeCloseTo(wide.x + wide.width / 2, 1);
  });

  test("opposite edges on one wide box still route (fall back to merge)", async () => {
    const text = doc(
      `      stack:
        gap: 12mm
        items: [ a, b, wide ]`,
      [
        "  - { id: a, component: box, props: { width: 40pt } }",
        "  - { id: b, component: box, props: { width: 40pt } }",
        "  - { id: wide, component: box, props: { width: 200pt } }",
      ],
      ["{ from: a, to: wide }", "{ from: wide, to: b }"],
    );
    const result = await render(text);
    expect(errors(result.diagnostics)).toEqual([]);
    expect(routesOf(result.value as RenderedStructuredFigure).every((r) => r?.length >= 2)).toBe(
      true,
    );
  });

  test("not in line with the wide side: the centre is past its corner, so no straight end", async () => {
    // A 100pt box over a 20pt box far to the right: no side faces it in line.
    const text = doc(
      `      stack:
        gap: 12mm
        align: start
        items:
          - wide
          - row: { gap: 150pt, items: [ gap, far ] }`,
      [box("wide", 100), box("gap", 10), box("far", 20)],
      ["{ from: wide, to: far }"],
    );
    const value = (await render(text)).value as RenderedStructuredFigure;
    const points = routesOf(value)[0] as Point[];
    expect(points.length).toBeGreaterThan(2);
  });

  test("a title in the straight path: the route is the one without the automatic end", async () => {
    const text = (extra: string) =>
      doc(
        `      stack:
        gap: 12mm
        items: [ wide, g ]`,
        [
          box("wide", 200),
          "  - { id: c, component: box, label: c, group: g, props: { width: 40pt } }",
        ],
        ["{ from: wide, to: c }"],
        extra,
        "groups:\n  - { id: g, label: A title that is long, labelAt: top, arrange: { row: { items: [ c ] } } }\n",
      );
    const auto = (await render(text(""))).value as RenderedStructuredFigure;
    const merge = (await render(text("    fanIn: merge\n"))).value as RenderedStructuredFigure;
    expect(routesOf(auto)).toEqual(routesOf(merge));
  });

  test("an edge to a group of tokens drops straight; a self-loop is left alone", async () => {
    const text = doc(
      `      stack:
        gap: 12mm
        items: [ wide, t ]`,
      [
        box("wide", 200),
        "  - { id: t, component: tokens, props: { width: 16pt, cells: [ a, b ] } }",
      ],
      ["{ from: wide, to: t }", "{ from: wide, to: wide }"],
    );
    const result = await render(text);
    expect(errors(result.diagnostics)).toEqual([]);
    const [drop] = routesOf(result.value as RenderedStructuredFigure) as [Point[], Point[]];
    expect(drop).toHaveLength(2);
  });

  test("the merge retry writes fanIn merge, for spread and for unwritten fanIn", async () => {
    for (const extra of ["", "    fanIn: spread\n"]) {
      const { compiled } = (await render(fan(extra))).value as RenderedStructuredFigure;
      expect(compiled.ir.meta.fanIn).toBe(extra === "" ? undefined : "spread");
      expect(withMergedFanIn(compiled.ir).meta.fanIn).toBe("merge");
    }
  });

  test("routing the retry's figure gives the merge trunk, not the straight drops", async () => {
    const { compiled, layout } = (await render(fan())).value as RenderedStructuredFigure;
    const unrouted = { ...layout, edges: layout.edges.map(({ route: _, ...e }) => e) };
    const merged = routeEdges(withMergedFanIn(compiled.ir), unrouted as typeof layout);
    const [p, q] = merged.layout.edges.map((e) => e.route?.points[0]) as [Point, Point];
    expect(p).toEqual(q);
  });
});
