/**
 * Floating legends (#643, design record 643): `props.float` places a legend
 * at a corner or side of its container's content area without adding to the
 * container's size; lifelines of a sequence stop above it; anything it covers
 * is `geometry/float-overlap`. Structured layout only, so no D2 is needed.
 */

import { describe, expect, test } from "bun:test";
import { checkFigure } from "../core/check";
import { layoutStructuredFigure } from "../layout";
import type { Rect } from "../layout/ir";
import { lintRenderedFigure } from "../lint/geometry/lint";

const LEGEND = (props: string, extra = "") => `  - id: key
    component: legend
${extra}    props:
${props}      entries:
        - {edge: {tone: orange}, label: signed}
        - {edge: {tone: green, variant: dashed}, label: receipt}
`;

/** A wide row on top and a short box at its left below: the bottom right is free. */
const ROW = (legend: string, items = "[a, b, c]") => `version: 1
figure:
  id: float
  theme: sumi
  profile: paper-double
  layout:
    arrange:
      stack:
        align: start
        items:
          - row: {gap: 12mm, items: [p, q, r, s]}
          - stack: {items: ${items}}
nodes:
  - {id: p, component: box, label: First stage}
  - {id: q, component: box, label: Second stage}
  - {id: r, component: box, label: Third stage}
  - {id: s, component: box, label: Fourth stage}
  - {id: a, component: box, label: Store}
  - {id: b, component: box, label: Cache}
  - {id: c, component: box, label: Log}
${legend}edges:
  - {from: p, to: q, tone: orange}
  - {from: q, to: r, tone: green, variant: dashed}
  - {from: r, to: s}
`;

function layout(text: string) {
  const result = layoutStructuredFigure(text);
  if (!result.ok)
    throw new Error(result.diagnostics.map((d) => `${d.code} ${d.message}`).join("\n"));
  const { layout } = result.value;
  const rect = (key: string): Rect => {
    const found = [...layout.nodes, ...layout.groups].find((n) => n.key === key);
    if (!found) throw new Error(`missing ${key}`);
    return found.rect;
  };
  return { layout, rect, diagnostics: result.diagnostics };
}

const right = (r: Rect) => r.x + r.width;
const bottom = (r: Rect) => r.y + r.height;
const codes = (text: string) => checkFigure(text).state.diagnostics.map((d) => d.code);

