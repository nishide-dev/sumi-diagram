import { describe, expect, test } from "bun:test";
import { getFontSet } from "../../core/theme/fonts";
import { inkLines, measureLabel } from "./measure";
import {
  axisSegments,
  PieceIndex,
  parallelRun,
  polylinesRectDistance,
  rectSides,
} from "./proximity";
import { PROXIMITY_MIN_RUN_UNITS } from "./rules";
import { centeredBaseline, compile, label, lintSpec } from "./testing";

// Line numbers matter for the location tests below.
const SOURCE = `version: 1
figure: { id: geo }
groups:
  - { id: grp, label: Group }
nodes:
  - { id: a, component: box, label: A, group: grp }
  - { id: b, component: box, label: B }
  - { id: c, component: box, label: C }
  - { id: t, component: label, label: Note }
edges:
  - { from: a, to: b }
  - { from: b, to: c }
  - { from: c, to: a }
  - { from: b, to: t }
`;
const compiled = compile(SOURCE);
// Default theme: edges and the group border are 2 units wide, so two lines
// `d` apart (centre to centre) leave `d - 2` units between their strokes.

/** The group `grp` at x 100–300, y 100–200. */
const group = { bbox: { x: 100, y: 100, width: 200, height: 100 } };

describe("proximity geometry", () => {
  test("axisSegments merges collinear chords and drops slanted ones", () => {
    expect(
      axisSegments([
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 30, y: 0.1 },
          { x: 30, y: 40 },
          { x: 50, y: 60 },
        ],
      ]),
    ).toEqual([
      { axis: "h", at: 0, from: 0, to: 30 },
      { axis: "v", at: 30, from: 0.1, to: 40 },
    ]);
  });

  test("parallelRun gives the common stretch of two parallel pieces", () => {
    const a = { axis: "h" as const, at: 0, from: 0, to: 60 };
    expect(parallelRun(a, { axis: "h", at: 3, from: 5, to: 100 })).toEqual({
      distance: 3,
      from: 5,
      to: 60,
    });
    expect(parallelRun(a, { axis: "v", at: 3, from: 5, to: 100 })).toBeUndefined();
    expect(parallelRun(a, { axis: "h", at: 3, from: 60, to: 100 })).toBeUndefined();
  });

  test("PieceIndex finds pieces within reach, and pairs of different owners once", () => {
    const piece = (owner: string, axis: "h" | "v", at: number, from = 0, to = 10) => ({
      owner,
      width: 2,
      axis,
      at,
      from,
      to,
    });
    const index = new PieceIndex([
      piece("a", "v", 50),
      piece("b", "v", 52),
      piece("a", "v", 53),
      piece("c", "v", 60),
      piece("d", "h", 51),
      piece("e", "v", 51, 20, 30),
      // The same piece as a's: one bundle with both owners.
      piece("f", "v", 50),
    ]);
    expect(index.near("v", 51, 1.5).map((p) => p.owners)).toEqual([["a", "f"], ["e"], ["b"]]);
    const pairs = (apart: number) =>
      index.pairs(apart, 5).map(({ aOwners, bOwners, run }) => [aOwners, bOwners, run.distance]);
    // {a, f} at 50 and a at 53: f is beside a; a beside itself is no pair.
    expect(pairs(0)).toEqual([
      [["a", "f"], ["b"], 2],
      [["f"], ["a"], 3],
      [["b"], ["a"], 1],
    ]);
    expect(pairs(1)).toEqual([
      [["a", "f"], ["b"], 2],
      [["f"], ["a"], 3],
    ]);
  });

  test("rectSides leaves out rounded corners", () => {
    expect(rectSides({ x: 0, y: 0, width: 100, height: 50 }, 10)).toEqual([
      { axis: "h", at: 0, from: 10, to: 90 },
      { axis: "h", at: 50, from: 10, to: 90 },
      { axis: "v", at: 0, from: 10, to: 40 },
      { axis: "v", at: 100, from: 10, to: 40 },
    ]);
  });

  test("polylinesRectDistance", () => {
    const rect = { x: 10, y: 10, width: 20, height: 10 };
    const line = (points: [number, number][]) => [points.map(([x, y]) => ({ x, y }))];
    expect(
      polylinesRectDistance(
        line([
          [0, 0],
          [40, 0],
        ]),
        rect,
      ),
    ).toBe(10);
    expect(
      polylinesRectDistance(
        line([
          [0, 15],
          [40, 15],
        ]),
        rect,
      ),
    ).toBe(0);
    expect(
      polylinesRectDistance(
        line([
          [33, 23],
          [40, 23],
        ]),
        rect,
      ),
    ).toBeCloseTo(Math.hypot(3, 3));
  });
});

