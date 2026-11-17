import { describe, expect, test } from "bun:test";
import { getFontSet } from "../../core/theme/fonts";
import { arrowheadStraightRun, paintedHeadLength } from "./arrowheads";
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

describe("geometry/arrowhead-cramped", () => {
  const code = "geometry/arrowhead-cramped";
  test("reports a zero stem, but does not duplicate overlap warnings", () => {
    for (const [run, count] of [
      [3, 0],
      [8, 1],
      [9.99, 1],
      [10, 0],
      [12, 0],
      [20, 0],
    ]) {
      const findings = lintSpec(
        compiled,
        {
          elements: { "e:e": { path: [p(0, 0), p(40, 0), p(40, run as number)] } },
        },
        { code, source },
      );
      expect(findings).toHaveLength(count as number);
      if (count)
        expect(findings[0]).toMatchObject({
          severity: "info",
          path: ["edges", 0],
          subject: { kind: "edge", id: "e" },
        });
    }
  });

  test("uses painted geometry, source heads, and the printed stem after fit", () => {
    const spec = { elements: { "e:e": { path: [p(0, 0), p(0, 16), p(40, 16)] } } };
    expect(lintSpec(compiled, spec, { code })).toEqual([]);
    // The router's 2pt stem shrunk by a typical fit (0.83) is fine (#411);
    // a stem shrunk below 1pt is not.
    expect(lintSpec(compiled, { ...spec, scale: 0.83 }, { code })).toEqual([]);
    expect(lintSpec(compiled, { ...spec, scale: 0.2 }, { code })).toHaveLength(1);
    const painted = [[p(0, 8), p(0, 9), p(2, 14), p(6, 16), p(32, 16)]];
    const findings = lintSpec(compiled, { ...spec, painted: { "e:e": painted } }, { code });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain("source arrowhead");
  });

  test("a straight edge is reported once when it barely outlasts its heads (#546)", () => {
    const run = (text: string, length: number) =>
      lintSpec(compile(text), { elements: { "e:e": { path: [p(0, 0), p(length, 0)] } } }, { code });
    // Two heads of 8 units leave nothing of a 10-unit line; one finding for the edge.
    const double = run(source, 10);
    expect(double).toHaveLength(1);
    expect(double[0]).toMatchObject({ severity: "info", subject: { kind: "edge", id: "e" } });
    expect(double[0]?.message).toContain("straight line");
    // Room for both heads and 1pt (2 units) of line is fine.
    expect(run(source, 18)).toEqual([]);
    expect(run(source.replace("double-arrow", "arrow"), 10)).toEqual([]);
  });

  test("headless edges and D2 are exempt", () => {
    for (const text of [
      source.replace("double-arrow", "line"),
      source.replace(", layout: { arrange: { row: { items: [a, b] } } }", ""),
    ]) {
      expect(
        lintSpec(compile(text), { elements: { "e:e": { path: [p(0, 0), p(10, 0)] } } }, { code }),
      ).toEqual([]);
    }
    const auto = compile(source.replace(", layout: { arrange: { row: { items: [a, b] } } }", ""));
    expect(
      lintSpec(auto, { elements: { "e:e": { path: [p(0, 0), p(40, 0), p(40, 8)] } } }, { code }),
    ).toEqual([]);
  });
});

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

describe("arrowheads flat on a projected plane (#577)", () => {
  const route = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ];
  // A head at the target tip (100, 0), pointing right, `length` long.
  const head = (length: number) => [
    { x: 100, y: 0 },
    { x: 100 - length, y: 6 },
    { x: 100 - length, y: -6 },
  ];
  test("the painted head length is used: shorter, longer, and the nominal one without heads", () => {
    expect(paintedHeadLength([head(7)], route, false, 12)).toBeCloseTo(7, 6);
    expect(paintedHeadLength([head(15)], route, false, 12)).toBeCloseTo(15, 6);
    expect(paintedHeadLength(undefined, route, false, 12)).toBe(12);
    // The head of the other end is not this end's.
    expect(paintedHeadLength([head(7)], route, true, 12)).toBe(12);
  });
});

describe("arrowhead-on-bend with heads flat on a plane (#577)", () => {
  // Hand-made inspections (a layout cannot easily put the straight run between the two lengths):
  // the target tip is at (40, run), the head points down the last leg and reaches `reach` back.
  const run = (length: number, reach: number | undefined) =>
    lintSpec(
      compiled,
      {
        elements: {
          "e:e": {
            path: [p(0, 0), p(40, 0), p(40, length)],
            ...(reach !== undefined && {
              planeHeads: [[p(40, length), p(37, length - reach), p(43, length - reach)]],
            }),
          },
        },
      },
      { code },
    );
  test("a shortened head fits a run the nominal length would flag", () => {
    expect(run(5, undefined)).toHaveLength(1);
    expect(run(5, 4)).toHaveLength(0);
  });
  test("an extended head is flagged on a run the nominal length would accept", () => {
    expect(run(9, undefined)).toHaveLength(0);
    expect(run(9, 11)).toHaveLength(1);
  });
});
