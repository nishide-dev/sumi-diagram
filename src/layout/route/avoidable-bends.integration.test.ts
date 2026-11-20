/**
 * The three routes the #603 dogfooding study complained about (#604), cut
 * down to the elements involved: what the router now does with them and
 * what `geometry/avoidable-bend` says about the rest. Needs no D2.
 */
import { describe, expect, test } from "bun:test";
import { lintGeometry } from "../../lint/geometry/lint";
import { renderFigure } from "../../render/render";
import type { Point } from "../ir";
import { bendCount, jogLengths, TINY_JOG } from "./simplify";

async function render(source: string) {
  const result = await renderFigure(source);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  if (!("layout" in result.value)) throw new Error("not structured");
  return result.value;
}

const routeOf = (value: Awaited<ReturnType<typeof render>>, from: string, to: string) => {
  const edge = value.layout.edges.find((e) => e.from === from && e.to === to);
  if (edge?.route === undefined) throw new Error(`no route ${from} → ${to}`);
  return edge.route.points as Point[];
};

const avoidable = (value: Awaited<ReturnType<typeof render>>) =>
  lintGeometry(value).filter((d) => d.code === "geometry/avoidable-bend");

// Example 1: an encoder's edge into a matrix, anchored 0.2 down its east side,
// just below the encoder's side: an S where a straight line fits.
const CRITIC = (anchor: string) => `
version: 1
figure:
  id: critic
  theme: sumi
  profile: presentation-16x9
  themeOverrides:
    textScale: 2
  layout:
    arrange:
      place:
        unit: 1mm
        items:
          - {item: phi, at: [190, 72]}
          - {item: critic, at: [125, 88], origin: body}
nodes:
  - {id: phi, component: box, label: 'Encoder $\\phi(s,\\,a)$', tone: blue, variant: emphasis}
  - id: critic
    component: matrix
    props:
      flush: true
      cellWidth: 8mm
      variant: outlined
      classes:
        p: {tone: blue, pattern: hatch}
        n: {tone: gray}
      cells: [pnnn, npnn, nnpn, nnnp]
edges:
  - {from: phi, to: critic, toAnchor: "${anchor}"}
`;

// Example 2: a label's line into a hidden junction placed just beside it,
// and a skip around a dashed group inside a framed one.
const SKIP = `
version: 1
figure:
  id: skip
  theme: sumi
  profile: presentation-16x9
  themeOverrides:
    textScale: 2
  layout:
    arrange:
      stack:
        direction: up
        gap: 6mm
        items: [h-in, block, h-out]
groups:
  - id: block
    arrange:
      place:
        unit: 1mm
        items:
          - {item: unit, at: [0, 0], origin: body}
          - {item: split, at: [0, 40]}
          - {item: skip-low, at: [-30, 40]}
          - {item: skip-high, at: [-30, -40]}
          - {item: add, at: [0, -40]}
  - id: unit
    variant: dashed
    arrange:
      stack:
        direction: up
        gap: 6mm
        align: stretch
        items: [dense, norm, swish]
nodes:
  - {id: h-in, component: label, label: '$h_i$'}
  - {id: split, component: junction, variant: hidden}
  - {id: skip-low, component: junction, variant: hidden}
  - {id: skip-high, component: junction, variant: hidden}
  - {id: dense, component: box, label: Dense, tone: gray, variant: tinted, props: {width: 40mm}}
  - {id: norm, component: box, label: LayerNorm, tone: gray, variant: tinted}
  - {id: swish, component: box, label: Swish, tone: gray, variant: tinted}
  - {id: add, component: operator, props: {symbol: plus}}
  - {id: h-out, component: label, label: '$h_{i+1}$'}
edges:
  - {from: h-in, to: split, component: line}
  - {from: split, to: dense}
  - {from: dense, to: norm}
  - {from: norm, to: swish}
  - {from: swish, to: add}
  - {from: split, to: skip-low, component: line}
  - {from: skip-low, to: skip-high, component: line}
  - {from: skip-high, to: add}
  - {from: add, to: h-out}
`;

// Example 3: a router into a row of experts anchored on its west side, with a
// note attached above the router and a label attached below the experts.
const MOE = `
version: 1
figure:
  id: moe
  theme: sumi
  profile: paper-double
  themeOverrides:
    lineWidth: 0.75pt
    frameWidth: 0.75pt
    arrowheadScale: 0.6
  layout:
    arrange:
      place:
        unit: 1mm
        items:
          - {item: u, at: [0, 10]}
          - {item: router, at: [15, 10]}
          - {item: experts, at: [49, 2]}
nodes:
  - {id: u, component: tokens, tone: gray, props: {variant: tinted, width: 13pt, height: 13pt, cells: [""]}}
  - {id: router, component: box, label: "Router\\n√Softplus", tone: gray, variant: tinted}
  - {id: hash-note, component: label, variant: muted, label: "first 3 MoE layers:\\nhash routing", attach: {to: router, side: north, gap: 1.5mm}}
  - id: experts
    component: tokens
    tone: green
    props:
      variant: tinted
      width: 11pt
      height: 13pt
      gap: 2pt
      cells: ["1", "2", "3", "4", "5", "6", "…", "384"]
  - {id: experts-label, component: label, label: "384 routed experts, top-6 active", attach: {to: experts, side: south, gap: 1.5mm}}
edges:
  - {from: u, to: router}
  - {from: router, to: experts, toAnchor: west}
`;

