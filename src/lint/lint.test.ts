import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { z } from "zod";
import type { Diagnostic } from "../core/diagnostics";
import { ALL_LINT_RULES, LintConfigError, resolveLintConfig } from "./config";
import { formatLintJson, formatLintText, toLintJson } from "./format";
import { compareDiagnostics, LINT_EXIT_CODES, type LintOptions, lintFigure } from "./lint";
import { defineRule } from "./rule";
import { BUILTIN_LINT_RULES } from "./rules";

const fixtures = `${import.meta.dir}/../../tests/fixtures/figures`;
const goldens = `${import.meta.dir}/../../tests/fixtures/lint-output`;
// Set SUMI_UPDATE_GOLDEN=1 to rewrite the expected formatter outputs.
const update = process.env.SUMI_UPDATE_GOLDEN === "1";

const read = (name: string) => readFileSync(`${fixtures}/${name}`, "utf8");
const lint = (name: string, options: LintOptions = {}) =>
  lintFigure(read(name), { file: name, ...options });

type Summary = [code: string, severity: string, line: number, column: number];
const summarize = (diagnostics: Diagnostic[]): Summary[] =>
  diagnostics.map((d) => [d.code, d.severity, d.location?.line ?? 0, d.location?.column ?? 0]);
const codes = (diagnostics: Diagnostic[]) => diagnostics.map((d) => d.code);

