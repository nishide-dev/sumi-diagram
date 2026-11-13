import { describe, expect, test } from "bun:test";
import { lintGeometry } from "../lint/geometry";
import { type RenderedStructuredFigure, renderFigure } from "./render";

/**
 * Four equal ellipses around a method taxonomy (#518): the figure of #509 run 8B,
 * once drawn with hidden junction nodes to widen the ellipses, now with `minWidth`
 * and `minHeight` and with rounded legend samples.
 */
const FIXTURE = `${import.meta.dir}/../../tests/fixtures/figures/sets/method-taxonomy.sumi.yaml`;

async function render(source: string): Promise<RenderedStructuredFigure> {
  const result = await renderFigure(source);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  if (!("layout" in result.value)) throw new Error("expected a structured figure");
  return result.value;
}

describe("method taxonomy without hidden anchors", () => {
  test("renders four ellipses of one size, with no junction and no geometry warning", async () => {
    const source = await Bun.file(FIXTURE).text();
    expect(source).not.toContain("junction");
    const rendered = await render(source);
    const sizes = (rendered.layout.sets ?? []).map((s) =>
      s.outline.kind === "ellipse" ? [s.outline.rx, s.outline.ry] : [],
    );
    expect(sizes).toHaveLength(4);
    // The two end sets are exactly the minimum; the middle ones may be a little wider.
    expect(sizes[0]).toEqual(sizes[3]);
    for (const [rx, ry] of sizes) {
      expect(rx).toBeGreaterThanOrEqual(58 * 2.8346 - 1);
      expect(ry).toBeGreaterThanOrEqual(24 * 2.8346 - 1);
    }
    const warnings = lintGeometry(rendered, { source }).filter((d) =>
      d.code.startsWith("geometry/"),
    );
    expect(warnings).toEqual([]);
  });

  test("a box that crosses a neighbour's outline is geometry/set-outline-crosses-node", async () => {
    const source = (await Bun.file(FIXTURE).text()).replace(
      "{ item: graphsage, at: [ 70, 23 ] }",
      "{ item: graphsage, at: [ 82, 23 ] }",
    );
    const rendered = await render(source);
    const findings = lintGeometry(rendered, { source }).filter(
      (d) => d.code === "geometry/set-outline-crosses-node",
    );
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]).toMatchObject({ severity: "warning", subject: { kind: "set" } });
    expect(findings[0]?.hint).toContain("Move it clear");
  });
});