describe("example 1: an anchor just outside the facing span", () => {
  test("the S is kept (the anchor is written) and the lint gives the anchor that is straight", async () => {
    const value = await render(CRITIC("east:0.2"));
    expect(bendCount(routeOf(value, "n:phi", "g:critic"))).toBe(2);
    const findings = avoidable(value);
    expect(findings).toHaveLength(1);
    const hint = findings[0]?.hint ?? "";
    const written = /toAnchor "(east:0\.\d+)"/.exec(hint)?.[1];
    expect(written).toBeDefined();
    // Applied, the unanchored source slides into line: one straight segment.
    const fixed = await render(CRITIC(written as string));
    expect(routeOf(fixed, "n:phi", "g:critic")).toHaveLength(2);
    expect(avoidable(fixed)).toEqual([]);
  });
});

describe("example 2: a skip and a junction beside a label", () => {
  test("the near miss at the junction is reported; the skip is not flagged as on or beside a border", async () => {
    const value = await render(SKIP);
    const findings = avoidable(value);
    expect(findings.map((d) => d.message)).toEqual([
      expect.stringContaining('before junction "split"'),
    ]);
    // 4–6mm from the frames is the groups' padding, not a line on a frame.
    expect(
      lintGeometry(value).filter((d) => /edge-on-border|edge-near-border/.test(d.code)),
    ).toEqual([]);
  });
});

describe("example 3: a router into experts between two attached labels", () => {
  test("a Z past the attached labels' text, 1.5pt or more from each line", async () => {
    const value = await render(MOE);
    const points = routeOf(value, "n:router", "g:experts");
    expect(bendCount(points)).toBe(2);
    const column = (points[1] as Point).x;
    // The column passes the note's short second line and the experts' label.
    const label = (key: string) => value.layout.nodes.find((n) => n.key === key)?.label;
    const below = label("n:experts-label");
    const note = label("n:hash-note");
    if (below === undefined || note === undefined) throw new Error("no labels");
    expect(below.box.x - column).toBeGreaterThanOrEqual(3);
    const second = note.box.x + (note.box.width + (note.lineWidths[1] as number)) / 2;
    expect(column - second).toBeGreaterThanOrEqual(3);
    expect(avoidable(value)).toEqual([]);
  });

  test("where the text blocks every column, the staircase is reported with what blocks it", async () => {
    const value = await render(
      MOE.replace('"first 3 MoE layers:\\nhash routing"', '"first 3 MoE layers:\\nhash-based routing"'),
    );
    const points = routeOf(value, "n:router", "g:experts");
    expect(bendCount(points)).toBeGreaterThan(2);
    expect(jogLengths(points).filter((l) => l < TINY_JOG)).toEqual([]);
    const findings = avoidable(value);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('node "hash-note"');
  });
});

describe("geometry/avoidable-bend hints", () => {
  const pair = (edge: string) => `
version: 1
figure:
  id: pair
  theme: sumi
  layout:
    arrange:
      place:
        unit: 1mm
        items:
          - {item: a, at: [0, 0]}
          - {item: b, at: [50, 30]}
nodes:
  - {id: a, component: box, label: A}
  - {id: b, component: box, label: B}
edges:
  - ${edge}
`;

  test("anchors that force a detour get the sides of an L", async () => {
    const value = await render(pair("{from: a, to: b, fromAnchor: north, toAnchor: north}"));
    const findings = avoidable(value);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain("one bend would do");
    expect(findings[0]?.hint).toContain('fromAnchor "east" and toAnchor "north"');
    const fixed = await render(pair("{from: a, to: b, fromAnchor: east, toAnchor: north}"));
    expect(bendCount(routeOf(fixed, "n:a", "n:b"))).toBe(1);
    expect(avoidable(fixed)).toEqual([]);
  });

  test("two written anchors apart get two values on one line; applied, the line is straight", async () => {
    const offset = (edge: string) => `
version: 1
figure:
  id: offset
  theme: sumi
  layout:
    arrange:
      place:
        unit: 1mm
        items:
          - {item: a, at: [0, 0]}
          - {item: b, at: [40, 3]}
nodes:
  - {id: a, component: box, label: A, props: {height: 14mm}}
  - {id: b, component: box, label: Bee, props: {height: 9mm}}
edges:
  - ${edge}
`;
    const value = await render(
      offset('{from: a, to: b, fromAnchor: "east:0.2", toAnchor: "west:0.8"}'),
    );
    const hint = avoidable(value)[0]?.hint ?? "";
    const from = /fromAnchor "(east:[\d.]+|east)"/.exec(hint)?.[1];
    const to = /toAnchor "(west:[\d.]+|west)"/.exec(hint)?.[1];
    expect(from).toBeDefined();
    expect(to).toBeDefined();
    const fixed = await render(
      offset(`{from: a, to: b, fromAnchor: "${from}", toAnchor: "${to}"}`),
    );
    expect(routeOf(fixed, "n:a", "n:b")).toHaveLength(2);
    expect(avoidable(fixed)).toEqual([]);
  });

  test("corner anchors draw a deliberate shape and are not reported", async () => {
    const value = await render(pair('{from: a, to: b, fromAnchor: "east:0", toAnchor: "west:1"}'));
    expect(avoidable(value)).toEqual([]);
  });
});
