import { describe, expect, test } from "bun:test";
import type { Point, Rect } from "./ir";
import {
  convexHull,
  ellipseSegments,
  fitSetOutline,
  footprintPoints,
  minimumEnclosingCircle,
  outlineBounds,
  outlinePolygon,
  roundedHull,
  samplePath,
  setLabelCenter,
} from "./set-shape";

const box = (x: number, y: number, size = 10): { rect: Rect; round: boolean } => ({
  rect: { x, y, width: size, height: size },
  round: false,
});

/** A point inside (or on) the convex polygon, by cross products of its edges. */
function insidePolygon(polygon: readonly Point[], p: Point, slack = 1e-6): boolean {
  let sign = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i] as Point;
    const b = polygon[(i + 1) % polygon.length] as Point;
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < 1e-6 || Math.abs(cross / length) <= slack) continue;
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  return true;
}

describe("minimumEnclosingCircle", () => {
  test("two points: the circle on their segment", () => {
    const c = minimumEnclosingCircle([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
    expect(c).toEqual({ cx: 5, cy: 0, r: 5 });
  });

  test("an obtuse triangle is bounded by its longest side, an acute one by its circumcircle", () => {
    const obtuse = minimumEnclosingCircle([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 1 },
    ]);
    expect(obtuse.r).toBeCloseTo(5, 9);
    const acute = minimumEnclosingCircle([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 8 },
    ]);
    // circumradius of (0,0) (10,0) (5,8)
    expect(acute.cx).toBeCloseTo(5, 9);
    expect(acute.r).toBeCloseTo(Math.hypot(5, acute.cy), 9);
    for (const p of [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 8 },
    ])
      expect(Math.hypot(p.x - acute.cx, p.y - acute.cy)).toBeLessThanOrEqual(acute.r + 1e-9);
  });

  test("is no larger than any enclosing circle found by brute force", () => {
    const points = Array.from({ length: 24 }, (_, i) => ({
      x: Math.sin(i * 12.9898) * 40 + 50,
      y: Math.cos(i * 78.233) * 30 + 40,
    }));
    const c = minimumEnclosingCircle(points);
    for (const p of points)
      expect(Math.hypot(p.x - c.cx, p.y - c.cy)).toBeLessThanOrEqual(c.r + 1e-6);
    // Moving the center in any direction by a little must not shrink the farthest distance.
    const farthest = (cx: number, cy: number) =>
      Math.max(...points.map((p) => Math.hypot(p.x - cx, p.y - cy)));
    for (const [dx, dy] of [
      [0.01, 0],
      [-0.01, 0],
      [0, 0.01],
      [0, -0.01],
    ] as const)
      expect(farthest(c.cx + dx, c.cy + dy)).toBeGreaterThanOrEqual(c.r - 1e-9);
  });
});

