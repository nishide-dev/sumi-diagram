import { expect, test } from "bun:test";
import { deadSpace, figureDeadSpace, largestEmptyRect } from "./dead-space";
import { geometryContextFor, lintGeometry, lintRenderedFigure } from "./lint";
import { heavyScaling } from "./rules";
import { compile, inspection, label } from "./testing";

test("largest empty rectangle is exact, clipped, deterministic and ignores zero-area obstacles", () => {
  const frame = { x: 0, y: 0, width: 10, height: 10 };
  const boxes = [
    { x: 4, y: 4, width: 2, height: 2 },
    { x: -2, y: 8, width: 20, height: 4 },
    { x: 1, y: 1, width: 0, height: 1 },
  ];
  expect(largestEmptyRect(frame, boxes)).toEqual({ x: 0, y: 0, width: 10, height: 4 });
  expect(largestEmptyRect(frame, [...boxes].reverse())).toEqual(largestEmptyRect(frame, boxes));
  expect(largestEmptyRect(frame, [frame])).toBeUndefined();
  expect(largestEmptyRect({ ...frame, width: 0 }, [])).toBeUndefined();
  expect(largestEmptyRect(frame, [], 11)).toBeUndefined();
});

const source = `version: 1
figure: { id: corners }
nodes:
  - { id: right, component: box, label: Right }
  - { id: middle, component: box, label: Middle }
edges: [{ from: right, to: middle }]
`;
const compiled = compile(source);
const canvas = { x: 0, y: 0, width: 1000, height: 1000 };
const elements = {
  "n:right": { bbox: { x: 650, y: 0, width: 350, height: 1000 } },
  "n:middle": { bbox: { x: 0, y: 400, width: 650, height: 200 } },
};

test("DETR-shaped layout reports top-left and bottom-left with printed mm, area and suppression", () => {
  const input = { compiled, inspection: inspection(compiled, { canvas, elements, scale: 0.8 }) };
  const options = { rules: [deadSpace], source, file: "corners.sumi.yaml" };
  const original = structuredClone(input.inspection);
  const findings = lintGeometry(input, options);
  expect(findings).toHaveLength(1);
  expect(findings[0]).toMatchObject({
    code: "geometry/dead-space",
    severity: "info",
    path: ["figure", "layout"],
    subject: { kind: "figure", id: "corners" },
    location: { file: "corners.sumi.yaml", line: 2 },
  });
  expect(findings[0]?.message).toContain("top-left 91.58mm × 56.3mm (25.9%");
  expect(findings[0]?.message).toContain("bottom-left 91.58mm × 56.3mm (25.9%");
  expect(
    lintGeometry(input, { ...options, config: { rules: { "geometry/dead-space": "off" } } }),
  ).toEqual([]);
  expect(input.inspection).toEqual(original);
});

test("the 25% area boundary is inclusive, without rounding smaller voids up", () => {
  for (const [width, count] of [
    [625, 2],
    [624.9, 0],
  ] as const) {
    const context = geometryContextFor({
      compiled,
      inspection: inspection(compiled, {
        canvas,
        elements: {
          "n:right": { bbox: { x: width, y: 0, width: 1000 - width, height: 1000 } },
          "n:middle": { bbox: { x: 0, y: 400, width, height: 200 } },
        },
      }),
    });
    for (const element of context.elements) element.strokeInset = 0;
    expect(figureDeadSpace(context)).toHaveLength(count);
  }
});

test("painted arrows and labels occupy space, while hidden logical routes do not", () => {
  const crossing = [
    { x: 0, y: 200 },
    { x: 650, y: 200 },
  ];
  const run = (painted: boolean) =>
    lintGeometry(
      {
        compiled,
        inspection: inspection(compiled, {
          canvas,
          elements: { ...elements, "e:#0": { path: crossing } },
          painted: { "e:#0": painted ? [crossing] : [] },
        }),
      },
      { rules: [deadSpace] },
    )[0]?.message ?? "";
  expect(run(false)).toContain("top-left");
  expect(run(true)).not.toContain("top-left");
  expect(run(true)).toContain("bottom-left");
  const c = geometryContextFor({
    compiled,
    inspection: inspection(compiled, { canvas, elements }),
  });
  const middle = c.get("n:middle");
  if (!middle) throw new Error("Missing middle");
  middle.labels = [
    {
      label: label("Label", 0, 0),
      fontPath: "",
      texts: ["Label"],
      lines: [],
      visibleLines: [],
      box: { x: 0, y: 0, width: 650, height: 400 },
    },
  ];
  expect(figureDeadSpace(c)).toHaveLength(1);
});

