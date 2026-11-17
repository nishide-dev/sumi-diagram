import { describe, expect, test } from "bun:test";
import { cuboid, cuboidOffset } from "./cuboid";

const green = "#00ff00";
const block = (extra: object = {}) => ({
  name: "kernel",
  at: [3, 0, 0],
  size: [3, 3, 3],
  fill: "#eeddcc",
  top: "#f6eee6",
  side: "#d8bfae",
  line: "#814b2d",
  inner: "#b79886",
  grid: "#c8a994",
  ...extra,
});
const rect = { x: 0, y: 0, width: 160, height: 140 };
const parse = (extra: object = {}) =>
  cuboid.params.parse({ depth: 80, cells: "6,6,6", gridStroke: green, ...extra });

describe("cuboid cells and blocks", () => {
  test("a grid divides the three visible faces: (nx-1 + ny-1) lines on the front, (nx-1 + nz-1) on the top, (ny-1 + nz-1) on the side", () => {
    const drawing = cuboid.draw(rect, parse({ cells: "4,3,5" }));
    const grid = drawing.layers.filter((l) => l.grid === true);
    expect(grid).toHaveLength(1);
    const lines = [grid[0]?.path, ...(grid[0]?.more ?? [])];
    // Front: 3 + 2, top: 3 + 4, side: 2 + 4, as two lines per interior plane on the faces that show it.
    expect(lines).toHaveLength(2 * (3 + 2 + 4));
    for (const path of lines) expect(path?.closed).toBe(false);
  });

  test("no cells means no grid layer; the layers are the plain cuboid's", () => {
    const drawing = cuboid.draw(rect, cuboid.params.parse({ depth: 80 }));
    expect(drawing.layers).toHaveLength(6);
    expect(drawing.layers.some((l) => l.grid)).toBe(false);
    expect(drawing.parts).toBeUndefined();
  });

  test("grid lines lie on the silhouette's faces (inside the box)", () => {
    const drawing = cuboid.draw(rect, parse());
    for (const layer of drawing.layers.filter((l) => l.grid))
      for (const path of [layer.path, ...(layer.more ?? [])])
        for (const p of path.points) {
          expect(p.x).toBeGreaterThanOrEqual(rect.x - 1e-6);
          expect(p.x).toBeLessThanOrEqual(rect.x + rect.width + 1e-6);
          expect(p.y).toBeGreaterThanOrEqual(rect.y - 1e-6);
          expect(p.y).toBeLessThanOrEqual(rect.y + rect.height + 1e-6);
        }
  });

  test("a block is a smaller solid at its cells: front origin, size and depth follow the cell sizes", () => {
    const params = parse({ blocks: JSON.stringify([block()]) });
    const { dx, dy } = cuboidOffset(params);
    const drawing = cuboid.draw(rect, params);
    const part = drawing.parts?.kernel;
    if (!part) throw new Error("missing part");
    const w = rect.width - dx;
    const h = rect.height - dy;
    // Cells 3..6 along x, 0..3 along y, 0..3 along z: the top right front corner.
    expect(part.faces.front[0]?.x).toBeCloseTo(rect.x + w / 2, 9);
    expect(part.faces.front[0]?.y).toBeCloseTo(rect.y + dy, 9);
    expect(part.faces.front[2]?.x).toBeCloseTo(rect.x + w, 9);
    expect(part.faces.front[2]?.y).toBeCloseTo(rect.y + dy + h / 2, 9);
    // Its depth is half of the cuboid's (3 of 6 cells).
    expect(part.box.width).toBeCloseTo(w / 2 + dx / 2, 9);
    expect(part.box.height).toBeCloseTo(h / 2 + dy / 2, 9);
    // The right face (front-top, back-top, back-bottom, front-bottom) and the hidden left face.
    expect(part.faces.side[1]?.x).toBeCloseTo((part.faces.side[0]?.x ?? 0) + dx / 2, 9);
    expect(part.faces.left[0]).toEqual(part.faces.front[0]);
    expect(part.faces.left[1]?.x).toBeCloseTo((part.faces.front[0]?.x ?? 0) + dx / 2, 9);
  });

  test("blocks are painted after the cuboid, far (large z) ones first, each with its own layers", () => {
    const blocks = [
      block({ name: "a", at: [0, 0, 0], size: [1, 1, 1] }),
      block({ name: "b", at: [2, 0, 4], size: [1, 1, 1] }),
    ];
    const drawing = cuboid.draw(rect, parse({ blocks: JSON.stringify(blocks) }));
    const order = drawing.layers.flatMap((l) => (l.block === undefined ? [] : [l.block]));
    // b (index 1, z = 4) is behind a (index 0): drawn first.
    expect(order[0]).toBe(1);
    expect(order.at(-1)).toBe(0);
    // The parent's layers come before every block's.
    const firstBlock = drawing.layers.findIndex((l) => l.block !== undefined);
    expect(drawing.layers.slice(0, firstBlock).every((l) => l.block === undefined)).toBe(true);
    expect(Object.keys(drawing.parts ?? {}).sort()).toEqual(["a", "b"]);
  });

  test("a block's layers are shaded faces, its grid (if more than one cell), inner edges and a frame", () => {
    const drawing = cuboid.draw(rect, parse({ blocks: JSON.stringify([block()]) }));
    const own = drawing.layers.filter((l) => l.block === 0);
    expect(own.filter((l) => l.shade).map((l) => l.shade)).toEqual(["top", "side", "front"]);
    expect(own.some((l) => l.grid)).toBe(true);
    expect(own.filter((l) => l.inner)).toHaveLength(2);
    expect(own.at(-1)?.path.closed).toBe(true);
    const single = cuboid.draw(
      rect,
      parse({ blocks: JSON.stringify([block({ size: [1, 1, 1] })]) }),
    );
    expect(single.layers.filter((l) => l.block === 0).some((l) => l.grid)).toBe(false);
  });

  test("a block behind the front face shows only the faces on the volume's top and right surfaces", () => {
    const layersOf = (blocks: object[]) => {
      const drawing = cuboid.draw(rect, parse({ blocks: JSON.stringify(blocks) }));
      return {
        drawing,
        own: (index: number) => drawing.layers.filter((l) => l.block === index),
      };
    };
    // Inside (not on the top, the right or the front): hidden by the front, no layers; still a part.
    const inside = layersOf([block({ name: "in", at: [1, 1, 2], size: [1, 1, 1] })]);
    expect(inside.own(0)).toEqual([]);
    expect(Object.keys(inside.drawing.parts ?? {})).toEqual(["in"]);
    // On the top surface: its top face only (no front, no side).
    const top = layersOf([block({ name: "t", at: [1, 0, 2], size: [1, 1, 1] })]);
    expect(top.own(0).flatMap((l) => (l.shade ? [l.shade] : []))).toEqual(["top"]);
    // On the right surface: its side face only.
    const side = layersOf([block({ name: "s", at: [5, 2, 2], size: [1, 1, 1] })]);
    expect(side.own(0).flatMap((l) => (l.shade ? [l.shade] : []))).toEqual(["side"]);
    // On the corner: both, each framed on its own.
    const both = layersOf([block({ name: "b", at: [5, 0, 2], size: [1, 1, 1] })]);
    expect(both.own(0).flatMap((l) => (l.shade ? [l.shade] : []))).toEqual(["top", "side"]);
    const frame = both.own(0).at(-1);
    expect([frame?.path, ...(frame?.more ?? [])].every((path) => path?.closed)).toBe(true);
    // A block at the front plane stands out whole, however deep its range is.
    const front = layersOf([block({ name: "f", at: [1, 1, 0], size: [1, 1, 3] })]);
    expect(front.own(0).flatMap((l) => (l.shade ? [l.shade] : []))).toEqual([
      "top",
      "side",
      "front",
    ]);
    // Parent layers are untouched by blocks.
    expect(inside.drawing.layers.filter((l) => l.block === undefined)).toHaveLength(
      cuboid.draw(rect, parse()).layers.length,
    );
  });
});
