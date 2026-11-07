import { expect, test } from "bun:test";
import { bubble } from "./bubble";

test("only the overhang is reserved, and ports and labels stay on the body", () => {
  const label = { width: 120, height: 64 };
  for (const tail of ["none", "left", "right", "top", "bottom"] as const) {
    const params = bubble.params.parse({ tail });
    const footprint = bubble.footprint(label, params);
    expect(footprint.width).toBe(148 + (tail === "left" || tail === "right" ? 8.4 : 0));
    expect(footprint.height).toBe(92 + (tail === "top" || tail === "bottom" ? 8.4 : 0));
    const d = bubble.draw({ x: 0, y: 0, ...footprint }, params);
    expect(d.layers).toEqual([{ role: "body", path: { points: d.outline, closed: true } }]);
    const axis = tail === "left" || tail === "right" ? "x" : "y";
    const values = d.outline.map((p) => p[axis]);
    const ports = d.portOutline?.map((p) => p[axis]) ?? [];
    if (tail === "left" || tail === "top") {
      expect(Math.min(...values)).toBeCloseTo(0, 8);
      expect(Math.min(...ports)).toBeCloseTo(8.4, 8);
    } else if (tail !== "none") {
      expect(Math.max(...values) - Math.max(...ports)).toBeCloseTo(8.4, 8);
    } else expect(d.outline).toEqual(d.portOutline ?? []);
    expect(d.safeArea.width).toBeGreaterThanOrEqual(label.width);
    expect(d.safeArea.height).toBeGreaterThanOrEqual(label.height);
  }
});

test("side horns replace only the top corner, mirror exactly, and never scale with height", () => {
  const r = 28;
  for (const height of [84, 240, 600]) {
    const local = (["left", "right"] as const).map((tail) => {
      const d = bubble.draw({ x: 0, y: 0, width: 240, height }, bubble.params.parse({ tail }));
      const horn = d.outline.slice(0, 65);
      if (tail === "left") horn.reverse();
      const points = horn.map((p) => ({ x: tail === "left" ? p.x - 8.4 : 231.6 - p.x, y: p.y }));
      expect(points[0]?.x).toBeCloseTo(r * 0.8, 8);
      expect(points[0]?.y).toBeCloseTo(0, 8);
      expect(points[32]?.x).toBeCloseTo(-r * 0.3, 8);
      expect(points[32]?.y).toBeCloseTo(r * 0.15, 8);
      expect(points[64]?.x).toBeCloseTo(0, 8);
      expect(points[64]?.y).toBeCloseTo(r * 0.9, 8);
      const first = points[0];
      const next = points[1];
      const beforeLast = points[63];
      const last = points[64];
      if (!first || !next || !beforeLast || !last) throw new Error("missing horn roots");
      expect(Math.abs((next.y - first.y) / (next.x - first.x))).toBeLessThan(0.03);
      expect(Math.abs((last.x - beforeLast.x) / (last.y - beforeLast.y))).toBeLessThan(0.06);
      // Beyond the replaced corner, both top endpoints remain on a straight top edge.
      const top = d.outline.filter((p) => Math.abs(p.y) < 1e-8);
      expect(top.length).toBeGreaterThanOrEqual(3);
      expect(top.some((p) => Math.abs(p.x - (tail === "left" ? 36.4 : 28)) < 1e-8)).toBe(true);
      // Three complete, unchanged quarter-circle arcs survive.
      for (const p of d.portOutline ?? []) {
        const inHornCorner = p.y < r && (tail === "left" ? p.x < 36.4 : p.x > 203.6);
        if (!inHornCorner) expect(d.outline).toContainEqual(p);
      }
      return points;
    });
    for (let i = 0; i < 65; i++) {
      expect(local[0]?.[i]?.x).toBeCloseTo(local[1]?.[i]?.x ?? NaN, 8);
      expect(local[0]?.[i]?.y).toBeCloseTo(local[1]?.[i]?.y ?? NaN, 8);
    }
  }
});

test("side horn upper edges descend monotonically to the tip without an inflection", () => {
  for (const tail of ["left", "right"] as const) {
    for (const height of [24, 84, 240, 600]) {
      for (const tailSize of [1, 8.4, 80]) {
        const d = bubble.draw(
          { x: 17, y: 31, width: 240, height },
          bubble.params.parse({ tail, tailSize }),
        );
        const horn = d.outline.slice(0, 65);
        if (tail === "left") horn.reverse();
        const upper = horn.slice(0, 33);
        const join = upper[0];
        const tip = upper[32];
        if (!join || !tip) throw new Error("missing upper edge");
        expect(join.y).toBeCloseTo(31, 8);
        expect(tip.y).toBeGreaterThan(join.y);
        for (let i = 1; i < upper.length; i++) {
          const a = upper[i - 1];
          const b = upper[i];
          if (!a || !b) throw new Error("missing upper edge sample");
          expect(b.y).toBeGreaterThanOrEqual(a.y);
          expect(b.y).toBeLessThanOrEqual(tip.y);
          const c = upper[i + 1];
          if (c) {
            // Consistent signed turns exclude an S-curve, including in the mirrored horn.
            const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
            expect(cross * (tail === "left" ? -1 : 1)).toBeGreaterThan(0);
          }
        }
      }
    }
  }
});

test("other positions use short symmetric wedges with concave sides and tangent roots", () => {
  for (const tail of ["left", "right", "top", "bottom"] as const) {
    for (const tailAt of ["start", "center", "end", 0, 80, 999] as const) {
      if ((tail === "left" || tail === "right") && tailAt === "start") continue;
      const horizontal = tail === "left" || tail === "right";
      const size = 28 * (horizontal ? 0.5 : 0.6);
      const d = bubble.draw(
        { x: 0, y: 0, width: 240, height: 240 },
        bubble.params.parse({ tail, tailAt, tailSize: size }),
      );
      const wedge = d.outline.slice(0, 65);
      if (tail === "left" || tail === "bottom") wedge.reverse();
      const local = wedge.map((p) => ({
        along: horizontal ? p.y : p.x,
        out:
          tail === "left"
            ? size - p.x
            : tail === "right"
              ? p.x - (240 - size)
              : tail === "top"
                ? size - p.y
                : p.y - (240 - size),
      }));
      const first = local[0];
      const next = local[1];
      const tip = local[32];
      const last = local[64];
      const mid = local[16];
      if (!first || !next || !tip || !last || !mid) throw new Error("missing wedge");
      expect(last.along - first.along).toBeCloseTo(28, 8);
      expect(tip.along).toBeCloseTo((first.along + last.along) / 2, 8);
      expect(tip.out).toBeCloseTo(size, 8);
      expect(Math.abs(next.out / (next.along - first.along))).toBeLessThan(0.03);
      expect(mid.out).toBeLessThan((size * (mid.along - first.along)) / (tip.along - first.along));
      for (let i = 0; i <= 32; i++) {
        expect(local[i]?.out).toBeCloseTo(local[64 - i]?.out ?? NaN, 8);
      }
      for (const p of d.outline) {
        expect(p.x).toBeGreaterThanOrEqual(-1e-8);
        expect(p.y).toBeGreaterThanOrEqual(-1e-8);
        expect(p.x).toBeLessThanOrEqual(240 + 1e-8);
        expect(p.y).toBeLessThanOrEqual(240 + 1e-8);
      }
    }
  }
});
