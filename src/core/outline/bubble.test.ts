import { expect, test } from "bun:test";
import { bubble } from "./bubble";

test("body and outward wedge form exactly one closed path, while ports exclude the wedge", () => {
  const label = { width: 120, height: 64 };
  for (const tail of ["none", "left", "right", "top", "bottom"] as const) {
    const params = bubble.params.parse({ tail, tailSize: 12 });
    const footprint = bubble.footprint(label, params);
    expect(footprint.width).toBe(138 + (tail === "left" || tail === "right" ? 12 : 0));
    expect(footprint.height).toBe(82 + (tail === "top" || tail === "bottom" ? 12 : 0));
    const d = bubble.draw({ x: 0, y: 0, ...footprint }, params);
    expect(d.layers).toEqual([{ role: "body", path: { points: d.outline, closed: true } }]);
    const axis = tail === "left" || tail === "right" ? "x" : "y";
    const values = d.outline.map((p) => p[axis]);
    const ports = d.portOutline?.map((p) => p[axis]) ?? [];
    if (tail === "left" || tail === "top") {
      expect(Math.min(...values)).toBeCloseTo(0, 8);
      expect(Math.min(...ports)).toBeCloseTo(12, 8);
    } else if (tail !== "none") {
      expect(Math.max(...values) - Math.max(...ports)).toBeCloseTo(12, 8);
    } else expect(d.outline).toEqual(d.portOutline ?? []);
    expect(d.safeArea.width).toBeGreaterThanOrEqual(label.width);
    expect(d.safeArea.height).toBeGreaterThanOrEqual(label.height);
  }
});

test("tail position is measured from top/left; start replaces the corner and stays in the footprint", () => {
  for (const tail of ["left", "right", "top", "bottom"] as const) {
    const horizontal = tail === "left" || tail === "right";
    const tip = (tailAt: string | number) => {
      const params = bubble.params.parse({ tail, tailAt });
      const d = bubble.draw({ x: 0, y: 0, width: 240, height: 240 }, params);
      const value = tail === "left" || tail === "top" ? 0 : 240;
      return d.outline.find((p) => Math.abs((horizontal ? p.x : p.y) - value) < 1e-8);
    };
    const along = (p: ReturnType<typeof tip>) => (horizontal ? p?.y : p?.x);
    expect(along(tip("start"))).toBeLessThan(along(tip("center")) ?? 0);
    expect(along(tip("end"))).toBeGreaterThan(along(tip("center")) ?? 0);
    expect(tip(0)).toEqual(tip("start"));
    expect(tip(999)).toEqual(tip("end"));
    expect(along(tip("start"))).toBeCloseTo(0, 8);
    expect(along(tip(80))).toBeCloseTo(80 - 12 * 0.8, 8);
  }
});

test("hook roots are tangent-continuous, with a sharp asymmetric tip and concave return", () => {
  for (const tail of ["left", "right", "top", "bottom"] as const) {
    for (const tailAt of ["start", "center", "end", 80] as const) {
      const d = bubble.draw(
        { x: 0, y: 0, width: 240, height: 240 },
        bubble.params.parse({ tail, tailAt }),
      );
      const points = d.outline;
      const reversed = tail === "left" || tail === "bottom";
      const hook = reversed ? points.slice(0, 65).reverse() : points.slice(0, 65);
      const local = hook.map((p) => ({
        along: tail === "left" || tail === "right" ? p.y : p.x,
        out:
          tail === "left"
            ? 12 - p.x
            : tail === "right"
              ? p.x - 228
              : tail === "top"
                ? 12 - p.y
                : p.y - 228,
      }));
      const first = local[0];
      const next = local[1];
      const tip = local[32];
      const beforeLast = local[63];
      const last = local[64];
      const mid = local[48];
      if (!first || !next || !tip || !beforeLast || !last || !mid) throw new Error("missing hook");
      expect(tip.out).toBeCloseTo(12, 8);
      expect(tip.along - first.along).toBeLessThan(last.along - tip.along);
      // Polygon chords converge to the analytic tangents at both roots.
      if (tailAt === "start") {
        expect(Math.abs(next.along - first.along) / Math.abs(next.out - first.out)).toBeLessThan(
          0.01,
        );
      } else {
        expect(Math.abs(next.out - first.out) / Math.abs(next.along - first.along)).toBeLessThan(
          0.1,
        );
      }
      expect(
        Math.abs(last.out - beforeLast.out) / Math.abs(last.along - beforeLast.along),
      ).toBeLessThan(0.03);
      const linearOut = (tip.out * (last.along - mid.along)) / (last.along - tip.along);
      expect(mid.out).toBeLessThan(linearOut);
      for (const i of [0, 64]) {
        const a = points[(i + points.length - 1) % points.length];
        const b = points[i];
        const c = points[(i + 1) % points.length];
        if (!a || !b || !c) throw new Error("missing root neighbors");
        const u = { x: b.x - a.x, y: b.y - a.y };
        const v = { x: c.x - b.x, y: c.y - b.y };
        expect(u.x * v.x + u.y * v.y).toBeGreaterThan(0);
        expect(
          Math.abs(u.x * v.y - u.y * v.x) / (Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y)),
        ).toBeLessThan(0.12);
      }
      for (const p of points) {
        expect(p.x).toBeGreaterThanOrEqual(-1e-8);
        expect(p.y).toBeGreaterThanOrEqual(-1e-8);
        expect(p.x).toBeLessThanOrEqual(240 + 1e-8);
        expect(p.y).toBeLessThanOrEqual(240 + 1e-8);
      }
    }
  }
});
