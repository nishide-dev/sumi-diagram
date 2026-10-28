import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { compileFigure } from "../../compiler/compile";
import { lintRenderedFigure } from "../../lint/geometry";
import { lintFigure } from "../../lint/lint";
import { checkFigure } from "../check";
import type { Diagnostic, DocPath } from "../diagnostics";
import { checkFigureSource, parseFigure } from "./check";
import { parseAnchor } from "./layout";

const ROOT = join(import.meta.dir, "..", "..", "..");

type Summary = [code: string, path: DocPath | undefined, line: number, column: number];

function summarize(diagnostics: readonly Diagnostic[]): Summary[] {
  return diagnostics.map((d) => [d.code, d.path, d.location?.line ?? 0, d.location?.column ?? 0]);
}

/** Diagnostics of the yaml / schema / ref / layout stages. */
function check(text: string): Summary[] {
  return summarize(checkFigureSource(text).state.diagnostics);
}

function figure(body: string): string {
  return `version: 1\nfigure:\n  id: f\n${body}`;
}

describe("engine", () => {
  test("is auto without figure.layout.arrange, also when other fields are given", () => {
    const parsed = parseFigure(figure("nodes:\n  - { id: a, component: box }\n"));
    expect(parsed.ok && parsed.value.figure.layout).toEqual({ engine: "auto", direction: "right" });
  });

  test("is inferred as structured from figure.layout.arrange", () => {
    const parsed = parseFigure(
      figure(
        "  layout:\n    arrange: { stack: { items: [a] } }\nnodes:\n  - { id: a, component: box }\n",
      ),
    );
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.ok && parsed.value.figure.layout).toEqual({
      engine: "structured",
      direction: "right",
      arrange: { stack: { direction: "down", items: ["a"] } },
    });
  });

  test("can be written explicitly", () => {
    const parsed = parseFigure(
      figure(
        "  layout:\n    engine: structured\n    arrange: { row: { gap: 3mm, items: [a] } }\nnodes:\n  - { id: a, component: box }\n",
      ),
    );
    expect(parsed.ok && parsed.value.figure.layout.engine).toBe("structured");
    expect(parsed.ok && parsed.value.figure.layout.arrange?.row?.gap).toBeCloseTo(
      (3 * 72) / 25.4,
      9,
    );
  });

  test("explicit structured without arrange leaves every root element unplaced", () => {
    const text = figure(
      "  layout:\n    engine: structured\nnodes:\n  - { id: a, component: box }\n",
    );
    expect(check(text)).toEqual([["layout/unplaced", ["nodes", 0, "id"], 7, 11]]);
    const [d] = checkFigureSource(text).state.diagnostics;
    expect(d?.hint).toBe(
      'Add "a" to the items of figure.layout.arrange, or place it beside another element with attach.',
    );
  });
});

