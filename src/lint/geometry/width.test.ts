import { describe, expect, test } from "bun:test";
import { printedSize } from "../../render/size";
import { lintRenderedFigure } from "./lint";
import { compile, label, lintSpec } from "./testing";

const source = (arrange: string, extra = "") => `version: 1
figure:
  id: width
  layout:
    engine: structured
    arrange: ${arrange}
nodes:
  - { id: a, component: box, label: A, props: { width: 120pt } }
  - { id: b, component: box, label: B, props: { width: 150pt } }
${extra}`;
const row = source("{ row: { gap: 12mm, items: [a, b] } }");
const canvas = { x: 0, y: 0, width: 800, height: 100 };
const rect = (x: number, width: number, y = 0) => ({ x, y, width, height: 20 });
const hint = (text: string, elements: Parameters<typeof lintSpec>[1]["elements"], scale = 1) =>
  lintSpec(
    compile(text),
    { canvas, elements, scale, profile: { maxWidthPt: 1 } },
    {
      code: "geometry/exceeds-page-width",
    },
  )[0]?.hint ?? "";

describe("page width attribution (#307)", () => {
  test("nested rows identify the widest run, element widths and observed gaps", () => {
    const text = source("{ stack: { items: [{ row: { items: [a, b] } }] } }");
    const result = hint(text, { "n:a": { bbox: rect(0, 100) }, "n:b": { bbox: rect(140, 200) } });
    expect(result).toContain(
      "figure.layout.arrange.stack.items[0].row = 59.97mm (52.92mm occupied x-projection + 7.06mm observed gaps)",
    );
    expect(result).toContain('node "b" 35.28mm, node "a" 17.64mm');
    expect(result).toContain("reduce the largest observed gap (7.06mm)");
  });

  test.each(["row", "grid"])("a wider stack child dominates a small nested %s", (kind) => {
    const text = source(
      `{ stack: { items: [a, { ${kind}: { ${kind === "grid" ? "columns: 2, columnGap" : "gap"}: 5mm, items: [b, c] } }] } }`,
      "  - { id: c, component: box, label: C, props: { width: 20pt } }\n",
    );
    const result = hint(text, {
      "n:a": { bbox: rect(0, 600) },
      "n:b": { bbox: rect(0, 40, 40) },
      "n:c": { bbox: rect(70, 40, 40) },
    });
    expect(result).toContain("figure.layout.arrange.stack = 105.83mm");
    expect(result).toContain('node "a" 105.83mm');
    expect(result).not.toContain("reduce the largest observed gap");
  });

  test("real dominant stack child remains attributed when the unrelated gap is removed", async () => {
    const text = source(
      "{ stack: { items: [a, { row: { gap: 5mm, items: [b, c] } }] } }",
      "  - { id: c, component: box, label: C, props: { width: 20pt } }\n",
    )
      .replace("width: 120pt", "width: 300pt")
      .replace("width: 150pt", "width: 20pt");
    const before = await lintRenderedFigure(text);
    const after = await lintRenderedFigure(text.replace("gap: 5mm", "gap: 0mm"));
    expect(before.rendered).toBeDefined();
    expect(after.rendered).toBeDefined();
    if (!before.rendered || !after.rendered) throw new Error("render failed");
    expect(printedSize(after.rendered.inspection).widthPt).toBe(
      printedSize(before.rendered.inspection).widthPt,
    );
    const finding = before.diagnostics.find((d) => d.code === "geometry/exceeds-page-width");
    expect(finding?.hint).toContain('node "a" 105.83mm');
    expect(finding?.hint).not.toContain("reduce the largest observed gap");
  });

  test("fixed-width contained labels cannot outrank an effective row gap edit", async () => {
    const text = source("{ row: { gap: 20mm, items: [a, b] } }")
      .replace("width: 120pt", "width: 150pt")
      .replace("label: A", 'label: "A moderately long label"');
    const before = await lintRenderedFigure(text);
    const shorter = await lintRenderedFigure(text.replace("A moderately long label", "A"));
    const tighter = await lintRenderedFigure(text.replace("gap: 20mm", "gap: 0mm"));
    if (!before.rendered || !shorter.rendered || !tighter.rendered)
      throw new Error("render failed");
    expect(before.diagnostics.some((d) => d.code === "geometry/label-overflow")).toBe(false);
    const width = printedSize(before.rendered.inspection).widthPt;
    expect(printedSize(shorter.rendered.inspection).widthPt).toBe(width);
    expect(width - printedSize(tighter.rendered.inspection).widthPt).toBeGreaterThan(56);
    const finding = before.diagnostics.find((d) => d.code === "geometry/exceeds-page-width");
    expect(finding?.hint).toContain(
      "Largest measured candidates (not guaranteed savings): reduce the largest observed gap",
    );
    expect(finding?.hint).not.toContain("shorten or wrap the label");
  });

  test("fixed-width label overflow ranks by overhang rather than full text width", () => {
    const result = hint(row, {
      "n:a": { bbox: rect(0, 100), labels: [label("漢漢漢漢漢漢漢", 50, 15)] },
      "n:b": { bbox: rect(140, 200) },
    });
    expect(result).toContain("shorten or wrap the label");
    expect(result.indexOf("candidates (not guaranteed savings): reduce")).toBeGreaterThan(0);
  });

  test("grid columns, blank cells and spans do not double-count x-projections", () => {
    const text = source("{ grid: { columns: 3, items: [a, null, b] } }");
    const result = hint(text, { "n:a": { bbox: rect(0, 100) }, "n:b": { bbox: rect(140, 200) } });
    expect(result).toContain('column 3: node "b"');
    expect(result).toContain("Blank tracks cannot be attributed");
    const spanning = source("{ grid: { columns: 2, items: [a, null, { item: b, span: 2 }] } }");
    const overlap = hint(spanning, {
      "n:a": { bbox: rect(0, 100) },
      "n:b": { bbox: rect(0, 300, 40) },
    });
    expect(overlap).toContain("52.92mm occupied x-projection + 0mm observed gaps");
    expect(overlap).toContain('columns 1–2: node "b"');
  });

  test("attach expansion counts only the overhang beyond the arrange union", () => {
    const text = `${row}  - { id: c, component: label, label: C, attach: { to: b, side: east, gap: 5mm } }\n`;
    const result = hint(text, {
      "n:a": { bbox: rect(0, 100) },
      "n:b": { bbox: rect(140, 200) },
      "n:c": { labels: [label("漢漢", 370, 15)] },
    });
    expect(result).toContain('Attach expansion beyond arrange bounds: node "c" +8.11mm');
    expect(result).toContain('attach node "c" (horizontal overhang 8.11mm)');
    expect(result).toContain('label of node "c"');
    // Moving the same label inside the arrange bounds adds no horizontal width.
    expect(
      hint(text, {
        "n:a": { bbox: rect(0, 100) },
        "n:b": { bbox: rect(140, 200) },
        "n:c": { labels: [label("漢漢", 200, 15)] },
      }),
    ).not.toContain("Attach expansion");
  });

  test("all measurements use printed scale, including observed gaps", () => {
    const result = hint(
      row,
      { "n:a": { bbox: rect(0, 100) }, "n:b": { bbox: rect(140, 200) } },
      0.5,
    );
    expect(result).toContain("29.99mm (26.46mm occupied x-projection + 3.53mm observed gaps)");
  });

  test("an 80-attachment chain caps detail and summarizes the remainder deterministically", () => {
    const extra = Array.from(
      { length: 80 },
      (_, i) =>
        `  - { id: c${i}, component: box, label: C, attach: { to: ${i === 0 ? "b" : `c${i - 1}`}, side: east } }\n`,
    ).join("");
    const elements: Parameters<typeof hint>[1] = {
      "n:a": { bbox: rect(0, 100) },
      "n:b": { bbox: rect(140, 200) },
    };
    for (let i = 0; i < 80; i++) elements[`n:c${i}`] = { bbox: rect(350 + i * 110, 100) };
    const text = source("{ row: { items: [a, b] } }", extra);
    const original = structuredClone(elements);
    const result = hint(text, elements);
    const detail = result.split("Attach expansion beyond arrange bounds: ")[1]?.split(" (")[0];
    expect(detail?.match(/node /g)).toHaveLength(6);
    expect(detail).toContain("74 more");
    expect(result.length).toBeLessThan(1800);
    expect(hint(text, elements)).toBe(result);
    expect(elements).toEqual(original);
  });

  test("nested groups report north/west attach chains without adding container totals", () => {
    const text = `version: 1
figure: { id: nested, layout: { arrange: { stack: { items: [g] } } } }
groups:
  - { id: g, arrange: { row: { items: [a] } } }
nodes:
  - { id: a, component: box, label: A }
  - { id: b, component: box, label: B, attach: { to: a, side: north } }
  - { id: c, component: box, label: C, attach: { to: b, side: west } }
`;
    const result = hint(text, {
      "g:g": { bbox: rect(-150, 400) },
      "n:a": { bbox: rect(0, 100) },
      "n:b": { bbox: rect(-50, 200, -40) },
      "n:c": { bbox: rect(-150, 100, -40) },
    });
    expect(result).toContain("figure.layout.arrange.stack = 70.56mm");
    expect(result).toContain('group "g" 70.56mm');
    expect(result).toContain('node "b" +17.64mm, node "c" +17.64mm');
    expect(result).toContain("nested containers are not additive");
  });

  test("an in-profile figure receives no width diagnostic", () => {
    expect(
      lintSpec(
        compile(row),
        {
          canvas: rect(0, 300),
          elements: { "n:a": { bbox: rect(0, 100) }, "n:b": { bbox: rect(140, 100) } },
        },
        { code: "geometry/exceeds-page-width" },
      ),
    ).toEqual([]);
  });

  test("auto merges overlapping ranges and keeps its scope explicit", () => {
    const text = row.replace("engine: structured", "engine: auto").replace(/ {4}arrange:.*\n/, "");
    const result = hint(text, {
      "n:a": { bbox: rect(0, 100) },
      "n:b": { bbox: rect(50, 200, 40) },
    });
    expect(result).toContain(
      "auto horizontal footprint = 44.1mm (44.1mm occupied x-projection + 0mm observed gaps)",
    );
    expect(result).toContain("ELK layer spacing is not exposed");
    expect(result).not.toContain("reduce the largest observed gap");
  });

  test("real structured rendering reports concrete widths and the actionable gap", async () => {
    const report = await lintRenderedFigure(row);
    const finding = report.diagnostics.find((d) => d.code === "geometry/exceeds-page-width");
    expect(finding?.hint).toContain("figure.layout.arrange.row = 107.25mm");
    expect(finding?.hint).toContain("12mm observed gaps");
    expect(finding?.hint).toContain('node "b" 52.92mm');
    expect(finding?.hint).toContain("Largest measured candidates");
    expect(report.exitCode).toBe(1);
  });

  test("real auto rendering adds observed attribution to the reproduced diagnostic", async () => {
    const report = await lintRenderedFigure(
      await Bun.file("tests/fixtures/figures/geometry/exceeds-page-width.sumi.yaml").text(),
    );
    const finding = report.diagnostics.find((d) => d.code === "geometry/exceeds-page-width");
    expect(finding?.message).toContain("130.35mm");
    expect(finding?.hint).toContain("auto horizontal footprint");
    expect(finding?.hint).toContain("measured candidates");
  });
});
