import { expect, test } from "bun:test";
import { centeredBaseline, compile, label, lintSpec } from "./testing";

const compiled = compile(`version: 1
figure: { id: badges, layout: { arrange: { row: { items: [outer, b] } } } }
groups:
  - { id: outer, label: Outer, arrange: { row: { items: [inner] } } }
  - { id: inner, label: Inner, group: outer, arrange: { row: { items: [a] } } }
nodes:
  - { id: a, component: box, label: A, sublabel: sub, group: inner, badge: { icon: emoji/fire, corner: north-east } }
  - { id: b, component: box }
edges: [{ id: cross, from: a, to: b }]
`);
const body = { x: 100, y: 100, width: 100, height: 60 };
const title = label("漢", 200, centeredBaseline(100));
const code = "geometry/badge-collision";

test("nested ancestor containment is exempt, but both ancestor titles are checked", () => {
  const elements = {
    "n:a": { bbox: body },
    "g:inner": { bbox: { x: 60, y: 60, width: 200, height: 160 } },
    "g:outer": { bbox: { x: 20, y: 20, width: 300, height: 240 } },
  };
  expect(lintSpec(compiled, { elements }, { code })).toEqual([]);
  for (const key of ["g:inner", "g:outer"] as const) {
    const findings = lintSpec(
      compiled,
      {
        elements: { ...elements, [key]: { ...elements[key], labels: [title] } },
      },
      { code },
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.related).toContainEqual(
      expect.objectContaining({
        path: ["groups", key === "g:outer" ? 0 : 1],
      }),
    );
  }
});

test("badge collisions include own label, sublabel and crossing edges", () => {
  for (const labels of [[title], [label("A", 140, 140), title]]) {
    expect(
      lintSpec(compiled, { elements: { "n:a": { bbox: body, labels } } }, { code }),
    ).toHaveLength(1);
  }
  expect(
    lintSpec(
      compiled,
      {
        elements: {
          "n:a": { bbox: body },
          "e:cross": {
            path: [
              { x: 180, y: 100 },
              { x: 220, y: 100 },
            ],
          },
        },
        painted: {
          "e:cross": [
            [
              { x: 180, y: 100 },
              { x: 220, y: 100 },
            ],
          ],
        },
      },
      { code },
    ),
  ).toHaveLength(1);
});