describe("layout/structured-only", () => {
  test("explicit auto with figure.layout.arrange", () => {
    const text = figure(
      "  layout:\n    engine: auto\n    arrange: { stack: { items: [a] } }\nnodes:\n  - { id: a, component: box }\n",
    );
    expect(check(text)).toEqual([
      ["layout/structured-only", ["figure", "layout", "arrange"], 6, 5],
    ]);
  });

  test("structured-only fields of elements without figure.layout.arrange", () => {
    const text = figure(
      [
        "groups:",
        "  - { id: g, arrange: { stack: { items: [a] } } }",
        "nodes:",
        "  - { id: a, component: box, group: g }",
        "  - { id: b, component: box, attach: { to: a, side: west } }",
        "edges:",
        "  - { from: a, fromAnchor: north, to: b, toAnchor: south }",
        "",
      ].join("\n"),
    );
    expect(check(text)).toEqual([
      ["layout/structured-only", ["groups", 0, "arrange"], 5, 14],
      ["layout/structured-only", ["nodes", 1, "attach"], 8, 30],
      ["layout/structured-only", ["edges", 0, "fromAnchor"], 10, 16],
      ["layout/structured-only", ["edges", 0, "toAnchor"], 10, 42],
    ]);
    const { state } = checkFigureSource(text);
    expect(state.diagnostics[0]?.message).toBe(
      '"arrange" needs the structured layout engine, but this figure uses the auto engine.',
    );
    // The element with the field is invalid, and so are its dependents.
    expect([...state.invalid].sort()).toEqual(["e:#0", "g:g", "n:a", "n:b"]);
  });

  test("edge labelAt and labelSide (#128)", () => {
    const text = figure(
      [
        "nodes:",
        "  - { id: a, component: box }",
        "edges:",
        "  - { from: a, to: a, label: x, labelAt: start, labelSide: left }",
        "  - { from: a, to: a, label: y, labelSide: right }",
        "",
      ].join("\n"),
    );
    expect(check(text)).toEqual([
      ["layout/structured-only", ["edges", 0, "labelAt"], 7, 33],
      ["layout/structured-only", ["edges", 0, "labelSide"], 7, 49],
      ["layout/structured-only", ["edges", 1, "labelSide"], 8, 33],
    ]);
    const { state } = checkFigureSource(text);
    expect(state.diagnostics[0]?.message).toBe(
      '"labelAt" needs the structured layout engine, but this figure uses the auto engine.',
    );
    expect([...state.invalid].sort()).toEqual(["e:#0", "e:#1"]);
  });

  test("node labelRotation (#178)", () => {
    const text = figure(
      [
        "nodes:",
        "  - { id: a, component: box, label: Encoder, labelRotation: -90 }",
        "  - { id: b, component: label, label: Query, labelRotation: 90 }",
        "",
      ].join("\n"),
    );
    expect(check(text)).toEqual([
      ["layout/structured-only", ["nodes", 0, "labelRotation"], 5, 46],
      ["layout/structured-only", ["nodes", 1, "labelRotation"], 6, 46],
    ]);
    const { state } = checkFigureSource(text);
    expect(state.diagnostics[0]?.message).toBe(
      '"labelRotation" needs the structured layout engine, but this figure uses the auto engine.',
    );
    expect([...state.invalid].sort()).toEqual(["n:a", "n:b"]);
  });

  test("node sublabel (#184)", () => {
    const text = figure(
      ["nodes:", '  - { id: a, component: box, label: Noise, sublabel: "32 × 32 × 4" }', ""].join(
        "\n",
      ),
    );
    expect(check(text)).toEqual([["layout/structured-only", ["nodes", 0, "sublabel"], 5, 44]]);
    const { state } = checkFigureSource(text);
    expect(state.diagnostics[0]?.message).toBe(
      '"sublabel" needs the structured layout engine, but this figure uses the auto engine.',
    );
    expect([...state.invalid]).toEqual(["n:a"]);
  });

  test("sublabel must have visible text (#184)", () => {
    for (const value of ['""', '"  "', "3", "[a]"]) {
      const text = figure(
        `  layout:\n    arrange: { stack: { items: [a] } }\nnodes:\n  - { id: a, component: box, label: A, sublabel: ${value} }\n`,
      );
      const found = check(text).map(([code, path]) => [code, path]);
      expect(found).toHaveLength(1);
      expect(found[0]?.[1]).toEqual(["nodes", 0, "sublabel"]);
    }
  });

  test("labelRotation accepts only 90 and -90 (#178)", () => {
    for (const value of ["45", "180", "0", '"90"']) {
      const text = figure(
        `  layout:\n    arrange: { stack: { items: [a] } }\nnodes:\n  - { id: a, component: box, label: A, labelRotation: ${value} }\n`,
      );
      expect(check(text).map(([code, path]) => [code, path])).toEqual([
        ["schema/invalid-value", ["nodes", 0, "labelRotation"]],
      ]);
    }
  });

  test("figure.layout.fanIn (#134), with either value", () => {
    for (const value of ["merge", "spread"]) {
      const text = figure(
        `  layout:\n    fanIn: ${value}\nnodes:\n  - { id: a, component: box }\n`,
      );
      expect(check(text)).toEqual([
        ["layout/structured-only", ["figure", "layout", "fanIn"], 5, 5],
      ]);
      expect(checkFigureSource(text).state.diagnostics[0]?.message).toBe(
        '"fanIn" needs the structured layout engine, but this figure uses the auto engine.',
      );
    }
  });
});

describe("figure.layout.fanIn (#134)", () => {
  const structured = (fanIn: string) =>
    figure(
      `  layout:\n    fanIn: ${fanIn}\n    arrange: { stack: { items: [a] } }\nnodes:\n  - { id: a, component: box }\n`,
    );

  test("is kept as written, and absent when omitted", () => {
    const parsed = parseFigure(structured("spread"));
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.ok && parsed.value.figure.layout.fanIn).toBe("spread");
    const omitted = parseFigure(
      figure(
        "  layout:\n    arrange: { stack: { items: [a] } }\nnodes:\n  - { id: a, component: box }\n",
      ),
    );
    expect(omitted.ok && "fanIn" in omitted.value.figure.layout).toBe(false);
    const compiled = compileFigure(structured("spread"));
    expect(compiled.ok && compiled.value.ir.meta.fanIn).toBe("spread");
  });

  test("an unknown value is a positioned schema error naming the values", () => {
    const text = structured("fan");
    expect(check(text)).toEqual([["schema/invalid-value", ["figure", "layout", "fanIn"], 5, 12]]);
    const [d] = checkFigureSource(text).state.diagnostics;
    expect(d?.message).toContain('"merge"');
    expect(d?.message).toContain('"spread"');
  });
});