describe("geometry/edge-on-border and geometry/edge-near-border", () => {
  const along = (x: number) => ({
    path: [
      { x, y: 80 },
      { x, y: 180 },
      { x: 150, y: 180 },
    ],
  });

  test("an edge on a group's border is a warning", () => {
    const result = lintSpec(
      compiled,
      { elements: { "g:grp": group, "e:#1": along(101) } },
      { source: SOURCE },
    );
    expect(result.map((d) => [d.code, d.severity, d.message])).toEqual([
      [
        "geometry/edge-on-border",
        "warning",
        'Edge edges[1] runs on the border of group "grp" for 14.1mm, so it reads as part of the frame.',
      ],
    ]);
    expect(result[0]?.location?.line).toBe(12);
    expect(result[0]?.related?.[0]?.location?.line).toBe(4);
    expect(result[0]?.hint).toContain("layout.direction");
  });

  test("an edge right beside a border is info; farther is fine", () => {
    // 4 units apart: 2 units (1pt, 0.35mm) between the strokes.
    const near = lintSpec(compiled, { elements: { "g:grp": group, "e:#1": along(96) } });
    expect(near.map((d) => [d.code, d.severity, d.message])).toEqual([
      [
        "geometry/edge-near-border",
        "info",
        'Edge edges[1] runs right beside the border of group "grp" for 14.1mm (0.35mm between the lines), so it reads as part of the frame.',
      ],
    ]);
    // 5 units apart: 3 units (1.5pt) between the strokes.
    expect(lintSpec(compiled, { elements: { "g:grp": group, "e:#1": along(95) } })).toEqual([]);
  });

  test("short runs and crossings are fine", () => {
    const short = {
      path: [
        { x: 150, y: 60 },
        { x: 150, y: 98 },
        { x: 150 + PROXIMITY_MIN_RUN_UNITS - 1, y: 98 },
        { x: 150 + PROXIMITY_MIN_RUN_UNITS - 1, y: 150 },
      ],
    };
    const crossing = {
      path: [
        { x: 200, y: 50 },
        { x: 200, y: 250 },
      ],
    };
    expect(
      lintSpec(compiled, { elements: { "g:grp": group, "e:#0": short, "e:#1": crossing } }),
    ).toEqual([]);
  });

  test("one finding per edge and group: the closest run", () => {
    // Along the left side (near), then along the top (on).
    const result = lintSpec(compiled, {
      elements: {
        "g:grp": group,
        "e:#1": {
          path: [
            { x: 96, y: 190 },
            { x: 96, y: 101 },
            { x: 250, y: 101 },
            { x: 250, y: 60 },
          ],
        },
      },
    });
    expect(result.map((d) => d.code)).toEqual(["geometry/edge-on-border"]);
  });

  test("a trunk shared by several edges is reported once, with the others related", () => {
    const result = lintSpec(
      compiled,
      { elements: { "g:grp": group, "e:#0": along(101), "e:#2": along(101) } },
      { code: "geometry/edge-on-border", source: SOURCE },
    );
    expect(result.map((d) => d.message)).toEqual([
      'The line shared by edge edges[0] and edge edges[2] runs on the border of group "grp" for 14.1mm, so it reads as part of the frame.',
    ]);
    expect(result[0]?.related?.map((r) => r.message)).toEqual([
      "Edge edges[2] runs on the same line.",
      'Group "grp" is defined here.',
    ]);
  });
});

