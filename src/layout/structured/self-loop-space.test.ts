/**
 * Room for curved self-loops (#544) and the top padding of groups with a title
 * above the border: a loop's bulge and label are part of its node's footprint,
 * so neighbours and frames are placed clear of it.
 */

import { describe, expect, test } from "bun:test";
import { stringify } from "yaml";
import { layoutStructuredFigure } from "../index";
import type { LayoutIR, Rect } from "../ir";
import type { Cubic } from "../route/cubic";
import { sampleCubic } from "../route/cubic";
import type { TextMeasurer } from "../text";

const FAKE: TextMeasurer = {
  lineWidth: (text, _font, size) => ([...text].length * size) / 2,
  verticalMetrics: (_font, size) => ({ ascent: 0.8 * size, descent: 0.2 * size }),
};

function lay(doc: object): LayoutIR {
  const result = layoutStructuredFigure(stringify(doc), { measurer: FAKE });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  return result.value.layout;
}

function rect(layout: LayoutIR, id: string): Rect {
  const found =
    layout.nodes.find((n) => n.key === `n:${id}`) ?? layout.groups.find((g) => g.key === `g:${id}`);
  if (found === undefined) throw new Error(`no ${id}`);
  return found.rect;
}

const box = (id: string) => ({ id, component: "box", label: id.toUpperCase() });
const doc = (arrange: object, extra: object) => ({
  version: 1,
  figure: { id: "t", theme: "paper", layout: { arrange } },
  ...extra,
});
const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** The bounds of the curve of the first routed edge, sampled, and its label. */
function loopBounds(layout: LayoutIR): Rect {
  const edge = layout.edges.find((e) => e.route !== undefined);
  const points = sampleCubic((edge?.route?.points ?? []) as Cubic);
  const label = edge?.route?.label?.box;
  const xs = [...points.map((p) => p.x), ...(label ? [label.x, label.x + label.width] : [])];
  const ys = [...points.map((p) => p.y), ...(label ? [label.y, label.y + label.height] : [])];
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

const inside = (r: Rect, frame: Rect) =>
  r.x >= frame.x - 0.01 &&
  r.y >= frame.y - 0.01 &&
  r.x + r.width <= frame.x + frame.width + 0.01 &&
  r.y + r.height <= frame.y + frame.height + 0.01;

describe("a curved self-loop takes room", () => {
  const loop = { from: "b", to: "b", route: "curve", label: "retry" };

  test("keeps the node above it clear of the loop and its label", () => {
    const layout = lay(
      doc(
        { stack: { gap: "2pt", items: ["a", "b"] } },
        { nodes: [box("a"), box("b")], edges: [loop] },
      ),
    );
    expect(overlaps(loopBounds(layout), rect(layout, "a"))).toBe(false);
  });

  test("opens the gap by the loop's height, and not on a node without a loop", () => {
    const base = { nodes: [box("a"), box("b")] };
    const arrange = { stack: { gap: "2pt", items: ["a", "b"] } };
    const plain = lay(doc(arrange, base));
    const looped = lay(doc(arrange, { ...base, edges: [loop] }));
    const gap = (l: LayoutIR) => rect(l, "b").y - (rect(l, "a").y + rect(l, "a").height);
    expect(gap(looped)).toBeGreaterThan(gap(plain));
    expect(rect(looped, "b").height).toBe(rect(plain, "b").height);
  });

  test("keeps the loop inside the frame of its group", () => {
    const layout = lay(
      doc(
        { row: { items: ["g"] } },
        {
          groups: [{ id: "g", arrange: { row: { items: ["b", "c"] } } }],
          nodes: [box("b"), box("c")],
          edges: [loop],
        },
      ),
    );
    const bounds = loopBounds(layout);
    const frame = rect(layout, "g");
    expect(bounds.y).toBeGreaterThanOrEqual(frame.y);
    expect(bounds.x).toBeGreaterThanOrEqual(frame.x);
  });
});

describe("loops on every side clear neighbours and frames", () => {
  const sides = ["north", "east", "south", "west"] as const;
  const loop = (side: string) => ({
    from: "b",
    to: "b",
    route: "curve",
    label: "retry",
    fromAnchor: `${side}:0.7`,
    toAnchor: `${side}:0.3`,
  });
  const nodesOf = (...ids: string[]) => ids.map(box);
  const nodes = nodesOf("n", "s", "w", "e", "b");
  // b in the middle of a cross, so every side has a neighbour.
  const cross = {
    stack: {
      gap: "2pt",
      items: [
        { row: { items: ["n"] } },
        { row: { gap: "2pt", items: ["w", "b", "e"] } },
        { row: { items: ["s"] } },
      ],
    },
  };

  for (const side of sides) {
    test(`${side}: clear of every neighbour`, () => {
      const layout = lay(doc(cross, { nodes, edges: [loop(side)] }));
      const bounds = loopBounds(layout);
      for (const id of ["n", "s", "w", "e"]) expect(overlaps(bounds, rect(layout, id))).toBe(false);
    });

    test(`${side}: inside nested frames, clear of a sibling`, () => {
      const layout = lay(
        doc(
          { row: { gap: "2pt", items: ["outer", "n"] } },
          {
            groups: [
              {
                id: "outer",
                label: "Outer",
                labelAt: "above-left",
                arrange: { row: { items: ["inner", "e"] } },
              },
              { id: "inner", label: "Inner", arrange: { row: { items: ["b", "w"] } } },
            ],
            nodes: nodesOf("b", "w", "e", "n"),
            edges: [loop(side)],
          },
        ),
      );
      const bounds = loopBounds(layout);
      expect(inside(bounds, rect(layout, "inner"))).toBe(true);
      expect(inside(bounds, rect(layout, "outer"))).toBe(true);
      for (const id of ["w", "e", "n"]) expect(overlaps(bounds, rect(layout, id))).toBe(false);
    });

    test(`${side}: in a place box, inside its frame and clear of the node next to it`, () => {
      const layout = lay(
        doc(
          {
            place: {
              unit: "1pt",
              items: [
                { item: "g", at: [0, 0] },
                { item: "w", at: [70, 0] },
              ],
            },
          },
          {
            groups: [{ id: "g", label: "G", labelAt: "above", arrange: { row: { items: ["b"] } } }],
            nodes: nodesOf("b", "w"),
            edges: [loop(side)],
          },
        ),
      );
      const bounds = loopBounds(layout);
      expect(inside(bounds, rect(layout, "g"))).toBe(true);
      expect(overlaps(bounds, rect(layout, "w"))).toBe(false);
    });
  }
});

describe("a group with a title above the border", () => {
  const single = (labelAt?: string) => {
    const l = lay(
      doc(
        { row: { items: ["g"] } },
        {
          groups: [
            {
              id: "g",
              ...(labelAt && { label: "T", labelAt }),
              arrange: { row: { items: ["a"] } },
            },
          ],
          nodes: [box("a")],
        },
      ),
    );
    return rect(l, "a").y - rect(l, "g").y;
  };
  const nested = (labelAt?: string) => {
    const group = (id: string, items: string[]) => ({
      id,
      ...(labelAt && { label: id, labelAt }),
      arrange: { row: { items } },
    });
    const l = lay(
      doc(
        { row: { items: ["o"] } },
        { groups: [group("o", ["i"]), group("i", ["a"])], nodes: [box("a")] },
      ),
    );
    // The inner title hangs in the outer frame's padding; both frames' own tops are compared.
    return { inner: rect(l, "a").y - rect(l, "i").y, outer: rect(l, "i").y - rect(l, "o").y };
  };

  test("has the top padding of an unlabelled group", () => {
    for (const at of ["above-left", "above", "above-right"])
      expect(single(at)).toBeCloseTo(single(undefined), 6);
    // Inside the border the title does take a row.
    expect(single("top-left")).toBeGreaterThan(single(undefined));
  });

  test("keeps the top padding of an unlabelled group when nested", () => {
    const plain = nested(undefined);
    for (const at of ["above-left", "above", "above-right"])
      expect(nested(at).inner).toBeCloseTo(plain.inner, 6);
  });
});
