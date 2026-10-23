import { describe, expect, test } from "bun:test";
import { checkD2Version, findD2Binary } from "../../backends/d2/binary";
import { getOutlineRenderer } from "../../core/outline";
import { outlineRegistry } from "../../render/outline-testing";
import { renderFigure } from "../../render/render";
import { geometryContextFor, lintGeometry, lintRenderedFigure } from "./lint";
import { depthInside, rectDepthInside, rectPolygon } from "./shapes";

const binary = findD2Binary();
const available = binary.ok && (await checkD2Version(binary.value.path)).ok;
test("pinned D2 is available for custom geometry lint in CI", () => {
  if (process.env.CI) expect(available).toBe(true);
});

describe.skipIf(!available)("geometry lint of composed custom nodes", () => {
  for (const theme of ["minimal", "academic", "slides"]) {
    for (const component of ["stack", "trapezoid"]) {
      test(`${theme}/${component}: auto size and composed label fit with no diagnostics`, async () => {
        const source = `version: 1\nfigure: { id: auto, theme: ${theme}, profile: ${theme === "slides" ? "presentation-16x9" : "paper-double"} }\nnodes:\n  - { id: a, component: test/${component}, label: "処理\\nPipeline" }\n`;
        const report = await lintRenderedFigure(source, { registry: outlineRegistry() });
        expect(report.diagnostics).toEqual([]);
        if (!report.rendered) throw new Error("render failed");
        const node = report.rendered.compiled.ir.nodes[0];
        expect(node?.autoSized).toBe(true);
        const context = geometryContextFor(report.rendered);
        const geometry = context.get("n:a");
        if (!geometry?.bbox || !geometry.labelArea || !node?.render)
          throw new Error("missing geometry");
        const renderer = getOutlineRenderer(node.render.renderer);
        if (!renderer) throw new Error("missing renderer");
        const safe = renderer.draw(
          geometry.bbox,
          renderer.params.parse(node.render.params),
        ).safeArea;
        expect(geometry.labelArea).toEqual(rectPolygon(safe));
        for (const line of geometry.labels.flatMap((label) => label.visibleLines))
          expect(rectDepthInside(geometry.labelArea, line)).toBeGreaterThanOrEqual(
            geometry.strokeInset - 1,
          );
      }, 30_000);
    }
  }

  test("label inside a placeholder rectangle but across the trapezoid edge is an error", async () => {
    const source = `version: 1
figure: { id: slanted, theme: academic }
nodes:
  - id: a
    component: test/trapezoid
    label: 漢漢漢漢漢
    props: { width: 50pt, height: 50pt }
`;
    const report = await lintRenderedFigure(source, {
      registry: outlineRegistry(),
      file: "slanted.sumi.yaml",
    });
    const findings = report.diagnostics.filter((d) => d.code === "geometry/label-overflow");
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: "error",
      path: ["nodes", 0, "props"],
      location: { file: "slanted.sumi.yaml", line: 7 },
    });
    expect(report.exitCode).toBe(1);
    if (!report.rendered) throw new Error("render failed");
    const element = geometryContextFor(report.rendered).get("n:a");
    if (!element?.bbox || !element.labelArea) throw new Error("missing geometry");
    const line = element.labels[0]?.visibleLines[0];
    if (!line) throw new Error("missing measured label");
    expect(rectDepthInside(rectPolygon(element.bbox), line)).toBeGreaterThan(0);
    expect(rectDepthInside(element.labelArea, line)).toBeLessThan(0);
    // Move the label lower to independently demonstrate crossing the drawn
    // slanted edge, in addition to the intentionally conservative safeArea.
    expect(
      depthInside(element.outline as NonNullable<typeof element.outline>, {
        x: line.x,
        y: element.bbox.y + element.bbox.height - 8,
      }),
    ).toBeLessThan(0);
  }, 30_000);

  test("partial explicit size keeps its source path and svg warnings are not duplicated", async () => {
    const source = `version: 1\nfigure: { id: partial }\nnodes:\n  - { id: a, component: test/stack, label: LongLongLong, props: { width: 10pt } }\n`;
    const registry = outlineRegistry();
    const result = await renderFigure(source, { registry });
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.value.compiled.ir.nodes[0]?.autoSized).not.toBe(true);
    const diagnostics = lintGeometry(result.value, { source });
    expect(diagnostics.find((d) => d.code === "geometry/label-overflow")?.path).toEqual([
      "nodes",
      0,
      "props",
    ]);
    const report = await lintRenderedFigure(source, { registry });
    expect(report.diagnostics.filter((d) => d.code === "geometry/label-overflow")).toHaveLength(1);
  }, 30_000);
});