describe("figure.layout.density (#182)", () => {
  const structured = (density: string) =>
    figure(
      `  layout:\n    density: ${density}\n    arrange: { stack: { items: [a] } }\nnodes:\n  - { id: a, component: box }\n`,
    );

  test("is kept as written, and absent when omitted", () => {
    const parsed = parseFigure(structured("compact"));
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.ok && parsed.value.figure.layout.density).toBe("compact");
    const omitted = parseFigure(
      figure(
        "  layout:\n    arrange: { stack: { items: [a] } }\nnodes:\n  - { id: a, component: box }\n",
      ),
    );
    expect(omitted.ok && "density" in omitted.value.figure.layout).toBe(false);
    const compiled = compileFigure(structured("compact"));
    expect(compiled.ok && compiled.value.ir.meta.density).toBe("compact");
    const normal = compileFigure(structured("normal"));
    expect(normal.ok && normal.value.ir.meta.density).toBe("normal");
  });

  test("an unknown value is a positioned schema error naming the values", () => {
    const text = structured("tight");
    expect(check(text)).toEqual([["schema/invalid-value", ["figure", "layout", "density"], 5, 14]]);
    const [d] = checkFigureSource(text).state.diagnostics;
    expect(d?.message).toContain('"normal"');
    expect(d?.message).toContain('"compact"');
  });

  test("needs the structured engine, with either value", () => {
    for (const value of ["normal", "compact"]) {
      const text = figure(
        `  layout:\n    density: ${value}\nnodes:\n  - { id: a, component: box }\n`,
      );
      expect(check(text)).toEqual([
        ["layout/structured-only", ["figure", "layout", "density"], 5, 5],
      ]);
    }
  });
});

