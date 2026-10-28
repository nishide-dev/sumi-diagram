import { describe, expect, test } from "bun:test";
import { LintConfigError, resolveLintConfig } from "../lint/config";
import { checkFigure } from "./check";
import { reservedKeyPaths } from "./reserved-keys";
import { BUILTIN_THEME_DEFINITIONS } from "./theme/builtin";
import { validateTheme } from "./theme/schema";

/** A `__proto__` key is dropped by Zod without an issue: every input reports it (review of PR #211). */
const box = (props: string) => `version: 1
figure:
  id: f
  theme: paper
  layout:
    arrange: { row: { items: [a] } }
nodes:
  - id: a
    component: box
    label: A
    props: ${props}
edges: []
`;

const summarize = (
  diagnostics: { code: string; path?: unknown; location?: { line: number; column: number } }[],
) => diagnostics.map((d) => [d.code, d.path, d.location?.line ?? 0, d.location?.column ?? 0]);

describe("reserved keys", () => {
  test("paths of own __proto__ keys, deeply", () => {
    const value = JSON.parse('{"a": [{"__proto__": 1}], "__proto__": {"b": 2}, "c": {"d": 3}}');
    expect(reservedKeyPaths(value)).toEqual([["a", 0, "__proto__"], ["__proto__"]]);
    expect(reservedKeyPaths({ a: { b: [1, "x"] } })).toEqual([]);
  });

  test("a figure's props.__proto__ is an error at the key (top level and nested)", () => {
    const top = checkFigure(box('{ width: 5pt, "__proto__": {} }'));
    expect(summarize(top.state.diagnostics)).toEqual([
      ["schema/reserved-key", ["nodes", 0, "props", "__proto__"], 11, 26],
    ]);
    expect(top.state.diagnostics[0]?.message).toBe(
      'The key "__proto__" in nodes[0].props is reserved and cannot be used: it would be dropped.',
    );
    const nested = checkFigure(box('{ width: 5pt }\n    labelAt: x\n    "__proto__": 1'));
    expect(summarize(nested.state.diagnostics).map(([code, path]) => [code, path])).toContainEqual([
      "schema/reserved-key",
      ["nodes", 0, "__proto__"],
    ]);
    const root = checkFigure(`${box("{}")}"__proto__": {}\n`);
    expect(summarize(root.state.diagnostics)).toEqual([
      ["schema/reserved-key", ["__proto__"], 13, 1],
    ]);
  });

  test("a lint configuration and a theme reject it too", () => {
    const config = JSON.parse('{"rules": {"__proto__": "off"}}');
    expect(() => resolveLintConfig(config)).toThrow(LintConfigError);
    expect(() => resolveLintConfig(config)).toThrow(
      'The key "__proto__" in rules is reserved and cannot be used: it would be dropped.',
    );
    const [definition] = BUILTIN_THEME_DEFINITIONS;
    const theme = { ...definition, tones: JSON.parse('{"__proto__": {"fill": "#ffffff"}}') };
    const result = validateTheme(theme);
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.diagnostics.map((d) => [d.code, d.path])).toEqual([
      ["theme/reserved-key", ["tones", "__proto__"]],
    ]);
  });
});