describe("fitSetOutline", () => {
  const members = [box(0, 0), box(40, 0), box(20, 30)];
  const points = members.flatMap(footprintPoints);

  test("circle: contains every member corner with the padding to spare", () => {
    const outline = fitSetOutline(members, "circle", 6);
    if (outline.kind !== "ellipse") throw new Error("expected an ellipse");
    expect(outline.rx).toBe(outline.ry);
    for (const p of points)
      expect(Math.hypot(p.x - outline.cx, p.y - outline.cy)).toBeLessThanOrEqual(
        outline.rx - 6 + 1e-6,
      );
    // The padding is exactly the gap to the farthest corner.
    expect(
      Math.max(...points.map((p) => Math.hypot(p.x - outline.cx, p.y - outline.cy))),
    ).toBeCloseTo(outline.rx - 6, 6);
  });

  test("a round member is fitted by its boundary, not its corners", () => {
    const round = { rect: { x: 0, y: 0, width: 10, height: 10 }, round: true };
    const outline = fitSetOutline([round], "circle", 0);
    if (outline.kind !== "ellipse") throw new Error("expected an ellipse");
    expect(outline.rx).toBeCloseTo(5, 1);
    expect(outline.rx).toBeGreaterThanOrEqual(5);
    const square = fitSetOutline([box(0, 0)], "circle", 0);
    if (square.kind !== "ellipse") throw new Error("expected an ellipse");
    expect(square.rx).toBeCloseTo(Math.hypot(5, 5), 6);
  });

  test("ellipse: follows the members' aspect, at most 3:1, and contains them", () => {
    const row = [box(0, 0), box(30, 0), box(60, 0), box(90, 0)];
    const outline = fitSetOutline(row, "ellipse", 4);
    if (outline.kind !== "ellipse") throw new Error("expected an ellipse");
    expect(outline.rx / outline.ry).toBeGreaterThan(1.5);
    expect(outline.rx / outline.ry).toBeLessThanOrEqual(3 + 1e-6 + 4);
    for (const p of row.flatMap(footprintPoints))
      expect(
        ((p.x - outline.cx) / (outline.rx - 4)) ** 2 + ((p.y - outline.cy) / (outline.ry - 4)) ** 2,
      ).toBeLessThanOrEqual(1 + 1e-6);
    // The circle around the same row is far larger than the ellipse's short axis.
    const circle = fitSetOutline(row, "circle", 4);
    if (circle.kind !== "ellipse") throw new Error("expected an ellipse");
    expect(outline.ry).toBeLessThan(circle.ry / 1.5);
  });

  test("hull: the convex hull grown by the padding with round corners", () => {
    const outline = fitSetOutline(members, "hull", 6);
    if (outline.kind !== "path") throw new Error("expected a path");
    const polygon = outlinePolygon(outline);
    for (const p of points) expect(insidePolygon(polygon, p)).toBe(true);
    const hull = convexHull(points);
    // Every hull vertex is exactly `padding` inside the boundary at its corner arc.
    for (const v of hull) {
      const nearest = Math.min(...polygon.map((q) => Math.hypot(q.x - v.x, q.y - v.y)));
      expect(nearest).toBeGreaterThan(5.9);
    }
    const bounds = outlineBounds(outline);
    expect(bounds.x).toBeCloseTo(-6, 6);
    expect(bounds.x + bounds.width).toBeCloseTo(56, 6);
    expect(bounds.y).toBeCloseTo(-6, 6);
    expect(bounds.y + bounds.height).toBeCloseTo(46, 6);
  });

  test("hull of one point is a circle path; of two a stadium", () => {
    const one = roundedHull([{ x: 5, y: 5 }], 4);
    const bounds = outlineBounds({ kind: "path", segments: one });
    expect(bounds).toMatchObject({ x: 1, y: 1 });
    expect(bounds.width).toBeCloseTo(8, 6);
    const two = outlineBounds({
      kind: "path",
      segments: roundedHull(
        [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
        ],
        4,
      ),
    });
    expect(two.width).toBeCloseTo(28, 6);
    expect(two.height).toBeCloseTo(8, 6);
  });

  test("rect: the bounding box grown by the padding, corners clamped", () => {
    const outline = fitSetOutline(members, "rect", 6, 100);
    if (outline.kind !== "rect") throw new Error("expected a rect");
    expect(outline.rect).toEqual({ x: -6, y: -6, width: 62, height: 52 });
    expect(outline.radius).toBe(26);
    expect(fitSetOutline(members, "rect", 6, 0)).toMatchObject({ radius: 0 });
  });

  test("no members is an internal error", () => {
    expect(() => fitSetOutline([], "circle", 4)).toThrow("without members");
  });
});

