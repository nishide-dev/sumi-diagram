/**
 * Width fitting (#607): the natural-width path names the item that sets the
 * width (also under `align: stretch`), and every suggested value, written
 * into the YAML, renders within the profile without new errors or warnings.
 */
import { describe, expect, spyOn, test } from "bun:test";
import { asHintTrial } from "../../layout/hint-trials";
import * as engine from "../../layout/structured/engine";
import { widthPath } from "../../layout/structured/width-tree";
import { printedSize } from "../../render/size";
import { resolveLintConfig } from "../config";
import { defineGeometryRule } from "../rule";
import { geometryContextFor, lintRenderedFigure } from "./lint";
import { exceedsPageWidth } from "./rules";
import {
  explainWidth,
  fitHints,
  MAX_FIT_TRIALS,
  skippedInTrials,
  widthTreeJson,
  widthTreeLines,
} from "./width-fit";

const widthHint = async (text: string, options: Parameters<typeof lintRenderedFigure>[1] = {}) => {
  const report = await lintRenderedFigure(text, options);
  const found = report.diagnostics.find((d) => d.code === "geometry/exceeds-page-width");
  return { report, hint: found?.hint ?? "" };
};

/** Errors and warnings, by code, but the width error itself. */
const problems = (report: Awaited<ReturnType<typeof lintRenderedFigure>>) =>
  report.diagnostics
    .filter((d) => d.severity !== "info" && d.code !== "geometry/exceeds-page-width")
    .map((d) => d.code)
    .sort();

const stretched = `version: 1
figure:
  id: stretched
  theme: sumi
  profile: paper-single
  layout:
    engine: structured
    arrange:
      row:
        items:
          - left
          - { stack: { align: stretch, items: [attn, moe, key] } }
groups:
  - { id: left, label: Input, arrange: { stack: { items: [x, y] } } }
  - { id: attn, label: Attention, arrange: { row: { items: [q, k, v] } } }
  - { id: moe, label: MoE, arrange: { row: { items: [e1, e2] } } }
nodes:
  - { id: x, component: box, label: Tokens }
  - { id: y, component: box, label: Embed }
  - { id: q, component: box, label: Q }
  - { id: k, component: box, label: K }
  - { id: v, component: box, label: V }
  - { id: e1, component: box, label: Expert 1 }
  - { id: e2, component: box, label: Expert 2 }
  - id: key
    component: legend
    props:
      flow: row
      entries:
        - { node: {}, label: Routed expert }
        - { node: {}, label: Shared expert }
edges:
  - { from: y, to: q }
`;

const panels = `version: 1
figure:
  id: panels
  theme: sumi
  profile: paper-single
  layout:
    engine: structured
    arrange: { row: { gap: 3mm, items: [pa, pb] } }
groups:
  - { id: pa, label: (a) Placement, arrange: { stack: { items: [in, sdpa, out] } } }
  - { id: pb, label: (b) Results, arrange: { grid: { columns: 3, items: [r1, r2, r5, r3, r4, r6] } } }
nodes:
  - { id: in, component: box, label: Input X }
  - { id: sdpa, component: box, label: SDPA + gate }
  - { id: out, component: box, label: Output proj }
  - { id: r1, component: box, label: "PPL 6.0" }
  - { id: r2, component: box, label: "MMLU 58" }
  - { id: r3, component: box, label: "PPL 5.7" }
  - { id: r4, component: box, label: "MMLU 60" }
  - { id: r5, component: box, label: "Sink 0.1" }
  - { id: r6, component: box, label: "Sink 0.4" }
edges:
  - { from: in, to: sdpa }
  - { from: sdpa, to: out }
`;

