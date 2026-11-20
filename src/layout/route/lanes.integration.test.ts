/**
 * Edge lanes (#609): loops, skips and buses on a chosen side, and what is said
 * when a lane cannot be drawn. The checks read the routes the router drew.
 * Needs no D2.
 */

import { describe, expect, test } from "bun:test";
import { compileFigure } from "../../compiler/compile";
import type { Diagnostic } from "../../core/diagnostics";
import { lintGeometry } from "../../lint/geometry/lint";
import { renderFigure } from "../../render/render";
import type { LayoutIR, Point, Rect } from "../ir";
import { edgeArrowheadLength, WIRE_CORNER_RADIUS } from "./arrowhead";
import { followsLane, laneDiagnostics, planLanes } from "./lanes";

async function render(source: string) {
  const result = await renderFigure(source);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  if (!("layout" in result.value)) throw new Error("not structured");
  return { value: result.value, diagnostics: result.diagnostics as readonly Diagnostic[] };
}

type Rendered = Awaited<ReturnType<typeof render>>["value"];

const route = (value: Rendered, from: string, to: string): Point[] => {
  const edge = value.layout.edges.find((e) => e.from === `n:${from}` && e.to === `n:${to}`);
  if (edge?.route === undefined) throw new Error(`no route ${from} → ${to}`);
  return edge.route.points as Point[];
};
const rect = (value: Rendered, key: string): Rect => {
  const found = [...value.layout.nodes, ...value.layout.groups].find((e) => e.key === key);
  if (found === undefined) throw new Error(`no ${key}`);
  return found.rect;
};
const laneWarnings = (diagnostics: readonly Diagnostic[]) =>
  diagnostics.filter((d) => d.code === "layout/lane-blocked");
const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(0.01);

const ROW = (lane: string, extra = "") => `
version: 1
figure:
  id: row
  theme: sumi
  layout:
    arrange:
      row: {gap: 12mm, items: [a, b, c]}
nodes:
  - {id: a, component: box, label: A}
  - {id: b, component: box, label: "B\\ntall\\nbox"}
  - {id: c, component: box, label: C}
${extra}
edges:
  - {from: a, to: b}
  - {from: b, to: c}
  - {from: c, to: a${lane}}
`;

