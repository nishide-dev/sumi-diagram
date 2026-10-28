/**
 * `figure.fit: scale` (#183) at the unit level: the root size `finalizeSvg()`
 * writes and the scale `inspectSvg()` reads back, at the edges of rounding.
 */

import { describe, expect, test } from "bun:test";
import type { CompiledD2Figure } from "../compiler/compile";
import { finalizeSvg } from "./finalize";
import { inspectSvg, type SvgInspection } from "./inspect";
import { outputSize } from "./size";
import { artifactFor, TINY_PARTS, TINY_SOURCE, tinyCompiled, tinySvg } from "./testing";

const compiled = tinyCompiled();
const fitted: CompiledD2Figure = {
  ...compiled,
  ir: { ...compiled.ir, meta: { ...compiled.ir.meta, fit: "scale" } },
};

function finalize(figure: CompiledD2Figure, viewBox: string): string {
  const svg = tinySvg(Object.values(TINY_PARTS), { viewBox });
  const result = finalizeSvg(artifactFor(figure, svg), figure, { source: TINY_SOURCE });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  return result.value.svg;
}

function inspect(svg: string): SvgInspection {
  const result = inspectSvg(svg, compiled.ir);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  return result.value;
}

describe("figure.fit: scale on paper-single (88mm = 249.448819pt)", () => {
  test("a figure just over the profile width is shrunk, and inspect reads the scale", () => {
    // 498.8978 units = 249.4489pt: 0.00008pt over the limit, a ratio of 1 - 3e-7.
    const svg = finalize(fitted, "0 0 498.8978 100");
    expect(svg).toContain('width="249.448819pt"');
    const inspection = inspect(svg);
    expect(inspection.scale).toBeLessThan(1);
    const size = outputSize(inspection);
    expect(size.fits).toBe(true);
    expect(size.widthPt).toBeCloseTo(249.448819, 6);
    // Without fit, the same figure is too wide.
    const natural = inspect(finalize(compiled, "0 0 498.8978 100"));
    expect(natural.scale).toBeUndefined();
    expect(outputSize(natural).fits).toBe(false);
  });

  test("a figure narrower than the profile keeps its natural size", () => {
    const svg = finalize(fitted, "0 0 200 100");
    expect(svg).toContain('width="100pt" height="50pt"');
    expect(inspect(svg).scale).toBeUndefined();
  });

  test("a natural width rounded to 6 decimals is not read as a scale", () => {
    // 333.3333333 units = 166.66666665pt, written as 166.666667pt.
    const svg = finalize(compiled, "0 0 333.3333333 100");
    expect(svg).toContain('width="166.666667pt"');
    expect(inspect(svg).scale).toBeUndefined();
  });
});
