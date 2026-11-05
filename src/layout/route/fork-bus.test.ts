import { expect, test } from "bun:test";
import { stringify } from "yaml";
import { BUILTIN_THEMES } from "../../core/theme/builtin";
import { arrowheadStraightRun } from "../../lint/geometry/arrowheads";
import { geometryContextFor, lintGeometry } from "../../lint/geometry/lint";
import { renderFigure } from "../../render/render";
import { layoutStructuredFigure } from "../index";
import type { Point } from "../ir";
import { arrowheadLength } from "./arrowhead";
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
                    gap: theme === "slides" ? "6mm" : "4mm",
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

function regressionSource(theme: string, direction: "up" | "down", staggered = false) {
  const targets = staggered ? ["a", "b", "c"] : ["e0", "e1", "more", "e15"];
  return stringify({
    version: 1,
    figure: {
      id: "fork-regression",
      theme,
      layout: {
        arrange: {
          stack: {
            direction,
            gap: staggered ? "4mm" : theme === "slides" ? "7pt" : "4pt",
            items: [
              "router",
              "split",
              {
                row: {
                  gap: staggered ? "4mm" : "2mm",
                  items: staggered ? [{ stack: { gap: "4mm", items: ["a", "b"] } }, "c"] : targets,
                },
              },
            ],
          },
        },
      },
    },
    nodes: [
      { id: "router", component: "box", label: "Router", props: { width: "64pt" } },
      { id: "split", component: "junction", variant: "hidden" },
      ...targets.map((id) => ({
        id,
        component: id === "more" ? "label" : "box",
        label: staggered ? "Expert" : id === "more" ? "···" : `Expert ${id.slice(1)}`,
      })),
    ],
    edges: [
      { from: "router", to: "split", component: "line" },
      ...targets.map((to) => ({
        from: "split",
        to,
        ...(staggered && { toAnchor: direction === "up" ? "south" : "north" }),
      })),
    ],
  });
}

for (const theme of ["paper", "slides"]) {
  for (const direction of ["up", "down"] as const) {
    test(`${theme}: ${direction} tight gap preserves the label's painted 2pt stem`, async () => {
      const source = regressionSource(theme, direction);
      const result = await renderFigure(source);
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
      const context = geometryContextFor(result.value);
      const label = context.elements.find((e) => e.ir.kind === "edge" && e.ir.to === "n:more");
      if (label?.ir.kind !== "edge" || !label.route || !label.drawn)
        throw new Error("missing painted label branch");
      // Sampled rounded corners locate the painted bend; a logical segment misses this regression.
      const run = arrowheadStraightRun(label.route.at(-1) ?? [], label.drawn, false);
      expect((run - arrowheadLength(label.ir.style.strokeWidth.units)) / 2).toBeCloseTo(2, 3);
      const cramped = lintGeometry(result.value, { source }).filter(
        (d) => d.code === "geometry/arrowhead-cramped",
      );
      expect(cramped.map((d) => d.path)).not.toContainEqual(label.docPath);
      if (theme === "paper") expect(cramped).toHaveLength(3);
    });
  }
}

for (const theme of BUILTIN_THEMES.keys()) {
  for (const direction of ["up", "down"] as const) {
    test(`${theme}: ${direction} equal-size staggered targets retain every route`, () => {
      const result = layoutStructuredFigure(regressionSource(theme, direction, true));
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
      const { ir, layout } = result.value;
      const targets = layout.nodes.filter((n) => ["n:a", "n:b", "n:c"].includes(n.key));
      expect(targets).toHaveLength(3);
      expect(new Set(targets.map((n) => `${n.rect.width},${n.rect.height}`)).size).toBe(1);
      expect(new Set(targets.map((n) => n.rect.y + n.rect.height / 2)).size).toBe(3);
      const elements = new Map(ir.elements);
      const split = elements.get("n:split");
      if (split?.kind !== "node") throw new Error("missing split");
      elements.set(split.key, { ...split, variant: "default" });
      const ordinary = routeEdges({ ...ir, elements }, layout);
      expect(ordinary.diagnostics).toEqual([]);
      expect(ordinary.layout).toEqual(layout);
      expect(Object.values(checkRoutes(ir, layout)).flat()).toEqual([]);
    });
  }
}
