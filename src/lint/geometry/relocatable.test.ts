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
import { placements } from "../../layout/hint-trials";
import { type RenderedStructuredFigure, renderFigure } from "../../render/render";
import { corners } from "./avoidable";
import { geometryContextFor, lintGeometry } from "./lint";
import {
  compareRoutes,
  RELOCATABLE_NODE,
  RELOCATE_TRIALS,
  relocatableNode,
  relocationTrials,
} from "./relocatable";

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
      'Node "retrying" could move from row 5, column 6 to the empty cell at row 4, column 6 of the grid of group "active": then edge edges[11] (c-error → retrying) and edge edges[12] (retrying → c-backoff) bend 0 times in total instead of 4, and the figure is 9.9mm shorter (checked by laying the figure out and routing it again: no other edge bends more or has its detour grow by more than 1pt, the figure does not grow and the geometry lint finds no new error or warning).',
    );
    expect(hint?.hint).toContain(
      "In groups[1].arrange.grid.items, swap items[33] (retrying) with items[26] (the null at row 4, column 6), so row 4, columns 5–7 become c-backoff, retrying, c-error; then delete the last 7 items (row 5, now empty): items: [ ",
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

  test("the trials lay the figure out at most RELOCATE_TRIALS + 1 times, the trials' own lint included", async () => {
    const source = readFileSync(join(FIGURES, "color-use/request-states-a.sumi.yaml"), "utf8");
    const context = geometryContextFor(await render(source));
    const start = placements.count;
    const found = relocatableNode.run(context, undefined);
    const layouts = placements.count - start;
    expect(found).toHaveLength(1);
    // Six candidates and the figure as it is; no rule run on a trial adds any.
    expect(layouts).toBeGreaterThan(1);
    expect(layouts).toBeLessThanOrEqual(RELOCATE_TRIALS + 1);
  });

  test("the hint's edit round-trips: span / align and null wrappers, a reserved-word ID, a nested stack", async () => {
    const original = readFileSync(join(FIGURES, "color-use/request-states-a.sumi.yaml"), "utf8");
    const row1 = "items: [ start, null, c-invalid, null, null, null, null,";
    expect(original).toContain(row1);
    const wrapped = original.replace(
      row1,
      "items: [ { item: start, span: 2, align: start }, c-invalid, null, null, null, null,",
    );
    const nested = original
      .replace(
        row1,
        "items: [ { item: start, span: 2, align: start }, c-invalid, { stack: { gap: 1mm, items: [ note ] } }, null, null, null,",
      )
      .replace("\nnodes:\n", "\nnodes:\n  - { id: note, component: label, label: note }\n");
    // An empty cell two columns wide: a wrapper around null, not a bare null.
    const nullWrapped = original.replace(
      row1,
      "items: [ start, null, c-invalid, { item: null, span: 2 }, null, null,",
    );
    // An ID that YAML reads as a boolean unless quoted.
    const reserved = original
      .replace("{ id: start,", '{ id: "true",')
      .replace("{ from: start,", '{ from: "true",')
      .replace(row1, row1.replace("[ start,", '[ "true",'));
    for (const old of ["{ id: start,", "{ from: start,", "[ start,"])
      expect(reserved).not.toContain(old);
    /** The hint's swap and delete, done on the source's items. */
    const apply = (source: string, hint: string) => {
      const swap = /swap items\[(\d+)\] .*? with items\[(\d+)\]/.exec(hint);
      const drop = /delete the last (\d+) items/.exec(hint);
      if (swap === null) throw new Error(`no swap in ${hint}`);
      const doc = parse(source);
      const items: unknown[] = doc.groups[1].arrange.grid.items;
      const [i, j] = [Number(swap[1]), Number(swap[2])];
      [items[i], items[j]] = [items[j], items[i]];
      if (drop !== null) items.splice(items.length - Number(drop[1]), Number(drop[1]));
      return { doc, items };
    };
    for (const [source, line] of [
      [wrapped, "{ item: start, span: 2, align: start }"],
      [nullWrapped, "{ item: null, span: 2 }"],
      [reserved, '[ "true", null,'],
      [nested, undefined],
    ] as const) {
      const before = await render(source);
      const [hint] = lintGeometry(before, { source }).filter((d) => d.code === RELOCATABLE_NODE);
      if (hint?.hint === undefined) throw new Error("no hint");
      const { doc, items } = apply(source, hint.hint);
      const written = /: items: (\[.*\])\. Nothing/.exec(hint.hint)?.[1];
      if (line !== undefined) {
        // The items line parses to the same items as the edit, wrappers and quoting included.
        expect(written).toBeDefined();
        expect(parse(written ?? "")).toEqual(items);
        expect(written).toContain(line);
      } else {
        // A nested box cannot be written back: no items line, only the edit.
        expect(written).toBeUndefined();
        expect(hint.hint).not.toContain("…");
      }
      const after = await render(stringify(doc));
      expect(bends(after, "e:#11")).toBe(0);
      expect(bends(after, "e:#12")).toBe(0);
      expect(after.layout?.canvas.height).toBeLessThan(before.layout?.canvas.height ?? 0);
    }
  });

  test("a grid inside a cell wrapper of span 1: the hint names the path under `item`", async () => {
    // `{ item: <grid> }` with no span or align: the wrapper is still written,
    // so the inner grid's items are at …items[0].item.grid.items.
    const doc = parse(readFileSync(join(FIGURES, "color-use/request-states-a.sumi.yaml"), "utf8"));
    doc.groups[1].arrange = { grid: { columns: 1, items: [{ item: doc.groups[1].arrange }] } };
    const source = stringify(doc);
    const [hint] = lintGeometry(await render(source), { source }).filter(
      (d) => d.code === RELOCATABLE_NODE,
    );
    expect(hint?.path).toEqual([
      "groups",
      1,
      "arrange",
      "grid",
      "items",
      0,
      "item",
      "grid",
      "items",
    ]);
    expect(hint?.hint).toStartWith(
      "In groups[1].arrange.grid.items[0].item.grid.items, swap items[33] (retrying) with items[26]",
    );
    // The location is the inner grid's items: the line after its `items:` key.
    const lines = source.split("\n");
    const line = hint?.location?.line ?? 0;
    expect(lines[line - 2]?.trim()).toBe("items:");
    expect(lines[line - 1]?.trim()).toBe("- start");
    expect(lines.slice(0, line - 2).some((l) => l.trim() === "- item:")).toBe(true);
  });

  test("a move that lengthens another edge's detour by more than 1pt is turned down", () => {
    const routes = (entries: [string, number, number][]) =>
      new Map(entries.map(([key, bends, detour]) => [key as `e:${string}`, { bends, detour }]));
    const before = routes([
      ["e:#0", 2, 0],
      ["e:#1", 1, 0],
    ]);
    // e:#0 goes straight; e:#1 keeps its bend but runs 3 units (1.5pt) further back.
    expect(
      compareRoutes(
        before,
        routes([
          ["e:#0", 0, 0],
          ["e:#1", 1, 3],
        ]),
        ["e:#0" as `e:${string}`],
      ),
    ).toEqual({ ok: false, reason: "longer-detour" });
    // Up to 1pt (2 units) is allowed.
    expect(
      compareRoutes(
        before,
        routes([
          ["e:#0", 0, 0],
          ["e:#1", 1, 2],
        ]),
        ["e:#0" as `e:${string}`],
      ),
    ).toEqual({ ok: true, bends: [2, 0], detour: 0 });
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
    const figure = await render(source);
    // The swap is tried, and its routes alone would pass (fewer bends, nothing
    // worse), but it turns an edge around.
    const outcomes = relocationTrials(geometryContextFor(figure));
    const reversed = outcomes.filter((o) => !o.verdict.ok && o.verdict.reason === "reversed");
    expect(reversed.length).toBeGreaterThan(0);
    for (const o of reversed) {
      expect(o.routes?.ok).toBe(true);
      if (o.routes?.ok) expect(o.routes.bends[1]).toBeLessThan(o.routes.bends[0]);
    }
    expect(outcomes.some((o) => o.verdict.ok)).toBe(false);
    const lint = lintGeometry(figure, { source });
    expect(lint.filter((d) => d.code === RELOCATABLE_NODE)).toEqual([]);
  });
});