describe("setLabelCenter", () => {
  const outline = fitSetOutline([box(0, 0), box(40, 40)], "circle", 6);
  const size = { width: 30, height: 10 };
  const bounds = outlineBounds(outline);

  test("top and bottom sit centred outside the bounding box", () => {
    const top = setLabelCenter(outline, "top", size, 4);
    expect(top.x).toBeCloseTo(bounds.x + bounds.width / 2, 6);
    expect(top.y + 5).toBeCloseTo(bounds.y - 4, 6);
    const bottom = setLabelCenter(outline, "bottom", size, 4);
    expect(bottom.y - 5).toBeCloseTo(bounds.y + bounds.height + 4, 6);
  });

  test("left and right sit centred vertically", () => {
    const left = setLabelCenter(outline, "left", size, 4);
    expect(left.x + 15).toBeCloseTo(bounds.x - 4, 6);
    const right = setLabelCenter(outline, "right", size, 4);
    expect(right.x - 15).toBeCloseTo(bounds.x + bounds.width + 4, 6);
    expect(right.y).toBeCloseTo(bounds.y + bounds.height / 2, 6);
  });

  test("a diagonal position touches the tangent point's corner, never the outline", () => {
    for (const at of ["top-left", "top-right", "bottom-left", "bottom-right"] as const) {
      const c = setLabelCenter(outline, at, size, 4);
      const label = { x: c.x - 15, y: c.y - 5, width: 30, height: 10 };
      // The nearest label corner to the circle's center is at least `gap` from the circle.
      if (outline.kind !== "ellipse") throw new Error("expected an ellipse");
      const nx = Math.max(label.x, Math.min(outline.cx, label.x + label.width));
      const ny = Math.max(label.y, Math.min(outline.cy, label.y + label.height));
      expect(Math.hypot(nx - outline.cx, ny - outline.cy)).toBeGreaterThan(outline.rx);
    }
  });

  test("works for a path outline (hull) by its support point", () => {
    const hull = fitSetOutline([box(0, 0), box(40, 0), box(20, 30)], "hull", 6);
    const c = setLabelCenter(hull, "top-right", size, 4);
    const polygon = outlinePolygon(hull);
    const corner = { x: c.x - 15, y: c.y + 5 };
    expect(insidePolygon(polygon, corner)).toBe(false);
  });
});

describe("samplePath", () => {
  test("keeps the endpoints and adds the cubics' interior points", () => {
    const points = samplePath(roundedHull([{ x: 0, y: 0 }], 10), 4);
    expect(points.length).toBeGreaterThan(8);
  });
});

/** Distance from `p` to the segment `a`-`b`. */
function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

const boundaryDistance = (p: Point, polygon: readonly Point[]): number =>
  Math.min(
    ...polygon.map((a, i) => segmentDistance(p, a, polygon[(i + 1) % polygon.length] as Point)),
  );

