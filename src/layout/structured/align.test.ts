import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { stringify } from "yaml";
import { buildFigureIR, type FigureIR } from "../../compiler/ir";
import { checkFigure } from "../../core/check";
import { layoutStructuredFigure } from "../index";
import type { LayoutIR, Rect } from "../ir";
import type { TextMeasurer } from "../text";
import {
  ALIGN_EPSILON,
  ALIGN_GROWTH_MM,
  ALIGN_GROWTH_RATIO,
  converged,
  grewFigure,
  MAX_ALIGN_LAYOUTS,
  MAX_ALIGN_ROUNDS,
  solveAlignment,
} from "./align";
import { layoutStructured, type PlacedStructured, placeStructured } from "./engine";

const fixtures = `${import.meta.dir}/../../../tests/fixtures`;

/** Every character is half an em wide; ascender 0.8 em, descender 0.2 em. */
const FAKE: TextMeasurer = {
  lineWidth: (text, _font, size) => ([...text].length * size) / 2,
  verticalMetrics: (_font, size) => ({ ascent: 0.8 * size, descent: 0.2 * size }),
};

function irOf(text: string): FigureIR {
  const check = checkFigure(text);
  const errors = check.state.diagnostics.filter((d) => d.severity === "error");
  if (errors.length > 0) throw new Error(JSON.stringify(errors, null, 2));
  return buildFigureIR(check);
}

function place(text: string, fake = true): PlacedStructured {
  return placeStructured(irOf(text), fake ? { measurer: FAKE } : {});
}

function figure(layout: object, nodes: unknown[], groups: unknown[] = []): string {
  return stringify({ version: 1, figure: { id: "t", layout }, groups, nodes });
}

const box = (id: string, label = "A", extra: object = {}) => ({
  id,
  component: "box",
  label,
  ...extra,
});

function rectOf(layout: LayoutIR, id: string): Rect {
  const element =
    layout.nodes.find((n) => n.key === `n:${id}`) ?? layout.groups.find((g) => g.key === `g:${id}`);
  if (element === undefined) throw new Error(`no ${id}`);
  return element.rect;
}

const centerY = (r: Rect) => r.y + r.height / 2;

describe("the stopping rule", () => {
  test("looks at the largest residual, not the sum", () => {
    // 99 met constraints and one 0.5 unit off: the sum (0.5) is under
    // 0.01 × 100; the largest is not.
    expect(converged([0.5, ...Array.from({ length: 99 }, () => 0)])).toBe(false);
    expect(converged([ALIGN_EPSILON, 0, 0.005])).toBe(true);
    expect(converged([])).toBe(true);
  });
});

describe("figures without align", () => {
  test("are laid out by the plain pass: no stats, no diagnostics", () => {
    const text = readFileSync(`${fixtures}/figures/layout/a-transformer.sumi.yaml`, "utf8");
    const placed = place(text, false);
    expect(placed.align).toBeUndefined();
    expect(placed.diagnostics).toEqual([]);
    expect(JSON.stringify(placed.layout)).toBe(JSON.stringify(layoutStructured(irOf(text))));
  });

  test("an empty align is the same layout", () => {
    const nodes = [box("a"), box("b", "ABCD")];
    const arrange = { row: { items: [{ stack: { items: ["a"] } }, "b"] } };
    const without = place(figure({ arrange }, nodes));
    const empty = place(figure({ arrange, align: [] }, nodes));
    expect(JSON.stringify(empty.layout)).toBe(JSON.stringify(without.layout));
    expect(empty.align).toBeUndefined();
  });
});

