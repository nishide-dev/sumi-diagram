import { describe, expect, test } from "bun:test";
import { parse, stringify } from "yaml";
import type { ElementKey } from "../../core/check-state";
import { lintGeometry } from "../../lint/geometry/lint";
import { renderFigure } from "../../render/render";
import type { Point } from "../ir";
import { checkRoutes } from "./check";
import { type ParallelEdge, separateParallelRuns } from "./parallel";

const fixture = new URL(
  "../../../tests/fixtures/figures/layout/crossing-token-rows.sumi.yaml",
  import.meta.url,
);

/** Strict interior crossings between orthogonal routes of different edges. */
function countCrossings(routes: Map<ElementKey, Point[]>): number {
  const segments = [...routes.entries()].flatMap(([key, points]) =>
    points.slice(1).map((b, i) => ({ key, a: points[i] as Point, b })),
  );
  let count = 0;
  for (const [i, s] of segments.entries())
    for (const t of segments.slice(i + 1)) {
      if (s.key === t.key) continue;
      const [h, v] = s.a.y === s.b.y ? [s, t] : [t, s];
      if (h.a.y !== h.b.y || v.a.x !== v.b.x) continue;
      const x = v.a.x;
      const y = h.a.y;
      if (
        Math.min(h.a.x, h.b.x) < x &&
        x < Math.max(h.a.x, h.b.x) &&
        Math.min(v.a.y, v.b.y) < y &&
        y < Math.max(v.a.y, v.b.y)
      )
        count++;
    }
  return count;
}

/** source / target positions along the corridor; every edge starts on the same side. */
function build(spans: [number, number][], vertical: boolean, reverse: boolean) {
  const edges: ParallelEdge[] = [];
  const routes = new Map<ElementKey, Point[]>();
  for (const [i, [s, t]] of spans.entries()) {
    const key = `e:${i}` as ElementKey;
    edges.push({ key, width: 2, fromRoom: 16, toRoom: 16 });
    let points = [
      { x: s, y: 0 },
      { x: s, y: 24 + i * 0.5 },
      { x: t, y: 24 + i * 0.5 },
      { x: t, y: 70 },
    ];
    if (vertical) points = points.map((p) => ({ x: p.y, y: p.x }));
    if (reverse) points.reverse();
    routes.set(key, points);
  }
  return { edges, routes };
}

const inversions = (spans: [number, number][]) =>
  spans.reduce(
    (n, a, i) => n + spans.slice(i + 1).filter((b) => (a[0] - b[0]) * (a[1] - b[1]) < 0).length,
    0,
  );

describe("parallel lane order minimises crossings (#329)", () => {
  const cases: Record<string, [number, number][]> = {
    "nested pair": [
      [0, 200],
      [20, 180],
    ],
    "nested pair, reversed document order": [
      [20, 180],
      [0, 200],
    ],
    "crossing pair": [
      [0, 100],
      [20, 180],
    ].map(([s, t]) => [s, 200 - (t as number) + (s as number)]) as [number, number][],
    "monotone overlapping pair (new crossing if misordered)": [
      [0, 150],
      [20, 180],
    ],
    "nested triple": [
      [0, 200],
      [20, 180],
      [40, 160],
    ],
    "nested triple, shuffled": [
      [40, 160],
      [0, 200],
      [20, 180],
    ],
    "mixed triple": [
      [0, 90],
      [20, 200],
      [60, 120],
    ],
    "mixed four": [
      [0, 200],
      [20, 180],
      [100, 60],
      [120, 220],
    ],
    "mixed four, shuffled": [
      [120, 220],
      [20, 180],
      [0, 200],
      [100, 60],
    ],
  };
  for (const [name, spans] of Object.entries(cases))
    for (const vertical of [false, true])
      for (const reverse of [false, true]) {
        test(`${name}, vertical=${vertical}, reverse=${reverse}`, () => {
          const { edges, routes } = build(spans, vertical, reverse);
          separateParallelRuns(routes, edges, [], () => false);
          const lanes = [...routes.values()].map((p) => p[1]?.[vertical ? "x" : "y"]);
          expect(new Set(lanes).size).toBe(spans.length);
          // Never above the topological minimum (one crossing per inverted pair).
          expect(countCrossings(routes)).toBe(inversions(spans));
          // Deterministic: rerunning on a fresh copy gives the same routes.
          const again = build(spans, vertical, reverse);
          separateParallelRuns(again.routes, again.edges, [], () => false);
          expect(again.routes).toEqual(routes);
        });
      }
});

