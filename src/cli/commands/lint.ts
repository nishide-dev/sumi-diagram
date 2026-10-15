/**
 * `sumi lint <files...>`: the diagnostic-collecting stages plus structural
 * lint (`lintFigure()`), for one or more files. No D2 — unless `--geometry`:
 * then each figure without errors is also rendered with D2 and checked by the
 * geometry rules (`lintRenderedFigure()`, #13). Nothing is written.
 *
 * - stdout: the report (text, or JSON with `--json`).
 * - exit: 0 no errors and warnings within `--max-warnings` (counted over all
 *   files); 1 errors or too many warnings; 2 usage errors (unreadable file,
 *   invalid configuration) — the other files are still linted.
 */

import { InvalidArgumentError } from "commander";
import { createD2CliBackend } from "../../backends/d2/backend";
import {
  formatLintSummary,
  formatLintText,
  LINT_JSON_VERSION,
  type LintConfig,
  LintConfigError,
  type LintJson,
  type LintSummary,
  lintFigure,
  lintRenderedFigure,
  RULE_LEVELS,
  type RuleLevel,
  type RuleSetting,
  resolveLintConfig,
  toLintJson,
} from "../../lint";
import { type CliContext, EXIT, type ExitCode, readTextFile, UsageError } from "../io";

export interface LintCommandOptions {
  json?: boolean;
  /** Path of a JSON lint configuration (`{ rules?, maxWarnings? }`). */
  config?: string;
  maxWarnings?: number;
  /** `--rule <id>=<level>`, repeatable. */
  rule?: string[];
  /** Also render with D2 and run the `geometry/*` rules (#13). */
  geometry?: boolean;
  color: boolean;
}

/** The `--json` output: one per-file envelope (docs/lint-rules.md) per readable file. */
export interface LintRunJson {
  version: typeof LINT_JSON_VERSION;
  results: LintJson[];
  summary: LintSummary;
}

export async function lintCommand(
  files: readonly string[],
  options: LintCommandOptions,
  context: CliContext,
): Promise<ExitCode> {
  const config = await buildLintConfig(options, context);
  const { maxWarnings, ...perFile } = config;

  const results: LintJson[] = [];
  const total: LintSummary = { errors: 0, warnings: 0, infos: 0 };
  let unreadable = false;
  for (const file of files) {
    let text: string;
    try {
      text = await readTextFile(context, file);
    } catch (error) {
      if (!(error instanceof UsageError)) throw error;
      context.stderr.write(`sumi: error: ${error.message}\n`);
      unreadable = true;
      continue;
    }
    const report = options.geometry
      ? await lintRenderedFigure(text, {
          file,
          config: perFile,
          backend: createD2CliBackend({ projectRoot: context.cwd, env: context.env }),
        })
      : lintFigure(text, { file, config: perFile });
    total.errors += report.summary.errors;
    total.warnings += report.summary.warnings;
    total.infos += report.summary.infos;
    if (options.json) results.push(toLintJson(report));
    else context.stdout.write(formatLintText(report, { color: options.color, summary: false }));
  }

  const tooManyWarnings = maxWarnings !== undefined && total.warnings > maxWarnings;
  if (options.json) {
    const json: LintRunJson = { version: LINT_JSON_VERSION, results, summary: total };
    context.stdout.write(`${JSON.stringify(json, null, 2)}\n`);
  } else {
    const anyDiagnostics = total.errors + total.warnings + total.infos > 0;
    context.stdout.write(
      `${anyDiagnostics ? "\n" : ""}${formatLintSummary(total, { color: options.color })}\n`,
    );
    if (tooManyWarnings) {
      context.stdout.write(`Too many warnings (${total.warnings}; maximum ${maxWarnings}).\n`);
    }
  }
  if (unreadable) return EXIT.usage;
  return total.errors > 0 || tooManyWarnings ? EXIT.failed : EXIT.ok;
}

/**
 * Builds the configuration from `--config`, then `--rule` (a rule's level is
 * replaced, its options kept) and `--max-warnings` (replaces the file's). The
 * result is validated; problems are usage errors.
 */
async function buildLintConfig(
  options: LintCommandOptions,
  context: CliContext,
): Promise<LintConfig> {
  let base: unknown = {};
  if (options.config !== undefined) {
    const text = await readTextFile(context, options.config);
    try {
      base = JSON.parse(text);
    } catch (error) {
      throw new UsageError(
        `Invalid lint configuration ${options.config}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (base === null || typeof base !== "object" || Array.isArray(base)) {
      throw new UsageError(`Invalid lint configuration ${options.config}: expected a JSON object.`);
    }
  }
  const config = { ...(base as Record<string, unknown>) };

  if (options.rule !== undefined && options.rule.length > 0) {
    const rules: Record<string, RuleSetting> = {
      ...((config.rules as Record<string, RuleSetting> | undefined) ?? {}),
    };
    for (const entry of options.rule) {
      const [id, level] = parseRuleFlag(entry);
      const current = rules[id];
      rules[id] = typeof current === "object" ? { ...current, level } : level;
    }
    config.rules = rules;
  }
  if (options.maxWarnings !== undefined) config.maxWarnings = options.maxWarnings;

  try {
    resolveLintConfig(config);
  } catch (error) {
    if (error instanceof LintConfigError) {
      const source = options.config === undefined ? "" : ` (${options.config} and flags)`;
      throw new UsageError(
        `Invalid lint configuration${source}:\n${error.problems.map((p) => `  ${p}`).join("\n")}`,
      );
    }
    throw error;
  }
  return config as LintConfig;
}

function parseRuleFlag(entry: string): [string, RuleLevel] {
  const match = /^([^=\s]+)=([a-z]+)$/.exec(entry);
  const level = match?.[2];
  if (match?.[1] === undefined || !RULE_LEVELS.includes(level as RuleLevel)) {
    throw new UsageError(
      `Invalid --rule "${entry}": expected <id>=<level> with level one of ${RULE_LEVELS.join(", ")} (e.g. lint/no-edges=off).`,
    );
  }
  return [match[1], level as RuleLevel];
}

/** Parses `--max-warnings`: a non-negative integer. */
export function parseMaxWarnings(value: string): number {
  if (!/^\d+$/.test(value)) throw new InvalidArgumentError("Expected a non-negative integer.");
  return Number(value);
}
