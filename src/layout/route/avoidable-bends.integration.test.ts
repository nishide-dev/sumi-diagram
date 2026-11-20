/**
 * The three routes the #603 dogfooding study complained about (#604), cut
 * down to the elements involved: what the router now does with them and
 * what `geometry/avoidable-bend` says about the rest. Needs no D2.
 */
import { describe, expect, test } from "bun:test";
import type { ElementKey } from "../../core/check-state";
import { lintGeometry } from "../../lint/geometry/lint";
import { renderFigure } from "../../render/render";
import { layoutStructuredFigure } from "../index";
import type { Point } from "../ir";
import { routeEdges } from "./router";
import { bendCount } from "./simplify";

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
  // A Z would pass the two labels so closely that its corners could not
  // round (the review of #617): the routed staircase stays, and the lint
  // names what stands between the ends.
  test("the staircase is kept and the lint names the labels that block a Z", async () => {
    const value = await render(MOE);
    expect(bendCount(routeOf(value, "n:router", "g:experts"))).toBe(4);
    const findings = avoidable(value);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('node "hash-note"');
    expect(findings[0]?.message).toContain('node "experts-label"');
    // Moving the note out of the way gives a Z.
    const moved = await render(MOE.replace("side: north, gap: 1.5mm", "side: south, gap: 1.5mm"));
    expect(bendCount(routeOf(moved, "n:router", "g:experts"))).toBeLessThanOrEqual(2);
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

  test("the line the hinted values give is the one checked: applying a hint never adds bends", async () => {
    // A tall box and a short one anchored apart, with a small box in the
    // middle of their shared span: the coordinate nearest to the written
    // ones that the hint's decimals can name must clear it.
    const source = (edge: string) => `
version: 1
figure:
  id: blocked
  theme: sumi
  layout:
    arrange:
      place:
        unit: 1mm
        items:
          - {item: a, at: [0, 0]}
          - {item: b, at: [40, 20]}
          - {item: dot, at: [20, 21]}
nodes:
  - {id: a, component: box, label: A, props: {height: 150mm}}
  - {id: b, component: box, label: B, props: {height: 9mm}}
  - {id: dot, component: box, props: {width: 1mm, height: 1mm}}
edges:
  - ${edge}
`;
    const value = await render(
      source('{from: a, to: b, fromAnchor: "east:0.2", toAnchor: "west:0.8"}'),
    );
    const before = bendCount(routeOf(value, "n:a", "n:b"));
    const hint = avoidable(value)[0]?.hint ?? "";
    const from = /fromAnchor "(east:[\d.]+|east)"/.exec(hint)?.[1];
    const to = /toAnchor "(west:[\d.]+|west)"/.exec(hint)?.[1];
    // The span has a clear line the decimals can name: the hint gives it.
    expect(from).toBeDefined();
    expect(to).toBeDefined();
    {
      const fixed = await render(
        source(`{from: a, to: b, fromAnchor: "${from}", toAnchor: "${to}"}`),
      );
      const after = routeOf(fixed, "n:a", "n:b");
      expect(bendCount(after)).toBeLessThanOrEqual(before);
      expect(after).toHaveLength(2);
    }
  });

  test("corner anchors draw a deliberate shape and are not reported", async () => {
    const value = await render(pair('{from: a, to: b, fromAnchor: "east:0", toAnchor: "west:1"}'));
    expect(avoidable(value)).toEqual([]);
  });
});

