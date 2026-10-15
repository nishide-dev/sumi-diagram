/**
 * Lint rule framework (stage `lint`, design doc §0): structural checks that
 * run on the {@link CheckState} after the diagnostic-collecting stages, before
 * any rendering. Geometry checks on the rendered SVG are a separate stage
 * (`geometry`, #13).
 */

import type { z } from "zod";
import {
  type CheckState,
  type ElementEntry,
  type ElementKey,
  figureElements,
} from "../core/check-state";
import type { Diagnostic, DocPath, Severity } from "../core/diagnostics";
import type { Locator } from "../core/figure/yaml";
import type { ResolvedComponent } from "../core/registry/manifest";
import type { Theme } from "../core/theme/schema";
import type { ResolvedStyle } from "../core/theme/style";

/** Lint diagnostic codes: `lint/<rule>`. */
export type LintCode = `lint/${string}`;

/**
 * A problem found by a rule. The framework adds the rule's code and configured
 * severity, and source locations for `path` and every related `path`.
 */
export interface LintFinding {
  message: string;
  path: DocPath;
  subject?: Diagnostic["subject"];
  hint?: string;
  related?: { path: DocPath; message: string }[];
}

/** A readable element that no stage reported an error for (directly or through a dependency). */
export type ValidElement = ElementEntry & {
  /** Present when the `component` stage resolved the element. */
  component?: ResolvedComponent;
  /** Present when the `theme` stage styled the element. */
  style?: ResolvedStyle;
};

/** What rules see: the checked figure, restricted to valid elements. */
export interface LintContext {
  readonly state: CheckState;
  /** The figure's theme, if it resolved. */
  readonly theme: Theme | undefined;
  /** Valid elements: groups, then nodes, then edges, each in document order. */
  readonly elements: readonly ValidElement[];
  isValid(key: ElementKey): boolean;
}

export interface LintRule<Options = unknown> {
  /** The diagnostic code, e.g. `lint/empty-figure`. */
  readonly id: LintCode;
  /** One English sentence: what the rule reports. */
  readonly description: string;
  readonly defaultSeverity: Severity;
  /** No rule has an automatic fix yet. */
  readonly fixable: false;
  /** Options with their defaults; rules without options omit it. */
  readonly options?: z.ZodType<Options>;
  run(context: LintContext, options: Options): LintFinding[];
}

/** Defines a rule; infers its option type from the `options` schema. */
export function defineRule<Options = undefined>(rule: LintRule<Options>): LintRule<Options> {
  return Object.freeze(rule);
}

/** Builds the context rules run on. Invalid elements are left out entirely. */
export function createLintContext(state: CheckState, theme: Theme | undefined): LintContext {
  const elements: ValidElement[] = [];
  for (const entry of figureElements(state.doc)) {
    if (state.invalid.has(entry.key)) continue;
    const component = state.components?.get(entry.key);
    const style = state.styles?.get(entry.key);
    elements.push({
      ...entry,
      ...(component !== undefined && { component }),
      ...(style !== undefined && { style }),
    });
  }
  return {
    state,
    theme,
    elements,
    isValid: (key) => !state.invalid.has(key),
  };
}

/** Turns a finding into a diagnostic with the rule's code, the given severity and locations. */
export function toDiagnostic(
  finding: LintFinding,
  code: LintCode,
  severity: Severity,
  locate: Locator,
): Diagnostic {
  const location = locate(finding.path);
  const related = finding.related?.map((r) => {
    const at = locate(r.path);
    return { path: r.path, ...(at !== undefined && { location: at }), message: r.message };
  });
  return {
    code,
    severity,
    message: finding.message,
    path: finding.path,
    ...(location !== undefined && { location }),
    ...(finding.subject !== undefined && { subject: finding.subject }),
    ...(finding.hint !== undefined && { hint: finding.hint }),
    ...(related !== undefined && related.length > 0 && { related }),
  };
}
