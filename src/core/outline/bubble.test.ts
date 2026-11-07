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

test("tail position is measured from top/left and clamps away from the corners", () => {
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
    expect(along(tip(80))).toBeCloseTo(80 - 12 * 0.65 * 1.4, 8);
  }
});
