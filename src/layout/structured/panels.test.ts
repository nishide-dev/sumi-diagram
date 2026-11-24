/** `row.panels` (#641): side-by-side panels with one height, content at the top and one title band. */
import { describe, expect, test } from "bun:test";
import { compileFigure } from "../../compiler/compile";
import { checkFigure } from "../../core/check";
import type { LayoutIR } from "../ir";
import { layoutStructured } from "./engine";

/** A short panel (a) with a one-line title, a node, and a tall panel (b) with a two-line title. */
function figure(row: string, fields: { a?: string; b?: string } = {}) {
  return `version: 1
figure:
  id: panels
  profile: paper-double
  layout:
    arrange:
      row: {gap: 4mm, ${row} items: [a, mid, b]}
groups:
  - id: a
    label: (a) Short
    ${fields.a ?? ""}
    arrange: {stack: {items: [a1, a2]}}
  - id: b
    label: "(b) A title on\\ntwo lines"
    ${fields.b ?? ""}
    arrange: {stack: {items: [b1, b2, b3, b4, b5]}}
nodes:
  - {id: mid, component: box, label: Mid}
  - {id: a1, component: box, label: Input}
  - {id: a2, component: box, label: Encoder}
  - {id: b1, component: box, label: One}
  - {id: b2, component: box, label: Two}
  - {id: b3, component: box, label: Three}
  - {id: b4, component: box, label: Four}
  - {id: b5, component: box, label: Five}
edges:
  - {from: a1, to: a2}
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
const center = (r: { y: number; height: number }) => r.y + r.height / 2;

describe("row.panels (#641)", () => {
  test("panels share their frame, put their content under the title and match the title band", () => {
    const l = layout(figure("panels: true,"));
    const a = group(l, "a");
    const b = group(l, "b");
    expect(a.rect.y).toBe(b.rect.y);
    expect(a.rect.height).toBe(b.rect.height);
    // One title band (the two-line title's): the first rows start on one line, right under it.
    expect(a.content.y).toBe(b.content.y);
    expect(node(l, "a1").y).toBe(node(l, "b1").y);
    expect(node(l, "a1").y).toBeCloseTo(a.content.y, 6);
    // The node in the row keeps align (centre).
    expect(center(node(l, "mid"))).toBeCloseTo(center(b.rect), 0);
  });

  test("the figure is as tall as with align: center; a written contentAlign wins", () => {
    const panels = layout(figure("panels: true,"));
    const centred = layout(figure("panels: true,", { a: "contentAlign: center" }));
    const plain = layout(figure(""));
    expect(panels.canvas).toEqual(plain.canvas);
    const a = group(centred, "a");
    const above = node(centred, "a1").y - a.content.y;
    const below =
      a.content.y + a.content.height - (node(centred, "a2").y + node(centred, "a2").height);
    expect(above).toBeGreaterThan(20);
    expect(Math.abs(above - below)).toBeLessThanOrEqual(1);
  });

  test("titles above the frame share one band and frames keep their natural tallest height", () => {
    const above = (row: string) =>
      layout(
        figure(row, { a: "labelAt: above-left", b: "labelAt: above-left" }).replace(
          '"(b) A title on\\ntwo lines"',
          "(b) Tall",
        ),
      );
    const panels = above("panels: true,");
    const centred = above("");
    expect(group(panels, "a").rect.y).toBe(group(panels, "b").rect.y);
    expect(group(panels, "a").label?.box.y).toBe(group(panels, "b").label?.box.y);
    expect(group(panels, "b").rect.height).toBe(group(centred, "b").rect.height);
    expect(panels.canvas).toEqual(centred.canvas);
  });

  test("captioned panels take the row's height above their captions", () => {
    const source = figure("panels: true,")
      .replace("    label: (a) Short\n", "    caption: (a) Short\n")
      .replace('    label: "(b) A title on\\ntwo lines"\n', "    caption: (b) Tall\n");
    const l = layout(source);
    expect(group(l, "a").rect.height).toBe(group(l, "b").rect.height);
    expect(node(l, "a1").y).toBe(node(l, "b1").y);
  });

  test("the tallest title and the tallest content in different panels: no shared band, no growth", () => {
    // (a) has a three-line title and short content, (b) a one-line title and the tallest content:
    // sharing (a)'s band would make (b), and the row, taller.
    const source = (row: string) =>
      figure(row)
        .replace("    label: (a) Short\n", '    label: "(a) A title\\non three\\nlines"\n')
        .replace('    label: "(b) A title on\\ntwo lines"\n', "    label: (b) Tall\n");
    const panels = layout(source("panels: true,"));
    const centred = layout(source(""));
    expect(panels.canvas).toEqual(centred.canvas);
    const a = group(panels, "a");
    const b = group(panels, "b");
    expect(a.rect).toMatchObject({ y: b.rect.y, height: b.rect.height });
    expect(a.label?.box.y).toBe(b.label?.box.y);
    // Each keeps its own title band: (b)'s first row is right under its one-line title.
    expect(b.content.y).toBeLessThan(a.content.y);
    expect(node(panels, "b1").y).toBeCloseTo(b.content.y, 6);
    expect(node(panels, "a1").y).toBeCloseTo(a.content.y, 6);
  });

  test("a panel's own matchLabelHeight wins over the row's band", () => {
    const l = layout(
      figure("panels: true,", { a: "matchLabelHeight: mine" })
        .replace(
          "  - id: b\n",
          "  - id: c\n    label: (c) Other\n    matchLabelHeight: mine\n    arrange: {stack: {items: [c1]}}\n  - id: b\n",
        )
        .replace("nodes:\n", "nodes:\n  - {id: c1, component: box, label: C}\n")
        .replace("items: [a, mid, b]", "items: [a, mid, b, c]"),
    );
    // (a) shares (c)'s one-line band, not (b)'s two-line one.
    expect(group(l, "a").content.y).toBeLessThan(group(l, "b").content.y);
  });

  test("panels is a row field only", () => {
    const result = checkFigure(
      figure("panels: true,").replace(
        "row: {gap: 4mm, panels: true,",
        "stack: {gap: 4mm, panels: true,",
      ),
    );
    expect(result.state.diagnostics.some((d) => d.severity === "error")).toBe(true);
  });
});