describe("lane: loops and skips (#609)", () => {
  test("a loop over the row leaves and enters on the north side, offset beyond the tallest end", async () => {
    const { value, diagnostics } = await render(ROW(", lane: {side: north, offset: 5mm}"));
    expect(laneWarnings(diagnostics)).toEqual([]);
    const points = route(value, "c", "a");
    const [a, c] = [rect(value, "n:a"), rect(value, "n:c")];
    expect(points).toHaveLength(4);
    // Out of C's top and into A's top.
    close((points[0] as Point).y, c.y);
    close((points[3] as Point).y, a.y);
    // The long segment: 5mm (28.35 units) above the farther of the two tops.
    const lane = Math.min(a.y, c.y) - (5 * 72) / 25.4 / 0.5;
    close((points[1] as Point).y, lane);
    close((points[2] as Point).y, lane);
  });

  test("the default offset clears the arrowhead and a corner", async () => {
    const source = ROW(", lane: {side: south}").replace('"B\\ntall\\nbox"', "B");
    const { value, diagnostics } = await render(source);
    expect(laneWarnings(diagnostics)).toEqual([]);
    const compiled = compileFigure(source);
    if (!compiled.ok) throw new Error("compile");
    const style = (compiled.value.ir.edges[2] as (typeof compiled.value.ir.edges)[number]).style;
    const points = route(value, "c", "a");
    const [a, c] = [rect(value, "n:a"), rect(value, "n:c")];
    const bottom = Math.max(a.y + a.height, c.y + c.height);
    // The arrowhead and a corner, or 6pt (12 units) if that is more.
    const offset = Math.max(12, edgeArrowheadLength(style) + WIRE_CORNER_RADIUS);
    expect(offset).toBeGreaterThan(12);
    close((points[1] as Point).y, bottom + offset);
  });

  test("a skip goes around the named group's frame", async () => {
    const source = `
version: 1
figure:
  id: skip
  theme: sumi
  layout:
    arrange:
      stack: {direction: up, gap: 6mm, items: [split, unit, add]}
groups:
  - id: unit
    variant: dashed
    arrange:
      stack: {direction: up, gap: 4mm, items: [dense, norm]}
nodes:
  - {id: split, component: junction}
  - {id: dense, component: box, label: Dense}
  - {id: norm, component: box, label: LayerNorm}
  - {id: add, component: operator, props: {symbol: plus}}
edges:
  - {from: split, to: dense}
  - {from: dense, to: norm}
  - {from: norm, to: add}
  - {from: split, to: add, lane: {side: west, outside: unit, offset: 4mm}}
`;
    const { value, diagnostics } = await render(source);
    expect(laneWarnings(diagnostics)).toEqual([]);
    const frame = rect(value, "g:unit");
    const points = route(value, "split", "add");
    const lane = frame.x - (4 * 72) / 25.4 / 0.5;
    const inner = points.slice(1, -1);
    expect(inner.length).toBeGreaterThan(0);
    for (const p of inner) close(p.x, lane);
    // Into the operator's west side.
    const add = rect(value, "n:add");
    expect((points.at(-1) as Point).x).toBeLessThanOrEqual(add.x + add.width / 2);
    // No avoidable-bend for the U the author asked for.
    expect(lintGeometry(value).filter((d) => d.code === "geometry/avoidable-bend")).toEqual([]);
  });

  test("a lane edge gets no avoidable-bend; the same edge without the lane does", async () => {
    const source = (lane: string) => `
version: 1
figure:
  id: one
  theme: sumi
  layout:
    straighten: false
    arrange:
      row: {gap: 24mm, align: center, items: [q, t]}
nodes:
  - {id: q, component: box, label: q}
  - {id: t, component: box, label: T}
edges:
  - {from: q, to: t, toAnchor: "west:0.38"${lane}}
`;
    const avoidable = (value: Rendered) =>
      lintGeometry(value).filter(
        (d) => d.code === "geometry/avoidable-bend" || d.code === "geometry/relocatable-node",
      );
    const plain = await render(source(""));
    expect(avoidable(plain.value).map((d) => d.code)).toContain("geometry/avoidable-bend");
    const lane = await render(source(", lane: {side: west, outside: t, offset: 8mm}"));
    expect(laneWarnings(lane.diagnostics)).toEqual([]);
    expect(avoidable(lane.value)).toEqual([]);
  });
});

const BUS = (offset: string) => `
version: 1
figure:
  id: bus
  theme: sumi
  layout:
    arrange:
      row:
        gap: 24mm
        align: center
        items: [q, {stack: {gap: 6mm, items: [t1, t2, t3]}}]
nodes:
  - {id: q, component: box, label: q}
  - {id: t1, component: box, label: T1}
  - {id: t2, component: box, label: T2}
  - {id: t3, component: box, label: T3}
edges:
  - {from: q, to: t1, lane: {side: west, outside: t1, offset: ${offset}}}
  - {from: q, to: t2, lane: {side: west, outside: t2, offset: ${offset}}}
  - {from: q, to: t3, lane: {side: west, outside: t3, offset: ${offset}}}
`;

