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

test("side horns join the corner arc, mirror exactly, and never scale with height", () => {
  const r = 28;
  for (const height of [84, 240, 600]) {
    const local = (["left", "right"] as const).map((tail) => {
      const d = bubble.draw({ x: 0, y: 0, width: 240, height }, bubble.params.parse({ tail }));
      const horn = d.outline.slice(0, 65);
      if (tail === "left") horn.reverse();
      const points = horn.map((p) => ({ x: tail === "left" ? p.x - 8.4 : 231.6 - p.x, y: p.y }));
      expect(points[0]?.x).toBeCloseTo(r * (1 - Math.sqrt(1 - 0.77 ** 2)), 8);
      expect(points[0]?.y).toBeCloseTo(r * 0.23, 8);
      expect(points[32]?.x).toBeCloseTo(-r * 0.3, 8);
      expect(points[32]?.y).toBeCloseTo(8.4 * 0.6, 8);
      expect(points[64]?.x).toBeCloseTo(r * (1 - Math.sqrt(1 - 0.3 ** 2)), 8);
      expect(points[64]?.y).toBeCloseTo(r * 0.7, 8);
      const first = points[0];
      const next = points[1];
      const beforeLast = points[63];
      const last = points[64];
      if (!first || !next || !beforeLast || !last) throw new Error("missing horn roots");
      expect(next.x).toBeLessThan(first.x);
      expect(next.y).toBeGreaterThan(first.y);
      expect(
        Math.abs((last.x - beforeLast.x) / (last.y - beforeLast.y) + 0.3 / Math.sqrt(0.91)),
      ).toBeLessThan(0.08);
      // The top edge and its rounded transition survive the horn insertion.
      const top = d.outline.filter((p) => Math.abs(p.y) < 1e-8);
      expect(top.length).toBeGreaterThanOrEqual(2);
      expect(top.some((p) => Math.abs(p.x - (tail === "left" ? 36.4 : 28)) < 1e-8)).toBe(true);
      // Only the arc interval between the two roots is interrupted.
      for (const p of d.portOutline ?? []) {
        const inHornInterval =
          p.y > r * 0.23 + 1e-8 && p.y < r * 0.7 && (tail === "left" ? p.x < 36.4 : p.x > 203.6);
        if (!inHornInterval) expect(d.outline).toContainEqual(p);
      }
      return points;
    });
    for (let i = 0; i < 65; i++) {
      expect(local[0]?.[i]?.x).toBeCloseTo(local[1]?.[i]?.x ?? NaN, 8);
      expect(local[0]?.[i]?.y).toBeCloseTo(local[1]?.[i]?.y ?? NaN, 8);
    }
  }
});

test("side horn tips follow the overhang and both roots lie on the preserved circular corner", () => {
  for (const tail of ["left", "right"] as const) {
    for (const height of [24, 84, 240, 600]) {
      for (const tailSize of [1, 8.4, 80]) {
        const d = bubble.draw(
          { x: 17, y: 31, width: 240, height },
          bubble.params.parse({ tail, tailSize }),
        );
        const horn = d.outline.slice(0, 65);
        if (tail === "left") horn.reverse();
        const size = Math.min(tailSize, 80);
        const side = tail === "left" ? 17 + size : 257 - size;
        const r = Math.min(28, height * 0.49);
        const cx = side + (tail === "left" ? r : -r);
        const cy = 31 + r;
        const tip = horn[32];
        if (!tip) throw new Error("missing tip");
        expect(tip.x).toBeCloseTo(side + (tail === "left" ? -size : size), 8);
        expect(tip.y).toBeCloseTo(31 + Math.min(size * 0.6, height - r * 0.3), 8);
        for (const root of [horn[0], horn[64]]) {
          if (!root) throw new Error("missing root");
          expect(Math.hypot(root.x - cx, root.y - cy)).toBeCloseTo(r, 8);
        }
        const upperY = 31 + r * 0.23;
        const arc = (d.portOutline ?? []).filter(
          (p) => p.y < upperY && (tail === "left" ? p.x <= cx : p.x >= cx),
        );
        expect(arc.length).toBeGreaterThanOrEqual(8);
        for (const p of arc) expect(d.outline).toContainEqual(p);
        // At reference-sized overhangs, the upper lip dips below its root:
        // this is the concave valley, rather than the old convex top replacement.
        if (size <= r * 0.3) {
          expect(Math.max(...horn.slice(0, 33).map((p) => p.y))).toBeGreaterThan(upperY);
          expect(tip.y).toBeLessThan(upperY);
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
