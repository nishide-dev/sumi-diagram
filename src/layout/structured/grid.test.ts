import { expect, test } from "bun:test";
import { stringify } from "yaml";
import { compileFigure } from "../../compiler/compile";
import { checkFigure } from "../../core/check";
import { formatFigureSource } from "../../core/figure/format";
import { layoutStructuredFigure } from "../index";
import type { Rect } from "../ir";

function source(grid: object, extra: object = {}) {
  return stringify({
    version: 1,
    figure: { id: "grid", ...extra, layout: { arrange: { grid } } },
    nodes: [
      { id: "a", component: "box", label: "A", props: { width: "20pt", height: "20pt" } },
      { id: "b", component: "box", label: "B", props: { width: "40pt", height: "30pt" } },
      { id: "c", component: "box", label: "C", props: { width: "30pt", height: "20pt" } },
      { id: "d", component: "box", label: "D", props: { width: "10pt", height: "10pt" } },
    ],
  });
}

function layout(text: string) {
  const result = layoutStructuredFigure(text);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.value.layout;
}

test("grid aligns column starts and row centers with unequal cell sizes", () => {
  const text = source({
    columns: 2,
    rowGap: "5pt",
    columnGap: "3pt",
    align: "start",
    items: ["a", "b", "c", "d"],
  });
  const placed = layout(text);
  const [a, b, c, d] = placed.nodes.map((n) => n.rect) as [Rect, Rect, Rect, Rect];
  expect(a.x).toBe(c.x);
  expect(b.x).toBe(d.x);
  expect(b.x - a.x).toBe(66);
  expect(a.y + a.height / 2).toBe(b.y + b.height / 2);
  expect(c.y + c.height / 2).toBe(d.y + d.height / 2);
  expect(c.y - b.y - b.height).toBe(10);
  expect(layout(text)).toEqual(placed);
});

test("span sizing, nested boxes, and compact default gaps", () => {
  const text = source({
    columns: 2,
    align: "start",
    items: ["a", "d", { item: { row: { gap: 0, items: ["b", "c"] } }, span: 2 }],
  });
  const normal = layout(text);
  const compact = layout(text.replace("arrange:", "density: compact\n    arrange:"));
  expect(compact.canvas.width).toBeLessThanOrEqual(normal.canvas.width);
  expect(compact.canvas.height).toBeLessThan(normal.canvas.height);
  const compiled = compileFigure(text);
  expect(compiled.ok).toBe(true);
  if (compiled.ok)
    expect(compiled.value.ir.arrange).toMatchObject({ kind: "grid", columns: 2, spans: [1, 1, 2] });
});

test("grid diagnostics locate overflow and incomplete final rows", () => {
  const text = source({ columns: 3, items: ["a", { item: "b", span: 4 }, "c", "d"] });
  const diagnostics = checkFigure(text, { file: "grid.sumi.yaml" }).state.diagnostics;
  for (const [code, path] of [
    ["layout/grid-span-overflow", ["figure", "layout", "arrange", "grid", "items", 1, "span"]],
    ["layout/grid-item-count", ["figure", "layout", "arrange", "grid", "items"]],
  ] as const) {
    const d = diagnostics.find((d) => d.code === code);
    expect(d?.path).toEqual([...path]);
    expect(d?.location?.file).toBe("grid.sumi.yaml");
    expect(d?.location?.line).toBeGreaterThan(0);
    expect(d?.location?.column).toBeGreaterThan(0);
  }
});

test("grid rejects empty cells, zero columns/spans and direction with schema locations", () => {
  for (const grid of [
    { columns: 2, items: ["a", null, "b", "c", "d"] },
    { columns: 0, items: ["a", "b", "c", "d"] },
    { columns: 2, items: [{ item: "a", span: 0 }, "b", "c", "d"] },
    { columns: 2, direction: "left", items: ["a", "b", "c", "d"] },
    { columns: 2, items: [] },
  ]) {
    const diagnostics = checkFigure(source(grid), { file: "grid.sumi.yaml" }).state.diagnostics;
    expect(diagnostics.some((d) => d.code.startsWith("schema/"))).toBe(true);
    expect(
      diagnostics.filter((d) => d.code.startsWith("schema/")).every((d) => d.location?.line),
    ).toBe(true);
  }
});

