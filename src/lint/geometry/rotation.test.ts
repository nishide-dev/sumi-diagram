/**
 * Geometry rules on turned labels (#178): each rule sees the label's box as
 * drawn (turned by ±90°), not its upright box. Every case pairs a turned
 * label with the same label upright, which the rule judges the other way.
 */

import { describe, expect, test } from "bun:test";
import type { LabelGeometry } from "../../render/inspect";
import { centeredBaseline, compile, label, lintSpec } from "./testing";

const SOURCE = `version: 1
figure: { id: geo }
nodes:
  - { id: a, component: box, label: A }
  - { id: b, component: box, label: B }
  - { id: t, component: label, label: T }
edges:
  - { from: a, to: b, label: x }
`;
const compiled = compile(SOURCE);

/** "漢漢漢漢" (64 × 16 units upright) centered on (cx, cy), turned by `degrees` or upright. */
function text(cx: number, cy: number, degrees?: 90 | -90): LabelGeometry {
  const upright = label("漢漢漢漢", cx, centeredBaseline(cy));
  return degrees === undefined
    ? upright
    : { ...upright, rotation: { degrees, center: { x: cx, y: cy } } };
}

const codes = (diagnostics: { code: string }[]) => diagnostics.map((d) => d.code);

describe("turned labels in the geometry rules (#178)", () => {
  test("label-overflow: a turned label fits a tall, narrow box its upright self overflows", () => {
    const code = "geometry/label-overflow";
    const bbox = { x: 80, y: 20, width: 30, height: 100 };
    const run = (degrees?: 90 | -90) =>
      codes(
        lintSpec(
          compiled,
          { elements: { "n:b": { bbox, labels: [text(95, 70, degrees)] } } },
          { code },
        ),
      );
    expect(run()).toEqual([code]);
    expect(run(90)).toEqual([]);
    expect(run(-90)).toEqual([]);
    // And the other way round: a wide, low box.
    const wide = { x: 60, y: 50, width: 100, height: 30 };
    const flat = (degrees?: 90 | -90) =>
      codes(
        lintSpec(
          compiled,
          { elements: { "n:b": { bbox: wide, labels: [text(110, 65, degrees)] } } },
          { code },
        ),
      );
    expect(flat()).toEqual([]);
    expect(flat(-90)).toEqual([code]);
  });

  test("edge-crosses-label: an edge through the turned box, beside the upright one", () => {
    const code = "geometry/edge-crosses-label";
    // Turned: x 192–208, y 68–132. Upright: x 168–232, y 92–108.
    const path = [
      { x: 150, y: 75 },
      { x: 250, y: 75 },
    ];
    const run = (degrees?: 90 | -90) =>
      lintSpec(
        compiled,
        { elements: { "n:t": { labels: [text(200, 100, degrees)] }, "e:#0": { path } } },
        { code },
      ).map((d) => d.message);
    expect(run()).toEqual([]);
    expect(run(-90)).toEqual(['Edge edges[0] crosses the label of node "t".']);
  });

  test("edge-touches-label: an edge just past the end of the turned letters", () => {
    const code = "geometry/edge-touches-label";
    const path = [
      { x: 150, y: 133.5 },
      { x: 250, y: 133.5 },
    ];
    const run = (degrees?: 90 | -90) =>
      codes(
        lintSpec(
          compiled,
          { elements: { "n:t": { labels: [text(200, 100, degrees)] }, "e:#0": { path } } },
          { code },
        ),
      );
    expect(run()).toEqual([]);
    expect(run(90)).toEqual([code]);
    expect(run(-90)).toEqual([code]);
  });

  test("label-collision: a turned edge label reaching into a node its upright self misses", () => {
    const code = "geometry/label-collision";
    const bbox = { x: 300, y: 20, width: 50, height: 30 };
    const run = (degrees?: 90 | -90) =>
      lintSpec(
        compiled,
        { elements: { "n:b": { bbox }, "e:#0": { labels: [text(320, 75, degrees)] } } },
        { code },
      ).map((d) => d.message);
    expect(run()).toEqual([]);
    expect(run(90)).toEqual(['The label of edge edges[0] overlaps the shape of node "b".']);
  });
});
