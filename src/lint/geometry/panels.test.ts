/** `geometry/panel-misaligned` (#641): panels side by side whose frames or titles do not line up. */
// The lint config first: content-band → trial → config → rules is a cycle that must be entered at config.
import "../config";
import { describe, expect, test } from "bun:test";
import { type RenderedStructuredFigure, renderFigure } from "../../render/render";
import { lintGeometry } from "./lint";
import { PANEL_MISALIGNED } from "./panels";

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
      "Write panels: true in figure.layout.arrange.row (row: {panels: true, items: [a, b]})",
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
});
