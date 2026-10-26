import { describe, expect, test } from "bun:test";
import { mmToPt } from "../../core/units";
import { LintConfigError } from "../config";
import { cycleClosingEdges, largerBuiltinProfiles } from "./rules";
import { centeredBaseline, compile, label, lintSpec } from "./testing";

// Line numbers matter for the location tests below.
const SOURCE = `version: 1
figure: { id: geo }
groups:
  - { id: grp, label: Group }
nodes:
  - { id: a, component: box, label: A, group: grp }
  - { id: b, component: box, label: B }
  - { id: c, component: circle, label: C }
  - { id: d, component: diamond, label: D }
  - id: s
    component: box
    label: S
    props: { width: 20pt, height: 10pt }
  - { id: t, component: label, label: T }
edges:
  - { from: a, to: b, label: x }
  - { id: e2, from: b, to: c, label: y }
`;
const compiled = compile(SOURCE);

const codes = (diagnostics: { code: string }[]) => diagnostics.map((d) => d.code);

describe("geometry/exceeds-page-width and exceeds-page-height", () => {
  test("compares the canvas in pt with the profile, unquantized", () => {
    // 88mm = 249.45pt = 498.9 units.
    const wide = lintSpec(
      compiled,
      { canvas: { x: 0, y: 0, width: 499, height: 100 }, elements: {} },
      { source: SOURCE },
    );
    expect(codes(wide)).toEqual(["geometry/exceeds-page-width"]);
    expect(wide[0]?.message).toBe(
      'The figure is 88.02mm wide, more than the 88mm maximum width of profile "paper-single".',
    );
    expect(wide[0]?.subject).toEqual({ kind: "figure", id: "geo" });
    expect(wide[0]?.hint).toBe(
      "Sumi never shrinks a figure to fit. Lay it out top to bottom (layout.direction: down), shorten long labels, or use a wider profile (paper-double, 180mm).",
    );
    expect(wide[0]?.location?.line).toBe(2);
    expect(
      lintSpec(compiled, { canvas: { x: 0, y: 0, width: 498, height: 100 }, elements: {} }),
    ).toEqual([]);
  });

  test("height only when the profile has a maximum height", () => {
    const canvas = { x: 0, y: 0, width: 100, height: 2000 };
    expect(lintSpec(compiled, { canvas, elements: {} })).toEqual([]);
    const tall = lintSpec(compiled, {
      canvas,
      profile: { maxHeightPt: mmToPt(120) },
      elements: {},
    });
    expect(codes(tall)).toEqual(["geometry/exceeds-page-height"]);
    expect(tall[0]?.message).toBe(
      'The figure is 352.78mm tall, more than the 120mm maximum height of profile "paper-single".',
    );
  });
});

