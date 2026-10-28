/**
 * Stage `schema`: validates the parsed YAML against Figure Schema v1 and
 * stores the normalized, structurally readable part in `state.doc`.
 *
 * Each element is validated on its own so one bad element does not hide the
 * rest. An element whose only problem is unknown fields is kept (and marked
 * invalid) so references to it do not cascade into `ref/*` errors.
 */

import { satisfies, validRange } from "semver";
import { type core, z } from "zod";
import pkg from "../../../package.json";
import {
  type CheckState,
  type ElementKey,
  edgeKey,
  groupKey,
  nodeKey,
  type PartialFigure,
} from "../check-state";
import { type Diagnostic, type DocPath, didYouMean, formatDocPath } from "../diagnostics";
import { errorAt } from "./report";
import {
  EdgeSchema,
  FIGURE_SCHEMA_VERSION,
  FigureDocumentSchema,
  FigureMetaSchema,
  GroupSchema,
  ID_PATTERN,
  type JsonValue,
  NodeSchema,
  ONE_OF_ISSUE,
  REF_PATTERN,
} from "./schema";
import type { Locator } from "./yaml";

/** The running Sumi version, checked against a document's `requires`. */
export const SUMI_VERSION: string = pkg.version;

type ErrorArgs = Parameters<typeof errorAt> extends [Locator, ...infer Rest] ? Rest : never;

const ROOT_KEYS = Object.keys(FigureDocumentSchema.shape);

const COLLECTIONS = [
  { name: "groups", schema: GroupSchema, key: (v: unknown) => idKey(v, groupKey) },
  { name: "nodes", schema: NodeSchema, key: (v: unknown) => idKey(v, nodeKey) },
  {
    name: "edges",
    schema: EdgeSchema,
    key: (v: unknown, index: number) => {
      const id = isRecord(v) && typeof v.id === "string" ? v.id : undefined;
      return edgeKey(id, index);
    },
  },
] as const;

/** Runs the `schema` stage on the plain YAML data. */
export function validateFigure(state: CheckState, raw: unknown, locate: Locator): void {
  const report = (...args: ErrorArgs) => state.diagnostics.push(errorAt(locate, ...args));

  if (!isRecord(raw)) {
    report("schema/invalid-type", `The document must be a mapping, got ${describe(raw)}.`, []);
    return;
  }

  // Gate 1: the schema version. Anything else is meaningless if it is wrong.
  if (raw.version === undefined) {
    report("schema/missing-field", 'Missing required field "version".', ["version"], {
      hint: `Add "version: ${FIGURE_SCHEMA_VERSION}" at the top of the file.`,
    });
    return;
  }
  if (raw.version !== FIGURE_SCHEMA_VERSION) {
    report(
      "schema/unsupported-version",
      `Unsupported figure schema version ${JSON.stringify(raw.version)}; this Sumi supports version ${FIGURE_SCHEMA_VERSION}.`,
      ["version"],
    );
    return;
  }
  const doc: PartialFigure = { version: FIGURE_SCHEMA_VERSION };
  state.doc = doc;

  // Gate 2: the minimum Sumi version.
  if (raw.requires !== undefined) {
    const range = raw.requires;
    if (typeof range !== "string" || range === "" || validRange(range) === null) {
      report(
        "schema/invalid-value",
        `"requires" must be a semver range such as ">=0.4.0", got ${describe(range)}.`,
        ["requires"],
      );
    } else if (!satisfies(SUMI_VERSION, range, { includePrerelease: true })) {
      report(
        "schema/unsatisfied-requires",
        `This document requires Sumi ${range}, but this is Sumi ${SUMI_VERSION}.`,
        ["requires"],
        { hint: "Upgrade Sumi to a version that satisfies the range." },
      );
      return;
    } else {
      doc.requires = range;
    }
  }

  for (const key of Object.keys(raw)) {
    if (!ROOT_KEYS.includes(key)) report(...unknownField(key, [], ROOT_KEYS));
  }

  if (raw.figure === undefined) {
    report("schema/missing-field", 'Missing required field "figure".', ["figure"]);
  } else {
    const figure = parseElement(FigureMetaSchema, raw.figure, ["figure"], state, locate);
    if (figure.value !== undefined) doc.figure = figure.value;
  }

  if (raw.metadata !== undefined) {
    const problem = findNonJson(raw.metadata, ["metadata"]);
    if (problem) {
      report(
        "schema/invalid-metadata",
        `metadata must be JSON-compatible; ${formatDocPath(problem.path)} is ${problem.what}.`,
        problem.path,
      );
    } else {
      doc.metadata = raw.metadata as JsonValue;
    }
  }

  for (const { name, schema, key } of COLLECTIONS) {
    const list = raw[name];
    if (list === undefined) {
      doc[name] = [];
      continue;
    }
    if (!Array.isArray(list)) {
      report("schema/invalid-type", `Expected "${name}" to be a list, got ${describe(list)}.`, [
        name,
      ]);
      continue;
    }
    // The element types differ per collection; the schema guarantees the shape.
    doc[name] = list.map((value, index) => {
      const result = parseElement(schema, value, [name, index], state, locate);
      if (!result.ok) {
        const elementKey = key(value, index);
        if (elementKey !== undefined) state.invalid.add(elementKey);
      }
      return result.value;
    }) as never;
  }
}

