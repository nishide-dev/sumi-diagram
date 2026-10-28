import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { ElementKey } from "../../core/check-state";
import type { Diagnostic } from "../../core/diagnostics";
import { layoutStructuredFigure } from "../index";
import type { LayoutIR, Point } from "../ir";
import { checkRoutes } from "./check";
import { crossingDiagnostics, findCrossings, MAX_REPORTED_CROSSINGS } from "./crossings";
import { chooseRouting, mergeSegments } from "./router";

const root = `${import.meta.dir}/../../..`;
/** #109's figure 3 (v0.4.1): 4 crossing points, 9 crossing edge pairs (#124 §3.7). */
const serving = `${root}/research/109-dogfood-v0.4/figures/serving-architecture.sumi.yaml`;
/** #109's figure 2: 2 crossings (#124 §3.7). */
const training = `${root}/research/109-dogfood-v0.4/figures/training-pipeline.sumi.yaml`;

function load(path: string) {
  const result = layoutStructuredFigure(readFileSync(path, "utf8"));
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  return result;
}

const crossingsOf = (path: string) =>
  load(path).diagnostics.filter((d) => d.code === "layout/edge-crossing");

describe("layout/edge-crossing", () => {
  test("figure 3: each crossing point names both wires, at the later edge", () => {
    const diagnostics = crossingsOf(serving);
    expect(diagnostics.map((d) => [d.severity, d.path, d.location?.line, d.message])).toEqual([
      [
        "info",
        ["edges", 6],
        68,
        'Edge edges[6] ("infer-api" → "infer-worker") crosses edge edges[3] ("gateway" → "infer-api") at 79.1mm, 27.5mm from the top left of the canvas.',
      ],
      [
        "info",
        ["edges", 6],
        68,
        'Edge edges[6] ("infer-api" → "infer-worker") crosses the line shared by edges[3] ("gateway" → "infer-api"), edges[4] ("gateway" → "train-api") and edges[5] ("gateway" → "auth") at 77.6mm, 31.5mm from the top left of the canvas.',
      ],
      [
        "info",
        ["edges", 12],
        74,
        'Edge edges[12] ("infer-worker" → "features") crosses edge edges[11] ("train-worker" → "registry") at 74.6mm, 85.6mm from the top left of the canvas.',
      ],
      [
        "info",
        ["edges", 16],
        78,
        'The line shared by edges[16] ("train-api" → "metadata") and edges[17] ("auth" → "metadata") crosses the line shared by edges[8] ("queue" → "train-worker") and edges[9] ("queue" → "prep-worker") at 129.0mm, 37.5mm from the top left of the canvas.',
      ],
    ]);
    // The other wire's edges, then the rest of the own wire's, as related locations.
    expect(diagnostics[3]?.related?.map((r) => [r.path, r.message])).toEqual([
      [["edges", 8], 'Crossed edge edges[8] ("queue" → "train-worker").'],
      [["edges", 9], 'Crossed edge edges[9] ("queue" → "prep-worker").'],
      [["edges", 17], 'Edge edges[17] ("auth" → "metadata") runs on the same line.'],
    ]);
    expect(diagnostics[0]?.subject).toEqual({ kind: "edge", id: "edges[6]" });
    expect(diagnostics[0]?.hint).toContain("fromAnchor / toAnchor");
    // The shared hint is given once (#154), on the crossing listed first.
    expect(diagnostics.map((d) => d.hint !== undefined)).toEqual([true, false, false, false]);
  });

  test("the hint goes to the crossing first in source order (#154)", () => {
    const { ir, layout } = load(serving).value;
    // Move edges[12] above the others in the source: its crossing now sorts first.
    const sourceMap = new Map(ir.sourceMap);
    const key = ir.edges[12]?.key as ElementKey;
    const at = sourceMap.get(key);
    if (at?.location === undefined) throw new Error("no location");
    sourceMap.set(key, { ...at, location: { ...at.location, line: 1 } });
    const diagnostics = crossingDiagnostics({ ...ir, sourceMap }, layout);
    expect(diagnostics.map((d) => [d.path, d.hint !== undefined])).toEqual([
      [["edges", 6], false],
      [["edges", 6], false],
      [["edges", 12], true],
      [["edges", 16], false],
    ]);
  });

  test("the edge pairs at the points are checkRoutes' crossings", () => {
    for (const path of [serving, training]) {
      const { ir, layout } = load(path).value;
      const pairs = findCrossings(layout).reduce((n, c) => n + c.edges.length * c.others.length, 0);
      expect(pairs).toBe(checkRoutes(ir, layout).crossings.length);
    }
    expect(findCrossings(load(serving).value.layout)).toHaveLength(4);
    expect(findCrossings(load(training).value.layout)).toHaveLength(2);
  });

  test("past the limit, one more diagnostic counts the rest", () => {
    const { ir, layout } = load(serving).value;
    const diagnostics = crossingDiagnostics(ir, layout, 1);
    expect(diagnostics.map((d) => d.path)).toEqual([["edges", 6], undefined]);
    expect(diagnostics[1]).toMatchObject({
      code: "layout/edge-crossing",
      severity: "info",
      message: "3 more edge crossings are not listed (4 in total).",
      subject: { kind: "figure", id: "serving-architecture" },
    });
    expect(diagnostics.map((d) => d.hint !== undefined)).toEqual([true, false]);
    // With none listed, the summary carries the hint.
    const [summary] = crossingDiagnostics(ir, layout, 0);
    expect(summary?.message).toBe("4 more edge crossings are not listed (4 in total).");
    expect(summary?.hint).toContain("fromAnchor / toAnchor");
    expect(MAX_REPORTED_CROSSINGS).toBe(10);
  });

  test("no crossings in the examples and fixtures", () => {
    for (const path of [
      "examples/dit-block/dit-block.sumi.yaml",
      "examples/transformer/transformer.sumi.yaml",
      "tests/fixtures/assets/images.sumi.yaml",
      "tests/fixtures/figures/layout/a-transformer.sumi.yaml",
      "tests/fixtures/figures/layout/b-adaln-panel.sumi.yaml",
      "research/109-dogfood-v0.4/repro/shared-segment.sumi.yaml",
    ]) {
      const result = layoutStructuredFigure(readFileSync(`${root}/${path}`, "utf8"));
      expect([path, result.diagnostics.map((d) => d.code)]).toEqual([path, []]);
    }
  });
});

