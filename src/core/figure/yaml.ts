/**
 * Stage `yaml`: parses a Sumi document with source positions and enforces the
 * YAML restrictions of design doc §2.2 (no duplicate keys, anchors, aliases,
 * merge keys, multiple documents or custom tags).
 */

import {
  type Document,
  isAlias,
  isMap,
  isScalar,
  isSeq,
  LineCounter,
  type Node,
  type Pair,
  parseAllDocuments,
  type Scalar,
} from "yaml";
import type { Diagnostic, DocPath, SourceLocation } from "../diagnostics";

/**
 * Maps a document path to its source location. Resolves to the nearest
 * existing ancestor when the path does not exist (e.g. a missing field points
 * at its parent mapping). With `key: true`, a mapping entry resolves to its key
 * instead of its value. With `span` (UTF-16 offsets into a string value), a
 * string scalar resolves to that part of its source when the value maps to
 * the source character by character (single-line plain, single- or
 * double-quoted scalars); otherwise to the whole scalar.
 */
export type Locator = (
  path: DocPath,
  options?: { key?: boolean; span?: readonly [number, number] },
) => SourceLocation | undefined;

export interface YamlSource {
  /** The document as plain JS data (YAML 1.2 core schema). */
  value: unknown;
  locate: Locator;
}

export interface ParseYamlResult {
  /** Present only when the yaml stage reported no errors. */
  source?: YamlSource;
  diagnostics: Diagnostic[];
}

const ALLOWED_TAGS = new Set(
  ["str", "int", "float", "bool", "null", "map", "seq"].map((t) => `tag:yaml.org,2002:${t}`),
);

/**
 * Options every Sumi YAML parse uses (YAML 1.2 core schema, no merge keys).
 * Shared with the formatter so it reads documents exactly like the checker.
 */
export const YAML_PARSE_OPTIONS = Object.freeze({
  version: "1.2",
  schema: "core",
  merge: false,
  // Duplicate keys are reported by our own walk, which knows the DocPath.
  uniqueKeys: false,
  prettyErrors: false,
  logLevel: "silent",
} as const);

type YamlNode = Node | Pair<unknown, unknown> | null | undefined;

/** Parses YAML text into plain data plus a {@link Locator}. */
export function parseYaml(text: string, file?: string): ParseYamlResult {
  const lineCounter = new LineCounter();
  const docs = parseAllDocuments(text, { ...YAML_PARSE_OPTIONS, lineCounter });

  const toLocation = (start: number, end?: number): SourceLocation => {
    const s = lineCounter.linePos(start);
    const location: SourceLocation = {
      ...(file !== undefined && { file }),
      line: s.line,
      column: s.col,
    };
    if (end !== undefined) {
      const e = lineCounter.linePos(end);
      location.endLine = e.line;
      location.endColumn = e.col;
    }
    return location;
  };
  const nodeLocation = (node: Node): SourceLocation | undefined =>
    node.range ? toLocation(node.range[0], node.range[1]) : undefined;

  const diagnostics: Diagnostic[] = [];
  const report = (code: string, message: string, path: DocPath | undefined, node?: Node | null) => {
    const location = node ? nodeLocation(node) : undefined;
    diagnostics.push({
      code,
      severity: "error",
      message,
      ...(path !== undefined && { path }),
      ...(location !== undefined && { location }),
    });
  };

  // An empty stream has no documents; treat it as an empty (null) document.
  const doc: Document.Parsed | undefined = Array.isArray(docs) ? docs[0] : undefined;
  if (Array.isArray(docs)) {
    for (const extra of docs.slice(1)) {
      diagnostics.push({
        code: "yaml/multiple-documents",
        severity: "error",
        message: "A Sumi file must contain exactly one YAML document.",
        location: toLocation(extra.range[0]),
        hint: "Remove the `---` separator and split the figures into separate files.",
      });
    }
  }
  for (const error of doc?.errors ?? []) {
    diagnostics.push({
      code: "yaml/syntax",
      severity: "error",
      message: `YAML syntax error: ${firstLine(error.message)}`,
      location: toLocation(error.pos[0], error.pos[1]),
    });
  }
  if (diagnostics.length > 0) return { diagnostics };
  if (doc === undefined) {
    return { source: { value: null, locate: () => undefined }, diagnostics };
  }

  const checkNodeProperties = (node: Node, path: DocPath) => {
    if (isAlias(node)) {
      report(
        "yaml/alias-not-allowed",
        `Aliases (*${node.source}) are not allowed in Sumi documents.`,
        path,
        node,
      );
      return false;
    }
    if (node.anchor !== undefined) {
      report(
        "yaml/alias-not-allowed",
        `Anchors (&${node.anchor}) are not allowed in Sumi documents.`,
        path,
        node,
      );
    }
    if (node.tag !== undefined && !ALLOWED_TAGS.has(node.tag)) {
      report("yaml/tag-not-allowed", `The YAML tag ${node.tag} is not allowed.`, path, node);
    }
    return true;
  };

  const walk = (node: YamlNode, path: DocPath): void => {
    if (!node || !("range" in node)) return;
    if (!checkNodeProperties(node, path)) return;
    if (isMap(node)) {
      const seen = new Map<string, Node>();
      for (const pair of node.items) {
        const key = pair.key as YamlNode;
        if (key && "range" in key && !checkNodeProperties(key, path)) continue;
        if (!isScalar(key) || typeof key.value !== "string") {
          const at = key && "range" in key ? key : (pair.value as Node | null);
          report("yaml/non-string-key", "Mapping keys must be strings.", path, at);
          continue;
        }
        const name = key.value;
        if (name === "<<" && key.type === "PLAIN") {
          report("yaml/alias-not-allowed", "Merge keys (<<) are not allowed.", path, key);
          continue;
        }
        const first = seen.get(name);
        if (first) {
          const firstLocation = nodeLocation(first);
          diagnostics.push({
            code: "yaml/duplicate-key",
            severity: "error",
            message: `Duplicate key "${name}".`,
            path: [...path, name],
            ...withLocation(nodeLocation(key)),
            related: [
              {
                path: [...path, name],
                ...withLocation(firstLocation),
                message: "First defined here.",
              },
            ],
          });
          continue;
        }
        seen.set(name, key);
        walk(pair.value as YamlNode, [...path, name]);
      }
    } else if (isSeq(node)) {
      node.items.forEach((item, index) => {
        walk(item as YamlNode, [...path, index]);
      });
    }
  };
  walk(doc.contents, []);
  if (diagnostics.length > 0) return { diagnostics };

  const locate: Locator = (path, options = {}) => {
    const located = locateNode(path, options);
    const { node } = located;
    if (options.span !== undefined && isScalar(node) && node.range) {
      const start = scalarSourceOffset(text, node, options.span[0]);
      const end = scalarSourceOffset(text, node, options.span[1]);
      if (start !== undefined && end !== undefined) return toLocation(start, end);
    }
    return located.location;
  };

  const locateNode = (
    path: DocPath,
    options: { key?: boolean },
  ): { node: Node | null; location: SourceLocation | undefined } => {
    let node: Node | null = doc.contents;
    let located = node ? nodeLocation(node) : undefined;
    for (const [i, segment] of path.entries()) {
      if (isMap(node)) {
        const pair = node.items.find((p) => isScalar(p.key) && p.key.value === segment);
        if (!pair) return { node: null, location: located };
        if (options.key && i === path.length - 1 && isScalar(pair.key)) {
          return { node: null, location: nodeLocation(pair.key) ?? located };
        }
        node = pair.value as Node | null;
      } else if (isSeq(node) && typeof segment === "number") {
        node = (node.items[segment] as Node | undefined) ?? null;
      } else {
        return { node: null, location: located };
      }
      if (!node) return { node: null, location: located };
      located = nodeLocation(node) ?? located;
    }
    return { node, location: located };
  };

  return { source: { value: doc.toJS(), locate }, diagnostics };
}

