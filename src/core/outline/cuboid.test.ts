import { describe, expect, test } from "bun:test";
import { cuboid, cuboidOffset, cuboidParams } from "./cuboid";

const parse = (written: object = {}) => cuboid.params.parse({ depth: 40, ...written });
const rect = { x: 10, y: 20, width: 100, height: 80 };

describe("sumi/cuboid geometry", () => {
  test("defaults are 45 degrees and a scale of 0.5, like the up-right offset of layers", () => {
    const params = cuboidParams.parse({ depth: 40 });
    expect(params.angle).toBe(45);
    expect(params.depthScale).toBe(0.5);
    const { dx, dy } = cuboidOffset(params);
    expect(dx).toBeCloseTo(20 * Math.SQRT1_2, 9);
    expect(dy).toBeCloseTo(dx, 9);
  });

  test("the footprint is the front face plus the depth offset, and the label can widen it", () => {
    const params = parse({ width: 30, height: 60 });
    const { dx, dy } = cuboidOffset(params);
    expect(cuboid.footprint({ width: 5, height: 5 }, params)).toEqual({
      width: 30 + dx,
      height: 60 + dy,
    });
    expect(cuboid.footprint({ width: 50, height: 70 }, params)).toEqual({
      width: 50 + dx,
      height: 70 + dy,
    });
  });

  test("footprint is monotone in the label and in the depth", () => {
    const small = cuboid.footprint({ width: 10, height: 10 }, parse());
    const wide = cuboid.footprint({ width: 20, height: 10 }, parse());
    const deep = cuboid.footprint({ width: 10, height: 10 }, parse({ depth: 80 }));
    expect(wide.width).toBeGreaterThanOrEqual(small.width);
    expect(deep.width).toBeGreaterThan(small.width);
    expect(deep.height).toBeGreaterThan(small.height);
  });

  test("three faces, back to front, then the inner edges and the silhouette", () => {
    const drawing = cuboid.draw(rect, parse());
    const { dx, dy } = cuboidOffset(parse());
    expect(
      drawing.layers.map((l) => [l.role, l.shade ?? (l.inner ? "inner" : "silhouette")]),
    ).toEqual([
      ["body", "top"],
      ["body", "side"],
      ["body", "front"],
      ["line", "inner"],
      ["line", "inner"],
      ["line", "silhouette"],
    ]);
    const front = drawing.layers[2]?.path.points ?? [];
    expect(front[0]).toEqual({ x: rect.x, y: rect.y + dy });
    expect(front[2]).toEqual({ x: rect.x + rect.width - dx, y: rect.y + rect.height });
    // Every body is closed with straight (cornered) segments: no rounded corners.
    for (const layer of drawing.layers.filter((l) => l.role === "body"))
      expect(layer.path.closed).toBe(true);
    // The safe area is the front face.
    expect(drawing.safeArea).toEqual({
      x: rect.x,
      y: rect.y + dy,
      width: rect.width - dx,
      height: rect.height - dy,
    });
  });

  test("the outline is the full silhouette, inside the footprint and touching all four sides", () => {
    const { outline } = cuboid.draw(rect, parse());
    expect(outline).toHaveLength(6);
    const xs = outline.map((p) => p.x);
    const ys = outline.map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(rect.x, 9);
    expect(Math.max(...xs)).toBeCloseTo(rect.x + rect.width, 9);
    expect(Math.min(...ys)).toBeCloseTo(rect.y, 9);
    expect(Math.max(...ys)).toBeCloseTo(rect.y + rect.height, 9);
  });

  test("ports: left and right at the front's middle height, top at the back edge's middle, bottom at the front's", () => {
    const params = parse();
    const { dx, dy } = cuboidOffset(params);
    const drawing = cuboid.draw(rect, params);
    const offsets = drawing.portOffsets;
    const w = rect.width - dx;
    const h = rect.height - dy;
    // y of the front's middle, from the top of the footprint.
    expect(offsets?.west).toBeCloseTo((dy + h / 2) / rect.height, 9);
    expect(offsets?.east).toBe(offsets?.west);
    expect(rect.y + (offsets?.west ?? 0) * rect.height).toBeCloseTo(rect.y + dy + h / 2, 9);
    // top: the back edge's middle is the front's centre moved by dx; bottom: the front's centre.
    expect(rect.x + (offsets?.north ?? 0) * rect.width).toBeCloseTo(rect.x + w / 2 + dx, 9);
    expect(rect.x + (offsets?.south ?? 0) * rect.width).toBeCloseTo(rect.x + w / 2, 9);
  });

  test("a thin plate draws exactly the requested front and projection when the footprint holds them", () => {
    const params = parse({ width: 8, height: 100, depth: 120 });
    const { dx, dy } = cuboidOffset(params);
    const footprint = cuboid.footprint({ width: 1, height: 1 }, params);
    const drawing = cuboid.draw({ x: 0, y: 0, ...footprint }, params);
    expect(drawing.safeArea.width).toBeCloseTo(8, 9);
    expect(drawing.safeArea.height).toBeCloseTo(100, 9);
    expect(footprint.width - drawing.safeArea.width).toBeCloseTo(dx, 9);
    expect(footprint.height - drawing.safeArea.height).toBeCloseTo(dy, 9);
  });

  test("faces keep a positive size for a very small footprint", () => {
    const drawing = cuboid.draw({ x: 0, y: 0, width: 2, height: 2 }, parse({ depth: 400 }));
    const { width, height } = drawing.safeArea;
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
  });
});
