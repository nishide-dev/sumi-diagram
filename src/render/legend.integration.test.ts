/**
 * Legends (#131) drawn end to end: the stage-B drafts of figures 2 and 4
 * (research/124-stage-b/figures) render with their legends, with no warning,
 * error or geometry finding; every part of a legend lies inside its frame;
 * and each sample line is drawn like the figure's edges with the same fields
 * (dash, arrowheads, line width and color). Structured only: no D2.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { edgeLook } from "../compiler/testing";
import { getFontSet } from "../core/theme/fonts";
import { lintFigure } from "../lint";
import { lintGeometry } from "../lint/geometry";
import { measureLabel } from "../lint/geometry/measure";
import type { Rect } from "./geometry";
import { type RenderedFigure, renderFigure } from "./render";

const ROOT = join(import.meta.dir, "..", "..");
const DRAFTS = join(ROOT, "research", "124-stage-b", "figures");

/** The markup of the element with class `sumi-k-<kind>--<id>` (up to the next element). */
function chunkOf(svg: string, key: string): string {
  const cls = `sumi-k-${key[0]}--${key.slice(2).replace(/^#/, "_")}`;
  const start = svg.indexOf(`<g class="${cls} `);
  if (start < 0) throw new Error(`no markup for ${key}`);
  const next = svg.indexOf('<g class="sumi-k-', start + 1);
  return svg.slice(start, next < 0 ? svg.length : next);
}

const inside = (inner: Rect, outer: Rect) =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width &&
  inner.y + inner.height <= outer.y + outer.height;

async function renderDraft(name: string): Promise<{ source: string; rendered: RenderedFigure }> {
  const draft = parse(readFileSync(join(DRAFTS, `${name}.sumi.yaml`), "utf8"));
  // The version gate: this build may be older than the drafts' >=0.5.0.
  delete draft.requires;
  const source = stringify(draft);
  const result = await renderFigure(source, { assetBase: DRAFTS });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  // Info only: figure 2 has two edge crossings (layout/edge-crossing, #133).
  expect(result.diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
  expect(lintGeometry(result.value, { source })).toEqual([]);
  expect(lintFigure(source).diagnostics).toEqual([]);
  return { source, rendered: result.value };
}

function expectLegend(rendered: RenderedFigure, id: string, texts: string[]): void {
  const { ir } = rendered.compiled;
  const { elements } = rendered.inspection;
  const fonts = getFontSet(ir.meta.fontSetId);
  if (fonts === undefined) throw new Error("no font set");
  const frame = elements.find((e) => e.key === `g:${id}`)?.bbox;
  if (frame === undefined) throw new Error(`no frame of legend ${id}`);
  expect(ir.elements.get(`g:${id}`)).toMatchObject({ component: "sumi/legend" });
  const parts = [...ir.elements.values()].filter((e) => e.legend?.id === id && e.key !== `g:${id}`);
  // The text of each entry, in order, inside the frame.
  const labels = parts.filter((e) => e.kind === "node" && e.component === "sumi/label");
  expect(labels.map((e) => e.label)).toEqual(texts);
  for (const part of parts) {
    if (part.kind === "edge") continue;
    const geometry = elements.find((e) => e.key === part.key);
    const label = geometry?.labels[0];
    // A text node has no bbox: its measured text box is what must fit.
    const box = geometry?.bbox ?? (label && (measureLabel(label, fonts).box as Rect));
    if (box === undefined) throw new Error(`no geometry of ${part.key}`);
    expect({ key: part.key, inside: inside(box, frame) }).toEqual({ key: part.key, inside: true });
  }
  // Each sample line looks like the author's edges with the same fields.
  for (const sample of parts.filter((e) => e.kind === "edge")) {
    if (sample.kind !== "edge") continue;
    const real = ir.edges.filter(
      (e) =>
        e.legend === undefined && e.component === sample.component && e.variant === sample.variant,
    );
    expect(real.length).toBeGreaterThan(0);
    for (const edge of real) {
      expect(edge.style).toEqual(sample.style);
      expect([edge.sourceArrowhead, edge.targetArrowhead]).toEqual([
        sample.sourceArrowhead,
        sample.targetArrowhead,
      ]);
      expect(edgeLook(rendered.svg, chunkOf(rendered.svg, sample.key))).toEqual(
        edgeLook(rendered.svg, chunkOf(rendered.svg, edge.key)),
      );
    }
  }
}

describe("the stage-B drafts render their legends (research/124-stage-b)", () => {
  test("figure 2: dashed = target / parameter update, solid = data flow", async () => {
    const { rendered } = await renderDraft("training-pipeline");
    expectLegend(rendered, "key", ["target / parameter update", "data flow"]);
  });

  test("figure 4: dashed = skip connection", async () => {
    const { rendered } = await renderDraft("unet-small");
    expectLegend(rendered, "key", ["skip connection (copy)"]);
  });
});
