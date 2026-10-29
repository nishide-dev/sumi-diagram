import { describe, expect, test } from "bun:test";
import { getFontSet } from "../../core/theme/fonts";
import { createGeometryContext } from "./context";
import { microJogLengths } from "./jogs";
import { lintRenderedFigure } from "./lint";
import { edgeJog } from "./rules";
import { compile, inspection, lintSpec } from "./testing";

const source = `version: 1
figure: { id: jog, theme: paper, layout: { arrange: { row: { items: [a, b] } } } }
nodes:
  - { id: a, component: box, label: A }
  - { id: b, component: box, label: B }
edges:
  - { id: e, from: a, to: b }
`;
const compiled = compile(source);
const p = (x: number, y: number) => ({ x, y });
const code = "geometry/edge-jog";
const jog = (length: number) => [p(0, 0), p(40, 0), p(40, length), p(80, length)];

describe(code, () => {
  test("reports a painted step as info with the edge's subject and source path", () => {
    const findings = lintSpec(
      compiled,
      { elements: { "e:e": { path: jog(0.913) } } },
      { code, source },
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      code,
      severity: "info",
      path: ["edges", 0],
      subject: { kind: "edge", id: "e" },
    });
    expect(findings[0]?.message).toContain("0.46pt");
  });

  test("allows promoting the informational finding to warning or disabling it", () => {
    for (const level of ["info", "warning", "off"] as const) {
      const findings = lintSpec(
        compiled,
        { elements: { "e:e": { path: jog(0.913) } } },
        { code, config: { rules: { [code]: level }, maxWarnings: 0 } },
      );
      expect(findings.map((d) => d.severity)).toEqual(level === "off" ? [] : [level]);
    }
  });

  test("existing fixed-port jogs preserve a zero-warning budget unless promoted", async () => {
    const text = await Bun.file(
      `${import.meta.dir}/../../../tests/fixtures/figures/layout/group-caption.sumi.yaml`,
    ).text();
    const options = { rules: [edgeJog], config: { maxWarnings: 0 } };
    const informational = await lintRenderedFigure(text, options);
    expect(informational.diagnostics.filter((d) => d.code === code)).toHaveLength(1);
    expect(informational.summary.warnings).toBe(0);
    expect(informational.exitCode).toBe(0);
    const promoted = await lintRenderedFigure(text, {
      ...options,
      config: { maxWarnings: 0, rules: { [code]: "warning" } },
    });
    expect(promoted.summary.warnings).toBe(1);
    expect(promoted.exitCode).toBe(1);
  });

  test("uses a printed 1pt threshold with SVG quantization slack", () => {
    for (const [length, scale, count] of [
      [1.99, 1, 1],
      [1.999, 1, 0],
      [2, 1, 0],
      [3, 1, 0],
      [3, 0.5, 1],
    ] as const) {
      expect(
        lintSpec(compiled, { scale, elements: { "e:e": { path: jog(length) } } }, { code }),
      ).toHaveLength(count);
    }
  });

  test("joins touching painted pieces, merges collinear points, and ignores duplicates", () => {
    expect(
      microJogLengths([
        [p(0, 0), p(20, 0), p(40, 0)],
        [p(40, 0), p(40, 0), p(40, 0.5)],
        [p(80, 0.5), p(40, 0.5)],
      ]),
    ).toEqual([0.5]);
    expect(microJogLengths([[...jog(1), p(80, 20)]]).sort((a, b) => a - b)).toEqual([1, 40]);
  });

  test("measures only painted geometry, not a logical corner, gap, curve chord or end stub", () => {
    const path = jog(0.5);
    for (const painted of [
      [
        [p(0, 0), p(40, 0)],
        [p(40, 0.5), p(80, 0.5)],
      ],
      [[p(0, 0), p(39, 0), p(39.5, 0.1), p(40, 0.4), p(40.5, 0.5), p(80, 0.5)]],
      [[p(0, 0), p(40, 0), p(40, 0.5)]],
    ]) {
      expect(
        lintSpec(
          compiled,
          { elements: { "e:e": { path } }, painted: { "e:e": painted } },
          { code },
        ),
      ).toEqual([]);
    }
    expect(
      microJogLengths([
        [p(0, 0), p(40, 0), p(40, 1)],
        [p(40, 1), p(80, 1)],
        [p(40, 1), p(0, 1)],
      ]),
    ).toEqual([]);
  });

  test("ignores transparent, zero-width and zero-opacity edges", () => {
    const fonts = getFontSet(compiled.ir.meta.fontSetId);
    if (!fonts) throw new Error("missing fonts");
    for (const style of [
      { stroke: "transparent" },
      { strokeWidth: { pt: 0, units: 0 } },
      { opacity: 0 },
    ]) {
      const context = createGeometryContext(
        compiled.ir,
        inspection(compiled, { elements: { "e:e": { path: jog(0.5) } } }),
        fonts,
      );
      const edge = context.get("e:e");
      if (edge?.ir.kind !== "edge") throw new Error("missing edge");
      edge.ir = { ...edge.ir, style: { ...edge.ir.style, ...style } };
      expect(edgeJog.run(context, undefined)).toEqual([]);
    }
  });

  test("detects the acceptance edge's pre-fix painted S-jog", () => {
    // The arrowhead covers the last 8 units; the orthogonal step is painted.
    const path = [
      p(982.535, 694.327),
      p(1024.796, 694.327),
      p(1024.796, 696.319),
      p(1025.709, 696.319),
      p(1025.709, 680.319),
    ];
    const painted = [...path.slice(0, -1), p(1025.709, 688.319)];
    expect(
      lintSpec(
        compiled,
        {
          elements: { "e:e": { path } },
          painted: { "e:e": painted.slice(1).map((b, i) => [painted[i] ?? b, b]) },
        },
        { code },
      ),
    ).toHaveLength(1);
  });
});