describe("engine- and profile-aware hints (#114)", () => {
  // One figure per engine / direction: the hints depend only on the IR's
  // meta and the profile, so the geometry is a bare canvas.
  const variants = {
    "auto right": compile(`version: 1
figure: { id: h, layout: { direction: right } }
nodes:
  - { id: a, component: box, label: A }
`),
    "auto down": compile(`version: 1
figure: { id: h, layout: { direction: down } }
nodes:
  - { id: a, component: box, label: A }
`),
    structured: compile(`version: 1
figure: { id: h, layout: { engine: structured, arrange: { row: { items: [a] } } } }
nodes:
  - { id: a, component: box, label: A }
`),
  } as const;
  const profiles = {
    "paper-single": { id: "paper-single", maxWidthPt: mmToPt(88), maxHeightPt: mmToPt(220) },
    "paper-double": { id: "paper-double", maxWidthPt: mmToPt(180), maxHeightPt: mmToPt(220) },
    "presentation-16x9": {
      id: "presentation-16x9",
      maxWidthPt: mmToPt(338.7),
      maxHeightPt: mmToPt(190.5),
      minFontSizePt: 14,
    },
  } as const;
  const hintOf = (
    variant: keyof typeof variants,
    profile: keyof typeof profiles,
    code: string,
    canvas: { width: number; height: number },
  ) =>
    lintSpec(
      variants[variant],
      { canvas: { x: 0, y: 0, ...canvas }, profile: profiles[profile], elements: {} },
      { code },
    )[0]?.hint;
  /** Millimetres in SVG units (0.5pt). */
  const mm = (v: number) => mmToPt(v) * 2;

  test.each([
    [
      "auto right",
      "paper-single",
      100,
      "Lay it out top to bottom (layout.direction: down), shorten long labels, or use a wider profile (paper-double, 180mm).",
    ],
    // Too wide for every paper profile: none is suggested.
    [
      "auto right",
      "paper-single",
      400,
      "Lay it out top to bottom (layout.direction: down), or shorten long labels.",
    ],
    [
      "auto right",
      "paper-double",
      200,
      "Lay it out top to bottom (layout.direction: down), or shorten long labels.",
    ],
    [
      "auto down",
      "paper-single",
      100,
      "Place fewer nodes side by side (split a wide layer, or group its nodes), shorten long labels, or use a wider profile (paper-double, 180mm).",
    ],
    [
      "auto down",
      "paper-double",
      200,
      "Place fewer nodes side by side (split a wide layer, or group its nodes), or shorten long labels.",
    ],
    [
      "structured",
      "paper-single",
      100,
      "Turn the widest `row` into a `stack` (or split it into several rows), reduce its `gap`, shorten long labels, or use a wider profile (paper-double, 180mm).",
    ],
    [
      "structured",
      "paper-double",
      200,
      "Turn the widest `row` into a `stack` (or split it into several rows), reduce its `gap`, or shorten long labels.",
    ],
    // Nothing is wider than a slide, and a slide is never sent to a paper profile.
    [
      "structured",
      "presentation-16x9",
      400,
      "Turn the widest `row` into a `stack` (or split it into several rows), reduce its `gap`, or shorten long labels.",
    ],
  ] as const)("exceeds-page-width: %s on %s, %dmm wide", (variant, profile, width, expected) => {
    expect(
      hintOf(variant, profile, "geometry/exceeds-page-width", { width: mm(width), height: 10 }),
    ).toBe(`Sumi never shrinks a figure to fit. ${expected}`);
  });

  test.each([
    [
      "auto right",
      "paper-single",
      "Place fewer nodes on top of each other (split a tall layer, or group its nodes), or split it into several figures.",
    ],
    [
      "auto down",
      "paper-single",
      "Lay it out left to right (layout.direction: right), or split it into several figures.",
    ],
    [
      "auto down",
      "paper-double",
      "Lay it out left to right (layout.direction: right), or split it into several figures.",
    ],
    [
      "structured",
      "paper-double",
      "Turn the tallest `stack` into a `row` (or split it into several columns), reduce its `gap`, or split it into several figures.",
    ],
    [
      "structured",
      "presentation-16x9",
      "Turn the tallest `stack` into a `row` (or split it into several columns), reduce its `gap`, or split it into several figures.",
    ],
  ] as const)(
    "exceeds-page-height: %s on %s (no built-in profile is taller)",
    (variant, profile, expected) => {
      expect(
        hintOf(variant, profile, "geometry/exceeds-page-height", { width: 10, height: mm(250) }),
      ).toBe(`Sumi never shrinks a figure to fit. ${expected}`);
    },
  );

  test("exceeds-page-height suggests a built-in profile only if it is taller and the figure fits", () => {
    const tall = (height: number) =>
      lintSpec(
        variants.structured,
        {
          canvas: { x: 0, y: 0, width: 10, height: mm(height) },
          profile: { id: "custom", maxWidthPt: mmToPt(180), maxHeightPt: mmToPt(120) },
          elements: {},
        },
        { code: "geometry/exceeds-page-height" },
      )[0]?.hint;
    expect(tall(150)).toEndWith(
      "or use a taller profile (paper-double, 220mm; paper-single, 220mm).",
    );
    expect(tall(230)).toEndWith("or split it into several figures.");
  });

  test("largerBuiltinProfiles: larger, holds the figure, no larger minimum font size", () => {
    const ids = (current: keyof typeof profiles, widthMm: number, heightMm = 10) =>
      largerBuiltinProfiles({ minFontSizePt: 7, ...profiles[current] }, "width", {
        widthPt: mmToPt(widthMm),
        heightPt: mmToPt(heightMm),
      }).map((p) => p.id);
    expect(ids("paper-single", 100)).toEqual(["paper-double"]);
    expect(ids("paper-single", 200)).toEqual([]);
    expect(ids("paper-double", 200)).toEqual([]);
    expect(ids("presentation-16x9", 400)).toEqual([]);
    // The candidate must hold the other axis too.
    expect(ids("paper-single", 100, 250)).toEqual([]);
    const custom = (axis: "width" | "height", limits: object, widthMm: number, heightMm: number) =>
      largerBuiltinProfiles({ id: "custom", minFontSizePt: 7, ...limits }, axis, {
        widthPt: mmToPt(widthMm),
        heightPt: mmToPt(heightMm),
      }).map((p) => p.id);
    // No maximum height: paper-double would add a height violation.
    expect(custom("width", { maxWidthPt: mmToPt(88) }, 100, 250)).toEqual([]);
    expect(custom("width", { maxWidthPt: mmToPt(88) }, 100, 200)).toEqual(["paper-double"]);
    // Taller paper profiles are too narrow for a 250mm wide figure.
    expect(
      custom("height", { maxWidthPt: mmToPt(300), maxHeightPt: mmToPt(120) }, 250, 150),
    ).toEqual([]);
    expect(
      custom("height", { maxWidthPt: mmToPt(300), maxHeightPt: mmToPt(120) }, 150, 150),
    ).toEqual(["paper-double"]);
  });

  test("edge-crosses-label: structured group titles sit top-centre; no layout.direction", () => {
    const source = (engine: string) => `version: 1
figure:
  id: h
  layout: { engine: ${engine}${engine === "structured" ? ", arrange: { row: { items: [grp, b] } }" : ""} }
groups:
  - { id: grp, label: Group${engine === "structured" ? ", arrange: { row: { items: [a] } }" : ""} }
nodes:
  - { id: a, component: box, label: A, group: grp }
  - { id: b, component: box, label: B }
  - { id: t, component: label, label: T${engine === "structured" ? ", attach: { to: b, side: north }" : ""} }
edges:
  - { from: b, to: a }
`;
    const hints = (engine: string) =>
      lintSpec(
        compile(source(engine)),
        {
          elements: {
            "g:grp": {
              bbox: { x: 0, y: 0, width: 200, height: 100 },
              labels: [label("Group", 100, 20)],
            },
            "n:t": { labels: [label("T", 100, 160)] },
            "e:#0": {
              path: [
                { x: 100, y: -10 },
                { x: 100, y: 200 },
              ],
            },
          },
        },
        { code: "geometry/edge-crosses-label" },
      ).map((d) => d.hint ?? "");
    const [autoGroup, autoText] = hints("auto");
    expect(autoGroup).toContain("top-left corner");
    expect(autoGroup).toContain("layout.direction");
    expect(autoText).toContain("direction");
    const [group, text] = hints("structured");
    expect(group).toContain("top centre");
    expect(group).toContain("fromAnchor / toAnchor");
    expect(group).not.toContain("direction");
    expect(text).toContain("attach it to another side");
    expect(text).not.toContain("direction");
  });

  test("node-overlap: an attached node gets attach advice", () => {
    // research/109-dogfood-v0.4/repro/attach-in-gap.sumi.yaml
    const attached = compile(`version: 1
figure: { id: h, layout: { engine: structured, arrange: { stack: { gap: 3mm, items: [a, b] } } } }
nodes:
  - { id: a, component: box, label: A }
  - { id: b, component: box, label: B }
  - { id: op, component: operator, props: { symbol: plus }, attach: { to: a, side: south, gap: 1mm } }
`);
    const result = lintSpec(
      attached,
      {
        elements: {
          "n:a": { bbox: { x: 0, y: 0, width: 40, height: 20 } },
          "n:b": { bbox: { x: 0, y: 30, width: 40, height: 20 } },
          "n:op": { bbox: { x: 15, y: 22, width: 10, height: 10 } },
        },
      },
      { code: "geometry/node-overlap" },
    );
    expect(result.map((d) => [d.message, d.hint])).toEqual([
      [
        'The shapes of node "b" and node "op" overlap.',
        'Node "op" is attached to node "a", and an attached node takes no space in the arrange tree, so it can cover its neighbours. Put it in the arrange tree instead, attach it to a free side, or widen the `gap` next to node "a".',
      ],
    ]);
  });

  test("node-overlap: no attach advice without attach; structured does not suggest grouping", () => {
    const source = (engine: string) => `version: 1
figure: { id: h, layout: { engine: ${engine}${engine === "structured" ? ", arrange: { row: { items: [a, b] } }" : ""} } }
nodes:
  - { id: a, component: box, label: A }
  - { id: b, component: box, label: B }
`;
    const hint = (engine: string) =>
      lintSpec(
        compile(source(engine)),
        {
          elements: {
            "n:a": { bbox: { x: 0, y: 0, width: 40, height: 20 } },
            "n:b": { bbox: { x: 20, y: 0, width: 40, height: 20 } },
          },
        },
        { code: "geometry/node-overlap" },
      )[0]?.hint;
    expect(hint("auto")).toContain("put the nodes in the same group");
    expect(hint("structured")).toContain("arrange tree");
    expect(hint("structured")).not.toContain("attach");
  });
});