describe("placement", () => {
  const base = (arrange: string, rest: string) =>
    figure(`  layout:\n    arrange: ${arrange}\n${rest}`);

  test("layout/unknown-item with a near match, or a note for edge IDs", () => {
    const text = base(
      "{ stack: { items: [alpha, alpah, link] } }",
      "nodes:\n  - { id: alpha, component: box }\nedges:\n  - { id: link, from: alpha, to: alpha }\n",
    );
    expect(check(text)).toEqual([
      ["layout/unknown-item", ["figure", "layout", "arrange", "stack", "items", 1], 5, 40],
      ["layout/unknown-item", ["figure", "layout", "arrange", "stack", "items", 2], 5, 47],
    ]);
    const [typo, edge] = checkFigureSource(text).state.diagnostics;
    expect(typo?.hint).toBe('Did you mean "alpha"?');
    expect(typo?.subject).toEqual({ kind: "figure", id: "f" });
    expect(edge?.hint).toBe('"link" is an edge; only nodes and groups are placed.');
  });

  test("layout/unknown-attach-target", () => {
    const text = base(
      "{ stack: { items: [a] } }",
      "nodes:\n  - { id: a, component: box }\n  - { id: b, component: box, attach: { to: aa, side: east } }\n",
    );
    expect(check(text)).toEqual([
      ["layout/unknown-attach-target", ["nodes", 1, "attach", "to"], 8, 44],
    ]);
  });

  test("layout/duplicate-placement in two trees, and arranged and attached", () => {
    const text = base(
      "{ row: { items: [a, g, a] } }",
      [
        "groups:",
        "  - { id: g, arrange: { stack: { items: [b, c] } } }",
        "nodes:",
        "  - { id: a, component: box }",
        "  - { id: b, component: box }",
        "  - { id: c, component: box, attach: { to: a, side: west } }",
        "",
      ].join("\n"),
    );
    expect(check(text)).toEqual([
      ["layout/duplicate-placement", ["figure", "layout", "arrange", "row", "items", 2], 5, 37],
      ["layout/duplicate-placement", ["nodes", 2, "attach"], 11, 30],
    ]);
    const [twice, attached] = checkFigureSource(text).state.diagnostics;
    expect(twice?.message).toBe(
      '"a" is placed more than once: in figure.layout.arrange and in figure.layout.arrange.',
    );
    expect(twice?.related?.[0]).toMatchObject({ message: "First placed here." });
    expect(twice?.related?.[0]?.location).toMatchObject({ line: 5, column: 31 });
    expect(attached?.message).toBe(
      '"c" is placed more than once: in the arrange of group "g" and attached to "a".',
    );
  });

  test("layout/unplaced for root elements and group children", () => {
    const text = base(
      "{ stack: { items: [g] } }",
      [
        "groups:",
        "  - { id: g, arrange: { stack: { items: [a] } } }",
        "  - { id: h, group: g }",
        "nodes:",
        "  - { id: a, component: box }",
        "  - { id: b, component: box, group: g }",
        "  - { id: c, component: box, group: h }",
        "  - { id: d, component: box }",
        "",
      ].join("\n"),
    );
    expect(check(text)).toEqual([
      ["layout/unplaced", ["groups", 1, "id"], 8, 11],
      ["layout/unplaced", ["nodes", 1, "id"], 11, 11],
      ["layout/unplaced", ["nodes", 3, "id"], 13, 11],
    ]);
    const hints = checkFigureSource(text).state.diagnostics.map((d) => d.hint);
    expect(hints).toEqual([
      'Add "h" to the items of the arrange of group "g".',
      'Add "b" to the items of the arrange of group "g", or place it beside another element with attach.',
      'Add "d" to the items of figure.layout.arrange, or place it beside another element with attach.',
    ]);
    // "c" is inside the unplaced group "h": invalid, but not reported again.
    expect(checkFigureSource(text).state.invalid.has("n:c")).toBe(true);
  });

  test("layout/unplaced hint for a group without arrange", () => {
    const text = base(
      "{ stack: { items: [g] } }",
      "groups:\n  - { id: g }\nnodes:\n  - { id: a, component: box, group: g }\n",
    );
    expect(check(text)).toEqual([["layout/unplaced", ["nodes", 0, "id"], 9, 11]]);
    expect(checkFigureSource(text).state.diagnostics[0]?.hint).toBe(
      'Group "g" has no arrange; add one that lists "a", or place it beside another element with attach.',
    );
  });

  test("layout/group-mismatch between group: and the arrange tree or attach target", () => {
    const text = base(
      "{ row: { items: [g, h, x] } }",
      [
        "groups:",
        "  - { id: g, arrange: { stack: { items: [a] } } }",
        "  - { id: h, arrange: { stack: { items: [b] } } }",
        "nodes:",
        "  - { id: a, component: box, group: h }",
        "  - { id: b, component: box, group: h }",
        "  - { id: x, component: box, group: g }",
        "  - { id: y, component: box, group: g, attach: { to: b, side: east } }",
        "",
      ].join("\n"),
    );
    expect(check(text)).toEqual([
      ["layout/group-mismatch", ["figure", "layout", "arrange", "row", "items", 2], 5, 37],
      ["layout/group-mismatch", ["groups", 0, "arrange", "stack", "items", 0], 7, 42],
      ["layout/group-mismatch", ["nodes", 3, "attach", "to"], 13, 54],
    ]);
    const diagnostics = checkFigureSource(text).state.diagnostics;
    expect(diagnostics.map((d) => d.message)).toEqual([
      'Node "x" has group "g" but is listed in figure.layout.arrange.',
      'Node "a" has group "h" but is listed in the arrange of group "g".',
      'Node "y" has group "g" but is attached to "b", which is in group "h".',
    ]);
    expect(diagnostics[0]?.related?.[0]?.location).toMatchObject({ line: 12, column: 37 });
  });

  test("arrange items and attach imply group membership when group: is omitted", () => {
    const parsed = parseFigure(
      base(
        "{ row: { items: [g, n] } }",
        [
          "groups:",
          "  - { id: g, arrange: { stack: { items: [a, h] } } }",
          "  - { id: h, arrange: { stack: { items: [b] } } }",
          "nodes:",
          "  - { id: a, component: box }",
          "  - { id: b, component: box, group: h }",
          "  - { id: c, component: label, label: C, attach: { to: b, side: east } }",
          "  - { id: n, component: box }",
          "  - { id: m, component: label, label: M, attach: { to: g, side: west, gap: 2mm } }",
          "",
        ].join("\n"),
      ),
    );
    expect(parsed.diagnostics).toEqual([]);
    if (!parsed.ok) throw new Error("expected ok");
    const groupOf = (id: string) =>
      [...parsed.value.groups, ...parsed.value.nodes].find((e) => e.id === id)?.group;
    expect(["g", "h", "a", "b", "c", "n", "m"].map(groupOf)).toEqual([
      undefined,
      "g",
      "g",
      "h",
      "h",
      undefined,
      undefined,
    ]);
  });

  test("layout/group-cycle through arrange trees", () => {
    const text = base(
      "{ row: { items: [n] } }",
      [
        "groups:",
        "  - { id: g, arrange: { stack: { items: [h] } } }",
        "  - { id: h, arrange: { stack: { items: [g] } } }",
        "nodes:",
        "  - { id: n, component: box }",
        "",
      ].join("\n"),
    );
    expect(check(text)).toEqual([
      ["layout/group-cycle", ["groups", 0, "arrange", "stack", "items", 0], 7, 42],
    ]);
    expect(checkFigureSource(text).state.diagnostics[0]?.message).toBe(
      'Group "h" is nested inside itself through arrange: h → g → h.',
    );
  });

  test("a group listed in its own arrange is a cycle", () => {
    const text = base(
      "{ row: { items: [n] } }",
      "groups:\n  - { id: g, arrange: { stack: { items: [g] } } }\nnodes:\n  - { id: n, component: box }\n",
    );
    expect(check(text)).toEqual([
      ["layout/group-cycle", ["groups", 0, "arrange", "stack", "items", 0], 7, 42],
    ]);
  });

  test("layout/attach-cycle for self and longer cycles; dependents are invalid", () => {
    const text = base(
      "{ row: { items: [n] } }",
      [
        "nodes:",
        "  - { id: n, component: box }",
        "  - { id: s, component: box, attach: { to: s, side: east } }",
        "  - { id: a, component: box, attach: { to: b, side: east } }",
        "  - { id: b, component: box, attach: { to: a, side: west } }",
        "  - { id: c, component: box, attach: { to: a, side: north } }",
        "",
      ].join("\n"),
    );
    expect(check(text)).toEqual([
      ["layout/attach-cycle", ["nodes", 1, "attach", "to"], 8, 44],
      ["layout/attach-cycle", ["nodes", 2, "attach", "to"], 9, 44],
    ]);
    const { state } = checkFigureSource(text);
    expect(state.diagnostics[1]?.message).toBe('Node "a" is attached to itself through a → b → a.');
    expect(state.diagnostics[1]?.related?.map((r) => r.location?.line)).toEqual([10]);
    expect(["n:s", "n:a", "n:b", "n:c"].every((k) => state.invalid.has(k as never))).toBe(true);
    expect(state.invalid.has("n:n")).toBe(false);
  });
});

