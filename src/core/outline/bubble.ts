/** Speech bubble geometry in D2 units (0.5pt). Curves use the shared polygon contract. */
import { z } from "zod";
import type { Point, Rect } from "../geometry";
import type { OutlineRenderer } from "./types";

export const bubbleParams = z.strictObject({
  tail: z.enum(["none", "left", "right", "top", "bottom"]).default("none"),
  tailAt: z.union([z.enum(["start", "center", "end"]), z.number().nonnegative()]).default("start"),
  tailSize: z.number().positive().default(12),
  radius: z.number().positive().default(18),
});

export const bubble: OutlineRenderer<z.output<typeof bubbleParams>> = {
  id: "sumi/bubble",
  version: 1,
  params: bubbleParams,
  footprint({ width, height }, { tail, tailSize, radius }) {
    return {
      width: width + radius + (tail === "left" || tail === "right" ? tailSize : 0),
      height: height + radius + (tail === "top" || tail === "bottom" ? tailSize : 0),
    };
  },
  draw(rect, { tail, tailAt, tailSize, radius }) {
    const horizontal = tail === "left" || tail === "right";
    const size =
      tail === "none" ? 0 : Math.min(tailSize, (horizontal ? rect.width : rect.height) / 3);
    const box: Rect = {
      x: rect.x + (tail === "left" ? size : 0),
      y: rect.y + (tail === "top" ? size : 0),
      width: rect.width - (horizontal ? size : 0),
      height: rect.height - (tail === "top" || tail === "bottom" ? size : 0),
    };
    const r = Math.min(radius, box.width / 4, box.height / 4);
    const { x, y, width: w, height: h } = box;
    const corners = [
      { x: x + w - r, y: y + r },
      { x: x + w - r, y: y + h - r },
      { x: x + r, y: y + h - r },
      { x: x + r, y: y + r },
    ];
    let outline: Point[] = [];
    const ports: Point[] = [];
    const distances: number[] = [];
    const quarter = (Math.PI * r) / 2;
    const straight = [h - 2 * r, w - 2 * r, h - 2 * r, w - 2 * r];
    let distance = 0;
    // Clockwise: top-right arc, right side, bottom-right arc, ... .
    for (let corner = 0; corner < 4; corner++) {
      const c = corners[corner] as Point;
      for (let i = 0; i <= 16; i++) {
        const angle = -Math.PI / 2 + (corner * Math.PI) / 2 + (i * Math.PI) / 32;
        const p = { x: c.x + r * Math.cos(angle), y: c.y + r * Math.sin(angle) };
        outline.push(p);
        ports.push(p);
        distances.push(distance + (i * quarter) / 16);
      }
      distance += quarter + (straight[corner] ?? 0);
    }
    if (tail !== "none") {
      const length = horizontal ? h : w;
      const half = Math.min(size, (length - 2 * r) / 4);
      const low = r + half;
      const high = length - r - half;
      const at = Math.max(
        low,
        Math.min(
          high,
          typeof tailAt === "number"
            ? tailAt
            : tailAt === "center"
              ? length / 2
              : tailAt === "end"
                ? high
                : low,
        ),
      );
      const place = (along: number, out: number): Point => {
        switch (tail) {
          case "right":
            return { x: x + w + out, y: y + along };
          case "left":
            return { x: x - out, y: y + along };
          case "top":
            return { x: x + along, y: y - out };
          default:
            return { x: x + along, y: y + h + out };
        }
      };
      const start = at === low;
      const upper = start ? 0 : at - half;
      const lower = start ? r + half * 1.1 : at + half;
      const tip = start ? 0 : upper + half * 0.2;
      const wedge: Point[] = [];
      // Both roots are tangent to the body. At start, replace the rounded
      // corner itself so the upper lip continues the adjacent edge.
      const curve = (a: Point, b: Point, c: Point, d: Point) => {
        for (let i = wedge.length ? 1 : 0; i <= 32; i++) {
          const t = i / 32;
          const u = 1 - t;
          wedge.push(
            place(
              u ** 3 * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t ** 3 * d.x,
              u ** 3 * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t ** 3 * d.y,
            ),
          );
        }
      };
      curve(
        { x: upper, y: start ? -r : 0 },
        { x: start ? 0 : upper + half * 0.6, y: start ? -r * 0.25 : 0 },
        { x: tip + half * 0.16, y: size * 0.55 },
        { x: tip, y: size },
      );
      curve(
        { x: tip, y: size },
        { x: tip + half * 0.75, y: size * 0.35 },
        { x: lower - half * 0.65, y: 0 },
        { x: lower, y: 0 },
      );
      const sideStart = {
        right: quarter,
        bottom: 2 * quarter + h - 2 * r,
        left: 3 * quarter + h + w - 4 * r,
        top: 4 * quarter + 2 * h + w - 6 * r,
      };
      const reversed = tail === "left" || tail === "bottom";
      const onSide = (along: number) =>
        sideStart[tail] + (reversed ? length - r - along : along - r);
      const root = start
        ? reversed
          ? onSide(r) + quarter
          : sideStart[tail] - quarter
        : onSide(upper);
      const from = reversed ? onSide(lower) : root;
      const to = reversed ? root : onSide(lower);
      if (reversed) wedge.reverse();
      const wrap = (s: number) => ((s % distance) + distance) % distance;
      const remaining = ports
        .map((point, i) => ({ point, offset: wrap((distances[i] ?? 0) - to) }))
        .filter(({ offset }) => offset > 1e-8 && offset < wrap(from - to) - 1e-8)
        .sort((a, b) => a.offset - b.offset);
      outline = [...wedge, ...remaining.map(({ point }) => point)];
    }
    return {
      layers: [{ role: "body", path: { points: outline, closed: true } }],
      outline,
      portOutline: ports,
      safeArea: { x: x + r / 2, y: y + r / 2, width: w - r, height: h - r },
    };
  },
};