describe("geometry/text-too-small", () => {
  const code = "geometry/text-too-small";
  test("labels below the profile minimum (7pt = 14 units)", () => {
    const small = lintSpec(
      compiled,
      { elements: { "e:#0": { labels: [label("x", 50, 50, { fontSizeUnits: 13 })] } } },
      { code },
    );
    expect(small.map((d) => [d.severity, d.message])).toEqual([
      [
        "error",
        'The label of edge edges[0] is drawn at 6.5pt, below the 7pt minimum font size of profile "paper-single".',
      ],
    ]);
    expect(small[0]?.path).toEqual(["edges", 0, "label"]);
    const ok = lintSpec(
      compiled,
      { elements: { "e:#0": { labels: [label("x", 50, 50, { fontSizeUnits: 14 })] } } },
      { code },
    );
    expect(ok).toEqual([]);
  });
});

describe("geometry/label-overflow", () => {
  const code = "geometry/label-overflow";
  const box = (width: number, height = 30) => ({ x: 10, y: 10, width, height });
  const baseline = centeredBaseline(25);

  test("a label wider than its rectangle (stroke inset and tolerance)", () => {
    // "漢漢漢" is 48 units wide; the minimal theme's 1pt stroke reaches 1 unit inside.
    const run = (width: number) =>
      lintSpec(
        compiled,
        {
          elements: {
            "n:b": { bbox: box(width), labels: [label("漢漢漢", 10 + width / 2, baseline)] },
          },
        },
        { code },
      );
    expect(run(48)).toEqual([]);
    const overflow = run(47);
    expect(codes(overflow)).toEqual([code]);
    expect(overflow[0]?.severity).toBe("error");
    expect(overflow[0]?.message).toBe(
      `The label of node "b" (24pt × 8pt, measured with the theme's fonts) does not fit inside its rectangle shape (23.5pt × 15pt).`,
    );
    expect(overflow[0]?.path).toEqual(["nodes", 1, "label"]);
  });

  test("an explicitly sized node points at its props, with the label as related", () => {
    const [overflow] = lintSpec(
      compiled,
      {
        elements: {
          "n:s": {
            bbox: { x: 10, y: 10, width: 40, height: 20 },
            labels: [label("漢漢漢", 30, 50)],
          },
        },
      },
      { code, source: SOURCE },
    );
    expect(overflow?.path).toEqual(["nodes", 4, "props"]);
    expect(overflow?.location?.line).toBe(13);
    expect(overflow?.message).toEndWith("; it is drawn outside the shape.");
    expect(overflow?.hint).toContain("props.width");
    expect(overflow?.related?.[0]?.location?.line).toBe(12);
  });

  test("circles use the inscribed ellipse", () => {
    const run = (text: string) =>
      lintSpec(
        compiled,
        {
          elements: {
            "n:c": {
              bbox: { x: 0, y: 0, width: 50, height: 50 },
              labels: [label(text, 25, centeredBaseline(25))],
            },
          },
        },
        { code },
      );
    expect(run("漢漢")).toEqual([]);
    // 48 units fit in a 50-unit square, but not in the circle.
    expect(codes(run("漢漢漢"))).toEqual([code]);
  });

  test("diamonds use the diamond, so a label that fits the bounding box can overflow", () => {
    const run = (width: number) =>
      lintSpec(
        compiled,
        {
          elements: {
            "n:d": {
              bbox: { x: 0, y: 0, width, height: 40 },
              labels: [label("漢漢漢", width / 2, centeredBaseline(20))],
            },
          },
        },
        { code },
      );
    expect(run(100)).toEqual([]);
    expect(codes(run(60))).toEqual([code]);
  });

  test("multi-line labels are checked line by line", () => {
    // A short first line and a long second line in a diamond: only the line widths matter.
    const lines = label("漢\n漢漢漢漢", 60, centeredBaseline(40) - 8);
    const result = lintSpec(
      compiled,
      { elements: { "n:d": { bbox: { x: 0, y: 0, width: 120, height: 80 }, labels: [lines] } } },
      { code },
    );
    expect(result).toEqual([]);
  });

  test("whitespace collapses as rendered: blank labels and runs of spaces do not overflow", () => {
    const result = lintSpec(compiled, {
      elements: {
        // 50 spaces would be 267 units wide if every space were drawn.
        "n:a": {
          bbox: { x: 10, y: 10, width: 45, height: 45 },
          labels: [label(" ".repeat(50), 32.5, 40)],
        },
        // "x     y" is drawn as "x y" (about 30 units).
        "n:b": {
          bbox: { x: 100, y: 10, width: 40, height: 30 },
          labels: [label("x     y", 120, 30)],
        },
        "n:s": {
          bbox: { x: 200, y: 10, width: 40, height: 30 },
          labels: [label("\t漢\t", 220, 30)],
        },
      },
    });
    expect(result).toEqual([]);
    // No-break spaces are not collapsed.
    const nbsp = lintSpec(
      compiled,
      {
        elements: {
          "n:b": {
            bbox: { x: 100, y: 10, width: 40, height: 30 },
            labels: [label("x       y", 120, 30)],
          },
        },
      },
      { code },
    );
    expect(codes(nbsp)).toEqual([code]);
  });

  test("text nodes and edges have no shape to overflow", () => {
    const result = lintSpec(
      compiled,
      {
        elements: {
          "n:t": { labels: [label("漢漢漢漢漢漢", 100, 100)] },
          "e:#0": {
            labels: [label("漢漢漢漢漢漢", 100, 200)],
            path: [
              { x: 0, y: 0 },
              { x: 1, y: 1 },
            ],
          },
        },
      },
      { code },
    );
    expect(result).toEqual([]);
  });
});

