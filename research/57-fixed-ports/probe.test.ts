import { expect, test } from "bun:test";
import { canonicalLayout, fixture, type Graph, inspectLayout } from "./probe";

function positionedFixture(): { input: Graph; output: Graph } {
  const input = fixture("RIGHT", true, "FIXED_POS");
  const output = structuredClone(input);
  output.x = 0;
  output.y = 0;
  output.width = 400;
  output.height = 200;
  const group = output.children?.[0];
  const a = group?.children?.[0];
  const b = group?.children?.[1];
  if (!group || !a || !b) throw new Error("missing fixture");
  group.x = 10;
  group.y = 20;
  group.width = 300;
  group.height = 120;
  a.x = 0;
  a.y = 0;
  b.x = 180;
  b.y = 0;
  for (const [i, edge] of output.edges.entries()) {
    edge.container = "group";
    edge.sections = [
      { startPoint: { x: 120, y: i === 0 ? 20 : 60 }, endPoint: { x: 180, y: i === 0 ? 60 : 20 } },
    ];
  }
  return { input, output };
}

test("endpoint checks translate ELK's returned edge container coordinates", () => {
  const { input, output } = positionedFixture();
  const measured = inspectLayout(input, output);
  expect(measured.maxPositionDelta).toBe(0);
  expect(measured.maxEndpointDelta).toBe(0);
  expect(measured.routes[0]?.start).toEqual({ x: 130, y: 40 });
  const bad = structuredClone(output);
  const edge = bad.edges[0];
  if (!edge?.sections?.[0]) throw new Error("missing edge");
  edge.sections[0].endPoint.x += 5;
  expect(inspectLayout(input, bad).maxEndpointDelta).toBe(5);
  edge.sections[0].endPoint.x = NaN;
  expect(() => inspectLayout(input, bad)).toThrow("non-finite");
});

test("geometry projection ignores private fields but detects an actual coordinate change", () => {
  const { output } = positionedFixture();
  const changed = structuredClone(output);
  Object.assign(changed, { $H: 999 });
  Object.assign(changed.children?.[0] ?? {}, { $H: 123 });
  expect(canonicalLayout(changed)).toBe(canonicalLayout(output));
  const node = changed.children?.[0]?.children?.[0];
  if (!node) throw new Error("missing fixture node");
  node.x = 3;
  expect(canonicalLayout(changed)).not.toBe(canonicalLayout(output));
});
