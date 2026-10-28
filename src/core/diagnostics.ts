/**
 * Shared diagnostic types used by every pipeline stage (design doc §1).
 *
 * Diagnostics are plain JSON-serializable objects; `sumi lint --json` prints
 * them as-is. The `code` (`"<stage>/<rule>"`) is a stable public identifier:
 * renaming one is a breaking change.
 */

export type Severity = "error" | "warning" | "info";

/** Path into the input document, e.g. `["nodes", 2, "props", "width"]`. */
export type DocPath = (string | number)[];

export interface SourceLocation {
  file?: string;
  /** 1-based line. */
  line: number;
  /** 1-based column. */
  column: number;
  endLine?: number;
  endColumn?: number;
}

export interface DiagnosticSubject {
  kind: "node" | "group" | "edge" | "figure";
  id: string;
}

export interface RelatedInformation {
  path?: DocPath;
  location?: SourceLocation;
  message: string;
}

export interface Diagnostic {
  /** Stable identifier `"<stage>/<rule>"`, e.g. `"schema/unknown-field"`. */
  code: string;
  severity: Severity;
  /** One English sentence. */
  message: string;
  path?: DocPath;
  location?: SourceLocation;
  subject?: DiagnosticSubject;
  /** Suggested fix, e.g. the closest known ID for an unknown reference. */
  hint?: string;
  related?: RelatedInformation[];
}

/** Returns `true` if any diagnostic has severity `"error"`. */
export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === "error");
}

/**
 * Formats a path for messages: `["nodes", 2, "label"]` → `nodes[2].label`.
 * The empty path formats as `(root)`.
 */
export function formatDocPath(path: readonly (string | number)[]): string {
  if (path.length === 0) return "(root)";
  let out = "";
  for (const segment of path) {
    if (typeof segment === "number") out += `[${segment}]`;
    else out += out === "" ? segment : `.${segment}`;
  }
  return out;
}

/**
 * Edit distance between two strings (optimal string alignment: insertions,
 * deletions, substitutions and transpositions of adjacent characters).
 */
export function editDistance(a: string, b: string): number {
  const rows: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      if (i === 0) {
        row.push(j);
        continue;
      }
      const above = rows[i - 1] ?? [];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let distance = Math.min(
        (above[j] ?? 0) + 1,
        (row[j - 1] ?? 0) + 1,
        (above[j - 1] ?? 0) + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        distance = Math.min(distance, (rows[i - 2]?.[j - 2] ?? 0) + 1);
      }
      row.push(distance);
    }
    rows.push(row);
  }
  return rows[a.length]?.[b.length] ?? 0;
}

/**
 * Returns the candidate closest to `input` by edit distance (case-insensitive),
 * or `undefined` if none is close enough to be a plausible typo.
 */
export function closestMatch(input: string, candidates: Iterable<string>): string | undefined {
  const needle = input.toLowerCase();
  const maxDistance = Math.max(1, Math.floor(needle.length / 3));
  let best: string | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const distance = editDistance(needle, candidate.toLowerCase());
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return bestDistance <= maxDistance ? best : undefined;
}

/** `Did you mean "x"?` for the closest candidate, or `undefined`. */
export function didYouMean(input: string, candidates: Iterable<string>): string | undefined {
  const match = closestMatch(input, candidates);
  return match === undefined ? undefined : `Did you mean "${match}"?`;
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