describe("solving", () => {
  test("y: a lead strut pushes the higher item down to the lower one", () => {
    // Left: a stack of a, b; right: c, d, e. b's center is made level with e's.
    const placed = place(
      figure(
        {
          arrange: {
            row: {
              align: "start",
              items: [{ stack: { items: ["a", "b"] } }, { stack: { items: ["c", "d", "e"] } }],
            },
          },
          align: [{ y: ["b", "e"] }],
        },
        ["a", "b", "c", "d", "e"].map((id) => box(id)),
      ),
    );
    expect(placed.diagnostics).toEqual([]);
    expect(placed.align?.residuals).toEqual([0]);
    expect(placed.align?.rounds).toBe(1);
    const { layout } = placed;
    expect(
      Math.abs(centerY(rectOf(layout, "b")) - centerY(rectOf(layout, "e"))),
    ).toBeLessThanOrEqual(ALIGN_EPSILON);
    // The strut is before b, so a stays at the top.
    expect(rectOf(layout, "a").y).toBe(rectOf(layout, "c").y);
    expect(Object.keys(placed.align?.struts ?? {})).toEqual(["lead n:b"]);
  });

  test("x with at: start and at: end", () => {
    for (const at of ["start", "end"] as const) {
      const placed = place(
        figure(
          {
            arrange: {
              stack: {
                align: "start",
                items: [{ row: { items: ["a", "b"] } }, { row: { items: ["c", "wide"] } }],
              },
            },
            align: [{ x: ["b", "wide"], at }],
          },
          [box("a"), box("b"), box("c", "ABCDEFGH"), box("wide", "ABCDEFGHIJKL")],
        ),
      );
      expect(placed.diagnostics).toEqual([]);
      const b = rectOf(placed.layout, "b");
      const wide = rectOf(placed.layout, "wide");
      const edge = (r: Rect) => (at === "start" ? r.x : r.x + r.width);
      expect(Math.abs(edge(b) - edge(wide))).toBeLessThanOrEqual(ALIGN_EPSILON);
    }
  });

  test.each([
    [["x2", "z"], "lead n:x2"],
    [["left", "z"], "lead g:left"],
  ])("groups: %p is met by %s", (items, strut) => {
    const placed = place(
      figure(
        {
          arrange: {
            row: { align: "start", items: [{ stack: { items: ["pad", "left"] } }, "right"] },
          },
          align: [{ y: items }],
        },
        [box("pad"), box("x1"), box("x2"), box("y1"), box("y2"), box("y3"), box("z")],
        [
          { id: "left", label: "L", arrange: { stack: { items: ["x1", "x2"] } } },
          { id: "right", label: "R", arrange: { stack: { items: ["y1", "y2", "y3", "z"] } } },
        ],
      ),
    );
    // Moving left down grows the figure; that is the info, not a warning.
    expect(placed.diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
    expect(placed.align?.residuals).toEqual([0]);
    expect(Object.keys(placed.align?.struts ?? {})).toEqual([strut]);
  });

  test("interacting constraints the loop cannot untangle are reported, not hidden", () => {
    // Met at first, x2 / y3 would be broken by every single strut that moves
    // left level with z (and the other way round): the loop keeps only
    // strict improvements of the total, so it stops and reports the second.
    const placed = place(
      figure(
        {
          arrange: {
            row: { align: "start", items: [{ stack: { items: ["pad", "left"] } }, "right"] },
          },
          align: [{ y: ["x2", "y3"] }, { y: ["left", "z"] }],
        },
        [box("pad"), box("x1"), box("x2"), box("y1"), box("y2"), box("y3"), box("z")],
        [
          { id: "left", label: "L", arrange: { stack: { items: ["x1", "x2"] } } },
          { id: "right", label: "R", arrange: { stack: { items: ["y1", "y2", "y3", "z"] } } },
        ],
      ),
    );
    expect(placed.align?.residuals[0]).toBe(0);
    expect(placed.diagnostics.map((d) => d.path)).toEqual([["figure", "layout", "align", 1]]);
    expect(placed.diagnostics[0]?.hint).toMatch(/^Other align constraints/);
  });

  test("an attached node moves with its target", () => {
    const placed = place(
      figure(
        {
          arrange: {
            row: {
              align: "start",
              items: [{ stack: { items: ["a"] } }, { stack: { items: ["b", "c", "d"] } }],
            },
          },
          align: [{ y: ["tag", "d"] }],
        },
        [
          box("a"),
          box("b"),
          box("c"),
          box("d"),
          box("tag", "T", { attach: { to: "a", side: "east", gap: "1mm" } }),
        ],
      ),
    );
    expect(placed.diagnostics).toEqual([]);
    const { layout } = placed;
    expect(
      Math.abs(centerY(rectOf(layout, "tag")) - centerY(rectOf(layout, "d"))),
    ).toBeLessThanOrEqual(ALIGN_EPSILON);
    expect(centerY(rectOf(layout, "tag"))).toBeCloseTo(centerY(rectOf(layout, "a")), 3);
  });

  test("a strut never goes inside a gap: 0 box, but before it in an ancestor: its items touch", () => {
    const placed = place(
      figure(
        {
          arrange: {
            row: {
              align: "start",
              items: [
                { stack: { items: ["top", { stack: { gap: 0, items: ["a", "b"] } }] } },
                { stack: { items: ["c", "d", "e", "f"] } },
              ],
            },
          },
          align: [{ y: ["b", "f"] }],
        },
        ["top", "a", "b", "c", "d", "e", "f"].map((id) => box(id)),
      ),
    );
    expect(placed.diagnostics).toEqual([]);
    expect(placed.align?.residuals).toEqual([0]);
    expect(Object.keys(placed.align?.struts ?? {})).toEqual(["lead box#1"]);
    const a = rectOf(placed.layout, "a");
    const b = rectOf(placed.layout, "b");
    expect(Math.abs(a.y + a.height - b.y)).toBeLessThan(1e-9);
  });

  test("with no ancestor to take it, the constraint is reported", () => {
    const placed = place(
      figure(
        {
          arrange: {
            row: {
              align: "start",
              items: [
                { stack: { gap: 0, items: ["a", "b"] } },
                { stack: { items: ["c", "d", "e"] } },
              ],
            },
          },
          align: [{ y: ["b", "e"] }],
        },
        ["a", "b", "c", "d", "e"].map((id) => box(id)),
      ),
    );
    // b is in a gap: 0 stack under the root row; e's stack is start-aligned,
    // so a strut after e only grows it.
    expect(placed.diagnostics.map((d) => d.code)).toEqual(["layout/unsatisfied-align"]);
    const a = rectOf(placed.layout, "a");
    const b = rectOf(placed.layout, "b");
    expect(Math.abs(a.y + a.height - b.y)).toBeLessThan(1e-9);
  });

  test.each(["y", "x"] as const)(
    "%s: three items, two tied at an extreme, move together",
    (axis) => {
      // a and b are level at the start; c is further on (after pad). Moving a
      // or b alone leaves the range as it is.
      const outer = axis === "y" ? "row" : "stack";
      const inner = axis === "y" ? "stack" : "row";
      const placed = place(
        figure(
          {
            arrange: {
              [outer]: {
                align: "start",
                items: [
                  { [inner]: { items: ["a"] } },
                  { [inner]: { items: ["b"] } },
                  { [inner]: { items: ["pad", "c"] } },
                ],
              },
            },
            align: [{ [axis]: ["a", "b", "c"] }],
          },
          ["a", "b", "pad", "c"].map((id) => box(id)),
        ),
      );
      expect(placed.diagnostics).toEqual([]);
      expect(placed.align?.residuals).toEqual([0]);
      expect(placed.align?.rounds).toBe(1);
      const center = axis === "y" ? centerY : (r: Rect) => r.x + r.width / 2;
      const c = center(rectOf(placed.layout, "c"));
      expect(center(rectOf(placed.layout, "a"))).toBeCloseTo(c, 2);
      expect(center(rectOf(placed.layout, "b"))).toBeCloseTo(c, 2);
    },
  );

  test("the layout budget: the best layout so far and an explicit diagnostic", () => {
    const text = readFileSync(`${fixtures}/figures/layout/align-unet.sumi.yaml`, "utf8");
    const placed = placeStructured(irOf(text), { alignLimits: { maxLayouts: 2 } });
    expect(placed.align?.layouts).toBe(2);
    const codes = placed.diagnostics.map((d) => d.code);
    expect(codes[0]).toBe("layout/align-search-limit");
    expect(codes.slice(1).every((c) => c === "layout/unsatisfied-align")).toBe(true);
    expect(placed.diagnostics[0]?.message).toMatch(
      /budget of 2 layouts for figure\.layout\.align ran out with \d of 3 constraints unmet/,
    );
    // With the default budget the same figure is solved.
    expect(place(text, false).diagnostics).toEqual([]);
  });

  test("probes for the hints that spend the budget also give the budget warning", () => {
    // 250 copies of an impossible constraint: the stalled pass and its
    // lookahead spend the budget; hints still report every unmet constraint.
    const align = Array.from({ length: 250 }, () => ({ y: ["a", "b"] }));
    const placed = place(
      figure({ arrange: { stack: { items: ["a", "b"] } }, align }, [box("a"), box("b")]),
    );
    expect(placed.align?.layouts).toBe(1000);
    const codes = placed.diagnostics.map((d) => d.code);
    expect(codes[0]).toBe("layout/align-search-limit");
    expect(codes.filter((c) => c === "layout/unsatisfied-align")).toHaveLength(250);
  });

  test("100 met constraints do not hide an unmet one", () => {
    const met = Array.from({ length: 100 }, () => ({ y: ["a", "c"] }));
    const placed = place(
      figure(
        {
          arrange: {
            row: {
              align: "start",
              items: [{ stack: { items: ["a", "b"] } }, { stack: { items: ["c", "d", "e"] } }],
            },
          },
          align: [...met, { y: ["b", "e"] }],
        },
        ["a", "b", "c", "d", "e"].map((id) => box(id)),
      ),
    );
    expect(placed.diagnostics).toEqual([]);
    expect(Math.max(...(placed.align?.residuals ?? [1]))).toBe(0);
  });

  test("is deterministic", () => {
    const text = readFileSync(`${fixtures}/figures/layout/align-unet.sumi.yaml`, "utf8");
    expect(JSON.stringify(place(text, false))).toBe(JSON.stringify(place(text, false)));
  });
});

describe("centred, coupled constraints (#213)", () => {
  const text = readFileSync(
    `${import.meta.dir}/../../../research/185-acceptance/repro/align-residual.sumi.yaml`,
    "utf8",
  );
  const ir = irOf(text);

  test("lookahead escapes the greedy minimum and converges before either search limit", () => {
    const placed = placeStructured(ir);
    expect(placed.align?.residuals).toEqual([0.008, 0.006, 0]);
    expect(placed.align?.rounds).toBe(12);
    expect(placed.align?.layouts).toBe(73);
    expect(placed.align?.rounds).toBeLessThan(MAX_ALIGN_ROUNDS);
    expect(placed.align?.layouts).toBeLessThan(MAX_ALIGN_LAYOUTS);
    expect(placed.diagnostics).toEqual([]);
    for (const [heading, cell] of [
      ["h-visual", "f0"],
      ["h-action", "k0-1"],
      ["h-text", "p0"],
    ] as const) {
      expect(
        Math.abs(centerY(rectOf(placed.layout, heading)) - centerY(rectOf(placed.layout, cell))),
      ).toBeLessThanOrEqual(ALIGN_EPSILON);
    }
  });

  test("the fallback is deterministic, including with larger search limits", () => {
    const placed = placeStructured(ir);
    for (let run = 0; run < 3; run++) expect(placeStructured(ir)).toEqual(placed);
    expect(placeStructured(ir, { alignLimits: { maxRounds: 100, maxLayouts: 2000 } })).toEqual(
      placed,
    );
  });

  test("budget exhaustion during either lookahead step keeps only a complete improving pair", () => {
    // 55 ends after the first trial, 56 after a non-improving pair, 57 after
    // an improving pair. A worse intermediate state must never be returned.
    for (const maxLayouts of [55, 56, 57, 58, 66, 72]) {
      const placed = placeStructured(ir, { alignLimits: { maxLayouts } });
      expect(placed.align?.layouts).toBe(maxLayouts);
      expect(placed.diagnostics[0]?.code).toBe("layout/align-search-limit");
      expect(placed.diagnostics.some((d) => d.code === "layout/unsatisfied-align")).toBe(true);
      const residuals = placed.align?.residuals ?? [];
      expect(residuals.reduce((s, r) => s + r, 0)).toBeLessThanOrEqual(0.09);
      if (maxLayouts <= 56) expect(residuals).toEqual([0.007, 0.006, 0.077]);
      if (maxLayouts === 57) expect(residuals).toEqual([0.023, 0.01, 0.016]);
      expect(placeStructured(ir, { alignLimits: { maxLayouts } })).toEqual(placed);
    }
    expect(placeStructured(ir, { alignLimits: { maxLayouts: 73 } }).diagnostics).toEqual([]);
  });

  test("each constraint alone converges in the same centred arrangement", () => {
    for (const constraint of ir.align ?? []) {
      const placed = placeStructured({ ...ir, align: [constraint] });
      expect(converged(placed.align?.residuals ?? [1])).toBe(true);
      expect(placed.diagnostics.filter((d) => d.severity === "warning")).toEqual([]);
    }
  });

  test("a start-aligned root solves all three constraints exactly", () => {
    if (ir.arrange === undefined) throw new Error("missing root arrangement");
    const placed = placeStructured({ ...ir, arrange: { ...ir.arrange, align: "start" } });
    expect(placed.align?.residuals).toEqual([0, 0, 0]);
    expect(placed.diagnostics.filter((d) => d.severity === "warning")).toEqual([]);
    for (const [heading, cell] of [
      ["h-visual", "f0"],
      ["h-action", "k0-1"],
      ["h-text", "p0"],
    ] as const) {
      expect(centerY(rectOf(placed.layout, heading))).toBe(centerY(rectOf(placed.layout, cell)));
    }
  });
});

describe("the figure's growth (#155)", () => {
  const MM = 0.5 * (25.4 / 72);

  test("on a tie, the candidate that keeps the canvas smaller wins", () => {
    // #151 A2: a junction alone in its stack, y-aligned with a gateway deep in
    // a taller branch of a center-aligned row. A lead above the gateway's
    // branch and a trail after the junction close half the shortfall each, so
    // the totals tie every round; the lead grows the branch (and the figure),
    // the trail only grows the junction's short stack.
    const text = figure(
      {
        align: [{ y: ["join", "gateway"] }],
        arrange: {
          row: {
            gap: "5mm",
            align: "center",
            items: [
              "clients",
              { stack: { items: ["join"] } },
              { stack: { gap: "6mm", items: ["platform", "storage"] } },
            ],
          },
        },
      },
      [
        { id: "join", component: "junction", variant: "hidden" },
        box("web", "Web app"),
        box("sdk", "Python SDK"),
        box("gateway", "Gateway"),
        box("s1", "S1"),
        box("s2", "S2"),
        box("worker", "Worker"),
        box("db", "DB"),
      ],
      [
        {
          id: "clients",
          label: "Clients",
          arrange: { stack: { gap: "3mm", items: ["web", "sdk"] } },
        },
        {
          id: "platform",
          label: "ML platform",
          arrange: { stack: { gap: "6mm", items: ["api", "worker"] } },
        },
        {
          id: "api",
          label: "API tier",
          arrange: {
            row: {
              gap: "6mm",
              align: "center",
              items: ["gateway", { stack: { gap: "4mm", items: ["s1", "s2"] } }],
            },
          },
        },
        { id: "storage", label: "Storage", arrange: { row: { items: ["db"] } } },
      ],
    );
    const placed = place(text);
    const plain = layoutStructured({ ...irOf(text), align: [] }, { measurer: FAKE });
    expect(placed.diagnostics).toEqual([]);
    expect(converged(placed.align?.residuals ?? [1])).toBe(true);
    // The junction's stack took the space (a lead within a canvas unit may
    // tie on the whole-unit canvas): the figure is as large as without align.
    const struts = placed.align?.struts ?? {};
    expect(struts["trail n:join"]).toBeGreaterThan(100);
    expect(struts["lead g:api"] ?? 0).toBeLessThan(1);
    expect(placed.layout.canvas).toEqual(plain.canvas);
    expect(
      Math.abs(centerY(rectOf(placed.layout, "join")) - centerY(rectOf(placed.layout, "gateway"))),
    ).toBeLessThanOrEqual(ALIGN_EPSILON);
  });

  test("a notable growth is an info with the sizes before and after", () => {
    // c is at the top of its stack and b far down the other: only a lead
    // before c meets the constraint, and it pushes c and d down.
    const text = figure(
      {
        arrange: {
          row: {
            align: "start",
            items: [
              { stack: { gap: "30mm", items: ["a", "b"] } },
              { stack: { gap: "30mm", items: ["c", "d"] } },
            ],
          },
        },
        align: [{ y: ["b", "c"] }],
      },
      ["a", "b", "c", "d"].map((id) => box(id)),
    );
    const placed = place(text);
    const plain = layoutStructured({ ...irOf(text), align: [] }, { measurer: FAKE });
    expect(placed.align?.residuals).toEqual([0]);
    expect(placed.diagnostics).toHaveLength(1);
    const [d] = placed.diagnostics;
    expect(d?.code).toBe("layout/align-grew-figure");
    expect(d?.severity).toBe("info");
    expect(d?.path).toEqual(["figure", "layout", "align"]);
    expect(d?.subject).toEqual({ kind: "figure", id: "t" });
    const before = (plain.canvas.height * MM).toFixed(2);
    const after = (placed.layout.canvas.height * MM).toFixed(2);
    const grown = (Number(after) - Number(before)).toFixed(2);
    expect(d?.message).toMatch(/^figure\.layout\.align made the figure /);
    expect(d?.message).toContain(`${grown}mm taller (height ${before}mm → ${after}mm, +`);
    expect(d?.message).not.toContain("wider");
    expect(Number(grown)).toBeGreaterThan(ALIGN_GROWTH_MM);
    expect(d?.hint).toMatch(/^A strut only adds space/);
  });

  test("a small growth is not reported", () => {
    // The side-KV fixture grows by about 4mm (3%): the usual cost of aligning.
    const text = readFileSync(`${fixtures}/figures/layout/align-side-kv.sumi.yaml`, "utf8");
    const placed = place(text, false);
    const plain = layoutStructured({ ...irOf(text), align: [] });
    const grown = (placed.layout.canvas.height - plain.canvas.height) * MM;
    expect(grown).toBeGreaterThan(1);
    expect(grown).toBeLessThan(ALIGN_GROWTH_MM);
    expect(grown).toBeLessThan(ALIGN_GROWTH_RATIO * plain.canvas.height * MM);
    expect(placed.diagnostics).toEqual([]);
  });

  describe("the thresholds (canvases in units)", () => {
    const ir = { meta: { id: "t" } } as FigureIR;
    const canvas = (width: number, height: number) => ({ canvas: { width, height } }) as LayoutIR;
    const grew = (from: [number, number], to: [number, number]) =>
      grewFigure(ir, canvas(...from), canvas(...to));

    test("both bounds must be passed", () => {
      // Over 5mm but under 10%: 1000 → 1040 units is +7.06mm, +4%.
      expect(40 * MM).toBeGreaterThan(ALIGN_GROWTH_MM);
      expect(grew([200, 1000], [200, 1040])).toBeUndefined();
      // Over 10% but under 5mm: 100 → 120 units is +3.53mm, +20%.
      expect(20 * MM).toBeLessThan(ALIGN_GROWTH_MM);
      expect(grew([200, 100], [200, 120])).toBeUndefined();
      // The same sides, both bounds passed: reported.
      expect(grew([200, 100], [200, 140])?.code).toBe("layout/align-grew-figure");
    });

    test("width growth", () => {
      // 200 → 260 units: 35.28mm → 45.86mm.
      const d = grew([200, 300], [260, 300]);
      expect(d?.message).toBe(
        "figure.layout.align made the figure 10.58mm wider (width 35.28mm → 45.86mm, +30%) than the layout without it.",
      );
    });

    test("both sides in one info", () => {
      const d = grew([200, 300], [260, 400]);
      expect(d?.message).toBe(
        "figure.layout.align made the figure 10.58mm wider (width 35.28mm → 45.86mm, +30%) and 17.64mm taller (height 52.92mm → 70.56mm, +33%) than the layout without it.",
      );
    });
  });
});

describe("layout/unsatisfied-align", () => {
  const nodes = ["a", "b", "c", "d"].map((id) => box(id));

  test("two items of one stack cannot share a y: a warning with the residual and names", () => {
    const text = figure({ arrange: { stack: { items: ["a", "b"] } }, align: [{ y: ["a", "b"] }] }, [
      box("a"),
      box("b"),
    ]);
    const placed = place(text);
    expect(placed.diagnostics).toHaveLength(1);
    const [d] = placed.diagnostics;
    expect(d?.code).toBe("layout/unsatisfied-align");
    expect(d?.severity).toBe("warning");
    expect(d?.path).toEqual(["figure", "layout", "align", 0]);
    expect(d?.location).toMatchObject({ line: 11, column: 9 });
    expect(d?.message).toMatch(
      /^figure\.layout\.align\[0\] cannot place "a", "b" on one horizontal line \(y, center\): "a" and "b" stay \d+\.\d\dmm apart\.$/,
    );
    expect(d?.hint).toMatch(/^"a" and "b" cannot be moved apart/);
    // The best layout found is still returned (the plain one here).
    expect(placed.align?.rounds).toBeLessThanOrEqual(1);
    // Initial + 2 greedy + 2 × (1 first + 2 second) lookahead + 2 probes.
    expect(placed.align?.layouts).toBe(11);

    // Count actual callback invocations independently of the solver's stats,
    // including exhaustion in either lookahead step and in diagnostic probes.
    const ir = irOf(text);
    const plain = layoutStructured({ ...ir, align: [] }, { measurer: FAKE });
    for (let maxLayouts = 1; maxLayouts <= 12; maxLayouts++) {
      let calls = 0;
      const solved = solveAlignment(
        ir,
        ir.align ?? [],
        () => {
          calls++;
          return plain;
        },
        { maxLayouts },
      );
      expect(calls).toBe(Math.min(maxLayouts, 11));
      expect(solved.stats.layouts).toBe(calls);
      expect(solved.layout).toEqual(plain);
      expect(solved.diagnostics.map((d) => d.code)).toEqual(
        maxLayouts < 11
          ? ["layout/align-search-limit", "layout/unsatisfied-align"]
          : ["layout/unsatisfied-align"],
      );
    }
  });

  test("contradicting constraints: a warning that points at the other constraint", () => {
    // b and c are in one stack, so they cannot both be level with a.
    const text = figure(
      {
        arrange: {
          row: { items: [{ stack: { items: ["a"] } }, { stack: { items: ["b", "c"] } }, "d"] },
        },
        align: [{ y: ["a", "b"] }, { y: ["a", "c"] }],
      },
      nodes,
    );
    const placed = place(text);
    expect(placed.diagnostics.map((d) => d.code)).toContain("layout/unsatisfied-align");
    const d = placed.diagnostics[0];
    expect(d?.hint).toMatch(/^Other align constraints or the arrangement keep them apart/);
    expect(d?.related?.[0]?.message).toMatch(/shares elements with this constraint\.$/);
    expect(placed.align?.rounds).toBeLessThanOrEqual(MAX_ALIGN_ROUNDS);
    // The render path reports it too, and still draws.
    const result = layoutStructuredFigure(text, { measurer: FAKE });
    expect(result.ok).toBe(true);
    expect(result.diagnostics.map((x) => x.code)).toContain("layout/unsatisfied-align");
  });
});

describe.each([
  ["align-unet", 3],
  ["align-side-kv", 1],
])("%s (bundled fonts)", (name, count) => {
  const text = readFileSync(`${fixtures}/figures/layout/${name}.sumi.yaml`, "utf8");
  const placed = place(text, false);

  test("every constraint is met in one round", () => {
    expect(placed.diagnostics).toEqual([]);
    expect(placed.align?.residuals).toEqual(Array.from({ length: count }, () => 0));
    expect(placed.align?.rounds).toBe(1);
  });

  test("the aligned edges are straight: one horizontal segment each", () => {
    const result = layoutStructuredFigure(text);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.diagnostics).toEqual([]);
    const pairs =
      name === "align-unet"
        ? [
            ["enc1", "cat1"],
            ["enc2", "cat2"],
            ["enc3", "cat3"],
          ]
        : [["enc-norm2", "dec-cross"]];
    for (const [from, to] of pairs) {
      const edge = result.value.layout.edges.find(
        (e) => e.from === `n:${from}` && e.to === `n:${to}`,
      );
      const points = edge?.route?.points ?? [];
      expect(points).toHaveLength(2);
      expect(points[0]?.y).toBe(points[1]?.y);
    }
  });

  if (name === "align-side-kv") {
    test("the blocks of gap: 0 stacks still touch their Add & Norm", () => {
      for (const [block, norm] of [
        ["dec-cross", "dec-norm2"],
        ["dec-self", "dec-norm1"],
        ["enc-ffn", "enc-norm2"],
        ["enc-attn", "enc-norm1"],
        ["dec-ffn", "dec-norm3"],
      ] as const) {
        const a = rectOf(placed.layout, norm);
        const b = rectOf(placed.layout, block);
        expect(Math.abs(a.y + a.height - b.y)).toBeLessThan(1e-9);
      }
      // The strut went to an ancestor: a box, not an element.
      expect(Object.keys(placed.align?.struts ?? {})).toEqual(["trail box#1"]);
    });
  }
});