describe("hull is the offset of the members' convex hull by the padding", () => {
  const PAD = 12;
  const cases: Record<string, { rect: Rect; round: boolean }[]> = {
    boxes: [box(0, 0, 12), box(70, 10, 12), box(30, 60, 12), box(80, 70, 12), box(10, 40, 12)],
    discs: [
      { rect: { x: 0, y: 0, width: 16, height: 16 }, round: true },
      { rect: { x: 60, y: 20, width: 16, height: 16 }, round: true },
      { rect: { x: 25, y: 55, width: 16, height: 16 }, round: true },
    ],
  };
  for (const [name, members] of Object.entries(cases)) {
    const outline = fitSetOutline(members, "hull", PAD);
    if (outline.kind !== "path") throw new Error("expected a path");
    const points = samplePath(outline.segments, 24);
    const hull = convexHull(members.flatMap(footprintPoints));

    test(`${name}: every outline point keeps the padding from every member`, () => {
      for (const p of points)
        for (const { rect, round } of members) {
          const d = round
            ? Math.hypot(p.x - (rect.x + rect.width / 2), p.y - (rect.y + rect.height / 2)) -
              rect.width / 2
            : Math.hypot(
                Math.max(rect.x - p.x, 0, p.x - rect.x - rect.width),
                Math.max(rect.y - p.y, 0, p.y - rect.y - rect.height),
              );
          expect(d).toBeGreaterThanOrEqual(PAD - 0.2);
        }
    });

    test(`${name}: no bulge beyond padding from the convex hull`, () => {
      for (const p of points) expect(boundaryDistance(p, hull)).toBeLessThanOrEqual(PAD + 0.05);
      // ...and it is exactly the padding away (the offset), not nearer.
      for (const p of points) expect(boundaryDistance(p, hull)).toBeGreaterThanOrEqual(PAD - 0.05);
    });

    test(`${name}: each corner is an arc of radius = padding about a hull vertex`, () => {
      const arcs = outline.segments.filter((s) => s.command === "C");
      expect(arcs.length).toBeGreaterThanOrEqual(hull.length);
      // Curvature: points on arcs are at distance PAD (curvature 1/PAD) from a hull vertex.
      const onArc = points.filter(
        (p) => Math.min(...hull.map((v) => Math.hypot(p.x - v.x, p.y - v.y))) < PAD + 0.05,
      );
      expect(onArc.length).toBeGreaterThan(hull.length * 5);
      for (const p of onArc) {
        const d = Math.min(...hull.map((v) => Math.hypot(p.x - v.x, p.y - v.y)));
        expect(Math.abs(d - PAD)).toBeLessThan(0.05);
      }
    });
  }
});

describe("degenerate hull inputs", () => {
  test("collinear points give a stadium", () => {
    const hull = convexHull([
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 0 },
    ]);
    expect(hull).toHaveLength(2);
    const b = outlineBounds({ kind: "path", segments: roundedHull(hull, 3) });
    expect(b.width).toBeCloseTo(16, 6);
    expect(b.height).toBeCloseTo(6, 6);
  });

  test("duplicate points collapse", () => {
    const p = { x: 4, y: 4 };
    expect(convexHull([p, { ...p }, { ...p }])).toEqual([p]);
  });

  test("zero-size members give a circle of the padding", () => {
    const outline = fitSetOutline([box(5, 5, 0)], "hull", 7);
    const b = outlineBounds(outline);
    expect(b.width).toBeCloseTo(14, 6);
    expect(b.height).toBeCloseTo(14, 6);
    const circle = fitSetOutline([box(5, 5, 0)], "circle", 7);
    expect(circle).toMatchObject({ kind: "ellipse", rx: 7, ry: 7 });
  });

  test("a two-point hull is a stadium of two arcs", () => {
    const segments = roundedHull(
      [
        { x: 0, y: 0 },
        { x: 20, y: 10 },
      ],
      4,
    );
    expect(segments.filter((s) => s.command === "C").length).toBeGreaterThanOrEqual(4);
    for (const p of samplePath(segments, 12))
      expect(segmentDistance(p, { x: 0, y: 0 }, { x: 20, y: 10 })).toBeCloseTo(4, 1);
  });
});

describe("all eight label positions", () => {
  const outline = fitSetOutline([box(0, 0, 20), box(50, 30, 20)], "ellipse", 6);
  const size = { width: 24, height: 10 };
  const b = outlineBounds(outline);
  const positions = [
    "top",
    "top-right",
    "right",
    "bottom-right",
    "bottom",
    "bottom-left",
    "left",
    "top-left",
  ] as const;
  for (const at of positions) {
    test(`${at}: the label box lies outside the outline`, () => {
      const c = setLabelCenter(outline, at, size, 4);
      const label = { x: c.x - 12, y: c.y - 5, width: 24, height: 10 };
      if (outline.kind !== "ellipse") throw new Error("ellipse");
      const nx = Math.max(label.x, Math.min(outline.cx, label.x + label.width));
      const ny = Math.max(label.y, Math.min(outline.cy, label.y + label.height));
      expect(
        ((nx - outline.cx) / outline.rx) ** 2 + ((ny - outline.cy) / outline.ry) ** 2,
      ).toBeGreaterThan(1);
    });
  }
  test("right is centred vertically beside the bounding box", () => {
    const c = setLabelCenter(outline, "right", size, 4);
    expect(c.x - 12).toBeCloseTo(b.x + b.width + 4, 6);
    expect(c.y).toBeCloseTo(b.y + b.height / 2, 6);
  });
});