describe("geometry/edge-near-edge", () => {
  const code = "geometry/edge-near-edge";
  const vertical = (x: number, from = 0, to = 100) => ({
    path: [
      { x, y: from },
      { x, y: to },
    ],
  });

  test("two edges side by side less than 1.5pt apart", () => {
    const result = lintSpec(
      compiled,
      { elements: { "e:#0": vertical(50), "e:#1": vertical(53) } },
      { code, source: SOURCE },
    );
    expect(result.map((d) => [d.severity, d.message])).toEqual([
      [
        "warning",
        "Edge edges[1] runs beside edge edges[0] for 17.6mm, 0.18mm apart, so the two read as one line.",
      ],
    ]);
    expect(result[0]?.location?.line).toBe(12);
    expect(result[0]?.related?.map((r) => r.location?.line)).toEqual([11]);
    const overlapping = lintSpec(
      compiled,
      { elements: { "e:#0": vertical(50), "e:#1": vertical(51) } },
      { code },
    );
    expect(overlapping[0]?.message).toContain("their strokes overlapping");
  });

  test("coinciding trunks, enough room, short runs and one edge's own detour are fine", () => {
    for (const elements of [
      { "e:#0": vertical(50), "e:#1": vertical(50) },
      // D2/ELK leaves 0.22 units between two edges leaving a hidden junction
      // (the gallery's sumi/junction sample, slides theme): one line.
      { "e:#0": vertical(50), "e:#1": vertical(50.22) },
      { "e:#0": vertical(50), "e:#1": vertical(55) },
      { "e:#0": vertical(50), "e:#1": vertical(53, 100 - PROXIMITY_MIN_RUN_UNITS + 1, 200) },
      {
        "e:#0": {
          path: [
            { x: 50, y: 0 },
            { x: 50, y: 100 },
            { x: 53, y: 100 },
            { x: 53, y: 0 },
          ],
        },
      },
    ]) {
      expect(lintSpec(compiled, { elements }, { code })).toEqual([]);
    }
  });

  test("a shared trunk beside another edge is one finding", () => {
    const result = lintSpec(
      compiled,
      { elements: { "e:#0": vertical(50), "e:#2": vertical(50), "e:#1": vertical(53) } },
      { code },
    );
    expect(result.map((d) => d.message)).toEqual([
      "Edge edges[1] runs beside the line shared by edge edges[0] and edge edges[2] for 17.6mm, 0.18mm apart, so the two read as one line.",
    ]);
  });
});

describe("geometry/edge-touches-label", () => {
  const code = "geometry/edge-touches-label";
  // "Group" at 16 units, centred at x 200: its line box spans x 172.96–227.04
  // (y 110–126) and its letters start at x 173.85.
  const titled = { ...group, labels: [label("Group", 200, centeredBaseline(118))] };

  test("an edge passing right beside a group's title", () => {
    const result = lintSpec(
      compiled,
      {
        elements: {
          "g:grp": titled,
          "e:#1": {
            path: [
              { x: 171, y: 60 },
              { x: 171, y: 150 },
            ],
          },
        },
      },
      { code, source: SOURCE },
    );
    expect(result.map((d) => d.severity)).toEqual(["info"]);
    // 2.85 units to the letters, 1 of them the edge's half stroke.
    expect(result[0]?.message).toBe(
      'Edge edges[1] touches the label of group "grp" (0.33mm from the letters).',
    );
    expect(result[0]?.related?.[0]?.location?.line).toBe(4);
  });

  test("crossing is edge-crosses-label's; enough room and the edge's own end are fine", () => {
    const pass = (x: number) => ({
      path: [
        { x, y: 60 },
        { x, y: 150 },
      ],
    });
    const crossing = lintSpec(compiled, { elements: { "g:grp": titled, "e:#1": pass(200) } });
    expect(crossing.map((d) => d.code)).toContain("geometry/edge-crosses-label");
    expect(crossing.map((d) => d.code)).not.toContain(code);
    expect(
      lintSpec(compiled, { elements: { "g:grp": titled, "e:#1": pass(150) } }, { code }),
    ).toEqual([]);
    // edges[3] ends at the text node t, whose letters start at x 180.23.
    const note = { labels: [label("Note", 200, centeredBaseline(250))] };
    expect(
      lintSpec(
        compiled,
        {
          elements: {
            "n:t": note,
            "e:#3": {
              path: [
                { x: 100, y: 250 },
                { x: 178, y: 250 },
              ],
            },
          },
        },
        { code },
      ),
    ).toEqual([]);
    // The same line from edges[1] touches it.
    expect(
      lintSpec(
        compiled,
        {
          elements: {
            "n:t": note,
            "e:#1": {
              path: [
                { x: 100, y: 250 },
                { x: 178, y: 250 },
              ],
            },
          },
        },
        { code },
      ).map((d) => d.message),
    ).toEqual(['Edge edges[1] touches the label of node "t" (0.22mm from the letters).']);
  });
});

