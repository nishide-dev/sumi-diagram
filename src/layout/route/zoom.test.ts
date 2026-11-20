/**
 * Zoom edges (#176, design doc §6.45): the corners chosen by the side of the
 * target, and that the router leaves them out (no net, no crossing, the
 * other routes as without them).
 */

import { describe, expect, test } from "bun:test";
import { stringify } from "yaml";
import { checkFigure } from "../../core/check";
import { type LayoutFigureOptions, layoutStructuredFigure } from "../index";
import type { LayoutIR, Rect } from "../ir";
import type { TextMeasurer } from "../text";
import { checkRoutes } from "./check";
import { zoomLines, zoomSide } from "./zoom";

const FAKE: TextMeasurer = {
  lineWidth: (text, _font, size) => ([...text].length * size) / 2,
  verticalMetrics: (_font, size) => ({ ascent: 0.8 * size, descent: 0.2 * size }),
};

const rect = (x: number, y: number, width: number, height: number): Rect => ({
  x,
  y,
  width,
  height,
});

describe("zoomSide / zoomLines", () => {
  const source = rect(100, 100, 40, 20);

  test("the four sides join the facing corners, top or left line first", () => {
    const cases = [
      // right: source top-right → target top-left, bottom-right → bottom-left
      {
        target: rect(200, 60, 80, 100),
        side: "right",
        lines: [
          [
            { x: 140, y: 100 },
            { x: 200, y: 60 },
          ],
          [
            { x: 140, y: 120 },
            { x: 200, y: 160 },
          ],
        ],
      },
      {
        target: rect(0, 60, 50, 100),
        side: "left",
        lines: [
          [
            { x: 100, y: 100 },
            { x: 50, y: 60 },
          ],
          [
            { x: 100, y: 120 },
            { x: 50, y: 160 },
          ],
        ],
      },
      {
        target: rect(60, 200, 120, 50),
        side: "below",
        lines: [
          [
            { x: 100, y: 120 },
            { x: 60, y: 200 },
          ],
          [
            { x: 140, y: 120 },
            { x: 180, y: 200 },
          ],
        ],
      },
      {
        target: rect(60, 0, 120, 50),
        side: "above",
        lines: [
          [
            { x: 100, y: 100 },
            { x: 60, y: 50 },
          ],
          [
            { x: 140, y: 100 },
            { x: 180, y: 50 },
          ],
        ],
      },
    ] as const;
    for (const { target, side, lines } of cases) {
      expect(zoomSide(source, target)).toBe(side);
      expect(zoomLines(source, target, side)).toEqual(lines as never);
    }
  });

  test("touching boxes still have a side", () => {
    expect(zoomSide(source, rect(140, 100, 10, 10))).toBe("right");
    expect(zoomSide(source, rect(100, 120, 10, 10))).toBe("below");
  });

  test("apart on both axes: the larger gap decides, horizontal on a tie", () => {
    // 60 to the right, 20 below.
    expect(zoomSide(source, rect(200, 140, 10, 10))).toBe("right");
    // 10 to the right, 50 below.
    expect(zoomSide(source, rect(150, 170, 10, 10))).toBe("below");
    // 30 to the left, 30 above.
    expect(zoomSide(source, rect(60, 60, 10, 10))).toBe("left");
  });

  test("overlapping boxes have no side", () => {
    expect(zoomSide(source, rect(120, 110, 100, 100))).toBeUndefined();
    expect(zoomSide(source, rect(0, 0, 400, 400))).toBeUndefined();
    expect(zoomSide(source, source)).toBeUndefined();
  });

  test("a point end (junction) uses its center for both corners", () => {
    const point = rect(200, 108, 4, 4);
    expect(zoomLines(source, point, "right", { targetPoint: true })).toEqual([
      [
        { x: 140, y: 100 },
        { x: 202, y: 110 },
      ],
      [
        { x: 140, y: 120 },
        { x: 202, y: 110 },
      ],
    ]);
  });
});

function figure(edges: unknown[], extraNodes: unknown[] = []) {
  return stringify({
    version: 1,
    figure: {
      id: "z",
      theme: "academic",
      layout: {
        arrange: {
          stack: {
            gap: "8mm",
            align: "center",
            items: [
              "up",
              { row: { gap: "8mm", align: "center", items: ["left", "src", "right"] } },
              "down",
            ],
          },
        },
      },
    },
    groups: [
      { id: "right", label: "right", arrange: { stack: { items: ["r1", "r2"] } } },
      { id: "down", label: "down", arrange: { row: { items: ["d1"] } } },
    ],
    nodes: [
      { id: "src", component: "box", label: "src" },
      { id: "left", component: "box", label: "left" },
      { id: "up", component: "box", label: "up" },
      { id: "r1", component: "box", label: "r1" },
      { id: "r2", component: "box", label: "r2" },
      { id: "d1", component: "box", label: "d1" },
      ...extraNodes,
    ],
    edges,
  });
}

function run(text: string, options: LayoutFigureOptions = {}) {
  const result = layoutStructuredFigure(text, { measurer: FAKE, ...options });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  return result;
}

