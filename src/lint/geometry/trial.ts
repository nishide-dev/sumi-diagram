/**
 * Trial layouts that lint rules use to check a suggested edit by doing it
 * (`geometry/relocatable-node`, #621; the width hints, #607): lay out and
 * route a copy of the figure the way render does, draw it, and lint it like
 * the figure itself. Callers run these inside `asHintTrial`, so no rule or
 * router starts trials of its own.
 */
import type { FigureIR } from "../../compiler/ir";
import type { Diagnostic } from "../../core/diagnostics";
import { getFontSet } from "../../core/theme/fonts";
import type { LayoutIR } from "../../layout/ir";
import { routeStructured } from "../../layout/route/face-routes";
import { setOverlapDiagnostics } from "../../layout/set-overlap";
import { placeStructured, type StructuredLayoutOptions } from "../../layout/structured/engine";
import { inspectSvg } from "../../render/inspect";
import { writeStructuredSvg } from "../../render/structured";
import { resolveLintConfig } from "../config";
import { isGeometryRule } from "../rule";
import { createGeometryContext, type GeometryContext } from "./context";

/** A layout and route of a figure, as render does it. */
export interface Trial {
  readonly ir: FigureIR;
  readonly layout: LayoutIR;
  /** The trial before routing, as `GeometryContext.placed`. */
  readonly placed: { readonly ir: FigureIR; readonly layout: LayoutIR };
  readonly diagnostics: readonly Diagnostic[];
}

/** Lays out and routes `ir`; `undefined` if the counterfactual is invalid (it is never a recommendation then). */
export function layoutTrial(
  ir: FigureIR,
  options: StructuredLayoutOptions | undefined,
): Trial | undefined {
  try {
    const laid = placeStructured(ir, options);
    const { ir: faced, routed } = routeStructured(ir, laid.layout, { hintTrials: false });
    return {
      ir: faced,
      layout: routed.layout,
      placed: { ir, layout: laid.layout },
      diagnostics: [
        ...laid.diagnostics,
        ...setOverlapDiagnostics(faced, laid.layout),
        ...routed.diagnostics,
      ],
    };
  } catch {
    return undefined;
  }
}

/** Errors and warnings of a lint run: by code and subject, counted. */
export type Problems = Map<string, number>;

/**
 * Lints a trial the way the figure itself is linted: its layout's
 * diagnostics, then the geometry rules (all but those in `skip`) under the
 * same configuration and levels, on the trial's SVG with its placement and
 * routes (so rules that check a hint by routing again, such as
 * `geometry/avoidable-bend`, do so here too). Runs inside the hint-trial
 * guard, so no rule starts layouts of its own.
 */
export function problemsOf(
  context: GeometryContext,
  trial: Trial,
  assets: Parameters<typeof writeStructuredSvg>[3],
  skip: ReadonlySet<string>,
  /** The figure's YAML, for rules that name where to edit (`geometry/relocatable-node`); the trial must keep its arrange items. */
  source?: string,
): Problems | undefined {
  const fonts = getFontSet(trial.ir.meta.fontSetId);
  if (fonts === undefined) return undefined;
  const inspected = inspectSvg(writeStructuredSvg(trial.ir, trial.layout, fonts, assets), trial.ir);
  if (!inspected.ok) return undefined;
  const config = context.lintConfig ?? resolveLintConfig();
  const linted: GeometryContext = {
    ...createGeometryContext(trial.ir, inspected.value, fonts),
    layout: trial.layout,
    placed: trial.placed,
    lintConfig: config,
    ...(source !== undefined && { source }),
  };
  const counts: Problems = new Map();
  const add = (code: string, subject: unknown) => {
    const key = `${code} ${JSON.stringify(subject ?? null)}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };
  for (const d of trial.diagnostics)
    if (d.severity === "error" || d.severity === "warning") add(d.code, d.subject);
  for (const { rule, severity, options, explicitSeverity } of config.rules) {
    if (!isGeometryRule(rule) || skip.has(rule.id)) continue;
    for (const f of rule.run(linted, options)) {
      const level = explicitSeverity ? severity : (f.severity ?? severity);
      if (level === "error" || level === "warning") add(rule.id, f.subject);
    }
  }
  return counts;
}

/** The problems `after` has more of than `before`, as `code subject` keys. */
export function newProblems(before: Problems, after: Problems): string[] {
  return [...after].filter(([key, n]) => n > (before.get(key) ?? 0)).map(([key]) => key);
}
