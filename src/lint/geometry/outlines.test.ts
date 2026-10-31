import { expect, test } from "bun:test";
import { compileFigure, expectD2Figure } from "../../compiler/compile";
import type { Point, Region } from "../../core/geometry";
import { getOutlineRenderer } from "../../core/outline";
import { withOutlineNodes } from "../../render/outline-sizing";
import { outlineRegistry } from "../../render/outline-testing";
import { geometryContextFor } from "./lint";
import { convexHull, outlineRegions, regionsOverlap } from "./outlines";
import { labelOverflow } from "./rules";
import { rectPolygon } from "./shapes";
import { centeredBaseline, inspection, label, lintSpec } from "./testing";

const SOURCE = `version: 1
figure: { id: outlines }
groups:
  - { id: group, label: Group }
nodes:
  - id: trap
    component: test/trapezoid
    label: 漢漢漢漢漢
    props: { width: 50pt, height: 50pt }
  - { id: stack, component: test/stack }
  - { id: other, component: box }
  - { id: text, component: label, label: 漢 }
  - { id: circle, component: circle }
  - { id: child, component: test/stack, group: group }
`;
const result = compileFigure(SOURCE, { registry: outlineRegistry(), file: "outlines.sumi.yaml" });
if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
const compiled = expectD2Figure(result.value);
const bbox = { x: 0, y: 0, width: 100, height: 100 };

test("painted boundaries are checked independently of a permissive safeArea", () => {
  const context = geometryContextFor({
    compiled,
    inspection: inspection(compiled, {
      elements: {
        "n:trap": { bbox, labels: [label("漢漢", 50, centeredBaseline(50))] },
      },
    }),
  });
  const element = context.get("n:trap");
  if (element?.ir.kind !== "node") throw new Error("missing node");
  const node = element.ir;
  const permissive = { ...element, labelArea: rectPolygon(bbox) };
  const run = (boundary: readonly Point[]) =>
    labelOverflow.run(
      {
        ...context,
        elements: [{ ...permissive, labelBoundaries: [boundary] }],
      },
      undefined,
    );
  expect(
    run([
      { x: 50, y: 0 },
      { x: 50, y: 100 },
    ]),
  ).toHaveLength(1);
  expect(
    run([
      { x: 0, y: 0 },
      { x: 100, y: 100 },
    ]),
  ).toHaveLength(1);
  expect(
    run([
      { x: 0, y: 0 },
      { x: 0, y: 100 },
    ]),
  ).toEqual([]);
  for (const paint of [{ stroke: "transparent" }, { strokeWidth: { pt: 0, units: 0 } }]) {
    expect(
      labelOverflow.run(
        {
          ...context,
          elements: [
            {
              ...permissive,
              ir: { ...node, style: { ...node.style, ...paint } },
              labelBoundaries: [
                [
                  { x: 50, y: 0 },
                  { x: 50, y: 100 },
                ],
              ],
            },
          ],
        },
        undefined,
      ),
    ).toEqual([]);
  }
});

test("monotone-chain hull removes concave/duplicate/collinear vertices without mutating input", () => {
  const points: Point[] = [
    { x: 1, y: 1 },
    { x: 2, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 2 },
    { x: 2, y: 2 },
    { x: 1, y: 0 },
    { x: 0, y: 0 },
  ];
  const original = structuredClone(points);
  expect(convexHull(points)).toEqual([
    { x: 0, y: 0 },
    { x: 2, y: 0 },
    { x: 2, y: 2 },
    { x: 0, y: 2 },
  ]);
  expect(points).toEqual(original);
});

test("context uses the trapezoid silhouette and safe rectangle, not the placeholder", () => {
  const context = geometryContextFor({
    compiled,
    inspection: inspection(compiled, { elements: { "n:trap": { bbox } } }),
  });
  const element = context.get("n:trap");
  expect(element?.outline).toEqual({
    kind: "polygon",
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 75, y: 100 },
      { x: 25, y: 100 },
    ],
  });
  expect(element?.labelArea).toEqual(rectPolygon({ x: 25, y: 0, width: 50, height: 100 }));
  expect(element?.bbox).toEqual(bbox);
});

test("explicit collision overrides the convex hull while labels still use safeArea", () => {
  const renderer = getOutlineRenderer("sumi/stack");
  if (!renderer) throw new Error("missing renderer");
  const drawing = renderer.draw(bbox, renderer.params.parse({}));
  const hull = outlineRegions(drawing);
  expect(hull.outline).toEqual({ kind: "polygon", points: convexHull(drawing.outline) });
  const collision: Region = { kind: "ellipse", cx: 50, cy: 50, rx: 100, ry: 100 };
  const explicit = outlineRegions({ ...drawing, collision });
  expect(explicit.outline).toBe(collision);
  expect(explicit.labelArea).toEqual(hull.labelArea);
});

