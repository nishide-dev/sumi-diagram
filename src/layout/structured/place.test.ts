import { expect, test } from "bun:test";
import { stringify } from "yaml";
import { checkFigure } from "../../core/check";
import { formatFigureSource } from "../../core/figure/format";
import { PlaceSchema } from "../../core/figure/schema";
import { BUILTIN_THEMES } from "../../core/theme/builtin";
import { lintGeometry, lintRenderedFigure } from "../../lint";
import { renderFigure } from "../../render/render";
import { layoutStructuredFigure } from "../index";
import type { Rect } from "../ir";

const node = (id: string, width = "10pt", height = "10pt") => ({
  id,
  component: "box",
  label: id,
  props: { width, height },
});
const place = (a = "a", b = "b") => ({
  place: {
    unit: "10pt",
    items: [
      { item: a, at: [-1, 0.5] },
      { item: b, at: [2, 2] },
    ],
  },
});
function source(
  arrange: object,
  nodes: object[] = [node("a"), node("b", "20pt", "30pt")],
  extra = {},
) {
  return stringify({ version: 1, figure: { id: "place", layout: { arrange } }, nodes, ...extra });
}
function placed(text: string) {
  const result = layoutStructuredFigure(text, { file: "place.sumi.yaml", route: false });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result;
}
const center = (r: Rect) => [r.x + r.width / 2, r.y + r.height / 2];

test("signed fractional centers use unit lengths and the union of unequal footprints", () => {
  const {
    value: { layout },
  } = placed(source(place()));
  const [a, b] = layout.nodes.map((n) => n.rect) as [Rect, Rect];
  expect((center(b)[0] as number) - (center(a)[0] as number)).toBe(60);
  expect((center(b)[1] as number) - (center(a)[1] as number)).toBe(30);
  // Negative coordinates do not reserve space back to the origin.
  const shifted = place();
  for (const cell of shifted.place.items) cell.at = cell.at.map((v) => v + 20);
  expect(placed(source(shifted)).value.layout).toEqual(layout);
});

test("coordinate boxes stay rigid under stretch and nested row/grid placement", () => {
  const arrange = { stack: { align: "stretch", items: [place(), "wide"] } };
  const result = placed(source(arrange, [node("a"), node("b"), node("wide", "150pt")]));
  const [a, b] = result.value.layout.nodes.map((n) => n.rect) as [Rect, Rect];
  expect((center(b)[0] as number) - (center(a)[0] as number)).toBe(60);
  const nested = {
    place: {
      unit: "10pt",
      items: [
        { item: { grid: { columns: 1, items: ["a"] } }, at: [0, 0] },
        { item: { row: { items: ["b"] } }, at: [4, 0] },
      ],
    },
  };
  const rects = placed(source(nested)).value.layout.nodes.map((n) => n.rect);
  expect((center(rects[1] as Rect)[0] as number) - (center(rects[0] as Rect)[0] as number)).toBe(
    80,
  );
});

test("identical centers in captioned groups preserve shape, attach and centerOn", () => {
  const text = source(
    { row: { align: "stretch", items: ["g", "h"] } },
    [
      node("a"),
      node("b"),
      node("c"),
      node("d"),
      { ...node("tag"), attach: { to: "a", side: "north", gap: "2pt" } } as ReturnType<typeof node>,
    ],
    {
      groups: [
        { id: "g", caption: "Input", arrange: place() },
        { id: "h", caption: "Output", arrange: place("c", "d") },
      ],
    },
  );
  const result = placed(text);
  const rect = (id: string) =>
    result.value.layout.nodes.find((n) => n.key === `n:${id}`)?.rect as Rect;
  expect((center(rect("b"))[0] as number) - (center(rect("a"))[0] as number)).toBeCloseTo(
    (center(rect("d"))[0] as number) - (center(rect("c"))[0] as number),
    3,
  );
  expect((center(rect("b"))[1] as number) - (center(rect("a"))[1] as number)).toBeCloseTo(
    (center(rect("d"))[1] as number) - (center(rect("c"))[1] as number),
    3,
  );
  expect(rect("tag").y + rect("tag").height).toBeCloseTo(rect("a").y - 4, 3);
  expect(result.value.ir.nodes.find((n) => n.id === "a")?.parent).toBe("g:g");
});

test("unknown and duplicate item IDs retain shared reference diagnostics and locations", () => {
  const box = {
    place: {
      unit: "6mm",
      items: [
        { item: "a", at: [0, 0] },
        { item: "a", at: [1, 0] },
        { item: "missing", at: [2, 0] },
      ],
    },
  };
  const diagnostics = checkFigure(source(box, [node("a")]), { file: "place.sumi.yaml" }).state
    .diagnostics;
  for (const code of ["layout/unknown-item", "layout/duplicate-placement"]) {
    const d = diagnostics.find((d) => d.code === code);
    expect(d?.location?.file).toBe("place.sumi.yaml");
    expect(d?.path?.slice(-1)).toEqual(["item"]);
  }
});