describe("straight, curved and zoom edges count (review of #617)", () => {
  const source = (extra: string) => `
version: 1
figure:
  id: foreign
  theme: sumi
  layout:
    arrange:
      place:
        unit: 1mm
        items:
          - {item: a, at: [0, 0]}
          - {item: b, at: [40, 3]}
          - {item: c, at: [0, 30]}
nodes:
  - {id: a, component: box, label: A}
  - {id: b, component: box, label: B}
  - {id: c, component: box, label: C}
edges:
  - {from: a, to: b}
${extra}`;
  const points = (text: string, simplify: boolean) => {
    const placed = layoutStructuredFigure(text, { route: false });
    if (!placed.ok) throw new Error(JSON.stringify(placed.diagnostics));
    const routed = routeEdges(placed.value.ir, placed.value.layout, { simplify });
    return routed.layout.edges.find((e) => e.from === "n:a" && e.to === "n:b")?.route?.points;
  };

  test("an edge alone on its sides is simplified; one sharing a side with a straight edge is not", () => {
    // Alone: the S between a and b becomes straight.
    const alone = source("");
    expect(points(alone, false)?.length).toBeGreaterThan(2);
    expect(points(alone, true)).toHaveLength(2);
    // A straight edge from c also ends on b's west side: a → b stays as routed.
    const shared = source("  - {from: c, to: b, route: straight}\n");
    expect(points(shared, true)).toEqual(points(shared, false));
  });

  test("a replacement that meets a curve drawn with the final routes is given back", () => {
    // A stand-in for a curve into a junction, whose tangent comes from the
    // orthogonal routes: it crosses a → b only once a → b is straight.
    const text = source("");
    const placed = layoutStructuredFigure(text, { route: false });
    if (!placed.ok) throw new Error(JSON.stringify(placed.diagnostics));
    const key = placed.value.layout.edges[0]?.key as ElementKey;
    const routed = routeEdges(placed.value.ir, placed.value.layout, {
      foreignOf: (routes) => {
        const p = routes.get(key);
        if (p === undefined || p.length !== 2) return [];
        const a = p[0] as Point;
        const b = p[1] as Point;
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        return [
          {
            key: "e:curve" as ElementKey,
            lines: [
              [
                { x: mid.x, y: mid.y - 3 },
                { x: mid.x, y: mid.y + 3 },
              ],
            ],
            ends: [],
          },
        ];
      },
    });
    const after = routed.layout.edges.find((e) => e.key === key)?.route?.points;
    expect(after).toEqual(points(text, false));
  });

  test("the check runs on the routes as returned, after the parallel runs are separated", () => {
    // Nested skips on one side are moved into lanes of their own after
    // routing (#512); x → y is simplified. The straight, curved and zoom
    // edges are compared with the separated routes, the ones returned.
    const text = `
version: 1
figure:
  id: order
  theme: sumi
  layout:
    fanIn: merge
    arrange:
      row:
        gap: 12mm
        align: start
        items:
          - stack: {direction: up, gap: 4mm, align: stretch, items: [a1, a2, a3, m, b3, b2, b1]}
          - x
          - y
nodes:
  - {id: a1, component: box, label: A1}
  - {id: a2, component: box, label: A2}
  - {id: a3, component: box, label: A3}
  - {id: m, component: box, label: M}
  - {id: b3, component: box, label: B3}
  - {id: b2, component: box, label: B2}
  - {id: b1, component: box, label: B1}
  - {id: x, component: box, label: X, props: {height: 20mm}}
  - {id: y, component: box, label: Y, props: {height: 8mm}}
edges:
  - {from: a3, to: b3, fromAnchor: east, toAnchor: east}
  - {from: a2, to: b2, fromAnchor: east, toAnchor: east}
  - {from: a1, to: b1, fromAnchor: east, toAnchor: east}
  - {from: x, to: y}
`;
    const placed = layoutStructuredFigure(text, { route: false });
    if (!placed.ok) throw new Error(JSON.stringify(placed.diagnostics));
    let seen: Map<ElementKey, readonly Point[]> | undefined;
    const routed = routeEdges(placed.value.ir, placed.value.layout, {
      foreignOf: (routes) => {
        seen = new Map(routes);
        return [];
      },
    });
    const xy = routed.layout.edges.find((e) => e.from === "n:x" && e.to === "n:y");
    expect(xy?.route?.points).toHaveLength(2);
    expect(seen).toBeDefined();
    // The last routes the check saw are the returned ones (up to the shift
    // that puts the content at the margin).
    const first = routed.layout.edges[0];
    const shown = (seen as Map<ElementKey, readonly Point[]>).get(first?.key as ElementKey) ?? [];
    const out = first?.route?.points ?? [];
    const dx = (out[0] as Point).x - (shown[0] as Point).x;
    const dy = (out[0] as Point).y - (shown[0] as Point).y;
    for (const e of routed.layout.edges) {
      const a = (seen as Map<ElementKey, readonly Point[]>).get(e.key) ?? [];
      const b = e.route?.points ?? [];
      expect(b.map((p) => ({ x: p.x - dx, y: p.y - dy }))).toEqual(
        a.map((p) => ({ x: expect.closeTo(p.x, 2), y: expect.closeTo(p.y, 2) })),
      );
    }
  });
});
