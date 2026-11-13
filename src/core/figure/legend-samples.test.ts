/** Legend entries with icon, glyph, edge and set samples, groups and flows (#409). */

import { describe, expect, test } from "bun:test";
import { buildFigureIR } from "../../compiler/ir";
import { lintFigure } from "../../lint/lint";
import { checkFigure } from "../check";
import { nodeKey } from "../check-state";
import { legendPartIds } from "./legend";

const figure = (props: string, extra = "", nodes = "") => `version: 1
figure:
  id: f
  theme: paper
  layout:
    arrange: { stack: { items: [{ row: { items: [a${[...nodes.matchAll(/id: ([\w-]+)/g)].map((m) => `, ${m[1]}`).join("")}] } }, key] } }
nodes:
  - { id: a, component: box, label: A }
${nodes}  - id: key
    component: legend
    props:
${props}
${extra}`;

const entries = (...lines: string[]) =>
  `      entries:\n${lines.map((l) => `        - ${l}`).join("\n")}`;

const codes = (text: string) => checkFigure(text).state.diagnostics.map((d) => d.code);

describe("samples", () => {
  test("an icon entry is a label node that draws the icon", () => {
    const { state } = checkFigure(
      figure(entries("{ icon: tabler/file-text, label: Paper, labelAt: left }")),
    );
    expect(state.diagnostics).toEqual([]);
    expect(state.doc.nodes?.find((n) => n?.id === "key-1-box")).toMatchObject({
      component: "sumi/label",
      icon: "tabler/file-text",
    });
    expect(state.doc.legends?.[0]?.entries[0]).toMatchObject({
      kind: "icon",
      icon: "tabler/file-text",
    });
  });

  test("an unknown icon is reported at the entry's icon", () => {
    const { state } = checkFigure(figure(entries("{ icon: tabler/no-such-icon, label: X }")));
    const diagnostic = state.diagnostics.find((d) => d.code.startsWith("asset/"));
    expect(diagnostic?.path).toEqual(["nodes", 1, "props", "entries", 0, "icon"]);
  });

  test("a glyph entry centers the glyph on a bare box as large as the glyph", () => {
    const { state } = checkFigure(
      figure(
        entries("{ glyph: { kind: vector, cells: 3, tone: blue, strength: solid }, label: v }"),
      ),
    );
    expect(state.diagnostics).toEqual([]);
    const box = state.doc.nodes?.find((n) => n?.id === "key-1-box");
    // Paper text is 8pt: a cell is 0.4 em = 3.2pt, three of them 9.6pt tall; whole D2 units (0.5pt) up.
    expect(box).toMatchObject({
      component: "box",
      props: { width: "3.5pt", height: "10pt" },
      glyphs: [{ kind: "vector", cells: 3, tone: "blue", strength: "solid", at: "center" }],
    });
    expect(state.doc.paints?.get(nodeKey("key-1-box"))).toEqual({ bare: true });
  });

  test("a glyph entry takes the fields of a node glyph, not its position", () => {
    expect(codes(figure(entries("{ glyph: { kind: dot, tone: red }, label: d }")))).toEqual([]);
    expect(codes(figure(entries("{ glyph: { kind: dot, cells: 3 }, label: d }")))).toEqual([
      "component/invalid-prop",
    ]);
    expect(codes(figure(entries("{ glyph: { kind: dot, at: north }, label: d }")))).toEqual([
      "component/unknown-prop",
    ]);
    expect(
      codes(figure(entries("{ glyph: { kind: vector, tone: red, tones: [blue] }, label: d }"))),
    ).toEqual(["component/invalid-prop"]);
  });

  test("a set entry adds a set with no padding around a bare box", () => {
    const { state } = checkFigure(
      figure(entries("{ set: { tone: green, variant: dashed }, label: Hyperedge }")),
    );
    expect(state.diagnostics).toEqual([]);
    expect(state.doc.sets).toEqual([
      {
        id: "key-1-set",
        label: "",
        members: ["key-1-box"],
        shape: "rect",
        padding: 0,
        variant: "dashed",
        tone: "green",
      },
    ]);
  });

  test("a set entry's ID cannot be taken by a set of the figure", () => {
    const text = `${figure(entries("{ set: {}, label: S }"))}sets:\n  - { id: key-1-set, members: [a] }\n`;
    const { state } = checkFigure(text);
    const reserved = state.diagnostics.find((d) => d.code === "ref/reserved-id");
    expect(reserved).toMatchObject({ path: ["sets", 0, "id"], subject: { kind: "set" } });
  });

  test("an entry has exactly one sample", () => {
    for (const both of [
      "{ icon: tabler/flask, glyph: { kind: dot }, label: x }",
      "{ set: {}, edge: {}, label: x }",
      "{ label: x }",
    ]) {
      expect(codes(figure(entries(both)))).toEqual(["component/invalid-prop"]);
    }
  });

  test("an edge entry draws both arrowheads and a tone", () => {
    const { state } = checkFigure(
      figure(entries("{ edge: { component: double-arrow, tone: red }, label: Negative pair }")),
    );
    expect(state.diagnostics).toEqual([]);
    expect(state.doc.edges?.at(-1)).toMatchObject({
      id: "key-1-line",
      component: "double-arrow",
      tone: "red",
    });
  });
});

