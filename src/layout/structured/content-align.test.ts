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

  test("straighten (#618) moves an item within its own box, never into the band", () => {
    // b5 → x is crooked while x sits in the middle of (a): straighten moves x down to b5's line.
    const source = (field: string) => `version: 1
figure:
  id: content-align-straighten
  profile: paper-double
  layout:
    arrange:
      row: {gap: 8mm, align: stretch, items: [b, a]}
groups:
  - id: a
    label: (a) One
    ${field}
    arrange: {row: {items: [x]}}
  - id: b
    label: (b) Tall
    arrange: {stack: {items: [b1, b2, b3, b4, b5]}}
nodes:
  - {id: x, component: box, label: X}
  - {id: b1, component: box, label: One}
  - {id: b2, component: box, label: Two}
  - {id: b3, component: box, label: Three}
  - {id: b4, component: box, label: Four}
  - {id: b5, component: box, label: Five}
edges:
  - {from: b5, to: x}
`;
    const centred = layout(source(""));
    const centre = (r: { y: number; height: number }) => r.y + r.height / 2;
    // Centred, the band is straighten's slack: x lines up with b5.
    expect(centre(node(centred, "x"))).toBeCloseTo(centre(node(centred, "b5")), 1);
    for (const [field, edge] of [
      ["contentAlign: top", "top"],
      ["contentAlign: bottom", "bottom"],
    ] as const) {
      const l = layout(source(field));
      const c = group(l, "a").content;
      const x = node(l, "x");
      const natural = x.height;
      if (edge === "top") expect(x.y).toBeCloseTo(c.y, 2);
      else expect(x.y + natural).toBeCloseTo(c.y + c.height, 2);
    }
  });

  test("a root box that fills the height keeps it: contentAlign has no band to move", () => {
    const fill = (field: string, box: string) => `version: 1
figure:
  id: content-align-fill
  profile: paper-double
  layout:
    arrange:
      row: {gap: 4mm, align: stretch, items: [a, b]}
groups:
  - id: a
    label: (a) Filled
    ${field}
    arrange: ${box}
  - id: b
    label: (b) Tall
    arrange: {stack: {items: [b1, b2, b3, b4, b5]}}
nodes:
  - {id: a1, component: box, label: Input}
  - {id: a2, component: box, label: Encoder}
  - {id: b1, component: box, label: One}
  - {id: b2, component: box, label: Two}
  - {id: b3, component: box, label: Three}
  - {id: b4, component: box, label: Four}
  - {id: b5, component: box, label: Five}
`;
    for (const box of [
      "{stack: {justify: stretch, items: [a1, a2]}}",
      "{stack: {justify: space-between, items: [a1, a2]}}",
      "{row: {align: stretch, items: [a1, a2]}}",
    ]) {
      const plain = layout(fill("", box));
      // The root box uses the spare height (items grow, or spread to both edges)...
      const a2 = node(plain, "a2");
      const content = group(plain, "a").content;
      expect(Math.abs(a2.y + a2.height - (content.y + content.height))).toBeLessThan(1);
      // ...and contentAlign leaves it so.
      for (const align of ["top", "bottom"])
        expect(layout(fill(`contentAlign: ${align}`, box))).toEqual(plain);
    }
  });

  test("a root box that cannot fill the height does not keep it: contentAlign applies", () => {
    const panel = (field: string, box: string, nodes: string) => `version: 1
figure:
  id: content-align-nofill
  profile: paper-double
  layout:
    arrange:
      row: {gap: 4mm, align: stretch, items: [a, b]}
groups:
  - id: a
    label: (a) Short
    ${field}
    arrange: ${box}
  - id: b
    label: (b) Tall
    arrange: {stack: {items: [b1, b2, b3, b4, b5]}}
nodes:
${nodes}
  - {id: b1, component: box, label: One}
  - {id: b2, component: box, label: Two}
  - {id: b3, component: box, label: Three}
  - {id: b4, component: box, label: Four}
  - {id: b5, component: box, label: Five}
`;
    const box = "  - {id: a1, component: box, label: Input}";
    const circles =
      "  - {id: a1, component: circle, label: x}\n  - {id: a2, component: circle, label: y}";
    for (const [root, nodes] of [
      // One item: space-between has nothing to spread it between, it stays centred.
      ["{stack: {justify: space-between, items: [a1]}}", box],
      // No item can grow (circles keep their size).
      ["{stack: {justify: stretch, items: [a1, a2]}}", circles],
      // No item can stretch across the row.
      ["{row: {align: stretch, items: [a1, a2]}}", circles],
    ] as const) {
      const centred = layout(panel("", root, nodes));
      const c = group(centred, "a").content;
      const a1 = node(centred, "a1");
      // Centred today: a band above.
      expect(a1.y - c.y).toBeGreaterThan(20);
      const top = layout(panel("contentAlign: top", root, nodes));
      const t = group(top, "a").content;
      const ys = ["a1", ...(nodes === circles ? ["a2"] : [])].map((id) => node(top, id).y);
      expect(Math.min(...ys)).toBeCloseTo(t.y, 2);
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