test("invalid units and coordinates are schema diagnostics at the authored field", () => {
  for (const unit of [0, "0", "0pt", "-2mm", "2px", "2", 2, "100001pt"]) {
    const box = { place: { unit, items: [{ item: "a", at: [0, 0] }] } };
    expect(
      checkFigure(source(box, [node("a")])).state.diagnostics.some((d) =>
        d.code.startsWith("schema/"),
      ),
    ).toBe(true);
  }
  for (const at of [[0], [0, 1, 2], ["0", 1], [Number.POSITIVE_INFINITY, 0], [1e308, 0]]) {
    const box = { place: { unit: "6mm", items: [{ item: "a", at }] } };
    const ds = checkFigure(source(box, [node("a")]), { file: "place.sumi.yaml" }).state.diagnostics;
    expect(ds.some((d) => d.code.startsWith("schema/") && d.location?.line)).toBe(true);
  }
});

test("overlapping footprints warn with both coordinate source positions; touching is allowed", () => {
  const box = {
    place: {
      unit: "1pt",
      items: [
        { item: "a", at: [0, 0] },
        { item: "b", at: [5, 0] },
      ],
    },
  };
  const text = source(box, [node("a"), node("b")]);
  const d = placed(text).diagnostics.find((d) => d.code === "layout/place-overlap");
  expect(d?.severity).toBe("warning");
  expect(d?.path).toEqual(["figure", "layout", "arrange", "place", "items", 1, "at"]);
  expect(d?.location?.line).toBeGreaterThan(0);
  expect(d?.related?.[0]?.location?.line).toBeGreaterThan(0);
  expect(d?.message).toContain("(5, 0)pt");
  const second = box.place.items[1];
  if (second) second.at = [10, 0];
  expect(
    placed(source(box, [node("a"), node("b")])).diagnostics.some(
      (d) => d.code === "layout/place-overlap",
    ),
  ).toBe(false);
});

test("cross-tree alignment reports impossible internal constraints without deforming place", () => {
  const doc = {
    version: 1,
    figure: { id: "align", layout: { arrange: place(), align: [{ y: ["a", "b"] }] } },
    nodes: [node("a"), node("b")],
  };
  const result = placed(stringify(doc));
  expect(result.diagnostics.some((d) => d.code === "layout/unsatisfied-align")).toBe(true);
  const [a, b] = result.value.layout.nodes.map((n) => n.rect) as [Rect, Rect];
  expect((center(b)[1] as number) - (center(a)[1] as number)).toBe(30);
});

test("formatter orders place and its wrappers recursively", () => {
  const text =
    "version: 1\nfigure:\n  id: place\n  layout:\n    arrange:\n      place: { items: [{ at: [0, 0], item: a }], unit: 6mm }\nnodes: [{ id: a, component: circle }]\n";
  const formatted = formatFigureSource(text, { canonicalOrder: true });
  expect(formatted.ok).toBe(true);
  if (formatted.ok) {
    expect(formatted.text).toContain("place: { unit: 6mm, items: [ { item: a, at: [ 0, 0 ] } ] }");
    expect(formatFigureSource(formatted.text, { canonicalOrder: true })).toMatchObject({
      ok: true,
      text: formatted.text,
    });
  }
});