describe("invalid elements and dependents", () => {
  const structured = (rest: string, arrange = "{ row: { items: [a] } }") =>
    figure(`  layout:\n    engine: structured\n    arrange: ${arrange}\n${rest}`);
  const codes = (text: string) => check(text).map(([code, path]) => [code, path]);
  const invalidOf = (text: string) => [...checkFigureSource(text).state.invalid].sort();

  test("an element invalid before the stage gets no layout diagnostics", () => {
    const text = structured(
      [
        "nodes:",
        "  - { id: a, component: box, colour: red, attach: { to: zz, side: east } }",
        "edges:",
        "  - { from: nope, to: a, toAnchor: top }",
        "",
      ].join("\n"),
    );
    expect(codes(text)).toEqual([
      ["schema/unknown-field", ["nodes", 0, "colour"]],
      ["ref/unknown-endpoint", ["edges", 0, "from"]],
    ]);
  });

  test("the tree of an invalid group is not checked, but its items count as placed", () => {
    const text = structured(
      [
        "groups:",
        "  - { id: g, colour: red, arrange: { stack: { items: [b, zz] } } }",
        "nodes:",
        "  - { id: b, component: box }",
        "",
      ].join("\n"),
      "{ row: { items: [g] } }",
    );
    expect(codes(text)).toEqual([["schema/unknown-field", ["groups", 0, "colour"]]]);
    // "b" is a child of the invalid group, so invalid itself.
    expect(invalidOf(text)).toEqual(["g:g", "n:b"]);
  });

  test("duplicate group IDs with different trees report only the duplicate", () => {
    const text = structured(
      [
        "groups:",
        "  - { id: g, arrange: { stack: { items: [b] } } }",
        "  - { id: g, arrange: { stack: { items: [b, c] } } }",
        "nodes:",
        "  - { id: b, component: box }",
        "  - { id: c, component: box }",
        "",
      ].join("\n"),
      "{ row: { items: [g] } }",
    );
    expect(codes(text)).toEqual([["ref/duplicate-id", ["groups", 1, "id"]]]);
    expect(invalidOf(text)).toEqual(["g:g", "n:b", "n:c"]);
  });

  test("a node attached to an unplaced element is invalid, and so are its edges", () => {
    const text = figure(
      [
        "  layout: { engine: structured }",
        "nodes:",
        "  - { id: a, component: box, label: A }",
        "  - { id: b, component: box, label: B, attach: { to: a, side: east } }",
        "edges:",
        "  - { from: b, to: b }",
        "",
      ].join("\n"),
    );
    expect(codes(text)).toEqual([["layout/unplaced", ["nodes", 0, "id"]]]);
    expect(invalidOf(text)).toEqual(["e:#0", "n:a", "n:b"]);
    expect(lintFigure(text).diagnostics.map((d) => d.code)).toEqual(["layout/unplaced"]);
  });

  test("a node attached to an element invalid in a later stage is invalid too", () => {
    const text = structured(
      [
        "nodes:",
        "  - { id: a, component: no-such-component }",
        "  - { id: b, component: box, label: B, attach: { to: a, side: east } }",
        "edges:",
        "  - { from: b, to: b }",
        "",
      ].join("\n"),
    );
    const { state } = checkFigure(text);
    expect(state.diagnostics.map((d) => d.code)).toEqual(["component/unknown"]);
    expect([...state.invalid].sort()).toEqual(["e:#0", "n:a", "n:b"]);
  });

  test("a mismatch is not repeated for nodes attached to the mismatched one", () => {
    const text = figure(
      [
        "  layout:",
        "    arrange: { row: { items: [g, a] } }",
        "groups:",
        "  - { id: g }",
        "nodes:",
        "  - { id: a, component: box, group: g }",
        "  - { id: b, component: box, group: g, attach: { to: a, side: east } }",
        "  - { id: c, component: box, group: g, attach: { to: b, side: east } }",
        "",
      ].join("\n"),
    );
    expect(codes(text)).toEqual([
      ["layout/group-mismatch", ["figure", "layout", "arrange", "row", "items", 1]],
    ]);
    expect(invalidOf(text)).toEqual(["n:a", "n:b", "n:c"]);
  });

  test("every placement after the first is reported", () => {
    const text = structured(
      "nodes:\n  - { id: a, component: box }\n",
      "{ row: { items: [a, a, a] } }",
    );
    expect(codes(text)).toEqual([
      ["layout/duplicate-placement", ["figure", "layout", "arrange", "row", "items", 1]],
      ["layout/duplicate-placement", ["figure", "layout", "arrange", "row", "items", 2]],
    ]);
  });

  test("an attach chain to an unknown target is reported once", () => {
    const text = structured(
      [
        "groups:",
        "  - { id: g, arrange: { stack: { items: [x] } } }",
        "nodes:",
        "  - { id: a, component: box, group: g, attach: { to: b, side: east } }",
        "  - { id: b, component: box, attach: { to: c, side: east } }",
        "  - { id: c, component: box, attach: { to: missing, side: east } }",
        "  - { id: x, component: box }",
        "",
      ].join("\n"),
      "{ row: { items: [g] } }",
    );
    expect(codes(text)).toEqual([["layout/unknown-attach-target", ["nodes", 2, "attach", "to"]]]);
    expect(invalidOf(text)).toEqual(["n:a", "n:b", "n:c"]);
  });

  test("an attach target in an unreadable collection invalidates the node silently", () => {
    for (const broken of ["groups: 3\nnodes:", "nodes: 3\ngroups: []\nextra:"]) {
      const text = figure(
        `  layout: { engine: structured }\n${broken}\n  - { id: b, component: box, attach: { to: a, side: east } }\n`,
      );
      const { state } = checkFigureSource(text);
      expect(state.diagnostics.every((d) => d.code.startsWith("schema/"))).toBe(true);
      if (broken.startsWith("groups")) expect([...state.invalid]).toEqual(["n:b"]);
    }
  });

  test("only the outermost unplaced group is reported, in any declaration order", () => {
    const groups = [
      "  - { id: child, group: parent }",
      "  - { id: parent, group: top }",
      "  - { id: top }",
    ];
    for (const order of [groups, [...groups].reverse()]) {
      const text = figure(
        [
          "  layout: { engine: structured, arrange: { row: { items: [n] } } }",
          "groups:",
          ...order,
          "nodes:",
          "  - { id: n, component: box, label: N }",
          "  - { id: m, component: box, label: M, group: child }",
          "",
        ].join("\n"),
      );
      const diagnostics = checkFigureSource(text).state.diagnostics;
      expect(diagnostics.map((d) => [d.code, d.subject?.id])).toEqual([["layout/unplaced", "top"]]);
      expect(invalidOf(text)).toEqual(["g:child", "g:parent", "g:top", "n:m"]);
    }
  });
});