const rectOf = (layout: LayoutIR, key: string): Rect => {
  const element = [...layout.nodes, ...layout.groups].find((e) => e.key === key);
  if (element === undefined) throw new Error(`no ${key}`);
  return element.rect;
};

describe("zoom edges in a structured layout", () => {
  const routed = [
    { from: "src", to: "up" },
    { from: "r1", to: "r2" },
    { from: "src", to: "d1" },
  ];
  const zooms = [
    { from: "src", to: "right", component: "zoom" },
    { from: "src", to: "left", component: "zoom", variant: "muted" },
    { from: "src", to: "down", component: "zoom", variant: "solid" },
    { from: "src", to: "up", component: "zoom" },
  ];

  test("each zoom edge joins the corners of its side, with no net", () => {
    const { value, diagnostics } = run(figure([...routed, ...zooms]));
    expect(diagnostics).toEqual([]);
    const { layout } = value;
    const src = rectOf(layout, "n:src");
    for (const [i, z] of zooms.entries()) {
      const edge = layout.edges[routed.length + i];
      const target = rectOf(layout, z.to === "left" || z.to === "up" ? `n:${z.to}` : `g:${z.to}`);
      const side = zoomSide(src, target);
      expect(side).toBe(
        ({ right: "right", left: "left", down: "below", up: "above" } as const)[
          z.to as "right" | "left" | "down" | "up"
        ],
      );
      if (side === undefined) continue;
      const lines = zoomLines(src, target, side);
      expect(edge?.route?.lines).toEqual(lines);
      expect(edge?.route?.points).toEqual(lines[0]);
      expect(edge?.route?.net).toBeUndefined();
    }
    // The nets hold only the routed edges.
    expect(value.layout.nets?.flatMap((net) => net.edges)).toEqual(["e:#0", "e:#1", "e:#2"]);
    const report = checkRoutes(value.ir, value.layout);
    expect(Object.entries(report).filter(([, list]) => list.length > 0)).toEqual([]);
  });

  test("the other edges are routed as without the zoom edges", () => {
    const without = run(figure(routed)).value.layout;
    const withZoom = run(figure([...zooms.slice(0, 2), ...routed, ...zooms.slice(2)])).value.layout;
    const routes = (layout: LayoutIR) =>
      layout.edges.filter((e) => e.route?.lines === undefined).map((e) => e.route?.points);
    expect(routes(withZoom)).toEqual(routes(without));
    expect(withZoom.canvas).toEqual(without.canvas);
    expect(withZoom.nodes).toEqual(without.nodes);
  });

  test("zoom lines that cross other routes are not reported as crossings", () => {
    // up → d1 goes around src through a gap of the row, which the zoom
    // lines from "left" to "right" span.
    const { value, diagnostics } = run(
      figure([
        { from: "up", to: "d1" },
        { from: "left", to: "right", component: "zoom" },
      ]),
    );
    const [routedEdge, zoomEdge] = value.layout.edges;
    const route = routedEdge?.route?.points ?? [];
    const cross = (
      [a, b]: readonly [{ x: number; y: number }, { x: number; y: number }],
      [c, d]: readonly [{ x: number; y: number }, { x: number; y: number }],
    ) => {
      const side = (p: typeof a, q: typeof a, r: typeof a) =>
        Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
      return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
    };
    const crossings = (zoomEdge?.route?.lines ?? []).filter((line) =>
      route.slice(1).some((q, i) => cross(line, [route[i] as typeof q, q])),
    );
    expect(crossings.length).toBeGreaterThan(0);
    expect(diagnostics.filter((d) => d.code === "layout/edge-crossing")).toEqual([]);
  });

  test("ends that overlap (a group and its member) have no side: layout/no-route", () => {
    const result = layoutStructuredFigure(
      figure([{ id: "z", from: "r1", to: "right", component: "zoom" }]),
      { measurer: FAKE },
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((d) => [d.code, d.path, d.subject])).toEqual([
      ["layout/no-route", ["edges", 0], { kind: "edge", id: "z" }],
    ]);
    expect(result.diagnostics[0]?.message).toContain("zoom edge");
  });
});

describe("checking zoom edges", () => {
  const codes = (text: string) =>
    checkFigure(text).state.diagnostics.map((d) => [d.code, d.severity, d.path]);

  test("a label is an error, anchors are warnings", () => {
    expect(
      codes(
        figure([
          { from: "src", to: "right", component: "zoom", label: "zoom" },
          { from: "src", to: "left", component: "zoom", fromAnchor: "east", toAnchor: "west" },
        ]),
      ),
    ).toEqual([
      ["component/unexpected-label", "error", ["edges", 0, "label"]],
      ["component/anchor-on-zoom", "warning", ["edges", 1, "fromAnchor"]],
      ["component/anchor-on-zoom", "warning", ["edges", 1, "toAnchor"]],
    ]);
  });

  test("an auto figure gets layout/structured-only", () => {
    const text = stringify({
      version: 1,
      figure: { id: "z" },
      nodes: [
        { id: "a", component: "box" },
        { id: "b", component: "box" },
      ],
      edges: [{ from: "a", to: "b", component: "zoom" }],
    });
    expect(codes(text)).toEqual([["layout/structured-only", "error", ["edges", 0, "component"]]]);
  });
});