describe("geometry/out-of-canvas", () => {
  const code = "geometry/out-of-canvas";
  test("shapes, labels and edge routes outside the canvas, with 1 unit of slack", () => {
    const result = lintSpec(
      compiled,
      {
        elements: {
          "n:a": { bbox: { x: -0.5, y: 10, width: 20, height: 20 } },
          "n:b": { bbox: { x: -5, y: 10, width: 20, height: 20 } },
          "n:t": { labels: [label("漢", 395, 100)] },
          "e:e2": {
            path: [
              { x: 10, y: 10 },
              { x: 10, y: 310 },
            ],
          },
        },
      },
      { code },
    );
    expect(result.map((d) => d.message)).toEqual([
      'Node "b" extends 2.5pt outside the canvas, so part of it is clipped.',
      'Node "t" extends 1.5pt outside the canvas, so part of it is clipped.',
      'Edge "e2" extends 5pt outside the canvas, so part of it is clipped.',
    ]);
  });
});

describe("geometry/node-overlap", () => {
  const code = "geometry/node-overlap";
  test("overlapping nodes, but not a node inside its group", () => {
    const result = lintSpec(
      compiled,
      {
        elements: {
          "g:grp": { bbox: { x: 0, y: 0, width: 100, height: 100 } },
          "n:a": { bbox: { x: 10, y: 10, width: 40, height: 40 } },
          "n:b": { bbox: { x: 40, y: 40, width: 40, height: 40 } },
          // Touches b's right edge, overlapping by 1 unit only.
          "n:c": { bbox: { x: 79, y: 40, width: 40, height: 40 } },
        },
      },
      { code },
    );
    // a is inside grp (its group); b overlaps a and also grp, which does not contain it.
    expect(result.map((d) => [d.severity, d.message])).toEqual([
      ["warning", 'The shapes of group "grp" and node "b" overlap.'],
      ["warning", 'The shapes of group "grp" and node "c" overlap.'],
      ["warning", 'The shapes of node "a" and node "b" overlap.'],
    ]);
    expect(result[2]?.related?.[0]?.path).toEqual(["nodes", 1]);
  });

  test("normal containment and separated nodes are not overlaps", () => {
    const result = lintSpec(compiled, {
      elements: {
        "g:grp": {
          bbox: { x: 0, y: 0, width: 100, height: 100 },
          labels: [label("Group", 50, 20)],
        },
        "n:a": {
          bbox: { x: 10, y: 30, width: 80, height: 40 },
          labels: [label("A", 50, centeredBaseline(50))],
        },
        "n:b": {
          bbox: { x: 150, y: 30, width: 40, height: 40 },
          labels: [label("B", 170, centeredBaseline(50))],
        },
      },
    });
    expect(result).toEqual([]);
  });
});

