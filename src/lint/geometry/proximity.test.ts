import { describe, expect, test } from "bun:test";
import { axisSegments, polylinesRectDistance, rectSides, sideBySide, wiresOf } from "./proximity";
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

  test("wiresOf merges a shared trunk into one wire with both edges", () => {
    const wires = wiresOf([
      { owner: "e1", segment: { axis: "v", at: 50, from: 0, to: 100 } },
      { owner: "e2", segment: { axis: "v", at: 50, from: 60, to: 140 } },
      { owner: "e3", segment: { axis: "v", at: 52, from: 0, to: 100 } },
    ]);
    expect(wires).toEqual([
      { axis: "v", at: 50, spans: [[0, 140]], owners: ["e1", "e2"] },
      { axis: "v", at: 52, spans: [[0, 100]], owners: ["e3"] },
    ]);
  });

  test("sideBySide measures the longest common stretch", () => {
    const a = { axis: "h" as const, at: 0, spans: [[0, 10] as const, [20, 60] as const] };
    const b = { axis: "h" as const, at: 3, spans: [[5, 50] as const] };
    expect(sideBySide(a, b)).toEqual({ distance: 3, overlap: 30, at: { x: 35, y: 0 } });
    expect(sideBySide(a, { ...b, axis: "v" })).toBeUndefined();
    expect(sideBySide(a, { ...b, spans: [[10, 20]] })).toBeUndefined();
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
