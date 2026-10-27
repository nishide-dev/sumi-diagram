/**
 * `edges[].labelAt` / `labelSide` (#128, design doc §6.30): the label sits
 * beside the requested segment, on the requested side of the line facing
 * from source to target, and keeps clear of routes, nodes and labels by
 * sliding along that segment only.
 */

import { describe, expect, test } from "bun:test";
import { stringify } from "yaml";
import { type LayoutFigureOptions, layoutStructuredFigure } from "../index";
import type { LayoutIR, Point, Rect } from "../ir";
import type { TextMeasurer } from "../text";
import { checkRoutes } from "./check";
import { EDGE_LABEL_GAP } from "./labels";
import { arrowheadLength } from "./router";

/** Every character is half an em wide; ascender 0.8 em, descender 0.2 em. */
const FAKE: TextMeasurer = {
  lineWidth: (text, _font, size) => ([...text].length * size) / 2,
  verticalMetrics: (_font, size) => ({ ascent: 0.8 * size, descent: 0.2 * size }),
};

function run(text: string, options: LayoutFigureOptions = {}) {
  const result = layoutStructuredFigure(text, { measurer: FAKE, ...options });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  return result.value;
}

function figure(arrange: unknown, nodes: unknown[], edges: unknown[]) {
  return stringify({
    version: 1,
    figure: { id: "t", theme: "academic", layout: { arrange } },
    nodes,
    edges,
  });
}

const box = (id: string, props?: object) => ({
  id,
  component: "box",
  label: id,
  ...(props !== undefined && { props }),
});

const AT = ["start", "middle", "end"] as const;
const SIDE = ["left", "right"] as const;
type At = (typeof AT)[number];
type Side = (typeof SIDE)[number];

const g = EDGE_LABEL_GAP;
const flatOf = (a: Point, b: Point) => Math.abs(a.y - b.y) < 1e-9;
const lengthOf = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/** The segment `labelAt` names, computed independently: [from, to] from source to target. */
function requestedSegment(points: readonly Point[], at: At): [Point, Point] {
  let i = points.length - 1;
  if (at === "start") i = 1;
  if (at === "middle") {
    let best = -1;
    for (let k = 1; k < points.length; k++) {
      const length = lengthOf(points[k - 1] as Point, points[k] as Point);
      if (length > best) {
        best = length;
        i = k;
      }
    }
  }
  return [points[i - 1] as Point, points[i] as Point];
}

/** Which side of the travel direction from `a` to `b` the point `c` is on (SVG coordinates: y down). */
function sideOf(a: Point, b: Point, c: Point): Side {
  const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  if (Math.abs(cross) < 1e-9) throw new Error("on the line");
  return cross < 0 ? "left" : "right";
}

const centerOf = (r: Rect): Point => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

/** Checks a label box against its segment: beside it on `side`, the gap away. */
function expectBeside(
  box: Rect,
  [a, b]: [Point, Point],
  side: Side,
  options: { centerOnSegment: boolean },
) {
  const c = centerOf(box);
  expect(sideOf(a, b, c)).toBe(side);
  const flat = flatOf(a, b);
  // The gap from the line, across it.
  const across = flat
    ? Math.min(Math.abs(box.y + box.height - a.y), Math.abs(box.y - a.y))
    : Math.min(Math.abs(box.x + box.width - a.x), Math.abs(box.x - a.x));
  expect(across).toBeCloseTo(g, 3);
  // Along it: the box overlaps the segment's span; its center within it, too.
  const [lo, hi] = flat
    ? [Math.min(a.x, b.x), Math.max(a.x, b.x)]
    : [Math.min(a.y, b.y), Math.max(a.y, b.y)];
  const [blo, bhi] = flat ? [box.x, box.x + box.width] : [box.y, box.y + box.height];
  expect(bhi).toBeGreaterThan(lo);
  expect(blo).toBeLessThan(hi);
  if (options.centerOnSegment) {
    const along = flat ? c.x : c.y;
    expect(along).toBeGreaterThanOrEqual(lo - 1e-6);
    expect(along).toBeLessThanOrEqual(hi + 1e-6);
  }
}