describe("geometry/label-collision", () => {
  const code = "geometry/label-collision";

  test("labels of different elements, reported once per pair", () => {
    const result = lintSpec(
      compiled,
      {
        elements: {
          "e:#0": { labels: [label("漢漢", 100, 100)] },
          "e:e2": { labels: [label("漢漢", 110, 105)] },
        },
      },
      { code },
    );
    expect(result.map((d) => [d.severity, d.message])).toEqual([
      ["warning", 'The label of edge edges[0] overlaps the label of edge "e2".'],
    ]);
  });

  test("an edge label over a node's shape, aware of the shape's outline", () => {
    const circle = { x: 100, y: 100, width: 100, height: 100 };
    const run = (x: number, baseline: number) =>
      lintSpec(
        compiled,
        { elements: { "n:c": { bbox: circle }, "e:#0": { labels: [label("漢", x, baseline)] } } },
        { code },
      );
    // Inside the circle's bounding box, but in its corner: no collision.
    expect(run(104, 114)).toEqual([]);
    expect(run(150, 120).map((d) => d.message)).toEqual([
      'The label of edge edges[0] overlaps the shape of node "c".',
    ]);
  });

  test("a label inside its own shape or its group is fine; a group label over a child is not", () => {
    const elements = {
      "g:grp": { bbox: { x: 0, y: 0, width: 200, height: 100 }, labels: [label("Group", 100, 20)] },
      "n:a": {
        bbox: { x: 20, y: 40, width: 80, height: 40 },
        labels: [label("A", 60, centeredBaseline(60))],
      },
    };
    expect(lintSpec(compiled, { elements }, { code })).toEqual([]);
    const covered = lintSpec(
      compiled,
      {
        elements: {
          ...elements,
          "n:a": { ...elements["n:a"], bbox: { x: 20, y: 10, width: 160, height: 70 } },
        },
      },
      { code },
    );
    expect(covered.map((d) => d.message)).toEqual([
      'The label of group "grp" overlaps the shape of node "a".',
    ]);
  });
});

