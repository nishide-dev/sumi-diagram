/**
 * `edges[].labelAt` / `labelSide` (#128) through `renderFigure`, as the
 * author sees it (structured only: no D2 needed):
 * - the stage-B draft of #109's figure 2 (research/124-stage-b): with
 *   `labelAt: middle`, `update θ` sits beside the dashed run under the loss
 *   box, clear of the box, the curve's line and the other labels (the #124
 *   prototype, without avoidance, put it on the loss box with 3 collisions);
 * - a requested place with nothing clear is kept and reported as
 *   `layout/edge-label-overlap` (the geometry lint does not check an edge's
 *   own label against its own line).
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import type { Diagnostic } from "../core/diagnostics";
import type { Rect } from "../layout/ir";
import { checkRoutes } from "../layout/route/check";
import { lintGeometry } from "../lint/geometry";
import { type RenderedStructuredFigure, renderFigure } from "./render";

const ROOT = join(import.meta.dir, "..", "..");
const FIGURES = join(ROOT, "research/124-stage-b/figures");

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** Figure 2's draft without what this build does not have yet (#130, #131). */
function draft(labelAt: string | undefined): string {
  const doc = parse(readFileSync(join(FIGURES, "training-pipeline.sumi.yaml"), "utf8"));
  // Not part of #128: the version gate, captions and the legend.
  delete doc.requires;
  for (const group of doc.groups) delete group.caption;
  doc.nodes = doc.nodes.filter((n: { id: string }) => n.id !== "key");
  doc.figure.layout.arrange.stack.items[1].row.items = ["train-step"];
  const update = doc.edges[7];
  expect(update.label).toBe("update $\\theta$");
  if (labelAt !== undefined) update.labelAt = labelAt;
  return stringify(doc);
}

async function render(source: string, assetBase?: string) {
  const result = await renderFigure(source, { ...(assetBase !== undefined && { assetBase }) });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  if (result.value.compiled.engine !== "structured") throw new Error("not structured");
  return {
    source,
    rendered: result.value as RenderedStructuredFigure,
    diagnostics: result.diagnostics,
  };
}

const overlapWarnings = (diagnostics: readonly Diagnostic[]) =>
  diagnostics.filter((d) => d.code === "layout/edge-label-overlap");

describe("the stage-B draft of figure 2 (research/124-stage-b)", () => {
  test("update θ with labelAt: middle stays off the loss box and every route", async () => {
    const { source, rendered, diagnostics } = await render(draft("middle"), FIGURES);
    const { layout } = rendered;
    const loss = layout.nodes.find((n) => n.key === "n:loss")?.rect;
    const route = layout.edges[7]?.route;
    const label = route?.label?.box;
    if (loss === undefined || route === undefined || label === undefined) {
      throw new Error("no loss box or update θ label");
    }
    expect(overlaps(label, loss)).toBe(false);
    // Beside the longest segment: the dashed run under the loss box.
    const [a, b] = route.points.slice(1, 3);
    if (a === undefined || b === undefined) throw new Error("no run");
    expect(a.y).toBe(b.y);
    expect(label.x).toBeGreaterThan(Math.min(a.x, b.x));
    expect(label.x + label.width).toBeLessThan(Math.max(a.x, b.x));
    const collisions = checkRoutes(rendered.compiled.ir, layout).labelCollisions;
    expect(collisions.filter((c) => c.includes("e:#7"))).toEqual([]);
    // Nothing reported about it. The draft's "batch" (labelSide: right) has
    // the dataset → loss line on its side: kept there, and reported.
    expect(overlapWarnings(diagnostics).map((d) => d.path)).toEqual([["edges", 3]]);
    const findings = lintGeometry(rendered, { source });
    const about = (path: readonly unknown[] | undefined) => path?.[0] === "edges" && path[1] === 7;
    expect(
      findings.filter((d) => about(d.path) || (d.related ?? []).some((r) => about(r.path))),
    ).toEqual([]);
  });
});

describe("a requested place with nothing clear", () => {
  // #116's reproduction: the last segment, up into the model, is shorter
  // than the label; on its right the label meets the run under both boxes.
  const figure = (fields: object) =>
    stringify({
      version: 1,
      figure: {
        id: "update",
        theme: "academic",
        layout: { arrange: { row: { gap: "10mm", items: ["model", "optimizer"] } } },
      },
      nodes: [
        { id: "model", component: "box", label: "model" },
        { id: "optimizer", component: "box", label: "optimizer" },
      ],
      edges: [
        {
          from: "optimizer",
          to: "model",
          fromAnchor: "south",
          toAnchor: "south",
          label: "update θ",
          ...fields,
        },
      ],
    });

  test("is kept and reported as a positioned warning", async () => {
    const { source, rendered, diagnostics } = await render(
      figure({ labelAt: "end", labelSide: "right" }),
    );
    expect(diagnostics.map((d) => [d.code, d.severity, d.path, d.location?.line])).toEqual([
      ["layout/edge-label-overlap", "warning", ["edges", 0], 20],
    ]);
    const [warning] = diagnostics;
    expect(warning?.message).toBe(
      'The label of edge edges[0] ("optimizer" → "model") overlaps its own line: nothing beside the segment and side it asks for (labelAt: end, labelSide: right) is clear.',
    );
    expect(warning?.hint).toContain("Try labelSide: left, or labelAt: start or middle");
    // The geometry lint does not see it (an edge's own label and line).
    expect(lintGeometry(rendered, { source })).toEqual([]);
  });

  test("the other side is clear: no warning; without the fields, none either", async () => {
    expect((await render(figure({ labelAt: "end", labelSide: "left" }))).diagnostics).toEqual([]);
    expect((await render(figure({}))).diagnostics).toEqual([]);
  });
});
