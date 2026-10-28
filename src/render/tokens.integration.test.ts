/**
 * Tokens (#181, design doc §6.50) end to end, without D2: the H3-World
 * figure of research/167-stage-c (packed sequence, H3 block tokens, LoRA
 * token column and ten key clusters) and the ViT input figure of
 * research/151-dogfood-v0.5, with their hand-written token cells rewritten
 * as `component: tokens` (research/181-tokens, by its rewrite.ts), have the
 * same Layout IR as the originals once the cells' reserved IDs are mapped to
 * the hand-written IDs; the same diagnostics, except that the LoRA tokens'
 * cells (no labels) get no `lint/empty-label`; and the same SVG drawing,
 * element by element.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ElementKey } from "../core/check-state";
import type { Diagnostic } from "../core/diagnostics";
import type { LayoutIR } from "../layout/ir";
import { lintRenderedFigure } from "../lint/geometry/lint";
import { type RenderedFigure, renderFigure } from "./render";

const ROOT = join(import.meta.dir, "..", "..");

async function render(
  file: string,
): Promise<{ rendered: RenderedFigure; diagnostics: Diagnostic[] }> {
  const path = join(ROOT, file);
  const report = await lintRenderedFigure(readFileSync(path, "utf8"), {
    file,
    assetBase: dirname(path),
  });
  if (report.rendered === undefined) throw new Error(JSON.stringify(report.diagnostics, null, 2));
  return { rendered: report.rendered, diagnostics: report.diagnostics };
}

function layoutOf(rendered: RenderedFigure): LayoutIR {
  if (!("layout" in rendered)) throw new Error("not a structured figure");
  return rendered.layout;
}

/**
 * The Layout IR with node keys renamed by `rename`; nodes in key order when
 * `sorted` (their document order is checked apart, see {@link paintPairs}).
 */
function normalized(layout: LayoutIR, rename: (id: string) => string, sorted: boolean): unknown {
  const key = (k: ElementKey): ElementKey => (k.startsWith("n:") ? `n:${rename(k.slice(2))}` : k);
  const nodes = layout.nodes.map((n) => ({ ...n, key: key(n.key) }));
  return {
    ...layout,
    nodes: sorted ? nodes.sort((a, b) => a.key.localeCompare(b.key)) : nodes,
    edges: layout.edges.map((e) => ({ ...e, from: key(e.from), to: key(e.to) })),
  };
}

/**
 * For every two nodes whose rectangles meet, which one is painted later:
 * what the paint order decides where they overlap.
 */
function paintPairs(layout: LayoutIR, rename: (id: string) => string): string[] {
  const nodes = layout.nodes.map((n) => ({ id: rename(n.key.slice(2)), rect: n.rect }));
  const pairs: string[] = [];
  for (const [i, a] of nodes.entries()) {
    for (const b of nodes.slice(i + 1)) {
      const meet =
        a.rect.x <= b.rect.x + b.rect.width &&
        b.rect.x <= a.rect.x + a.rect.width &&
        a.rect.y <= b.rect.y + b.rect.height &&
        b.rect.y <= a.rect.y + a.rect.height;
      if (meet) pairs.push([a.id, b.id].sort().join(" ") + (a.id < b.id ? " <" : " >"));
    }
  }
  return pairs.sort();
}

const KEYS = { move: ["w", "a", "s", "d"], look: ["i", "f", "j", "k", "l"] } as const;

/** H3-World: the reserved IDs of the cells → the hand-written IDs. */
function h3world(id: string): string {
  const key = /^(k\d)-(move|look)-(\d)$/.exec(id);
  if (key) return `${key[1]}-${KEYS[key[2] as "move" | "look"][Number(key[3]) - 1]}`;
  const column = /^ct-(\d)$/.exec(id);
  if (column) return `ct-${Number(column[1]) - 1}`;
  return id; // seq-<id> and bt-<id> are the hand-written IDs already.
}

/** ViT: `tok<i>-pos` → `e<i>`, `tok<i>-x` → `t<i>`. */
function vit(id: string): string {
  const cell = /^tok(\d)-(pos|x)$/.exec(id);
  return cell ? `${cell[2] === "pos" ? "e" : "t"}${cell[1]}` : id;
}

/** Diagnostics without their source positions, which differ between the files. */
function codes(diagnostics: Diagnostic[]): string[] {
  return diagnostics.map((d) => `${d.severity} ${d.code}`).sort();
}

/** The SVG's element groups (balanced `<g>…</g>`), keyed by element class, with IDs renamed. */
function drawing(svg: string, rename: (id: string) => string): Map<string, string> {
  const chunks = new Map<string, string>();
  for (const match of svg.matchAll(/<g class="sumi-k-([nge])--([^ "]+)/g)) {
    let depth = 0;
    let end = match.index;
    for (const tag of svg.slice(match.index).matchAll(/<(\/?)g[ >]/g)) {
      depth += tag[1] === "/" ? -1 : 1;
      if (depth === 0) {
        end = match.index + tag.index + "</g>".length;
        break;
      }
    }
    const kind = match[1] as string;
    const id = kind === "n" ? rename(match[2] as string) : (match[2] as string);
    const chunk = svg
      .slice(match.index, end)
      .replaceAll(`sumi-k-n--${match[2]}`, `sumi-k-n--${id}`);
    chunks.set(`${kind}:${id}`, chunk);
  }
  return chunks;
}