test("empty-cell diagnostics point to the written cell; hidden junctions reserve blank cells", () => {
  for (const empty of [null, ""]) {
    const text = source({ columns: 2, items: ["a", empty, "b", "c", "d"] });
    const diagnostics = checkFigure(text).state.diagnostics;
    expect(
      diagnostics.some(
        (d) =>
          JSON.stringify(d.path) ===
            JSON.stringify(["figure", "layout", "arrange", "grid", "items", 1]) &&
          d.location !== undefined,
      ),
    ).toBe(true);
  }
  const text = stringify({
    version: 1,
    figure: { id: "blank", layout: { arrange: { grid: { columns: 2, items: ["blank", "a"] } } } },
    nodes: [
      { id: "blank", component: "junction", variant: "hidden" },
      { id: "a", component: "box", label: "A" },
    ],
  });
  expect(layout(text).nodes.map((n) => n.key)).toEqual(["n:blank", "n:a"]);
});

test("auto reports structured-only and wrapped items retain placement diagnostics", () => {
  const text = source({ columns: 2, items: ["a", "b", "c", { item: "d", span: 1 }] });
  expect(
    checkFigure(text.replace("layout:", "layout:\n    engine: auto")).state.diagnostics.map(
      (d) => d.code,
    ),
  ).toContain("layout/structured-only");
  const unknown = checkFigure(text.replace("item: d", "item: missing")).state.diagnostics.find(
    (d) => d.code === "layout/unknown-item",
  );
  expect(unknown?.path).toEqual(["figure", "layout", "arrange", "grid", "items", 3, "item"]);
});

test("canonical order descends through spanning items and nested grids", () => {
  const input =
    "version: 1\nfigure:\n  id: t\n  layout:\n    arrange:\n      grid: { items: [{ span: 2, item: { grid: { items: [a], align: start, columns: 1 } } }], align: stretch, columnGap: 2pt, rowGap: 3pt, columns: 2 }\n";
  const result = formatFigureSource(input, { canonicalOrder: true });
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.text).toContain(
      "grid: { columns: 2, rowGap: 3pt, columnGap: 2pt, align: stretch, items:",
    );
    expect(result.text).toContain(
      "{ item: { grid: { columns: 1, align: start, items: [ a ] } }, span: 2 }",
    );
  }
});

test("spanning deficits grow tracks evenly and include internal column gaps", () => {
  const text = source({
    columns: 2,
    rowGap: 0,
    columnGap: "5pt",
    align: "start",
    items: ["a", "d", { item: { row: { gap: 0, items: ["b", "c"] } }, span: 2 }],
  });
  // First row widths: 40,20 units. Spanning row needs 140, with 10 gap:
  // deficit 70 -> tracks 75,55. The first row's second item starts at 11+85.
  const placed = layout(text);
  expect(placed.nodes.find((n) => n.key === "n:d")?.rect.x).toBe(96);
  expect(placed.content.width).toBe(140);
});