describe("floating legends (#643)", () => {
  test("a floating legend adds nothing to the figure's size", () => {
    const without = layout(ROW(""));
    const floated = layout(ROW(LEGEND("      float: bottom-right\n")));
    expect(floated.layout.canvas).toEqual(without.layout.canvas);
    // Listed in the arrange tree instead, the same legend makes the figure taller.
    const listed = layout(ROW(LEGEND(""), "[a, b, c, key]"));
    expect(listed.layout.canvas.height).toBeGreaterThan(without.layout.canvas.height);
  });

  test("it sits flush in its corner, or inset by {at, inset}", () => {
    const flush = layout(ROW(LEGEND("      float: bottom-right\n")));
    const key = flush.rect("g:key");
    const content = flush.layout.content as Rect;
    expect(right(key)).toBeCloseTo(right(content), 3);
    expect(bottom(key)).toBeCloseTo(bottom(content), 3);
    const inset = layout(ROW(LEGEND("      float: {at: bottom-right, inset: 2mm}\n")));
    const moved = inset.rect("g:key");
    const units = (2 * 72) / 25.4 / 0.5;
    expect(right(key) - right(moved)).toBeCloseTo(units, 1);
    expect(bottom(key) - bottom(moved)).toBeCloseTo(units, 1);
    const top = layout(ROW(LEGEND("      float: top-left\n"))).rect("g:key");
    expect(top.x).toBeCloseTo(content.x, 3);
    expect(top.y).toBeCloseTo(content.y, 3);
  });

  test("with group:, it floats in that group's content area", () => {
    const text = `version: 1
figure:
  id: panel
  theme: sumi
  layout: {arrange: {row: {items: [panel]}}}
groups:
  - id: panel
    label: Panel
    arrange: {stack: {align: start, items: [{row: {items: [p, q, r]}}, a]}}
nodes:
  - {id: p, component: box, label: First stage}
  - {id: q, component: box, label: Second stage}
  - {id: r, component: box, label: Third stage}
  - {id: a, component: box, label: A}
${LEGEND("      float: bottom-right\n", "    group: panel\n")}edges:
  - {from: p, to: q, tone: orange}
  - {from: q, to: r, tone: green, variant: dashed}
`;
    const floated = layout(text);
    const panel = floated.layout.groups.find((g) => g.key === "g:panel");
    const key = floated.rect("g:key");
    expect(panel).toBeDefined();
    const content = panel?.content as Rect;
    expect(right(key)).toBeCloseTo(right(content), 3);
    expect(bottom(key)).toBeCloseTo(bottom(content), 3);
    const without = layout(text.replace(/ {2}- id: key[\s\S]*?(?=edges:)/, ""));
    expect(floated.rect("g:panel")).toEqual(without.rect("g:panel"));
  });

  test("placing it twice, or floating a node that is not a legend, is an error", () => {
    expect(codes(ROW(LEGEND("      float: bottom-right\n"), "[a, b, c, key]"))).toContain(
      "layout/duplicate-placement",
    );
    const box = ROW("  - {id: k, component: box, label: K, props: {float: bottom-right}}\n");
    const found = codes(box);
    expect(found).toContain("component/unknown-prop");
    expect(found).not.toContain("layout/unplaced");
    expect(codes(ROW(LEGEND("      float: middle\n")))).toContain("component/invalid-prop");
  });

  test("a legend larger than the content it floats over is layout/float-too-large", () => {
    const text = `version: 1
figure:
  id: small
  theme: sumi
  layout: {arrange: {row: {items: [a]}}}
nodes:
  - {id: a, component: box, label: A}
${LEGEND("      float: top-left\n")}`;
    const { diagnostics } = layout(text);
    expect(diagnostics.map((d) => d.code)).toContain("layout/float-too-large");
  });

  test("covering content is geometry/float-overlap; free space is not", async () => {
    const free = await lintRenderedFigure(ROW(LEGEND("      float: bottom-right\n")));
    expect(free.diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
    const covering = await lintRenderedFigure(ROW(LEGEND("      float: top-left\n")));
    const found = covering.diagnostics.filter((d) => d.code === "geometry/float-overlap");
    expect(found).toHaveLength(1);
    expect(found[0]?.severity).toBe("warning");
    expect(found[0]?.message).toContain('node "p"');
    expect(found[0]?.path).toEqual(["nodes", 7, "props", "float"]);
  });
});

describe("floating legends in a sequence (#643)", () => {
  const sequence = (float: string) => `version: 1
figure:
  id: seq
  theme: sumi
  layout:
    arrange:
      sequence:
        participants: [a, b, c, d]
        rows:
          - {fragment: "Pay", rows: [ab, bc, cd, dd, dc, cd2, dc2]}
nodes:
  - {id: a, component: box, label: Alice}
  - {id: b, component: box, label: Bob}
  - {id: c, component: box, label: Carol}
  - {id: d, component: box, label: Dave}
${LEGEND(`      float: ${float}\n`)}edges:
  - {id: ab, from: a, to: b, label: ask}
  - {id: bc, from: b, to: c, tone: orange, label: signed request}
  - {id: cd, from: c, to: d, tone: orange, label: signed request}
  - {id: dd, from: d, to: d, label: check}
  - {id: dc, from: d, to: c, tone: green, variant: dashed, label: receipt}
  - {id: cd2, from: c, to: d, label: confirm}
  - {id: dc2, from: d, to: c, tone: green, variant: dashed, label: receipt}
`;
  const lifelineBottom = (layout: ReturnType<typeof layoutStructuredFigure>, i: number) => {
    if (!layout.ok) throw new Error("not laid out");
    const end = layout.value.layout.nodes.find((n) => n.key === `n:seq-1-end-${i}`);
    if (end === undefined) throw new Error(`missing end ${i}`);
    return end.rect.y + end.rect.height / 2;
  };

  test("the lifelines under the legend stop above it; the others run to the bottom", () => {
    const text = sequence("{at: bottom-left, inset: 2mm}");
    const floated = layoutStructuredFigure(text);
    const plain = layoutStructuredFigure(text.replace(/ {2}- id: key[\s\S]*?(?=edges:)/, ""));
    if (!floated.ok || !plain.ok) throw new Error("not laid out");
    expect(floated.value.layout.canvas).toEqual(plain.value.layout.canvas);
    const legend = floated.value.layout.groups.find((g) => g.key === "g:key")?.rect as Rect;
    // Alice's lifeline (no message after the first row) ends above the legend.
    expect(lifelineBottom(floated, 1)).toBeLessThan(legend.y);
    expect(lifelineBottom(plain, 1)).toBeGreaterThan(legend.y);
    // Dave's lifeline is clear of the legend: it is not cut.
    expect(lifelineBottom(floated, 4)).toBe(lifelineBottom(plain, 4));
  });

  test("inside a fragment frame it lints clean; over lifeline rows it overlaps", async () => {
    const clean = await lintRenderedFigure(sequence("{at: bottom-left, inset: 2mm}"));
    expect(clean.diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
    const crossing = await lintRenderedFigure(sequence("{at: bottom-right, inset: 2mm}"));
    expect(crossing.diagnostics.map((d) => d.code)).toContain("geometry/float-overlap");
  });
});