describe("parallel corridor lanes (#329)", () => {
  for (const count of [2, 3, 4])
    for (const reverse of [false, true]) {
      test(`render ${count} crossing token correspondences, reverse=${reverse}`, async () => {
        const doc = parse(await Bun.file(fixture).text());
        doc.figure.layout.arrange.stack.gap = "7mm"; // A* alone leaves geometry/edge-near-edge here (checked against main)
        doc.nodes[0].props.width = "24pt";
        doc.nodes[1].props.width = "32pt";
        for (const node of doc.nodes) node.props.cells = ["1", "2", "3", "4", "5", "6"];
        doc.edges = Array.from({ length: count }, (_, i) =>
          reverse
            ? { from: `gt.${6 - i}`, to: `preds.${i + 1}` }
            : { from: `preds.${i + 1}`, to: `gt.${6 - i}` },
        );
        const source = stringify(doc);
        const result = await renderFigure(source);
        if (!result.ok || !("layout" in result.value))
          throw new Error(JSON.stringify(result.diagnostics));
        expect(
          lintGeometry(result.value, { source }).filter(
            (d) => d.code === "geometry/edge-near-edge",
          ),
        ).toEqual([]);
        expect(checkRoutes(result.value.compiled.ir, result.value.layout).throughNode).toEqual([]);
      });
    }

  test("nested correspondences keep clear lanes even when A* detoured one (8mm)", async () => {
    const doc = parse(await Bun.file(fixture).text());
    doc.figure.layout.arrange.stack.gap = "8mm";
    for (const node of doc.nodes) node.props.cells = ["1", "2", "3", "4", "5", "6", "7"];
    doc.edges = [
      [3, 4],
      [2, 5],
      [1, 6],
    ].map(([a, b]) => ({ from: `preds.${a}`, to: `gt.${b}` }));
    const source = stringify(doc);
    const result = await renderFigure(source);
    if (!result.ok || !("layout" in result.value))
      throw new Error(JSON.stringify(result.diagnostics));
    expect(
      lintGeometry(result.value, { source }).filter((d) => d.code === "geometry/edge-near-edge"),
    ).toEqual([]);
  });

  test("narrow token channel suggests a numeric gap that actually clears the warning", async () => {
    const source = (await Bun.file(fixture).text()).replace("gap: 6mm", "gap: 4mm");
    const result = await renderFigure(source);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const finding = lintGeometry(result.value, { source }).find(
      (d) => d.code === "geometry/edge-near-edge",
    );
    expect(finding?.hint).toContain("clear port-to-port space");
    const mm = /at least ([\d.]+)mm/.exec(finding?.hint ?? "")?.[1];
    expect(mm).toBeDefined();
    const widened = source.replace("gap: 4mm", `gap: ${mm}mm`);
    const retried = await renderFigure(widened);
    if (!retried.ok) throw new Error(JSON.stringify(retried.diagnostics));
    expect(
      lintGeometry(retried.value, { source: widened }).filter(
        (d) => d.code === "geometry/edge-near-edge",
      ),
    ).toEqual([]);
  });
  for (const count of [2, 3, 4])
    for (const vertical of [false, true])
      for (const reverse of [false, true]) {
        test(`${count} crossing runs, vertical=${vertical}, reverse=${reverse}`, () => {
          const edges: ParallelEdge[] = [];
          const routes = new Map<ElementKey, Point[]>();
          for (let i = 0; i < count; i++) {
            const key = `e:${i}` as ElementKey;
            edges.push({ key, width: 2, fromRoom: 16, toRoom: 16 });
            let points = [
              { x: i * 20, y: 0 },
              { x: i * 20, y: 24 + i * 0.5 },
              { x: 200 - i * 20, y: 24 + i * 0.5 },
              { x: 200 - i * 20, y: 70 },
            ];
            if (vertical) points = points.map((p) => ({ x: p.y, y: p.x }));
            if (reverse) points.reverse();
            routes.set(key, points);
          }
          const original = structuredClone(routes);
          separateParallelRuns(routes, edges, [], () => false);
          const axis = vertical ? "x" : "y";
          const lanes = [...routes.values()]
            .map((p) => p[1]?.[axis] as number)
            .sort((a, b) => a - b);
          for (let i = 1; i < lanes.length; i++)
            expect((lanes[i] as number) - (lanes[i - 1] as number)).toBeGreaterThanOrEqual(5.019);
          for (const [key, points] of routes) {
            expect(points[0]).toEqual(original.get(key)?.[0]);
            expect(points[3]).toEqual(original.get(key)?.[3]);
            expect(
              Math.abs((points[1]?.[axis] as number) - (points[0]?.[axis] as number)),
            ).toBeGreaterThanOrEqual(16);
            expect(
              Math.abs((points[3]?.[axis] as number) - (points[2]?.[axis] as number)),
            ).toBeGreaterThanOrEqual(16);
          }
        });
      }

  test("shared trunks, clear lanes, narrow and blocked corridors stay unchanged", () => {
    for (const kind of ["shared", "clear", "narrow", "blocked"]) {
      const edges: ParallelEdge[] = [0, 1].map((i) => ({
        key: `e:${i}` as ElementKey,
        width: 2,
        fromRoom: 16,
        toRoom: 16,
      }));
      const height = kind === "narrow" ? 34 : 70;
      const routes = new Map(
        edges.map((e, i) => [
          e.key,
          [
            { x: i * 20, y: 0 },
            { x: i * 20, y: 17 + i * (kind === "clear" ? 10 : 0.5) },
            { x: 200 - i * 20, y: 17 + i * (kind === "clear" ? 10 : 0.5) },
            { x: 200 - i * 20, y: height },
          ],
        ]),
      );
      const original = structuredClone(routes);
      separateParallelRuns(
        routes,
        edges,
        kind === "blocked" ? [{ x: 80, y: 20, width: 20, height: 40 }] : [],
        () => kind === "shared",
      );
      expect(routes).toEqual(original);
    }
  });

  for (const theme of ["minimal", "academic", "slides", "color", "paper"]) {
    test(`token-row fixture: ${theme}, no parallel-run warning or route damage`, async () => {
      const source = await Bun.file(fixture).text();
      const result = await renderFigure(source, { overrides: { theme } });
      expect(result.ok).toBe(true);
      if (!result.ok || !("layout" in result.value))
        throw new Error(JSON.stringify(result.diagnostics));
      const rendered = result.value;
      expect(
        lintGeometry(rendered, { source }).filter((d) => d.code === "geometry/edge-near-edge"),
      ).toEqual([]);
      const report = checkRoutes(rendered.compiled.ir, rendered.layout);
      for (const key of [
        "unrouted",
        "nonOrthogonal",
        "malformed",
        "throughNode",
        "endpointMisses",
        "overlaps",
        "shortArrowSegments",
        "outside",
      ] as const)
        expect(report[key]).toEqual([]);
    });
  }
});
