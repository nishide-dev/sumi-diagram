/**
 * `lintFigure()`: the diagnostic-collecting stages plus structural lint
 * (design doc §0: what `sumi lint` runs). No D2, no rendering.
 */

import { type CheckOptions, checkFigure } from "../core/check";
import type { Diagnostic } from "../core/diagnostics";
import { formatDocPath } from "../core/diagnostics";
import { clampCaptionPaths } from "../core/figure/caption";
import type { FigureCheck } from "../core/figure/check";
import { getTheme } from "../core/theme/builtin";
import { type LintConfig, type ResolvedLintConfig, resolveLintConfig } from "./config";
import { type AnyLintRule, createLintContext, isStructuralRule, toDiagnostic } from "./rule";

/**
 * Exit codes of `sumi lint`:
 * - `0`: no errors (and no more warnings than `maxWarnings`, if set);
 * - `1`: errors, or more warnings than `maxWarnings`;
 * - `2`: usage or internal error (invalid configuration, unreadable file,
 *   crash). `lintFigure()` never returns it; callers map exceptions to it.
 */
export const LINT_EXIT_CODES = Object.freeze({ ok: 0, failed: 1, usage: 2 } as const);
export type LintExitCode = 0 | 1;

export interface LintSummary {
  errors: number;
  warnings: number;
  infos: number;
}

export interface LintReport {
  /** The `file` option, if given. */
  file?: string;
  /** All diagnostics in a deterministic order (see {@link compareDiagnostics}). */
  diagnostics: Diagnostic[];
  summary: LintSummary;
  exitCode: LintExitCode;
}

export interface LintOptions extends CheckOptions {
  /** Rule levels, options and the warning budget. Validated; throws `LintConfigError`. */
  config?: LintConfig;
  /**
   * Rules to configure. Defaults to every built-in rule (`ALL_LINT_RULES`);
   * `lintFigure()` runs the structural ones, the geometry lint the `geometry/*` ones.
   */
  rules?: readonly AnyLintRule[];
}

/**
 * Stage `lint`: runs the enabled rules on a checked figure and returns their
 * diagnostics (it does not modify `check.state`). Rules only see elements that
 * are not `invalid`, so errors from earlier stages cause no lint noise.
 */
export function runLintRules(check: FigureCheck, config: ResolvedLintConfig): Diagnostic[] {
  const { state, locate } = check;
  const themeId = state.doc.figure?.theme;
  const context = createLintContext(state, themeId === undefined ? undefined : getTheme(themeId));
  const diagnostics = config.rules.flatMap(({ rule, severity, options }) =>
    !isStructuralRule(rule)
      ? []
      : rule.run(context, options).map((f) => toDiagnostic(f, rule.id, severity, locate)),
  );
  // A finding about a caption's label points at the `caption` field (#130).
  clampCaptionPaths(state.doc, diagnostics);
  return diagnostics;
}

/**
 * Lints a `*.sumi.yaml` source: every diagnostic-collecting stage
 * (`checkFigure()`) and then the structural lint rules.
 *
 * @throws LintConfigError if `options.config` is invalid.
 */
export function lintFigure(text: string, options: LintOptions = {}): LintReport {
  const { config, rules, ...checkOptions } = options;
  const resolved = resolveLintConfig(config, rules);
  const check = checkFigure(text, checkOptions);
  const diagnostics = [...check.state.diagnostics, ...runLintRules(check, resolved)];
  diagnostics.sort(compareDiagnostics);
  const summary = summarize(diagnostics);
  const failed =
    summary.errors > 0 ||
    (resolved.maxWarnings !== undefined && summary.warnings > resolved.maxWarnings);
  return {
    ...(options.file !== undefined && { file: options.file }),
    diagnostics,
    summary,
    exitCode: failed ? LINT_EXIT_CODES.failed : LINT_EXIT_CODES.ok,
  };
}

export function summarize(diagnostics: readonly Diagnostic[]): LintSummary {
  const summary: LintSummary = { errors: 0, warnings: 0, infos: 0 };
  for (const { severity } of diagnostics) {
    if (severity === "error") summary.errors++;
    else if (severity === "warning") summary.warnings++;
    else summary.infos++;
  }
  return summary;
}

/**
 * Deterministic diagnostic order: by file, then source position (diagnostics
 * without a location first), then code, document path and message.
 */
export function compareDiagnostics(a: Diagnostic, b: Diagnostic): number {
  const la = a.location;
  const lb = b.location;
  return (
    compareStrings(la?.file ?? "", lb?.file ?? "") ||
    (la?.line ?? 0) - (lb?.line ?? 0) ||
    (la?.column ?? 0) - (lb?.column ?? 0) ||
    compareStrings(a.code, b.code) ||
    compareStrings(formatDocPath(a.path ?? []), formatDocPath(b.path ?? [])) ||
    compareStrings(a.message, b.message)
  );
}

/** Code-unit order, independent of the locale. */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