describe("rules", () => {
  test("a clean figure has no diagnostics", () => {
    const report = lint("lint/clean.sumi.yaml");
    expect(report.diagnostics).toEqual([]);
    expect(report.exitCode).toBe(0);
  });

  test.each<[string, Summary[]]>([
    ["lint/empty-figure.sumi.yaml", [["lint/empty-figure", "warning", 1, 1]]],
    ["lint/no-edges.sumi.yaml", [["lint/no-edges", "warning", 1, 1]]],
    [
      "lint/ancestor-edge.sumi.yaml",
      [
        ["lint/ancestor-edge", "warning", 21, 5],
        ["lint/ancestor-edge", "warning", 23, 5],
      ],
    ],
    ["lint/self-loop.sumi.yaml", [["lint/self-loop", "info", 9, 5]]],
    [
      "lint/duplicate-edge.sumi.yaml",
      [
        ["lint/duplicate-edge", "warning", 16, 5],
        ["lint/duplicate-edge", "warning", 29, 5],
      ],
    ],
    [
      "lint/empty-label.sumi.yaml",
      [
        ["lint/empty-label", "warning", 5, 5],
        ["lint/empty-label", "warning", 9, 12],
      ],
    ],
    [
      "lint/long-label.sumi.yaml",
      [
        ["lint/long-label", "warning", 7, 12],
        ["lint/long-label", "warning", 10, 12],
        ["lint/long-label", "warning", 14, 12],
      ],
    ],
    [
      "lint/missing-glyph.sumi.yaml",
      [
        ["lint/missing-glyph", "warning", 7, 12],
        ["lint/missing-glyph", "warning", 11, 12],
        ["lint/missing-glyph", "warning", 15, 12],
        ["lint/missing-glyph", "warning", 22, 12],
      ],
    ],
    [
      "lint/literal-newline.sumi.yaml",
      [
        ["lint/literal-newline", "warning", 8, 31],
        ["lint/literal-newline", "warning", 8, 50],
        ["lint/literal-newline", "warning", 10, 54],
        ["lint/literal-newline", "warning", 17, 35],
        ["lint/literal-newline", "warning", 19, 41],
        ["lint/literal-newline", "warning", 20, 41],
      ],
    ],
  ])("%s", (name, expected) => {
    expect(summarize(lint(name).diagnostics)).toEqual(expected);
  });

  test("ancestor-edge reports the edge, subject and group", () => {
    const [first] = lint("lint/ancestor-edge.sumi.yaml").diagnostics;
    expect(first).toMatchObject({
      message: 'Edge edges[1] connects group "outer" with "api", which is inside it.',
      path: ["edges", 1],
      subject: { kind: "edge", id: "edges[1]" },
      related: [{ path: ["groups", 0], message: 'Group "outer" is defined here.' }],
    });
  });

  test("duplicate-edge points at the first edge", () => {
    const [first] = lint("lint/duplicate-edge.sumi.yaml").diagnostics;
    expect(first?.message).toBe(
      'Edge edges[1] duplicates edge "first" (same endpoints, component and label).',
    );
    expect(first?.related?.[0]?.path).toEqual(["edges", 0]);
  });

  test("duplicate-edge compares anchors in structured figures", () => {
    const source = (anchors: [string, string, string]) =>
      [
        "version: 1",
        "figure:",
        "  id: f",
        "  layout:",
        "    arrange: { stack: { items: [a, b] } }",
        "nodes:",
        "  - { id: a, component: box, label: A }",
        "  - { id: b, component: box, label: B }",
        "edges:",
        ...anchors.map((anchor) => `  - { from: a, to: b, toAnchor: "${anchor}" }`),
        "",
      ].join("\n");
    const codes = (anchors: [string, string, string]) =>
      lintFigure(source(anchors)).diagnostics.map((d) => [d.code, d.path]);
    expect(codes(["north:0.25", "north", "north:0.75"])).toEqual([]);
    // "north" and "north:0.5" are the same anchor.
    expect(codes(["north:0.25", "north", "north:0.5"])).toEqual([
      ["lint/duplicate-edge", ["edges", 2]],
    ]);
  });

  test("long-label reports width and line count, with configurable limits", () => {
    const messages = lint("lint/long-label.sumi.yaml").diagnostics.map((d) => d.message);
    expect(messages).toEqual([
      'The label of node "wide" has a line 62 columns wide (limit 40).',
      'The label of node "tall" has 5 lines (limit 4).',
      'The label of node "cjk" has a line 52 columns wide (limit 40).',
    ]);
    const strict = lint("lint/long-label.sumi.yaml", {
      config: { rules: { "lint/long-label": { options: { maxLineWidth: 10, maxLines: 2 } } } },
    });
    expect(strict.diagnostics.map((d) => d.message)).toContain(
      'The label of node "tall" has 5 lines (limit 2).',
    );
    expect(strict.diagnostics.map((d) => d.message)).toContain(
      "The label of edge edges[0] has a line 40 columns wide (limit 10).",
    );
  });

  test("the label rules read a node's sublabel too (#184)", () => {
    const text = `version: 1
figure:
  id: f
  layout:
    arrange: { stack: { items: [a, b] } }
nodes:
  - { id: a, component: box, label: Noise, sublabel: "32 × 32 × 4 😀" }
  - id: b
    component: box
    label: Wide
    sublabel: 'a sublabel that is much wider than forty columns\\nof text'
`;
    const found = lintFigure(text).diagnostics.filter((d) => d.code !== "lint/no-edges");
    expect(found.map((d) => [d.code, d.path, d.message])).toEqual([
      [
        "lint/missing-glyph",
        ["nodes", 0, "sublabel"],
        'The sublabel of node "a" has a character missing from the regular and math fonts of font set sumi/biz-ud-gothic: "😀" (U+1F600).',
      ],
      [
        "lint/long-label",
        ["nodes", 1, "sublabel"],
        'The sublabel of node "b" has a line 57 columns wide (limit 40).',
      ],
      [
        "lint/literal-newline",
        ["nodes", 1, "sublabel"],
        'The sublabel of node "b" has a literal "\\n" (a backslash and n) outside $...$ math; it is drawn as written, not as a line break.',
      ],
    ]);
  });

  test("long-label counts keycap emoji as 2 columns", () => {
    const keycaps = (n: number) => "1\ufe0f\u20e3".repeat(n);
    const figure = (label: string) =>
      `version: 1\nfigure: { id: k }\nnodes:\n  - { id: a, component: box, label: "${label}" }\n`;
    const longLabels = (label: string) =>
      codes(lintFigure(figure(label)).diagnostics).filter((c) => c === "lint/long-label");
    expect(longLabels(keycaps(20))).toEqual([]); // 40 columns: at the limit
    expect(longLabels(keycaps(21))).toEqual(["lint/long-label"]); // 42 columns
  });

  test("no-edges counts only valid nodes", () => {
    const text = [
      "version: 1",
      "figure: { id: x }",
      "nodes:",
      "  - { id: a, component: cloud }",
      "  - { id: b, component: cloud }",
      "  - { id: c, component: box, label: C }",
      "",
    ].join("\n");
    expect(codes(lintFigure(text).diagnostics)).toEqual(["component/unknown", "component/unknown"]);
    const three = text.replace(/cloud/g, "box");
    const [warning] = lintFigure(three).diagnostics.filter((d) => d.code === "lint/no-edges");
    expect(warning?.message).toBe("The figure has 3 nodes but no edges.");
  });

  test("missing-glyph lists characters with code points and the font slot", () => {
    const messages = lint("lint/missing-glyph.sumi.yaml").diagnostics.map((d) => d.message);
    expect(messages).toEqual([
      'The label of group "family" has a character missing from the bold font of font set sumi/biz-ud-gothic: "𠮷" (U+20BB7).',
      'The label of node "happy" has a character missing from the regular font of font set sumi/biz-ud-gothic: "😀" (U+1F600).',
      'The label of node "rare" has 2 characters missing from the regular font of font set sumi/biz-ud-gothic: "龘" (U+9F98), "ก" (U+0E01).',
      'The label of edge edges[0] has a character missing from the regular font of font set sumi/biz-ud-gothic: "✅" (U+2705).',
    ]);
  });

  test("literal-newline covers every label, outside math only (#154)", () => {
    const diagnostics = lint("lint/literal-newline.sumi.yaml").diagnostics;
    expect(diagnostics.map((d) => [d.path, d.subject?.id, d.message])).toEqual([
      [
        ["groups", 0, "label"],
        "panel",
        'The label of group "panel" has a literal "\\n" (a backslash and n) outside $...$ math; it is drawn as written, not as a line break.',
      ],
      [
        ["groups", 0, "caption"],
        "panel",
        'The label of the caption of group "panel" has a literal "\\n" (a backslash and n) outside $...$ math; it is drawn as written, not as a line break.',
      ],
      [
        ["nodes", 0, "label"],
        "plain",
        'The label of node "plain" has a literal "\\n" (a backslash and n) outside $...$ math; it is drawn as written, not as a line break.',
      ],
      [
        ["nodes", 3, "props", "entries", 0, "label"],
        "key",
        'The label of the text of entry 1 of legend "key" has a literal "\\n" (a backslash and n) outside $...$ math; it is drawn as written, not as a line break.',
      ],
      [
        ["edges", 0, "label"],
        "edges[0]",
        'The label of edge edges[0] has a literal "\\n" (a backslash and n) outside $...$ math (2 times); it is drawn as written, not as a line break.',
      ],
      [
        ["edges", 1, "label"],
        "edges[1]",
        'The label of edge edges[1] has a literal "\\n" (a backslash and n) outside $...$ math; it is drawn as written, not as a line break.',
      ],
    ]);
    // The hint spells out the label double-quoted, with math backslashes doubled.
    expect(diagnostics[2]?.hint).toBe(
      'In YAML, only a double-quoted string turns \\n into a line break, and every other backslash is doubled: "Scale, Shift\\n$\\\\gamma_1$". A block scalar (|) also breaks lines. If the backslash is meant to be drawn, turn off lint/literal-newline.',
    );
    expect(diagnostics[0]?.hint).toStartWith(
      'In YAML, only a double-quoted string turns \\n into a line break: "Panel\\nA".',
    );
    // The suggested string, read back as YAML, is the label with line breaks.
    const suggested = /: (".*")\. A block/.exec(diagnostics[2]?.hint ?? "")?.[1] ?? "";
    expect(Bun.YAML.parse(`label: ${suggested}`)).toEqual({ label: "Scale, Shift\n$\\gamma_1$" });
    const off = lint("lint/literal-newline.sumi.yaml", {
      config: { rules: { "lint/literal-newline": "off" } },
    });
    expect(off.diagnostics).toEqual([]);
  });

  test("literal-newline: long labels get a short example; auto figures are checked too", () => {
    const figure = (label: string, layout = "") =>
      `version: 1\nfigure: { id: f${layout} }\nnodes:\n  - { id: a, component: box, label: '${label}' }\n`;
    const long = `${"x".repeat(80)}\\n`;
    const [d] = lintFigure(figure(long)).diagnostics.filter(
      (x) => x.code === "lint/literal-newline",
    );
    expect(d?.hint).toContain('backslash is doubled: "first line\\n$\\\\gamma$".');
    expect(d?.location?.column).toBe(38 + 80);
    // auto: D2 draws the label as written, so the literal \n shows there too.
    expect(codes(lintFigure(figure("a\\nb")).diagnostics)).toEqual(["lint/literal-newline"]);
    // Math commands in $...$ are left to component/unsupported-in-auto.
    expect(codes(lintFigure(figure("a $\\nu$")).diagnostics)).toEqual([
      "component/unsupported-in-auto",
    ]);
  });

  test("missing-glyph summarizes long lists", () => {
    const label = [...Array(12)].map((_, i) => String.fromCodePoint(0x1f600 + i)).join("");
    const text = `version: 1\nfigure: { id: many }\nnodes:\n  - { id: a, component: box, label: "${label}" }\n`;
    const [d] = lintFigure(text).diagnostics;
    expect(d?.message).toEndWith('"😉" (U+1F609), and 2 more.');
    expect(d?.message).toContain("has 12 characters missing");
  });

  test("valid built-in fixtures only get label warnings", () => {
    expect(codes(lint("valid/full.sumi.yaml").diagnostics)).toEqual([]);
    expect(new Set(codes(lint("valid/components.sumi.yaml").diagnostics))).toEqual(
      new Set(["lint/empty-label"]),
    );
  });
});

