import { expect, test } from "bun:test";
import { stringify } from "yaml";
import { BUILTIN_THEMES } from "../../core/theme/builtin";
import { layoutStructuredFigure } from "../index";
import type { Point } from "../ir";
import { checkRoutes } from "./check";
import { arrowRoom, routeEdges } from "./router";

for (const theme of BUILTIN_THEMES.keys()) {
  for (const direction of ["up", "down"] as const) {
    for (const equal of [false, true]) {
      test(`${theme}: ${direction} hidden fork, ${equal ? "equal targets retain their routing" : "unequal targets share a bus"}`, () => {
        const result = layoutStructuredFigure(
          stringify({
            version: 1,
            figure: {
              id: "fork",
              theme,
              layout: {
                arrange: {
                  stack: {
                    direction,
                    gap: "4mm",
                    items: [
                      "router",
                      "split",
                      { row: { gap: "2mm", items: ["e0", "e1", "more", "e15"] } },
                    ],
                  },
                },
              },
            },
            nodes: [
              { id: "router", component: "box", label: "Router", props: { width: "64pt" } },
              { id: "split", component: "junction", variant: "hidden" },
              ...["e0", "e1", "more", "e15"].map((id) => ({
                id,
                component: id === "more" && !equal ? "label" : "box",
                label:
                  id === "more" && !equal ? "···" : `Expert ${id === "more" ? "2" : id.slice(1)}`,
              })),
            ],
            edges: [
              { from: "router", to: "split", component: "line" },
              ...["e0", "e1", "more", "e15"].map((to) => ({ from: "split", to })),
            ],
          }),
        );
        if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
        const { ir, layout } = result.value;
        const junction = layout.edges[0]?.route?.points.at(-1) as Point;
        const rows: number[] = [];
        const lengths: number[] = [];
        for (const edge of layout.edges.slice(1)) {
          const points = edge.route?.points ?? [];
          // One horizontal run from the junction, then a perpendicular arrow approach.
          expect(points.length).toBeLessThanOrEqual(4);
          expect(points[0]).toEqual(junction);
          const corner = points.at(-2) as Point;
          const tip = points.at(-1) as Point;
          rows.push(corner.y);
          expect(corner.x).toBe(tip.x);
          const length = Math.abs(tip.y - corner.y);
          const edgeIR = ir.edges.find((e) => e.key === edge.key);
          expect(length).toBeGreaterThanOrEqual(arrowRoom(edgeIR?.style.strokeWidth.units ?? 0));
          lengths.push(length);
        }
        if (!equal) expect(new Set(rows).size).toBe(1);
        if (!equal) expect(lengths[2]).toBeGreaterThan(lengths[0] as number);
        const report = checkRoutes(ir, layout);
        expect(Object.values(report).flat()).toEqual([]);
        if (equal) {
          // At identical target heights the hidden-fork preference must be a no-op.
          const elements = new Map(ir.elements);
          const split = elements.get("n:split");
          if (split?.kind !== "node") throw new Error("missing split");
          elements.set(split.key, { ...split, variant: "default" });
          const ordinary = routeEdges({ ...ir, elements }, layout);
          expect(ordinary.layout).toEqual(layout);
        }
      });
    }
  }
}