describe("anchors", () => {
  test("parseAnchor accepts a side and an optional position from 0 to 1", () => {
    expect(parseAnchor("south")).toEqual({ side: "south", offset: 0.5 });
    expect(parseAnchor("north:0")).toEqual({ side: "north", offset: 0 });
    expect(parseAnchor("west:0.15")).toEqual({ side: "west", offset: 0.15 });
    expect(parseAnchor("east:1")).toEqual({ side: "east", offset: 1 });
    expect(parseAnchor("east:1.0")).toEqual({ side: "east", offset: 1 });
    // #179: in line with the other end; the side is not written.
    expect(parseAnchor("straight")).toBe("straight");
    for (const bad of [
      "Straight",
      "south:straight",
      "straight:0.5",
      "straight:south",
      "top",
      "South",
      "south:",
      "south:1.5",
      "south:.5",
      "south:-0.1",
      "south:2",
    ]) {
      expect(parseAnchor(bad)).toBeUndefined();
    }
  });

  test("layout/invalid-anchor with a hint", () => {
    const text = figure(
      [
        "  layout:",
        "    arrange: { row: { items: [a, b] } }",
        "nodes:",
        "  - { id: a, component: box }",
        "  - { id: b, component: box }",
        "edges:",
        '  - { from: a, fromAnchor: "east:1.5", to: b, toAnchor: sooth }',
        "",
      ].join("\n"),
    );
    expect(check(text)).toEqual([
      ["layout/invalid-anchor", ["edges", 0, "fromAnchor"], 10, 28],
      ["layout/invalid-anchor", ["edges", 0, "toAnchor"], 10, 57],
    ]);
    const [east, sooth] = checkFigureSource(text).state.diagnostics;
    expect(east?.message).toBe(
      'Invalid anchor "east:1.5" at edges[0].fromAnchor; expected "<side>", "<side>:<position>" or "straight".',
    );
    expect(sooth?.hint).toBe(
      'Did you mean "south"? Sides: north, east, south, west; the position is a number from 0 to 1 (default 0.5), e.g. "south:0.25". Or "straight": in line with the other end, on the side facing it.',
    );
  });
});

describe("straight anchors (#179)", () => {
  const text = (anchor: string, engine = "") =>
    figure(
      [
        "  layout:",
        ...(engine === ""
          ? ["    arrange: { stack: { items: [a, b] } }"]
          : [`    engine: ${engine}`]),
        "nodes:",
        "  - { id: a, component: box }",
        "  - { id: b, component: box }",
        "edges:",
        `  - { from: a, fromAnchor: ${anchor}, to: b, toAnchor: ${anchor} }`,
        "",
      ].join("\n"),
    );

  test("accepted in a structured figure", () => {
    expect(check(text("straight"))).toEqual([]);
  });

  test("a near miss suggests it", () => {
    const diagnostics = checkFigureSource(text("strait")).state.diagnostics;
    expect(diagnostics.map((d) => d.code)).toEqual([
      "layout/invalid-anchor",
      "layout/invalid-anchor",
    ]);
    expect(diagnostics[0]?.hint).toMatch(/^Did you mean "straight"\?/);
  });

  test("auto: layout/structured-only, like any anchor", () => {
    expect(check(text("straight", "auto"))).toEqual([
      ["layout/structured-only", ["edges", 0, "fromAnchor"], 10, 16],
      ["layout/structured-only", ["edges", 0, "toAnchor"], 10, 45],
    ]);
  });
});

