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
import { layoutModel, type Rect as ProtoRect, STYLE } from "./layout";
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

/**
 * The proposed figures themselves (figures/ideal/), now that operator,
 * junction and tone exist (#92), with only what later issues own taken out:
 * `requires` (the release), `icon` (#94; a "~" label instead, a 34-unit
 * circle in both) and `caption` (stage B).
 */
const ideal = (name: string) =>
  readFileSync(join(import.meta.dir, "..", "figures", "ideal", name), "utf8")
    .replace(/^requires: .*\n/m, "")
    .replace(/icon: [a-z/-]+/g, 'label: "~"')
    .replace(/^ *caption: .*\n/m, "");

describe.each([
  ["fixture a-transformer", fixture("a-transformer.sumi.yaml")],
  ["fixture b-adaln-panel", fixture("b-adaln-panel.sumi.yaml")],
  ["ideal a-transformer", ideal("a-transformer.sumi.yaml")],
  ["ideal b-adaln-panel", ideal("b-adaln-panel.sumi.yaml")],
])("%s", (_name, text) => {
  const result = layoutStructuredFigure(text);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const { ir, layout } = result.value;
  // The marks' sizes differ by design: #92 made the operator 2 em (32 units,
  // the prototype 18) and the junction 3 stroke widths (3 units in academic,
  // the prototype 0). The prototype gets the product's sizes, so the
  // comparison checks the placement, not that choice.
  const markSize = (name: string) =>
    ir.nodes.find((n) => n.component === `sumi/${name}`)?.width?.units;
  const saved = { ...STYLE };
  STYLE.operatorSize = markSize("operator") ?? STYLE.operatorSize;
  STYLE.junctionSize = markSize("junction") ?? STYLE.junctionSize;
  const proto = layoutModel(parseModel(text));
  Object.assign(STYLE, saved);
  const marked = new Set(ir.nodes.filter((n) => n.mark !== undefined).map((n) => n.key));

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
      // The prototype does not measure a mark's glyph (it draws none).
      if (marked.has(node.key)) continue;
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