/**
 * Validates one object against a strict schema, reporting all issues. Returns
 * the normalized value if the object is readable apart from unknown fields.
 */
function parseElement<S extends z.ZodObject>(
  schema: S,
  value: unknown,
  path: DocPath,
  state: CheckState,
  locate: Locator,
): { ok: boolean; value?: z.output<S> } {
  const strict = schema.safeParse(value);
  if (strict.success) return { ok: true, value: strict.data };

  for (const issue of withoutRedundantIssues(strict.error.issues, value)) {
    state.diagnostics.push(...issueToDiagnostics(issue, schema, value, path, locate));
  }
  if (strict.error.issues.every((issue) => issue.code === "unrecognized_keys")) {
    const loose = schema.strip().safeParse(value);
    if (loose.success) return { ok: false, value: loose.data as z.output<S> };
  }
  return { ok: false };
}

function issueToDiagnostics(
  issue: core.$ZodIssue,
  schema: z.ZodType,
  root: unknown,
  basePath: DocPath,
  locate: Locator,
): Diagnostic[] {
  const relative = issue.path.filter((s) => typeof s !== "symbol");
  const path = [...basePath, ...relative];
  const at = formatDocPath(path);
  const actual = valueAt(root, relative);

  switch (issue.code) {
    case "invalid_union": {
      // The only union is an arrange item: an ID or a box. Report the branch
      // that matches the value's type (a string → ID, a mapping → box).
      const matching = issue.errors.filter(
        (branch) => !branch.some((i) => i.code === "invalid_type" && i.path.length === 0),
      );
      const [branch] = matching;
      if (matching.length === 1 && branch !== undefined) {
        const nested = schemaAt(schema, relative) ?? schema;
        // Nested issue paths are relative to the union's value.
        return withoutRedundantIssues(branch, actual).flatMap((i) =>
          issueToDiagnostics(i, nested, actual, path, locate),
        );
      }
      return [
        errorAt(
          locate,
          "schema/invalid-type",
          `Expected an element ID or a stack / row box at ${at}, got ${describe(actual)}.`,
          path,
        ),
      ];
    }
    case "custom": {
      const hint = (issue.params as { hint?: unknown } | undefined)?.hint;
      return [
        errorAt(locate, "schema/invalid-value", `Invalid value at ${at}: ${issue.message}`, path, {
          hint: typeof hint === "string" ? hint : undefined,
        }),
      ];
    }
    case "unrecognized_keys": {
      const known = objectKeysAt(schema, relative);
      return issue.keys.map((key) => errorAt(locate, ...unknownField(key, path, known)));
    }
    case "invalid_type":
      if (actual === undefined) {
        const field = path.at(-1);
        return [
          errorAt(
            locate,
            "schema/missing-field",
            `Missing required field "${String(field)}" in ${formatDocPath(path.slice(0, -1))}.`,
            path,
          ),
        ];
      }
      return [
        errorAt(
          locate,
          "schema/invalid-type",
          `Expected ${typeName(issue.expected)} at ${at}, got ${describe(actual)}.`,
          path,
        ),
      ];
    case "invalid_format":
      // A reference without a dot (#181) is reported exactly like an ID.
      if (
        issue.format === "regex" &&
        (issue.pattern === ID_PATTERN.toString() ||
          (issue.pattern === REF_PATTERN.toString() &&
            !(typeof actual === "string" && actual.includes("."))))
      ) {
        const lower = typeof actual === "string" ? actual.toLowerCase() : "";
        return [
          errorAt(
            locate,
            "schema/invalid-id",
            `Invalid ID ${JSON.stringify(actual)} at ${at}; IDs must match ${ID_PATTERN.source}.`,
            path,
            {
              hint: ID_PATTERN.test(lower)
                ? `IDs are lowercase only; use "${lower}".`
                : "Start with a lowercase letter and use only a-z, 0-9, '_' and '-' (max 64 characters).",
            },
          ),
        ];
      }
      if (issue.format === "regex" && issue.pattern === REF_PATTERN.toString()) {
        // A cell reference (#181): <node>.<cell>.
        const lower = typeof actual === "string" ? actual.toLowerCase() : "";
        return [
          errorAt(
            locate,
            "schema/invalid-id",
            `Invalid reference ${JSON.stringify(actual)} at ${at}; expected an ID (${ID_PATTERN.source}) or a tokens cell as <node>.<cell>.`,
            path,
            {
              hint: REF_PATTERN.test(lower)
                ? `IDs are lowercase only; use "${lower}".`
                : "IDs start with a lowercase letter and use only a-z, 0-9, '_' and '-' (max 64 characters); a cell of a tokens node is <node>.<cell id> or <node>.<position>, e.g. seq.a1 or seq.3.",
            },
          ),
        ];
      }
      break;
    case "invalid_value": {
      const options = issue.values.map((v) => JSON.stringify(v)).join(", ");
      const strings = issue.values.filter((v): v is string => typeof v === "string");
      return [
        errorAt(
          locate,
          "schema/invalid-value",
          `Invalid value ${JSON.stringify(actual)} at ${at}; expected ${issue.values.length > 1 ? "one of " : ""}${options}.`,
          path,
          { hint: typeof actual === "string" ? didYouMean(actual, strings) : undefined },
        ),
      ];
    }
    case "too_small":
      if (issue.origin === "string" || issue.origin === "array") {
        return [errorAt(locate, "schema/invalid-value", `${at} must not be empty.`, path)];
      }
      break;
  }
  return [
    errorAt(locate, "schema/invalid-value", `Invalid value at ${at}: ${issue.message}.`, path),
  ];
}

