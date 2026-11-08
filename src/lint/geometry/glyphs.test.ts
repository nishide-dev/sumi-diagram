import { expect, test } from "bun:test";
import { centeredBaseline, compile, label, lintSpec } from "./testing";

const code = "geometry/glyph-collision";
const body = { x: 100, y: 100, width: 100, height: 60 };
// Glyphs are small dots centered on the north-east corner (200, 100) of `body`.

const compiled = compile(`version: 1
figure: { id: glyphs, layout: { arrange: { row: { items: [a, b] } } } }
nodes:
  - { id: a, component: box, label: A, glyphs: [{ kind: dot }] }
  - { id: b, component: box }
edges: [{ id: cross, from: a, to: b }]
`);
const icon = compile(`version: 1
figure: { id: glyphs, layout: { arrange: { row: { items: [a] } } } }
nodes: [{ id: a, component: box, icon: tabler/file-text, glyphs: [{ kind: dot }] }]
`);
const twice = compile(`version: 1
figure: { id: glyphs, layout: { arrange: { row: { items: [a] } } } }
nodes: [{ id: a, component: box, label: A, glyphs: [{ kind: dot }, { kind: dot, dx: 0.1 }] }]
`);
const badged = compile(`version: 1
figure: { id: glyphs, layout: { arrange: { row: { items: [a] } } } }
nodes: [{ id: a, component: box, label: A, badge: { icon: emoji/fire, corner: north-east }, glyphs: [{ kind: dot }] }]
`);

test("a glyph over its own body is fine", () => {
  expect(lintSpec(compiled, { elements: { "n:a": { bbox: body } } }, { code })).toEqual([]);
});

test("a glyph over another body, label or crossing edge is reported", () => {
  const other = { "n:b": { bbox: { x: 202, y: 90, width: 50, height: 30 } } };
  const findings = lintSpec(compiled, { elements: { "n:a": { bbox: body }, ...other } }, { code });
  expect(findings).toHaveLength(1);
  expect(findings[0]?.path).toEqual(["nodes", 0, "glyphs", 0]);
  expect(findings[0]?.related).toContainEqual(expect.objectContaining({ path: ["nodes", 1] }));

  const text = label("漢", 200, centeredBaseline(100));
  expect(
    lintSpec(
      compiled,
      {
        elements: {
          "n:a": { bbox: body },
          "n:b": { bbox: { x: 300, y: 100, width: 50, height: 30 }, labels: [text] },
        },
      },
      { code },
    ),
  ).toHaveLength(1);

  const edge = [
    { x: 190, y: 100 },
    { x: 220, y: 100 },
  ];
  expect(
    lintSpec(
      compiled,
      {
        elements: { "n:a": { bbox: body }, "e:cross": { path: edge } },
        painted: { "e:cross": [edge] },
      },
      { code },
    ),
  ).toHaveLength(1);
});

test("a glyph outside the canvas is reported", () => {
  const findings = lintSpec(
    compiled,
    { canvas: { x: 0, y: 0, width: 199, height: 300 }, elements: { "n:a": { bbox: body } } },
    { code },
  );
  expect(findings).toHaveLength(1);
  expect(findings[0]?.message).toContain("outside the canvas");
});

test("an own text label is protected, an own icon is not", () => {
  const text = label("漢", 200, centeredBaseline(100));
  expect(
    lintSpec(compiled, { elements: { "n:a": { bbox: body, labels: [text] } } }, { code }),
  ).toHaveLength(1);
  const labelOnIcon = label("", 200, centeredBaseline(100));
  expect(
    lintSpec(
      icon,
      {
        elements: {
          "n:a": { bbox: { ...body, x: 196, y: 96, width: 16, height: 16 }, labels: [labelOnIcon] },
        },
      },
      { code },
    ),
  ).toEqual([]);
});

test("two glyphs of one node and a glyph over its own badge are reported", () => {
  expect(lintSpec(twice, { elements: { "n:a": { bbox: body } } }, { code })).toHaveLength(1);
  expect(lintSpec(badged, { elements: { "n:a": { bbox: body } } }, { code })).toHaveLength(1);
});
