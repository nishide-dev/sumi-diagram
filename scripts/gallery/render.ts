/**
 * Renders the gallery's figures with the shared pipeline (`renderFigure()`
 * plus the geometry lint, as `sumi render` does) and keeps what the pages
 * show: the SVG, its size against the profile's limits and the diagnostics.
 */

import { availableParallelism } from "node:os";
import type { Diagnostic } from "../../src/core/diagnostics";
import { compareDiagnostics, lintGeometry } from "../../src/lint";
import { renderFigure } from "../../src/render";
import type { Rendering } from "./samples";

export interface RenderOutcome {
  rendering: Rendering;
  /** The finalized SVG; absent when rendering failed (see `diagnostics`). */
  svg?: string;
  /** Theme and profile the figure was rendered with (after overrides). */
  theme: string;
  profile: string;
  widthPt?: number;
  heightPt?: number;
  maxWidthPt?: number;
  maxHeightPt?: number;
  /** Diagnostics of every stage, geometry lint included, sorted. */
  diagnostics: Diagnostic[];
}

export interface RenderJob {
  /** Path shown in diagnostics. */
  file: string;
  source: string;
  rendering: Rendering;
}

export async function renderOne(job: RenderJob): Promise<RenderOutcome> {
  const { file, source, rendering } = job;
  const result = await renderFigure(source, { file, overrides: rendering.overrides });
  if (!result.ok) {
    return {
      rendering,
      theme: rendering.overrides.theme ?? rendering.theme,
      profile: rendering.overrides.profile ?? rendering.profile,
      diagnostics: [...result.diagnostics].sort(compareDiagnostics),
    };
  }
  const { inspection, metadata } = result.value;
  const diagnostics = [...result.diagnostics, ...lintGeometry(result.value, { source, file })];
  return {
    rendering,
    svg: result.value.svg,
    theme: metadata.theme,
    profile: metadata.profile,
    widthPt: inspection.canvas.width.pt,
    heightPt: inspection.canvas.height.pt,
    ...(inspection.profile.maxWidthPt !== undefined && {
      maxWidthPt: inspection.profile.maxWidthPt,
    }),
    ...(inspection.profile.maxHeightPt !== undefined && {
      maxHeightPt: inspection.profile.maxHeightPt,
    }),
    diagnostics: diagnostics.sort(compareDiagnostics),
  };
}

/** Renders every job, a few D2 processes at a time; results in job order. */
export async function renderAll(jobs: readonly RenderJob[]): Promise<RenderOutcome[]> {
  const results: RenderOutcome[] = new Array(jobs.length);
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const index = next++;
      const job = jobs[index];
      if (job !== undefined) results[index] = await renderOne(job);
    }
  };
  const workers = Math.max(1, Math.min(8, availableParallelism()));
  await Promise.all(Array.from({ length: workers }, worker));
  return results;
}
