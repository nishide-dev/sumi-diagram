/**
 * The width and height hints try the levers that made the #639 dogfood
 * figures fit (#640): a legend's `perRow`, a matrix's `flush` / `cellWidth`,
 * `place` x coordinates and a sequence's `rowGap`; they keep gaps of at least
 * 2mm before going lower, and say why a group's padding grew. The figures
 * are reduced copies of the dogfood YAMLs (`tests/fixtures/figures/fit-hints`).
 * For each lever (perRow with a gap, flush, cellWidth, place x, a gap,
 * participantGap, rowGap) a test writes the value the hint gives into the
 * YAML and renders it: it fits the profile without new errors or warnings.
 * The YAML edits are only made when the YAML compiles to the rendered figure,
 * and values below the intent floors come after every other edit.
 */
import { describe, expect, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { compileFigure } from "../../compiler/compile";
import * as engine from "../../layout/structured/engine";
import { renderFigure } from "../../render";
import { printedSize } from "../../render/size";
import { sourceEditor } from "./fit-candidates";
import { MAX_HEIGHT_TRIALS, sequenceHeightFits } from "./height-fit";
import { geometryContextFor, lintGeometry, lintRenderedFigure } from "./lint";
import { exceedsPageWidth } from "./rules";
import { explainWidth, fitHints, MAX_FIT_TRIALS, widthTreeJson, widthTreeLines } from "./width-fit";

const fixture = (name: string) =>
  readFileSync(
    new URL(`../../../tests/fixtures/figures/fit-hints/${name}.sumi.yaml`, import.meta.url),
    "utf8",
  );

const hintOf = async (text: string, code = "geometry/exceeds-page-width") => {
  const report = await lintRenderedFigure(text);
  return { report, hint: report.diagnostics.find((d) => d.code === code)?.hint ?? "" };
};

/** Errors and warnings, by code, but the page-size errors. */
const problems = (report: Awaited<ReturnType<typeof lintRenderedFigure>>) =>
  report.diagnostics
    .filter((d) => d.severity !== "info" && !d.code.startsWith("geometry/exceeds-page-"))
    .map((d) => d.code)
    .sort();

/** Renders `text` and checks it fits `maxMm` wide (or tall) with no new problem. */
const expectFits = async (
  text: string,
  before: Awaited<ReturnType<typeof lintRenderedFigure>>,
  axis: "widthPt" | "heightPt",
  maxMm: number,
) => {
  const after = await lintRenderedFigure(text);
  if (!after.rendered) throw new Error(JSON.stringify(after.diagnostics));
  expect(printedSize(after.rendered.inspection)[axis]).toBeLessThanOrEqual(
    (maxMm * 72) / 25.4 + 1e-6,
  );
  expect(problems(after)).toEqual(problems(before));
};

describe("width hints try the dogfood's levers (#640)", () => {
  test("a legend's perRow, with the gap of the row that then sets the width", async () => {
    const text = fixture("legend-per-row");
    const { report, hint } = await hintOf(text);
    const found = hint.match(
      /set props\.perRow of legend "key" to (\d) \(now unset: all 5 entries on one line\), set figure\.layout\.arrange\.stack\.items\[0\]\.row\.gap to ([\d.]+)mm \(now 4mm\) \(together\) → [\d.]+mm/,
    );
    expect(found).not.toBeNull();
    const [, perRow, gap] = found ?? [];
    // The dogfood's own fix: perRow 3 and a 3mm gap.
    expect(perRow).toBe("3");
    expect(Number(gap)).toBeGreaterThanOrEqual(2);
    await expectFits(
      text
        .replace("flow: row", `flow: row\n      perRow: ${perRow}`)
        .replace("row: {gap: 4mm", `row: {gap: ${gap}mm`),
      report,
      "widthPt",
      88,
    );
  });

  test("a matrix without its frame padding (flush)", async () => {
    const text = fixture("matrix-flush");
    const { report, hint } = await hintOf(text);
    expect(hint).toContain(
      'set props.flush of matrix "tasks" to true (no padding inside its frame) → ',
    );
    await expectFits(
      text.replace("rules: true", "rules: true\n      flush: true"),
      report,
      "widthPt",
      180,
    );
  });

  test("the outermost items of a root place moved inward", async () => {
    const text = fixture("place-coordinates");
    const { report, hint } = await hintOf(text);
    const found = hint.match(
      /move the outermost items of figure\.layout\.arrange\.place inward: "client" x 16 → ([\d.]+), "pool" x 164 → ([\d.]+) \(place\.items\[\]\.at, unit 1mm\) → [\d.]+mm/,
    );
    expect(found).not.toBeNull();
    const [, client, pool] = found ?? [];
    // The first suggestion is the smallest change: only the two outer items move.
    expect(hint.indexOf("move the outermost items")).toBeLessThan(hint.indexOf("close up"));
    await expectFits(
      text
        .replace("at: [16, 60]", `at: [${client}, 60]`)
        .replace("at: [164, 63]", `at: [${pool}, 63]`),
      report,
      "widthPt",
      180,
    );
  });

  test("gaps keep 2mm when that is enough; 0mm only as a last resort", async () => {
    // Pictures keep their size: only the gap can give.
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10"><rect width="20" height="10"/></svg>';
    const row = (gap: string, width: string) => `version: 1
figure:
  id: gaps
  profile: paper-single
  layout: { engine: structured, arrange: { row: { gap: ${gap}, items: [a, b, c, d] } } }
nodes:
${["a", "b", "c", "d"].map((id) => `  - { id: ${id}, component: image, props: { svg: '${svg}', width: ${width} } }`).join("\n")}
`;
    // 3 × 6mm gaps, 8mm too wide: 2mm gaps would remove 12mm, so the value stays above 2mm.
    const kept = await hintOf(row("6mm", "18.5mm"));
    expect(kept.hint).toMatch(
      /set figure\.layout\.arrange\.row\.gap to 3mm \(now 6mm\) → [\d.]+mm\./,
    );
    expect(kept.hint).not.toContain("last resort");
    expect(kept.hint).not.toContain("to 0mm");
    // 3 × 2.5mm gaps, 4mm too wide: only a gap under 2mm fits, the last resort.
    const tight = await hintOf(row("2.5mm", "20.15mm"));
    expect(tight.hint).toMatch(
      /set figure\.layout\.arrange\.row\.gap to 1mm \(now 2\.5mm\) → [\d.]+mm \(last resort: below 2mm between items or 4pt of padding\)/,
    );
  });

  test("the trials stay within the budget", async () => {
    const report = await lintRenderedFigure(fixture("legend-per-row"));
    if (!report.rendered) throw new Error("render failed");
    const context = { ...geometryContextFor(report.rendered), source: fixture("legend-per-row") };
    const tree = explainWidth(context);
    if (!tree) throw new Error("no tree");
    const spy = spyOn(engine, "placeStructured");
    try {
      const result = fitHints(context, tree, context.inspection.canvas.width.pt - 88 * (72 / 25.4));
      expect(result.fits.length).toBe(1);
      expect(result.trials).toBeLessThanOrEqual(MAX_FIT_TRIALS);
      expect(spy.mock.calls.length).toBe(result.trials);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("grown padding is explained (#640)", () => {
  test("--explain-width says the padding grew for a fan from outside, on both sides", async () => {
    const report = await lintRenderedFigure(fixture("padding-growth"));
    if (!report.rendered) throw new Error("render failed");
    const tree = explainWidth(geometryContextFor(report.rendered));
    if (!tree) throw new Error("no tree");
    const line = widthTreeLines(tree).find((l) => l.trimStart().startsWith('* group "post"')) ?? "";
    expect(line).toContain(
      "padding 13pt + 13pt (props.padding 5.5pt, grown automatically by 7.5pt on both sides",
    );
    expect(line).toContain(
      'the arrowheads of edges "to-think", "to-inst", which fan out from one port outside the group to its members, enter through the west side',
    );
    expect(line).toContain("the east side grows as much as the opposite one");
    const json = widthTreeJson(tree);
    const post = json.children[0]?.children.find((c) => c.name === 'group "post"');
    expect(post?.padding?.grown?.westPt).toBe(7.5);
    expect(post?.padding?.grown?.reasons.map((r) => [r.kind, r.side, r.edges])).toEqual([
      ["fan-out", "west", ["to-think", "to-inst"]],
      ["mirrored", "east", []],
    ]);
  });

  test("the width hint names the growth and does not offer the grown padding", async () => {
    const text = fixture("padding-growth")
      .replace("profile: paper-double", "profile: paper-single")
      .replace('label: "Base\\nmodel"', "label: Base model after mid-training");
    const { hint } = await hintOf(text);
    expect(hint).toContain("grown automatically by 7.5pt on both sides");
    expect(hint).not.toContain('props.padding of group "post"');
  });
});

describe("the height hint of a sequence (#640)", () => {
  test("suggests rowGap, bands and icons instead of turning a stack into a row", async () => {
    const text = fixture("sequence-row-gap");
    const { report, hint } = await hintOf(text, "geometry/exceeds-page-height");
    expect(hint).not.toContain("tallest `stack`");
    expect(hint).toContain("Reduce the `rowGap` of the sequence (now 1.94mm");
    expect(hint).toContain("one band row");
    const found = hint.match(
      /set the rowGap of figure\.layout\.arrange\.sequence to ([\d.]+)mm \(now 1\.94mm\) → ([\d.]+)mm tall/,
    );
    expect(found).not.toBeNull();
    expect(Number(found?.[1])).toBeGreaterThanOrEqual(1);
    await expectFits(
      text.replace("participants: [user", `rowGap: ${found?.[1]}mm\n        participants: [user`),
      report,
      "heightPt",
      150,
    );
  });

  test("icons above the labels are named, and the trials stay within the budget", async () => {
    const text = fixture("sequence-row-gap").replace(
      "{id: user, component: box, label: User, weight: bold}",
      "{id: user, component: box, label: User, weight: bold, icon: tabler/user, iconAt: top}",
    );
    const { report, hint } = await hintOf(text, "geometry/exceeds-page-height");
    expect(hint).toContain('`iconAt: left` on "user"');
    if (!report.rendered) throw new Error("render failed");
    const context = { ...geometryContextFor(report.rendered), source: text };
    const spy = spyOn(engine, "placeStructured");
    try {
      sequenceHeightFits(context, printedSize(context.inspection).heightPt - (150 * 72) / 25.4);
      expect(spy.mock.calls.length).toBeLessThanOrEqual(MAX_HEIGHT_TRIALS);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("more levers, applied (#640)", () => {
  test("a matrix's cellWidth", async () => {
    const text = fixture("matrix-flush")
      .replace("rules: true", "rules: true\n      flush: true")
      .replace("cellWidth: 25pt", "cellWidth: 30pt");
    const { report, hint } = await hintOf(text);
    const found = hint.match(
      /set props\.cellWidth of matrix "tasks" to ([\d.]+)pt \(now 30pt, 5 columns\) → [\d.]+mm/,
    );
    expect(found).not.toBeNull();
    await expectFits(
      text.replace("cellWidth: 30pt", `cellWidth: ${found?.[1]}pt`),
      report,
      "widthPt",
      180,
    );
  });

  test("a sequence's participantGap", async () => {
    const text = fixture("sequence-row-gap").replace(
      "participants: [user",
      "participantGap: 18mm\n        participants: [user",
    );
    const { report, hint } = await hintOf(text);
    const found = hint.match(
      /set figure\.layout\.arrange\.sequence\.participantGap to ([\d.]+)mm \(now 18mm\) → [\d.]+mm/,
    );
    expect(found).not.toBeNull();
    expect(Number(found?.[1])).toBeGreaterThanOrEqual(2);
    await expectFits(
      text.replace("participantGap: 18mm", `participantGap: ${found?.[1]}mm`),
      report,
      "widthPt",
      200,
    );
  });
});

describe("the YAML is edited only when it compiles to the rendered figure (#640)", () => {
  test("theme and profile overrides are kept; another source is refused", () => {
    const text = fixture("legend-per-row");
    const compiled = compileFigure(text, {
      overrides: { theme: "paper", profile: "paper-double" },
    });
    if (!compiled.ok) throw new Error("compile failed");
    const { ir } = compiled.value;
    const editor = sourceEditor(ir, text);
    expect(editor).toBeDefined();
    const edited = editor?.((doc) => doc.setIn(["nodes", 3, "props", "perRow"], 2));
    expect(edited?.meta.themeId).toBe("paper");
    expect(edited?.meta.profileId).toBe("paper-double");
    // Same elements, same metadata, another label: not the figure that was rendered.
    const other = text.replace("100 open-ended", "100 open");
    expect(sourceEditor(ir, other)).toBeUndefined();
    expect(sourceEditor(ir, undefined)).toBeUndefined();
  });

  test("with a mismatched source, no legend edit is suggested", async () => {
    const text = fixture("legend-per-row");
    const rendered = await renderFigure(text);
    if (!rendered.ok) throw new Error("render failed");
    const hint = (source: string) =>
      lintGeometry(rendered.value, { source, rules: [exceedsPageWidth] })[0]?.hint ?? "";
    expect(hint(text)).toContain('set props.perRow of legend "key" to 3');
    const other = text.replace("same model", "same LM");
    expect(hint(other)).not.toContain("props.perRow of legend");
  });

  test("an override from the command line still gets the edits", async () => {
    const text = fixture("legend-per-row");
    const rendered = await renderFigure(text, { overrides: { theme: "paper" } });
    if (!rendered.ok) throw new Error("render failed");
    const hint =
      lintGeometry(rendered.value, { source: text, rules: [exceedsPageWidth] })[0]?.hint ?? "";
    expect(hint).toContain('set props.perRow of legend "key"');
  });
});

describe("intent-keeping edits come before any last resort (#640)", () => {
  test("width: a partial edit with a gap of 2mm or more before a gap under 2mm", async () => {
    const text = fixture("last-resort-order");
    const { report, hint } = await hintOf(text);
    const found = hint.match(
      /set props\.perRow of legend "key" to (\d) \(now unset: all 3 entries on one line\), set figure\.layout\.arrange\.row\.gap to ([\d.]+)mm \(now 40mm\) \(together\) → [\d.]+mm/,
    );
    expect(found).not.toBeNull();
    expect(Number(found?.[2])).toBeGreaterThanOrEqual(2);
    expect(hint).not.toContain("last resort");
    await expectFits(
      text
        .replace("flow: row", `flow: row\n      perRow: ${found?.[1]}`)
        .replace("gap: 40mm", `gap: ${found?.[2]}mm`),
      report,
      "widthPt",
      180,
    );
    // The gap alone would fit only below 2mm.
    const alone = await lintRenderedFigure(text.replace("gap: 40mm", "gap: 2mm"));
    if (!alone.rendered) throw new Error("render failed");
    expect(printedSize(alone.rendered.inspection).widthPt).toBeGreaterThan((180 * 72) / 25.4);
  });

  test("height: the second sequence's rowGap before the first one's last resort", async () => {
    const text = fixture("two-sequences");
    const { report, hint } = await hintOf(text, "geometry/exceeds-page-height");
    const found = hint.match(
      /set the rowGap of figure\.layout\.arrange\.stack\.items\[1\]\.sequence to ([\d.]+)mm \(now 1\.94mm\) → [\d.]+mm tall/,
    );
    expect(found).not.toBeNull();
    expect(Number(found?.[1])).toBeGreaterThanOrEqual(1);
    expect(hint).not.toContain("last resort");
    const lines = text.split("\n");
    const at = lines.findIndex((l) => l.includes("participants: [c, d]"));
    lines.splice(at, 0, `              rowGap: ${found?.[1]}mm`);
    await expectFits(lines.join("\n"), report, "heightPt", 150);
  });

  test("height trials count relocatable-node when it is configured as a warning", async () => {
    const text = fixture("sequence-row-gap");
    const report = await lintRenderedFigure(text, {
      config: { rules: { "geometry/relocatable-node": "warning" } },
    });
    const hint =
      report.diagnostics.find((d) => d.code === "geometry/exceeds-page-height")?.hint ?? "";
    // Still verified: the figure has no relocatable node, with or without the rule.
    expect(hint).toContain("set the rowGap of figure.layout.arrange.sequence to");
  });
});