describe("lane: buses (#609)", () => {
  test("edges from one source with lanes on one side share one trunk", async () => {
    const { value, diagnostics } = await render(BUS("8mm"));
    expect(laneWarnings(diagnostics)).toEqual([]);
    // The farthest of the three (the targets differ in width): min x minus the offset.
    const left = Math.min(...["t1", "t2", "t3"].map((k) => rect(value, `n:${k}`).x));
    const lane = left - (8 * 72) / 25.4 / 0.5;
    const q = rect(value, "n:q");
    for (const target of ["t1", "t2", "t3"]) {
      const points = route(value, "q", target);
      // Out of q's east side (q lies beyond the lane), into the target's west side.
      close((points[0] as Point).x, q.x + q.width);
      close((points.at(-1) as Point).x, rect(value, `n:${target}`).x);
      for (const p of points.slice(1, -1)) close(p.x, lane);
    }
    // One net: the trunk is shared.
    const nets = new Set(
      value.layout.edges.filter((e) => e.from === "n:q").map((e) => e.route?.net),
    );
    expect(nets.size).toBe(1);
  });

  test("the farthest lane of a bus is the shared one", async () => {
    const source = BUS("8mm").replace(
      "{from: q, to: t3, lane: {side: west, outside: t3, offset: 8mm}}",
      "{from: q, to: t3, lane: {side: west, outside: t3, offset: 12mm}}",
    );
    const { value } = await render(source);
    const left = Math.min(...["t1", "t2", "t3"].map((k) => rect(value, `n:${k}`).x));
    const lane = left - (12 * 72) / 25.4 / 0.5;
    for (const target of ["t1", "t2", "t3"])
      for (const p of route(value, "q", target).slice(1, -1)) close(p.x, lane);
  });
});

describe("lane: buses share a trunk (#609)", () => {
  // q level with the top target: the branches to t2 and t3 run down one trunk.
  const TOP = (anchors: [string, string]) => `
version: 1
figure:
  id: bus-top
  theme: sumi
  layout:
    straighten: false
    arrange:
      row:
        gap: 24mm
        align: start
        items: [q, {stack: {gap: 6mm, items: [t1, t2, t3]}}]
nodes:
  - {id: q, component: box, label: q}
  - {id: t1, component: box, label: T1}
  - {id: t2, component: box, label: T2}
  - {id: t3, component: box, label: T3}
edges:
  - {from: q, to: t2${anchors[0]}, lane: {side: west, outside: t2, offset: 8mm}}
  - {from: q, to: t3${anchors[1]}, lane: {side: west, outside: t3, offset: 8mm}}
`;
  /** The vertical pieces of a route on the line x = `at`, as [top, bottom]. */
  const onLine = (points: readonly Point[], at: number): [number, number][] =>
    points.slice(1).flatMap((q, i) => {
      const p = points[i] as Point;
      return Math.abs(p.x - at) < 0.01 && Math.abs(q.x - at) < 0.01
        ? [[Math.min(p.y, q.y), Math.max(p.y, q.y)] as [number, number]]
        : [];
    });

  test("the branches' trunk segments overlap on the lane", async () => {
    const { value, diagnostics } = await render(TOP(["", ""]));
    expect(diagnostics.filter((d) => d.code.startsWith("layout/lane"))).toEqual([]);
    const at = Math.min(rect(value, "n:t2").x, rect(value, "n:t3").x) - (8 * 72) / 25.4 / 0.5;
    const [two] = onLine(route(value, "q", "t2"), at);
    const [three] = onLine(route(value, "q", "t3"), at);
    expect(two).toBeDefined();
    expect(three).toBeDefined();
    if (two === undefined || three === undefined) return;
    // The shared stretch runs from q's level down to t2's, the whole t2 branch.
    const shared = Math.min(two[1], three[1]) - Math.max(two[0], three[0]);
    expect(shared).toBeGreaterThan(0);
    close(shared, two[1] - two[0]);
    // Both leave q at one point.
    expect(route(value, "q", "t2")[0]).toEqual(route(value, "q", "t3")[0] as Point);
  });

  test("anchors that split the shared end are said: no trunk", async () => {
    const { value, diagnostics } = await render(
      TOP([', fromAnchor: "east:0.3"', ', fromAnchor: "east:0.7"']),
    );
    const split = diagnostics.filter((d) => d.code === "layout/lane-bus-split");
    expect(split).toHaveLength(1);
    expect(split[0]?.severity).toBe("warning");
    expect(split[0]?.message).toContain("fromAnchors differ");
    expect(split[0]?.message).toContain("cannot share a trunk");
    // What happens: the first edge takes the lane; the second would run along it, so it is
    // routed without its lane, and says so.
    const blocked = laneWarnings(diagnostics);
    expect(blocked).toHaveLength(1);
    expect(blocked[0]?.subject?.id).toBe("edges[1]");
    expect(blocked[0]?.message).toContain("run along edges[0]");
    const at = Math.min(rect(value, "n:t2").x, rect(value, "n:t3").x) - (8 * 72) / 25.4 / 0.5;
    expect(
      route(value, "q", "t2")
        .slice(1, -1)
        .every((p) => Math.abs(p.x - at) < 0.01),
    ).toBe(true);
    expect(
      route(value, "q", "t3")
        .slice(1, -1)
        .some((p) => Math.abs(p.x - at) < 0.01),
    ).toBe(false);
    // Drawn as said: separate nets.
    const nets = new Set(
      value.layout.edges.filter((e) => e.from === "n:q").map((e) => e.route?.net),
    );
    expect(nets.size).toBe(2);
  });
});

