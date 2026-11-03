import { expect, test } from "bun:test";
import { parse, stringify } from "yaml";
import { layoutStructuredFigure } from "../index";

// biome-ignore lint/suspicious/noExplicitAny: test documents are free-form YAML trees
type Doc = Record<string, any>;
const mk = (arrange: unknown, align: unknown, ids: string[]): Doc => ({
  version: 1,
  figure: { id: "f", layout: { arrange, align } },
  nodes: ids.map((id) => ({ id, component: "box", label: id })),
});
const unsatisfied = (doc: Doc) =>
  layoutStructuredFigure(stringify(doc)).diagnostics.find(
    (d) => d.code === "layout/unsatisfied-align",
  );

test("#306 review: cells of the same grid get neutral same-grid advice, never wrappers (12 y combos + repros)", () => {
  const cells = ["g0", "g1", "g2"];
  for (const parent of ["start", "end", "center", "stretch"]) {
    for (const pos of [0, 1, 2]) {
      const doc = mk(
        {
          row: {
            align: parent,
            items: [{ grid: { columns: 1, items: cells } }, { stack: { items: ["s0", "s2"] } }],
          },
        },
        [{ y: [cells[pos], cells[(pos + 1) % 3]] }],
        [...cells, "s0", "s2"],
      );
      const hint = unsatisfied(doc)?.hint ?? "";
      expect(hint).toContain("tracks of the same grid");
      expect(hint).toContain("same row of the grid");
      expect(hint).not.toContain("different rows");
      expect(hint).not.toContain("Wrap the cell");
      expect(hint).not.toContain("Verified by");
      expect(hint).not.toContain("other branch");
    }
  }
  for (const wrapped of [false, true]) {
    const wrap = (id: string) => (wrapped ? { stack: { items: [id] } } : id);
    const doc = mk(
      {
        row: {
          align: "start",
          items: [
            { grid: { columns: 1, items: [wrap("g0"), "g1", wrap("s1")] } },
            { stack: { items: ["s0", "s2"] } },
          ],
        },
      },
      [{ y: ["g0", "s1"] }],
      ["g0", "g1", "s1", "s0", "s2"],
    );
    const hint = unsatisfied(doc)?.hint ?? "";
    expect(hint).not.toContain("Wrap the cell");
    expect(hint).not.toContain("other branch");
    if (!wrapped) expect(hint).toContain("tracks of the same grid");
  }
});

test("#306 review: wrapper advice is verified for cells in any grid row, x and y, and is deterministic", () => {
  let verified = 0;
  for (const parent of ["start", "end", "center"]) {
    for (const cell of ["a", "b", "c", "d"]) {
      const doc = mk(
        {
          stack: {
            align: parent,
            items: [
              { grid: { columns: 2, items: ["a", "b", "c", "d"] } },
              { row: { items: ["r0", "r1", "r2"] } },
            ],
          },
        },
        [{ x: [cell, "r2"] }],
        ["a", "b", "c", "d", "r0", "r1", "r2"],
      );
      const d = unsatisfied(doc);
      if (!d) continue;
      expect(unsatisfied(doc)?.hint).toBe(d.hint);
      if (d.hint?.includes("Verified by")) {
        verified++;
        expect(d.hint).toContain("Re-run lint");
        const grid = doc.figure.layout.arrange.stack.items[0].grid;
        grid.items = grid.items.map((i: string) => (i === cell ? { row: { items: [i] } } : i));
        expect(unsatisfied(parse(stringify(doc)))).toBeUndefined();
      } else expect(d.hint).toContain("No verified wrapper edit");
    }
  }
  expect(verified).toBeGreaterThan(0);
});

test("#306 review: a y-axis cell versus a stack item is verified by wrapping the cell", () => {
  const doc = mk(
    {
      row: {
        align: "start",
        items: [
          { grid: { columns: 1, items: ["g0", "g1"] } },
          { stack: { items: ["s0", "s1", "s2"] } },
        ],
      },
    },
    [{ y: ["g1", "s2"] }],
    ["g0", "g1", "s0", "s1", "s2"],
  );
  const d = unsatisfied(doc);
  expect(d?.hint).toContain('Verified by structured layout: wrap "g1" in a stack');
  doc.figure.layout.arrange.row.items[0].grid.items[1] = { stack: { items: ["g1"] } };
  expect(unsatisfied(doc)).toBeUndefined();
});
