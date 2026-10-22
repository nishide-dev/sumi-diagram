import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type { Point, Rect, Region } from "../geometry";
import { BUILTIN_OUTLINE_RENDERERS, getOutlineRenderer } from "./builtin";
import { assertOutlineDrawing } from "./testing";
import type { OutlineDrawing, OutlineParams, OutlinePath } from "./types";

const sizes = [
  { width: 0.01, height: 0.01 },
  { width: 1, height: 1000 },
  { width: 1000, height: 1 },
  { width: 160, height: 80 },
];
const params: Record<string, OutlineParams[]> = {
  "sumi/trapezoid": [{}, { slant: 0 }, { slant: 0.05 }, { slant: 1 }],
  "sumi/stack": [{}, { layers: 1 }, { layers: 2, offset: 0.01 }, { layers: 8, offset: 64 }],
};

test("renderer registry contains only the bundled geometry implementations", () => {
  expect([...BUILTIN_OUTLINE_RENDERERS.keys()]).toEqual(["sumi/trapezoid", "sumi/stack"]);
  expect(getOutlineRenderer("trapezoid")).toBeUndefined();
  expect(getOutlineRenderer("other/stack")).toBeUndefined();
});

for (const renderer of BUILTIN_OUTLINE_RENDERERS.values()) {
  describe(renderer.id, () => {
    test("has versioned, strict scalar parameters", () => {
      expect(renderer.version).toBe(1);
      expect(renderer.params).toBeInstanceOf(z.ZodObject);
      expect(renderer.params.safeParse({ unknown: 1 }).success).toBe(false);
      expect(renderer.params.safeParse({}).success).toBe(true);
    });

    for (const written of params[renderer.id] ?? []) {
      for (const size of sizes) {
        test(`geometry contract at ${JSON.stringify(size)} / ${JSON.stringify(written)}`, () => {
          const p = Object.freeze(renderer.params.parse(written));
          const footprint = Object.freeze({ x: -12.5, y: 24, ...size });
          const drawing = renderer.draw(footprint, p);
          assertOutlineDrawing(drawing, footprint);
          expect(renderer.draw(footprint, p)).toEqual(drawing);
        });

        test(`label fitting is deterministic and monotone at ${JSON.stringify(size)} / ${JSON.stringify(written)}`, () => {
          const p = Object.freeze(renderer.params.parse(written));
          const label = Object.freeze({ ...size });
          const fitted = renderer.footprint(label, p);
          expect(renderer.footprint(label, p)).toEqual(fitted);
          const footprint = { x: 0, y: 0, ...fitted };
          const drawing = renderer.draw(footprint, p);
          assertOutlineDrawing(drawing, footprint);
          expect(drawing.safeArea.width).toBeGreaterThanOrEqual(size.width - 1e-8);
          expect(drawing.safeArea.height).toBeGreaterThanOrEqual(size.height - 1e-8);
          for (const next of [
            { width: size.width * 2, height: size.height },
            { width: size.width, height: size.height * 2 },
          ]) {
            const grown = renderer.footprint(next, p);
            expect(grown.width).toBeGreaterThanOrEqual(fitted.width);
            expect(grown.height).toBeGreaterThanOrEqual(fitted.height);
          }
        });
      }
    }
  });
}

test("the oracle rejects an incorrect silhouette, missing layer and open body", () => {
  const renderer = getOutlineRenderer("sumi/stack");
  if (!renderer) throw new Error("missing stack");
  const footprint = { x: 0, y: 0, width: 160, height: 80 };
  const drawing = renderer.draw(footprint, renderer.params.parse({}));
  expect(() =>
    assertOutlineDrawing({ ...drawing, layers: drawing.layers.slice(1) }, footprint),
  ).toThrow("body union differs");
  expect(() =>
    assertOutlineDrawing({ ...drawing, outline: [...drawing.outline.slice(1)] }, footprint),
  ).toThrow();
  expect(() =>
    assertOutlineDrawing(
      {
        ...drawing,
        layers: drawing.layers.map((layer) => ({
          ...layer,
          path: { ...layer.path, closed: false },
        })),
      },
      footprint,
    ),
  ).toThrow("body must be closed");
});

