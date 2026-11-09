import { describe, expect, test } from "bun:test";
import {
  fitOrientedEllipse,
  foldAngle,
  minimumAreaEllipse,
  minimumAreaEllipseAt,
  type OrientedEllipse,
  paddedHull,
} from "./ellipse-fit";
import type { Point } from "./ir";

/** A small deterministic generator (mulberry32), so the property tests are repeatable. */
function random(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const boundary = (e: OrientedEllipse, steps = 1440): Point[] => {
  const a = (e.angle * Math.PI) / 180;
  return Array.from({ length: steps }, (_, i) => {
    const t = (i / steps) * 2 * Math.PI;
    const u = e.rx * Math.cos(t);
    const v = e.ry * Math.sin(t);
    return {
      x: e.cx + u * Math.cos(a) - v * Math.sin(a),
      y: e.cy + u * Math.sin(a) + v * Math.cos(a),
    };
  });
};

const inside = (e: OrientedEllipse, p: Point): boolean => {
  const a = (e.angle * Math.PI) / 180;
  const dx = p.x - e.cx;
  const dy = p.y - e.cy;
  return (
    ((dx * Math.cos(a) + dy * Math.sin(a)) / e.rx) ** 2 +
      ((dy * Math.cos(a) - dx * Math.sin(a)) / e.ry) ** 2 <=
    1 + 1e-9
  );
};

/** The distance from `p` (inside) to the nearest point of the ellipse's boundary. */
const clearance = (e: OrientedEllipse, p: Point): number =>
  Math.min(...boundary(e).map((b) => Math.hypot(b.x - p.x, b.y - p.y)));

const area = (e: OrientedEllipse) => Math.PI * e.rx * e.ry;
/** The slack of the sampled boundary and the rounding of the fit (layout units). */
const TOLERANCE = 0.01;

describe("foldAngle", () => {
  test("keeps an angle in (-90, 90]", () => {
    expect(foldAngle(0)).toBe(0);
    expect(foldAngle(90)).toBe(90);
    expect(foldAngle(-90)).toBe(90);
    expect(foldAngle(135)).toBe(-45);
    expect(foldAngle(-135)).toBe(45);
    expect(foldAngle(180)).toBeCloseTo(0, 12);
    expect(foldAngle(-180)).toBeCloseTo(0, 12);
  });
});

describe("paddedHull", () => {
  test("every point keeps the padding to the hull's boundary", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 40, y: 10 },
      { x: 20, y: 30 },
      { x: 20, y: 12 },
    ];
    const around = paddedHull(points, 5);
    // The padded hull contains the disc of radius 5 about each point.
    for (const p of points)
      for (let i = 0; i < 64; i++) {
        const a = (i / 64) * 2 * Math.PI;
        const q = { x: p.x + 5 * Math.cos(a), y: p.y + 5 * Math.sin(a) };
        expect(boundaryContains(around, q), `disc point ${i} of (${p.x}, ${p.y})`).toBe(true);
      }
  });
});

function boundaryContains(polygon: readonly Point[], p: Point): boolean {
  let sign = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i] as Point;
    const b = polygon[(i + 1) % polygon.length] as Point;
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (Math.abs(cross) < 1e-9) continue;
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  return true;
}