test("four ordinary vertices and straight undirected edges render in every theme", async () => {
  const text = source(
    {
      place: {
        unit: "14mm",
        items: [
          { item: "a", at: [1.5, 0] },
          { item: "b", at: [0, 2] },
          { item: "c", at: [0.5, 4] },
          { item: "d", at: [3, 3] },
        ],
      },
    },
    ["a", "b", "c", "d"].map((id, i) => ({
      id,
      component: "circle",
      label: id,
      tone: ["blue", "orange", "green", "purple"][i],
    })),
    {
      edges: ["a", "c", "d"].map((id) => ({
        from: "b",
        to: id,
        component: "line",
        route: "straight",
      })),
    },
  );
  for (const theme of BUILTIN_THEMES.keys()) {
    const result = await renderFigure(text, {
      overrides: { theme, profile: theme === "slides" ? "presentation-16x9" : "paper-single" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
    expect(
      lintGeometry(result.value, { source: text }).filter((d) => d.severity !== "info"),
    ).toEqual([]);
    if ("layout" in result.value)
      for (const edge of result.value.layout.edges) expect(edge.route?.points).toHaveLength(2);
    expect(result.value.compiled.ir.edges.every((e) => e.direction === "none")).toBe(true);
  }
});

test("straight edges through a placed vertex retain source-located geometry lint", async () => {
  const text = source(
    {
      place: {
        unit: "10mm",
        items: [
          { item: "a", at: [0, 0] },
          { item: "b", at: [1, 0] },
          { item: "c", at: [2, 0] },
        ],
      },
    },
    [node("a"), node("b"), node("c")],
    {
      edges: [{ from: "a", to: "c", component: "line", route: "straight" }],
    },
  );
  const report = await lintRenderedFigure(text, { file: "place.sumi.yaml" });
  for (const code of ["geometry/edge-through-node", "geometry/edge-crosses-label"]) {
    const d = report.diagnostics.find((d) => d.code === code);
    expect(d?.severity).toBe("warning");
    expect(d?.location?.file).toBe("place.sumi.yaml");
    expect(d?.related?.length).toBeGreaterThan(0);
  }
});

test("the unit editor pattern agrees with positive length validation", () => {
  const pattern = new RegExp(PlaceSchema.shape.unit.meta()?.pattern as string);
  for (const input of ["0.01mm", "000.001pt", "1cm", "2in", "100pt", "1.0mm"]) {
    expect(pattern.test(input)).toBe(true);
    expect(PlaceSchema.shape.unit.safeParse(input).success).toBe(true);
  }
  for (const input of ["0", "0mm", "00.000pt", "-1mm", ".5mm", "1px", "1", " 1mm"]) {
    expect(pattern.test(input)).toBe(false);
    expect(PlaceSchema.shape.unit.safeParse(input).success).toBe(false);
  }
});

test("parent centerOn and external alignment keep a placed group's internal offsets", () => {
  const doc = {
    version: 1,
    figure: {
      id: "parent",
      layout: {
        arrange: {
          row: {
            items: [
              { stack: { centerOn: "g", items: ["g", "note"] } },
              { stack: { items: ["target", "tail"] } },
            ],
          },
        },
        align: [{ y: ["a", "target"] }],
      },
    },
    groups: [{ id: "g", arrange: place() }],
    nodes: [node("a"), node("b"), node("note"), node("target"), node("tail")],
  };
  const result = placed(stringify(doc));
  const rect = (key: string) =>
    result.value.layout.nodes.find((n) => n.key === `n:${key}`)?.rect as Rect;
  expect(result.diagnostics.some((d) => d.code === "layout/unsatisfied-align")).toBe(false);
  expect(
    Math.abs((center(rect("a"))[1] as number) - (center(rect("target"))[1] as number)),
  ).toBeLessThanOrEqual(0.01);
  expect((center(rect("b"))[0] as number) - (center(rect("a"))[0] as number)).toBe(60);
  expect((center(rect("b"))[1] as number) - (center(rect("a"))[1] as number)).toBe(30);
});

test("captioned group centers use the body, while the caption contributes to bounds", () => {
  const text = source(
    {
      place: {
        unit: "10pt",
        items: [
          { item: "g", at: [0, 0] },
          { item: "b", at: [6, 0] },
        ],
      },
    },
    [node("a"), node("b")],
    {
      groups: [{ id: "g", caption: "Caption below", arrange: { row: { items: ["a"] } } }],
    },
  );
  const result = placed(text);
  const group = result.value.layout.groups[0]?.rect as Rect;
  const b = result.value.layout.nodes.find((n) => n.key === "n:b")?.rect as Rect;
  expect(center(group)[1]).toBeCloseTo(center(b)[1] as number, 3);
  expect((center(b)[0] as number) - (center(group)[0] as number)).toBeCloseTo(120, 3);
});

test("a four-vertex input/output pair repeats every center vector despite different labels", () => {
  const points = [
    [1.5, 0],
    [0, 1.6],
    [0.5, 3.1],
    [3, 2.5],
  ];
  const graph = (prefix: string) => ({
    place: { unit: "6mm", items: points.map((at, i) => ({ item: `${prefix}${i}`, at: [...at] })) },
  });
  const nodes = ["x", "z"].flatMap((prefix) =>
    points.map((_, i) => ({
      id: `${prefix}${i}`,
      component: "circle",
      label: `$${prefix.toUpperCase()}_${i + 1}$`,
    })),
  );
  const result = placed(
    source({ row: { align: "stretch", items: ["input", "output"] } }, nodes, {
      groups: [
        { id: "input", caption: "Input", arrange: graph("x") },
        { id: "output", caption: "Output graph", arrange: graph("z") },
      ],
    }),
  );
  const xy = (id: string) =>
    center(result.value.layout.nodes.find((n) => n.key === `n:${id}`)?.rect as Rect);
  for (let i = 1; i < 4; i++)
    for (const axis of [0, 1]) {
      const input = (xy(`x${i}`)[axis] as number) - (xy("x0")[axis] as number);
      const output = (xy(`z${i}`)[axis] as number) - (xy("z0")[axis] as number);
      expect(input).toBeCloseTo(output, 2);
    }
});
