/** Lint report formatters: versioned JSON for machines, one line per diagnostic for humans. */

import type { Diagnostic, SourceLocation } from "../core/diagnostics";
import type { LintReport, LintSummary } from "./lint";

/** Version of the JSON envelope; bumped on incompatible changes. */
export const LINT_JSON_VERSION = 1;

export interface LintJson {
  version: typeof LINT_JSON_VERSION;
  /** The linted file, or `null` for unnamed input. */
  file: string | null;
  diagnostics: Diagnostic[];
  summary: LintSummary;
}

/** The JSON envelope `{ version: 1, file, diagnostics, summary }`. */
export function toLintJson(report: LintReport): LintJson {
  return {
    version: LINT_JSON_VERSION,
    file: report.file ?? null,
    diagnostics: report.diagnostics,
    summary: report.summary,
  };
}

/** Pretty-printed {@link toLintJson} with a trailing newline. */
export function formatLintJson(report: LintReport): string {
  return `${JSON.stringify(toLintJson(report), null, 2)}\n`;
}

/** Name used for unnamed input in text output. */
const STDIN_NAME = "<input>";

function formatLocation(location: SourceLocation | undefined, file: string): string {
  const name = location?.file ?? file;
  return location === undefined ? name : `${name}:${location.line}:${location.column}`;
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/**
 * Human-readable report, one diagnostic per line followed by indented details:
 *
 * ```text
 * figure.sumi.yaml:12:5 warning lint/ancestor-edge Edge edges[0] connects …
 *   hint: The edge is drawn across …
 *   related: figure.sumi.yaml:4:5 Group "backend" is defined here.
 *
 * 0 errors, 1 warning, 0 infos
 * ```
 */
export function formatLintText(report: LintReport): string {
  const file = report.file ?? STDIN_NAME;
  const lines: string[] = [];
  for (const d of report.diagnostics) {
    lines.push(`${formatLocation(d.location, file)} ${d.severity} ${d.code} ${d.message}`);
    if (d.hint !== undefined) lines.push(`  hint: ${d.hint}`);
    for (const r of d.related ?? []) {
      lines.push(`  related: ${formatLocation(r.location, file)} ${r.message}`);
    }
  }
  const { errors, warnings, infos } = report.summary;
  if (lines.length > 0) lines.push("");
  lines.push(
    `${plural(errors, "error")}, ${plural(warnings, "warning")}, ${plural(infos, "info")}`,
  );
  return `${lines.join("\n")}\n`;
}