function unknownField(key: string, path: DocPath, known: readonly string[]): ErrorArgs {
  const suggestion = didYouMean(key, known);
  return [
    "schema/unknown-field",
    `Unknown field "${key}" in ${formatDocPath(path)}.`,
    [...path, key],
    {
      atKey: true,
      hint: `${suggestion ? `${suggestion} ` : ""}If this field was added in a newer Sumi version, upgrade Sumi.`,
    },
  ];
}

/** Keys of the object schema at `path` inside `schema`, or `[]`. */
function objectKeysAt(schema: z.ZodType, path: readonly PropertyKey[]): string[] {
  const current = schemaAt(schema, path);
  return current instanceof z.ZodObject ? Object.keys(current.shape) : [];
}

/**
 * The schema of the value at `path` inside `schema`, looking through
 * optional / default / prefault / pipe wrappers, list elements and the object
 * branch of a union (an arrange item).
 */
function schemaAt(schema: z.ZodType, path: readonly PropertyKey[]): z.ZodType | undefined {
  let current: unknown = schema;
  for (const segment of [...path, undefined]) {
    for (;;) {
      if (
        current instanceof z.ZodOptional ||
        current instanceof z.ZodDefault ||
        current instanceof z.ZodPrefault
      ) {
        current = current.unwrap();
      } else if (current instanceof z.ZodPipe) {
        current = current.in;
      } else if (current instanceof z.ZodUnion) {
        current = current.options.find((option) => option instanceof z.ZodObject);
      } else {
        break;
      }
    }
    if (segment === undefined) return current instanceof z.ZodType ? current : undefined;
    if (current instanceof z.ZodArray && typeof segment === "number") {
      current = current.element;
    } else if (current instanceof z.ZodObject) {
      current = current.shape[segment as string];
    } else {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Drops an "exactly one of" issue (an arrange box's `stack` / `row`, an
 * align constraint's `x` / `y`) of an object that has none of the keys but
 * has unknown keys: a typo such as `stak` is reported once, as an unknown
 * field with a suggestion. An object with both keys keeps it. `root` is the
 * value the issue paths are relative to.
 */
function withoutRedundantIssues(
  issues: readonly core.$ZodIssue[],
  root: unknown,
): core.$ZodIssue[] {
  const unknownAt = new Set(
    issues.filter((i) => i.code === "unrecognized_keys").map((i) => JSON.stringify(i.path)),
  );
  return issues.filter((i) => {
    const keys = oneOfKeys(i);
    if (keys === undefined || !unknownAt.has(JSON.stringify(i.path))) return true;
    const value = valueAt(root, i.path);
    return isRecord(value) && keys.some((key) => value[key] !== undefined);
  });
}

/** The keys of an "exactly one of" issue ({@link ONE_OF_ISSUE}), or `undefined`. */
function oneOfKeys(issue: core.$ZodIssue): readonly string[] | undefined {
  const params = (issue as { params?: Record<string, unknown> }).params;
  const keys = params?.[ONE_OF_ISSUE];
  return issue.code === "custom" && Array.isArray(keys) ? (keys as string[]) : undefined;
}

/** Finds the first value that is not JSON-compatible. */
function findNonJson(value: unknown, path: DocPath): { path: DocPath; what: string } | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") return undefined;
  if (typeof value === "number") {
    return Number.isFinite(value) ? undefined : { path, what: `the non-finite number ${value}` };
  }
  if (Array.isArray(value)) {
    for (const [i, item] of value.entries()) {
      const problem = findNonJson(item, [...path, i]);
      if (problem) return problem;
    }
    return undefined;
  }
  if (isRecord(value)) {
    for (const [k, item] of Object.entries(value)) {
      const problem = findNonJson(item, [...path, k]);
      if (problem) return problem;
    }
    return undefined;
  }
  return { path, what: describe(value) };
}

function idKey(value: unknown, toKey: (id: string) => ElementKey): ElementKey | undefined {
  return isRecord(value) && typeof value.id === "string" ? toKey(value.id) : undefined;
}

function valueAt(value: unknown, path: readonly PropertyKey[]): unknown {
  let current = value;
  for (const segment of path) {
    if (!isRecord(current) && !Array.isArray(current)) return undefined;
    current = (current as Record<PropertyKey, unknown>)[segment];
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function typeName(expected: string): string {
  switch (expected) {
    case "object":
    case "record":
      return "a mapping";
    case "array":
      return "a list";
    default:
      return `a ${expected}`;
  }
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "a list";
  if (typeof value === "object") return "a mapping";
  if (typeof value === "string") return `the string ${JSON.stringify(value)}`;
  return `the ${typeof value} ${String(value)}`;
}
