/** `geometry/panel-misaligned` (#641): panels side by side whose frames or titles do not line up. */
// The lint config first: content-band → trial → config → rules is a cycle that must be entered at config.
import "../config";
import { describe, expect, test } from "bun:test";
import type { GroupIR } from "../../compiler/ir";
import { type RenderedStructuredFigure, renderFigure } from "../../render/render";
import { lintGeometry } from "./lint";
import { framed, MIN_PANEL_OFFSET, misalignedParts, PANEL_MISALIGNED } from "./panels";

function figure(row: string, extra = "") {
  return `version: 1
figure:
  id: panel-misaligned
  profile: paper-double
  layout:
    arrange:
      row: {gap: 4mm, ${row} items: [a, b]}
groups:
  - id: a
    label: (a) Short
    labelAt: above-left
    ${extra}
    arrange: {stack: {items: [a1, a2]}}
  - id: b
    label: (b) Tall
    labelAt: above-left
    arrange: {stack: {items: [b1, b2, b3, b4]}}
nodes:
  - {id: a1, component: box, label: Input}
  - {id: a2, component: box, label: Encoder}
  - {id: b1, component: box, label: One}
  - {id: b2, component: box, label: Two}
  - {id: b3, component: box, label: Three}
  - {id: b4, component: box, label: Four}
edges:
  - {from: a1, to: a2}
`;
}

async function misaligned(source: string) {
  const result = await renderFigure(source);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  const rendered = result.value as RenderedStructuredFigure;
  return lintGeometry(rendered, { source }).filter((d) => d.code === PANEL_MISALIGNED);
}

describe("geometry/panel-misaligned", () => {
  test("reports a centred row of panels of different heights with the row's panels: true", async () => {
    const found = await misaligned(figure(""));
    expect(found).toHaveLength(1);
    const [d] = found;
    expect(d?.severity).toBe("info");
    expect(d?.path).toEqual(["figure", "layout", "arrange", "row"]);
    expect(d?.message).toMatch(
      /^The panels side by side in figure\.layout\.arrange\.row \(group "a", group "b"\) are not aligned: frame tops \d+\.\dmm apart, frame bottoms \d+\.\dmm apart, titles \d+\.\dmm apart\.$/,
    );
    expect(d?.hint).toStartWith(
      "Add panels: true to the row at figure.layout.arrange.row (its other fields stay):",
    );
  });

  test("bottoms count too: align: start lines up the tops only", async () => {
    const [d] = await misaligned(figure("align: start,"));
    expect(d?.message).toMatch(/not aligned: frame bottoms \d+\.\dmm apart\.$/);
  });

  test("silent with panels: true and with align: stretch", async () => {
    expect(await misaligned(figure("panels: true,"))).toEqual([]);
    expect(await misaligned(figure("align: stretch,"))).toEqual([]);
  });

  /** Two framed panels in an `align: start` row whose bodies are `a` and `b` tall. */
  const heights = (a: string, b: string, extra = "") => `version: 1
figure:
  id: panel-threshold
  profile: paper-double
  layout:
    arrange:
      row: {gap: 4mm, align: start, items: [a, b]}
groups:
  - {id: a, label: (a), ${extra} arrange: {stack: {items: [x]}}}
  - {id: b, label: (b), ${extra} arrange: {stack: {items: [y]}}}
nodes:
  - {id: x, component: box, label: X, props: {height: ${a}}}
  - {id: y, component: box, label: Y, props: {height: ${b}}}
`;

  test("offsets under 1mm are not reported, 1mm and more are", async () => {
    expect(await misaligned(heights("10mm", "10.5mm"))).toEqual([]);
    const [d] = await misaligned(heights("10mm", "11.5mm"));
    expect(d?.message).toMatch(/frame bottoms 1\.\dmm apart\.$/);
  });

  test("frames that are not drawn (plain) are not compared", async () => {
    expect(await misaligned(heights("10mm", "20mm", "variant: plain,"))).toEqual([]);
  });

  test("captions of panels at different heights are reported", async () => {
    const source = figure("")
      .replace("    label: (a) Short\n    labelAt: above-left\n", "    caption: (a) Short\n")
      .replace("    label: (b) Tall\n    labelAt: above-left\n", "    caption: (b) Tall\n");
    const [d] = await misaligned(source);
    expect(d?.message).toMatch(/captions \d+\.\dmm apart/);
  });

  test("a legend, tokens or matrix beside a panel is not a panel", async () => {
    const source = `version: 1
figure:
  id: panel-excluded
  profile: paper-double
  layout:
    arrange:
      row: {gap: 4mm, items: [a, key, seq]}
groups:
  - {id: a, label: (a), arrange: {stack: {items: [x, y, z]}}}
nodes:
  - {id: x, component: box, label: X}
  - {id: y, component: box, label: Y}
  - {id: z, component: box, label: Z}
  - id: key
    component: legend
    props:
      entries:
        - {node: {component: box}, label: a step}
  - {id: seq, component: tokens, props: {cells: [a, b, c]}}
`;
    expect(await misaligned(source)).toEqual([]);
  });

  test("the 1mm threshold is inclusive", () => {
    const at = (value: number) =>
      misalignedParts({ tops: value, bottoms: 0, titles: value, captions: 0 }, MIN_PANEL_OFFSET);
    expect(at(MIN_PANEL_OFFSET)).toEqual(["tops", "titles"]);
    expect(at(MIN_PANEL_OFFSET - 1e-9)).toEqual([]);
  });

  test("a frame with opacity 0 is not drawn", () => {
    const style = (opacity: number) =>
      ({
        style: { stroke: "#000000", strokeWidth: { units: 1 }, fill: "transparent", opacity },
      }) as unknown as GroupIR;
    expect(framed(style(1))).toBe(true);
    expect(framed(style(0))).toBe(false);
  });

  test("a matrix beside a panel is not a panel", async () => {
    const source = `version: 1
figure:
  id: panel-matrix
  profile: paper-double
  layout:
    arrange:
      row: {gap: 4mm, items: [a, grid]}
groups:
  - {id: a, label: (a), arrange: {stack: {items: [x, y, z]}}}
nodes:
  - {id: x, component: box, label: X}
  - {id: y, component: box, label: Y}
  - {id: z, component: box, label: Z}
  - id: grid
    component: matrix
    props:
      columns: [P, Q]
      rows: [P, Q]
      classes:
        h: {variant: default, label: high}
        l: {variant: muted, label: low}
      cells: [hl, lh]
`;
    expect(await misaligned(source)).toEqual([]);
  });
});
