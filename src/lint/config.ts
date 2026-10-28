/**
 * Lint configuration: per-rule level (off or a severity) and options, and the
 * warning budget. The shape is plain JSON so the CLI (#14) can build it from
 * flags or a file. One configuration covers both stages: structural rules
 * (`lint/*`) and geometry rules on the rendered SVG (`geometry/*`, #13).
 *
 * ```ts
 * { rules: { "lint/no-edges": "off", "lint/long-label": { level: "error", options: { maxLineWidth: 30 } } }, maxWarnings: 0 }
 * ```
 */

import { z } from "zod";
import { didYouMean, type Severity } from "../core/diagnostics";
import { reservedKeyMessage, reservedKeyPaths } from "../core/reserved-keys";
import { BUILTIN_GEOMETRY_RULES } from "./geometry/rules";
import type { AnyLintRule } from "./rule";
import { BUILTIN_LINT_RULES } from "./rules";

/** Every built-in rule of both stages: structural (`lint/*`), then geometry (`geometry/*`). */
export const ALL_LINT_RULES: readonly AnyLintRule[] = Object.freeze([
  ...BUILTIN_LINT_RULES,
  ...BUILTIN_GEOMETRY_RULES,
]);

export const RULE_LEVELS = ["off", "error", "warning", "info"] as const;
export type RuleLevel = (typeof RULE_LEVELS)[number];

const RuleLevelSchema = z.enum(RULE_LEVELS);

export const RuleSettingSchema = z.union([
  RuleLevelSchema,
  z.strictObject({
    level: RuleLevelSchema.optional(),
    options: z.record(z.string(), z.unknown()).optional(),
  }),
]);
export type RuleSetting = z.input<typeof RuleSettingSchema>;

export const LintConfigSchema = z.strictObject({
  /** Rule ID (`lint/<rule>` or `geometry/<rule>`) → level, or `{ level?, options? }`. Omitted rules keep their defaults. */
  rules: z.record(z.string(), RuleSettingSchema).optional(),
  /** Fail (exit code 1) when there are more warnings than this. Unlimited when omitted. */
  maxWarnings: z.int().nonnegative().optional(),
});
export type LintConfig = z.input<typeof LintConfigSchema>;

/** An invalid lint configuration: a usage error, not a diagnostic of the figure. */
export class LintConfigError extends Error {
  override name = "LintConfigError";
  constructor(readonly problems: string[]) {
    super(`Invalid lint configuration: ${problems.join(" ")}`);
  }
}

/** An enabled rule with its effective severity and validated options. */
export interface ActiveRule {
  rule: AnyLintRule;
  severity: Severity;
  options: unknown;
}

export interface ResolvedLintConfig {
  /** Enabled rules, in registry order. */
  rules: ActiveRule[];
  maxWarnings?: number;
}

/**
 * Validates a configuration against the available rules and resolves every
 * rule's severity and options. Throws {@link LintConfigError} listing every
 * problem: unknown keys or rule IDs, invalid levels, invalid options, or
 * options for a rule that takes none.
 */
export function resolveLintConfig(
  config: unknown = {},
  rules: readonly AnyLintRule[] = ALL_LINT_RULES,
): ResolvedLintConfig {
  // A `__proto__` key would be dropped without a word (#180).
  const reserved = reservedKeyPaths(config);
  if (reserved.length > 0) {
    throw new LintConfigError(reserved.map(reservedKeyMessage));
  }
  const parsed = LintConfigSchema.safeParse(config);
  if (!parsed.success) {
    throw new LintConfigError(
      parsed.error.issues.map((issue) => `${formatPath(issue.path)}: ${issue.message}.`),
    );
  }
  const settings = parsed.data.rules ?? {};
  const problems: string[] = [];
  const known = new Set(rules.map((r) => r.id));
  for (const id of Object.keys(settings)) {
    if (known.has(id as AnyLintRule["id"])) continue;
    const hint = didYouMean(id, known);
    problems.push(`Unknown lint rule "${id}".${hint === undefined ? "" : ` ${hint}`}`);
  }

  const active: ActiveRule[] = [];
  for (const rule of rules) {
    const setting = settings[rule.id];
    const { level = rule.defaultSeverity, options: rawOptions = undefined } =
      typeof setting === "object" ? setting : { level: setting };
    if (rawOptions !== undefined && rule.options === undefined) {
      problems.push(`Rule ${rule.id} takes no options.`);
      continue;
    }
    let options: unknown;
    if (rule.options !== undefined) {
      const result = rule.options.safeParse(rawOptions ?? {});
      if (!result.success) {
        for (const issue of result.error.issues) {
          problems.push(`${rule.id} ${formatPath(["options", ...issue.path])}: ${issue.message}.`);
        }
        continue;
      }
      options = result.data;
    }
    if (level !== "off") active.push({ rule, severity: level, options });
  }
  if (problems.length > 0) throw new LintConfigError(problems);
  const { maxWarnings } = parsed.data;
  return { rules: active, ...(maxWarnings !== undefined && { maxWarnings }) };
}

function formatPath(path: readonly PropertyKey[]): string {
  return path.length === 0 ? "(config)" : path.map(String).join(".");
}