describe("lane: other routes keep their distance (#609)", () => {
  test("a route beside a lane is moved a lane gap away", async () => {
    const source = `
version: 1
figure:
  id: near
  theme: sumi
  layout:
    straighten: false
    arrange:
      stack: {gap: 6mm, items: [a, b, c, d]}
nodes:
  - {id: a, component: box, label: A}
  - {id: b, component: box, label: B}
  - {id: c, component: box, label: C}
  - {id: d, component: box, label: D}
edges:
  - {from: a, to: b}
  - {from: b, to: c}
  - {from: c, to: d}
  - {from: a, to: d, lane: {side: east, offset: 10pt}}
  - {from: b, to: d, fromAnchor: east, toAnchor: "east:0.7"}
`;
    const { value, diagnostics } = await render(source);
    expect(laneWarnings(diagnostics)).toEqual([]);
    const lane = route(value, "a", "d");
    const other = route(value, "b", "d");
    const laneX = (lane[1] as Point).x;
    const otherX = (other[1] as Point).x;
    close((lane[2] as Point).x, laneX);
    close((other[2] as Point).x, otherX);
    // The lane stays where it was asked (10pt = 20 units beyond D's east side).
    const d = rect(value, "n:d");
    close(laneX, d.x + d.width + 20);
    // 1pt lines: half of each stroke plus the 1.5pt lane gap (3.02 units with rounding room).
    expect(Math.abs(otherX - laneX)).toBeGreaterThanOrEqual(2 + 3.02 - 0.01);
    // Not a stroke overlap any more.
    expect(lintGeometry(value).filter((x) => x.code === "geometry/edge-near-edge")).toEqual([]);
  });
});

