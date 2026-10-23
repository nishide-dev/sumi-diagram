/**
 * The whole render pipeline for one figure (#11): compile → D2 backend →
 * optional outline measurement → D2 → finalize → inspect → compose → inspect.
 */

import { createD2CliBackend } from "../backends/d2/backend";
import type { DiagramBackend, RenderArtifact } from "../backends/types";
import { type CompiledFigure, type CompileOptions, compileFigure } from "../compiler/compile";
import type { Diagnostic } from "../core/diagnostics";
import type { Result } from "../core/result";
import { composeOutlines } from "./compose";
import { type FinalizedSvg, finalizeSvg } from "./finalize";
import { inspectSvg, type SvgInspection } from "./inspect";
import { needsOutlineSizing, outlineMeasurementFigure, sizeOutlineNodes } from "./outline-sizing";

export interface RenderFigureOptions extends CompileOptions {
  /** Backend to render with. Defaults to a new D2 CLI backend. */
  backend?: DiagramBackend;
  /** Name of the generated D2 source in backend diagnostics (see `RenderInput.sourceName`). */
  sourceName?: string;
}

export interface RenderedFigure {
  /** The finalized SVG (see `finalizeSvg`). */
  svg: string;
  metadata: FinalizedSvg["metadata"];
  inspection: SvgInspection;
  compiled: CompiledFigure;
  /** The backend's raw output. */
  artifact: RenderArtifact;
}

/**
 * Renders a `*.sumi.yaml` source to a finalized, inspected SVG. Diagnostics
 * of every stage are returned, warnings included.
 *
 * A figure with no nodes and no groups fails with `svg/empty-figure` before
 * D2 runs: D2 v0.9.0 writes no SVG for it, and Sumi does not invent an empty
 * canvas.
 */
export async function renderFigure(
  text: string,
  options: RenderFigureOptions = {},
): Promise<Result<RenderedFigure>> {
  const { backend = createD2CliBackend(), sourceName, ...compileOptions } = options;
  const compiled = compileFigure(text, compileOptions);
  if (!compiled.ok) return compiled;
  const diagnostics: Diagnostic[] = [...compiled.diagnostics];
  const fail = (): Result<RenderedFigure> => ({ ok: false, diagnostics });

  const { ir } = compiled.value;
  if (ir.elements.size === 0) {
    diagnostics.push({
      code: "svg/empty-figure",
      severity: "error",
      message: `Figure "${ir.meta.id}" has no nodes or groups, so there is nothing to render.`,
      subject: { kind: "figure", id: ir.meta.id },
      hint: "Add at least one node or group.",
    });
    return fail();
  }

  let effective = compiled.value;
  const render = (figure: CompiledFigure) =>
    backend.render({
      d2Source: figure.d2Source,
      layout: figure.layout,
      fontSet: figure.fontSet,
      ...(sourceName !== undefined && { sourceName }),
    });
  if (ir.nodes.some(needsOutlineSizing)) {
    const measurement = outlineMeasurementFigure(effective);
    const first = await render(measurement);
    diagnostics.push(...first.diagnostics);
    if (!first.ok) return fail();
    const firstFinalized = finalizeSvg(first.value, measurement, { source: text });
    diagnostics.push(...firstFinalized.diagnostics);
    if (!firstFinalized.ok) return fail();
    const measured = inspectSvg(firstFinalized.value.svg, measurement.ir);
    diagnostics.push(...measured.diagnostics);
    if (!measured.ok) return fail();
    const sized = sizeOutlineNodes(effective, measured.value);
    diagnostics.push(...sized.diagnostics);
    if (!sized.ok) return fail();
    effective = sized.value;
  }
  const rendered = await render(effective);
  diagnostics.push(...rendered.diagnostics);
  if (!rendered.ok) return fail();
  const artifact = rendered.value;

  const finalized = finalizeSvg(artifact, effective, { source: text });
  diagnostics.push(...finalized.diagnostics);
  if (!finalized.ok) return fail();

  let inspected = inspectSvg(finalized.value.svg, effective.ir);
  diagnostics.push(...inspected.diagnostics);
  if (!inspected.ok) return fail();

  const composed = composeOutlines(finalized.value.svg, effective.ir, inspected.value);
  diagnostics.push(...composed.diagnostics);
  if (!composed.ok) return fail();
  if (effective.ir.nodes.some((n) => n.render !== undefined)) {
    inspected = inspectSvg(composed.value, effective.ir);
    diagnostics.push(...inspected.diagnostics);
    if (!inspected.ok) return fail();
  }

  return {
    ok: true,
    value: {
      svg: composed.value,
      metadata: finalized.value.metadata,
      inspection: inspected.value,
      compiled: effective,
      artifact,
    },
    diagnostics,
  };
}
