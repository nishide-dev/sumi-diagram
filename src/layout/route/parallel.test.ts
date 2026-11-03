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

describe("parallel corridor lanes (#329)", () => {
  for (const count of [2, 3, 4])
    for (const reverse of [false, true]) {
      test(`render ${count} crossing token correspondences, reverse=${reverse}`, async () => {
        const doc = parse(await Bun.file(fixture).text());
        doc.figure.layout.arrange.stack.gap = "8mm";
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
