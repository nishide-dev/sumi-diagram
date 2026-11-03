import { expect, spyOn, test } from "bun:test";
import { formatMm } from "../../core/units";
import { MAX_HINT_ELEMENTS, MAX_HINT_TRIALS } from "../../layout/hint-trials";
import * as engine from "../../layout/structured/engine";
import { printedSize } from "../../render/size";
import { geometryContextFor, lintGeometry, lintRenderedFigure } from "./lint";
import { exceedsPageWidth, groupEmptyArea } from "./rules";
import { verifyHints } from "./verified";

const gridProbe = (count: number, span = false) => `version: 1
figure:
  id: probe
  layout:
    engine: structured
    arrange:
      grid: { columns: 2, columnGap: 2mm, items: [${span ? "{ item: a, span: 2 }" : "a, d"}, ${Array.from({ length: count }, (_, i) => `g${i}, e${i}`).join(", ")}] }
groups:
${Array.from({ length: count }, (_, i) => `  - { id: g${i}, arrange: { row: { gap: ${5 + i}mm, items: [b${i}, c${i}] } } }`).join("\n")}
nodes:
  - { id: a, component: box, label: A, props: { width: 300pt } }
${span ? "" : "  - { id: d, component: box, label: D, props: { width: 20pt } }"}
${Array.from({ length: count }, (_, i) => ["b", "c", "e"].map((id) => `  - { id: ${id}${i}, component: box, label: X, props: { width: 20pt } }`).join("\n")).join("\n")}
`;

test.each([1, 3])(
  "grid probe with %i smaller groups recommends only edits with real savings",
  async (count) => {
    const text = gridProbe(count);
    const before = await lintRenderedFigure(text);
    const outer = await lintRenderedFigure(text.replace("columnGap: 2mm", "columnGap: 0mm"));
    const inner = await lintRenderedFigure(text.replace("gap: 5mm", "gap: 0mm"));
    if (!before.rendered || !outer.rendered || !inner.rendered) throw new Error("render failed");
    const width = printedSize(before.rendered.inspection).widthPt;
    expect(printedSize(inner.rendered.inspection).widthPt).toBe(width);
    const reduction = width - printedSize(outer.rendered.inspection).widthPt;
    const hint = before.diagnostics.find((d) => d.code === exceedsPageWidth.id)?.hint;
    expect(hint).toContain(
      `set figure.layout.arrange.grid.columnGap to 0mm (page width reduced by ${formatMm(reduction)})`,
    );
    expect(hint).not.toMatch(/set group "g\d"\.arrange\.row\.gap/);
    const saved = structuredClone(before.rendered.compiled.ir);
    const inspection = structuredClone(before.rendered.inspection);
    const again = lintGeometry(before.rendered, { rules: [exceedsPageWidth] });
    expect(again[0]?.hint).toBe(hint);
    expect(before.rendered.compiled.ir).toEqual(saved);
    expect(before.rendered.inspection).toEqual(inspection);
    const edits = hint?.split("Verified layout edits (independent trials): ")[1]?.split("; ") ?? [];
    const reductions = edits.map((e) => Number(e.match(/reduced by ([\d.]+)mm/)?.[1]));
    expect(reductions.length).toBeGreaterThan(0);
    expect(reductions).toEqual([...reductions].sort((a, b) => b - a));
  },
);

test("a spanning dominant item does not turn ineffective descendant gaps into remedies", async () => {
  const report = await lintRenderedFigure(gridProbe(3, true));
  const hint = report.diagnostics.find((d) => d.code === exceedsPageWidth.id)?.hint;
  expect(hint).toBeDefined();
  expect(hint).not.toMatch(/set group "g\d"\.arrange\.row\.gap/);
});

