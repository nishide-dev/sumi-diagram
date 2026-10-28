/**
 * Compact spacing (#182, design doc §6.55): `figure.layout.density: compact`
 * lays a structured figure out with the profile's compact gap, group padding
 * and node padding. The fixtures are the research copies of #167's DiT (B,
 * paper-double, `fit: scale`) and Transformer (A, paper-single); the same
 * YAML without the density line is the normal spacing. Structured only: no D2.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lintGeometry } from "../lint/geometry";
import { type RenderedStructuredFigure, renderFigure } from "./render";
import { outputSize } from "./size";

const ROOT = join(import.meta.dir, "..", "..");
const fixture = (name: string) =>
  readFileSync(join(ROOT, "tests/fixtures/figures/compact", `${name}.sumi.yaml`), "utf8");
const DIT = fixture("b-dit");
const TRANSFORMER = fixture("a-transformer");
const normal = (source: string) => source.replace("    density: compact\n", "");

/** Rendered figures with their render diagnostics. */
const renderDiagnostics = new WeakMap<RenderedStructuredFigure, string[]>();

async function render(source: string): Promise<RenderedStructuredFigure> {
  const result = await renderFigure(source, {
    assetBase: join(ROOT, "tests/fixtures/figures/compact"),
  });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  const rendered = result.value as RenderedStructuredFigure;
  renderDiagnostics.set(
    rendered,
    result.diagnostics.map((d) => `${d.severity} ${d.code}`),
  );
  return rendered;
}

/** Codes and severities of every diagnostic of the render and the geometry rules. */
function diagnosticsOf(rendered: RenderedStructuredFigure, source: string): string[] {
  return [
    ...(renderDiagnostics.get(rendered) ?? []),
    ...lintGeometry(rendered, { source }).map((d) => `${d.severity} ${d.code}`),
  ];
}

const heightOf = (rendered: RenderedStructuredFigure, id: string): number => {
  const rect = rendered.layout.nodes.find((n) => n.key === `n:${id}`)?.rect;
  if (rect === undefined) throw new Error(`no ${id}`);
  return rect.height;
};

describe("DiT (paper, paper-double, fit: scale)", () => {
  test("is shorter for its width than with the normal spacing, all text at 5pt or more", async () => {
    expect(DIT).toContain("    density: compact\n");
    const compact = await render(DIT);
    const spaced = await render(normal(DIT));
    const c = outputSize(compact.inspection);
    const n = outputSize(spaced.inspection);
    // Both are shrunk to the page width; the compact one less.
    expect(c.widthMm).toBe(180);
    expect(n.widthMm).toBe(180);
    expect(c.scale ?? 1).toBeGreaterThan(n.scale ?? 1);
    // Measured (§6.55): 87.66mm (82.8mm at the reference's 170mm; it is 68mm).
    expect(c.heightMm).toBeCloseTo(87.66, 1);
    expect(c.heightMm / c.widthMm).toBeLessThan(n.heightMm / n.widthMm);
    // No text below 5pt after scaling, no warnings: only the scripts' info.
    expect(diagnosticsOf(compact, DIT)).toEqual(["info geometry/script-too-small"]);
  });

  test("a one-line box is 13pt tall (8pt text: 10pt line + 2 × 1.5pt) instead of 17pt", async () => {
    const compact = await render(DIT);
    const spaced = await render(normal(DIT));
    expect(heightOf(compact, "a-ln1")).toBe(26);
    expect(heightOf(spaced, "a-ln1")).toBe(34);
  });
});

describe("Transformer (paper, paper-single)", () => {
  test("keeps its width class and loses about a fifth of its height", async () => {
    const compact = await render(TRANSFORMER);
    const spaced = await render(normal(TRANSFORMER));
    const c = outputSize(compact.inspection);
    const n = outputSize(spaced.inspection);
    expect(c.scale).toBeUndefined();
    // Measured (§6.55): 76.02 × 114.83mm; the original is 77.2 × 113.7mm.
    expect(c.widthMm).toBeCloseTo(76.02, 1);
    expect(c.heightMm).toBeCloseTo(114.83, 1);
    expect(c.heightMm).toBeLessThan(n.heightMm * 0.85);
    expect(diagnosticsOf(compact, TRANSFORMER)).toEqual([]);
  });
});
