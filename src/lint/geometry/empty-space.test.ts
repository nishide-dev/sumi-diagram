import { expect, test } from "bun:test";
import { lintFigure } from "../lint";
import { occupiedArea } from "./empty-space";
import { lintGeometry, lintRenderedFigure } from "./lint";
import { groupEmptyArea } from "./rules";
import { compile, inspection } from "./testing";

test("clipped rectangle union counts overlaps once, ignores empty/outside rectangles", () => {
  const frame = { x: 0, y: 0, width: 10, height: 10 };
  expect(
    occupiedArea(frame, [
      { x: -5, y: 0, width: 10, height: 10 },
      { x: 2, y: 2, width: 6, height: 6 },
      { x: 100, y: 100, width: 1, height: 1 },
    ]),
  ).toBe(68);
  expect(occupiedArea(frame, [])).toBe(0);
});

const source = `version: 1
figure: { id: empty-area }
groups: [{ id: g }]
nodes: [{ id: a, component: box, label: A, group: g }]
`;
const compiled = compile(source);

test("75% boundary, source location, info severity and configurable suppression", () => {
  for (const [width, count] of [
    [25, 1],
    [25.01, 0],
  ] as const) {
    const input = {
      compiled,
      inspection: inspection(compiled, {
        elements: {
          "g:g": { bbox: { x: 0, y: 0, width: 100, height: 100 } },
          "n:a": { bbox: { x: 0, y: 0, width, height: 100 } },
        },
      }),
    };
    const options = { rules: [groupEmptyArea], source, file: "empty.sumi.yaml" };
    const findings = lintGeometry(input, options);
    expect(findings).toHaveLength(count);
    if (count) {
      expect(findings[0]).toMatchObject({
        code: "geometry/group-empty-area",
        severity: "info",
        subject: { kind: "group", id: "g" },
        location: { file: "empty.sumi.yaml", line: 3 },
      });
      expect(findings[0]?.hint).toContain("justify: stretch");
    }
    expect(
      lintGeometry(input, {
        ...options,
        config: { rules: { "geometry/group-empty-area": "off" } },
      }),
    ).toEqual([]);
  }
});

test("geometry only, no maxWarnings failure, empty/generated frames skipped", async () => {
  expect(lintFigure(source, { rules: [groupEmptyArea] }).diagnostics).toEqual([]);
  const sparse = `version: 1
figure: { id: sparse, layout: { arrange: { row: { align: stretch, items: [g, tall] } } } }
groups: [{ id: g, arrange: { stack: { items: [a] } } }]
nodes:
  - { id: a, component: box, label: A }
  - { id: tall, component: box, label: Tall, props: { height: 200pt } }
`;
  const report = await lintRenderedFigure(sparse, {
    rules: [groupEmptyArea],
    config: { maxWarnings: 0 },
  });
  expect(report.exitCode).toBe(0);
  expect(report.summary.warnings).toBe(0);
  expect(report.summary.infos).toBe(1);
  const input = {
    compiled,
    inspection: inspection(compiled, {
      elements: {
        "g:g": { bbox: { x: 0, y: 0, width: 0, height: 0 } },
      },
    }),
  };
  expect(lintGeometry(input, { rules: [groupEmptyArea] })).toEqual([]);
});
