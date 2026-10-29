import { describe, expect, test } from "bun:test";
import { getFontSet } from "../../core/theme/fonts";
import { arrowheadStraightRun } from "./arrowheads";
import { createGeometryContext } from "./context";
import { arrowheadOnBend } from "./rules";
import { compile, inspection, lintSpec } from "./testing";

const source = `version: 1
figure: { id: bend, theme: paper, layout: { arrange: { row: { items: [a, b] } } } }
nodes:
  - { id: a, component: box, label: A }
  - { id: b, component: box, label: B }
edges:
  - { id: e, from: a, to: b, component: double-arrow }
`;
const compiled = compile(source);
const p = (x: number, y: number) => ({ x, y });
const code = "geometry/arrowhead-on-bend";

describe(code, () => {
  test("reports a short target run with the edge's source path and warning severity", () => {
    const findings = lintSpec(
      compiled,
      {
        elements: { "e:e": { path: [p(0, 0), p(40, 0), p(40, 3)] } },
      },
      { code, source },
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      code,
      severity: "warning",
      path: ["edges", 0],
      subject: { kind: "edge", id: "e" },
    });
    expect(findings[0]?.message).toContain("target arrowhead");
  });

  test("source heads, exact length, rounding slack, and print scaling", () => {
    for (const [length, count] of [
      [3, 1],
      [6.99, 1],
      [7, 0],
      [8, 0],
      [20, 0],
    ]) {
      for (const scale of [1, 0.5]) {
        expect(
          lintSpec(
            compiled,
            {
              scale,
              elements: {
                "e:e": { path: [p(0, 0), p(0, length as number), p(40, length as number)] },
              },
            },
            { code },
          ),
        ).toHaveLength(count as number);
      }
    }
  });

  test("measures the painted bend, not a sharp logical corner or a foreign wire", () => {
    const route = [p(0, 0), p(40, 0), p(40, 10)];
    const painted = [[p(0, 0), p(35, 0), p(39, 3), p(40, 5), p(40, 6)]];
    expect(arrowheadStraightRun(route, painted, false)).toBe(5);
    expect(
      lintSpec(
        compiled,
        {
          elements: { "e:e": { path: route } },
          painted: { "e:e": painted },
        },
        { code },
      ),
    ).toHaveLength(1);
    // An unpainted gap between a triangle's base and tip is not a bend.
    expect(arrowheadStraightRun(route, [[p(0, 0), p(40, 0), p(40, 2)]], false)).toBe(10);
  });

  test("merges collinear pieces and ignores repeated points", () => {
    expect(
      arrowheadStraightRun([p(0, 0), p(40, 0), p(40, 5), p(40, 10), p(40, 10)], [], false),
    ).toBe(10);
  });

  test("D2 triangles include their tip offset and tolerate quantized tangent curves", () => {
    const auto = compile(
      source
        .replace(", layout: { arrange: { row: { items: [a, b] } } }", "")
        .replace("double-arrow", "arrow"),
    );
    // paper: w=1, marker length=7, tip 1.5 beyond the connection endpoint.
    for (const [run, count] of [
      [2, 1],
      [5.5, 0],
      [8, 0],
    ]) {
      expect(
        lintSpec(
          auto,
          {
            elements: { "e:e": { path: [p(0, 0), p(40, 0), p(40, run as number)] } },
          },
          { code },
        ),
      ).toHaveLength(count as number);
    }
  });

  test("lines without heads and transparent edges are exempt", () => {
    for (const text of [source.replace("double-arrow", "line"), source]) {
      const figure = compile(text);
      const spec = { elements: { "e:e": { path: [p(0, 0), p(40, 0), p(40, 3)] } } };
      const fonts = getFontSet(figure.ir.meta.fontSetId);
      if (!fonts) throw new Error("missing fonts");
      const context = createGeometryContext(figure.ir, inspection(figure, spec), fonts);
      if (text === source) {
        const edge = context.get("e:e");
        if (edge?.ir.kind === "edge")
          edge.ir = { ...edge.ir, style: { ...edge.ir.style, opacity: 0 } };
      }
      expect(arrowheadOnBend.run(context, undefined)).toEqual([]);
    }
  });
});