interface Shape {
  readonly name: string;
  readonly text: (labelAt: At, labelSide: Side) => string;
  /** The number of segments the route has. */
  readonly segments: number;
  /** The last segment is shorter than the label: the label's center may lie past it. */
  readonly short?: boolean;
  /**
   * `labelAt/labelSide` → the collisions `checkRoutes` reports where the
   * requested segment and side have no clear place: the label stays there
   * (it is not moved to the other side) and the checks report it.
   */
  readonly collisions?: Readonly<Record<string, readonly string[]>>;
}

const edge = (extra: object, at: At, side: Side) => ({
  from: "a",
  to: "b",
  label: "label",
  labelAt: at,
  labelSide: side,
  ...extra,
});

const SHAPES: Shape[] = [
  {
    name: "horizontal",
    segments: 1,
    text: (at, side) =>
      figure(
        { row: { gap: "30mm", items: ["a", "b"] } },
        [box("a"), box("b")],
        [edge({}, at, side)],
      ),
  },
  {
    name: "vertical",
    segments: 1,
    text: (at, side) =>
      figure(
        { stack: { gap: "30mm", items: ["a", "b"] } },
        [box("a"), box("b")],
        [edge({}, at, side)],
      ),
  },
  {
    // a's east side, right, then down into b's north side.
    name: "L-shaped",
    segments: 2,
    text: (at, side) =>
      figure(
        { stack: { gap: "25mm", align: "start", items: ["a", "b"] } },
        [box("a", { width: "60pt" }), box("b", { width: "250pt" })],
        [edge({ fromAnchor: "east", toAnchor: "north" }, at, side)],
      ),
  },
  {
    // #116's reproduction (research/109-dogfood-v0.4, A8): down from the
    // optimizer, left under both, and a short last segment up into the model.
    name: "short last segment",
    segments: 3,
    short: true,
    // The right side faces the corners: the 16-unit stubs are shorter than
    // the label, so beside them it meets the bottom run, and between the
    // boxes it meets the optimizer. The left side is clear everywhere.
    collisions: {
      "start/right": ["e:#0 label / e:#0 route"],
      "middle/right": ["e:#0 label / n:optimizer"],
      "end/right": ["e:#0 label / e:#0 route"],
    },
    text: (at, side) =>
      stringify({
        version: 1,
        figure: {
          id: "t",
          theme: "academic",
          layout: { arrange: { row: { gap: "10mm", items: ["model", "optimizer"] } } },
        },
        nodes: [box("model"), box("optimizer")],
        edges: [
          {
            from: "optimizer",
            to: "model",
            fromAnchor: "south",
            toAnchor: "south",
            label: "update θ",
            labelAt: at,
            labelSide: side,
          },
        ],
      }),
  },
];

describe.each(SHAPES)("$name route", (shape) => {
  test.each(AT.flatMap((at) => SIDE.map((side) => [at, side] as const)))(
    "labelAt: %s, labelSide: %s: beside the requested segment, on the requested side",
    (at, side) => {
      const value = run(shape.text(at, side));
      const route = value.layout.edges[0]?.route;
      const label = route?.label;
      if (route === undefined || label === undefined) throw new Error("no label");
      expect(route.points.length).toBe(shape.segments + 1);
      const segment = requestedSegment(route.points, at);
      // The label of a short last segment may start beside it and run past its corner.
      const short = shape.short === true && at === "end";
      expectBeside(label.box, segment, side, { centerOnSegment: !short });
      expect(checkRoutes(value.ir, value.layout).labelCollisions).toEqual([
        ...(shape.collisions?.[`${at}/${side}`] ?? []),
      ]);
    },
  );
});

/** The label box of the only edge. */
const labelBox = (layout: LayoutIR): Rect => {
  const label = layout.edges[0]?.route?.label;
  if (label === undefined) throw new Error("no label");
  return label.box;
};