describe("schema of the structured fields", () => {
  const nodes = "nodes:\n  - { id: a, component: box }\n";

  test("lengths take a unit (0 needs none) and must not be negative", () => {
    const text = (gap: string) =>
      figure(`  layout:\n    arrange: { row: { gap: ${gap}, items: [a] } }\n${nodes}`);
    expect(check(text("0"))).toEqual([]);
    expect(check(text('"1.5mm"'))).toEqual([]);
    const at = ["figure", "layout", "arrange", "row", "gap"];
    expect(check(text("3"))).toEqual([["schema/invalid-value", at, 5, 28]]);
    expect(check(text("3px"))).toEqual([["schema/invalid-value", at, 5, 28]]);
    expect(check(text("-1mm"))).toEqual([["schema/invalid-value", at, 5, 28]]);
    const [px] = checkFigureSource(text("3px")).state.diagnostics;
    expect(px?.message).toBe(
      'Invalid value at figure.layout.arrange.row.gap: Unsupported unit "px" in "3px"; pixel sizes depend on the display.',
    );
    expect(px?.hint).toContain("1px = 0.75pt");
  });

  test("an arrange box has exactly one of stack or row, with known fields", () => {
    const text = (arrange: string) => figure(`  layout:\n    arrange: ${arrange}\n${nodes}`);
    const at = ["figure", "layout", "arrange"];
    expect(check(text("{}"))).toEqual([["schema/invalid-value", at, 5, 14]]);
    expect(check(text("{ stack: { items: [a] }, row: { items: [a] } }"))).toEqual([
      ["schema/invalid-value", at, 5, 14],
    ]);
    // Both boxes are an error of their own, even next to an unknown key.
    expect(
      check(text("{ stack: { items: [a] }, row: { items: [a] }, stak: {} }")).map((d) => d[0]),
    ).toEqual(["schema/unknown-field", "schema/invalid-value"]);
    // A typo is one unknown-field error with a suggestion, not two errors,
    // at the root of a tree and inside it.
    expect(check(text("{ stak: { items: [a] } }"))).toEqual([
      ["schema/unknown-field", [...at, "stak"], 5, 16],
    ]);
    expect(check(text("{ row: { items: [{ stak: { items: [a] } }] } }"))).toEqual([
      ["schema/unknown-field", [...at, "row", "items", 0, "stak"], 5, 33],
    ]);
    expect(
      checkFigureSource(text("{ row: { items: [{ stak: { items: [a] } }] } }")).state.diagnostics[0]
        ?.hint,
    ).toBe('Did you mean "stack"? If this field was added in a newer Sumi version, upgrade Sumi.');
    expect(check(text("{ row: { direction: up, items: [a] } }"))).toEqual([
      ["schema/invalid-value", [...at, "row", "direction"], 5, 34],
    ]);
    expect(check(text("{ stack: { items: [] } }"))).toEqual([
      ["schema/invalid-value", [...at, "stack", "items"], 5, 32],
    ]);
    expect(check(text("{ stack: { items: [A] } }"))).toEqual([
      ["schema/invalid-id", [...at, "stack", "items", 0], 5, 33],
    ]);
    expect(check(text("{ stack: { items: [1] } }"))).toEqual([
      ["schema/invalid-type", [...at, "stack", "items", 0], 5, 33],
    ]);
    expect(checkFigureSource(text("{ stack: { items: [1] } }")).state.diagnostics[0]?.message).toBe(
      "Expected an element ID or a stack / row box at figure.layout.arrange.stack.items[0], got the number 1.",
    );
  });

  test("attach needs a known side", () => {
    const text = figure(
      `  layout:\n    arrange: { row: { items: [a] } }\n${nodes}  - { id: b, component: box, attach: { to: a, side: left } }\n`,
    );
    expect(check(text)).toEqual([["schema/invalid-value", ["nodes", 1, "attach", "side"], 8, 53]]);
  });
});

describe("rendering", () => {
  test("a structured figure compiles without D2 source and renders (#91)", async () => {
    const text = figure(
      "  layout:\n    arrange: { row: { items: [a] } }\nnodes:\n  - { id: a, component: box, label: A }\n",
    );
    expect(lintFigure(text).diagnostics).toEqual([]);
    const compiled = compileFigure(text);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
    expect(compiled.value.engine).toBe("structured");
    expect("d2Source" in compiled.value).toBe(false);
    const rendered = await lintRenderedFigure(text);
    expect(rendered.diagnostics).toEqual([]);
    expect(rendered.rendered?.metadata.backend.name).toBe("sumi-structured");
  });

  test("the rendered lint reports check errors once", async () => {
    const ok = figure(
      "  layout:\n    arrange: { row: { items: [a] } }\nnodes:\n  - { id: a, component: box, label: A }\n",
    );
    const broken = await lintRenderedFigure(ok.replace("items: [a]", "items: [b]"));
    expect(broken.diagnostics.map((d) => d.code)).toEqual([
      "layout/unknown-item",
      "layout/unplaced",
    ]);
  });

  test("a structured figure without elements is empty, like an auto one", async () => {
    const rendered = await lintRenderedFigure(figure("  layout:\n    engine: structured\n"));
    expect(rendered.diagnostics.map((d) => d.code).sort()).toEqual([
      "lint/empty-figure",
      "svg/empty-figure",
    ]);
  });
});

