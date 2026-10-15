import { type Diagnostic, hasErrors } from "./diagnostics";

/**
 * Return type of public APIs (design doc §0). A successful result may still
 * carry warnings and infos; a failed one contains at least one error.
 */
export type Result<T> =
  | { ok: true; value: T; diagnostics: Diagnostic[] }
  | { ok: false; diagnostics: Diagnostic[] };

/**
 * Builds a `Result` from collected diagnostics: fails if any is an error,
 * otherwise computes the value.
 */
export function toResult<T>(diagnostics: Diagnostic[], value: () => T): Result<T> {
  return hasErrors(diagnostics)
    ? { ok: false, diagnostics }
    : { ok: true, value: value(), diagnostics };
}
