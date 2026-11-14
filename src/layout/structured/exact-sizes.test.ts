/**
 * Exact sizes and alignment without workarounds (#545): `width` / `height` of
 * a set, `matchWidth`, `straight:span`, cross-axis align struts, and the
 * recipe that lines a spanning group's content up with the columns above.
 */

import { describe, expect, test } from "bun:test";
import { stringify } from "yaml";
import { checkFigure } from "../../core/check";
import type { Diagnostic } from "../../core/diagnostics";
import { layoutStructuredFigure } from "../index";
import type { LayoutIR, Rect } from "../ir";
import type { TextMeasurer } from "../text";

const FAKE: TextMeasurer = {
  lineWidth: (text, _font, size) => ([...text].length * size) / 2,
  verticalMetrics: (_font, size) => ({ ascent: 0.8 * size, descent: 0.2 * size }),
};

function lay(doc: object): { layout: LayoutIR; diagnostics: Diagnostic[] } {
  const result = layoutStructuredFigure(stringify(doc), { measurer: FAKE });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  return { layout: result.value.layout, diagnostics: result.diagnostics };
}

function rect(layout: LayoutIR, id: string): Rect {
  const found =
    layout.nodes.find((n) => n.key === `n:${id}`) ?? layout.groups.find((g) => g.key === `g:${id}`);
  if (found === undefined) throw new Error(`no ${id}`);
  return found.rect;
}

const centerX = (r: Rect) => r.x + r.width / 2;
const doc = (layout: object, nodes: object[], extra: object = {}) => ({
  version: 1,
  figure: { id: "t", theme: "paper", layout },
  nodes,
  ...extra,
});
const box = (id: string, width?: string, extra: object = {}) => ({
  id,
  component: "box",
  label: id,
  ...(width !== undefined && { props: { width, height: "20pt" } }),
  ...extra,
});
const codes = (diagnostics: readonly Diagnostic[]) => diagnostics.map((d) => d.code);
const checked = (doc: object) => checkFigure(stringify(doc)).state.diagnostics;

describe("straight:span", () => {
  const nodes = [box("a", "100pt"), box("p", "50pt"), box("q", "50pt"), box("b", "100pt")];
  const arrange = {
    stack: {
      align: "start",
      gap: "30pt",
      items: [{ row: { gap: "0", items: ["a", "p"] } }, { row: { gap: "0", items: ["q", "b"] } }],
    },
  };
  const edge = (anchor: string) => ({ from: "a", to: "b", fromAnchor: anchor, toAnchor: anchor });

  test("drops straight through the middle of the span the boxes share", () => {
    const { layout, diagnostics } = lay(
      doc({ arrange }, nodes, { edges: [edge("straight:span")] }),
    );
    expect(diagnostics.filter((d) => d.code === "layout/straight-off-side")).toEqual([]);
    const points = layout.edges[0]?.route?.points ?? [];
    expect(points).toHaveLength(2);
    expect(points[0]?.x).toBe(points[1]?.x);
    const shared = (rect(layout, "a").x + rect(layout, "a").width + rect(layout, "b").x) / 2;
    expect(points[0]?.x).toBeCloseTo(shared, 1);
  });

  test("is always the middle of the shared span, even when the centre is over the side", () => {
    // a spans [11, 111], b spans [51, 151]: a's centre (61) is over b, yet the line runs at 81.
    const { layout, diagnostics } = lay(
      doc(
        {
          arrange: {
            stack: {
              align: "start",
              gap: "30pt",
              items: [
                { row: { gap: "0", items: ["p", "a"] } },
                { row: { gap: "0", items: ["q", "b"] } },
              ],
            },
          },
        },
        [box("p", "11pt"), box("a", "100pt"), box("q", "51pt"), box("b", "100pt")],
        { edges: [edge("straight:span")] },
      ),
    );
    expect(diagnostics.filter((d) => d.code === "layout/straight-off-side")).toEqual([]);
    const points = layout.edges[0]?.route?.points ?? [];
    const a = rect(layout, "a");
    const b = rect(layout, "b");
    expect(points[0]?.x).toBeCloseTo(
      (Math.max(a.x, b.x) + Math.min(a.x + a.width, b.x + b.width)) / 2,
      1,
    );
    expect(points[0]?.x).toBe(points[1]?.x);
  });

  test("without a shared span it warns", () => {
    const { diagnostics } = lay(
      doc(
        {
          arrange: {
            stack: {
              align: "start",
              gap: "30pt",
              items: [
                { row: { gap: "0", items: ["a"] } },
                { row: { gap: "0", items: ["q", "b"] } },
              ],
            },
          },
        },
        [box("a", "40pt"), box("q", "100pt"), box("b", "40pt")],
        { edges: [edge("straight:span")] },
      ),
    );
    expect(codes(diagnostics)).toContain("layout/straight-off-side");
  });

  test("is per end: a plain straight end keeps its own rule", () => {
    const { diagnostics } = lay(
      doc({ arrange }, nodes, {
        edges: [{ from: "a", to: "b", fromAnchor: "straight:span", toAnchor: "straight" }],
      }),
    );
    // The `straight` end has no effect here (centre past the corner); the span end does not rescue it.
    const found = diagnostics.filter((d) => d.code === "layout/straight-off-side");
    expect(found.some((d) => d.path?.at(-1) === "toAnchor")).toBe(true);
  });

  test("two edges into one box, both ends straight:span, stay vertical", () => {
    const { layout } = lay(
      doc(
        {
          arrange: {
            stack: {
              align: "start",
              gap: "30pt",
              items: [
                { row: { gap: "0", items: ["a", "p"] } },
                { row: { gap: "0", items: ["q", "b"] } },
              ],
            },
          },
        },
        nodes,
        {
          edges: [
            edge("straight:span"),
            { from: "p", to: "b", fromAnchor: "straight:span", toAnchor: "straight:span" },
          ],
        },
      ),
    );
    for (const e of layout.edges) {
      const points = e.route?.points ?? [];
      expect(points.length).toBeGreaterThanOrEqual(2);
    }
  });

  test("plain straight keeps its rule (no effect, with the warning)", () => {
    const { diagnostics } = lay(doc({ arrange }, nodes, { edges: [edge("straight")] }));
    expect(codes(diagnostics)).toContain("layout/straight-off-side");
    expect(diagnostics.find((d) => d.code === "layout/straight-off-side")?.hint).toContain(
      "straight:span",
    );
  });

  test("is a valid anchor and an unknown spelling is not", () => {
    const ok = checked(doc({ arrange }, nodes, { edges: [edge("straight:span")] }));
    expect(ok.filter((d) => d.severity === "error")).toEqual([]);
    const bad = checked(doc({ arrange }, nodes, { edges: [edge("straight:wide")] }));
    expect(codes(bad)).toContain("layout/invalid-anchor");
  });
});

