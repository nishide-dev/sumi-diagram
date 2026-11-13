/**
 * Predictable align, place and group titles (#517): blank token cells,
 * `layout/align-splits-tokens`, `place` items with `origin: body`, grid
 * cells with their own `align`, titles above the border and
 * `layout/center-on-void`.
 */

import { describe, expect, test } from "bun:test";
import { stringify } from "yaml";
import { checkFigure } from "../../core/check";
import type { Diagnostic } from "../../core/diagnostics";
import { layoutStructuredFigure } from "../index";
import type { LayoutIR, Rect } from "../ir";
import type { TextMeasurer } from "../text";

/** Every character is half an em wide; ascender 0.8 em, descender 0.2 em. */
const FAKE: TextMeasurer = {
  lineWidth: (text, _font, size) => ([...text].length * size) / 2,
  verticalMetrics: (_font, size) => ({ ascent: 0.8 * size, descent: 0.2 * size }),
};

function lay(doc: object): { layout: LayoutIR; diagnostics: Diagnostic[] } {
  const result = layoutStructuredFigure(stringify(doc), { measurer: FAKE, route: false });
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
const centerY = (r: Rect) => r.y + r.height / 2;
const doc = (arrange: object, nodes: object[], extra: object = {}) => ({
  version: 1,
  figure: { id: "t", theme: "paper", layout: { arrange } },
  nodes,
  ...extra,
});
const box = (id: string, width = "40pt", height = "20pt") => ({
  id,
  component: "box",
  label: id,
  props: { width, height },
});

describe("blank token cells", () => {
  const tokens = (cells: unknown[]) => ({
    id: "seq",
    component: "tokens",
    props: { width: "20pt", height: "12pt", gap: "2pt", cells },
  });

  test("keep their place and size, draw nothing and need no label", () => {
    const text = stringify(
      doc({ stack: { items: ["seq"] } }, [
        tokens(["a", { blank: true }, "c", { blank: true, width: "30pt" }]),
      ]),
    );
    const check = checkFigure(text);
    expect(check.state.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const { layout } = lay(
      doc({ stack: { items: ["seq"] } }, [
        tokens(["a", { blank: true }, "c", { blank: true, width: "30pt" }]),
      ]),
    );
    const [a, blank, c, wide] = ["seq-1", "seq-2", "seq-3", "seq-4"].map((id) => rect(layout, id));
    expect(blank?.width).toBe(a?.width);
    expect((c?.x ?? 0) - (a?.x ?? 0)).toBeCloseTo(2 * ((blank?.x ?? 0) - (a?.x ?? 0)), 5);
    expect(wide?.width).toBe(60);
  });

  test("an edge can still address a blank cell by position", () => {
    const text = stringify({
      ...doc({ stack: { gap: "10pt", items: ["seq", "x"] } }, [
        tokens(["a", { blank: true, id: "gap" }, "c"]),
        box("x"),
      ]),
      edges: [{ from: "seq.gap", to: "x" }],
    });
    expect(checkFigure(text).state.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  test("an unknown key in the blank object is an error", () => {
    const text = stringify(
      doc({ stack: { items: ["seq"] } }, [tokens([{ blank: true, label: "x" }])]),
    );
    expect(checkFigure(text).state.diagnostics.some((d) => d.severity === "error")).toBe(true);
  });
});

describe("layout/align-splits-tokens", () => {
  const nodes = [
    {
      id: "top",
      component: "tokens",
      props: { width: "24pt", height: "14pt", cells: ["p1", "p2", "p3", "p4"] },
    },
    {
      id: "low",
      component: "tokens",
      props: { width: "40pt", height: "14pt", cells: ["e1", "e2", "e3"] },
    },
  ];
  const arrange = { stack: { gap: "10pt", align: "start", items: ["top", "low"] } };
  const codes = (d: Diagnostic[]) => d.map((x) => x.code);

  test("a cell aligned inside a one-line sequence pulls the row apart, and says so", () => {
    const { diagnostics } = lay(doc(arrange, nodes));
    expect(codes(diagnostics)).not.toContain("layout/align-splits-tokens");
    const withAlign = {
      ...doc(arrange, nodes),
      figure: { id: "t", theme: "paper", layout: { arrange, align: [{ x: ["top.3", "low.2"] }] } },
    };
    const found = lay(withAlign).diagnostics.filter((d) => d.code === "layout/align-splits-tokens");
    expect(found).toHaveLength(1);
    expect(found[0]?.severity).toBe("warning");
    expect(found[0]?.message).toContain('"low.2"');
    expect(found[0]?.hint).toContain("whole sequence");
  });

  test("aligning the whole sequences does not", () => {
    const withAlign = {
      ...doc(arrange, nodes),
      figure: {
        id: "t",
        theme: "paper",
        layout: { arrange, align: [{ x: ["top", "low"], at: "start" }] },
      },
    };
    expect(codes(lay(withAlign).diagnostics)).not.toContain("layout/align-splits-tokens");
  });
});

describe("place origin: body", () => {
  const nodes = [
    { id: "ref", component: "box", label: "ref", props: { width: "40pt", height: "20pt" } },
    { id: "seq", component: "tokens", props: { width: "20pt", height: "20pt", cells: ["x", "y"] } },
    {
      id: "note",
      component: "label",
      label: "a long note on the left",
      attach: { to: "seq.1", side: "west", gap: "4pt" },
    },
  ];
  const edges = [{ from: "ref", to: "seq" }];
  const arrange = (origin?: string) => ({
    place: {
      unit: "1pt",
      items: [
        { item: "ref", at: [100, 10] },
        { item: "seq", at: [100, 60], ...(origin !== undefined && { origin }) },
      ],
    },
  });

  test("the default is the frame including attached nodes; body is the cells' own center", () => {
    const sameCenter = (origin?: string) => {
      const { layout } = lay({ ...doc(arrange(origin), nodes), edges });
      const cells = [rect(layout, "seq-1"), rect(layout, "seq-2")] as [Rect, Rect];
      const mid = (cells[0].x + cells[1].x + cells[1].width) / 2;
      return mid - centerX(rect(layout, "ref"));
    };
    expect(Math.abs(sameCenter())).toBeGreaterThan(5);
    expect(sameCenter("footprint")).toBeCloseTo(sameCenter(), 3);
    expect(sameCenter("body")).toBeCloseTo(0, 2);
  });

  test("a group's body excludes nodes attached to it", () => {
    const groups = [
      { id: "g", label: "", variant: "plain", arrange: { stack: { items: ["inner"] } } },
    ];
    const items = [
      box("ref"),
      box("inner"),
      {
        id: "tag",
        component: "label",
        label: "tag tag tag",
        attach: { to: "inner", side: "east", gap: "4pt" },
      },
    ];
    const make = (origin?: string) =>
      lay(
        doc(
          {
            place: {
              unit: "1pt",
              items: [
                { item: "ref", at: [100, 10] },
                { item: "g", at: [100, 60], ...(origin && { origin }) },
              ],
            },
          },
          items,
          { groups },
        ),
      ).layout;
    // The frame (with the room of the tag) is centred by default; with body, the content is.
    expect(centerX(rect(make(), "g"))).toBeCloseTo(centerX(rect(make(), "ref")), 2);
    expect(centerX(rect(make(), "inner"))).not.toBeCloseTo(centerX(rect(make(), "ref")), 0);
    expect(centerX(rect(make("body"), "inner"))).toBeCloseTo(centerX(rect(make("body"), "ref")), 2);
  });

  test("origin on a nested arrange box is rejected", () => {
    const text = stringify(
      doc(
        {
          place: {
            unit: "1pt",
            items: [{ item: { row: { items: ["ref"] } }, at: [0, 0], origin: "body" }],
          },
        },
        [box("ref")],
      ),
    );
    expect(checkFigure(text).state.diagnostics.some((d) => d.severity === "error")).toBe(true);
  });
});

describe("grid cell align", () => {
  const nodes = [box("wide", "100pt"), box("a", "20pt"), box("b", "20pt"), box("c", "20pt")];
  const grid = (items: unknown[]) => ({ grid: { columns: 2, align: "start", items } });

  test("a cell's own align replaces the grid's for that cell only", () => {
    const { layout } = lay(
      doc(grid(["wide", { item: "a", align: "end" }, { item: "b", align: "center" }, "c"]), nodes),
    );
    const wide = rect(layout, "wide");
    const a = rect(layout, "a");
    const b = rect(layout, "b");
    const c = rect(layout, "c");
    // Column 2 is 20pt wide (40 units): everything fills it, so compare column 1.
    expect(a.x).toBeGreaterThan(wide.x + wide.width);
    expect(c.x).toBeCloseTo(a.x, 6);
    expect(b.y).toBeGreaterThan(a.y);
  });

  test("centre and end inside a wide column", () => {
    const { layout } = lay(
      doc(
        {
          grid: {
            columns: 1,
            align: "start",
            items: ["wide", { item: "a", align: "end" }, { item: "b", align: "center" }, "c"],
          },
        },
        nodes,
      ),
    );
    const wide = rect(layout, "wide");
    expect(rect(layout, "a").x + rect(layout, "a").width).toBeCloseTo(wide.x + wide.width, 6);
    expect(centerX(rect(layout, "b"))).toBeCloseTo(centerX(wide), 6);
    expect(rect(layout, "c").x).toBeCloseTo(wide.x, 6);
  });
});

describe("a title above the border", () => {
  const groups = (labelAt?: string) => [
    { id: "g", label: "Title", ...(labelAt && { labelAt }), arrange: { stack: { items: ["a"] } } },
    { id: "h", label: "Other", arrange: { stack: { items: ["b"] } } },
  ];
  const layoutOf = (labelAt?: string) =>
    lay(
      doc({ row: { gap: "10pt", items: ["g", "h"] } }, [box("a"), box("b")], {
        groups: groups(labelAt),
      }),
    ).layout;

  test("takes no row inside the frame and sits over it", () => {
    const inside = layoutOf();
    const above = layoutOf("above");
    expect(rect(above, "g").height).toBeLessThan(rect(inside, "g").height);
    expect(rect(above, "g").height).toBeLessThan(rect(above, "h").height);
    const label = above.groups.find((g) => g.key === "g:g")?.label;
    expect(label).toBeDefined();
    expect(centerY(label?.box as Rect)).toBeLessThan(rect(above, "g").y);
  });

  test("keeps the content where it would be without a title", () => {
    const plain = lay(
      doc({ row: { items: ["g"] } }, [box("a")], {
        groups: [{ id: "g", arrange: { stack: { items: ["a"] } } }],
      }),
    ).layout;
    const above = lay(
      doc({ row: { items: ["g"] } }, [box("a")], {
        groups: [
          { id: "g", label: "T", labelAt: "above-left", arrange: { stack: { items: ["a"] } } },
        ],
      }),
    ).layout;
    expect(rect(above, "g").height).toBeCloseTo(rect(plain, "g").height, 6);
    expect(rect(above, "a").height).toBe(rect(plain, "a").height);
  });

  test("is refused by the auto engine", () => {
    const text = stringify({
      version: 1,
      figure: { id: "t", layout: { engine: "auto" } },
      groups: [{ id: "g", label: "T", labelAt: "above" }],
      nodes: [{ ...box("a"), group: "g" }],
    });
    const codes = checkFigure(text).state.diagnostics.map((d) => d.code);
    expect(codes).toContain("layout/structured-only");
  });
});

describe("layout/center-on-void", () => {
  const nodes = [box("enc"), box("dec"), box("q1"), box("q2"), box("q3")];
  const arrange = (items: string[]) => ({
    row: { gap: "10pt", items: ["enc", { stack: { centerOn: "dec", gap: "6pt", items } }] },
  });

  test("reports a long one-sided tail, not a balanced box", () => {
    const tail = lay(doc(arrange(["dec", "q1", "q2", "q3"]), nodes)).diagnostics;
    const found = tail.filter((d) => d.code === "layout/center-on-void");
    expect(found).toHaveLength(1);
    expect(found[0]?.severity).toBe("info");
    expect(found[0]?.message).toContain('"dec"');
    const balanced = lay(
      doc(
        arrange(["q1", "dec", "q2"]),
        nodes.slice(0, 5).filter((n) => n.id !== "q3"),
      ),
    ).diagnostics;
    expect(balanced.map((d) => d.code)).not.toContain("layout/center-on-void");
  });
});

describe("renders", () => {
  test("a blank token cell paints no frame and geometry lint is clean", async () => {
    const { renderFigure } = await import("../../render/render");
    const { lintGeometry } = await import("../../lint");
    const text = stringify(
      doc({ stack: { items: ["seq"] } }, [
        {
          id: "seq",
          component: "tokens",
          props: { width: "20pt", height: "12pt", cells: ["a", { blank: true }, "c"] },
        },
      ]),
    );
    const result = await renderFigure(text);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
    expect(
      lintGeometry(result.value, { source: text }).filter((d) => d.severity !== "info"),
    ).toEqual([]);
    // Two painted frames (a and c), none for the blank cell.
    expect((result.value.svg.match(/<rect [^>]*rx=/g) ?? []).length).toBe(2);
  });
});

describe("layout/straight-off-side", () => {
  test("suggests anchors over the span two facing sides share", () => {
    const result = layoutStructuredFigure(
      stringify({
        version: 1,
        figure: {
          id: "t",
          theme: "paper",
          layout: {
            arrange: {
              stack: {
                gap: "20pt",
                items: [{ row: { gap: "80pt", items: ["near", "far"] } }, "wide"],
              },
            },
          },
        },
        nodes: [box("near", "50pt"), box("far", "50pt"), box("wide", "100pt")],
        edges: [{ from: "far", to: "wide", fromAnchor: "straight", toAnchor: "straight" }],
      }),
      { measurer: FAKE },
    );
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const found = result.diagnostics.filter((d) => d.code === "layout/straight-off-side");
    expect(found.length).toBeGreaterThan(0);
    expect(found[0]?.hint).toMatch(/overlap across the same span.*"south:0\.\d+".*"north:0\.\d+"/);
  });
});

describe("group props.padding", () => {
  const make = (props?: object) =>
    lay(
      doc({ row: { items: ["g"] } }, [box("a", "40pt", "20pt")], {
        groups: [
          { id: "g", label: "T", ...(props && { props }), arrange: { stack: { items: ["a"] } } },
        ],
      }),
    ).layout;

  test("replaces the profile's padding on every side", () => {
    const normal = rect(make(), "g");
    const tight = rect(make({ padding: "2pt" }), "g");
    const a = rect(make({ padding: "2pt" }), "a");
    expect(tight.width).toBeLessThan(normal.width);
    expect(tight.height).toBeLessThan(normal.height);
    expect(a.x - tight.x).toBe(4);
    expect(tight.x + tight.width - (a.x + a.width)).toBe(4);
  });

  test("is refused by the auto engine", () => {
    const text = stringify({
      version: 1,
      figure: { id: "t", layout: { engine: "auto" } },
      groups: [{ id: "g", props: { padding: "2pt" } }],
      nodes: [{ ...box("a"), group: "g" }],
    });
    expect(checkFigure(text).state.diagnostics.map((d) => d.code)).toContain(
      "layout/structured-only",
    );
  });
});

describe("place-overlap honours origin: body (#517 review)", () => {
  const groups = [{ id: "g", variant: "plain", arrange: { stack: { items: ["inner"] } } }];
  const nodes = (extra: object[]) => [
    box("inner", "40pt", "20pt"),
    {
      id: "tag",
      component: "label",
      label: "long tag text",
      attach: { to: "inner", side: "east", gap: "4pt" },
    },
    ...extra,
  ];
  const overlaps = (origin: string | undefined, other: [number, number]) =>
    lay(
      doc(
        {
          place: {
            unit: "1pt",
            items: [
              { item: "g", at: [0, 0], ...(origin && { origin }) },
              { item: "o", at: other },
            ],
          },
        },
        nodes([box("o", "20pt", "20pt")]),
        { groups },
      ),
    ).diagnostics.filter((d) => d.code === "layout/place-overlap").length;

  test("no false overlap on the left, a real one on the right", () => {
    // Body is 40pt wide (±20); the tag extends the footprint east.
    expect(overlaps("body", [-40, 0])).toBe(0);
    expect(overlaps("body", [40, 0])).toBe(1);
  });
});

describe("a title above layered and nested groups", () => {
  test("sits above the whole layered footprint and lints clean", async () => {
    const { renderFigure } = await import("../../render/render");
    const { lintGeometry } = await import("../../lint");
    const text = stringify(
      doc({ row: { items: ["outer"] } }, [box("a")], {
        groups: [
          {
            id: "outer",
            label: "Outer",
            labelAt: "above",
            arrange: { stack: { items: ["stacked"] } },
          },
          {
            id: "stacked",
            label: "Stacked",
            labelAt: "above-left",
            props: { layers: { count: 3, offset: "10pt" } },
            arrange: { stack: { items: ["a"] } },
          },
        ],
      }),
    );
    const result = await renderFigure(text);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const find = (id: string) => result.value.inspection.elements.find((e) => e.key === `g:${id}`);
    const { getFontSet } = await import("../../core/theme/fonts");
    const { measureLabel } = await import("../../lint/geometry/measure");
    const fonts = getFontSet(result.value.compiled.ir.meta.fontSetId);
    if (fonts === undefined) throw new Error("no font set");
    const boxOf = (g: typeof stacked) => measureLabel(g?.labels[0] as never, fonts).box as Rect;
    const stacked = find("stacked");
    const outer = find("outer");
    const label = boxOf(stacked);
    // Above the layered footprint (the rear card's top edge), not just the front card.
    expect(label.y + label.height).toBeLessThanOrEqual((stacked?.bbox?.y ?? 0) + 0.5);
    // The outer title is above the outer frame, which holds the stacked title.
    const outerLabel = boxOf(outer);
    expect(outerLabel.y + outerLabel.height).toBeLessThanOrEqual((outer?.bbox?.y ?? 0) + 0.5);
    expect(
      lintGeometry(result.value, { source: text }).filter((d) => d.severity !== "info"),
    ).toEqual([]);
  });
});
