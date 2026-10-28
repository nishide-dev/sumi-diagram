/**
 * Lint rule framework (stage `lint`, design doc §0): structural checks that
 * run on the {@link CheckState} after the diagnostic-collecting stages, before
 * any rendering, and geometry checks (stage `geometry`, #13) that run on the
 * inspected SVG of a rendered figure. Both kinds of rules share findings,
 * configuration (`LintConfig`) and diagnostics.
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
import type { GeometryContext } from "./geometry/context";

/** Codes of structural lint rules: `lint/<rule>`. */
export type StructuralLintCode = `lint/${string}`;
/** Codes of geometry lint rules on the rendered SVG: `geometry/<rule>` (#13). */
export type GeometryLintCode = `geometry/${string}`;
/** Codes of all configurable lint rules. */
export type LintCode = StructuralLintCode | GeometryLintCode;

/**
 * A problem found by a rule. The framework adds the rule's code and configured
 * severity, and source locations for `path` and every related `path`.
 */
export interface LintFinding {
  message: string;
  path: DocPath;
  /**
   * UTF-16 offsets into the string value at `path`: the location then points
   * at those characters where the source maps to the value one to one.
   */
  span?: readonly [number, number];
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

/** What every rule has, whatever stage it runs in. */
interface RuleBase<Code extends LintCode, Context, Options> {
  /** The diagnostic code, e.g. `lint/empty-figure`. */
  readonly id: Code;
  /** One English sentence: what the rule reports. */
  readonly description: string;
  readonly defaultSeverity: Severity;
  /** No rule has an automatic fix yet. */
  readonly fixable: false;
  /** Options with their defaults; rules without options omit it. */
  readonly options?: z.ZodType<Options>;
  run(context: Context, options: Options): LintFinding[];
}

/** A structural rule (stage `lint`): runs on the checked document, before rendering. */
export interface LintRule<Options = unknown>
  extends RuleBase<StructuralLintCode, LintContext, Options> {}

/** A geometry rule (stage `geometry`, #13): runs on the inspected, rendered SVG. */
export interface GeometryRule<Options = unknown>
  extends RuleBase<GeometryLintCode, GeometryContext, Options> {}

/** Any configurable rule. One `LintConfig` configures both stages. */
export type AnyLintRule = LintRule | GeometryRule;

export const isStructuralRule = (rule: AnyLintRule): rule is LintRule =>
  rule.id.startsWith("lint/");
export const isGeometryRule = (rule: AnyLintRule): rule is GeometryRule =>
  rule.id.startsWith("geometry/");

/** Defines a rule; infers its option type from the `options` schema. */
export function defineRule<Options = undefined>(rule: LintRule<Options>): LintRule<Options> {
  return Object.freeze(rule);
}

/** Defines a geometry rule; infers its option type from the `options` schema. */
export function defineGeometryRule<Options = undefined>(
  rule: GeometryRule<Options>,
): GeometryRule<Options> {
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
  const location = locate(
    finding.path,
    finding.span === undefined ? undefined : { span: finding.span },
  );
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
