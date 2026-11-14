/**
 * Room for curved self-loops (#544) and the top padding of groups with a title
 * above the border: a loop's bulge and label are part of its node's footprint,
 * so neighbours and frames are placed clear of it.
 */

import { describe, expect, test } from "bun:test";
import { stringify } from "yaml";
import { layoutStructuredFigure } from "../index";
import type { LayoutIR, Rect } from "../ir";
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

/** The bounds of an edge's route and label. */
function loopBounds(layout: LayoutIR): Rect {
  const edge = layout.edges.find((e) => e.route !== undefined);
  const points = edge?.route?.points ?? [];
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

describe("a group with a title above the border", () => {
  test("has the top padding of an untitled group, nested too", () => {
    const top = (labelAt?: string) => {
      const l = lay(
        doc(
          { row: { items: ["o"] } },
          {
            groups: [
              {
                id: "o",
                label: "Outer",
                ...(labelAt && { labelAt }),
                arrange: { row: { items: ["i"] } },
              },
              {
                id: "i",
                label: "Inner",
                ...(labelAt && { labelAt }),
                arrange: { row: { items: ["a"] } },
              },
            ],
            nodes: [box("a")],
          },
        ),
      );
      return rect(l, "a").y - rect(l, "i").y;
    };
    expect(top("above-left")).toBeCloseTo(top(undefined) - labelBand(), 6);
  });
});

/** The label band inside a titled group: the label's height and half the padding. */
function labelBand(): number {
  const l = lay(
    doc(
      { row: { items: ["g"] } },
      {
        groups: [{ id: "g", label: "T", arrange: { row: { items: ["a"] } } }],
        nodes: [box("a")],
      },
    ),
  );
  const l2 = lay(
    doc(
      { row: { items: ["g"] } },
      {
        groups: [{ id: "g", label: "T", labelAt: "above", arrange: { row: { items: ["a"] } } }],
        nodes: [box("a")],
      },
    ),
  );
  return rect(l, "a").y - rect(l, "g").y - (rect(l2, "a").y - rect(l2, "g").y);
}