test("a label that fits the placeholder but crosses a trapezoid side is an overflow", () => {
  const findings = lintSpec(
    compiled,
    { elements: { "n:trap": { bbox, labels: [label("漢漢漢漢漢", 50, centeredBaseline(85))] } } },
    { code: "geometry/label-overflow", source: SOURCE },
  );
  expect(findings).toHaveLength(1);
  expect(findings[0]).toMatchObject({
    severity: "error",
    path: ["nodes", 0, "props"],
    location: { line: 9 },
    related: [{ path: ["nodes", 0, "label"], location: { line: 8 } }],
  });
  expect(findings[0]?.message).toContain("custom outline (sumi/trapezoid)");
  expect(
    lintSpec(
      compiled,
      { elements: { "n:trap": { bbox, labels: [label("漢漢", 50, centeredBaseline(50))] } } },
      { code: "geometry/label-overflow" },
    ),
  ).toEqual([]);
});

test("stack labels must fit the front layer even if they fit the full footprint", () => {
  const findings = lintSpec(
    compiled,
    { elements: { "n:stack": { bbox, labels: [label("漢", 50, centeredBaseline(8))] } } },
    { code: "geometry/label-overflow" },
  );
  expect(findings.map((d) => d.code)).toEqual(["geometry/label-overflow"]);
  expect(
    lintSpec(
      compiled,
      { elements: { "n:stack": { bbox, labels: [label("漢", 42, centeredBaseline(58))] } } },
      { code: "geometry/label-overflow" },
    ),
  ).toEqual([]);
});

test("auto-generated dimensions do not produce advice to edit nonexistent explicit props", () => {
  const auto = withOutlineNodes(
    compiled,
    compiled.ir.nodes.map((n) =>
      n.id === "stack"
        ? { ...n, width: { pt: 50, units: 100 }, height: { pt: 50, units: 100 }, autoSized: true }
        : n,
    ),
  );
  const findings = lintSpec(
    auto,
    {
      elements: { "n:stack": { bbox, labels: [label("漢漢漢漢漢漢", 42, centeredBaseline(58))] } },
    },
    { code: "geometry/label-overflow", source: SOURCE },
  );
  expect(findings).toHaveLength(1);
  expect(findings[0]?.path).toEqual(["nodes", 1, "label"]);
  expect(findings[0]?.hint).not.toContain("props");
});

test("node overlap uses custom convex regions and retains ancestor exclusions", () => {
  for (const component of ["n:other", "n:circle"] as const) {
    const run = (x: number) =>
      lintSpec(
        compiled,
        {
          elements: {
            "n:trap": { bbox },
            [component]: { bbox: { x, y: 80, width: 15, height: 15 } },
          },
        },
        { code: "geometry/node-overlap" },
      );
    expect(run(0)).toEqual([]);
    expect(run(30)).toHaveLength(1);
  }
  expect(
    lintSpec(
      compiled,
      {
        elements: {
          "g:group": { bbox },
          "n:child": { bbox: { x: 10, y: 10, width: 80, height: 80 } },
        },
      },
      { code: "geometry/node-overlap" },
    ),
  ).toEqual([]);
  const run = (x: number, y: number) =>
    lintSpec(
      compiled,
      { elements: { "n:stack": { bbox }, "n:other": { bbox: { x, y, width: 5, height: 5 } } } },
      { code: "geometry/node-overlap" },
    );
  expect(run(0, 0)).toEqual([]);
  expect(run(10, 10)).toHaveLength(1);
});

test("labels in the empty corner of a custom footprint do not collide with its shape", () => {
  const run = (x: number) =>
    lintSpec(
      compiled,
      {
        elements: {
          "n:trap": { bbox },
          "n:text": { labels: [label("漢", x, centeredBaseline(85))] },
        },
      },
      { code: "geometry/label-collision" },
    );
  expect(run(8)).toEqual([]);
  const findings = run(40);
  expect(findings).toHaveLength(1);
  expect(findings[0]?.subject).toEqual({ kind: "node", id: "text" });
  expect(findings[0]?.related?.[0]?.path).toEqual(["nodes", 0]);
});

