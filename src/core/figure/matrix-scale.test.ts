import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { buildFigureIR, type NodeIR } from "../../compiler/ir";
import { muddyColor, muddyFindings } from "../../lint/geometry/color-composition";
import { colorHarmony } from "../../lint/geometry/color-harmony";
import { colorUseOf, themeColorUse } from "../../lint/geometry/color-use";
import type { Analysis } from "../../lint/geometry/composite";
import { geometryContextFor } from "../../lint/geometry/lint";
import { renderFigure } from "../../render";
import { checkFigure } from "../check";
import { nodeKey } from "../check-state";
import { matrixGrid } from "../registry/builtins";
import { BUILTIN_THEMES, getTheme } from "../theme/builtin";
import { contrastRatio } from "../theme/node-variants";
import { rampColor, rampInk } from "../theme/ramp";
import { toneRamp } from "../theme/resolve";
import { TONE_NAMES } from "../theme/tones";
import { formatScaleValue, scaleStep } from "./matrix";

/** A structured figure with the matrix `m` (props as YAML lines) and the legend `key`. */
const figure = (props: string, options: { key?: string; theme?: string } = {}) =>
  `version: 1
figure:
  id: f
  theme: ${options.theme ?? "sumi"}
  layout:
    arrange: { stack: { items: [m, key] } }
nodes:
  - id: m
    component: matrix
    props:
${props}
  - id: key
    component: legend
    props:
      entries:
${options.key ?? "        - { scale: m }"}
`;

const SCALE = `      columns: [Alpha, Beta, Gamma]
      cellWidth: 20pt
      cellHeight: 12pt
      gap: 1pt
      scale: { from: 0, to: 10, tone: orange, decimals: 1, label: score }
      classes:
        n: { variant: muted, label: none }
      cells:
        - [{ value: 0 }, { value: 5 }, { value: 10 }]
        - [{ value: -3 }, { value: 12, text: high }, n]`;

const codesOf = (source: string) =>
  checkFigure(source).state.diagnostics.map((d) => [d.code, d.path]);