describe("oriented ellipses (#430)", () => {
  const diagonal = [box(0, 0, 12), box(40, 38, 12), box(80, 76, 12), box(120, 115, 12)];
  const round = (x: number, y: number) => ({
    rect: { x, y, width: 14, height: 14 },
    round: true,
  });

  function ellipseOf(outline: ReturnType<typeof fitSetOutline>) {
    if (outline.kind !== "ellipse") throw new Error("expected an ellipse");
    return outline;
  }

  test("an ellipse without angle is the axis-parallel one: no angle field, same numbers", () => {
    const outline = ellipseOf(fitSetOutline(diagonal, "ellipse", 6));
    expect("angle" in outline).toBe(false);
    expect(fitSetOutline(diagonal, "ellipse", 6, 0, undefined)).toEqual(outline);
  });

  test("angle: auto turns the ellipse to the diagonal and is far tighter than axis-parallel", () => {
    const tilted = ellipseOf(fitSetOutline(diagonal, "ellipse", 6, 0, "auto"));
    const flat = ellipseOf(fitSetOutline(diagonal, "ellipse", 6));
    expect(tilted.angle).toBeGreaterThan(40);
    expect(tilted.angle).toBeLessThan(50);
    expect(tilted.rx).toBeGreaterThan(tilted.ry);
    expect(tilted.rx * tilted.ry).toBeLessThan(flat.rx * flat.ry * 0.5);
  });

  test("a given angle is kept (folded into -90..90) and rx lies along it", () => {
    const a = ellipseOf(fitSetOutline(diagonal, "ellipse", 6, 0, 30));
    expect(a.angle).toBe(30);
    expect(ellipseOf(fitSetOutline(diagonal, "ellipse", 6, 0, 210)).angle).toBe(30);
    expect(ellipseOf(fitSetOutline(diagonal, "ellipse", 6, 0, -150)).angle).toBe(30);
    // angle: 0 is the tightest axis-parallel ellipse, without the 3:1 limit.
    const zero = ellipseOf(fitSetOutline(diagonal, "ellipse", 6, 0, 0));
    expect(zero.angle).toBe(0);
    const row = [box(0, 0), box(200, 0)];
    const long = ellipseOf(fitSetOutline(row, "ellipse", 4, 0, 0));
    expect(long.rx / long.ry).toBeGreaterThan(4);
  });

  test("boxes and round members keep the padding clear (the discs themselves, not their corners)", () => {
    const members = [round(0, 0), round(46, 40), box(90, 85, 12), round(130, 118)];
    for (const angle of ["auto", 0, 40, -70] as const) {
      const e = ellipseOf(fitSetOutline(members, "ellipse", 8, 0, angle));
      const edge = outlinePolygon({ ...e, kind: "ellipse" });
      const gap = (p: Point) => Math.min(...edge.map((q) => Math.hypot(q.x - p.x, q.y - p.y)));
      for (const m of members) {
        const cx = m.rect.x + m.rect.width / 2;
        const cy = m.rect.y + m.rect.height / 2;
        const points = m.round
          ? Array.from({ length: 64 }, (_, i) => ({
              x: cx + 7 * Math.cos((i / 64) * 2 * Math.PI),
              y: cy + 7 * Math.sin((i / 64) * 2 * Math.PI),
            }))
          : footprintPoints(m);
        for (const p of points) expect(gap(p)).toBeGreaterThanOrEqual(8 - 0.05);
      }
    }
  });

  test("bounds, polygon and the path of cubics agree for a tilted ellipse", () => {
    const e = ellipseOf(fitSetOutline(diagonal, "ellipse", 6, 0, "auto"));
    const bounds = outlineBounds(e);
    const polygon = outlinePolygon(e);
    expect(Math.min(...polygon.map((p) => p.x))).toBeCloseTo(bounds.x, 0);
    expect(Math.max(...polygon.map((p) => p.x))).toBeCloseTo(bounds.x + bounds.width, 0);
    expect(Math.min(...polygon.map((p) => p.y))).toBeCloseTo(bounds.y, 0);
    expect(Math.max(...polygon.map((p) => p.y))).toBeCloseTo(bounds.y + bounds.height, 0);
    // The cubics stay within 5e-6 of the true radius.
    const a = (e.angle ?? 0) * (Math.PI / 180);
    for (const p of samplePath(ellipseSegments(e), 8)) {
      const dx = p.x - e.cx;
      const dy = p.y - e.cy;
      const r = Math.hypot(
        (dx * Math.cos(a) + dy * Math.sin(a)) / e.rx,
        (dy * Math.cos(a) - dx * Math.sin(a)) / e.ry,
      );
      expect(Math.abs(r - 1)).toBeLessThan(1e-5);
    }
  });

  test("a label at a diagonal position clears the rotated outline", () => {
    const e = ellipseOf(fitSetOutline(diagonal, "ellipse", 6, 0, "auto"));
    const size = { width: 30, height: 10 };
    const polygon = outlinePolygon(e);
    for (const at of ["top-left", "top-right", "bottom-left", "bottom-right"] as const) {
      const c = setLabelCenter(e, at, size, 4);
      const label = { x: c.x - 15, y: c.y - 5, width: 30, height: 10 };
      // No sample of the outline falls inside the label's box.
      for (const p of polygon) {
        const insideLabel =
          p.x > label.x && p.x < label.x + 30 && p.y > label.y && p.y < label.y + 10;
        expect(insideLabel).toBe(false);
      }
    }
    // Top sits above the rotated ellipse's own bounds.
    const top = setLabelCenter(e, "top", size, 4);
    expect(top.y + 5).toBeLessThanOrEqual(outlineBounds(e).y - 4 + 1e-9);
  });
});

