import { expect, test } from "bun:test";
import { BUILTIN_THEMES } from "../core/theme/builtin";
import { checkRoutes } from "../layout/route/check";
import { lintGeometry } from "../lint";
import { svgToPdf } from "./pdf";
import { svgToEditablePptx, svgToPptx } from "./pptx";
import { renderFigure } from "./render";

for (const form of ["square", "curly"]) {
  for (const points of ["east", "west", "north", "south"]) {
    for (const destination of ["east", "west", "north", "south"]) {
      for (const incoming of [false, true]) {
        test(`${form}/${points}/${destination}/${incoming ? "incoming" : "outgoing"}: fixed painted contact for off-axis and behind endpoints`, async () => {
          const horizontal = destination === "east" || destination === "west";
          const items = ["west", "north"].includes(destination) ? "out, br" : "br, out";
          const result = await renderFigure(`version: 1
figure: { id: off-axis, theme: paper, layout: { arrange: { ${horizontal ? "row" : "stack"}: { gap: 20mm, items: [${items}] } } } }
nodes:
  - { id: br, component: bracket, props: { form: ${form}, points: ${points} } }
  - { id: out, component: box, label: out }
edges:
  - { from: ${incoming ? "out" : "br"}, to: ${incoming ? "br" : "out"} }
`);
          if (!result.ok || !("layout" in result.value)) throw new Error(JSON.stringify(result));
          const { compiled, layout } = result.value;
          expect(result.diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
          expect(Object.values(checkRoutes(compiled.ir, layout)).flat()).toEqual([]);
          const br = layout.nodes.find((n) => n.key === "n:br")?.rect;
          const route = layout.edges[0]?.route?.points;
          if (br === undefined || route === undefined) throw new Error("missing layout");
          const contact = incoming ? route.at(-1) : route[0];
          const next = incoming ? route.at(-2) : route[1];
          const expected = {
            east: { x: br.x + br.width, y: br.y + br.height / 2 },
            west: { x: br.x, y: br.y + br.height / 2 },
            north: { x: br.x + br.width / 2, y: br.y },
            south: { x: br.x + br.width / 2, y: br.y + br.height },
          }[points];
          if (!contact || !next || !expected) throw new Error("missing contact");
          expect(contact.x).toBeCloseTo(expected.x, 2);
          expect(contact.y).toBeCloseTo(expected.y, 2);
          if (points === "east" || points === "west") {
            expect(next.y).toBe(contact.y);
            expect((next.x - contact.x) * (points === "east" ? 1 : -1)).toBeGreaterThan(0);
          } else {
            expect(next.x).toBe(contact.x);
            expect((next.y - contact.y) * (points === "south" ? 1 : -1)).toBeGreaterThan(0);
          }
        });
      }
    }
  }
}

for (const nested of [false, true]) {
  test(`whole-sequence frame reparents cell attachments and reverse-declared chains (${nested ? "nested" : "root"})`, async () => {
    const result = await renderFigure(`version: 1
figure: { id: attached-cells, theme: paper, layout: { arrange: { row: { gap: 20mm, items: [${nested ? "panel" : "seq"}, out] } } } }
${nested ? "groups:\n  - { id: panel, arrange: { row: { items: [seq] } } }" : ""}
nodes:
  - { id: seq, component: tokens, props: { cells: [a, b] } }
  - { id: chain, component: label, label: chain, attach: { to: note, side: south, gap: 2pt } }
  - { id: note, component: label, label: note, attach: { to: seq.1, side: south, gap: 2pt } }
  - { id: out, component: box, label: out }
edges:
  - { from: seq, to: out }
`);
    if (!result.ok || !("layout" in result.value)) throw new Error(JSON.stringify(result));
    expect(result.diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
    const { layout } = result.value;
    for (const id of ["seq-1", "seq-2", "note", "chain"]) {
      expect(layout.nodes.find((n) => n.key === `n:${id}`)?.parent).toBe("g:seq");
    }
    expect(layout.groups.find((g) => g.key === "g:seq")?.parent).toBe(
      nested ? "g:panel" : undefined,
    );
    const note = layout.nodes.find((n) => n.key === "n:note")?.rect;
    const chain = layout.nodes.find((n) => n.key === "n:chain")?.rect;
    if (!note || !chain) throw new Error("missing attachments");
    expect(chain.y).toBeGreaterThan(note.y + note.height);
  });
}

/** A whole token column with a bracket attached to it (#281) and an edge from the bracket to a box. */
const source = (theme: string, form: string, points: string) => {
  const side = points;
  const horizontal = points === "east" || points === "west";
  return `version: 1
figure:
  id: bracket
  theme: ${theme}
  profile: paper-double
  layout:
    arrange: { ${horizontal ? "row" : "stack"}: { gap: 18mm, items: [${points === "west" || points === "north" ? "out, seq" : "seq, out"}] } }
nodes:
  - { id: seq, component: tokens, props: { direction: ${horizontal ? "down" : "right"}, gap: 0, width: 40pt, height: 22pt, cells: [a, b, c] } }
  - { id: br, component: bracket, attach: { to: seq, side: ${side}, gap: 2pt }, props: { form: ${form}, points: ${points} } }
  - { id: out, component: box, label: out }
edges:
  - { from: br, to: out }
`;
};

for (const theme of BUILTIN_THEMES.keys()) {
  for (const form of ["square", "curly"]) {
    for (const points of ["east", "west", "north", "south"]) {
      test(`${theme}/${form}/${points}: drawn as an open line, an edge leaves from the spine's middle, every format renders`, async () => {
        const result = await renderFigure(source(theme, form, points));
        if (!result.ok || !("layout" in result.value)) throw new Error(JSON.stringify(result));
        const { compiled, layout, svg } = result.value;
        expect(result.diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
        expect(lintGeometry(result.value).filter((d) => d.severity !== "info")).toEqual([]);
        expect(Object.values(checkRoutes(compiled.ir, layout)).flat()).toEqual([]);

        const seq = layout.groups.find((g) => g.key === "g:seq")?.rect;
        const br = layout.nodes.find((n) => n.key === "n:br")?.rect;
        if (seq === undefined || br === undefined) throw new Error("missing layout");
        const horizontal = points === "east" || points === "west";
        // Spans the sequence's side, and leaves its own depth.
        expect(horizontal ? [br.y, br.height] : [br.x, br.width]).toEqual(
          horizontal ? [seq.y, seq.height] : [seq.x, seq.width],
        );

        // The route starts on the bracket's outer side, in the middle (the tip of a brace).
        const start = layout.edges[0]?.route?.points[0];
        const middle = {
          east: { x: br.x + br.width, y: br.y + br.height / 2 },
          west: { x: br.x, y: br.y + br.height / 2 },
          south: { x: br.x + br.width / 2, y: br.y + br.height },
          north: { x: br.x + br.width / 2, y: br.y },
        }[points] as { x: number; y: number };
        expect(Math.abs((start?.x ?? NaN) - middle.x)).toBeLessThan(0.01);
        expect(Math.abs((start?.y ?? NaN) - middle.y)).toBeLessThan(0.01);

        // One unfilled path for the bracket (no polygon, no rect for its body).
        const shape =
          svg.match(/<g class="sumi-k-n--br sumi-kind-node"><g class="shape">(.*?)<\/g>/)?.[1] ??
          "";
        expect(shape).toMatch(/<path d="M [^"]+" fill="none"/);
        expect(shape).not.toContain("<rect");

        expect(svgToPdf(svg).ok).toBe(true);
        expect(svgToPptx(svg).ok).toBe(true);
        for (const connectors of ["freeform", "glued"] as const) {
          const pptx = svgToEditablePptx(svg, compiled.ir, { connectors });
          if (!pptx.ok) throw new Error(JSON.stringify(pptx.diagnostics));
        }
      });
    }
  }
}

test("a whole token sequence as an edge endpoint meets its frame, not a cell", async () => {
  const result = await renderFigure(`version: 1
figure: { id: whole, theme: paper, layout: { arrange: { row: { gap: 20mm, items: [enc, seq] } } } }
nodes:
  - { id: enc, component: box, label: Encoder }
  - { id: seq, component: tokens, props: { gap: 0, width: 40pt, height: 22pt, cells: [a, b, c, d] } }
edges:
  - { from: enc, to: seq, toAnchor: west }
`);
  if (!result.ok || !("layout" in result.value)) throw new Error(JSON.stringify(result));
  const { layout } = result.value;
  expect(result.diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
  const frame = layout.groups.find((g) => g.key === "g:seq")?.rect;
  const end = layout.edges[0]?.route?.points.at(-1);
  if (frame === undefined || end === undefined) throw new Error("missing layout");
  // The frame is exactly the cells: its left side is the first cell's.
  const first = layout.nodes.find((n) => n.key === "n:seq-1")?.rect;
  if (first === undefined) throw new Error("missing cell");
  expect(frame.x).toBe(first.x);
  expect(end.x).toBeCloseTo(frame.x, 2);
  expect(end.y).toBeCloseTo(frame.y + frame.height / 2, 2);
});