test("convex-region overlap supports polygon and ellipse combinations, touch and tolerance", () => {
  const polygon = rectPolygon({ x: 0, y: 0, width: 10, height: 10 });
  const circle: Region = { kind: "ellipse", cx: 5, cy: 5, rx: 5, ry: 5 };
  const oval: Region = { kind: "ellipse", cx: 5, cy: 5, rx: 3, ry: 5 };
  for (const region of [polygon, circle, oval]) {
    expect(regionsOverlap(region, region, 1)).toBe(true);
    expect(regionsOverlap(region, { kind: "ellipse", cx: 30, cy: 5, rx: 5, ry: 5 }, 1)).toBe(false);
    expect(regionsOverlap(region, rectPolygon({ x: 30, y: 0, width: 10, height: 10 }), 1)).toBe(
      false,
    );
  }
  expect(regionsOverlap(polygon, rectPolygon({ x: 10, y: 0, width: 10, height: 10 }), 0)).toBe(
    false,
  );
  expect(regionsOverlap(polygon, rectPolygon({ x: 9.5, y: 0, width: 10, height: 10 }), 1)).toBe(
    false,
  );
  expect(regionsOverlap(polygon, rectPolygon({ x: 8, y: 0, width: 10, height: 10 }), 1)).toBe(true);
  expect(regionsOverlap(circle, { ...circle, cx: 15 }, 0)).toBe(false);
  expect(regionsOverlap(circle, { ...circle, cx: 14.5 }, 1)).toBe(false);
  expect(regionsOverlap(circle, { ...circle, cx: 13 }, 1)).toBe(true);
  expect(regionsOverlap(circle, { ...circle, cx: 13, cy: 13 }, 0)).toBe(false);
  expect(regionsOverlap(circle, { ...circle, cx: 10, cy: 10 }, 0)).toBe(true);
  expect(regionsOverlap(rectPolygon({ x: 0, y: 0, width: 0.5, height: 10 }), polygon, 1)).toBe(
    false,
  );
});

test("ellipse support-map overlap agrees with analytic circle and homothetic ellipse cases", () => {
  for (const radius of [2, 5, 20]) {
    for (const tolerance of [0, 1]) {
      for (let dx = -12; dx <= 12; dx += 2) {
        for (let dy = -12; dy <= 12; dy += 2) {
          const a: Region = { kind: "ellipse", cx: -3, cy: 7, rx: radius, ry: radius };
          const b: Region = { ...a, cx: a.cx + dx, cy: a.cy + dy };
          const expected = Math.hypot(dx, dy) < 2 * radius - tolerance - 1e-8;
          expect(regionsOverlap(a, b, tolerance)).toBe(expected);
          expect(regionsOverlap(b, a, tolerance)).toBe(expected);
          const stretchedA = { ...a, rx: radius * 3 };
          const stretchedB = { ...b, rx: radius * 3, cx: a.cx + dx * 3 };
          if (tolerance === 0) expect(regionsOverlap(stretchedA, stretchedB, 0)).toBe(expected);
        }
      }
    }
  }
});

test("inset removes short stack corner edges without losing the remaining collision region", () => {
  const renderer = getOutlineRenderer("sumi/stack");
  if (!renderer) throw new Error("missing stack");
  for (const offset of [0.01, 0.1, 0.2, 0.5, 8]) {
    for (const shift of [0, 100, -100]) {
      const footprint = { x: shift, y: shift, width: 100, height: 100 };
      const drawing = renderer.draw(footprint, renderer.params.parse({ layers: 3, offset }));
      const region = outlineRegions(drawing).outline;
      const center = rectPolygon({ x: shift + 20, y: shift + 20, width: 60, height: 60 });
      expect(regionsOverlap(region, center, 1)).toBe(true);
      expect(regionsOverlap(center, region, 1)).toBe(true);
      expect(regionsOverlap(region, region, 1)).toBe(true);
      if (region.kind === "polygon")
        expect(regionsOverlap({ ...region, points: [...region.points].reverse() }, center, 1)).toBe(
          true,
        );
    }
  }
});

test("node-overlap reports central collisions for a stack with tiny valid step params", () => {
  const registry = outlineRegistry();
  const base = registry.get("test/stack");
  if (base?.kind !== "node") throw new Error("missing stack");
  const registered = registry.register({
    ...base,
    name: "small-step",
    render: { type: "outline", renderer: "sumi/stack", params: { layers: 3, offset: 0.1 } },
  });
  if (!registered.ok) throw new Error(JSON.stringify(registered.diagnostics));
  const source =
    "version: 1\nfigure: { id: tiny-step }\nnodes:\n  - { id: a, component: test/small-step }\n  - { id: b, component: box }\n";
  const result = compileFigure(source, { registry });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  expect(
    lintSpec(
      result.value,
      { elements: { "n:a": { bbox }, "n:b": { bbox: { x: 20, y: 20, width: 60, height: 60 } } } },
      { code: "geometry/node-overlap" },
    ),
  ).toHaveLength(1);
});
