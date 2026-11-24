/**
 * Edge origins and label ownership (#642, design record
 * `docs/design/decisions/642-block-anchor.md`), through `renderFigure`
 * (structured only, no D2): `block` ends with their bracket, side anchors on
 * a group, `geometry/edge-label-ambiguous` and the span advice of
 * `geometry/edge-label-detached`.
 */

import { describe, expect, test } from "bun:test";
import { checkFigure } from "../core/check";
import { parseBlockAnchor } from "../core/figure/layout";
import { ANCHOR_PATTERN } from "../core/figure/schema";
import { BRACKET_ROOM } from "../layout/block-bracket";
import type { EdgeLayout, Rect } from "../layout/ir";
import {
  AMBIGUOUS_RATIO,
  EDGE_LABEL_AMBIGUOUS,
  EDGE_LABEL_DETACHED,
  edgeLabelAmbiguous,
  geometryContextFor,
  inkLines,
  lintGeometry,
} from "../lint/geometry";
import { type RenderedStructuredFigure, renderFigure } from "./render";

async function render(source: string) {
  const result = await renderFigure(source);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  return result.value as RenderedStructuredFigure;
}

const edgeOf = (r: RenderedStructuredFigure, i: number): EdgeLayout => {
  const e = r.layout.edges.find((x) => x.key === r.compiled.ir.edges[i]?.key);
  if (e?.route === undefined) throw new Error(`edge ${i} is not routed`);
  return e;
};
const rectOf = (r: RenderedStructuredFigure, id: string): Rect => {
  const found = [...r.layout.nodes, ...r.layout.groups].find((e) => e.key.endsWith(`:${id}`));
  if (found === undefined) throw new Error(`no ${id}`);
  return found.rect;
};

const tokens = (anchor: string) => `version: 1
figure:
  id: block-ends
  theme: sumi
  profile: paper-double
  layout:
    arrange:
      stack:
        gap: 8mm
        items: [dec, {row: {gap: 8mm, items: [query, feat]}}]
nodes:
  - {id: dec, component: box, label: Decoder}
  - id: query
    component: tokens
    props: {width: 6mm, gap: 1pt, cells: [u, v, t, s, c]}
  - id: feat
    component: tokens
    props: {direction: down, width: 4mm, height: 3mm, gap: 1pt, cells: ['', '', '']}
edges:
  - {from: query, to: dec${anchor}}
  - {from: feat, to: dec}
`;

describe("block anchors (#642)", () => {
  test("parses block and block:<side>, and the schema pattern accepts them", () => {
    expect(parseBlockAnchor("block")).toEqual({});
    expect(parseBlockAnchor("block:east")).toEqual({ side: "east" });
    expect(parseBlockAnchor("block:up")).toBeUndefined();
    expect(parseBlockAnchor("south")).toBeUndefined();
    for (const ok of ["block", "block:north", "straight:span", "south:0.5"])
      expect(ANCHOR_PATTERN.test(ok)).toBe(true);
    expect(ANCHOR_PATTERN.test("block:0.5")).toBe(false);
  });

  test("a whole tokens row gets a bracket and the line starts on its bar", async () => {
    const plain = await render(tokens(""));
    const block = await render(tokens(", fromAnchor: block"));
    // Brackets are drawn after routing: the placement is the same.
    expect(block.layout.nodes.map((n) => n.rect)).toEqual(plain.layout.nodes.map((n) => n.rect));
    expect(block.layout.canvas).toEqual(plain.layout.canvas);

    const cells = rectOf(block, "query");
    const edge = edgeOf(block, 0);
    const start = edge.route?.points[0];
    // Middle of the row, BRACKET_ROOM above the cells.
    expect(start?.x).toBeCloseTo(cells.x + cells.width / 2, 0);
    expect(start?.y).toBeCloseTo(cells.y - BRACKET_ROOM, 5);
    const bracket = edge.route?.brackets?.[0];
    expect(bracket).toHaveLength(4);
    // The bar spans the whole row; the ticks point down toward the cells.
    expect(bracket?.[1]).toEqual({ x: cells.x, y: cells.y - BRACKET_ROOM });
    expect(bracket?.[2]).toEqual({ x: cells.x + cells.width, y: cells.y - BRACKET_ROOM });
    expect(bracket?.[0]?.y).toBeGreaterThan(cells.y - BRACKET_ROOM);
    expect(bracket?.[0]?.y).toBeLessThan(cells.y);
    expect(block.svg).toContain('class="sumi-edge-bracket"');
    // The edge without an anchor keeps its plain end.
    expect(edgeOf(block, 1).route?.brackets).toBeUndefined();
    expect(plain.svg).not.toContain("sumi-edge-bracket");
    expect(lintGeometry(block).filter((d) => d.severity !== "info")).toEqual([]);
  });

  test("block:<side> names the side, at its middle", async () => {
    const r = await render(
      tokens("").replace(
        "{from: feat, to: dec}",
        '{from: feat, to: dec, fromAnchor: "block:north"}',
      ),
    );
    const cells = rectOf(r, "feat");
    const start = edgeOf(r, 1).route?.points[0];
    expect(start?.x).toBeCloseTo(cells.x + cells.width / 2, 0);
    expect(start?.y).toBeLessThan(cells.y - 1);
    expect(edgeOf(r, 1).route?.brackets).toHaveLength(1);
  });

  test("block on a node or on one cell is layout/block-anchor", () => {
    const onNode = checkFigure(
      tokens("").replace("{from: feat, to: dec}", "{from: dec, to: feat, fromAnchor: block}"),
    );
    expect(onNode.state.diagnostics.filter((d) => d.code === "layout/block-anchor")).toMatchObject([
      { severity: "error", path: ["edges", 1, "fromAnchor"] },
    ]);
    const onCell = checkFigure(
      tokens("").replace("{from: query, to: dec}", "{from: query.3, to: dec, fromAnchor: block}"),
    );
    const found = onCell.state.diagnostics.filter((d) => d.code === "layout/block-anchor");
    expect(found).toHaveLength(1);
    expect(found[0]?.hint).toContain("from: query");
  });

  const group = (anchor: string) => `version: 1
figure:
  id: group-ends
  theme: sumi
  profile: paper-double
  layout:
    arrange:
      stack: {gap: 10mm, items: [done, next]}
groups:
  - id: done
    caption: Terminal states
    arrange: {row: {gap: 6mm, items: [ok, failed, cancelled]}}
nodes:
  - {id: ok, component: box, label: completed}
  - {id: failed, component: box, label: failed}
  - {id: cancelled, component: box, label: cancelled}
  - {id: next, component: box, label: New task}
edges:
  - {from: done, to: next${anchor}}
`;

  test('a group end leaves from the middle of the side with "south:0.5" or block:south', async () => {
    for (const anchor of ['"south:0.5"', "block:south"]) {
      const r = await render(group(`, fromAnchor: ${anchor}`));
      const frame = rectOf(r, "done");
      const start = edgeOf(r, 0).route?.points[0];
      expect(start?.x).toBeCloseTo(frame.x + frame.width / 2, 0);
      expect(start?.y).toBeCloseTo(frame.y + frame.height, 0);
      // A framed group needs no bracket.
      expect(edgeOf(r, 0).route?.brackets).toBeUndefined();
    }
  });
});

