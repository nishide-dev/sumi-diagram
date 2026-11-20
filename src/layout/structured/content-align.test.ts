/** `contentAlign` and `matchLabelHeight` on groups (#613). */
import { describe, expect, test } from "bun:test";
import { compileFigure } from "../../compiler/compile";
import { checkFigure } from "../../core/check";
import type { LayoutIR } from "../ir";
import { layoutStructured } from "./engine";

/** Three panels in a stretched row: a short one (a), a tall one (b), a row inside (c). */
function figure(fields: { a?: string; b?: string; c?: string } = {}, extra = "") {
  return `version: 1
figure:
  id: content-align
  profile: paper-double
  layout:
    ${extra}
    arrange:
      row: {gap: 4mm, align: stretch, items: [a, b, c]}
groups:
  - id: a
    label: (a) Short
    ${fields.a ?? ""}
    arrange: {stack: {items: [a1, a2]}}
  - id: b
    label: "(b) A title on\\ntwo lines"
    ${fields.b ?? ""}
    arrange: {stack: {items: [b1, b2, b3, b4, b5]}}
  - id: c
    label: (c) Row
    ${fields.c ?? ""}
    arrange: {row: {items: [c1, c2]}}
nodes:
  - {id: a1, component: box, label: Input}
  - {id: a2, component: box, label: Encoder}
  - {id: b1, component: box, label: One}
  - {id: b2, component: box, label: Two}
  - {id: b3, component: box, label: Three}
  - {id: b4, component: box, label: Four}
  - {id: b5, component: box, label: Five}
  - {id: c1, component: box, label: Left}
  - {id: c2, component: box, label: Right}
edges:
  - {from: a1, to: a2}
  - {from: c1, to: c2}
`;
}

function layout(source: string): LayoutIR {
  const compiled = compileFigure(source);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  return layoutStructured(compiled.value.ir);
}

const node = (l: LayoutIR, id: string) => {
  const found = l.nodes.find((n) => n.key === `n:${id}`);
  if (found === undefined) throw new Error(`no node ${id}`);
  return found.rect;
};
const group = (l: LayoutIR, id: string) => {
  const found = l.groups.find((g) => g.key === `g:${id}`);
  if (found === undefined) throw new Error(`no group ${id}`);
  return found;
};

describe("contentAlign (#613)", () => {
  test("center, written or omitted, is today's layout", () => {
    const base = layout(figure());
    expect(
      layout(
        figure({
          a: "contentAlign: center",
          b: "contentAlign: center",
          c: "contentAlign: center",
        }),
      ),
    ).toEqual(base);
    // Centred: the same room above and below the content of a short panel.
    const a = group(base, "a").content;
    const above = node(base, "a1").y - a.y;
    const below = a.y + a.height - (node(base, "a2").y + node(base, "a2").height);
    expect(above).toBeGreaterThan(20);
    expect(Math.abs(above - below)).toBeLessThan(1);
  });

  test("top puts the content at the top of the content area, bottom at its bottom", () => {
    const base = layout(figure());
    const moved = layout(figure({ a: "contentAlign: top", c: "contentAlign: bottom" }));
    // The frames and the canvas stay; only the content moves.
    expect(moved.canvas).toEqual(base.canvas);
    for (const id of ["a", "b", "c"]) expect(group(moved, id).rect).toEqual(group(base, id).rect);
    expect(group(moved, "a").content).toEqual(group(base, "a").content);
    const a = group(moved, "a").content;
    expect(node(moved, "a1").y).toBeCloseTo(a.y, 2);
    const c = group(moved, "c").content;
    expect(node(moved, "c1").y + node(moved, "c1").height).toBeCloseTo(c.y + c.height, 2);
    // The tallest panel has no room: nothing changes there.
    expect(node(moved, "b1")).toEqual(node(base, "b1"));
  });

  test("no effect on a group at its natural height", () => {
    const plain = figure().replace("align: stretch, ", "");
    const top = figure({ a: "contentAlign: top", c: "contentAlign: bottom" }).replace(
      "align: stretch, ",
      "",
    );
    expect(layout(top)).toEqual(layout(plain));
  });

  test("a row's items stay free across it within their own band, but not the whole area", () => {
    // Straighten (#618) shifts items within their slack: with top, the slack is the row's own.
    const l = layout(figure({ c: "contentAlign: top" }));
    const c = group(l, "c").content;
    for (const id of ["c1", "c2"]) {
      const r = node(l, id);
      expect(r.y).toBeGreaterThanOrEqual(c.y - 0.01);
      expect(r.y - c.y).toBeLessThan(5);
    }
  });

  test("written with the auto engine it is an error", () => {
    const source = `version: 1
figure: {id: auto-content-align, layout: {engine: auto}}
groups:
  - {id: g, contentAlign: top, matchLabelHeight: panels}
nodes:
  - {id: a, component: box, label: A, group: g}
`;
    const codes = checkFigure(source)
      .state.diagnostics.filter((d) => d.severity === "error")
      .map((d) => d.path?.join("."));
    expect(codes).toContain("groups.0.contentAlign");
    expect(codes).toContain("groups.0.matchLabelHeight");
  });

  test("an unknown value is rejected", () => {
    const errors = checkFigure(figure({ a: "contentAlign: start" })).state.diagnostics.filter(
      (d) => d.severity === "error",
    );
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe("matchLabelHeight (#613)", () => {
  const top = "contentAlign: top";
  const matched = `${top}\n    matchLabelHeight: panels`;

  test("panels of one name start their first rows on one line", () => {
    const before = layout(figure({ a: top, b: top, c: top }));
    // A two-line title pushes (b)'s first row lower than (a)'s and (c)'s.
    expect(node(before, "b1").y).toBeGreaterThan(node(before, "a1").y + 5);
    const after = layout(figure({ a: matched, b: matched, c: matched }));
    expect(node(after, "a1").y).toBeCloseTo(node(after, "b1").y, 2);
    expect(node(after, "c1").y).toBeCloseTo(node(after, "b1").y, 2);
    // The tallest title keeps its band: (b) does not move.
    expect(node(after, "b1")).toEqual(node(before, "b1"));
    // The titles stay at the top of their frames.
    for (const id of ["a", "b", "c"])
      expect(group(after, id).label?.box.y).toBeCloseTo(group(before, id).label?.box.y ?? 0, 2);
  });

  test("a group without a label reserves the band too", () => {
    const source = figure({ a: matched, b: matched, c: matched }).replace(
      "    label: (c) Row\n",
      "",
    );
    const l = layout(source);
    expect(group(l, "c").label).toBeUndefined();
    expect(node(l, "c1").y).toBeCloseTo(node(l, "b1").y, 2);
  });

  test("a name only one group writes changes nothing", () => {
    expect(layout(figure({ a: "matchLabelHeight: alone" }))).toEqual(layout(figure()));
  });
});