describe("align across a stack (cross-axis struts)", () => {
  const nodes = ["a1", "a2", "b1", "b2", "c1"].map((id) => box(id));
  const arrange = {
    stack: {
      gap: "20pt",
      align: "start",
      items: [
        { row: { gap: "10pt", items: ["a1", "a2"] } },
        { stack: { gap: "10pt", align: "start", items: ["b1", "b2"] } },
        "c1",
      ],
    },
  };

  test("an x constraint moves an item of a stack without a one-item row around it", () => {
    const { layout, diagnostics } = lay(
      doc({ arrange, align: [{ x: ["a2", "b2", "c1"], at: "start" }] }, nodes),
    );
    expect(codes(diagnostics)).not.toContain("layout/unsatisfied-align");
    expect(rect(layout, "b2").x).toBeCloseTo(rect(layout, "a2").x, 2);
    expect(rect(layout, "c1").x).toBeCloseTo(rect(layout, "a2").x, 2);
    // Only the item moves: its neighbour in the stack stays at the left edge.
    expect(rect(layout, "b1").x).toBeCloseTo(rect(layout, "a1").x, 2);
  });

  test("a y constraint moves an item of a row", () => {
    const { layout, diagnostics } = lay(
      doc(
        {
          arrange: {
            row: {
              gap: "20pt",
              align: "start",
              items: [
                { stack: { gap: "10pt", items: ["a1", "a2"] } },
                { row: { gap: "10pt", align: "start", items: ["b1", "b2"] } },
              ],
            },
          },
          align: [{ y: ["a2", "b2"] }],
        },
        nodes.filter((n) => n.id !== "c1"),
      ),
    );
    expect(codes(diagnostics)).not.toContain("layout/unsatisfied-align");
    expect(rect(layout, "b2").y).toBeCloseTo(rect(layout, "a2").y, 2);
    expect(rect(layout, "b1").y).toBeCloseTo(rect(layout, "a1").y, 2);
  });

  test("a constraint that main-axis space meets is solved as before", () => {
    const withAlign = lay(
      doc(
        {
          arrange: {
            row: { gap: "10pt", align: "start", items: ["a1", { stack: { items: ["b1", "b2"] } }] },
          },
          align: [{ y: ["a1", "b2"] }],
        },
        nodes.filter((n) => ["a1", "b1", "b2"].includes(n.id)),
      ),
    );
    expect(codes(withAlign.diagnostics)).not.toContain("layout/unsatisfied-align");
    expect(rect(withAlign.layout, "b2").y).toBeCloseTo(rect(withAlign.layout, "a1").y, 2);
    // Fixed baseline (the main-axis solution, recorded before cross-axis space existed).
    expect(["a1", "b1", "b2"].map((id) => rect(withAlign.layout, id))).toEqual([
      { x: 11, y: 67.677, width: 44, height: 34 },
      { x: 75, y: 11, width: 44, height: 34 },
      { x: 75, y: 67.677, width: 44, height: 34 },
    ]);
  });
});

