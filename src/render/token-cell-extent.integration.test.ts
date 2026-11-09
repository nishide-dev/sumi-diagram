import { describe, expect, test } from "bun:test";
import { renderFigure } from "./render";

/** The painted extent of a cell's rect: its box plus half a stroke on every side. */
function painted(svg: string, id: string) {
  const group = svg.match(
    new RegExp(`class="sumi-k-n--${id} [^"]*"><g class="shape">(<rect[^>]*>)`),
  );
  if (group?.[1] === undefined) throw new Error(`no rect for ${id}`);
  const attr = (name: string) => Number(group[1]?.match(new RegExp(`${name}="([\\d.]+)"`))?.[1]);
  const stroke = group[1].includes('stroke="none"') ? 0 : attr("stroke-width");
  return {
    left: attr("x") - stroke / 2,
    top: attr("y") - stroke / 2,
    width: attr("width") + stroke,
    height: attr("height") + stroke,
  };
}

describe("tokens cells of different variants (#421)", () => {
  for (const theme of ["paper", "color", "minimal", "llama"]) {
    test(`${theme}: a solid cell is painted as large as a filled one`, async () => {
      const source = `version: 1
figure:
  id: cells
  theme: ${theme}
  layout: { arrange: { row: { items: [seq] } } }
nodes:
  - id: seq
    component: tokens
    props:
      gap: 0
      width: 16.5pt
      height: 9pt
      variant: filled
      cells: [{ id: a, tone: blue, variant: solid }, { id: b, tone: orange }, { id: c, tone: gray, variant: solid }, { id: d, tone: green }]
`;
      const rendered = await renderFigure(source);
      if (!rendered.ok) throw new Error(JSON.stringify(rendered.diagnostics));
      const cells = ["seq-a", "seq-b", "seq-c", "seq-d"].map((id) =>
        painted(rendered.value.svg, id),
      );
      for (const cell of cells) {
        expect(cell.width).toBe(cells[0]?.width as number);
        expect(cell.height).toBe(cells[0]?.height as number);
        expect(cell.top).toBe(cells[0]?.top as number);
      }
      // Neighbours meet exactly: no overlap and no gap.
      cells.slice(1).forEach((cell, i) => {
        const before = cells[i];
        expect(cell.left).toBeCloseTo((before?.left ?? 0) + (before?.width ?? 0), 6);
      });
    });
  }
});