describe("color scales (#644)", () => {
  test("a value cell is a filled cell of the scale's tone, showing its value", () => {
    const { state } = checkFigure(figure(SCALE));
    expect(state.diagnostics).toEqual([]);
    const node = (id: string) => state.doc.nodes?.find((n) => n?.id === id);
    expect(node("m-1-2")).toMatchObject({ label: "5.0", tone: "orange", variant: "filled" });
    expect(node("m-2-2")?.label).toBe("high");
    expect(node("m-2-3")).toMatchObject({ variant: "muted", label: "" });
    // Clamped at both ends, linear in between.
    const ramp = (id: string) => state.doc.paints?.get(nodeKey(id))?.ramp;
    expect([ramp("m-1-1"), ramp("m-1-2"), ramp("m-1-3"), ramp("m-2-1"), ramp("m-2-2")]).toEqual([
      0, 0.5, 1, 0, 1,
    ]);
    expect(ramp("m-2-3")).toBeUndefined();
    // The IR marks the painted steps; class cells are not.
    const ir = buildFigureIR(checkFigure(figure(SCALE)));
    expect((ir.elements.get(nodeKey("m-1-2")) as NodeIR).scaleStep).toBe(true);
    expect((ir.elements.get(nodeKey("m-2-3")) as NodeIR).scaleStep).toBeUndefined();
  });

  test("steps, decimals, a reversed range and showValues", () => {
    expect(
      [0, 2.4, 2.5, 7.4, 9.99, 10].map((v) => scaleStep(v, { from: 0, to: 10, steps: 4 })),
    ).toEqual([0, 0, 1 / 3, 2 / 3, 1, 1]);
    expect(scaleStep(2, { from: 10, to: 0 })).toBeCloseTo(0.8);
    expect(formatScaleValue(75, { decimals: 1 })).toBe("75.0");
    expect(formatScaleValue(75.25, {})).toBe("75.25");
    const { state } = checkFigure(
      figure(SCALE.replace("label: score }", "label: score, showValues: false }")),
    );
    expect(state.doc.nodes?.find((n) => n?.id === "m-1-2")?.label).toBe("");
    expect(state.doc.nodes?.find((n) => n?.id === "m-2-2")?.label).toBe("high");
  });

  test("a step's fill runs from the pale end to the strong end, its text always readable", () => {
    for (const [id, theme] of BUILTIN_THEMES) {
      const { state } = checkFigure(figure(SCALE, { theme: id }));
      expect(state.diagnostics).toEqual([]);
      const ends = toneRamp(theme, "orange");
      const style = (cell: string) => state.styles?.get(nodeKey(cell));
      expect(style("m-1-1")?.fill).toBe(ends.low);
      expect(style("m-1-3")?.fill).toBe(ends.high);
      expect(style("m-1-2")?.fill).toBe(rampColor(ends.low, ends.high, 0.5));
      // Every step of every tone: the fill is the ramp's, the ink the first of the theme's two
      // inks that keeps 4.5:1 (or a nearer readable one), and the text always keeps 4.5:1.
      const steps = Array.from({ length: 21 }, (_, k) => k / 2);
      const row = steps.map((v) => `{ value: ${v} }`).join(", ");
      for (const tone of TONE_NAMES) {
        const toneEnds = toneRamp(theme, tone);
        const cells = checkFigure(
          figure(
            `      scale: { from: 0, to: 10, tone: ${tone} }\n      cells:\n        - [${row}]`,
            { theme: id },
          ),
        ).state;
        expect(cells.diagnostics).toEqual([]);
        for (const [k, v] of steps.entries()) {
          const cell = cells.styles?.get(nodeKey(`m-1-${k + 1}`));
          const fill = rampColor(toneEnds.low, toneEnds.high, v / 10);
          expect(cell?.fill, `${id} ${tone} ${v}`).toBe(fill);
          expect(cell?.fontColor).toBe(rampInk(toneEnds, fill));
          const readable = [toneEnds.ink, toneEnds.inverse].find(
            (ink) => contrastRatio(ink, fill) >= 4.5,
          );
          if (readable !== undefined) expect(cell?.fontColor).toBe(readable);
          expect(
            contrastRatio(cell?.fontColor ?? "", fill),
            `${id} ${tone} ${v}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  test("classes are optional with a scale; a value needs a scale, and a cell one of class or value", () => {
    const noClasses = SCALE.replace(
      "      classes:\n        n: { variant: muted, label: none }\n",
      "",
    ).replace(", n]", ", { value: 1 }]");
    expect(codesOf(figure(noClasses))).toEqual([]);
    expect(codesOf(figure(SCALE.replace(/ {6}scale: .*\n/, "")))).toContainEqual([
      "component/invalid-prop",
      ["nodes", 0, "props", "cells", 0, 0, "value"],
    ]);
    expect(codesOf(figure(SCALE.replace("{ value: 0 }", "{ value: 0, class: n }")))).toContainEqual(
      ["component/invalid-prop", ["nodes", 0, "props", "cells", 0, 0, "value"]],
    );
    expect(codesOf(figure(SCALE.replace("from: 0, to: 10", "from: 3, to: 3")))).toContainEqual([
      "component/invalid-prop",
      ["nodes", 0, "props", "scale", "to"],
    ]);
  });

  test("a legend's scale entry: a strip of steps between the two end values", () => {
    const { state } = checkFigure(figure(SCALE));
    const node = (id: string) => state.doc.nodes?.find((n) => n?.id === id);
    expect(node("key-1-low")?.label).toBe("0.0");
    expect(node("key-1-high")?.label).toBe("10.0");
    expect(node("key-1-label")?.label).toBe("score");
    const steps = [1, 2, 3, 4, 5].map((k) => state.doc.paints?.get(nodeKey(`key-1-step-${k}`)));
    expect(steps.map((p) => p?.ramp)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(node("key-1-step-6")).toBeUndefined();
    // The samples are drawn as the cells at those steps.
    expect(state.styles?.get(nodeKey("key-1-step-5"))?.fill).toBe(
      state.styles?.get(nodeKey("m-1-3"))?.fill,
    );
    // A stepped scale: one sample per step; without any label, the strip alone.
    const stepped = checkFigure(figure(SCALE.replace(", label: score }", ", steps: 3 }"))).state;
    expect(stepped.diagnostics).toEqual([]);
    expect(stepped.doc.nodes?.some((n) => n?.id === "key-1-step-3")).toBe(true);
    expect(stepped.doc.nodes?.some((n) => n?.id === "key-1-step-4")).toBe(false);
    expect(stepped.doc.nodes?.some((n) => n?.id === "key-1-label")).toBe(false);
  });

  test("a scale entry names a matrix with a scale", () => {
    expect(codesOf(figure(SCALE, { key: "        - { scale: nope }" }))).toContainEqual([
      "ref/unknown-scale",
      ["nodes", 1, "props", "entries", 0, "scale"],
    ]);
    const unscaled = SCALE.replace(/ {6}scale: .*\n/, "").replace(
      /cells:\n.*\n.*/,
      "cells: [n]\n      columns: [Alpha]",
    );
    expect(
      codesOf(figure(unscaled.replace("      columns: [Alpha, Beta, Gamma]\n", ""))),
    ).toContainEqual(["ref/unknown-scale", ["nodes", 1, "props", "entries", 0, "scale"]]);
  });
});

describe("merged cells (#644)", () => {
  test("the grid places merged cells as an HTML table", () => {
    const { slots, width, problems } = matrixGrid(
      [[{ class: "a", span: { rows: 2, columns: 2 } }, "b"], ["c"], ["a", { class: "b", span: 2 }]],
      ["a", "b", "c"],
    );
    expect(problems).toEqual([]);
    expect(width).toBe(3);
    expect(slots.map((row) => row.map((s) => [s.row, s.column, s.rows, s.columns]))).toEqual([
      [
        [0, 0, 2, 2],
        [0, 2, 1, 1],
      ],
      [[1, 2, 1, 1]],
      [
        [2, 0, 1, 1],
        [2, 1, 1, 2],
      ],
    ]);
    const wrong = matrixGrid(
      [
        [{ class: "a", span: { rows: 3 } }, "b"],
        ["a", "b"],
      ],
      ["a", "b"],
    );
    expect(wrong.problems.map((p) => p.message)).toEqual([
      "cell 1 of row 1 spans 3 rows, past the last row",
      "row 2 has 3 cells, but row 1 has 2",
    ]);
  });

  test("a row covered by merged cells from above is written empty; a hole is reported", () => {
    const covered = matrixGrid(
      [[{ class: "a", span: { rows: 2, columns: 2 } }], [], ["a", "a"]],
      ["a"],
    );
    expect(covered.problems).toEqual([]);
    expect(covered.width).toBe(2);
    expect(covered.slots[1]).toEqual([]);
    // A slot left empty before a cell merged from above (the row's width alone looks right).
    const hole = matrixGrid([["a", "a", { class: "a", span: { rows: 2 } }], ["a"]], ["a"]);
    expect(hole.problems.map((p) => p.message)).toEqual([
      "row 2 leaves column 2 empty before a merged cell from a row above",
    ]);
    // An empty row nothing covers.
    expect(matrixGrid([["a"], []], ["a"]).problems.map((p) => p.message)).toEqual([
      "row 2 has no cells",
    ]);
    // Through the schema and the expansion: the covered row has its header and no cells.
    const props = `      rows: [R1, R2, R3]
      classes:
        a: { label: a }
      cells:
        - [{ class: a, span: { rows: 2, columns: 2 } }]
        - []
        - [a, a]`;
    const { state } = checkFigure(figure(props, { key: "        - { class: m.a }" }));
    expect(state.diagnostics).toEqual([]);
    expect(state.doc.nodes?.some((n) => n?.id.startsWith("m-2-"))).toBe(false);
    expect(state.doc.nodes?.some((n) => n?.id === "m-row-2")).toBe(true);
    // Partly covered: the row still has to write its other slots.
    const partly = props.replace(
      "- [{ class: a, span: { rows: 2, columns: 2 } }]",
      "- [{ class: a, span: { rows: 2 } }, a]",
    );
    expect(codesOf(figure(partly, { key: "        - { class: m.a }" }))).toContainEqual([
      "component/invalid-prop",
      ["nodes", 0, "props", "cells", 1],
    ]);
  });

  test("a merged cell covers its slots and the gaps between them", () => {
    const props = `      rows: [R1, R2, R3]
      columns: [A, B, C]
      cellWidth: 20pt
      cellHeight: 10pt
      gap: 2pt
      classes:
        a: { label: a }
      cells:
        - [{ class: a, span: { rows: 2, columns: 2 }, text: merged }, a]
        - [a]
        - [a, { class: a, span: 2 }]`;
    const { state } = checkFigure(figure(props, { key: "        - { class: m.a }" }));
    expect(state.diagnostics).toEqual([]);
    const node = (id: string) => state.doc.nodes?.find((n) => n?.id === id);
    const props_ = (id: string) => state.components?.get(nodeKey(id))?.props;
    expect(node("m-1-1")?.label).toBe("merged");
    expect(props_("m-1-1")).toEqual({ width: 42, height: 22 });
    expect(node("m-2-3")).toBeDefined();
    expect(node("m-2-1")).toBeUndefined();
    expect(props_("m-3-2")).toEqual({ width: 42, height: 10 });
    // Every cell at its slot: the merged cells' centers sit between the slots they cover.
    const frame = state.doc.groups?.find((g) => g?.id === "m");
    const place = JSON.stringify(frame?.arrange);
    expect(place).toContain('"place"');
    expect(place).toContain('{"item":"m-1-1","at":[42,22]}');
    expect(place).toContain('{"item":"m-3-2","at":[86,58]}');
    // Rows and columns stay where the unmerged ones would be.
    const ir = buildFigureIR(checkFigure(figure(props, { key: "        - { class: m.a }" })));
    expect(ir.elements.get(nodeKey("m-1-1"))?.kind).toBe("node");
  });

  test("spans are checked where they are written", () => {
    const base = `      columns: [A, B]
      classes:
        a: { label: a }
      cells:`;
    expect(
      codesOf(
        figure(`${base}\n        - [{ class: a, span: 3 }]\n        - [a, a]`, {
          key: "        - { class: m.a }",
        }),
      ),
    ).toContainEqual(["component/invalid-prop", ["nodes", 0, "props", "cells", 1]]);
    expect(
      codesOf(
        figure(
          `${base}\n        - [a, { class: a, span: { rows: 2 } }]\n        - [{ class: a, span: 2 }]`,
          {
            key: "        - { class: m.a }",
          },
        ),
      ),
    ).toContainEqual(["component/invalid-prop", ["nodes", 0, "props", "cells", 1, 0, "span"]]);
    expect(
      codesOf(
        figure(
          `${base}\n        - [{ class: a, span: 2 }]\n        - [a, a]\n      ellipsisColumns: [2]`,
          {
            key: "        - { class: m.a }",
          },
        ),
      ),
    ).toContainEqual(["component/invalid-prop", ["nodes", 0, "props", "cells", 0, 0, "span"]]);
  });
});

describe("turned column headers (#644)", () => {
  const props = `      rows: [One, Two]
      columns: [A long name, Short]
      headerRotate: -90
      classes:
        a: { label: a }
      cells: [aa, aa]`;

  test("column headers are labels turned by headerRotate, lined up on the cells' side", () => {
    const { state } = checkFigure(figure(props, { key: "        - { class: m.a }" }));
    expect(state.diagnostics).toEqual([]);
    const header = state.doc.nodes?.find((n) => n?.id === "m-col-1");
    expect(header?.labelRotation).toBe(-90);
    expect(state.doc.nodes?.find((n) => n?.id === "m-row-1")?.labelRotation).toBeUndefined();
    const frame = state.doc.groups?.find((g) => g?.id === "m");
    expect(JSON.stringify(frame?.arrange)).toContain(
      '{"row":{"direction":"right","gap":0,"align":"end","items":["m-col-1","m-col-2"]}}',
    );
    // Each header is as wide as its column and as tall as its turned text.
    const ir = buildFigureIR(checkFigure(figure(props, { key: "        - { class: m.a }" })));
    expect((ir.elements.get(nodeKey("m-col-1")) as NodeIR).labelRotation).toBe(-90);
  });

  test("headerRotate needs columns", () => {
    expect(
      codesOf(
        figure(props.replace("      columns: [A long name, Short]\n", ""), {
          key: "        - { class: m.a }",
        }),
      ),
    ).toContainEqual(["component/invalid-prop", ["nodes", 0, "props", "headerRotate"]]);
  });
});

describe("legend samples of a ruled matrix (#644)", () => {
  const props = `      rules: true
      classes:
        f: { variant: filled, label: filled }
        m: { variant: muted, label: muted }
        h: { variant: muted, pattern: hatch, label: hatched }
        e: { label: empty }
      cells:
        - [f, { class: m, text: "0.5" }, h, e]`;
  const key = `        - { class: m.f }
        - { class: m.m }
        - { class: m.h }
        - { class: m.e }`;

  test("samples have no border, as the cells; cells without a fill are shown by their text", () => {
    const { state } = checkFigure(figure(props, { key }));
    expect(state.diagnostics).toEqual([]);
    const style = (id: string) => state.styles?.get(nodeKey(id));
    expect(style("key-1-box")?.strokeWidth.units).toBe(0);
    expect(style("key-3-box")?.strokeWidth.units).toBe(0);
    // A pale cell with no fill: the sample is its text, pale as the cell's.
    const muted = state.doc.nodes?.find((n) => n?.id === "key-2-box");
    expect(muted?.label).toBe("0.5");
    expect(style("key-2-box")?.strokeWidth.units).toBe(0);
    expect(style("key-2-box")?.fontColor).toBe(style("m-1-2")?.fontColor);
    // Neither fill nor text: nothing would be seen, so the sample keeps its border.
    expect(style("key-4-box")?.strokeWidth.units).toBeGreaterThan(0);
  });
});

describe("color lints of a scale (#644)", () => {
  const source = readFileSync(
    new URL(
      "../../../skills/sumi/examples/transfer-heatmap/transfer-heatmap.sumi.yaml",
      import.meta.url,
    ),
    "utf8",
  );

  test("the scale is one accent, not a block of color; its steps are no clash and no mud", async () => {
    for (const theme of ["sumi", "sumi-dark", "paper"]) {
      const result = await renderFigure(source.replace("theme: sumi", `theme: ${theme}`));
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
      const context = geometryContextFor(result.value);
      const use = colorUseOf(
        context.elements,
        { heavyVariants: ["filled", "solid"] },
        getTheme(theme),
      );
      expect(use.accents.map((a) => a.tone)).toEqual(["blue"]);
      expect(use.heavy).toEqual([]);
      for (const rule of [themeColorUse, colorHarmony, muddyColor])
        expect(rule.run(context, undefined), `${theme} ${rule.id}`).toEqual([]);
    }
    // An orange scale passes through ochre on a dark canvas: the steps are not muddy fills.
    const orange = await renderFigure(
      source.replace("theme: sumi", "theme: sumi-dark").replace("tone: blue", "tone: orange"),
    );
    if (!orange.ok) throw new Error(JSON.stringify(orange.diagnostics));
    expect(muddyColor.run(geometryContextFor(orange.value), undefined)).toEqual([]);
  });
});

describe("muddy colors over a scale (#644)", () => {
  const step = "#e8bfa2"; // an orange step in sumi-dark: ochre by geometry/muddy-color's measure
  const analysis = (final: string) =>
    ({
      item: {
        key: "n:m-1-1",
        kind: "node",
        name: 'node "m-1-1" fill',
        color: step,
        alpha: 1,
        ink: step,
        docPath: ["nodes", 0],
        subject: { kind: "node", id: "m" },
      },
      canvas: "#30364f",
      index: 0,
      onWhite: step,
      samples: Array.from({ length: 4 }, () => ({
        final,
        below: "#30364f",
        under: [],
        panel: "#30364f",
      })),
    }) as unknown as Analysis;

  test("a step's own color is accepted, a translucent fill over it is still reported", () => {
    const own = () => true;
    expect(muddyFindings([analysis(step)])).toHaveLength(1);
    expect(muddyFindings([analysis(step)], own)).toEqual([]);
    expect(muddyFindings([analysis("#7d7468")], own)).toHaveLength(1);
  });
});