/**
 * The source offset of UTF-16 offset `index` (0 … length) of a string
 * scalar's value, when the value maps to its source character by character:
 * a plain scalar on one line, or a single- / double-quoted scalar on one line
 * (`''` and the escapes are decoded, so offsets after them stay exact).
 * `undefined` otherwise (block scalars, folded lines, non-string values).
 */
export function scalarSourceOffset(text: string, node: Scalar, index: number): number | undefined {
  const { range } = node;
  const value = node.value;
  if (!range || typeof value !== "string" || index < 0 || index > value.length) return undefined;
  const source = text.slice(range[0], range[1]);
  if (source.includes("\n") || source.includes("\r")) return undefined;
  if (node.type === "PLAIN") return source === value ? range[0] + index : undefined;
  if (node.type !== "QUOTE_SINGLE" && node.type !== "QUOTE_DOUBLE") return undefined;
  const quote = node.type === "QUOTE_SINGLE" ? "'" : '"';
  if (source[0] !== quote || source.at(-1) !== quote) return undefined;
  // Decode the source, recording where each value unit starts.
  const starts: number[] = [];
  let decoded = "";
  let i = 1;
  while (i < source.length - 1) {
    const c = source[i] as string;
    let width = 1;
    let unit = c;
    if (quote === "'" && c === "'") {
      width = 2; // ''
    } else if (quote === '"' && c === "\\") {
      const e = source[i + 1] ?? "";
      const hex = { x: 2, u: 4, U: 8 }[e];
      if (hex !== undefined) {
        width = 2 + hex;
        unit = String.fromCodePoint(Number.parseInt(source.slice(i + 2, i + 2 + hex), 16));
      } else {
        width = 2;
        unit = DOUBLE_QUOTED_ESCAPES[e] ?? "";
        if (unit === "") return undefined;
      }
    }
    for (let k = 0; k < unit.length; k++) starts.push(range[0] + i);
    decoded += unit;
    i += width;
  }
  if (decoded !== value) return undefined;
  return index === value.length ? range[0] + source.length - 1 : starts[index];
}

/** YAML 1.2 double-quoted escapes that stand for one character. */
const DOUBLE_QUOTED_ESCAPES: Record<string, string> = {
  "0": "\0",
  a: "\x07",
  b: "\b",
  t: "\t",
  "\t": "\t",
  n: "\n",
  v: "\v",
  f: "\f",
  r: "\r",
  e: "\x1b",
  " ": " ",
  '"': '"',
  "/": "/",
  "\\": "\\",
  N: "\u0085",
  _: "\u00a0",
  L: "\u2028",
  P: "\u2029",
};

function firstLine(message: string): string {
  return message.split("\n", 1)[0] ?? message;
}

function withLocation(location: SourceLocation | undefined): { location?: SourceLocation } {
  return location === undefined ? {} : { location };
}
