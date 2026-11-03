import { expect, test } from "bun:test";
import { stringify } from "yaml";
import { layoutStructuredFigure } from "../index";

const source = (title: boolean, align: boolean) =>
  stringify({
    version: 1,
    figure: {
      id: "titled",
      layout: {
        arrange: { row: { gap: "12mm", items: ["a", "g"] } },
        ...(align && { align: [{ y: ["a", "b"] }] }),
      },
    },
    groups: [{ id: "g", ...(title && { label: "Encoder" }), arrange: { stack: { items: ["b"] } } }],
    nodes: ["a", "b"].map((id) => ({ id, component: "box", label: id })),
    edges: [{ from: "a", to: "b" }],
  });

test("a titled frame's center alignment explains the jog and supplies a working remedy", () => {
  const result = layoutStructuredFigure(source(true, false), { file: "title.sumi.yaml" });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.layout.edges[0]?.route?.points.length).toBeGreaterThan(2);
  const diagnostic = result.diagnostics.find((d) => d.code === "layout/group-title-offset");
  expect(diagnostic?.message).toContain('group "g"');
  expect(diagnostic?.hint).toContain("{ y: [a, b] }");
  expect(diagnostic?.path).toEqual(["edges", 0]);
  expect(diagnostic?.location?.file).toBe("title.sumi.yaml");
  for (const [title, align] of [
    [false, false],
    [true, true],
  ]) {
    const fixed = layoutStructuredFigure(source(title as boolean, align as boolean));
    expect(fixed.ok).toBe(true);
    if (!fixed.ok) continue;
    expect(fixed.value.layout.edges[0]?.route?.points).toHaveLength(2);
    expect(fixed.diagnostics.filter((d) => d.code === "layout/group-title-offset")).toEqual([]);
  }
});