describe("geometry/edge-crosses-label", () => {
  const code = "geometry/edge-crosses-label";
  const group = {
    bbox: { x: 0, y: 0, width: 200, height: 100 },
    labels: [label("Pipeline", 100, 20)],
  };

  test("an edge entering a container from above through its label", () => {
    const result = lintSpec(
      compiled,
      {
        elements: {
          "g:grp": group,
          "e:#0": {
            path: [
              { x: 100, y: -10 },
              { x: 100, y: 60 },
            ],
          },
        },
      },
      { code, source: SOURCE },
    );
    expect(result.map((d) => [d.severity, d.message])).toEqual([
      ["warning", 'Edge edges[0] crosses the label of group "grp".'],
    ]);
    expect(result[0]?.hint).toContain("container");
    expect(result[0]?.location?.line).toBe(16);
    expect(result[0]?.related?.[0]?.location?.line).toBe(4);
  });

  test("curved routes are flattened", () => {
    const result = lintSpec(
      compiled,
      {
        elements: {
          "g:grp": group,
          "e:#0": {
            path: [
              { command: "M", to: { x: 60, y: -10 } },
              { command: "C", c1: { x: 60, y: 40 }, c2: { x: 140, y: 0 }, to: { x: 140, y: 60 } },
            ],
          },
        },
      },
      { code },
    );
    expect(codes(result)).toEqual([code]);
  });

  test("edges that pass beside a label, and an edge's own label, are fine", () => {
    const result = lintSpec(
      compiled,
      {
        elements: {
          "g:grp": group,
          // The label "Pipeline" spans x 66–134; pass at x = 160.
          "e:#0": {
            path: [
              { x: 160, y: -10 },
              { x: 160, y: 60 },
            ],
            labels: [label("x", 160, 30)],
          },
        },
      },
      { code },
    );
    expect(result).toEqual([]);
  });
});

describe("geometry/edge-through-node", () => {
  const code = "geometry/edge-through-node";
  // a and b are the ends of edges[0]; c is a circle, d a diamond, t a label.
  const shapes = {
    "n:a": { bbox: { x: 0, y: 0, width: 40, height: 20 } },
    "n:b": { bbox: { x: 0, y: 200, width: 40, height: 20 } },
    "n:c": { bbox: { x: 100, y: 100, width: 40, height: 40 } },
    "n:d": { bbox: { x: 200, y: 100, width: 40, height: 40 } },
    "n:t": { bbox: { x: 300, y: 100, width: 40, height: 20 } },
  };
  const run = (path: { x: number; y: number }[]) =>
    lintSpec(compiled, { elements: { ...shapes, "e:#0": { path } } }, { code, source: SOURCE });

  test("a route through a circle is reported at the edge, with the node as related", () => {
    const result = run([
      { x: 20, y: 20 },
      { x: 20, y: 120 },
      { x: 160, y: 120 },
      { x: 160, y: 200 },
    ]);
    expect(result.map((d) => [d.severity, d.message])).toEqual([
      ["warning", 'Edge edges[0] passes through the shape of node "c".'],
    ]);
    expect(result[0]?.location?.line).toBe(16);
    expect(result[0]?.related?.[0]?.location?.line).toBe(8);
  });

  test("the outline, not the bounding box: corners of a circle and a diamond are free", () => {
    // Into the top-left corner of each bounding box, outside the shape.
    for (const left of [100, 200]) {
      expect(
        run([
          { x: left - 10, y: 102 },
          { x: left + 4, y: 102 },
          { x: left + 4, y: 90 },
        ]),
      ).toEqual([]);
    }
    // Through the diamond's middle.
    expect(
      run([
        { x: 190, y: 120 },
        { x: 250, y: 120 },
      ]).map((d) => d.message),
    ).toEqual(['Edge edges[0] passes through the shape of node "d".']);
  });

  test("the edge's own ends, label nodes and touching within the tolerance are fine", () => {
    expect(
      run([
        { x: 20, y: 10 },
        { x: 20, y: 210 },
      ]),
    ).toEqual([]);
    expect(
      run([
        { x: 290, y: 110 },
        { x: 350, y: 110 },
      ]),
    ).toEqual([]);
    // Along the circle's left side, 0.5 unit inside.
    expect(
      run([
        { x: 100.5, y: 90 },
        { x: 100.5, y: 150 },
      ]),
    ).toEqual([]);
  });
});