describe("review regressions (#163)", () => {
  const MANY = `version: 1
figure: { id: many }
groups:
  - { id: grp, label: Group }
nodes:
  - { id: a, component: box, label: A, group: grp }
  - { id: b, component: box, label: B }
edges:
${Array.from({ length: 9 }, (_, i) => `  - { from: a, to: b${i === 0 ? ", variant: emphasis" : ""} }`).join("\n")}
`;
  const many = compile(MANY);
  const vertical = (x: number, from = 0, to = 100) => ({
    path: [
      { x, y: from },
      { x, y: to },
    ],
  });

  test("a branch leaving a shared trunk is compared with the trunk's other edges", () => {
    const result = lintSpec(
      compiled,
      {
        elements: {
          "e:#0": vertical(50),
          "e:#1": {
            path: [
              { x: 50, y: 0 },
              { x: 50, y: 50 },
              { x: 53, y: 50 },
              { x: 53, y: 100 },
            ],
          },
        },
      },
      { code: "geometry/edge-near-edge" },
    );
    expect(result.map((d) => d.message)).toEqual([
      "Edge edges[1] runs beside edge edges[0] for 8.8mm, 0.18mm apart, so the two read as one line.",
    ]);
  });

  test("closely packed edges are not chained into one line", () => {
    // edges[1..8] at x 50, 50.4, …, 52.8: each neighbour is within 0.5 units,
    // but the outermost are 2.8 units apart.
    const elements = Object.fromEntries(
      Array.from({ length: 8 }, (_, i) => [`e:#${i + 1}`, vertical(50 + 0.4 * i)]),
    );
    const result = lintSpec(many, { elements }, { code: "geometry/edge-near-edge" });
    expect(result.length).toBeGreaterThan(0);
  });

  test("each edge is measured with its own stroke, where it paints", () => {
    // edges[0] (emphasis, 4 units) runs at y 5 only over x 0–10; edges[1]
    // (2 units) shares that line and continues to x 100, along the group's
    // top border (y 0, x 50–100): 3 units between the strokes, not reported.
    const result = lintSpec(many, {
      elements: {
        "g:grp": { bbox: { x: 50, y: 0, width: 50, height: 50 } },
        "e:#0": {
          path: [
            { x: 0, y: 5 },
            { x: 10, y: 5 },
          ],
        },
        "e:#1": {
          path: [
            { x: 5, y: 5 },
            { x: 100, y: 5 },
          ],
        },
      },
    });
    expect(result.filter((d) => d.code.startsWith("geometry/edge-"))).toEqual([]);
  });

  test("fully transparent edges, groups and labels take no part", () => {
    const transparent = (keys: string[]) => {
      const elements = new Map(
        [...compiled.ir.elements].map(([key, element]) => [
          key,
          keys.includes(key) ? { ...element, style: { ...element.style, opacity: 0 } } : element,
        ]),
      );
      return { ...compiled, ir: { ...compiled.ir, elements } } as typeof compiled;
    };
    const onBorder = { "g:grp": group, "e:#1": vertical(101, 80, 180) };
    expect(
      lintSpec(compiled, { elements: onBorder }, { code: "geometry/edge-on-border" }),
    ).toHaveLength(1);
    for (const key of ["e:#1", "g:grp"]) {
      expect(
        lintSpec(transparent([key]), { elements: onBorder }, { code: "geometry/edge-on-border" }),
      ).toEqual([]);
    }
    const note = { labels: [label("Note", 200, centeredBaseline(250))] };
    const touching = {
      "n:t": note,
      "e:#1": {
        path: [
          { x: 100, y: 250 },
          { x: 178, y: 250 },
        ],
      },
    };
    const code = "geometry/edge-touches-label";
    expect(lintSpec(compiled, { elements: touching }, { code })).toHaveLength(1);
    expect(lintSpec(transparent(["n:t"]), { elements: touching }, { code })).toEqual([]);
  });
});