describe("matchWidth", () => {
  const nodes = [
    box("a", undefined, { label: "Short", matchWidth: "k" }),
    box("b", undefined, { label: "A much longer label", matchWidth: "k" }),
    box("c", "10pt", { matchWidth: "k" }),
    box("d", undefined, { label: "Other" }),
    { id: "o", component: "circle", label: "o", matchWidth: "k" },
  ];
  const layout = { arrange: { stack: { items: ["a", "b", "c", "d", "o"] } } };

  test("gives the nodes of one name the widest width", () => {
    const placed = lay(doc(layout, nodes)).layout;
    const widest = rect(placed, "b").width;
    expect(rect(placed, "a").width).toBeCloseTo(widest, 3);
    expect(rect(placed, "c").width).toBeCloseTo(widest, 3);
    expect(rect(placed, "d").width).toBeLessThan(widest);
  });

  test("leaves fixed-aspect shapes alone", () => {
    const placed = lay(doc(layout, nodes)).layout;
    expect(rect(placed, "o").width).toBe(rect(placed, "o").height);
  });

  test("warns when a grid stretch widens one member after the match", () => {
    const { diagnostics } = lay(
      doc(
        { arrange: { grid: { columns: 2, align: "stretch", items: ["long", "x", "m1", "m2"] } } },
        [
          box("long", undefined, { label: "A very very very very long label here" }),
          box("x"),
          box("m1", undefined, { matchWidth: "k" }),
          box("m2", undefined, { matchWidth: "k" }),
        ],
      ),
    );
    const found = diagnostics.find((d) => d.code === "layout/match-width-unmet");
    expect(found?.severity).toBe("warning");
    expect(found?.path).toEqual(["nodes", 3, "matchWidth"]);
  });

  test("is silent when the match holds", () => {
    const { diagnostics } = lay(doc(layout, nodes));
    expect(codes(diagnostics)).not.toContain("layout/match-width-unmet");
  });

  test("needs the structured layout", () => {
    const result = checked(doc({ engine: "auto" }, [box("a", undefined, { matchWidth: "k" })]));
    expect(codes(result)).toContain("layout/structured-only");
  });
});