describe("the natural-width path (#607)", () => {
  test("a stretched stack names the item that sets its width, not one width for all", async () => {
    const { report, hint } = await widthHint(stretched);
    expect(hint).toContain(
      'its items are stretched to one width when drawn, natural widths: legend "key"',
    );
    expect(hint).toContain('Widest contributor: legend "key"');
    expect(hint).toContain("a legend sized by its own props, e.g. perRow");
    if (!report.rendered) throw new Error("render failed");
    const tree = explainWidth(geometryContextFor(report.rendered));
    if (!tree) throw new Error("no tree");
    const path = widthPath(tree);
    expect(path.at(-1)?.name).toBe('legend "key"');
    // The groups are drawn as wide as the legend, but report their own width.
    const stack = path.at(-2);
    const attn = stack?.children.find((c) => c.name === 'group "attn"');
    expect(attn?.placedPt).toBeCloseTo(stack?.widthPt ?? 0, 3);
    expect(attn?.widthPt).toBeLessThan((stack?.widthPt ?? 0) - 20);
  });

  test("the root width plus the margins is the page width", async () => {
    for (const text of [stretched, panels]) {
      const report = await lintRenderedFigure(text);
      if (!report.rendered) throw new Error("render failed");
      const context = geometryContextFor(report.rendered);
      const tree = explainWidth(context);
      const margin = (context.placed?.layout.margin ?? 0) / 2;
      expect(tree?.widthPt).toBeDefined();
      // The canvas is rounded up to whole layout units.
      expect(context.inspection.canvas.width.pt - (tree?.widthPt ?? 0) - 2 * margin).toBeLessThan(
        0.5 + 1e-6,
      );
    }
  });

  test("the tree shows padding, gaps and the widest item of each grid column", async () => {
    const report = await lintRenderedFigure(panels);
    if (!report.rendered) throw new Error("render failed");
    const context = geometryContextFor(report.rendered);
    const tree = explainWidth(context);
    if (!tree) throw new Error("no tree");
    const lines = widthTreeLines(
      tree,
      context.inspection.canvas.width.pt,
      context.placed?.layout.margin,
    );
    expect(lines[0]).toContain("page 97.72mm (before fit: scale) = margins 2 × 1.94mm");
    expect(lines.join("\n")).toContain(
      'group "pb" 63.03mm = content 57.39mm + padding 8pt + 8pt (profile default)',
    );
    expect(lines.join("\n")).toContain("+ 2 × 4mm columnGap (profile default)");
    const marked = lines.filter((l) => l.trimStart().startsWith("* node"));
    // One per column of the grid (r1, r4, r6) and the widest item of panel (a).
    expect(marked.map((l) => l.match(/node "(\w+)"/)?.[1]).sort()).toEqual([
      "r1",
      "r4",
      "r6",
      "sdpa",
    ]);
  });

  test("a spanning grid item that widens its columns is marked, in text and JSON", async () => {
    const text = `version: 1
figure:
  id: span
  profile: paper-single
  layout:
    engine: structured
    arrange: { grid: { columns: 2, items: [a, b, { item: wide, span: 2 }] } }
nodes:
  - { id: a, component: box, label: A }
  - { id: b, component: box, label: B }
  - { id: wide, component: box, label: W, props: { width: 60mm } }
`;
    const report = await lintRenderedFigure(text);
    if (!report.rendered) throw new Error("render failed");
    const tree = explainWidth(geometryContextFor(report.rendered));
    if (!tree) throw new Error("no tree");
    const lines = widthTreeLines(tree);
    expect(lines.find((l) => l.includes('node "wide"'))?.trimStart()).toStartWith("* ");
    expect(lines.find((l) => l.includes('node "a"'))?.trimStart()).not.toStartWith("* ");
    const grid = widthTreeJson(tree).children[0];
    expect(grid?.children.map((c) => [c.name, c.setsWidth])).toEqual([
      ['node "a"', false],
      ['node "b"', false],
      ['node "wide"', true],
    ]);
  });

  test("nothing inside a group whose title sets its width is marked", async () => {
    const text = `version: 1
figure:
  id: title
  profile: paper-single
  layout: { engine: structured, arrange: { row: { items: [g] } } }
groups:
  - { id: g, label: "A panel title much wider than what it holds", arrange: { stack: { items: [a] } } }
nodes:
  - { id: a, component: box, label: A }
`;
    const report = await lintRenderedFigure(text);
    if (!report.rendered) throw new Error("render failed");
    const tree = explainWidth(geometryContextFor(report.rendered));
    if (!tree) throw new Error("no tree");
    expect(widthPath(tree).at(-1)?.name).toBe('group "g"');
    const lines = widthTreeLines(tree);
    expect(lines.some((l) => l.trimStart().startsWith('* group "g" '))).toBe(true);
    expect(lines.find((l) => l.includes('node "a"'))?.trimStart()).not.toStartWith("* ");
    expect(lines.find((l) => l.includes('group "g".arrange'))?.trimStart()).not.toStartWith("* ");
    const group = widthTreeJson(tree).children[0]?.children[0];
    expect(group?.setsWidth).toBe(true);
    expect(group?.children[0]?.setsWidth).toBe(false);
    expect(group?.children[0]?.children[0]?.setsWidth).toBe(false);
  });

  test("auto figures keep the observed breakdown", async () => {
    const { hint } = await widthHint(`version: 1
figure: { id: auto, profile: paper-single, layout: { direction: right } }
nodes:
${Array.from({ length: 6 }, (_, i) => `  - { id: n${i}, component: box, label: "Stage number ${i}" }`).join("\n")}
edges:
${Array.from({ length: 5 }, (_, i) => `  - { from: n${i}, to: n${i + 1} }`).join("\n")}
`);
    if (hint === "") return; // D2 is not installed: nothing rendered.
    expect(hint).not.toContain("Width path");
    expect(hint).toContain("auto horizontal footprint");
  });
});