describe("tokens have the Layout IR of the hand-written cells (#181)", () => {
  const cases = [
    {
      name: "H3-World (sequence, block tokens, LoRA column, key clusters)",
      original: "research/167-stage-c/figures/c-h3world.sumi.yaml",
      rewritten: "research/181-tokens/figures/c-h3world.sumi.yaml",
      rename: h3world,
      // The LoRA tokens' 9 unlabeled cells are blank tokens, not missing labels.
      emptyLabels: 9,
      // The cells were written in the tokens' order, where the tokens are.
      sameOrder: true,
    },
    {
      name: "ViT input (position and patch token pairs)",
      original: "research/151-dogfood-v0.5/figures/vit-input.sumi.yaml",
      rewritten: "research/181-tokens/figures/vit-input.sumi.yaml",
      rename: vit,
      emptyLabels: 0,
      // Written as e0…e4, then t0…t4; the tokens hold the pairs e0, t0, ….
      sameOrder: false,
    },
  ];
  for (const c of cases) {
    test(c.name, async () => {
      const original = await render(c.original);
      const rewritten = await render(c.rewritten);
      const ordered = c.sameOrder;
      expect(normalized(layoutOf(rewritten.rendered), c.rename, !ordered)).toEqual(
        normalized(layoutOf(original.rendered), (id) => id, !ordered),
      );
      // Elements that touch or overlap are painted in the same order.
      expect(paintPairs(layoutOf(rewritten.rendered), c.rename)).toEqual(
        paintPairs(layoutOf(original.rendered), (id) => id),
      );
      // The same findings, but no lint/empty-label on the cells.
      const empty = (d: Diagnostic) => d.code === "lint/empty-label";
      expect(
        original.diagnostics.filter(empty).length - rewritten.diagnostics.filter(empty).length,
      ).toBe(c.emptyLabels);
      expect(codes(rewritten.diagnostics.filter((d) => !empty(d)))).toEqual(
        codes(original.diagnostics.filter((d) => !empty(d))),
      );
      for (const d of rewritten.diagnostics.filter(empty)) {
        expect(d.message).not.toMatch(/^Node "(seq|bt|ct|k\d|tok\d)-/);
      }
      // Each element is drawn the same, in the same order when the cells
      // were written in the tokens' order.
      const before = drawing(original.rendered.svg, (id) => id);
      const after = drawing(rewritten.rendered.svg, c.rename);
      if (ordered) expect([...after.keys()]).toEqual([...before.keys()]);
      else expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
      for (const [key, chunk] of after)
        expect({ key, chunk }).toEqual({ key, chunk: before.get(key) ?? "" });
    });
  }
});

describe("cells are painted in the tokens node's place (#181)", () => {
  // A note attached east of the first cell covers the second one; written
  // after the tokens, it must be painted over the cells, as by hand.
  const source = (nodes: string, item: string, target: string) => `version: 1
figure:
  id: order
  theme: color
  layout: { arrange: { row: { items: [${item}] } } }
nodes:
${nodes}
  - { id: note, component: box, label: N, props: { width: 30pt, height: 20pt }, attach: { to: ${target}, side: east } }
`;
  const handWritten = source(
    [
      "  - { id: seq-1, component: box, label: A, props: { width: 30pt, height: 20pt } }",
      "  - { id: seq-2, component: box, label: B, props: { width: 30pt, height: 20pt } }",
    ].join("\n"),
    "{ row: { gap: 0, items: [seq-1, seq-2] } }",
    "seq-1",
  );
  const tokens = source(
    "  - { id: seq, component: tokens, props: { gap: 0, width: 30pt, height: 20pt, cells: [A, B] } }",
    "seq",
    "seq.1",
  );

  test("an attached node written after the tokens is painted over the cells", async () => {
    const order = async (text: string) => {
      const result = await renderFigure(text);
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
      return {
        layout: layoutOf(result.value).nodes.map((n): string => n.key),
        svg: [...result.value.svg.matchAll(/<g class="sumi-k-n--([^ "]+)/g)].map((m) => m[1]),
      };
    };
    const expected = { layout: ["n:seq-1", "n:seq-2", "n:note"], svg: ["seq-1", "seq-2", "note"] };
    expect(await order(handWritten)).toEqual(expected);
    expect(await order(tokens)).toEqual(expected);
  });
});

describe("geometry findings about a cell point at its written fields (#181)", () => {
  const findings = async (props: string) => {
    const text = `version: 1
figure:
  id: overflow
  layout: { arrange: { row: { items: [seq] } } }
nodes:
  - { id: seq, component: tokens, props: ${props} }
`;
    const report = await lintRenderedFigure(text, {});
    return report.diagnostics
      .filter((d) => d.code === "geometry/label-overflow")
      .map((d) => ({
        path: d.path,
        line: d.location?.line,
        column: d.location?.column,
        related: d.related?.map((r) => r.path),
      }));
  };

  test("an inherited size: the tokens' width; a string cell's label: the string", async () => {
    const [finding] = await findings("{ width: 10pt, height: 10pt, cells: [ABCDEFGHIJK] }");
    expect(finding?.path).toEqual(["nodes", 0, "props", "width"]);
    expect(finding?.line).toBe(6);
    expect(finding?.related).toEqual([["nodes", 0, "props", "cells", 0]]);
  });

  test("a size of the cell's own: the cell", async () => {
    const [finding] = await findings(
      "{ cells: [{ label: ABCDEFGHIJK, width: 10pt, height: 10pt }] }",
    );
    expect(finding?.path).toEqual(["nodes", 0, "props", "cells", 0]);
    expect(finding?.related).toEqual([["nodes", 0, "props", "cells", 0, "label"]]);
  });
});
