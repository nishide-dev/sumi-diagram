/** Independent polygon oracle for renderer contract tests; never imported by product code. */
import assert from "node:assert/strict";
import type { Point, Rect } from "../geometry";
import type { OutlineDrawing } from "./types";

type Polygon = readonly Point[];
type Edge = readonly [Point, Point];
type Interval = [number, number];
const EPS = 1e-8;
const edges = (points: Polygon): Edge[] =>
  points.map((a, i) => [a, points[(i + 1) % points.length] as Point]);
const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;
const subtract = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const near = (a: number, b: number) => Math.abs(a - b) < EPS;

function intersection([a, b]: Edge, [c, d]: Edge): Point | undefined {
  const u = subtract(b, a);
  const v = subtract(d, c);
  const denominator = cross(u, v);
  if (Math.abs(denominator) < EPS * Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y)) {
    if (Math.abs(cross(subtract(c, a), u)) > EPS * Math.hypot(u.x, u.y)) return;
    const within = (p: Point, [p0, p1]: Edge) =>
      p.x >= Math.min(p0.x, p1.x) - EPS &&
      p.x <= Math.max(p0.x, p1.x) + EPS &&
      p.y >= Math.min(p0.y, p1.y) - EPS &&
      p.y <= Math.max(p0.y, p1.y) + EPS;
    return [a, b, c, d].find((p) => within(p, [a, b]) && within(p, [c, d]));
  }
  const t = cross(subtract(c, a), v) / denominator;
  const s = cross(subtract(c, a), u) / denominator;
  const tTolerance = EPS / Math.hypot(u.x, u.y);
  const sTolerance = EPS / Math.hypot(v.x, v.y);
  if (t < -tTolerance || t > 1 + tTolerance || s < -sTolerance || s > 1 + sTolerance) return;
  return { x: a.x + t * u.x, y: a.y + t * u.y };
}

function polygon(points: Polygon): void {
  assert(points.length >= 3, "polygon needs three points");
  let area = 0;
  const lines = edges(points);
  for (const [i, [a, b]] of lines.entries()) {
    assert(Number.isFinite(a.x) && Number.isFinite(a.y), "non-finite polygon point");
    assert(Math.hypot(a.x - b.x, a.y - b.y) > EPS, "duplicate polygon point");
    area += cross(a, b);
    for (let j = i + 2; j < lines.length; j++) {
      if (i === 0 && j === lines.length - 1) continue;
      assert(!intersection([a, b], lines[j] as Edge), "self-intersecting polygon");
    }
  }
  assert(Math.abs(area) > EPS * EPS, "zero-area polygon");
}

const sorted = (values: number[]) =>
  values.sort((a, b) => a - b).filter((x, i, all) => i === 0 || !near(x, all[i - 1] as number));

/** All x events at which a vertical section's edges or their ordering can change. */
function events(polygons: readonly Polygon[]): number[] {
  const all = polygons.flatMap(edges);
  const xs = polygons.flatMap((points) => points.map((p) => p.x));
  for (const [i, edge] of all.entries()) {
    for (const other of all.slice(i + 1)) {
      const hit = intersection(edge, other);
      if (hit) xs.push(hit.x);
    }
  }
  return sorted(xs);
}

/** Use the edges active at probeX, evaluated at x (including slab endpoint limits). */
function section(points: Polygon, probeX: number, x: number): Interval[] {
  const active = edges(points).filter(
    ([a, b]) => Math.min(a.x, b.x) < probeX && probeX < Math.max(a.x, b.x),
  );
  const y = ([a, b]: Edge, at: number) => a.y + ((at - a.x) / (b.x - a.x)) * (b.y - a.y);
  active.sort((a, b) => y(a, probeX) - y(b, probeX));
  assert(active.length % 2 === 0, "unpaired polygon crossings");
  const intervals: Interval[] = [];
  for (let i = 0; i < active.length; i += 2)
    intervals.push([y(active[i] as Edge, x), y(active[i + 1] as Edge, x)]);
  return intervals;
}

function union(intervals: Interval[]): Interval[] {
  const result: Interval[] = [];
  for (const [low, high] of intervals.sort((a, b) => a[0] - b[0])) {
    const last = result[result.length - 1];
    if (last && low <= last[1] + EPS) last[1] = Math.max(last[1], high);
    else result.push([low, high]);
  }
  return result;
}

const rectangle = ({ x, y, width, height }: Rect): Point[] => [
  { x, y },
  { x: x + width, y },
  { x: x + width, y: y + height },
  { x, y: y + height },
];

/** Checks the complete projection, not just a handful of rays from each side. */
function rays(points: Polygon, low: number, high: number): void {
  const xs = sorted(points.map((p) => p.x));
  assert(
    near(xs[0] as number, low) && near(xs[xs.length - 1] as number, high),
    "inward rays miss outline",
  );
  for (let i = 1; i < xs.length; i++) {
    const mid = ((xs[i - 1] as number) + (xs[i] as number)) / 2;
    assert(section(points, mid, mid).length > 0, "inward rays miss outline");
  }
}