describe("layout", () => {
  const stackItems = (text: string) => {
    const { state } = checkFigure(text);
    expect(state.diagnostics).toEqual([]);
    const arrange = state.doc.groups?.at(-1)?.arrange;
    if (arrange?.stack === undefined) throw new Error("no stack");
    return arrange.stack.items;
  };
  const rowSize = (item: unknown) => (item as { row: { items: unknown[] } }).row.items.length;
  const labels = ["{ node: {}, label: a }", "{ node: {}, label: b }", "{ node: {}, label: c }"];

  test("flow: row puts the entries on one line", () => {
    const items = stackItems(figure(`      flow: row\n${entries(...labels)}`));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ row: { gap: 12, align: "center" } });
    expect(rowSize(items[0])).toBe(3);
  });

  test("perRow wraps a row into lines", () => {
    const items = stackItems(figure(`      flow: row\n      perRow: 2\n${entries(...labels)}`));
    expect(items.map(rowSize)).toEqual([2, 1]);
  });

  test("perRow without flow: row is an error at perRow", () => {
    const { state } = checkFigure(figure(`      perRow: 2\n${entries(...labels)}`));
    expect(state.diagnostics.map((d) => [d.code, d.path])).toEqual([
      ["component/invalid-prop", ["nodes", 1, "props", "perRow"]],
    ]);
  });

  test("the default flow is a column of one entry per line, as before", () => {
    expect(stackItems(figure(entries(...labels)))).toHaveLength(3);
  });

  test("a heading leads the line of its group in a row, and has its own line in a column", () => {
    const grouped = entries(
      "{ heading: 'Entity:', node: {}, label: a }",
      "{ node: {}, label: b }",
      "{ heading: 'Other:', node: {}, label: c }",
    );
    const rows = stackItems(figure(`      flow: row\n${grouped}`));
    // One table of heading and lines: the headings share a column.
    expect(rows).toHaveLength(1);
    const grid = (rows[0] as { grid: { columns: number; items: unknown[] } }).grid;
    expect(grid.columns).toBe(2);
    expect(grid.items).toHaveLength(4);
    expect(grid.items[0]).toBe("key-1-heading");
    expect(grid.items[2]).toBe("key-3-heading");
    const column = stackItems(figure(grouped));
    // heading, a, b, heading, c
    expect(column).toHaveLength(5);
    expect(column[0]).toBe("key-1-heading");
    expect(column[3]).toBe("key-3-heading");
  });

  test("headings: inline puts the groups on the same lines, each heading before its first entry (#446)", () => {
    const grouped = entries(
      "{ heading: 'Entity:', node: {}, label: a }",
      "{ node: {}, label: b }",
      "{ heading: 'Other:', node: {}, label: c }",
      "{ node: {}, label: d }",
    );
    const one = stackItems(figure(`      flow: row\n      headings: inline\n${grouped}`));
    expect(one).toHaveLength(1);
    expect(JSON.stringify(one)).not.toContain("grid");
    expect(rowSize(one[0])).toBe(4);
    const units = (one[0] as { row: { items: unknown[] } }).row.items;
    expect(units[0]).toMatchObject({ row: { items: ["key-1-heading", expect.anything()] } });
    expect(units[2]).toMatchObject({ row: { items: ["key-3-heading", expect.anything()] } });
    // perRow counts entries across groups, not headings; a break goes between groups.
    const wrapped = stackItems(
      figure(`      flow: row\n      headings: inline\n      perRow: 3\n${grouped}`),
    );
    expect(wrapped.map(rowSize)).toEqual([2, 2]);
    expect(JSON.stringify(wrapped[1])).toContain("key-3-heading");
  });

  test("headings: inline splits a group only when it alone exceeds perRow, hanging after the heading (#446)", () => {
    const text = figure(
      `      flow: row\n      headings: inline\n      perRow: 2\n${entries(
        "{ heading: 'A:', node: {}, label: a }",
        "{ node: {}, label: b }",
        "{ node: {}, label: c }",
        "{ heading: 'B:', node: {}, label: d }",
      )}`,
    );
    const items = stackItems(text);
    expect(items).toHaveLength(2);
    // The long group is a table: its heading, and its two lines beside it.
    const grid = (
      items[0] as { grid: { columns: number; items: [string, { stack: { items: unknown[] } }] } }
    ).grid;
    expect(grid.columns).toBe(2);
    expect(grid.items[0]).toBe("key-1-heading");
    expect(grid.items[1].stack.items.map(rowSize)).toEqual([2, 1]);
    expect(JSON.stringify(items[1])).toContain("key-4-heading");
  });

  test("headings needs flow: row", () => {
    const { state } = checkFigure(figure(`      headings: inline\n${entries(...labels)}`));
    expect(state.diagnostics.map((d) => [d.code, d.path])).toEqual([
      ["component/invalid-prop", ["nodes", 1, "props", "headings"]],
    ]);
  });

  test("a row legend without headings has no table", () => {
    const items = stackItems(figure(`      flow: row\n      perRow: 2\n${entries(...labels)}`));
    expect(JSON.stringify(items)).not.toContain("grid");
  });

  test("labelAt: left puts the text before the sample", () => {
    const items = stackItems(figure(entries("{ node: {}, label: a, labelAt: left }")));
    expect(items[0]).toMatchObject({ row: { items: ["key-1-label", "key-1-box"] } });
  });

  test("the heading is a part of the entry with a reserved ID", () => {
    expect(legendPartIds("key", 2).heading).toBe("key-2-heading");
    const { state } = checkFigure(
      figure(
        entries("{ heading: 'Group:', node: {}, label: a }"),
        "",
        "  - { id: key-1-heading, component: box }\n",
      ),
    );
    expect(state.diagnostics.map((d) => d.code)).toContain("ref/reserved-id");
  });
});