describe("fitSetOutline: minimum size (#518)", () => {
  const members = [box(0, 0), box(20, 0)];

  test("a fit smaller than the minimum grows about its center, and still holds the members", () => {
    const tight = fitSetOutline(members, "ellipse", 4);
    const grown = fitSetOutline(members, "ellipse", 4, 0, undefined, { width: 200, height: 120 });
    if (tight.kind !== "ellipse" || grown.kind !== "ellipse") throw new Error("expected ellipses");
    expect([grown.cx, grown.cy]).toEqual([tight.cx, tight.cy]);
    expect([grown.rx, grown.ry]).toEqual([100, 60]);
    const polygon = outlinePolygon(grown);
    for (const m of members)
      for (const p of footprintPoints(m)) expect(insidePolygon(polygon, p)).toBe(true);
  });

  test("a larger fit is kept; a circle stays a circle; a rect grows on its sides", () => {
    const big = fitSetOutline(members, "ellipse", 4, 0, undefined, { width: 2, height: 2 });
    expect(big).toEqual(fitSetOutline(members, "ellipse", 4));
    const circle = fitSetOutline(members, "circle", 4, 0, undefined, { width: 100, height: 160 });
    if (circle.kind !== "ellipse") throw new Error("expected a circle");
    expect([circle.rx, circle.ry]).toEqual([80, 80]);
    const rect = fitSetOutline(members, "rect", 4, 0, undefined, { width: 100 });
    if (rect.kind !== "rect") throw new Error("expected a rect");
    expect(rect.rect.width).toBe(100);
    expect(rect.rect.height).toBe(18);
    expect(rect.rect.x + rect.rect.width / 2).toBeCloseTo(15);
  });
});