test("layout trial budget and large-figure bypass are deterministic performance guards", async () => {
  const report = await lintRenderedFigure(gridProbe(8));
  if (!report.rendered) throw new Error("render failed");
  const context = geometryContextFor(report.rendered);
  const spy = spyOn(engine, "placeStructured");
  try {
    const first = verifyHints(context, "width", (c) => c.canvas.width);
    expect(spy.mock.calls.length).toBe(MAX_HINT_TRIALS);
    spy.mockClear();
    expect(verifyHints(context, "width", (c) => c.canvas.width)).toBe(first);
    expect(spy.mock.calls.length).toBe(MAX_HINT_TRIALS);
    spy.mockClear();
    const large = { ...context.ir, elements: new Map(context.ir.elements) };
    // Only the size is needed to exercise the pre-layout guard.
    for (let i = large.elements.size; i <= MAX_HINT_ELEMENTS; i++)
      large.elements.set(`n:extra${i}`, large.nodes[0] as NonNullable<(typeof large.nodes)[0]>);
    expect(verifyHints({ ...context, ir: large }, "width", (c) => c.canvas.width)).toContain(
      "trials skipped",
    );
    expect(spy).not.toHaveBeenCalled();
    expect(
      verifyHints(
        { ...context, ir: { ...context.ir, meta: { ...context.ir.meta, engine: "auto" } } },
        "width",
        (c) => c.canvas.width,
      ),
    ).toContain("no trial layouts");
    expect(spy).not.toHaveBeenCalled();
  } finally {
    spy.mockRestore();
  }
});

test.each(["box", "circle", "label"])(
  "empty-area remedies for grid %s are verified against a fresh layout",
  async (component) => {
    const text = `version: 1
figure: { id: empty, layout: { engine: structured, arrange: { grid: { columns: 1, align: stretch, items: [g, wide] } } } }
groups: [{ id: g, arrange: { grid: { columns: 1, items: [a] } } }]
nodes:
  - { id: a, component: ${component}, label: A, props: { width: 20pt } }
  - { id: wide, component: box, label: Wide, props: { width: 500pt } }
`;
    const report = await lintRenderedFigure(text, { rules: [groupEmptyArea] });
    const hint = report.diagnostics.find((d) => d.subject?.id === "g")?.hint;
    expect(hint).toBeDefined();
    if (hint?.includes('remove the explicit width of node "a"')) {
      const after = await lintRenderedFigure(text.replace("props: { width: 20pt }", "props: {}"), {
        rules: [groupEmptyArea],
      });
      expect(after.diagnostics.some((d) => d.subject?.id === "g")).toBe(false);
    }
    if (hint?.includes('set group "g".arrange.grid.align to stretch')) {
      const after = await lintRenderedFigure(
        text.replace("columns: 1, items: [a]", "columns: 1, align: stretch, items: [a]"),
        { rules: [groupEmptyArea] },
      );
      expect(after.diagnostics.some((d) => d.subject?.id === "g")).toBe(false);
    }
    if (component === "circle" || component === "label")
      expect(hint).not.toContain('set group "g".arrange.grid.align to stretch');
  },
);

test("an empty-area remedy is shown only when a fresh layout removes the diagnostic", async () => {
  const source = (extra = "", wide = "props: { width: 500pt }") => `version: 1
figure: { id: positive, layout: { engine: structured, arrange: { stack: { align: stretch, items: [g, wide] } } } }
groups: [{ id: g, arrange: { row: { ${extra} items: [a] } } }]
nodes:
  - { id: a, component: box, label: A }
  - { id: wide, component: box, label: Wide, ${wide} }
`;
  const report = await lintRenderedFigure(source(), { rules: [groupEmptyArea] });
  const hint = report.diagnostics.find((d) => d.subject?.id === "g")?.hint;
  expect(hint).toContain('set group "g".arrange.row.justify to stretch (removes this diagnostic)');
  const after = await lintRenderedFigure(source("justify: stretch,"), { rules: [groupEmptyArea] });
  expect(after.diagnostics.some((d) => d.subject?.id === "g")).toBe(false);
  if (!report.rendered) throw new Error("render failed");
  expect(verifyHints(geometryContextFor(report.rendered), "empty", () => 1)).toContain(
    "No remedy verified",
  );
});

test("a grid track does not grow with its frame, so grid align stretch is not recommended", async () => {
  const text = `version: 1
figure: { id: positive, layout: { engine: structured, arrange: { grid: { columns: 1, align: stretch, items: [g, wide] } } } }
groups: [{ id: g, arrange: { grid: { columns: 1, items: [a] } } }]
nodes:
  - { id: a, component: box, label: A }
  - { id: wide, component: box, label: Wide, props: { width: 500pt } }
`;
  const report = await lintRenderedFigure(text, { rules: [groupEmptyArea] });
  const hint = report.diagnostics.find((d) => d.subject?.id === "g")?.hint;
  expect(hint).not.toContain('set group "g".arrange.grid.align to stretch');
  const after = await lintRenderedFigure(
    text.replace("columns: 1, items: [a]", "columns: 1, align: stretch, items: [a]"),
    { rules: [groupEmptyArea] },
  );
  expect(after.diagnostics.some((d) => d.subject?.id === "g")).toBe(true);
});