test("safe area containment checks concavities, not just the four corners", () => {
  // All four safe-area corners lie inside this U, but its middle is outside.
  const outline: Point[] = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 2 },
    { x: 2, y: 2 },
    { x: 2, y: 0 },
    { x: 3, y: 0 },
    { x: 3, y: 3 },
    { x: 0, y: 3 },
  ];
  const drawing: OutlineDrawing = {
    layers: [{ role: "body", path: { points: outline, closed: true } }],
    outline,
    safeArea: { x: 0.5, y: 0.5, width: 2, height: 2 },
  };
  expect(() => assertOutlineDrawing(drawing, { x: 0, y: 0, width: 3, height: 3 })).toThrow(
    "safe area outside body union",
  );
});

test("body-union equality detects an internal hole even when the outer bbox matches", () => {
  const box = ({ x, y, width, height }: Rect): Point[] => [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ];
  const footprint = { x: 0, y: 0, width: 3, height: 3 };
  const bodies = [
    { x: 0, y: 0, width: 3, height: 1 },
    { x: 0, y: 2, width: 3, height: 1 },
    { x: 0, y: 1, width: 1, height: 1 },
    { x: 2, y: 1, width: 1, height: 1 },
  ];
  const drawing: OutlineDrawing = {
    layers: bodies.map((r) => ({ role: "body", path: { points: box(r), closed: true } })),
    outline: box(footprint),
    safeArea: bodies[0] as Rect,
  };
  expect(() => assertOutlineDrawing(drawing, footprint)).toThrow("body union differs");
});

test("paths preserve closure and cannot express curves", () => {
  const path: OutlinePath = {
    points: [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ],
    closed: false,
  };
  expect(path.closed).toBe(false);
  // @ts-expect-error Curve segments are not an outline path; v1 is points + closed only.
  const curve: OutlinePath = { segments: [{ command: "C", to: { x: 1, y: 1 } }], closed: true };
  expect(curve).not.toHaveProperty("points");
});

test("the oracle rejects an outline that rays from part of a side cannot hit", () => {
  const renderer = getOutlineRenderer("sumi/trapezoid");
  if (!renderer) throw new Error("missing trapezoid");
  const inner: Rect = { x: 1, y: 1, width: 2, height: 2 };
  const drawing = renderer.draw(inner, renderer.params.parse({ slant: 0 }));
  expect(() => assertOutlineDrawing(drawing, { x: 0, y: 0, width: 4, height: 4 })).toThrow(
    "inward rays miss",
  );
});

test("small valid stack steps are not mistaken for self intersections", () => {
  const renderer = getOutlineRenderer("sumi/stack");
  if (!renderer) throw new Error("missing stack");
  const footprint = { x: 100, y: 100, width: 160, height: 80 };
  for (const offset of [1e-7, 1e-6, 1e-5]) {
    assertOutlineDrawing(renderer.draw(footprint, renderer.params.parse({ offset })), footprint);
  }
});

test("explicit collision regions must be finite, nondegenerate, convex and contain the outline", () => {
  const renderer = getOutlineRenderer("sumi/trapezoid");
  if (!renderer) throw new Error("missing trapezoid");
  const footprint = { x: 0, y: 0, width: 4, height: 4 };
  const drawing = renderer.draw(footprint, renderer.params.parse({}));
  const polygon: Region = {
    kind: "polygon",
    points: [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ],
  };
  for (const collision of [
    polygon,
    { ...polygon, points: [...polygon.points].reverse() },
    { kind: "ellipse", cx: 2, cy: 2, rx: 3, ry: 3 },
  ] as Region[]) {
    assertOutlineDrawing({ ...drawing, collision }, footprint);
  }
  const invalid: Region[] = [
    {
      kind: "polygon",
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
      ],
    },
    {
      kind: "polygon",
      points: [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 1, y: 1 },
        { x: 4, y: 4 },
        { x: 0, y: 4 },
      ],
    },
    {
      kind: "polygon",
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
      ],
    },
    {
      kind: "polygon",
      points: [
        { x: NaN, y: 0 },
        { x: 4, y: 0 },
        { x: 0, y: 4 },
      ],
    },
    { kind: "ellipse", cx: NaN, cy: 2, rx: -1, ry: 0 },
    { kind: "ellipse", cx: 2, cy: 2, rx: 0, ry: 3 },
    { kind: "ellipse", cx: 2, cy: 2, rx: 1, ry: 1 },
  ];
  for (const collision of invalid)
    expect(() => assertOutlineDrawing({ ...drawing, collision }, footprint)).toThrow();
});