describe("random constraints", () => {
  // Three columns of boxes (the middle one with gap: 0 pairs) and random y / x
  // constraints between them. Records that the loop ends within the cap, that
  // a constraint is reported exactly when its residual is over the tolerance,
  // and that the gap: 0 pairs still touch.
  let seed = 132;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const ids = Array.from({ length: 18 }, (_, i) => `n${i}`);
  const nodes = ids.map((id, i) =>
    box(id, "A".repeat(1 + (i % 4)), i % 5 === 0 ? { label: "A\nB" } : {}),
  );
  const column = (from: number) => ids.slice(from, from + 6);
  const middle = column(6);
  const arrange = {
    row: {
      align: "start",
      items: [
        { stack: { items: column(0) } },
        {
          stack: {
            items: [0, 2, 4].map((i) => ({ stack: { gap: 0, items: middle.slice(i, i + 2) } })),
          },
        },
        { stack: { align: "end", items: column(12) } },
      ],
    },
  };

  test("end within the cap; reported iff unmet; gap: 0 pairs touch", () => {
    for (let run = 0; run < 40; run++) {
      const align = Array.from({ length: 1 + Math.floor(random() * 4) }, () => {
        const a = ids[Math.floor(random() * ids.length)] as string;
        let b = a;
        while (b === a) b = ids[Math.floor(random() * ids.length)] as string;
        const at = (["center", "start", "end"] as const)[Math.floor(random() * 3)];
        return random() < 0.7 ? { y: [a, b], at } : { x: [a, b], at };
      });
      const placed = place(figure({ arrange, align }, nodes));
      const stats = placed.align;
      expect(stats?.rounds).toBeLessThanOrEqual(MAX_ALIGN_ROUNDS);
      const unmet = (stats?.residuals ?? []).filter((r) => r > ALIGN_EPSILON).length;
      expect(placed.diagnostics.filter((d) => d.code !== "layout/align-grew-figure")).toHaveLength(
        unmet,
      );
      for (const i of [0, 2, 4]) {
        const top = rectOf(placed.layout, middle[i] as string);
        const bottom = rectOf(placed.layout, middle[i + 1] as string);
        expect(Math.abs(top.y + top.height - bottom.y)).toBeLessThan(1e-9);
      }
    }
  });
});