test("a separator is neither a width candidate nor an obstacle to verified width hints", async () => {
  const report = await lintRenderedFigure(`version: 1
figure: { id: sep, layout: { engine: structured, arrange: { row: { gap: 30mm, items: [a, s, b] } } } }
nodes:
  - { id: a, component: box, label: A, props: { width: 300pt } }
  - { id: s, component: separator }
  - { id: b, component: box, label: B, props: { width: 300pt } }
`);
  const hint = report.diagnostics.find((d) => d.code === exceedsPageWidth.id)?.hint;
  expect(hint).toContain("set figure.layout.arrange.row.gap to 0mm (page width reduced by");
  expect(hint).not.toMatch(/node "s"/);
});

const rowsOf = (gaps: readonly string[]) =>
  gaps.map((g, i) => `{ row: { gap: ${g}, items: [x${i}, y${i}] } }`).join(", ");
const rowNodes = (count: number) =>
  Array.from({ length: count }, (_, i) =>
    ["x", "y"]
      .map((c) => `  - { id: ${c}${i}, component: box, label: X, props: { width: 20pt } }`)
      .join("\n"),
  ).join("\n");
const widthHint = async (text: string) =>
  (await lintRenderedFigure(text)).diagnostics.find((d) => d.code === exceedsPageWidth.id)?.hint;

test("candidates are ordered by expected impact, not tree order, within the trial budget", async () => {
  const wideNode = await widthHint(`version: 1
figure: { id: f, profile: paper-single, layout: { engine: structured, arrange: { stack: { items: [a, ${rowsOf(Array(7).fill("5mm"))}] } } } }
nodes:
  - { id: a, component: box, label: A, props: { width: 300pt } }
${rowNodes(7)}
`);
  expect(wideNode).toContain('remove the explicit width of node "a" (page width reduced by');
  const wideGap = await widthHint(
    `version: 1
figure: { id: g, profile: paper-single, layout: { engine: structured, arrange: { stack: { items: [${rowsOf([...Array(7).fill("1mm"), "100mm"])}] } } } }
nodes:
${rowNodes(7)}
  - { id: m, component: box, label: M }
  - { id: n, component: box, label: N }
`.replace("[x7, y7]", "[m, n]"),
  );
  expect(wideGap).toContain("items[7].row.gap to 0mm");
});

test("attach gaps are verified candidates", async () => {
  const chain = Array.from(
    { length: 5 },
    (_, i) =>
      `  - { id: c${i}, component: box, label: C, props: { width: 60pt }, attach: { to: ${i === 0 ? "b" : `c${i - 1}`}, side: east, gap: 8mm } }`,
  ).join("\n");
  const text = `version: 1
figure: { id: i, profile: paper-single, layout: { engine: structured, arrange: { row: { items: [a, b] } } } }
nodes:
  - { id: a, component: box, label: A }
  - { id: b, component: box, label: B }
${chain}
`;
  const before = await lintRenderedFigure(text);
  const after = await lintRenderedFigure(text.replaceAll("gap: 8mm", "gap: 0mm"));
  if (!before.rendered || !after.rendered) throw new Error("render failed");
  const reduction =
    printedSize(before.rendered.inspection).widthPt -
    printedSize(after.rendered.inspection).widthPt;
  const hint = before.diagnostics.find((d) => d.code === exceedsPageWidth.id)?.hint;
  expect(hint).toContain(
    `set attach.gap of all 5 attached nodes to 0mm (page width reduced by ${formatMm(reduction)})`,
  );
});

test("one failed trial does not end the search", async () => {
  const report = await lintRenderedFigure(gridProbe(1));
  if (!report.rendered) throw new Error("render failed");
  const context = geometryContextFor(report.rendered);
  const real = engine.placeStructured;
  let calls = 0;
  const spy = spyOn(engine, "placeStructured").mockImplementation((ir, options) => {
    calls++;
    const placed = real(ir, options);
    // The first candidate fails with a placement error; the search must go on.
    return calls === 1
      ? {
          ...placed,
          diagnostics: [
            ...placed.diagnostics,
            { code: "layout/test", severity: "error" as const, message: "bad candidate" },
          ],
        }
      : placed;
  });
  try {
    const hint = verifyHints(context, "width", (c) => c.canvas.width);
    expect(calls).toBeGreaterThan(1);
    expect(hint).toContain("Verified layout edits");
  } finally {
    spy.mockRestore();
  }
});
