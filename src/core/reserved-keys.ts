/**
 * Reserved mapping keys (#180, review of PR #211): Zod's `z.record` and
 * object schemas drop an own `__proto__` key without an issue (a JavaScript
 * object cannot hold it as data safely), so a figure, theme or lint
 * configuration that writes one would silently lose that entry, e.g. a
 * matrix class named `__proto__`. Every input is walked for such keys
 * before it is parsed, and each is reported where it is written.
 */

import { type DocPath, formatDocPath } from "./diagnostics";

/** The key no input may use. */
export const RESERVED_KEY = "__proto__";

/** The paths of every own `__proto__` key in `value` (mappings and lists, deeply), in document order. */
export function reservedKeyPaths(value: unknown, path: DocPath = []): DocPath[] {
  if (Array.isArray(value)) return value.flatMap((item, i) => reservedKeyPaths(item, [...path, i]));
  if (value === null || typeof value !== "object") return [];
  const found: DocPath[] = [];
  for (const key of Object.keys(value)) {
    if (key === RESERVED_KEY) found.push([...path, key]);
    else found.push(...reservedKeyPaths((value as Record<string, unknown>)[key], [...path, key]));
  }
  return found;
}

/** The message for a reserved key at `path`. */
export function reservedKeyMessage(path: DocPath): string {
  const where = path.length > 1 ? ` in ${formatDocPath(path.slice(0, -1))}` : "";
  return `The key "${RESERVED_KEY}"${where} is reserved and cannot be used: it would be dropped.`;
}
