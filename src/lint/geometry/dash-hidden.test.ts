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