/**
 * A routed layout with only what `findCrossings` reads: each net is a list of
 * edge routes (`[x, y]` points); edges are numbered `e0`, `e1`, … in order.
 */
function routes(...nets: (readonly (readonly [number, number])[])[][]): LayoutIR {
  let n = 0;
  const edges: { key: ElementKey; route: { points: Point[]; net: number } }[] = [];
  const layoutNets = nets.map((lines, id) => {
    const keys = lines.map((line) => {
      const key = `e${n++}` as ElementKey;
      edges.push({ key, route: { points: line.map(([x, y]) => ({ x, y })), net: id } });
      return key;
    });
    return {
      id,
      edges: keys,
      segments: mergeSegments(lines.map((line) => line.map(([x, y]) => ({ x, y })))),
    };
  });
  return { edges, nets: layoutNets } as unknown as LayoutIR;
}

const summary = (layout: LayoutIR) =>
  findCrossings(layout).map((c) => [
    c.point.x,
    c.point.y,
    [...c.edges] as string[],
    [...c.others] as string[],
  ]);

describe("findCrossings: what is a crossing", () => {
  test("two lines crossing", () => {
    expect(
      summary(
        routes(
          [
            [
              [0, 5],
              [10, 5],
            ],
          ],
          [
            [
              [5, 0],
              [5, 10],
            ],
          ],
        ),
      ),
    ).toEqual([[5, 5, ["e1"], ["e0"]]]);
  });

  test("nets that run through a point both ways cross there once (both orders)", () => {
    // Each net has a horizontal and a vertical line through (5, 5).
    const plus = [
      [
        [0, 5],
        [10, 5],
      ],
      [
        [5, 0],
        [5, 10],
      ],
    ] as const;
    const later = [
      [
        [5, 0],
        [5, 10],
      ],
      [
        [0, 5],
        [10, 5],
      ],
    ] as const;
    for (const second of [plus, later]) {
      expect(summary(routes([...plus], [...second]))).toEqual([[5, 5, ["e2", "e3"], ["e0", "e1"]]]);
    }
  });

  test("only edges running through the point are named, not one bending there", () => {
    // Net A: e0 straight through (5, 5); e1 bends there and runs down along
    // net B's line. Net B: e2 straight down.
    const layout = routes(
      [
        [
          [0, 5],
          [10, 5],
        ],
        [
          [0, 5],
          [5, 5],
          [5, 10],
        ],
      ],
      [
        [
          [5, 0],
          [5, 15],
        ],
      ],
    );
    expect(summary(layout)).toEqual([[5, 5, ["e2"], ["e0"]]]);
  });

  test("a net that only bends at the point, along the other net, does not cross (review of #136)", () => {
    // Net A's merged lines pass through (5, 5), but e0 and e1 both only bend
    // there, and A's vertical part runs along e2.
    const layout = routes(
      [
        [
          [0, 5],
          [5, 5],
          [5, 0],
        ],
        [
          [5, 10],
          [5, 5],
          [10, 5],
        ],
      ],
      [
        [
          [5, -5],
          [5, 15],
        ],
      ],
    );
    expect(summary(layout)).toEqual([]);
  });

  test("within a net (a trunk, a junction) nothing crosses", () => {
    expect(
      summary(
        routes([
          [
            [0, 5],
            [10, 5],
          ],
          [
            [5, 0],
            [5, 10],
          ],
        ]),
      ),
    ).toEqual([]);
  });

  test("a line ending or bending on another is a contact, not a crossing", () => {
    // T: B ends on A's line; L: B bends on A's line.
    expect(
      summary(
        routes(
          [
            [
              [0, 5],
              [10, 5],
            ],
          ],
          [
            [
              [5, 0],
              [5, 5],
            ],
          ],
        ),
      ),
    ).toEqual([]);
    expect(
      summary(
        routes(
          [
            [
              [0, 5],
              [10, 5],
            ],
          ],
          [
            [
              [5, 0],
              [5, 5],
              [8, 5],
            ],
          ],
        ),
      ),
    ).toEqual([]);
    expect(
      summary(
        routes(
          [
            [
              [0, 5],
              [10, 5],
            ],
          ],
          [
            [
              [5, 0],
              [5, 5],
              [12, 5],
            ],
          ],
        ),
      ),
    ).toEqual([]);
  });

  test("collinear overlaps are not crossings", () => {
    expect(
      summary(
        routes(
          [
            [
              [0, 5],
              [10, 5],
            ],
          ],
          [
            [
              [3, 5],
              [15, 5],
            ],
          ],
        ),
      ),
    ).toEqual([]);
  });

  test("within 0.01 unit of an end is touching, beyond it crossing", () => {
    expect(
      summary(
        routes(
          [
            [
              [0, 5],
              [10, 5],
            ],
          ],
          [
            [
              [5, 0],
              [5, 5.01],
            ],
          ],
        ),
      ),
    ).toEqual([]);
    expect(
      summary(
        routes(
          [
            [
              [0, 5],
              [10, 5],
            ],
          ],
          [
            [
              [5, 0],
              [5, 5.02],
            ],
          ],
        ),
      ),
    ).toEqual([[5, 5, ["e1"], ["e0"]]]);
    expect(
      summary(
        routes(
          [
            [
              [0, 5],
              [10, 5],
            ],
          ],
          [
            [
              [9.995, 0],
              [9.995, 10],
            ],
          ],
        ),
      ),
    ).toEqual([]);
  });
});

describe("chooseRouting", () => {
  const { ir, layout } = load(serving).value;
  const noRoute: Diagnostic = { code: "layout/no-route", severity: "error", message: "x" };
  const codes = (r: { diagnostics: Diagnostic[] }) => r.diagnostics.map((d) => d.code);

  test("a retry that routes every edge reports its crossings", () => {
    const result = chooseRouting(ir, (stubLines) =>
      stubLines ? { layout, diagnostics: [] } : { layout, diagnostics: [noRoute] },
    );
    expect(codes(result)).toEqual(Array(4).fill("layout/edge-crossing"));
  });

  test("with an edge left without a route, crossings are not reported", () => {
    const result = chooseRouting(ir, () => ({ layout, diagnostics: [noRoute] }));
    expect(codes(result)).toEqual(["layout/no-route"]);
  });

  test("the retry is kept only if it has fewer errors", () => {
    const calls: boolean[] = [];
    const result = chooseRouting(ir, (stubLines) => {
      calls.push(stubLines);
      return { layout, diagnostics: stubLines ? [noRoute, noRoute] : [noRoute] };
    });
    expect([calls, codes(result)]).toEqual([[false, true], ["layout/no-route"]]);
  });
});