const parallel = `version: 1
figure:
  id: ambiguous
  theme: sumi
  profile: paper-double
  layout:
    arrange:
      stack:
        gap: 5mm
        items:
          - row: {gap: 30mm, items: [a, b]}
          - row: {gap: 30mm, items: [c, d]}
nodes:
  - {id: a, component: box, label: Client}
  - {id: b, component: box, label: Server}
  - {id: c, component: box, label: Cache}
  - {id: d, component: box, label: Store}
edges:
  - {from: a, to: b, label: request, labelSide: right}
  - {from: c, to: d}
`;

describe("geometry/edge-label-ambiguous (#642)", () => {
  /** The context of `parallel` with the second line moved `ratio` times as far below the letters as the first line is above them. */
  async function moved(source: string, ratio: number) {
    const rendered = await render(source);
    const context = geometryContextFor(rendered);
    const edges = context.elements.filter((e) => e.ir.kind === "edge");
    const [own, other] = edges;
    const inks = own?.labels.flatMap(inkLines) ?? [];
    if (own?.drawn === undefined || other === undefined || inks.length === 0)
      throw new Error("no label");
    const line = own.drawn[0] ?? [];
    const top = Math.min(...inks.map((r) => r.y));
    const bottom = Math.max(...inks.map((r) => r.y + r.height));
    const gap = top - (line[0]?.y ?? 0) - own.strokeInset;
    const y = bottom + gap * ratio + other.strokeInset;
    other.drawn = [line.map((p) => ({ x: p.x, y }))];
    return context;
  }

  test("a label as close to another line as to its own is reported, with the side to flip to", async () => {
    const context = await moved(parallel, 1.2);
    const found = edgeLabelAmbiguous.run(context, undefined);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ path: ["edges", 0, "label"], subject: { id: "edges[0]" } });
    // Below a rightward line is its right: the hint flips it to the left.
    expect(found[0]?.hint).toContain("labelSide: left");
    expect(found[0]?.hint).toContain("labelStyle: tag");
    expect(EDGE_LABEL_AMBIGUOUS).toBe("geometry/edge-label-ambiguous");
    expect(edgeLabelAmbiguous.defaultSeverity).toBe("warning");
  });

  test("a line clearly farther away, or a tag, is not reported", async () => {
    expect(edgeLabelAmbiguous.run(await moved(parallel, AMBIGUOUS_RATIO + 0.5), undefined)).toEqual(
      [],
    );
    const tag = parallel.replace("labelSide: right}", "labelStyle: tag}");
    expect(edgeLabelAmbiguous.run(await moved(tag, 1), undefined)).toEqual([]);
  });

  test("the figure as drawn has no ambiguous label", async () => {
    const r = await render(parallel);
    expect(lintGeometry(r).filter((d) => d.code === EDGE_LABEL_AMBIGUOUS)).toEqual([]);
  });
});

describe("geometry/edge-label-detached span advice (#642)", () => {
  test("a label on a short span is told how long a run it needs", async () => {
    const source = `version: 1
figure:
  id: short
  theme: sumi
  profile: paper-double
  layout:
    arrange:
      row: {gap: 8mm, items: [start, s]}
nodes:
  - {id: start, component: initial}
  - {id: s, component: box, label: submitted}
edges:
  - {from: start, to: s, label: SendMessage}
`;
    const found = lintGeometry(await render(source), { source }).filter(
      (d) => d.code === EDGE_LABEL_DETACHED,
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.hint).toMatch(
      /Its longest straight run is [\d.]+mm, and the label needs about [\d.]+mm beside it/,
    );
    expect(found[0]?.hint).toContain("lengthen the span by about");
    expect(found[0]?.hint).toContain("labelStyle: tag");
  });
});