describe("no cascade", () => {
  test("invalid elements produce no lint diagnostics", () => {
    const report = lint("lint/no-cascade.sumi.yaml");
    expect(summarize(report.diagnostics)).toEqual([
      ["component/unknown", "error", 7, 16],
      ["component/unknown", "error", 11, 16],
      ["schema/unknown-field", "error", 17, 5],
      ["ref/unknown-endpoint", "error", 31, 11],
    ]);
    expect(report.exitCode).toBe(1);
  });

  test.each(["invalid/no-cascade.sumi.yaml", "invalid/component-no-cascade.sumi.yaml"])(
    "%s: lint adds nothing for invalid elements",
    (name) => {
      const lintCodes = codes(lint(name).diagnostics).filter((c) => c.startsWith("lint/"));
      // Only the valid part is linted: the unlabeled box "client" and its self-loop.
      const expected = name.includes("component") ? ["lint/empty-label", "lint/self-loop"] : [];
      expect(lintCodes).toEqual(expected);
    },
  );

  test("unreadable documents produce only their errors", () => {
    for (const text of ["", "nodes: [", "version: 1\nfigure: { id: x }\nnodes: 3\n"]) {
      const report = lintFigure(text);
      expect(codes(report.diagnostics).filter((c) => c.startsWith("lint/"))).toEqual([]);
      expect(report.exitCode).toBe(1);
    }
  });
});

