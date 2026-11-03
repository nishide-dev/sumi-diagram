import { expect, test } from "bun:test";
import { stringify } from "yaml";
import { layoutStructuredFigure } from "../index";
import { checkRoutes } from "./check";

for (const axis of ["row", "stack"]) {
  for (const component of ["arrow", "line"]) {
    for (const direction of ["forward", "reverse"]) {
      for (const labelSide of [undefined, "left", "right"]) {
        test(`6mm ${axis} ${component} ${direction} label clears nodes (${labelSide ?? "automatic"})`, () => {
          const result = layoutStructuredFigure(
            stringify({
              version: 1,
              figure: {
                id: "short",
                theme: "paper",
                layout: { arrange: { [axis]: { gap: "6mm", items: ["a", "b"] } } },
              },
              nodes: ["a", "b"].map((id) => ({ id, component: "box", label: "Node label" })),
              edges: [
                {
                  component,
                  from: direction === "forward" ? "a" : "b",
                  to: direction === "forward" ? "b" : "a",
                  label: "flatten memory",
                  ...(labelSide && { labelSide }),
                },
              ],
            }),
          );
          expect(result.ok).toBe(true);
          if (!result.ok) return;
          expect(checkRoutes(result.value.ir, result.value.layout).labelCollisions).toEqual([]);
          expect(result.diagnostics.filter((d) => d.code === "layout/edge-label-overlap")).toEqual(
            [],
          );
          const route = result.value.layout.edges[0]?.route;
          expect(route?.points).toHaveLength(2);
          if (labelSide !== undefined && route?.label !== undefined) {
            const [a, b] = route.points;
            if (a === undefined || b === undefined) throw new Error("no route");
            const c = route.label.box;
            const cross =
              (b.x - a.x) * (c.y + c.height / 2 - a.y) - (b.y - a.y) * (c.x + c.width / 2 - a.x);
            expect(cross < 0 ? "left" : "right").toBe(labelSide);
          }
        });
      }
    }
  }
}