describe("figure A of #86", () => {
  test("the adapted fixture checks and lints with zero diagnostics", async () => {
    const text = await Bun.file(
      join(ROOT, "tests/fixtures/figures/layout/a-transformer.sumi.yaml"),
    ).text();
    expect(lintFigure(text).diagnostics).toEqual([]);
    const parsed = parseFigure(text);
    if (!parsed.ok) throw new Error("expected ok");
    expect(parsed.value.figure.layout.engine).toBe("structured");
    const groupOf = new Map(parsed.value.nodes.map((n) => [n.id, n.group]));
    expect(groupOf.get("enc-mha")).toBe("encoder");
    expect(groupOf.get("dec-norm3")).toBe("decoder");
    expect(groupOf.get("enc-n")).toBeUndefined(); // attached to the root-level group
    expect(groupOf.get("enc-pe-label")).toBeUndefined();
  });

  test("the research YAML checks with zero diagnostics", async () => {
    const text = await Bun.file(
      join(ROOT, "research/86-paper-figures/figures/ideal/a-transformer.sumi.yaml"),
    ).text();
    // `requires: ">=0.4.0"` is satisfied once v0.4.0 is released. `tone`,
    // `operator` and `junction` are #92; `icon: tabler/wave-sine` is #94.
    const { state } = checkFigure(text.replace(/^requires: .*\n/m, ""));
    expect(state.diagnostics).toEqual([]);
  });
});

describe("figure.layout.align (#132)", () => {
  const nodes = "nodes:\n  - { id: a, component: box }\n  - { id: b, component: box }\n";
  const structured = (align: string) =>
    figure(
      `  layout:\n    arrange: { row: { items: [ { stack: { items: [a] } }, b ] } }\n    align:\n${align}${nodes}`,
    );

  test("is normalized with the layout; at stays omitted when not written", () => {
    const parsed = parseFigure(
      structured("      - { y: [a, b] }\n      - { x: [a, b], at: start }\n"),
    );
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.ok && parsed.value.figure.layout.align).toEqual([
      { y: ["a", "b"] },
      { x: ["a", "b"], at: "start" },
    ]);
  });

  test("valid constraints have no diagnostics", () => {
    expect(check(structured("      - { y: [a, b], at: end }\n"))).toEqual([]);
  });

  test("needs the structured engine", () => {
    const text = figure(`  layout:\n    align:\n      - { y: [a, b] }\n${nodes}`);
    expect(check(text)).toEqual([["layout/structured-only", ["figure", "layout", "align"], 5, 5]]);
  });

  test("exactly one of x or y", () => {
    expect(check(structured("      - { x: [a, b], y: [a, b] }\n"))).toEqual([
      ["schema/invalid-value", ["figure", "layout", "align", 0], 7, 9],
    ]);
    expect(check(structured("      - { at: start }\n"))).toEqual([
      ["schema/invalid-value", ["figure", "layout", "align", 0], 7, 9],
    ]);
    // A typo is one unknown field, not also "exactly one of".
    expect(check(structured("      - { z: [a, b] }\n"))).toEqual([
      ["schema/unknown-field", ["figure", "layout", "align", 0, "z"], 7, 11],
    ]);
  });

  test("an invalid at is a schema error", () => {
    expect(check(structured("      - { y: [a, b], at: middle }\n"))).toEqual([
      ["schema/invalid-value", ["figure", "layout", "align", 0, "at"], 7, 26],
    ]);
  });

  test("unknown, duplicated and too few items", () => {
    const text = structured(
      "      - { y: [a, c] }\n      - { y: [a, b, a] }\n      - { x: [a] }\n      - { x: [] }\n",
    );
    expect(check(text)).toEqual([
      ["layout/unknown-align-item", ["figure", "layout", "align", 0, "y", 1], 7, 18],
      ["layout/duplicate-align-item", ["figure", "layout", "align", 1, "y", 2], 8, 21],
      ["layout/invalid-align", ["figure", "layout", "align", 2, "x"], 9, 11],
      ["layout/invalid-align", ["figure", "layout", "align", 3, "x"], 10, 11],
    ]);
    const diagnostics = checkFigureSource(text).state.diagnostics;
    expect(diagnostics[0]?.hint).toBe('Did you mean "a"?');
    expect(diagnostics[1]?.related?.[0]?.location?.column).toBe(15);
    expect(diagnostics[2]?.message).toBe(
      'figure.layout.align[2] lists only "a"; an align constraint needs at least two.',
    );
  });

  test("an edge ID is not an element", () => {
    const text = `${structured("      - { y: [a, e] }\n")}edges:\n  - { id: e, from: a, to: b }\n`;
    const [d] = checkFigureSource(text).state.diagnostics;
    expect(d?.code).toBe("layout/unknown-align-item");
    expect(d?.hint).toBe('"e" is an edge; only nodes and groups are placed.');
  });
});