describe("first places", () => {
  const row = (fields: object, component = "arrow") =>
    run(
      figure(
        { row: { gap: "30mm", items: ["a", "b"] } },
        [box("a"), box("b")],
        [{ from: "a", to: "b", label: "label", component, ...fields }],
      ),
    );

  test("labelAt: end is the default place of an arrow; labelSide: left is above a rightward line", () => {
    const omitted = labelBox(row({}).layout);
    expect(labelBox(row({ labelAt: "end" }).layout)).toEqual(omitted);
    expect(labelBox(row({ labelSide: "left" }).layout)).toEqual(omitted);
    // Right of a rightward line is below it: the same place along, mirrored.
    // (Each layout is moved to keep its content at the margin: compare to its own line.)
    const lineY = (layout: LayoutIR) => layout.edges[0]?.route?.points[0]?.y as number;
    const above = row({}).layout;
    const below = row({ labelSide: "right" }).layout;
    expect(labelBox(below).x).toBe(omitted.x);
    expect(omitted.y + omitted.height).toBeCloseTo(lineY(above) - g, 2);
    expect(labelBox(below).y).toBeCloseTo(lineY(below) + g, 2);
  });

  test("start: just past the source's end (its arrowhead, if any); middle: centred", () => {
    // Each layout against its own line (see above).
    const ends = (layout: LayoutIR): [Point, Point] => {
      const [from, to] = layout.edges[0]?.route?.points ?? [];
      if (from === undefined || to === undefined) throw new Error("no route");
      return [from, to];
    };
    const start = row({ labelAt: "start" }).layout;
    expect(labelBox(start).x).toBeCloseTo(ends(start)[0].x + g, 2);
    const both = row({ labelAt: "start" }, "double-arrow").layout;
    expect(labelBox(both).x).toBeCloseTo(ends(both)[0].x + arrowheadLength(1) + g, 2);
    const middle = row({ labelAt: "middle" }).layout;
    const [from, to] = ends(middle);
    expect(labelBox(middle).x + labelBox(middle).width / 2).toBeCloseTo((from.x + to.x) / 2, 2);
    // A line has no arrowhead: labelAt: end is the gap from the target.
    const line = row({ labelAt: "end" }, "line").layout;
    expect(labelBox(line).x + labelBox(line).width).toBeCloseTo(ends(line)[1].x - g, 2);
  });
});

describe("avoidance within the requested segment", () => {
  // `a → b` runs right along the middle of the row; `t → u` runs straight
  // down across it, right at its middle.
  const crossing = (fields: object) =>
    run(
      figure(
        {
          stack: {
            gap: "12mm",
            items: ["t", { row: { gap: "40mm", items: ["a", "b"] } }, "u"],
          },
        },
        [box("t"), box("a"), box("b"), box("u")],
        [
          { from: "a", to: "b", label: "label", ...fields },
          { from: "t", to: "u" },
        ],
      ),
    );

  test.each([...SIDE])("middle, %s: slides along the segment past the crossing route", (side) => {
    const value = crossing({ labelAt: "middle", labelSide: side });
    const points = value.layout.edges[0]?.route?.points ?? [];
    const crossingX = value.layout.edges[1]?.route?.points[0]?.x as number;
    const segment = requestedSegment(points, "middle");
    const label = labelBox(value.layout);
    // The middle is where the other route crosses; the label moved off it.
    expect((segment[0].x + segment[1].x) / 2).toBeCloseTo(crossingX, 0);
    expect(label.x > crossingX + g - 1e-6 || label.x + label.width < crossingX - g + 1e-6).toBe(
      true,
    );
    expectBeside(label, segment, side, { centerOnSegment: true });
    expect(checkRoutes(value.ir, value.layout).labelCollisions).toEqual([]);
  });

  test("a place clear of everything is kept on the requested side even if the other side is clear", () => {
    const value = crossing({ labelAt: "end", labelSide: "right" });
    const points = value.layout.edges[0]?.route?.points ?? [];
    expectBeside(labelBox(value.layout), requestedSegment(points, "end"), "right", {
      centerOnSegment: true,
    });
  });
});
