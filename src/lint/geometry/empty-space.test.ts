import { expect, test } from "bun:test";
import { lintFigure } from "../lint";
import { groupEmptySpace, occupiedArea } from "./empty-space";
import { geometryContextFor, lintGeometry, lintRenderedFigure } from "./lint";
import { groupEmptyArea } from "./rules";
import { compile, inspection, label } from "./testing";

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

test("geometry only, no maxWarnings failure, zero-area frames skipped", async () => {
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

test("positive-area empty groups and unmeasured children are not evidence of whitespace", () => {
  for (const text of ["version: 1\nfigure: { id: empty }\ngroups: [{ id: g }]", source]) {
    const compiled = compile(text);
    expect(
      lintGeometry(
        {
          compiled,
          inspection: inspection(compiled, {
            elements: { "g:g": { bbox: { x: 0, y: 0, width: 100, height: 100 } } },
          }),
        },
        { rules: [groupEmptyArea] },
      ),
    ).toEqual([]);
  }
});

test("generated matrix and legend frames are excluded even when sparse", () => {
  for (const node of [
    "component: matrix, props: { rows: [R], columns: [C], classes: { x: { tone: blue } }, cells: [x] }",
    "component: legend, props: { entries: [{ node: { tone: blue }, label: Blue }] }",
  ]) {
    const compiled = compile(
      `version: 1\nfigure: { id: generated, layout: { arrange: { row: { items: [generated] } } } }\nnodes: [{ id: generated, ${node} }]`,
    );
    const elements = Object.fromEntries(
      [...compiled.ir.elements].map(([key, element]) => [
        key,
        { bbox: { x: 0, y: 0, width: element.kind === "group" ? 1000 : 1, height: 100 } },
      ]),
    );
    const context = geometryContextFor({
      compiled,
      inspection: inspection(compiled, { elements }),
    });
    const frames = context.elements.filter((e) => e.kind === "group");
    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames) {
      expect(context.elements.some((e) => e.ir.kind !== "edge" && e.ir.parent === frame.key)).toBe(
        true,
      );
      expect(groupEmptySpace(context, frame)).toBeUndefined();
    }
    expect(
      lintGeometry(
        { compiled, inspection: inspection(compiled, { elements }) },
        { rules: [groupEmptyArea] },
      ),
    ).toEqual([]);
  }
});

test("a tokens-marked generated frame is excluded", () => {
  // Tokens currently expand to arrange boxes, not groups. Exercise the frame
  // exclusion contract with the origin metadata from a real expanded cell.
  const tokens = compile(`version: 1
figure: { id: tokens, layout: { arrange: { row: { items: [seq] } } } }
nodes: [{ id: seq, component: tokens, props: { cells: [A] } }]
`);
  const origin = tokens.ir.nodes[0]?.tokens;
  if (!origin) throw new Error("Missing tokens origin");
  const context = geometryContextFor({
    compiled,
    inspection: inspection(compiled, {
      elements: {
        "g:g": { bbox: { x: 0, y: 0, width: 100, height: 100 } },
        "n:a": { bbox: { x: 0, y: 0, width: 1, height: 100 } },
      },
    }),
  });
  const group = context.get("g:g");
  if (!group) throw new Error("Missing group");
  expect(groupEmptySpace(context, group)).toBe(0.99);
  expect(
    groupEmptySpace(context, { ...group, ir: { ...group.ir, tokens: origin } }),
  ).toBeUndefined();
});

test("a nested group's whole footprint counts in its parent, while its own sparsity is reported", () => {
  const compiled = compile(`version: 1
figure: { id: nested }
groups: [{ id: outer }, { id: inner, group: outer }]
nodes: [{ id: a, component: box, label: A, group: inner }]
`);
  const findings = lintGeometry(
    {
      compiled,
      inspection: inspection(compiled, {
        elements: {
          "g:outer": { bbox: { x: 0, y: 0, width: 100, height: 100 } },
          "g:inner": { bbox: { x: 0, y: 0, width: 80, height: 100 } },
          "n:a": { bbox: { x: 0, y: 0, width: 1, height: 100 } },
        },
      }),
    },
    { rules: [groupEmptyArea] },
  );
  expect(findings.map((d) => d.subject)).toEqual([{ kind: "group", id: "inner" }]);
});

test("group titles and child labels count beyond body boxes", () => {
  for (const key of ["g:g", "n:a"] as const) {
    const elements = {
      "g:g": {
        bbox: { x: 0, y: 0, width: 100, height: 100 },
        labels: [] as ReturnType<typeof label>[],
      },
      "n:a": {
        bbox: { x: 0, y: 0, width: 10, height: 100 },
        labels: [] as ReturnType<typeof label>[],
      },
    };
    const run = () =>
      lintGeometry(
        { compiled, inspection: inspection(compiled, { elements }) },
        { rules: [groupEmptyArea] },
      );
    expect(run()).toHaveLength(1);
    // A 100-unit square label fills the frame; its overlap with the body counts once.
    elements[key].labels = [label("漢", 50, (100 * 1802) / 2048, { fontSizeUnits: 100 })];
    expect(run()).toEqual([]);
  }
});

test("badges contribute their clipped footprint beyond the child's body", () => {
  const compiled = compile(
    source.replace("label: A", "label: A, badge: { icon: emoji/fire, corner: north-east }"),
  );
  const measured = inspection(compiled, {
    elements: {
      "g:g": { bbox: { x: 0, y: 0, width: 100, height: 100 } },
      "n:a": { bbox: { x: 0, y: 0, width: 25, height: 100 } },
    },
  });
  const context = geometryContextFor({ compiled, inspection: measured });
  const group = context.get("g:g");
  if (!group) throw new Error("Missing group");
  expect(groupEmptySpace(context, group)).toBeLessThan(0.75);
  expect(lintGeometry({ compiled, inspection: measured }, { rules: [groupEmptyArea] })).toEqual([]);
});