describe("lint/unused-legend-entry", () => {
  const lint = (text: string) =>
    lintFigure(text).diagnostics.filter((d) => d.code === "lint/unused-legend-entry");

  test("an icon entry needs a node that draws the icon or a badge of it", () => {
    const key = entries(
      "{ icon: tabler/file-text, label: Paper }",
      "{ icon: tabler/flask, label: Compound }",
      "{ icon: emoji/fire, label: Hot }",
    );
    const nodes =
      "  - { id: p, component: label, icon: tabler/file-text }\n  - { id: h, component: box, label: H, badge: { icon: emoji/fire, corner: north-east } }\n";
    const found = lint(figure(key, "", nodes));
    expect(found.map((d) => d.path)).toEqual([["nodes", 3, "props", "entries", 1]]);
    expect(found[0]?.message).toContain("tabler/flask");
  });

  test("a glyph entry needs a node glyph of its kind, strength and tone", () => {
    const key = entries(
      "{ glyph: { kind: vector, tone: blue, strength: solid }, label: A }",
      "{ glyph: { kind: vector, tone: blue }, label: B }",
      "{ glyph: { kind: dot, tone: red }, label: C }",
    );
    const nodes =
      "  - { id: v, component: label, icon: tabler/flask, glyphs: [{ kind: vector, tones: [blue, blue], strength: solid }, { kind: dot, tone: red }] }\n";
    const found = lint(figure(key, "", nodes));
    expect(found.map((d) => d.path)).toEqual([["nodes", 2, "props", "entries", 1]]);
  });

  test("a set entry needs a set of its variant and tone; its own swatch does not count", () => {
    const key = entries("{ set: { tone: green }, label: A }", "{ set: { tone: red }, label: B }");
    expect(lint(figure(key))).toHaveLength(2);
    const found = lint(`${figure(key)}sets:\n  - { id: s, members: [a], tone: green }\n`);
    expect(found.map((d) => d.path)).toEqual([["nodes", 1, "props", "entries", 1]]);
  });
});

describe("IR", () => {
  test("a set entry becomes a set of the IR enclosing its sample box exactly", () => {
    const check = checkFigure(figure(entries("{ set: { tone: green }, label: S }")));
    const ir = buildFigureIR(check);
    expect(ir.sets?.map((s) => [s.id, s.shape, s.variant, s.paddingPt])).toEqual([
      ["key-1-set", "rect", "default", 0],
    ]);
  });
});

describe("node sample cornerRadius (#518)", () => {
  test("cornerRadius reaches the sample box, so it matches rounded nodes", () => {
    const { state } = checkFigure(
      figure(
        entries("{ node: { cornerRadius: 3pt }, label: Rounded }", "{ node: {}, label: Plain }"),
      ),
    );
    expect(state.diagnostics).toEqual([]);
    const boxes = (state.doc.nodes ?? []).filter((n) => n?.id.endsWith("-box"));
    expect(boxes.map((n) => n?.cornerRadius)).toEqual([3, undefined]);
  });

  test("a radius that is not a multiple of 0.5pt is rejected", () => {
    expect(codes(figure(entries("{ node: { cornerRadius: 3.3pt }, label: R }")))).not.toEqual([]);
  });
});