describe("set width and height", () => {
  const nodes = ["a1", "a2"].map((id) => box(id, "40pt"));
  const arrange = {
    place: {
      unit: "1mm",
      items: [
        { item: "a1", at: [20, 10] },
        { item: "a2", at: [20, 40] },
      ],
    },
  };
  const set = (extra: object) => ({
    sets: [{ id: "s", label: "", members: ["a1", "a2"], shape: "ellipse", ...extra }],
  });
  const outline = (layout: LayoutIR) => {
    const o = layout.sets?.[0]?.outline;
    if (o?.kind !== "ellipse") throw new Error("not an ellipse");
    return o;
  };

  test("is the exact size, about the center of the fit", () => {
    const fitted = lay(doc({ arrange }, nodes, set({}))).layout;
    const exact = lay(doc({ arrange }, nodes, set({ width: "70mm", height: "60mm" }))).layout;
    const f = outline(fitted);
    const e = outline(exact);
    expect(e.rx * 2).toBeCloseTo((70 * 72) / 25.4 / 0.5, 0);
    expect(e.ry * 2).toBeCloseTo((60 * 72) / 25.4 / 0.5, 0);
    // Coordinates shift with the canvas: compare against a member.
    expect(e.cx - centerX(rect(exact, "a1"))).toBeCloseTo(f.cx - centerX(rect(fitted, "a1")), 3);
  });

  test("one axis may be written: the other stays fitted", () => {
    const fitted = outline(lay(doc({ arrange }, nodes, set({}))).layout);
    const wide = outline(lay(doc({ arrange }, nodes, set({ width: "90mm" }))).layout);
    expect(wide.ry).toBeCloseTo(fitted.ry, 3);
    expect(wide.rx).toBeGreaterThan(fitted.rx);
  });

  test("members that do not fit keep the outline large and warn", () => {
    const { layout, diagnostics } = lay(doc({ arrange }, nodes, set({ width: "5mm" })));
    const warning = diagnostics.find((d) => d.code === "layout/set-size-too-small");
    expect(warning?.severity).toBe("warning");
    expect(warning?.subject).toEqual({ kind: "set", id: "s" });
    expect(warning?.path).toEqual(["sets", 0, "width"]);
    const fitted = outline(lay(doc({ arrange }, nodes, set({}))).layout);
    expect(outline(layout).rx).toBeCloseTo(fitted.rx, 3);
  });

  test("a met size is silent", () => {
    const { diagnostics } = lay(doc({ arrange }, nodes, set({ width: "70mm", height: "60mm" })));
    expect(codes(diagnostics)).not.toContain("layout/set-size-too-small");
  });

  test("the minimum of the other axis applies before the fit test", () => {
    const { layout, diagnostics } = lay(
      doc({ arrange }, nodes, set({ width: "70mm", minHeight: "120mm" })),
    );
    expect(codes(diagnostics)).not.toContain("layout/set-size-too-small");
    const o = outline(layout);
    expect(o.rx * 2).toBeCloseTo((70 * 72) / 25.4 / 0.5, 0);
    expect(o.ry * 2).toBeGreaterThanOrEqual((120 * 72) / 25.4 / 0.5 - 1);
  });

  test("a circle cannot take an exact size and a minimum on the other axis", () => {
    const bad = checked(
      doc({ arrange }, nodes, set({ shape: "circle", width: "70mm", minHeight: "90mm" })),
    );
    expect(codes(bad)).toContain("ref/set-size-conflict");
  });

  test("a rect takes the exact size too", () => {
    const { layout } = lay(
      doc({ arrange }, nodes, set({ shape: "rect", width: "80mm", height: "70mm" })),
    );
    const o = layout.sets?.[0]?.outline;
    if (o?.kind !== "rect") throw new Error("not a rect");
    expect(o.rect.width).toBeCloseTo((80 * 72) / 25.4 / 0.5, 0);
    expect(o.rect.height).toBeCloseTo((70 * 72) / 25.4 / 0.5, 0);
  });

  test("conflicts with the minimum of the same axis; a hull has no size", () => {
    const conflict = checked(doc({ arrange }, nodes, set({ width: "70mm", minWidth: "60mm" })));
    expect(codes(conflict)).toContain("ref/set-size-conflict");
    const hull = checked(doc({ arrange }, nodes, set({ shape: "hull", height: "60mm" })));
    expect(codes(hull)).toContain("ref/set-min-size-needs-fixed-shape");
  });
});

describe("content of a spanning group on the columns above (recipe)", () => {
  // A group spanning two columns: boxes `column - 2 * padding` wide, `columnGap + 2 * padding`
  // apart, so each box is centered under its column.
  test("explicit widths and the widened gap center the boxes under the columns", () => {
    const column = 80;
    const gap = 14;
    const padding = 8;
    const heads = ["h1", "h2", "h3", "h4"].map((id) => box(id, `${column}pt`));
    const inner = (id: string) => box(id, `${column - 2 * padding}pt`);
    const { layout } = lay(
      doc(
        {
          arrange: {
            grid: {
              columns: 4,
              columnGap: `${gap}pt`,
              rowGap: "20pt",
              align: "stretch",
              items: ["h1", "h2", "h3", "h4", { item: "g12", span: 2 }, { item: "g34", span: 2 }],
            },
          },
        },
        [...heads, ...["x1", "x2", "x3", "x4"].map(inner)],
        {
          groups: [
            {
              id: "g12",
              props: { padding: `${padding}pt` },
              arrange: { row: { gap: `${gap + 2 * padding}pt`, items: ["x1", "x2"] } },
            },
            {
              id: "g34",
              props: { padding: `${padding}pt` },
              arrange: { row: { gap: `${gap + 2 * padding}pt`, items: ["x3", "x4"] } },
            },
          ],
        },
      ),
    );
    for (const [head, content] of [
      ["h1", "x1"],
      ["h2", "x2"],
      ["h3", "x3"],
      ["h4", "x4"],
    ] as const) {
      expect(centerX(rect(layout, content))).toBeCloseTo(centerX(rect(layout, head)), 1);
    }
  });
});
