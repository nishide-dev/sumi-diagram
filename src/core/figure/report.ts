import type { Diagnostic, DocPath } from "../diagnostics";
import type { Locator } from "./yaml";

type ErrorDetails = {
  [K in "subject" | "hint" | "related"]?: Diagnostic[K] | undefined;
};

/**
 * Builds an error diagnostic located at `path` (or at the key of the last path
 * segment when `atKey` is set).
 */
export function errorAt(
  locate: Locator,
  code: string,
  message: string,
  path: DocPath,
  details: ErrorDetails & { atKey?: boolean } = {},
): Diagnostic {
  const { atKey, ...rest } = details;
  const location = locate(path, { key: atKey === true });
  return {
    code,
    severity: "error",
    message,
    path,
    ...(location !== undefined && { location }),
    ...(dropUndefined(rest) as Pick<Diagnostic, "subject" | "hint" | "related">),
  };
}

/** Builds a `related` entry located at `path`. */
export function relatedAt(locate: Locator, path: DocPath, message: string) {
  const location = locate(path);
  return { path, ...(location !== undefined && { location }), message };
}

function dropUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}
