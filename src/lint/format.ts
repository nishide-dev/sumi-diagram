/** Lint report formatters: versioned JSON for machines, one line per diagnostic for humans. */

import type { Diagnostic, Severity, SourceLocation } from "../core/diagnostics";
import type { LintReport, LintSummary } from "./lint";

/** What the formatters need from a report; render results use the same shape. */
export type DiagnosticReport = Pick<LintReport, "file" | "diagnostics" | "summary">;

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
export function toLintJson(report: DiagnosticReport): LintJson {
  return {
    version: LINT_JSON_VERSION,
    file: report.file ?? null,
    diagnostics: report.diagnostics,
    summary: report.summary,
  };
}

/** Pretty-printed {@link toLintJson} with a trailing newline. */
export function formatLintJson(report: DiagnosticReport): string {
  return `${JSON.stringify(toLintJson(report), null, 2)}\n`;
}

/** Name used for unnamed input in text output. */
const STDIN_NAME = "<input>";

function formatLocation(location: SourceLocation | undefined, file: string): string {
  const name = location?.file ?? file;
  return location === undefined ? name : `${name}:${location.line}:${location.column}`;
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

export interface LintTextOptions {
  /** Color severities with ANSI escapes. Off by default. */
  color?: boolean;
  /** End with the `N errors, N warnings, N infos` line. On by default. */
  summary?: boolean;
}

const SEVERITY_COLORS: Record<Severity, string> = {
  error: "\u001b[31m",
  warning: "\u001b[33m",
  info: "\u001b[36m",
};
const DIM = "\u001b[2m";
const RESET = "\u001b[0m";

/** `N errors, N warnings, N infos`. */
export function formatLintSummary(summary: LintSummary, options: { color?: boolean } = {}): string {
  const { errors, warnings, infos } = summary;
  const text = `${plural(errors, "error")}, ${plural(warnings, "warning")}, ${plural(infos, "info")}`;
  if (!options.color) return text;
  const color = errors > 0 ? SEVERITY_COLORS.error : warnings > 0 ? SEVERITY_COLORS.warning : "";
  return color === "" ? text : `${color}${text}${RESET}`;
}

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
 *
 * Without the summary, a report with no diagnostics is the empty string.
 */
export function formatLintText(report: DiagnosticReport, options: LintTextOptions = {}): string {
  const { color = false, summary = true } = options;
  const file = report.file ?? STDIN_NAME;
  const paint = (code: string, text: string) => (color ? `${code}${text}${RESET}` : text);
  const lines: string[] = [];
  for (const d of report.diagnostics) {
    const severity = paint(SEVERITY_COLORS[d.severity], d.severity);
    lines.push(`${formatLocation(d.location, file)} ${severity} ${d.code} ${d.message}`);
    if (d.hint !== undefined) lines.push(paint(DIM, `  hint: ${d.hint}`));
    for (const r of d.related ?? []) {
      lines.push(paint(DIM, `  related: ${formatLocation(r.location, file)} ${r.message}`));
    }
  }
  if (summary) {
    if (lines.length > 0) lines.push("");
    lines.push(formatLintSummary(report.summary, { color }));
  }
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}