describe("inkLines", () => {
  const set = getFontSet("sumi/biz-ud-gothic");
  if (set === undefined) throw new Error("bundled font set is missing");
  const ink = (text: string, options: Parameters<typeof label>[3] = {}) =>
    inkLines(measureLabel(label(text, 100, 50, options), set));

  test("the letters lie within the line box, narrower and lower than it", () => {
    const measured = measureLabel(label("Group", 100, 50), set);
    const [box] = measured.visibleLines;
    const [letters] = inkLines(measured);
    if (box === undefined || letters === undefined) throw new Error("nothing measured");
    expect(letters.x).toBeGreaterThan(box.x);
    expect(letters.x + letters.width).toBeLessThan(box.x + box.width);
    expect(letters.y).toBeGreaterThan(box.y);
    expect(letters.y + letters.height).toBeLessThanOrEqual(box.y + box.height);
  });

  test("invisible characters neither draw nor advance, as in the measurement", () => {
    expect(ink("G​roup")).toEqual(ink("Group"));
    expect(ink("Gr\u0007oup")).toEqual(ink("Group"));
  });

  test("one box per drawn line; blank lines draw nothing", () => {
    const lines = ink("Ab\n \nCd", { lineHeightUnits: 20 });
    expect(lines).toHaveLength(2);
    expect((lines[1] as { y: number }).y - (lines[0] as { y: number }).y).toBeCloseTo(40, 5);
  });

  test("the font class picks the outlines (bold is wider)", () => {
    const [regular] = ink("Group");
    const [bold] = ink("Group", { font: "bold" });
    expect((bold as { width: number }).width).toBeGreaterThan((regular as { width: number }).width);
  });

  test("labels drawn as runs and icons fall back to the line boxes", () => {
    const runs = measureLabel(
      label("x", 100, 50, {
        runs: [[{ text: "x", font: "math-italic", fontSizeUnits: 16, shiftUnits: 0 }]],
      }),
      set,
    );
    expect(inkLines(runs)).toEqual(runs.visibleLines);
    const icon = { ...measureLabel(label("A", 100, 50), set), fontPath: "" };
    expect(inkLines(icon)).toEqual(icon.visibleLines);
  });
});

describe("re-review regressions (#163)", () => {
  const vertical = (x: number, from = 0, to = 100) => ({
    path: [
      { x, y: from },
      { x, y: to },
    ],
  });

  test("an edge on a trunk it shares is compared with the other edge's branch", () => {
    // A and B share x 50; B turns back up at x 53, beside A.
    const result = lintSpec(
      compiled,
      {
        elements: {
          "e:#0": vertical(50),
          "e:#1": {
            path: [
              { x: 50, y: 0 },
              { x: 50, y: 100 },
              { x: 53, y: 100 },
              { x: 53, y: 0 },
            ],
          },
        },
      },
      { code: "geometry/edge-near-edge" },
    );
    expect(result.map((d) => d.message)).toEqual([
      "Edge edges[1] runs beside edge edges[0] for 17.6mm, 0.18mm apart, so the two read as one line.",
    ]);
  });

  test("a structured edge is measured on what it paints itself, not on another edge's wire", () => {
    // edges[0] is routed (0,1)→(20,1) along the group's top border but paints
    // only x 0–8 (its arrowhead follows); edges[1] paints (0,1)→(100,1) on
    // the same line. Only edges[1] runs on the border, for the 20 units
    // (3.5mm) the border is long.
    const result = lintSpec(
      compiled,
      {
        elements: {
          "g:grp": { bbox: { x: 0, y: 0, width: 20, height: 50 } },
          "e:#0": {
            path: [
              { x: 0, y: 1 },
              { x: 20, y: 1 },
            ],
          },
          "e:#1": {
            path: [
              { x: 0, y: 1 },
              { x: 100, y: 1 },
            ],
          },
        },
        painted: {
          "e:#0": [
            [
              { x: 0, y: 1 },
              { x: 8, y: 1 },
            ],
          ],
          "e:#1": [
            [
              { x: 0, y: 1 },
              { x: 100, y: 1 },
            ],
          ],
        },
      },
      { code: "geometry/edge-on-border" },
    );
    expect(result.map((d) => d.message)).toEqual([
      'Edge edges[1] runs on the border of group "grp" for 3.5mm, so it reads as part of the frame.',
    ]);
    // An edge that paints nothing (no entry) takes no part.
    expect(
      lintSpec(
        compiled,
        {
          elements: {
            "g:grp": { bbox: { x: 0, y: 0, width: 20, height: 50 } },
            "e:#1": {
              path: [
                { x: 0, y: 1 },
                { x: 100, y: 1 },
              ],
            },
          },
          painted: {},
        },
        { code: "geometry/edge-on-border" },
      ),
    ).toEqual([]);
  });
});