describe("lane: what cannot be drawn is said (#609)", () => {
  test("a node in the way: a warning naming it, and the edge is still routed", async () => {
    const source = `
version: 1
figure:
  id: blocked
  theme: sumi
  layout:
    arrange:
      stack:
        gap: 6mm
        items: [top, {row: {gap: 12mm, items: [a, b]}}]
nodes:
  - {id: top, component: box, label: "A wide box over both", props: {width: 80mm}}
  - {id: a, component: box, label: A}
  - {id: b, component: box, label: B}
edges:
  - {from: b, to: a, lane: {side: north, offset: 9mm}}
`;
    const { value, diagnostics } = await render(source);
    const warnings = laneWarnings(diagnostics);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.severity).toBe("warning");
    expect(warnings[0]?.message).toContain('"top"');
    expect(warnings[0]?.path).toEqual(["edges", 0, "lane"]);
    expect(route(value, "b", "a").length).toBeGreaterThanOrEqual(2);
  });

  test("a lane along a node's border: the tall box between the ends", async () => {
    // B reaches exactly as far down as the default lane of A and C.
    const { value, diagnostics } = await render(ROW(", lane: {side: south}"));
    const [warning] = laneWarnings(diagnostics);
    expect(warning?.message).toContain('"b"');
    // Routed without the lane, clear of B.
    const b = rect(value, "n:b");
    expect((route(value, "c", "a")[1] as Point).y).toBeGreaterThan(b.y + b.height);
  });

  test("a lane through an end", async () => {
    const source = BUS("8mm").replace(
      "{from: q, to: t2, lane: {side: west, outside: t2, offset: 8mm}}",
      "{from: q, to: t2, lane: {side: west, outside: t2, offset: 30mm}}",
    );
    const { diagnostics } = await render(source);
    const messages = laneWarnings(diagnostics).map((d) => d.message);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.some((m) => m.includes('runs through "q"'))).toBe(true);
  });

  test("an anchor on another side", async () => {
    const { diagnostics } = await render(ROW(", fromAnchor: east, lane: {side: north}"));
    const [warning] = laneWarnings(diagnostics);
    expect(warning?.message).toContain("fromAnchor is on the east side");
  });

  test("an offset shorter than the arrowhead needs", async () => {
    const { diagnostics } = await render(ROW(", lane: {side: north, offset: 1pt}"));
    const [warning] = laneWarnings(diagnostics);
    expect(warning?.message).toContain("short of the");
  });

  test("a route that does not follow its lane is reported (validated on the drawn route)", async () => {
    const { value } = await render(ROW(", lane: {side: north, offset: 5mm}"));
    const compiled = compileFigure(ROW(", lane: {side: north, offset: 5mm}"));
    if (!compiled.ok) throw new Error("compile");
    const ir = compiled.value.ir;
    expect(laneDiagnostics(ir, value.layout, [])).toEqual([]);
    // The same layout with the loop drawn elsewhere.
    const moved: LayoutIR = {
      ...value.layout,
      edges: value.layout.edges.map((e) =>
        e.route === undefined || e.from !== "n:c"
          ? e
          : {
              ...e,
              route: {
                ...e.route,
                points: e.route.points.map((p, i, all) =>
                  i === 0 || i === all.length - 1 ? p : { ...p, y: p.y + 4 },
                ),
              },
            },
      ),
    };
    const [warning] = laneDiagnostics(ir, moved, []);
    expect(warning?.code).toBe("layout/lane-blocked");
    expect(warning?.message).toContain("does not run on the lane");
    const plan = planLanes(ir, value.layout).get(ir.edges[2]?.key as never);
    expect(plan).toBeDefined();
    if (plan !== undefined) {
      expect(followsLane(route(value, "c", "a"), plan)).toBe(true);
    }
  });
});

describe("lane: checks (#609)", () => {
  const diagnosticsOf = (source: string) => compileFigure(source).diagnostics;

  test("auto layout: structured-only", () => {
    const source = `
version: 1
figure: {id: auto, theme: sumi}
nodes:
  - {id: a, component: box, label: A}
  - {id: b, component: box, label: B}
edges:
  - {from: a, to: b, lane: {side: north}}
`;
    const found = diagnosticsOf(source).filter((d) => d.code === "layout/structured-only");
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain('"lane"');
  });

  test("unknown outside", () => {
    const found = diagnosticsOf(ROW(", lane: {side: north, outside: nope}")).filter(
      (d) => d.code === "layout/unknown-lane-outside",
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.path).toEqual(["edges", 2, "lane", "outside"]);
  });

  test("a lane on a curve", () => {
    const found = diagnosticsOf(ROW(", route: curve, lane: {side: north}")).filter(
      (d) => d.code === "layout/invalid-lane",
    );
    expect(found).toHaveLength(1);
  });
});
