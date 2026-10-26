/**
 * Layout engines and the Layout IR (design doc §6.21), and the orthogonal
 * edge router (§6.22). The structured pipeline is exposed and tested here;
 * `compileFigure()` still stops structured figures with
 * `layout/engine-unavailable` until the SVG writer (#91) lands.
 */

import { buildFigureIR, type FigureIR } from "../compiler/ir";
import { type CheckOptions, checkFigure } from "../core/check";
import { hasErrors } from "../core/diagnostics";
import type { Result } from "../core/result";
import type { LayoutIR } from "./ir";
import { routeEdges } from "./route/router";
import { layoutStructured, type StructuredLayoutOptions } from "./structured/engine";

export * from "./ir";
export * from "./route";
export * from "./structured/engine";
export * from "./text";

export type LayoutFigureOptions = CheckOptions &
  StructuredLayoutOptions & {
    /** Route the edges (#90); default `true`. `false` returns the engine's layout alone. */
    route?: boolean;
  };

/**
 * Checks a structured `*.sumi.yaml` source, lays it out and routes its
 * edges: every checking stage, then the Figure IR, {@link layoutStructured}
 * and {@link routeEdges}. Fails with the diagnostics if the check reports an
 * error, or if an edge has no route (`layout/no-route`). Throws for an
 * `auto` figure.
 */
export function layoutStructuredFigure(
  text: string,
  options: LayoutFigureOptions = {},
): Result<{ ir: FigureIR; layout: LayoutIR }> {
  const { profile, measurer, route = true, ...checkOptions } = options;
  const check = checkFigure(text, checkOptions);
  const diagnostics = [...check.state.diagnostics];
  if (hasErrors(diagnostics)) return { ok: false, diagnostics };
  const ir = buildFigureIR(check);
  const placed = layoutStructured(ir, {
    ...(profile !== undefined && { profile }),
    ...(measurer !== undefined && { measurer }),
  });
  if (!route) return { ok: true, value: { ir, layout: placed }, diagnostics };
  const routed = routeEdges(ir, placed);
  diagnostics.push(...routed.diagnostics);
  if (hasErrors(diagnostics)) return { ok: false, diagnostics };
  return { ok: true, value: { ir, layout: routed.layout }, diagnostics };
}