describe("physical thresholds at the printed size (#183, figure.fit: scale)", () => {
  const vertical = (x: number, from = 0, to = 100) => ({
    path: [
      { x, y: from },
      { x, y: to },
    ],
  });

  test("edge-near-edge: a gap that prints below 1.5pt is reported, in printed mm", () => {
    // 6 units apart: 4 units drawn between the strokes (2pt), 1pt printed at 50%.
    const elements = { "e:#0": vertical(50), "e:#1": vertical(56) };
    expect(lintSpec(compiled, { elements }, { code: "geometry/edge-near-edge" })).toEqual([]);
    const scaled = lintSpec(
      compiled,
      { scale: 0.5, elements },
      { code: "geometry/edge-near-edge" },
    );
    expect(scaled.map((d) => d.message)).toEqual([
      "Edge edges[1] runs beside edge edges[0] for 8.8mm, 0.35mm apart, so the two read as one line.",
    ]);
  });

  test("edge-near-edge: a run that prints shorter than 3mm is not", () => {
    // 30 units = 5.3mm drawn, 2.6mm printed at 50%.
    const elements = { "e:#0": vertical(50, 0, 30), "e:#1": vertical(53, 0, 30) };
    expect(lintSpec(compiled, { elements }, { code: "geometry/edge-near-edge" })).toHaveLength(1);
    expect(
      lintSpec(compiled, { scale: 0.5, elements }, { code: "geometry/edge-near-edge" }),
    ).toEqual([]);
  });

  test("edge-near-border: the gap and the run are printed sizes", () => {
    const along = (x: number) => ({
      path: [
        { x, y: 80 },
        { x, y: 180 },
        { x: 150, y: 180 },
      ],
    });
    // 6 units from the border: 4 units between the strokes, 1pt printed at 50%.
    const elements = { "g:grp": group, "e:#1": along(94) };
    expect(lintSpec(compiled, { elements }, { code: "geometry/edge-near-border" })).toEqual([]);
    expect(
      lintSpec(compiled, { scale: 0.5, elements }, { code: "geometry/edge-near-border" }).map(
        (d) => d.message,
      ),
    ).toEqual([
      'Edge edges[1] runs right beside the border of group "grp" for 7.1mm (0.35mm between the lines), so it reads as part of the frame.',
    ]);
  });

  test("edge-touches-label: the clearance is a printed size", () => {
    const titled = { ...group, labels: [label("Group", 200, centeredBaseline(118))] };
    // 4.85 units to the letters, 1 of them the edge's half stroke: 3.85 units
    // drawn (1.9pt, fine), 1.9 units printed at 50% (below 1.5pt).
    const elements = {
      "g:grp": titled,
      "e:#1": {
        path: [
          { x: 169, y: 60 },
          { x: 169, y: 150 },
        ],
      },
    };
    const code = "geometry/edge-touches-label";
    expect(lintSpec(compiled, { elements }, { code })).toEqual([]);
    expect(lintSpec(compiled, { scale: 0.5, elements }, { code }).map((d) => d.message)).toEqual([
      'Edge edges[1] touches the label of group "grp" (0.34mm from the letters).',
    ]);
  });
});
