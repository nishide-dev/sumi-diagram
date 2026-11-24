/**
 * Edge origins and label ownership (#642, design record
 * `docs/design/decisions/642-block-anchor.md`), through `renderFigure`
 * (structured only, no D2): `block` ends with their bracket, side anchors on
 * a group, `geometry/edge-label-ambiguous` and the span advice of
 * `geometry/edge-label-detached`.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { checkFigure } from "../core/check";
import { parseBlockAnchor } from "../core/figure/layout";
import { ANCHOR_PATTERN } from "../core/figure/schema";
import { BRACKET_ROOM } from "../layout/block-bracket";
import type { EdgeLayout, Rect } from "../layout/ir";
import { edgeArrowheadLength } from "../layout/route/arrowhead";
import { labelGap, tagBox } from "../layout/route/labels";
import {
  AMBIGUOUS_RATIO,
  EDGE_LABEL_AMBIGUOUS,
  EDGE_LABEL_DETACHED,
  edgeLabelAmbiguous,
  geometryContextFor,
  inkLines,
  labelSideOf,
  lintGeometry,
  spanNeeds,
} from "../lint/geometry";
import { svgToPdf } from "./pdf";
import { svgToEditablePptx } from "./pptx";
import { readPptx } from "./pptx/testing";
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

  test("route: straight / curve and zoom edges reject block, at either end", () => {
    const codes = (source: string) =>
      checkFigure(source)
        .state.diagnostics.filter((d) => d.code === "layout/block-anchor")
        .map((d) => d.path);
    for (const route of ["straight", "curve"]) {
      expect(codes(tokens(`, fromAnchor: block, route: ${route}`))).toEqual([
        ["edges", 0, "fromAnchor"],
      ]);
      expect(
        codes(
          tokens("").replace(
            "{from: query, to: dec}",
            `{from: dec, to: query, toAnchor: block, route: ${route}}`,
          ),
        ),
      ).toEqual([["edges", 0, "toAnchor"]]);
    }
    const zoom = tokens("").replace(
      "{from: feat, to: dec}",
      "{from: feat, to: dec, component: zoom, toAnchor: block}",
    );
    expect(codes(zoom)).toEqual([["edges", 1, "toAnchor"]]);
  });

  test("avoidable-bend never rewrites a block end", async () => {
    const source = `version: 1
figure:
  id: mixed
  theme: sumi
  profile: paper-double
  layout:
    straighten: false
    arrange:
      stack:
        gap: 8mm
        items: [dec, query]
nodes:
  - {id: dec, component: box, label: Decoder, props: {width: 60mm}}
  - id: query
    component: tokens
    props: {width: 6mm, gap: 1pt, cells: [u, v, t, s, c]}
edges:
  - {from: query, to: dec, fromAnchor: ANCHOR, toAnchor: "south:0.6"}
`;
    for (const anchor of ["block", '"block:north"']) {
      const text = source.replace("ANCHOR", anchor);
      const found = lintGeometry(await render(text), { source: text }).filter(
        (d) => d.code === "geometry/avoidable-bend",
      );
      expect(found).toHaveLength(1);
      expect(found[0]?.hint).toContain('toAnchor "south"');
      expect(found[0]?.hint).not.toContain("fromAnchor");
    }
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

  test("the boundary is 1.75 times the distance to the own line", async () => {
    expect(AMBIGUOUS_RATIO).toBe(1.75);
    expect(edgeLabelAmbiguous.run(await moved(parallel, 1.7), undefined)).toHaveLength(1);
    expect(edgeLabelAmbiguous.run(await moved(parallel, 1.8), undefined)).toEqual([]);
  });

  test("edges of one net, zoom lines and lifelines are exempt", async () => {
    // One net: the routed layout gives both edges the same net.
    const net = await moved(parallel, 1.2);
    const layout = net.layout;
    if (layout === undefined) throw new Error("no layout");
    const shared = {
      ...net,
      layout: {
        ...layout,
        edges: layout.edges.map((e) =>
          e.route === undefined ? e : { ...e, route: { ...e.route, net: 0 } },
        ),
      },
    };
    expect(edgeLabelAmbiguous.run(shared, undefined)).toEqual([]);
    for (const change of [{ routing: "zoom" }, { lifeline: true }]) {
      const context = await moved(parallel, 1.2);
      const other = context.elements.filter((e) => e.ir.kind === "edge")[1];
      if (other === undefined) throw new Error("no edge");
      other.ir = { ...other.ir, ...change } as typeof other.ir;
      expect(edgeLabelAmbiguous.run(context, undefined)).toEqual([]);
    }
  });

  test("messages of a sequence diagram are not each other's rivals", async () => {
    // A tight rowGap brings a message's label near the arrow of the row above; every label
    // sits above its own arrow, so it is not reported.
    const text = readFileSync(
      new URL("../../tests/fixtures/figures/fit-hints/sequence-row-gap.sumi.yaml", import.meta.url),
      "utf8",
    ).replace("participants: [user", "rowGap: 1.5mm\n        participants: [user");
    const r = await render(text);
    expect(lintGeometry(r).filter((d) => d.code === EDGE_LABEL_AMBIGUOUS)).toEqual([]);
  });

  test("labelSide is read along the direction of travel in all four directions", () => {
    const route = (dx: number, dy: number) => [
      [
        { x: 0, y: 0 },
        { x: dx, y: dy },
      ],
    ];
    // Rightward: above is left. Leftward: below is left.
    expect(labelSideOf(route(10, 0), { x: 5, y: -3 })).toBe("left");
    expect(labelSideOf(route(10, 0), { x: 5, y: 3 })).toBe("right");
    expect(labelSideOf(route(-10, 0), { x: -5, y: 3 })).toBe("left");
    expect(labelSideOf(route(-10, 0), { x: -5, y: -3 })).toBe("right");
    // Downward: east is left. Upward: west is left.
    expect(labelSideOf(route(0, 10), { x: 3, y: 5 })).toBe("left");
    expect(labelSideOf(route(0, 10), { x: -3, y: 5 })).toBe("right");
    expect(labelSideOf(route(0, -10), { x: -3, y: -5 })).toBe("left");
    expect(labelSideOf(route(0, -10), { x: 3, y: -5 })).toBe("right");
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

  test("the run a label needs follows the router: line box or tag frame, gaps and arrowheads", () => {
    const style = { strokeWidth: { units: 2 }, textScale: 1 } as never;
    const label = { box: { x: 0, y: 0, width: 40, height: 12 }, fontSizeUnits: 12 } as never;
    const points = [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 10 },
    ];
    const edge = { style, targetArrowhead: "triangle" } as never;
    const needs = spanNeeds(edge, points, label);
    const g = labelGap(style);
    // The longest segment is the first: no arrowhead on it.
    expect(needs).toEqual({
      run: 30,
      beside: 40 + 2 * g,
      tag: tagBox({ x: 0, y: 0, width: 40, height: 12 }, { fontSizeUnits: 12 }).width + 2 * g,
    });
    // On the last segment, the target's arrowhead counts too.
    const last = spanNeeds(
      edge,
      [
        { x: 0, y: 0 },
        { x: 0, y: 5 },
        { x: 50, y: 5 },
      ],
      label,
    );
    expect(last?.beside).toBe(40 + 2 * g + edgeArrowheadLength(style));
  });
});

describe("bracket geometry in the lint and the exports (#642)", () => {
  const crossing = (attached: string) => `version: 1
figure:
  id: bracket-cross
  theme: sumi
  profile: paper-double
  layout:
    arrange:
      stack: {gap: 10mm, items: [dec, query]}
nodes:
  - {id: dec, component: box, label: Decoder}
  - id: query
    component: tokens
    props: {width: 8mm, gap: 1pt, cells: [u, v, t, s, c]}
${attached}
edges:
  - {from: query, to: dec, fromAnchor: block}
`;

  test("a bracket across a label or a node is reported", async () => {
    const label = await render(
      crossing(
        "  - {id: note, component: label, label: x, attach: {to: query.1, side: north, gap: 1pt}}",
      ),
    );
    expect(lintGeometry(label).map((d) => d.code)).toContain("geometry/edge-crosses-label");
    const node = await render(
      crossing(
        "  - {id: pin, component: box, label: '', props: {width: 3mm, height: 3mm}, attach: {to: query.1, side: north, gap: 1pt}}",
      ),
    );
    expect(lintGeometry(node).map((d) => d.code)).toContain("geometry/edge-through-node");
  });

  test("the painted edge includes its bracket, so a line along the bar is near it", async () => {
    const r = await render(tokens(", fromAnchor: block"));
    const context = geometryContextFor(r);
    const [block, other] = context.elements.filter((e) => e.ir.kind === "edge");
    const bar = edgeOf(r, 0).route?.brackets?.[0];
    if (block?.drawn === undefined || other === undefined || bar === undefined)
      throw new Error("no bracket");
    const [, p, q] = bar as { x: number; y: number }[];
    if (p === undefined || q === undefined) throw new Error("no bar");
    // The painted geometry holds the bar.
    expect(
      block.drawn.some((line) =>
        line.some((a, i) => i > 0 && a.y === p.y && line[i - 1]?.y === p.y),
      ),
    ).toBe(true);
    // Another line 1pt over the bar, along it: geometry/edge-near-edge.
    other.drawn = [
      [
        { x: p.x, y: p.y - 2 },
        { x: q.x, y: p.y - 2 },
      ],
    ];
    const { edgeNearEdge } = await import("../lint/geometry/rules");
    expect(edgeNearEdge.run(context, undefined).length).toBeGreaterThan(0);
  });

  test("PDF and editable PPTX keep the bracket", async () => {
    const plain = await render(tokens(""));
    const block = await render(tokens(", fromAnchor: block"));
    const pdf = svgToPdf(block.svg);
    if (!pdf.ok) throw new Error(JSON.stringify(pdf.diagnostics));
    const plainPdf = svgToPdf(plain.svg);
    expect(
      plainPdf.ok && Buffer.compare(Buffer.from(plainPdf.value), Buffer.from(pdf.value)),
    ).not.toBe(0);
    const shapes = (
      svg: string,
      ir: typeof block.compiled.ir,
      connectors: "freeform" | "glued",
    ) => {
      const result = svgToEditablePptx(svg, ir, { connectors });
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
      const slide = new TextDecoder().decode(readPptx(result.value).get("ppt/slides/slide1.xml"));
      return (slide.match(/<a:custGeom>/g) ?? []).length;
    };
    for (const connectors of ["freeform", "glued"] as const) {
      // One open freeform more: the bracket.
      expect(shapes(block.svg, block.compiled.ir, connectors)).toBe(
        shapes(plain.svg, plain.compiled.ir, connectors) + 1,
      );
    }
  });
});
