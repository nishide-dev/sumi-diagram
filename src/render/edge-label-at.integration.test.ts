/**
 * `edges[].labelAt` (#128) on the stage-B draft of #109's figure 2
 * (research/124-stage-b): with `labelAt: middle`, `update θ` sits beside the
 * dashed run under the loss box, clear of the box, the curve's line and the
 * other labels (the #124 prototype, without avoidance, put it on the loss
 * box with 3 collisions). Structured only: no D2 needed.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import type { Rect } from "../layout/ir";
import { checkRoutes } from "../layout/route/check";
import { lintGeometry } from "../lint/geometry";
import { type RenderedStructuredFigure, renderFigure } from "./render";

const ROOT = join(import.meta.dir, "..", "..");
const FIGURES = join(ROOT, "research/124-stage-b/figures");

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** Figure 2's draft without what this build does not have yet (#129, #130, #131). */
function draft(labelAt: string | undefined): string {
  const doc = parse(readFileSync(join(FIGURES, "training-pipeline.sumi.yaml"), "utf8"));
  // Not part of #128: the version gate, captions, the legend and accents.
  delete doc.requires;
  for (const group of doc.groups) delete group.caption;
  doc.nodes = doc.nodes.filter((n: { id: string }) => n.id !== "key");
  doc.figure.layout.arrange.stack.items[1].row.items = ["train-step"];
  const plain = (s: unknown) =>
    typeof s === "string" ? s.replace(/\\(?:tilde|hat)\{(\w)\}/g, "$1") : s;
  for (const element of [...doc.nodes, ...doc.edges]) element.label = plain(element.label);
  const update = doc.edges[7];
  expect(update.label).toBe("update $\\theta$");
  if (labelAt !== undefined) update.labelAt = labelAt;
  return stringify(doc);
}

async function render(source: string) {
  const result = await renderFigure(source, { assetBase: FIGURES });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  if (result.value.compiled.engine !== "structured") throw new Error("not structured");
  return { source, rendered: result.value as RenderedStructuredFigure };
}

describe("the stage-B draft of figure 2 (research/124-stage-b)", () => {
  test("update θ with labelAt: middle stays off the loss box and every route", async () => {
    const { source, rendered } = await render(draft("middle"));
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
    // Nothing of the geometry lint about it either.
    const findings = lintGeometry(rendered, { source });
    const about = (path: readonly unknown[] | undefined) => path?.[0] === "edges" && path[1] === 7;
    expect(
      findings.filter((d) => about(d.path) || (d.related ?? []).some((r) => about(r.path))),
    ).toEqual([]);
  });
});
