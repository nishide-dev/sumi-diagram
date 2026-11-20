/**
 * The three routes the #603 dogfooding study complained about (#604), cut
 * down to the elements involved, and what `geometry/avoidable-bend` says
 * about them. Needs no D2.
 */
import { describe, expect, test } from "bun:test";
import { twoBendColumns } from "../../lint/geometry/avoidable";
import { lintGeometry } from "../../lint/geometry/lint";
import { renderFigure } from "../../render/render";
import type { Point } from "../ir";

/** Bends of a route: points minus its two ends, after dropping points in line. */
function bendCount(points: readonly Point[]): number {
  const p: Point[] = [];
  for (const q of points) {
    const a = p.at(-2);
    const b = p.at(-1);
    if (b !== undefined && Math.abs(b.x - q.x) < 1e-6 && Math.abs(b.y - q.y) < 1e-6) continue;
    if (
      a !== undefined &&
      b !== undefined &&
      ((Math.abs(a.x - b.x) < 1e-6 && Math.abs(b.x - q.x) < 1e-6) ||
        (Math.abs(a.y - b.y) < 1e-6 && Math.abs(b.y - q.y) < 1e-6))
    )
      p.pop();
    p.push(q);
  }
  return Math.max(0, p.length - 2);
}

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
const CRITIC = (anchor: string, from = "") => `
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
  - {from: phi, to: critic, toAnchor: "${anchor}"${from === "" ? "" : `, fromAnchor: "${from}"`}}
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
  test("the S is kept (the anchor is written) and the lint gives the anchors that are straight", async () => {
    const value = await render(CRITIC("east:0.2"));
    expect(bendCount(routeOf(value, "n:phi", "g:critic"))).toBe(2);
    const findings = avoidable(value);
    expect(findings).toHaveLength(1);
    const hint = findings[0]?.hint ?? "";
    // phi's centre is off the shared span, so both ends get a value.
    const to = /toAnchor "(east:0\.\d+)"/.exec(hint)?.[1];
    const from = /fromAnchor "(west:0\.\d+)"/.exec(hint)?.[1];
    expect(to).toBeDefined();
    expect(from).toBeDefined();
    // Applied: one straight segment.
    const fixed = await render(CRITIC(to as string, from as string));
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
    // So does moving the experts' label above them.
    const label = await render(
      MOE.replace("attach: {to: experts, side: south", "attach: {to: experts, side: north"),
    );
    expect(bendCount(routeOf(label, "n:router", "g:experts"))).toBeLessThanOrEqual(2);
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
    // The target keeps its side (and its written position): only the source changes.
    expect(findings[0]?.hint).toContain('Write fromAnchor "east",');
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

describe("only what is verified is claimed (review of #617)", () => {
  test("a two-bend route that fits beside an obstacle is not reported as blocked", () => {
    // Ports at (0, 0) and (100, 100), facing; a box near the source: a Z
    // with its middle at x = 50 passes it.
    const near = { x: 8, y: 8, width: 4, height: 4 };
    expect(twoBendColumns({ x: 0, y: 0 }, { x: 100, y: 100 }, "east", [near])).toBeUndefined();
    // A wall across the whole channel blocks every column.
    const wall = { x: 0, y: 40, width: 100, height: 20 };
    expect(twoBendColumns({ x: 0, y: 0 }, { x: 100, y: 100 }, "east", [wall])).toBeDefined();
  });

  test("no L is suggested for one anchor when the other end's port may move", async () => {
    // b's north side holds two ends (c → b as well), so where a → b would
    // enter it depends on how the ends share it: only fromAnchor is written,
    // and the L it would need is not claimed.
    const value = await render(`
version: 1
figure:
  id: shared
  theme: sumi
  layout:
    arrange:
      place:
        unit: 1mm
        items:
          - {item: a, at: [0, 0]}
          - {item: b, at: [50, 30]}
          - {item: c, at: [50, 0]}
nodes:
  - {id: a, component: box, label: A}
  - {id: b, component: box, label: B}
  - {id: c, component: box, label: C}
edges:
  - {from: a, to: b, fromAnchor: north}
  - {from: c, to: b}
`);
    for (const d of avoidable(value)) expect(d.message).not.toContain("one bend would do");
  });
});
