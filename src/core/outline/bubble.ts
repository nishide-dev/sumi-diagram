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
    const outline: Point[] = [];
    const ports: Point[] = [];
    // Clockwise: top-right arc, right side, bottom-right arc, ... .
    for (let corner = 0; corner < 4; corner++) {
      const c = corners[corner] as Point;
      for (let i = 0; i <= 16; i++) {
        const angle = -Math.PI / 2 + (corner * Math.PI) / 2 + (i * Math.PI) / 32;
        const p = { x: c.x + r * Math.cos(angle), y: c.y + r * Math.sin(angle) };
        outline.push(p);
        ports.push(p);
      }
      const side = ["right", "bottom", "left", "top"][corner];
      if (side !== tail) continue;
      const length = horizontal ? h : w;
      const half = Math.min(size * 0.65, (length - 2 * r) / 4);
      const low = r + 2 * half;
      const high = length - r - 2 * half;
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
      // A short swept wedge: tangent at the lower base, a small upward-pointing tip.
      const wedge: Point[] = [place(at - half, 0), place(at - half * 1.4, size)];
      for (let i = 1; i <= 12; i++) {
        const t = i / 12;
        const u = 1 - t;
        wedge.push(
          place(
            u ** 3 * (at - half * 1.4) +
              3 * u * u * t * (at - half * 0.8) +
              3 * u * t * t * (at + half * 0.6) +
              t ** 3 * (at + half),
            u ** 3 * size + 3 * u * u * t * size * 0.15,
          ),
        );
      }
      if (tail === "left" || tail === "bottom") wedge.reverse();
      outline.push(...wedge);
    }
    return {
      layers: [{ role: "body", path: { points: outline, closed: true } }],
      outline,
      portOutline: ports,
      safeArea: { x: x + r / 2, y: y + r / 2, width: w - r, height: h - r },
    };
  },
};