describe("config", () => {
  test("rules can be turned off", () => {
    const report = lint("lint/no-edges.sumi.yaml", {
      config: { rules: { "lint/no-edges": "off" } },
    });
    expect(report.diagnostics).toEqual([]);
  });

  test("severity overrides, as a level or an object", () => {
    const asLevel = lint("lint/self-loop.sumi.yaml", {
      config: { rules: { "lint/self-loop": "error" } },
    });
    expect(summarize(asLevel.diagnostics)).toEqual([["lint/self-loop", "error", 9, 5]]);
    expect(asLevel.exitCode).toBe(1);
    const asObject = lint("lint/empty-figure.sumi.yaml", {
      config: { rules: { "lint/empty-figure": { level: "info" } } },
    });
    expect(asObject.diagnostics[0]?.severity).toBe("info");
    expect(asObject.summary).toEqual({ errors: 0, warnings: 0, infos: 1 });
  });

  test("maxWarnings turns too many warnings into a failure", () => {
    const name = "lint/long-label.sumi.yaml";
    expect(lint(name).exitCode).toBe(0);
    expect(lint(name, { config: { maxWarnings: 3 } }).exitCode).toBe(0);
    expect(lint(name, { config: { maxWarnings: 2 } }).exitCode).toBe(1);
    expect(lint("lint/self-loop.sumi.yaml", { config: { maxWarnings: 0 } }).exitCode).toBe(0);
  });

  test("defaults: every built-in rule enabled with its default severity", () => {
    const { rules, maxWarnings } = resolveLintConfig();
    expect(rules.map((r) => [r.rule.id, r.severity])).toEqual(
      ALL_LINT_RULES.map((r) => [r.id, r.defaultSeverity]),
    );
    // Structural rules first, then the geometry rules (#13).
    expect(ALL_LINT_RULES.slice(0, BUILTIN_LINT_RULES.length)).toEqual([...BUILTIN_LINT_RULES]);
    expect(
      ALL_LINT_RULES.slice(BUILTIN_LINT_RULES.length).every((r) => r.id.startsWith("geometry/")),
    ).toBe(true);
    expect(maxWarnings).toBeUndefined();
    expect(rules.find((r) => r.rule.id === "lint/long-label")?.options).toEqual({
      maxLineWidth: 40,
      maxLines: 4,
    });
  });

  test.each<[unknown, string[]]>([
    [
      { rules: { "lint/no-edge": "off" } },
      ['Unknown lint rule "lint/no-edge". Did you mean "lint/no-edges"?'],
    ],
    [
      { rules: { "lint/no-edges": { options: { x: 1 } } } },
      ["Rule lint/no-edges takes no options."],
    ],
    [
      { rules: { "lint/long-label": { options: { maxLines: 0 } } } },
      ["lint/long-label options.maxLines: Too small: expected number to be >0."],
    ],
    [{ rules: { "lint/no-edges": "loud" } }, ["rules.lint/no-edges: Invalid input."]],
    [{ maxWarnings: -1 }, ["maxWarnings: Too small: expected number to be >=0."]],
    [{ colour: 1 }, ['(config): Unrecognized key: "colour".']],
  ])("invalid config %j", (config, problems) => {
    let error: unknown;
    try {
      resolveLintConfig(config);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(LintConfigError);
    expect((error as LintConfigError).problems).toEqual(problems);
    expect(() => lintFigure(read("lint/clean.sumi.yaml"), { config: config as never })).toThrow(
      LintConfigError,
    );
  });

  test("custom rules run with their options", () => {
    const rule = defineRule({
      id: "lint/test-rule",
      description: "Reports every node.",
      defaultSeverity: "info",
      fixable: false,
      options: z.strictObject({ prefix: z.string().default("node") }),
      run(context, { prefix }) {
        return context.elements
          .filter((e) => e.kind === "node")
          .map((e) => ({ message: `${prefix} ${e.subject.id}`, path: e.path }));
      },
    });
    const report = lint("lint/no-edges.sumi.yaml", {
      rules: [rule],
      config: { rules: { "lint/test-rule": { options: { prefix: "found" } } } },
    });
    expect(report.diagnostics.map((d) => [d.code, d.message, d.location?.line])).toEqual([
      ["lint/test-rule", "found a", 5],
      ["lint/test-rule", "found b", 8],
    ]);
  });
});

describe("report", () => {
  test("exit codes", () => {
    expect(LINT_EXIT_CODES).toEqual({ ok: 0, failed: 1, usage: 2 });
    expect(lint("lint/missing-glyph.sumi.yaml").exitCode).toBe(0);
    expect(lint("invalid/ref-duplicate-id.sumi.yaml").exitCode).toBe(1);
  });

  test("diagnostics are sorted by location, then code", () => {
    const at = (line: number, column: number, code: string, file?: string): Diagnostic => ({
      code,
      severity: "warning",
      message: "m",
      location: { ...(file !== undefined && { file }), line, column },
    });
    const unsorted = [
      at(2, 1, "lint/b"),
      at(1, 5, "lint/a"),
      at(2, 1, "lint/a"),
      { code: "theme/x", severity: "error", message: "m" } satisfies Diagnostic,
      at(1, 1, "lint/a", "b.yaml"),
    ];
    expect(unsorted.sort(compareDiagnostics).map((d) => [d.location?.line, d.code])).toEqual([
      [undefined, "theme/x"],
      [1, "lint/a"],
      [2, "lint/a"],
      [2, "lint/b"],
      [1, "lint/a"],
    ]);
  });

  test("results are deterministic", () => {
    const name = "invalid/component-no-cascade.sumi.yaml";
    expect(formatLintJson(lint(name))).toBe(formatLintJson(lint(name)));
  });

  test("the JSON envelope", () => {
    const json = toLintJson(lint("lint/self-loop.sumi.yaml"));
    expect(json.version).toBe(1);
    expect(json.file).toBe("lint/self-loop.sumi.yaml");
    expect(json.summary).toEqual({ errors: 0, warnings: 0, infos: 1 });
    expect(toLintJson(lintFigure(read("lint/clean.sumi.yaml"))).file).toBeNull();
    expect(JSON.parse(formatLintJson(lint("lint/self-loop.sumi.yaml")))).toEqual(json);
  });

  const goldenCases: [name: string, file: string | undefined][] = [
    ["lint/ancestor-edge.sumi.yaml", "lint/ancestor-edge.sumi.yaml"],
    ["lint/no-cascade.sumi.yaml", "lint/no-cascade.sumi.yaml"],
    ["lint/clean.sumi.yaml", undefined],
  ];
  for (const [name, file] of goldenCases) {
    const base = `${goldens}/${name.replace(/^lint\//, "").replace(/\.sumi\.yaml$/, "")}`;
    for (const [ext, format] of [
      ["txt", formatLintText],
      ["json", formatLintJson],
    ] as const) {
      test(`golden ${ext}: ${name}`, async () => {
        const report = lintFigure(read(name), file === undefined ? {} : { file });
        const output = format(report);
        if (update) await Bun.write(`${base}.${ext}`, output);
        expect(output).toBe(await Bun.file(`${base}.${ext}`).text());
      });
    }
  }
});
