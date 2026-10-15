/**
 * The whole render pipeline for one figure (#11): compile → D2 backend →
 * finalize → inspect.
 */

import { createD2CliBackend } from "../backends/d2/backend";
import type { DiagramBackend, RenderArtifact } from "../backends/types";
import { type CompiledFigure, type CompileOptions, compileFigure } from "../compiler/compile";
import type { Diagnostic } from "../core/diagnostics";
import type { Result } from "../core/result";
import { type FinalizedSvg, finalizeSvg } from "./finalize";
import { inspectSvg, type SvgInspection } from "./inspect";

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

  const rendered = await backend.render({
    d2Source: compiled.value.d2Source,
    layout: compiled.value.layout,
    fontSet: compiled.value.fontSet,
    ...(sourceName !== undefined && { sourceName }),
  });
  diagnostics.push(...rendered.diagnostics);
  if (!rendered.ok) return fail();
  const artifact = rendered.value;

  const finalized = finalizeSvg(artifact, compiled.value, { source: text });
  diagnostics.push(...finalized.diagnostics);
  if (!finalized.ok) return fail();

  const inspected = inspectSvg(finalized.value.svg, ir);
  diagnostics.push(...inspected.diagnostics);
  if (!inspected.ok) return fail();

  return {
    ok: true,
    value: {
      svg: finalized.value.svg,
      metadata: finalized.value.metadata,
      inspection: inspected.value,
      compiled: compiled.value,
      artifact,
    },
    diagnostics,
  };
}
