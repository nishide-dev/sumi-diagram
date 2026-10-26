/**
 * #89 acceptance: the product's structured layout engine (src/layout) places
 * the same rectangles as this prototype (within 0.01 unit) for the figures
 * both can read. The research code depends on the product, never the other
 * way around, so the comparison lives here.
 *
 * The figures are the #88 / #89 adaptations in tests/fixtures/figures/layout/
 * (operator / junction / icon replaced by labeled circles, no tone or
 * caption): the prototype reads them as they are, and a circle is 34 units
 * in both (the prototype's fixed icon circle; the engine's circle around a
 * one-glyph label, design doc §6.21).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Rect } from "../../../src/core/geometry";
import { layoutStructuredFigure } from "../../../src/layout";
import { layoutModel, type Rect as ProtoRect } from "./layout";
import { parseModel } from "./model";

const TOLERANCE = 0.01;

const fixture = (name: string) =>
  readFileSync(
    join(import.meta.dir, "..", "..", "..", "tests", "fixtures", "figures", "layout", name),
    "utf8",
  );

/** Largest difference of position or size. */
function delta(proto: ProtoRect, rect: Rect): number {
  return Math.max(
    Math.abs(proto.x - rect.x),
    Math.abs(proto.y - rect.y),
    Math.abs(proto.w - rect.width),
    Math.abs(proto.h - rect.height),
  );
}

describe.each(["a-transformer.sumi.yaml", "b-adaln-panel.sumi.yaml"])("%s", (name) => {
  const text = fixture(name);
  const proto = layoutModel(parseModel(text));
  const result = layoutStructuredFigure(text);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const { layout } = result.value;

  test("every node and group rectangle matches the prototype within 0.01 unit", () => {
    const elements = [
      ...layout.nodes.map((n) => [n.key, n.rect, proto.nodes.get(n.key.slice(2))] as const),
      ...layout.groups.map((g) => [g.key, g.rect, proto.groups.get(g.key.slice(2))] as const),
    ];
    expect(elements.length).toBe(proto.nodes.size + proto.groups.size);
    for (const [key, rect, protoRect] of elements) {
      if (protoRect === undefined) throw new Error(`${key} is missing in the prototype`);
      expect({ key, delta: delta(protoRect, rect) <= TOLERANCE }).toEqual({ key, delta: true });
    }
  });

  test("the canvas has the prototype's size", () => {
    expect(layout.canvas).toEqual({ width: proto.width, height: proto.height });
  });

  test("labels have the prototype's measured size", () => {
    for (const node of layout.nodes) {
      const measured = proto.labels.get(node.key.slice(2));
      if (measured === undefined || measured.lines.length === 0) {
        expect(node.label).toBeUndefined();
        continue;
      }
      expect(Math.abs((node.label?.width ?? -1) - measured.width)).toBeLessThan(1e-9);
      expect(node.label?.height).toBe(measured.height);
    }
  });
});
