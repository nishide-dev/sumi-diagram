/**
 * An unanchored end on a wide node drops straight onto a narrower node
 * (#512): a wide box fanning out to narrower boxes below keeps one straight
 * segment per edge instead of one trunk with jogs.
 */

import { describe, expect, test } from "bun:test";
import type { RenderedStructuredFigure } from "../../render/render";
import { renderFigure } from "../../render/render";
import type { Point } from "../ir";

const yaml = (extra: string) => `
version: 1
figure:
  id: auto-straight
  layout:
    arrange:
      stack:
        gap: 12mm
        items:
          - wide
          - row: { gap: 6mm, items: [ a, b ] }
nodes:
  - { id: wide, component: box, label: Wide, props: { width: 200pt } }
  - { id: a, component: box, label: A, props: { width: 40pt } }
  - { id: b, component: box, label: B, props: { width: 40pt } }
edges:
  - { from: wide, to: a${extra} }
  - { from: wide, to: b${extra} }
`;

async function routes(text: string) {
  const result = await renderFigure(text, {});
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  const { layout, compiled } = result.value as RenderedStructuredFigure;
  return compiled.ir.edges.map((e) => {
    const points = layout.edges.find((l) => l.key === e.key)?.route?.points as Point[];
    return points;
  });
}

describe("auto straight ends (#512)", () => {
  test("fan-out from a wide box drops straight onto each narrower box", async () => {
    for (const points of await routes(yaml(""))) {
      expect(points.length).toBe(2);
      const [p, q] = points as [Point, Point];
      expect(p.x).toBe(q.x);
    }
  });

  test("an explicit anchor keeps the written route", async () => {
    const [a] = await routes(yaml(", fromAnchor: south"));
    expect((a as Point[]).length).toBeGreaterThanOrEqual(2);
  });
});