describe("geometry/aspect-distorted", () => {
  const code = "geometry/aspect-distorted";
  test("circles stretched by the layout", () => {
    const run = (width: number, height: number) =>
      lintSpec(
        compiled,
        { elements: { "n:c": { bbox: { x: 0, y: 0, width, height } } } },
        { code },
      );
    expect(run(70, 160).map((d) => [d.severity, d.message])).toEqual([
      ["warning", 'The circle node "c" is drawn 35pt × 80pt, not with equal width and height.'],
    ]);
    expect(run(70, 71)).toEqual([]);
  });
});

describe("geometry/reversed-edge", () => {
  const code = "geometry/reversed-edge";
  const LOOP = `version: 1
figure: { id: loop, layout: { direction: down } }
groups:
  - { id: grp, label: Group }
nodes:
  - { id: start, component: box, label: Start }
  - { id: p, component: box, label: P, group: grp }
  - { id: d, component: box, label: D, group: grp }
  - { id: t, component: label, label: Note }
edges:
  - { from: start, to: p }
  - { from: p, to: d }
  - { id: retry, from: d, to: p }
  - { from: t, to: d, component: line }
  - { from: d, to: d }
  - { from: grp, to: p }
`;
  const loop = compile(LOOP);
  const box = (y: number) => ({ x: 0, y, width: 40, height: 20 });
  const run = (
    ys: { start: number; p: number; d: number; t?: number },
    figure = loop,
    source = LOOP,
  ) =>
    lintSpec(
      figure,
      {
        elements: {
          "n:start": { bbox: box(ys.start) },
          "n:p": { bbox: box(ys.p) },
          "n:d": { bbox: box(ys.d) },
          "n:t": { labels: [label("Note", 20, centeredBaseline(ys.t ?? 0))] },
          "g:grp": { bbox: { x: -10, y: 0, width: 60, height: 200 } },
        },
      },
      { code, source },
    );

  test("the edge that closes the cycle in declaration order may run backwards", () => {
    expect(run({ start: 0, p: 50, d: 100 })).toEqual([]);
  });

  test("another edge of the cycle drawn backwards is reported", () => {
    const reversed = run({ start: 0, p: 100, d: 50 });
    expect(reversed.map((d) => [d.severity, d.path, d.message])).toEqual([
      [
        "warning",
        ["edges", 1],
        'Edge edges[1] points against layout.direction (down): node "d" is drawn above node "p", although the edge does not close a cycle in declaration order.',
      ],
    ]);
    expect(reversed[0]?.hint).toContain("Declare the cycle's nodes in a different order");
    expect(reversed[0]?.related?.[0]?.message).toBe('Node "d" is defined here.');
  });

  test("touching shapes are not reversed; lines, self-loops and group edges are ignored", () => {
    // d reaching 1 unit into p still counts as above it (tolerance); 2 units do not.
    expect(run({ start: 0, p: 100, d: 81 })).toHaveLength(1);
    expect(run({ start: 0, p: 100, d: 82 })).toEqual([]);
    // The line from the text node t runs upwards: lines show no direction.
    expect(run({ start: 0, p: 50, d: 100, t: 300 })).toEqual([]);
  });

  test("every direction", () => {
    for (const [direction, words, start, p, d] of [
      ["up", "below", 200, 100, 150],
      ["right", "to the left of", 0, 100, 50],
      ["left", "to the right of", 200, 50, 100],
    ] as const) {
      const source = LOOP.replace("direction: down", `direction: ${direction}`);
      const figure = compile(source);
      const horizontal = direction !== "up";
      const at = (v: number) => (horizontal ? { x: v, y: 0 } : { x: 0, y: v });
      const result = lintSpec(
        figure,
        {
          elements: {
            "n:start": { bbox: { ...at(start), width: 20, height: 20 } },
            "n:p": { bbox: { ...at(p), width: 20, height: 20 } },
            "n:d": { bbox: { ...at(d), width: 20, height: 20 } },
          },
        },
        { code, source },
      );
      expect(result.map((r) => r.message)).toEqual([
        `Edge edges[1] points against layout.direction (${direction}): node "d" is drawn ${words} node "p", although the edge does not close a cycle in declaration order.`,
      ]);
    }
  });
});

