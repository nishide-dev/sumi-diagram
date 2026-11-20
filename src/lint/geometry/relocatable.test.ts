/**
 * `geometry/relocatable-node` (#621): moving an end of an edge that bends
 * more than its ends need to a nearby empty grid cell or another place in its
 * stack / row, checked by laying the figure out and routing it again. The
 * structured figures here render without D2.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import type { Diagnostic } from "../../core/diagnostics";
import { type RenderedStructuredFigure, renderFigure } from "../../render/render";
import { corners } from "./avoidable";
import { lintGeometry } from "./lint";
import { RELOCATABLE_NODE } from "./relocatable";

const FIGURES = join(import.meta.dir, "..", "..", "..", "tests", "fixtures", "figures");

async function rendered(
  source: string,
): Promise<{ figure: RenderedStructuredFigure; diagnostics: readonly Diagnostic[] }> {
  const result = await renderFigure(source);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  return { figure: result.value as RenderedStructuredFigure, diagnostics: result.diagnostics };
}

const render = async (source: string) => (await rendered(source)).figure;

const bends = (figure: RenderedStructuredFigure, key: string): number => {
  const points = figure.layout?.edges.find((e) => e.key === key)?.route?.points;
  if (points === undefined) throw new Error(`no route for ${key}`);
  return corners(points).length - 2;
};

/** Errors and warnings, by code and subject. */
const problems = (diagnostics: readonly Diagnostic[]) =>
  diagnostics
    .filter((d) => d.severity === "error" || d.severity === "warning")
    .map((d) => `${d.code} ${JSON.stringify(d.subject ?? null)}`)
    .sort();

describe("geometry/relocatable-node", () => {
  test("request-states-a: moving Retrying up between c-backoff and c-error straightens both its edges", async () => {
    const source = readFileSync(join(FIGURES, "color-use/request-states-a.sumi.yaml"), "utf8");
    const { figure: before, diagnostics: drawn } = await rendered(source);
    // c-error → Retrying and Retrying → c-backoff: a Z each.
    expect(bends(before, "e:#11")).toBe(2);
    expect(bends(before, "e:#12")).toBe(2);
    const lint = lintGeometry(before, { source });
    const found = lint.filter((d) => d.code === RELOCATABLE_NODE);
    expect(found).toHaveLength(1);
    const [hint] = found;
    expect(hint?.severity).toBe("info");
    expect(hint?.subject).toEqual({ kind: "node", id: "retrying" });
    expect(hint?.path).toEqual(["groups", 1, "arrange", "grid", "items"]);
    expect(hint?.message).toBe(
      'Node "retrying" could move from row 5, column 6 to the empty cell at row 4, column 6 of the grid of group "active": then edge edges[11] (c-error → retrying) and edge edges[12] (retrying → c-backoff) bend 0 times in total instead of 4, and the figure is 9.9mm shorter (checked by laying the figure out and routing it again: no other edge bends more, the figure does not grow and no new error or warning appears).',
    );
    expect(hint?.hint).toContain(
      "In groups[1].arrange.grid.items, row 4, columns 5–7 become c-backoff, retrying, c-error, and the emptied last row 5 is dropped: items: [ ",
    );

    // Apply the hint: write its items line into the grid.
    const items = /items: \[ (.*) \]\./.exec(hint?.hint ?? "")?.[1]?.split(", ");
    if (items === undefined) throw new Error("no items in the hint");
    const doc = parse(source);
    doc.groups[1].arrange.grid.items = items.map((i) => (i === "null" ? null : i));
    const applied = stringify(doc);
    const { figure: after, diagnostics: redrawn } = await rendered(applied);
    // Both lines are straight; no other edge bends more; the figure is shorter, not wider.
    expect(bends(after, "e:#11")).toBe(0);
    expect(bends(after, "e:#12")).toBe(0);
    for (const edge of before.layout?.edges ?? [])
      expect(bends(after, edge.key)).toBeLessThanOrEqual(bends(before, edge.key));
    const [b, a] = [before.layout?.canvas, after.layout?.canvas];
    expect(a?.height).toBeLessThan(b?.height ?? 0);
    expect(a?.width).toBeLessThanOrEqual(b?.width ?? 0);
    // No new error or warning, and nothing more to move.
    const relint = lintGeometry(after, { source: applied });
    expect(problems([...redrawn, ...relint])).toEqual(problems([...drawn, ...lint]));
    expect(relint.filter((d) => d.code === RELOCATABLE_NODE)).toEqual([]);
  });

  test("a figure without detours gets nothing", async () => {
    // A grid with an empty cell, but every line already straight or a plain L.
    const source = `version: 1
figure:
  id: plain
  theme: academic
  layout:
    arrange:
      grid: { columns: 3, columnGap: 6mm, rowGap: 6mm, items: [a, b, null, null, c, d] }
nodes:
  - { id: a, component: box, label: A }
  - { id: b, component: box, label: B }
  - { id: c, component: box, label: C }
  - { id: d, component: box, label: D }
edges:
  - { from: a, to: b }
  - { from: b, to: c }
  - { from: c, to: d }
`;
    const lint = lintGeometry(await render(source), { source });
    expect(lint.filter((d) => d.code === RELOCATABLE_NODE)).toEqual([]);
  });

  test("a reorder that turns an edge around is not suggested", async () => {
    // group-caption: swapping enc and dec bends inner → c and c → out less
    // (8 → 6), but Encoder → Decoder would run right to left.
    const source = readFileSync(join(FIGURES, "layout/group-caption.sumi.yaml"), "utf8");
    const lint = lintGeometry(await render(source), { source });
    expect(lint.filter((d) => d.code === RELOCATABLE_NODE)).toEqual([]);
  });
});