test("horizontal end/center/stretch, fixed sizes and vertical centering", () => {
  const document = (align: string) =>
    stringify({
      version: 1,
      figure: {
        id: "stretch",
        layout: { arrange: { grid: { columns: 1, rowGap: 0, align, items: ["a", "b"] } } },
      },
      nodes: [
        { id: "a", component: "box", label: "A" },
        { id: "b", component: "box", label: "Much wider" },
      ],
    });
  const [startA, startB] = layout(document("start")).nodes.map((n) => n.rect) as [Rect, Rect];
  const [endA] = layout(document("end")).nodes.map((n) => n.rect) as [Rect];
  const [centerA] = layout(document("center")).nodes.map((n) => n.rect) as [Rect];
  const [stretchA, stretchB] = layout(document("stretch")).nodes.map((n) => n.rect) as [Rect, Rect];
  expect(startA.x).toBe(startB.x);
  expect(endA.x + endA.width).toBe(startB.x + startB.width);
  expect(centerA.x + centerA.width / 2).toBeCloseTo(startB.x + startB.width / 2, 2);
  expect(stretchA.width).toBe(stretchB.width);
  expect(stretchA.height).toBe(startA.height);
  const fixed = layout(source({ columns: 2, align: "stretch", items: ["a", "b", "c", "d"] }));
  expect(fixed.nodes.map((n) => n.rect.width)).toEqual([40, 80, 60, 20]);
});

test("tokens inside wrapped nested grids expand without changing spans", () => {
  const text = stringify({
    version: 1,
    figure: {
      id: "tokens",
      layout: {
        arrange: {
          grid: {
            columns: 2,
            items: [{ item: { grid: { columns: 1, items: ["seq"] } }, span: 2 }],
          },
        },
      },
    },
    nodes: [{ id: "seq", component: "tokens", props: { cells: ["One", "Two"], gap: 0 } }],
  });
  const placed = layout(text);
  expect(placed.nodes.map((n) => n.key)).toEqual(["n:seq-1", "n:seq-2"]);
  expect(placed.nodes[0]?.rect.y).toBe(placed.nodes[1]?.rect.y);
});

test("grid groups infer membership, captions stretch, attached nodes stay contained", () => {
  const text = stringify({
    version: 1,
    figure: {
      id: "group",
      layout: { arrange: { grid: { columns: 1, align: "stretch", items: ["g", "wide"] } } },
    },
    groups: [{ id: "g", caption: "Caption", arrange: { grid: { columns: 1, items: ["a"] } } }],
    nodes: [
      { id: "a", component: "box", label: "A" },
      {
        id: "side",
        component: "label",
        label: "Side",
        attach: { to: "a", side: "east", gap: "2pt" },
      },
      { id: "wide", component: "box", label: "A much wider box to stretch the group" },
    ],
  });
  const placed = layout(text);
  const group = placed.groups[0];
  expect(group).toBeDefined();
  expect(placed.nodes.find((n) => n.key === "n:a")?.parent).toBe("g:g");
  const side = placed.nodes.find((n) => n.key === "n:side");
  expect(side?.parent).toBe("g:g");
  expect((side?.rect.x ?? 0) + (side?.rect.width ?? 0)).toBeLessThanOrEqual(
    (group?.content.x ?? 0) + (group?.content.width ?? 0) + 0.001,
  );
  expect(group?.rect.width).toBe(placed.nodes.find((n) => n.key === "n:wide")?.rect.width);
});

test("align constraints may use nested linear boxes but cannot split grid tracks", () => {
  const text = stringify({
    version: 1,
    figure: {
      id: "align",
      layout: {
        arrange: {
          grid: {
            columns: 2,
            items: [{ stack: { items: ["a", "b"] } }, { stack: { items: ["c", "d"] } }],
          },
        },
        align: [{ y: ["b", "d"] }],
      },
    },
    nodes: [
      { id: "a", component: "box", label: "Tall\nbox" },
      { id: "b", component: "box", label: "B" },
      { id: "c", component: "box", label: "C" },
      { id: "d", component: "box", label: "D" },
    ],
  });
  const placed = layout(text);
  const b = placed.nodes.find((n) => n.key === "n:b");
  const d = placed.nodes.find((n) => n.key === "n:d");
  expect(Math.abs((b?.rect.y ?? 0) - (d?.rect.y ?? 0))).toBeLessThanOrEqual(0.01);
});
