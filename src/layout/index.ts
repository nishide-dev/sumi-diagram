/**
 * Layout engines and the Layout IR (design doc §6.21). The structured engine
 * is exposed and tested here; `compileFigure()` still stops structured
 * figures with `layout/engine-unavailable` until the SVG writer (#91) lands.
 */

import { buildFigureIR, type FigureIR } from "../compiler/ir";
import { type CheckOptions, checkFigure } from "../core/check";
import { hasErrors } from "../core/diagnostics";
import type { Result } from "../core/result";
import type { LayoutIR } from "./ir";
import { layoutStructured, type StructuredLayoutOptions } from "./structured/engine";

export * from "./ir";
export * from "./structured/engine";
export * from "./text";

export type LayoutFigureOptions = CheckOptions & StructuredLayoutOptions;

/**
 * Checks a structured `*.sumi.yaml` source and lays it out: every checking
 * stage, then the Figure IR, then {@link layoutStructured}. Fails with the
 * diagnostics if the check reports an error. Throws for an `auto` figure.
 */
export function layoutStructuredFigure(
  text: string,
  options: LayoutFigureOptions = {},
): Result<{ ir: FigureIR; layout: LayoutIR }> {
  const { profile, measurer, ...checkOptions } = options;
  const check = checkFigure(text, checkOptions);
  const { diagnostics } = check.state;
  if (hasErrors(diagnostics)) return { ok: false, diagnostics };
  const ir = buildFigureIR(check);
  const layout = layoutStructured(ir, {
    ...(profile !== undefined && { profile }),
    ...(measurer !== undefined && { measurer }),
  });
  return { ok: true, value: { ir, layout }, diagnostics };
}
