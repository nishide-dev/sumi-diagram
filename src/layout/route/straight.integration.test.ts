/**
 * `straight` anchors (#179, design doc §6.47) on the figures of prototype P1
 * (`research/167-stage-c/proto/straight.ts`, docs/research/167-stage-c.md
 * §5.1): the 21 edges whose ends #167 found out of line (the encoders into
 * the Token Refiner and two more of figure C, five of figure B, the nine
 * patches and tokens of #151's ViT). Written as `toAnchor: straight` (and
 * `fromAnchor: straight` on Refiner → A5, whose target is too narrow to
 * take the Refiner's centre), every one is a single straight segment.
 * Needs no D2.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import type { Diagnostic } from "../../core/diagnostics";
import type { RenderedStructuredFigure } from "../../render/render";
import { renderFigure } from "../../render/render";
import type { LayoutIR, Point } from "../ir";
import { placeStructured } from "../structured/engine";
import { checkRoutes } from "./check";
import { routeEdges } from "./router";

const ROOT = join(import.meta.dir, "..", "..", "..");

interface Case {
  readonly name: string;
  readonly file: string;
  /** [from, to, the end written `straight`]. */
  readonly edges: readonly (readonly [string, string, "from" | "to"])[];
}

const CASES: readonly Case[] = [
  {
    name: "#167 figure C (H3-World)",
    file: join(ROOT, "research/167-stage-c/figures/c-h3world.sumi.yaml"),
    edges: [
      ["enc0", "refiner", "to"],
      ["enc1", "refiner", "to"],
      ["enc2", "refiner", "to"],
      ["enc3", "refiner", "to"],
      ["enc4", "refiner", "to"],
      ["refiner", "seq-a5", "from"],
      ["bt-a3", "b-block1", "to"],
    ],
  },
  {
    name: "#167 figure B (DiT)",
    file: join(ROOT, "research/167-stage-c/figures/b-dit.sumi.yaml"),
    edges: [
      ["patchify", "dit-block", "to"],
      ["embed", "dit-block", "to"],
      ["timestep", "embed", "to"],
      ["noised", "patchify", "to"],
      ["i-tokens", "i-concat", "to"],
    ],
  },
  {
    name: "#151 ViT input",
    file: join(ROOT, "research/151-dogfood-v0.5/figures/vit-input.sumi.yaml"),
    edges: [
      ["p1", "projection", "to"],
      ["p2", "projection", "to"],
      ["p3", "projection", "to"],
      ["p4", "projection", "to"],
      ["t0", "encoder", "to"],
      ["t1", "encoder", "to"],
      ["t2", "encoder", "to"],
      ["t3", "encoder", "to"],
      ["t4", "encoder", "to"],
    ],
  },
];

/**
 * The figure with the selected edges' anchors replaced by `straight` on one
 * end, or (`straight: false`) removed.
 */
function withStraight(text: string, c: Case, straight = true): string {
  // biome-ignore lint/suspicious/noExplicitAny: free-form YAML document
  const doc: any = parse(text);
  for (const [from, to, end] of c.edges) {
    const edge = doc.edges.find(
      (e: { from: string; to: string }) => e.from === from && e.to === to,
    );
    if (edge === undefined) throw new Error(`${c.name}: no edge ${from} → ${to}`);
    delete edge.fromAnchor;
    delete edge.toAnchor;
    if (straight) edge[end === "to" ? "toAnchor" : "fromAnchor"] = "straight";
  }
  return stringify(doc);
}

async function render(text: string, file: string) {
  const result = await renderFigure(text, { assetBase: join(file, "..") });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  return { rendered: result.value as RenderedStructuredFigure, diagnostics: result.diagnostics };
}

/** Interior points where the route turns (exact: no tolerance). */
function bends(points: readonly Point[]): number {
  let count = 0;
  for (let i = 1; i + 1 < points.length; i++) {
    const a = points[i - 1] as Point;
    const b = points[i] as Point;
    const next = points[i + 1] as Point;
    const cross = (b.x - a.x) * (next.y - b.y) - (b.y - a.y) * (next.x - b.x);
    if (cross !== 0) count++;
  }
  return count;
}

function routeOf(
  layout: LayoutIR,
  ir: RenderedStructuredFigure["compiled"]["ir"],
  f: string,
  t: string,
) {
  const id = (key: string) => ir.elements.get(key as never);
  const edge = ir.edges.find((e) => {
    const from = id(e.from);
    const to = id(e.to);
    return from?.kind !== "edge" && to?.kind !== "edge" && from?.id === f && to?.id === t;
  });
  if (edge === undefined) throw new Error(`no edge ${f} → ${t}`);
  const points = layout.edges.find((e) => e.key === edge.key)?.route?.points;
  if (points === undefined) throw new Error(`no route for ${f} → ${t}`);
  return points;
}

const codes = (diagnostics: readonly Diagnostic[]) => diagnostics.map((d) => d.code);

describe("straight anchors on the P1 figures (#179)", () => {
  test("21 edges in all", () => {
    expect(CASES.reduce((n, c) => n + c.edges.length, 0)).toBe(21);
  });
  for (const c of CASES) {
    test(`${c.name}: ${c.edges.length} edges, each one straight segment`, async () => {
      const text = withStraight(await Bun.file(c.file).text(), c);
      const { rendered, diagnostics } = await render(text, c.file);
      const { ir } = rendered.compiled;
      for (const [from, to] of c.edges) {
        const points = routeOf(rendered.layout, ir, from, to);
        expect({ edge: `${from} → ${to}`, points: points.length, bends: bends(points) }).toEqual({
          edge: `${from} → ${to}`,
          points: 2,
          bends: 0,
        });
        const [a, b] = points as [Point, Point];
        // Exactly in line: the same x (or y), not merely within a tolerance.
        expect(a.x === b.x || a.y === b.y).toBe(true);
      }
      expect(codes(diagnostics)).not.toContain("layout/straight-off-side");
      expect(codes(diagnostics)).not.toContain("layout/unaligned-ends");
      const report = checkRoutes(ir, rendered.layout);
      expect(Object.entries(report).filter(([, list]) => list.length > 0)).toEqual([]);
      // The router's lower bound stays admissible on the same placement.
      const placed = placeStructured(ir).layout;
      expect(() => routeEdges(ir, placed, { verifyLowerBound: true })).not.toThrow();
    });

    test(`${c.name}: without anchors, the same edges bend`, async () => {
      const text = withStraight(await Bun.file(c.file).text(), c, false);
      const { rendered } = await render(text, c.file);
      const total = c.edges.reduce(
        (sum, [from, to]) => sum + bends(routeOf(rendered.layout, rendered.compiled.ir, from, to)),
        0,
      );
      expect(total).toBeGreaterThan(0);
    });
  }
});