test("whole group frames, outer margins, narrow gutters and small figures are not dead space", () => {
  const c = compile(source.replace("nodes:", "groups: [{ id: g }]\nnodes:"));
  expect(
    lintGeometry(
      {
        compiled: c,
        inspection: inspection(c, {
          canvas,
          elements: {
            ...elements,
            "g:g": { bbox: canvas },
          },
        }),
      },
      { rules: [deadSpace] },
    ),
  ).toEqual([]);
  for (const spec of [
    { canvas, elements: { "n:right": { bbox: { x: 400, y: 400, width: 100, height: 100 } } } },
    {
      canvas: { ...canvas, height: 50 },
      elements: {
        "n:right": { bbox: { x: 700, y: 0, width: 300, height: 50 } },
        "n:middle": { bbox: { x: 0, y: 40, width: 700, height: 10 } },
      },
    },
    { canvas, elements, scale: 0.05 },
  ])
    expect(
      lintGeometry({ compiled, inspection: inspection(compiled, spec) }, { rules: [deadSpace] }),
    ).toEqual([]);
});

test("80% scaling keeps pre-scaling width attribution and 90% boundary is quiet", () => {
  const text = `version: 1
figure: { id: scaled, fit: scale, layout: { arrange: { row: { gap: 10mm, items: [a, b] } } } }
nodes:
  - { id: a, component: box, label: A }
  - { id: b, component: box, label: B }
`;
  const c = compile(text);
  const spec = {
    canvas: { x: 0, y: 0, width: 1000, height: 100 },
    scale: 0.8,
    profile: { maxWidthPt: 400 },
    elements: {
      "n:a": { bbox: { x: 0, y: 0, width: 400, height: 100 } },
      "n:b": { bbox: { x: 500, y: 0, width: 400, height: 100 } },
    },
  };
  const input = { compiled: c, inspection: inspection(c, spec) };
  const original = structuredClone(input.inspection);
  const [finding] = lintGeometry(input, { rules: [heavyScaling], source: text });
  expect(finding).toMatchObject({
    code: "geometry/heavy-scaling",
    severity: "info",
    path: ["figure", "fit"],
  });
  expect(finding?.message).toContain("80%");
  expect(finding?.message).toContain("176.39mm → 141.11mm");
  expect(finding?.hint).toContain("Width to remove: 35.28mm");
  expect(finding?.hint).toContain('node "a" 70.56mm');
  expect(finding?.hint).toContain("17.64mm observed gaps");
  expect(input.inspection).toEqual(original);
  for (const scale of [0.9, 0.95, 1])
    expect(
      lintGeometry(
        { compiled: c, inspection: inspection(c, { ...spec, scale }) },
        { rules: [heavyScaling] },
      ),
    ).toEqual([]);
  expect(
    lintGeometry(input, {
      rules: [heavyScaling],
      config: { rules: { "geometry/heavy-scaling": "off" } },
    }),
  ).toEqual([]);
});

test("rendered scaling is informational, preserves output and verifies natural-width remedies", async () => {
  const text = `version: 1
figure: { id: real, fit: scale, layout: { arrange: { row: { gap: 20mm, items: [a, b] } } } }
nodes:
  - { id: a, component: box, label: A, props: { width: 120pt } }
  - { id: b, component: box, label: B, props: { width: 120pt } }
edges: [{ from: a, to: b }]
`;
  const report = await lintRenderedFigure(text, { config: { maxWarnings: 0 } });
  expect(report.exitCode).toBe(0);
  const finding = report.diagnostics.find((d) => d.code === "geometry/heavy-scaling");
  expect(finding?.hint).toContain(
    'remove the explicit width of node "a" (page width reduced by 35.1mm)',
  );
  expect(finding?.hint).toContain("before scaling");
  expect(report.rendered).toBeDefined();
});

test("real blank grid cells report both left corners through the default lint path", async () => {
  const file = "tests/fixtures/figures/geometry/dead-space.sumi.yaml";
  const text = await Bun.file(file).text();
  const report = await lintRenderedFigure(text, { file });
  const finding = report.diagnostics.find((d) => d.code === "geometry/dead-space");
  expect(finding?.message).toContain("top-left");
  expect(finding?.message).toContain("bottom-left");
  expect(finding?.hint).toContain(
    'remove the explicit width of node "middle" (removes this diagnostic)',
  );
  const edited = await lintRenderedFigure(text.replace("width: 160pt, ", ""));
  expect(edited.diagnostics.some((d) => d.code === "geometry/dead-space")).toBe(false);
  expect(finding?.location?.line).toBe(6);
});
