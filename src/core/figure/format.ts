/**
 * `sumi fmt`: re-prints a `*.sumi.yaml` source in a canonical layout without
 * changing its meaning, keeping comments.
 *
 * What changes (by default):
 * - indentation: 2 spaces, block sequences indented under their key;
 * - spacing: one space after `:` and `-` and before a trailing comment (column
 *   alignment of trailing comments is not kept), `{ a: 1 }` / `[ 1, 2 ]` in flow
 *   collections; no trailing whitespace; `\n` line endings; one final newline;
 *   several blank lines in a row become one;
 * - plain scalars may be re-printed in their canonical form when the value is
 *   the same (e.g. `0x1F` → `0x1f`).
 *
 * What does not change: key order (unless `canonicalOrder`), the quoting style
 * of untagged scalars (single-line quoted strings are kept byte for byte,
 * escapes included), block scalars (`|`, `>`), flow vs. block collections,
 * comments and whether entries are separated by a blank line. Long lines are
 * never folded. A document with only comments keeps its comments. Explicitly
 * tagged scalars (`!!int "123"`) keep their tag and value but are re-printed
 * by the YAML library (e.g. `!!int 123`, `!!str "123"`).
 *
 * With `canonicalOrder`, the known keys of the root, `figure`,
 * `figure.layout`, groups, nodes and edges are put in Figure Schema field
 * order (unknown keys follow in their original order; `props` and `metadata`
 * are left alone). This is meaning-preserving but moves lines around, so it
 * is opt-in.
 *
 * Safety: the result is re-parsed and must yield the same data (same key order
 * unless `canonicalOrder`), the same comments, no YAML errors, and format to
 * itself. Otherwise {@link FormatSafetyError} is thrown and nothing should be
 * written.
 */

import {
  CST,
  isMap,
  isPair,
  isScalar,
  isSeq,
  Lexer,
  parseDocument,
  Scalar,
  visit,
  type YAMLMap,
} from "yaml";
import type { Diagnostic } from "../diagnostics";
import {
  EdgeSchema,
  FigureDocumentSchema,
  FigureMetaSchema,
  GroupSchema,
  LayoutSchema,
  NodeSchema,
} from "./schema";
import { parseYaml, YAML_PARSE_OPTIONS } from "./yaml";

export interface FormatFigureOptions {
  /** File name recorded in diagnostic locations. */
  file?: string;
  /** Put known keys in Figure Schema field order. */
  canonicalOrder?: boolean;
}

export type FormatFigureResult =
  | { ok: true; text: string; changed: boolean; diagnostics: [] }
  | { ok: false; diagnostics: Diagnostic[] };

/** The formatted text failed a safety check: a formatter bug, never the input's fault. */
export class FormatSafetyError extends Error {
  override name = "FormatSafetyError";
}

const STRINGIFY_OPTIONS = Object.freeze({
  indent: 2,
  indentSeq: true,
  lineWidth: 0,
  minContentWidth: 0,
  flowCollectionPadding: true,
} as const);

/** Key order of each schema object (Zod shapes keep declaration order). */
const KEY_ORDER = {
  root: Object.keys(FigureDocumentSchema.shape),
  figure: Object.keys(FigureMetaSchema.shape),
  layout: Object.keys(LayoutSchema.shape),
  group: Object.keys(GroupSchema.shape),
  node: Object.keys(NodeSchema.shape),
  edge: Object.keys(EdgeSchema.shape),
};

/**
 * Formats a Sumi YAML source. A source with YAML-stage errors (syntax,
 * duplicate keys, aliases, tags, several documents) is not formatted: its
 * diagnostics are returned instead. Schema and later errors do not prevent
 * formatting.
 *
 * @throws FormatSafetyError if the output would not be equivalent to the input.
 */
export function formatFigureSource(
  text: string,
  options: FormatFigureOptions = {},
): FormatFigureResult {
  const original = parseYaml(text, options.file);
  if (original.source === undefined) return { ok: false, diagnostics: original.diagnostics };

  const formatted = print(text, options.canonicalOrder ?? false);

  const reparsed = parseYaml(formatted);
  if (reparsed.source === undefined) {
    throw new FormatSafetyError("The formatted document has YAML errors.");
  }
  const sameData = options.canonicalOrder
    ? canonicalJson(original.source.value, true) === canonicalJson(reparsed.source.value, true)
    : canonicalJson(original.source.value, false) === canonicalJson(reparsed.source.value, false);
  if (!sameData) throw new FormatSafetyError("The formatted document has different data.");
  if (!sameMultiset(comments(text), comments(formatted))) {
    throw new FormatSafetyError("The formatted document has different comments.");
  }
  if (print(formatted, options.canonicalOrder ?? false) !== formatted) {
    throw new FormatSafetyError("Formatting is not stable (formatting the output changes it).");
  }
  return { ok: true, text: formatted, changed: formatted !== text, diagnostics: [] };
}

