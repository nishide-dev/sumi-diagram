import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { formatFigureSource } from "./format";
import { parseYaml } from "./yaml";

const ROOT = join(import.meta.dir, "..", "..", "..");
const FIXTURES = join(ROOT, "tests", "fixtures", "figures");

function format(text: string, canonicalOrder = false): string {
  const result = formatFigureSource(text, { canonicalOrder });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.text;
}

const sources = [
  ...["valid", "lint", "invalid", "layout"].flatMap((dir) =>
    readdirSync(join(FIXTURES, dir))
      .filter((name) => name.endsWith(".sumi.yaml"))
      .map((name) => join(FIXTURES, dir, name)),
  ),
  join(ROOT, "examples", "pipeline", "pipeline.sumi.yaml"),
  join(ROOT, "examples", "decision-flow", "decision-flow.sumi.yaml"),
];

describe("formatFigureSource", () => {
  test("is idempotent and keeps the data of every fixture and example", () => {
    let formatted = 0;
    for (const file of sources) {
      const text = readFileSync(file, "utf8");
      for (const canonicalOrder of [false, true]) {
        const result = formatFigureSource(text, { canonicalOrder });
        if (!result.ok) {
          expect(result.diagnostics.every((d) => d.code.startsWith("yaml/"))).toBe(true);
          continue;
        }
        formatted++;
        expect(format(result.text, canonicalOrder)).toBe(result.text);
        expect(parseYaml(result.text).source?.value).toEqual(parseYaml(text).source?.value);
      }
    }
    expect(formatted).toBeGreaterThan(40);
  });

  test("leaves the committed examples unchanged", () => {
    for (const file of sources.filter((f) => f.includes("examples"))) {
      const text = readFileSync(file, "utf8");
      expect(format(text)).toBe(text);
    }
  });

  test("normalizes indentation, spacing, line endings and blank lines", () => {
    const input = [
      "version:   1\r",
      "figure:\r",
      "    id: x     # trailing\r",
      "    layout: {direction: down}\r",
      "\r",
      "\r",
      "\r",
      "nodes:\r",
      "- id: a\r",
      "  component: box   \r",
      "  props: {width: 10mm}\r",
      "edges: [{from: a, to: a}]\r",
      "",
    ].join("\n");
    expect(format(input)).toBe(
      [
        "version: 1",
        "figure:",
        "  id: x # trailing",
        "  layout: { direction: down }",
        "",
        "nodes:",
        "  - id: a",
        "    component: box",
        "    props: { width: 10mm }",
        "edges: [ { from: a, to: a } ]",
        "",
      ].join("\n"),
    );
  });

  test("keeps every comment, quoting style and block scalar", () => {
    const input = `# header

version: 1 # v
figure:
  id: x
  # the title
  title: 'single'
nodes:
  # first node
  - id: a
    component: box
    label: "tab\\tand \\u0085 escapes"
  - id: b
    component: box
    label: |
      two
      lines
# trailing comment
`;
    const output = format(input);
    for (const comment of [
      "# header",
      "# v",
      "# the title",
      "# first node",
      "# trailing comment",
    ]) {
      expect(output).toContain(comment);
    }
    expect(output).toContain("title: 'single'");
    expect(output).toContain('label: "tab\\tand \\u0085 escapes"');
    expect(output).toContain("label: |\n      two\n      lines\n");
    expect(format(output)).toBe(output);
  });

  test("keeps the meaning of explicitly tagged scalars", () => {
    const input = [
      "version: 1",
      "metadata:",
      '  count: !!int "123"',
      "  ratio: !!float '1.5'",
      '  flag: !!bool "true"',
      "  text: !!str 123",
      '  quoted: !!str "x\\ty"',
      "  plain: !!int 7",
      "",
    ].join("\n");
    const output = format(input);
    expect(parseYaml(output).source?.value).toEqual({
      version: 1,
      metadata: { count: 123, ratio: 1.5, flag: true, text: "123", quoted: "x\ty", plain: 7 },
    });
    expect(output).toContain("count: !!int 123\n");
    expect(output).toContain(`text: !!str "123"`);
    expect(format(output)).toBe(output);
  });

  test("does not fold long lines", () => {
    const label = Array.from({ length: 30 }, () => "word").join(" ");
    const input = `version: 1\nfigure:\n  id: x\n  title: ${label}\n`;
    expect(format(input)).toBe(input);
  });

  test("keeps key order by default and puts known keys in schema order with canonicalOrder", () => {
    const input = `# file header
figure:
  title: T
  id: x
nodes:
  - label: A # the label
    custom: 1
    # the component
    component: box
    id: a
    props: { width: 10mm, height: 5mm }
version: 1
`;
    expect(format(input)).toBe(input);
    expect(format(input, true)).toBe(`# file header
version: 1
figure:
  id: x
  title: T
nodes:
  - id: a
    # the component
    component: box
    label: A # the label
    props: { width: 10mm, height: 5mm }
    custom: 1
`);
  });

  test("puts structured layout fields in schema order with canonicalOrder", () => {
    const input = `version: 1
figure:
  id: x
  layout:
    arrange:
      row:
        items:
          - stack: { items: [a], align: stretch, gap: 0, direction: up }
          - g
        gap: 3mm
    engine: structured
groups:
  - arrange: { stack: { items: [b], direction: down } }
    id: g
nodes:
  - { id: a, component: box }
  - { component: box, id: b }
  - { attach: { gap: 1mm, side: west, to: a }, id: c, component: box }
edges:
  - { toAnchor: south, to: b, fromAnchor: "north:0.25", from: a }
`;
    expect(format(input, true)).toBe(`version: 1
figure:
  id: x
  layout:
    engine: structured
    arrange:
      row:
        gap: 3mm
        items:
          - stack: { direction: up, gap: 0, align: stretch, items: [ a ] }
          - g
groups:
  - id: g
    arrange: { stack: { direction: down, items: [ b ] } }
nodes:
  - { id: a, component: box }
  - { id: b, component: box }
  - { id: c, component: box, attach: { to: a, side: west, gap: 1mm } }
edges:
  - { from: a, fromAnchor: "north:0.25", to: b, toAnchor: south }
`);
  });

  test("keeps comment-only and empty documents", () => {
    expect(format("")).toBe("");
    expect(format("# only a comment   \n\n\n# another\n")).toBe("# only a comment\n\n# another\n");
  });

  test("refuses input with YAML errors and reports them", () => {
    for (const [text, code] of [
      ["a: [1, 2\n", "yaml/syntax"],
      ["a: 1\na: 2\n", "yaml/duplicate-key"],
      ["a: &x 1\nb: *x\n", "yaml/alias-not-allowed"],
      ["a: 1\n---\nb: 2\n", "yaml/multiple-documents"],
    ] as const) {
      const result = formatFigureSource(text, { file: "f.sumi.yaml" });
      expect(result.ok).toBe(false);
      expect(result.diagnostics.map((d) => d.code)).toContain(code);
      expect(result.diagnostics[0]?.location?.file).toBe("f.sumi.yaml");
    }
  });

  test("formats documents with schema errors", () => {
    const result = formatFigureSource("version: 2\nfigure: {id: Bad}\n");
    expect(result).toEqual({
      ok: true,
      text: "version: 2\nfigure: { id: Bad }\n",
      changed: true,
      diagnostics: [],
    });
  });
});