describe("minimumAreaEllipse", () => {
  test("a diagonal row is fitted along the diagonal", () => {
    const e = fitOrientedEllipse(
      [
        { x: 0, y: 0 },
        { x: 50, y: 50 },
        { x: 100, y: 100 },
      ],
      8,
      "auto",
    );
    expect(e.angle).toBeCloseTo(45, 3);
    expect(e.cx).toBeCloseTo(50, 1);
    expect(e.cy).toBeCloseTo(50, 1);
    expect(e.rx).toBeGreaterThan(e.ry * 4);
  });

  test("the minimum-area ellipse of an axis-parallel rectangle is axis-parallel", () => {
    const e = minimumAreaEllipse([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 10 },
      { x: 0, y: 10 },
    ]);
    // For a rectangle the optimum is the circumscribed ellipse of the same aspect: rx = w/sqrt 2.
    expect(e.rx).toBeCloseTo(20 / Math.SQRT2, 3);
    expect(e.ry).toBeCloseTo(10 / Math.SQRT2, 3);
    expect(Math.abs(e.angle)).toBeLessThan(1e-3);
  });

  test("a circle's points give a circle", () => {
    const points = Array.from({ length: 24 }, (_, i) => ({
      x: 30 + 7 * Math.cos((i / 24) * 2 * Math.PI),
      y: -4 + 7 * Math.sin((i / 24) * 2 * Math.PI),
    }));
    const e = minimumAreaEllipse(points);
    expect(e.rx).toBeCloseTo(7, 2);
    expect(e.ry).toBeCloseTo(7, 2);
  });

  test("a single point or a line still has an area", () => {
    for (const points of [
      [{ x: 3, y: 4 }],
      [
        { x: 0, y: 0 },
        { x: 30, y: 0 },
      ],
    ]) {
      for (const angle of ["auto", 0, 30] as const) {
        const e = fitOrientedEllipse(points, 0, angle);
        expect(e.rx).toBeGreaterThan(0);
        expect(e.ry).toBeGreaterThan(0);
        for (const p of points) expect(inside(e, p)).toBe(true);
      }
    }
  });

  test("is deterministic", () => {
    const points = [
      { x: 1, y: 2 },
      { x: 33, y: 9 },
      { x: 14, y: 41 },
    ];
    expect(fitOrientedEllipse(points, 6, "auto")).toEqual(fitOrientedEllipse(points, 6, "auto"));
  });
});

describe("property: the ellipse contains every point with the padding to spare", () => {
  const rand = random(430);
  const cases = Array.from({ length: 60 }, (_, index) => {
    const count = 1 + Math.floor(rand() * 6);
    const spread = 20 + rand() * 300;
    const tilt = rand() * Math.PI;
    const points = Array.from({ length: count }, () => {
      const along = (rand() - 0.5) * spread;
      const across = (rand() - 0.5) * spread * (rand() < 0.5 ? 0.15 : 1);
      return {
        x: 200 + along * Math.cos(tilt) - across * Math.sin(tilt),
        y: 150 + along * Math.sin(tilt) + across * Math.cos(tilt),
      };
    });
    const padding = rand() < 0.1 ? 0 : 1 + rand() * 25;
    const angle: number | "auto" = index % 3 === 0 ? "auto" : (rand() - 0.5) * 360;
    return { points, padding, angle, index };
  });

  for (const { points, padding, angle, index } of cases) {
    test(`case ${index} (${points.length} points, padding ${padding.toFixed(1)}, angle ${typeof angle === "number" ? angle.toFixed(1) : angle})`, () => {
      const e = fitOrientedEllipse(points, padding, angle);
      for (const p of points) {
        expect(inside(e, p)).toBe(true);
        expect(clearance(e, p)).toBeGreaterThanOrEqual(padding - TOLERANCE);
      }
    });
  }
});

describe("tightness", () => {
  const diagonal: Point[] = [
    { x: 0, y: 0 },
    { x: 30, y: 28 },
    { x: 62, y: 61 },
    { x: 90, y: 92 },
  ];

  test("auto is no larger than the fit at any other angle, and much smaller than axis-parallel", () => {
    const padded = paddedHull(diagonal, 10);
    const best = minimumAreaEllipse(padded);
    for (let angle = -90; angle < 90; angle += 7.5) {
      const other = minimumAreaEllipseAt(padded, angle);
      expect(area(best)).toBeLessThanOrEqual(area(other) * 1.001);
    }
    expect(area(best) * 2).toBeLessThan(area(minimumAreaEllipseAt(padded, 0)));
  });

  test("an explicit angle is honoured: rx lies along it, the ellipse is the tightest for it", () => {
    const e = fitOrientedEllipse(diagonal, 10, 47);
    expect(e.angle).toBe(47);
    // Tighter than the axis-parallel ellipse that has the same clearance.
    expect(area(e)).toBeLessThan(area(fitOrientedEllipse(diagonal, 10, 0)));
    // At the automatic fit's own angle it is the automatic fit.
    const auto = fitOrientedEllipse(diagonal, 10, "auto");
    const same = fitOrientedEllipse(diagonal, 10, auto.angle);
    expect(area(same)).toBeCloseTo(area(auto), -1);
    expect(area(same) / area(auto)).toBeLessThan(1.002);
  });

  test("the clearance is tight: the closest member is no further than the padding plus a little", () => {
    const e = fitOrientedEllipse(diagonal, 10, "auto");
    const nearest = Math.min(...diagonal.map((p) => clearance(e, p)));
    expect(nearest).toBeLessThan(10 * 1.01 + TOLERANCE);
  });
});