describe("fitting values, verified by doing them (#607)", () => {
  /** Applies `set <path> to <value>` hints to the YAML and returns the edited text. */
  const apply = (text: string, edits: Record<string, [string, string]>) =>
    Object.values(edits).reduce((t, [from, to]) => t.replace(from, to), text);

  test("one gap: the suggested value renders within the profile", async () => {
    const text = `version: 1
figure:
  id: gap
  profile: paper-single
  layout: { engine: structured, arrange: { row: { gap: 20mm, items: [a, b] } } }
nodes:
  - { id: a, component: image, props: { svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10"><rect width="20" height="10"/></svg>', width: 100pt } }
  - { id: b, component: image, props: { svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10"><rect width="20" height="10"/></svg>', width: 100pt } }
`;
    const { report, hint } = await widthHint(text);
    const value = hint.match(
      /set figure\.layout\.arrange\.row\.gap to ([\d.]+)mm \(now 20mm\) → ([\d.]+)mm/,
    );
    expect(value).not.toBeNull();
    const after = await lintRenderedFigure(text.replace("gap: 20mm", `gap: ${value?.[1]}mm`));
    if (!after.rendered) throw new Error("render failed");
    expect(printedSize(after.rendered.inspection).widthPt).toBeLessThanOrEqual(
      (88 * 72) / 25.4 + 1e-6,
    );
    expect(`${(printedSize(after.rendered.inspection).widthPt * 25.4) / 72}`).toStartWith(
      value?.[2]?.slice(0, 4) ?? "x",
    );
    expect(problems(after)).toEqual(problems(report));
  });

  test("gaps and paddings together, when no single value can remove the overflow", async () => {
    const { report, hint } = await widthHint(panels);
    expect(problems(report)).toEqual([]);
    const combined = hint.match(
      /set figure\.layout\.arrange\.row\.gap to ([\d.]+)mm \(now 3mm\), set props\.padding of group "pb" to ([\d.]+)pt \(now 8pt, the profile default; every side\), set group "pb"\.arrange\.grid\.columnGap to ([\d.]+)mm \(now 4mm, the profile default\) \(together\) → ([\d.]+)mm/,
    );
    expect(combined).not.toBeNull();
    const [, gap, padding, columnGap, width] = combined ?? [];
    const edited = apply(panels, {
      gap: ["gap: 3mm", `gap: ${gap}mm`],
      padding: ["id: pb, label", `id: pb, props: { padding: ${padding}pt }, label`],
      columnGap: ["columns: 3, items", `columns: 3, columnGap: ${columnGap}mm, items`],
    });
    const after = await lintRenderedFigure(edited);
    if (!after.rendered) throw new Error("render failed");
    expect(printedSize(after.rendered.inspection).widthPt).toBeLessThanOrEqual((88 * 72) / 25.4);
    expect(
      `${Math.round(((printedSize(after.rendered.inspection).widthPt * 25.4) / 72) * 100) / 100}mm`,
    ).toBe(`${width}mm`);
    expect(problems(after)).toEqual([]);
  });

  test("a fitting value that adds a warning is not suggested; the hint names the warning", async () => {
    const text = `version: 1
figure:
  id: guard
  profile: paper-single
  layout: { engine: structured, arrange: { row: { gap: 6mm, items: [a, b, c] } } }
nodes:
  - { id: a, component: box, label: Tokens }
  - { id: b, component: box, label: "Transformer stack" }
  - { id: c, component: box, label: "Output head" }
edges:
  - { from: a, to: b }
  - { from: b, to: c }
`;
    // A stand-in for any rule a tighter layout can trip: gaps under 14pt warn.
    const guard = defineGeometryRule({
      id: "geometry/test-gap-guard",
      description: "test",
      defaultSeverity: "warning",
      fixable: false,
      run: (context) =>
        (context.ir.arrange?.gapPt ?? 99) < 14
          ? [{ message: "tight", path: ["figure"], subject: { kind: "figure", id: "guard" } }]
          : [],
    });
    const plain = await widthHint(text, { rules: [exceedsPageWidth] });
    expect(plain.hint).toContain("set figure.layout.arrange.row.gap to 4.5mm (now 6mm) → 87.49mm");
    const guarded = await widthHint(text, { rules: [exceedsPageWidth, guard] });
    expect(guarded.hint).toContain("No single edit on the width path verified to fit");
    expect(guarded.hint).toContain(
      "set figure.layout.arrange.row.gap to 4.5mm (now 6mm) would fit but adds geometry/test-gap-guard",
    );
  });

  test("an explicit width is not taken below its label", async () => {
    const text = `version: 1
figure:
  id: widths
  profile: paper-single
  layout: { engine: structured, arrange: { row: { gap: 20mm, items: [a, b] } } }
nodes:
  - { id: a, component: box, label: "A moderately long label", props: { width: 150pt } }
  - { id: b, component: box, label: B, props: { width: 150pt } }
`;
    const { report, hint } = await widthHint(text);
    const value = hint.match(/set props\.width of node "b" to ([\d.]+)mm/);
    expect(value).not.toBeNull();
    expect(hint).not.toContain('props.width of node "a" to');
    const after = await lintRenderedFigure(
      text.replace(
        "label: B, props: { width: 150pt }",
        `label: B, props: { width: ${value?.[1]}mm }`,
      ),
    );
    expect(problems(after)).toEqual(problems(report));
  });

  test("the trials stay within the budget, and inside another trial none run", async () => {
    const report = await lintRenderedFigure(panels);
    if (!report.rendered) throw new Error("render failed");
    const context = geometryContextFor(report.rendered);
    const tree = explainWidth(context);
    if (!tree) throw new Error("no tree");
    const overflow = context.inspection.canvas.width.pt - 88 * (72 / 25.4);
    const spy = spyOn(engine, "placeStructured");
    try {
      const result = fitHints(context, tree, overflow);
      expect(result.trials).toBeGreaterThan(0);
      expect(result.trials).toBeLessThanOrEqual(MAX_FIT_TRIALS);
      expect(spy.mock.calls.length).toBe(result.trials);
      expect(result.fits.length).toBe(1);
      spy.mockClear();
      // Inside another rule's trial (#621's relocations, or a trial of this rule): nothing runs.
      const nested = asHintTrial(() => fitHints(context, tree, overflow));
      expect(nested).toEqual({
        fits: [],
        rejected: [],
        trials: 0,
        skipped: "inside another trial",
      });
      expect(asHintTrial(() => explainWidth(context))).toBeUndefined();
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  test("fit: scale keeps the fitting values in geometry/heavy-scaling", async () => {
    const text = panels
      .replace("  theme: sumi\n", "  theme: sumi\n  fit: scale\n")
      .replace("gap: 3mm", "gap: 25mm");
    const report = await lintRenderedFigure(text);
    expect(report.diagnostics.some((d) => d.code === "geometry/exceeds-page-width")).toBe(false);
    const heavy = report.diagnostics.find((d) => d.code === "geometry/heavy-scaling");
    expect(heavy).toBeDefined();
    expect(heavy?.hint).toContain("Width breakdown before scaling: Width to remove: ");
    expect(heavy?.hint).toMatch(
      /Fits 88mm .*set figure\.layout\.arrange\.row\.gap to [\d.]+mm \(now 25mm\).*\(together\) → [\d.]+mm/,
    );
  });

  test("relocatable-node counts in the trials only when configured as warning or error", async () => {
    const report = await lintRenderedFigure(panels);
    if (!report.rendered) throw new Error("render failed");
    const base = geometryContextFor(report.rendered);
    const at = (level?: string) => ({
      ...base,
      lintConfig: resolveLintConfig(
        level === undefined ? {} : { rules: { "geometry/relocatable-node": level } },
      ),
    });
    expect([...skippedInTrials(at())].sort()).toEqual([
      "geometry/exceeds-page-width",
      "geometry/heavy-scaling",
      "geometry/relocatable-node",
    ]);
    for (const level of ["warning", "error"])
      expect(skippedInTrials(at(level)).has("geometry/relocatable-node")).toBe(false);
    // With it counted, the trials still run (it lays out its own candidates inside them).
    const promoted = await lintRenderedFigure(panels, {
      config: { rules: { "geometry/relocatable-node": "warning" } },
    });
    const hint = promoted.diagnostics.find((d) => d.code === "geometry/exceeds-page-width")?.hint;
    expect(hint).toContain("(together) → ");
  });
});
