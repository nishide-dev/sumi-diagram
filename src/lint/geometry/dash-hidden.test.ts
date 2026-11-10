import { describe, expect, test } from "bun:test";
import { compile, lintSpec } from "./testing";

const source = (variant: string) => `version: 1
figure: { id: dash, theme: paper, layout: { arrange: { row: { items: [a, b] } } } }
nodes:
  - { id: a, component: box, label: A }
  - { id: b, component: box, label: B }
edges:
  - { id: e, from: a, to: b, variant: ${variant} }
`;

describe("geometry/dash-hidden", () => {
  test("rounded subpaths restart the dash pattern", () => {
    const compiled = compile(source("dashed"));
    const path = Array.from({ length: 7 }, (_, i) => ({
      x: Math.ceil(i / 2) * 10,
      y: Math.floor(i / 2) * 10,
    }));
    const painted = path.slice(1).map((p, i) => [path[i] as { x: number; y: number }, p]);
    expect(
      lintSpec(
        compiled,
        { elements: { "e:e": { path } }, painted: { "e:e": painted } },
        { code: "geometry/dash-hidden" },
      ),
    ).toHaveLength(1);
    expect(
      lintSpec(
        compiled,
        {
          elements: { "e:e": { path } },
          painted: {
            "e:e": [
              [
                { x: 0, y: 0 },
                { x: 30, y: 0 },
              ],
            ],
          },
        },
        { code: "geometry/dash-hidden" },
      ),
    ).toHaveLength(0);
  });

  test("shape-specific arrowhead insets preserve visible wire", () => {
    for (const head of ["cross", "open", "arrow", "triangle"]) {
      const base = compile(source("dashed"));
      const original = base.ir.edges[0];
      if (original === undefined) throw new Error("missing edge");
      const edge = {
        ...original,
        targetArrowhead: head as "cross" | "open" | "arrow" | "triangle",
      };
      const elements = new Map(base.ir.elements);
      elements.set(edge.key, edge);
      const compiled = { ...base, ir: { ...base.ir, elements, edges: [edge] } };
      const findings = lintSpec(
        compiled,
        {
          elements: {
            "e:e": {
              path: [
                { x: 0, y: 0 },
                { x: 18, y: 0 },
              ],
            },
          },
        },
        { code: "geometry/dash-hidden" },
      );
      expect(findings.length, head).toBe(head === "triangle" ? 1 : 0);
    }
  });
  for (const variant of ["dashed", "dotted", "default"]) {
    test(`${variant} checks visible length`, () => {
      const compiled = compile(source(variant));
      const check = (length: number) =>
        lintSpec(
          compiled,
          {
            elements: {
              "e:e": {
                path: [
                  { x: 0, y: 0 },
                  { x: length, y: 0 },
                ],
              },
            },
          },
          { code: "geometry/dash-hidden" },
        );
      expect(check(12)).toHaveLength(variant === "default" ? 0 : 1);
      expect(check(200)).toHaveLength(0);
    });
  }
});