function print(text: string, canonicalOrder: boolean): string {
  const doc = parseDocument(text, YAML_PARSE_OPTIONS);
  if (doc.contents === null) {
    // Only comments (or nothing): the printer would emit `null`.
    const lines = text.split(/\r\n|\r|\n/).map((line) => line.trimEnd());
    const kept = lines.filter((line, i) => line !== "" || (i > 0 && lines[i - 1] !== ""));
    while (kept[0] === "") kept.shift();
    while (kept.at(-1) === "") kept.pop();
    return kept.length === 0 ? "" : `${kept.join("\n")}\n`;
  }
  if (canonicalOrder) reorderDocument(doc.contents);

  // Keep single-line quoted values verbatim: the printer would re-escape them
  // (e.g. `"\u0085"` would become an invisible raw character).
  const verbatim = new Map<string, string>();
  let nonce = 0;
  while (text.includes(`__sumi_fmt_${nonce}_`)) nonce++;
  visit(doc, {
    Scalar(key, node) {
      if (key === "key" || node.range === undefined || node.range === null) return;
      if (node.type !== Scalar.QUOTE_DOUBLE && node.type !== Scalar.QUOTE_SINGLE) return;
      // A tag (`!!int "123"`, `!!str "x"`) is part of the source and may change the type:
      // leave tagged scalars to the printer, which keeps the tag and the resolved value.
      if (node.tag !== undefined || typeof node.value !== "string") return;
      const source = text.slice(node.range[0], node.range[1]);
      if (/[\r\n]/.test(source)) return;
      const placeholder = `__sumi_fmt_${nonce}_${verbatim.size}__`;
      verbatim.set(placeholder, source);
      node.value = placeholder;
      node.type = Scalar.PLAIN;
    },
  });
  return doc
    .toString(STRINGIFY_OPTIONS)
    .replace(/__sumi_fmt_\d+_\d+__/g, (placeholder) => verbatim.get(placeholder) ?? placeholder);
}

function reorderDocument(contents: unknown): void {
  if (!isMap(contents)) return;
  sortMap(contents, KEY_ORDER.root, true);
  const figure = contents.get("figure", true);
  if (isMap(figure)) {
    sortMap(figure, KEY_ORDER.figure);
    const layout = figure.get("layout", true);
    if (isMap(layout)) sortMap(layout, KEY_ORDER.layout);
  }
  for (const [field, order] of [
    ["groups", KEY_ORDER.group],
    ["nodes", KEY_ORDER.node],
    ["edges", KEY_ORDER.edge],
  ] as const) {
    const list = contents.get(field, true);
    if (!isSeq(list)) continue;
    for (const item of list.items) if (isMap(item)) sortMap(item, order);
  }
}

/**
 * Stable sort: known keys in `order`, then unknown keys in their original
 * order. Comments and blank lines before an entry move with it, except at the
 * root (`fileHeader`), where a comment above the first entry is the file's
 * header and stays on top.
 */
function sortMap(map: YAMLMap, order: readonly string[], fileHeader = false): void {
  const rank = (pair: unknown): number => {
    if (!isPair(pair) || !isScalar(pair.key) || typeof pair.key.value !== "string") {
      return order.length;
    }
    const index = order.indexOf(pair.key.value);
    return index === -1 ? order.length : index;
  };
  const firstKey = (): Scalar | undefined => {
    const first = map.items[0];
    return isPair(first) && isScalar(first.key) ? first.key : undefined;
  };
  const before = firstKey();
  const header = fileHeader ? before?.commentBefore : undefined;
  if (before && header) before.commentBefore = null;
  map.items.sort((a, b) => rank(a) - rank(b));
  const after = firstKey();
  if (after && header) {
    after.commentBefore = after.commentBefore ? `${header}\n${after.commentBefore}` : header;
  }
}

/** The comment texts of a YAML source, without `#` and surrounding whitespace. */
function comments(text: string): string[] {
  const found: string[] = [];
  for (const token of new Lexer().lex(text)) {
    if (CST.tokenType(token) === "comment") found.push(token.slice(1).trim());
  }
  return found;
}

function sameMultiset(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const x = [...a].sort();
  const y = [...b].sort();
  return x.every((value, i) => value === y[i]);
}

/** JSON text of plain YAML data that also distinguishes NaN, ±Infinity and -0. */
function canonicalJson(value: unknown, sortKeys: boolean): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (typeof v === "number") {
      if (Object.is(v, -0)) return "\u0000num:-0";
      if (!Number.isFinite(v)) return `\u0000num:${v}`;
      return v;
    }
    if (sortKeys && v !== null && typeof v === "object" && !Array.isArray(v)) {
      return Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    }
    return v;
  });
}
