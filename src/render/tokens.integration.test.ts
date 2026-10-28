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
import type { RenderedFigure } from "./render";

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

/** The Layout IR with node keys renamed by `rename`, nodes in key order. */
function normalized(layout: LayoutIR, rename: (id: string) => string): unknown {
  const key = (k: ElementKey): ElementKey => (k.startsWith("n:") ? `n:${rename(k.slice(2))}` : k);
  return {
    ...layout,
    nodes: layout.nodes
      .map((n) => ({ ...n, key: key(n.key) }))
      .sort((a, b) => a.key.localeCompare(b.key)),
    edges: layout.edges.map((e) => ({ ...e, from: key(e.from), to: key(e.to) })),
  };
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
    },
    {
      name: "ViT input (position and patch token pairs)",
      original: "research/151-dogfood-v0.5/figures/vit-input.sumi.yaml",
      rewritten: "research/181-tokens/figures/vit-input.sumi.yaml",
      rename: vit,
      emptyLabels: 0,
    },
  ];
  for (const c of cases) {
    test(c.name, async () => {
      const original = await render(c.original);
      const rewritten = await render(c.rewritten);
      expect(normalized(layoutOf(rewritten.rendered), c.rename)).toEqual(
        normalized(layoutOf(original.rendered), (id) => id),
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
      // Each element is drawn the same (the cells after the written nodes).
      const before = drawing(original.rendered.svg, (id) => id);
      const after = drawing(rewritten.rendered.svg, c.rename);
      expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
      for (const [key, chunk] of after)
        expect({ key, chunk }).toEqual({ key, chunk: before.get(key) ?? "" });
    });
  }
});