/** Exact slab arrangement for straight-edge bodies; tolerances only absorb floating-point noise. */
export function assertOutlineDrawing(drawing: OutlineDrawing, footprint: Rect): void {
  const inside = (p: Point) =>
    p.x >= footprint.x - EPS &&
    p.x <= footprint.x + footprint.width + EPS &&
    p.y >= footprint.y - EPS &&
    p.y <= footprint.y + footprint.height + EPS;
  polygon(drawing.outline);
  const boundaries = drawing.boundaries ?? [drawing.outline];
  for (const boundary of boundaries) polygon(boundary);
  const collision = drawing.collision;
  if (collision?.kind === "polygon") {
    polygon(collision.points);
    const lines = edges(collision.points);
    let orientation = 0;
    for (const [a, b] of lines) {
      const u = subtract(b, a);
      const length = Math.hypot(u.x, u.y);
      for (const point of collision.points) {
        const side: number = cross(u, subtract(point, a)) / length;
        if (Math.abs(side) <= EPS) continue;
        orientation ||= Math.sign(side);
        assert(Math.sign(side) === orientation, "collision polygon must be convex");
      }
    }
    for (const point of drawing.outline) {
      assert(
        lines.every(
          ([a, b]) =>
            (orientation * cross(subtract(b, a), subtract(point, a))) /
              Math.hypot(b.x - a.x, b.y - a.y) >=
            -EPS,
        ),
        "collision does not contain outline",
      );
    }
  } else if (collision?.kind === "ellipse") {
    const { cx, cy, rx, ry } = collision;
    assert(
      [cx, cy, rx, ry].every(Number.isFinite) && rx > 0 && ry > 0,
      "invalid collision ellipse",
    );
    for (const point of drawing.outline) {
      assert(
        Math.hypot((point.x - cx) / rx, (point.y - cy) / ry) <= 1 + EPS,
        "collision does not contain outline",
      );
    }
  }
  const bodies: Polygon[] = [];
  for (const layer of drawing.layers) {
    assert(layer.path.points.length >= 2, "empty path");
    for (const p of layer.path.points)
      assert(Number.isFinite(p.x) && Number.isFinite(p.y) && inside(p), "layer outside footprint");
    if (layer.role === "body") {
      assert(layer.path.closed, "body must be closed");
      polygon(layer.path.points);
      bodies.push(layer.path.points);
    }
  }
  assert(bodies.length > 0, "no body");
  for (const p of drawing.outline) assert(inside(p), "outline outside footprint");
  const safe = drawing.safeArea;
  assert(
    Number.isFinite(safe.width) &&
      Number.isFinite(safe.height) &&
      safe.width > 0 &&
      safe.height > 0,
    "invalid safe area",
  );
  const safePolygon = rectangle(safe);
  for (const p of safePolygon)
    assert(
      Number.isFinite(p.x) && Number.isFinite(p.y) && inside(p),
      "safe area outside footprint",
    );

  const xs = events([...bodies, ...boundaries, drawing.outline, safePolygon]);
  for (let i = 1; i < xs.length; i++) {
    const left = xs[i - 1] as number;
    const right = xs[i] as number;
    const mid = (left + right) / 2;
    // Between events every crossing is affine. Endpoints plus an interior
    // point therefore check the whole slab, including holes and concavities.
    for (const x of [left, mid, right]) {
      const actual = union(bodies.flatMap((body) => section(body, mid, x)));
      const expected = union(boundaries.flatMap((boundary) => section(boundary, mid, x)));
      if (drawing.boundaries) {
        const enclosing = union(section(drawing.outline, mid, x));
        assert(
          actual.every(([low, high]) =>
            enclosing.some(([a, b]) => a <= low + EPS && b >= high - EPS),
          ),
          "body outside enclosing silhouette",
        );
      }
      assert(
        actual.length === expected.length &&
          actual.every(
            (span, j) =>
              near(span[0], expected[j]?.[0] ?? NaN) && near(span[1], expected[j]?.[1] ?? NaN),
          ),
        "body union differs from outline",
      );
      if (safe.x < mid && mid < safe.x + safe.width) {
        assert(
          (drawing.boundaries ? section(drawing.outline, mid, x) : actual).some(
            ([a, b]) => a <= safe.y + EPS && b >= safe.y + safe.height - EPS,
          ),
          "safe area outside body union",
        );
      }
    }
  }
  rays(drawing.outline, footprint.x, footprint.x + footprint.width);
  rays(
    drawing.outline.map(({ x, y }) => ({ x: y, y: x })),
    footprint.y,
    footprint.y + footprint.height,
  );
}
