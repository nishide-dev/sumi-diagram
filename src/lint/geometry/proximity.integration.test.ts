/**
 * The proximity rules (#156) on a structured figure as rendered: they
 * measure what the wires paint (rounded turns, stopping at arrowheads), not
 * the sharp `path.connection` route (#163 review). Needs no D2.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { Point } from "../../core/geometry";
import { renderFigure } from "../../render/render";
import { geometryContextFor, lintGeometry } from "./lint";
import { axisSegments } from "./proximity";

const ROOT = join(import.meta.dir, "..", "..", "..");
const FIGURE = join(ROOT, "research/151-dogfood-v0.5/figures/serving-architecture.sumi.yaml");

const length = (lines: readonly (readonly Point[])[]) =>
  axisSegments(lines).reduce((sum, s) => sum + s.to - s.from, 0);

describe("proximity rules on painted wires (structured)", async () => {
  const source = await Bun.file(FIGURE).text();
  const result = await renderFigure(source, { assetBase: join(FIGURE, "..") });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  const rendered = result.value;

  test("each edge's drawn lines lie on its route, short of every turn", () => {
    expect(rendered.inspection.painted?.length).toBe(18);
    const context = geometryContextFor(rendered);
    const edges = context.elements.filter((e) => e.kind === "edge");
    expect(edges.length).toBe(18);
    for (const edge of edges) {
      const { route, drawn } = edge;
      if (route === undefined || drawn === undefined) throw new Error(`${edge.name} not drawn`);
      const sharp = axisSegments(route);
      // The straight pieces (the turns are flattened arcs).
      const painted = axisSegments(drawn.filter((line) => line.length === 2));
      expect(painted.length).toBeGreaterThan(0);
      for (const piece of painted) {
        // On one of the route's straight segments, within it.
        expect(
          sharp.some(
            (s) =>
              s.axis === piece.axis &&
              Math.abs(s.at - piece.at) < 0.02 &&
              piece.from >= s.from - 0.02 &&
              piece.to <= s.to + 0.02,
          ),
        ).toBe(true);
      }
      // The turns are rounded off (and the wire stops at the arrowhead).
      expect(length(drawn)).toBeLessThan(length(route));
      const corners = route.flatMap((line) => line.slice(1, -1));
      for (const corner of corners) {
        for (const piece of painted) {
          const along = piece.axis === "h" ? corner.x : corner.y;
          const across = piece.axis === "h" ? corner.y : corner.x;
          if (Math.abs(across - piece.at) > 0.02) continue;
          // A turn is never covered by a straight piece.
          expect(along <= piece.from + 0.02 || along >= piece.to - 0.02).toBe(true);
        }
      }
    }
  });

  test("the findings, with the painted lengths", () => {
    const findings = lintGeometry(rendered, { source })
      .filter((d) =>
        /^geometry\/edge-(on-border|near-border|near-edge|touches-label)$/.test(d.code),
      )
      .map((d) => `${d.code}: ${d.message}`);
    expect(findings).toEqual([
      'geometry/edge-near-border: The line shared by edge edges[0], edge edges[1] and edge edges[2] runs right beside the border of group "api" for 15.1mm (0.35mm between the lines), so it reads as part of the frame.',
      'geometry/edge-near-border: Edge edges[11] runs right beside the border of group "storage" for 24.7mm (0.35mm between the lines), so it reads as part of the frame.',
      'geometry/edge-near-border: Edge edges[14] runs right beside the border of group "storage" for 16.5mm (0.35mm between the lines), so it reads as part of the frame.',
      "geometry/edge-near-edge: The line shared by edge edges[14] and edge edges[15] runs beside the line shared by edge edges[11] and edge edges[13] for 10.0mm, 0.46mm apart, so the two read as one line.",
      'geometry/edge-on-border: Edge edges[16] runs on the border of group "workers" for 31.8mm (0.16mm between the lines), so it reads as part of the frame.',
      "geometry/edge-near-edge: Edge edges[17] runs beside edge edges[16] for 40.8mm, 0.16mm apart, so the two read as one line.",
    ]);
  });
});

describe("painted geometry per edge (structured)", () => {
  test("a hidden junction's turn belongs to an edge that meets there", async () => {
    // research/151 figure 2: the residual edges fork off hidden junctions.
    const file = join(ROOT, "research/151-dogfood-v0.5/figures/dit-block.sumi.yaml");
    const result = await renderFigure(await Bun.file(file).text());
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
    const context = geometryContextFor(result.value);
    const within = (v: number, s: number, t: number) =>
      v >= Math.min(s, t) - 0.02 && v <= Math.max(s, t) + 0.02;
    const onRoute = (p: Point, route: readonly (readonly Point[])[]) =>
      route.some((line) =>
        line.some((q, i) => {
          const a = line[i - 1];
          return a !== undefined && within(p.x, a.x, q.x) && within(p.y, a.y, q.y);
        }),
      );
    // A turn (arc) with an end off its own edge's route joins two routes at a junction.
    const joins = context.elements.flatMap((e) =>
      (e.drawn ?? []).filter(
        (line) =>
          line.length > 2 &&
          e.route !== undefined &&
          !(onRoute(line[0] as Point, e.route) && onRoute(line.at(-1) as Point, e.route)),
      ),
    );
    expect(joins.length).toBeGreaterThan(0);
  });
});