describe("cycleClosingEdges", () => {
  const closing = (source: string) => {
    const { ir } = compile(source);
    const keys = cycleClosingEdges(ir, () => true);
    return ir.edges.filter((e) => keys.has(e.key)).map((e) => `${e.from}->${e.to}`);
  };
  const figure = (nodes: string[], edges: [string, string][]) =>
    `version: 1
figure: { id: cycles }
nodes:
${nodes.map((id) => `  - { id: ${id}, component: box }`).join("\n")}
edges:
${edges.map(([from, to]) => `  - { from: ${from}, to: ${to} }`).join("\n")}
`;

  test("searches from the sources first, in declaration order", () => {
    // c is declared first but has an incoming edge; a is the source.
    expect(
      closing(
        figure(
          ["c", "b", "a"],
          [
            ["a", "b"],
            ["b", "c"],
            ["c", "b"],
          ],
        ),
      ),
    ).toEqual(["n:c->n:b"]);
  });

  test("a cycle without a source starts at its first declared node", () => {
    expect(
      closing(
        figure(
          ["b", "a", "c"],
          [
            ["a", "b"],
            ["b", "c"],
            ["c", "a"],
          ],
        ),
      ),
    ).toEqual(["n:a->n:b"]);
  });

  test("edges across group boundaries are searched between the LCA's children", () => {
    // g -> b, b -> a with a inside g: the cycle g -> b -> g is closed by b -> a.
    const source = `version: 1
figure: { id: cycles }
groups:
  - { id: g }
  - { id: h, group: g }
nodes:
  - { id: a, component: box, group: h }
  - { id: c, component: box, group: g }
  - { id: b, component: box }
edges:
  - { from: g, to: b }
  - { from: b, to: a }
  - { from: c, to: a }
`;
    const { ir } = compile(source);
    const keys = cycleClosingEdges(ir, () => true);
    expect(ir.edges.filter((e) => keys.has(e.key)).map((e) => `${e.from}->${e.to}`)).toEqual([
      "n:b->n:a",
    ]);
  });

  test("cross and forward edges into finished branches do not close cycles", () => {
    expect(
      closing(
        figure(
          ["a", "b", "c", "d"],
          [
            ["a", "b"],
            ["a", "c"],
            ["b", "d"],
            ["c", "d"],
            ["a", "d"],
          ],
        ),
      ),
    ).toEqual([]);
  });
});

describe("configuration", () => {
  const spec = { canvas: { x: 0, y: 0, width: 600, height: 100 }, elements: {} };

  test("geometry rules can be turned off or change severity", () => {
    expect(
      lintSpec(compiled, spec, { config: { rules: { "geometry/exceeds-page-width": "off" } } }),
    ).toEqual([]);
    const warned = lintSpec(compiled, spec, {
      config: { rules: { "geometry/exceeds-page-width": "warning" } },
    });
    expect(warned.map((d) => d.severity)).toEqual(["warning"]);
  });

  test("unknown geometry rules are configuration errors with a suggestion", () => {
    expect(() =>
      lintSpec(compiled, spec, { config: { rules: { "geometry/exceeds-page-widht": "off" } } }),
    ).toThrow(LintConfigError);
    expect(() =>
      lintSpec(compiled, spec, { config: { rules: { "geometry/exceeds-page-widht": "off" } } }),
    ).toThrow('Did you mean "geometry/exceeds-page-width"?');
  });

  test("results are deterministic", () => {
    const busy = {
      elements: {
        "n:a": { bbox: { x: 10, y: 10, width: 40, height: 40 } },
        "n:b": { bbox: { x: 40, y: 40, width: 40, height: 40 } },
        "e:#0": { labels: [label("漢漢", 45, 50)] },
      },
    };
    expect(lintSpec(compiled, busy)).toEqual(lintSpec(compiled, busy));
  });
});
