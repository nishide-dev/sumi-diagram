import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { checkFigure } from "../check";
import type { DocPath } from "../diagnostics";
import { createBuiltinRegistry } from "./builtins";
import { Registry } from "./registry";
import { isBlankForD2 } from "./resolve";

const fixtures = `${import.meta.dir}/../../../tests/fixtures/figures`;
const read = (name: string) => Bun.file(`${fixtures}/${name}`).text();

type Expected = [code: string, path: DocPath | undefined, line: number, column: number];

async function check(name: string) {
  return checkFigure(await read(name), { file: name }).state;
}

function summarize(state: Awaited<ReturnType<typeof check>>): Expected[] {
  return state.diagnostics.map((d) => [
    d.code,
    d.path,
    d.location?.line ?? 0,
    d.location?.column ?? 0,
  ]);
}

const summaryOf = (state: Awaited<ReturnType<typeof check>>) =>
  Object.fromEntries(
    [...(state.components ?? [])].map(([key, c]) => [key, [c.id, c.variant, c.props]]),
  );

describe("valid fixtures", () => {
  test("the full example resolves every element", async () => {
    const state = await check("valid/full.sumi.yaml");
    expect(state.diagnostics).toEqual([]);
    expect(summaryOf(state)).toEqual({
      "g:backend": ["sumi/container", "default", {}],
      "n:client": ["sumi/box", "default", {}],
      "n:api": ["sumi/box", "default", {}],
      "n:auth": ["sumi/diamond", "default", {}],
      "n:db": ["sumi/cylinder", "muted", {}],
      "e:#0": ["sumi/arrow", "default", {}],
      "e:#1": ["sumi/arrow", "default", {}],
      "e:#2": ["sumi/arrow", "dashed", {}],
    });
  });

  test("every built-in component, canonical IDs and props", async () => {
    const state = await check("valid/components.sumi.yaml");
    expect(state.diagnostics).toEqual([]);
    expect(state.invalid.size).toBe(0);
    const components = summaryOf(state);
    expect(components["g:stage"]).toEqual(["sumi/container", "muted", {}]);
    expect(components["n:box"]).toEqual(["sumi/box", "default", { width: 40, height: 36 }]);
    expect(components["n:square"]).toEqual(["sumi/square", "default", { width: 72, height: 72 }]);
    expect(components["n:circle"]).toEqual(["sumi/circle", "emphasis", {}]);
    expect(components["n:note"]).toEqual(["sumi/label", "muted", {}]);
    expect(components["e:#1"]).toEqual(["sumi/line", "dashed", {}]);
    expect(components["e:#2"]).toEqual(["sumi/double-arrow", "default", {}]);
    expect(Object.keys(components)).toHaveLength(14);
  });

  test("the resolved manifest is the registered one", async () => {
    const registry = createBuiltinRegistry();
    const { state } = checkFigure(await read("valid/full.sumi.yaml"), { registry });
    expect(state.components?.get("n:auth")?.manifest).toBe(registry.get("sumi/diamond"));
  });
});

describe("invalid fixtures", () => {
  const cases: [fixture: string, expected: Expected[]][] = [
    ["component-unknown", [["component/unknown", ["nodes", 0, "component"], 6, 16]]],
    ["component-wrong-kind", [["component/wrong-kind", ["edges", 0, "component"], 12, 16]]],
    ["component-unknown-variant", [["component/unknown-variant", ["nodes", 0, "variant"], 7, 14]]],
    ["component-unknown-prop", [["component/unknown-prop", ["nodes", 0, "props", "widht"], 8, 7]]],
    ["component-invalid-prop", [["component/invalid-prop", ["nodes", 0, "props", "width"], 8, 14]]],
    [
      "component-missing-label",
      [
        ["component/missing-label", ["nodes", 0, "label"], 5, 5],
        ["component/missing-label", ["nodes", 1, "label"], 9, 12],
        ["component/missing-label", ["nodes", 2, "label"], 12, 12],
        ["component/missing-label", ["nodes", 3, "label"], 15, 12],
        ["component/missing-label", ["nodes", 4, "label"], 18, 12],
      ],
    ],
  ];

  for (const [fixture, expected] of cases) {
    test(fixture, async () => {
      const state = await check(`invalid/${fixture}.sumi.yaml`);
      expect(summarize(state)).toEqual(expected);
      for (const d of state.diagnostics) {
        expect(d.severity).toBe("error");
        expect(d.location?.file).toBe(`invalid/${fixture}.sumi.yaml`);
        expect(d.subject).toBeDefined();
      }
    });
  }

  test("diagnostics name the element and suggest a fix", async () => {
    const [d] = (await check("invalid/component-unknown.sumi.yaml")).diagnostics;
    expect(d?.subject).toEqual({ kind: "node", id: "api" });
    expect(d?.message).toBe('Unknown node component "rectangel".');
    const [edge] = (await check("invalid/component-wrong-kind.sumi.yaml")).diagnostics;
    expect(edge?.subject).toEqual({ kind: "edge", id: "edges[0]" });
    expect(edge?.hint).toBe("Known edge components: arrow, line, double-arrow, zoom.");
  });
});

describe("groups[].labelAt (#127)", () => {
  test("without a visible label it warns at labelAt and keeps the group", () => {
    const { state } = checkFigure(`version: 1
figure: { id: f }
groups:
  - { id: omitted, labelAt: bottom }
  - { id: empty, label: "", labelAt: top-left }
  - { id: blank, label: " ", labelAt: top-right }
  - { id: titled, label: Title, labelAt: bottom-right }
nodes:
  - { id: a, component: box, label: A, group: omitted }
`);
    expect(
      state.diagnostics.map((d) => [d.code, d.severity, d.path, d.location?.line, d.hint]),
    ).toEqual([
      [
        "component/label-at-without-label",
        "warning",
        ["groups", 0, "labelAt"],
        4,
        "Add a label, or remove labelAt.",
      ],
      [
        "component/label-at-without-label",
        "warning",
        ["groups", 1, "labelAt"],
        5,
        "Add a label, or remove labelAt.",
      ],
      [
        "component/label-at-without-label",
        "warning",
        ["groups", 2, "labelAt"],
        6,
        "Add a label, or remove labelAt.",
      ],
    ]);
    expect(state.diagnostics[0]?.message).toContain(
      "omitted or empty, so the group has no visible title and labelAt has no effect",
    );
    expect(state.diagnostics[2]?.message).toContain(
      "only whitespace, so the group has no visible title; in structured layout labelAt only moves the blank space",
    );
    expect([...(state.components?.keys() ?? [])]).toContain("g:omitted");
  });
});

describe("isBlankForD2", () => {
  // Matches D2 v0.9.0, which trims labels with Go's unicode.IsSpace.
  test.each([
    ["", true],
    ["   ", true],
    ["\t\n\r\v\f", true],
    [" \u0085 　 ", true],
    ["x", false],
    [" x ", false],
    ["​", false],
    ["﻿", false],
  ])("%j → %p", (label, blank) => {
    expect(isBlankForD2(label)).toBe(blank);
  });
});

describe("no cascading diagnostics", () => {
  test("failed components invalidate dependents without more diagnostics", async () => {
    const state = await check("invalid/component-no-cascade.sumi.yaml");
    // Edges to the unknown node and the node inside the invalid group get no
    // diagnostic; the edge with its own unknown component does.
    expect(summarize(state)).toEqual([
      ["component/unknown", ["groups", 0, "component"], 6, 16],
      ["component/unknown", ["nodes", 1, "component"], 13, 16],
      ["component/unknown-variant", ["nodes", 3, "variant"], 19, 14],
      ["component/unknown", ["edges", 2, "component"], 27, 16],
    ]);
    expect([...state.invalid].sort()).toEqual([
      "e:#0",
      "e:#1",
      "e:#2",
      "g:inner",
      "g:outer",
      "n:api",
      "n:db",
      "n:ghost",
    ]);
    // Only valid elements are resolved.
    expect([...(state.components?.keys() ?? [])]).toEqual(["n:client", "e:#3"]);
  });

  test("elements invalid in earlier stages are not resolved", async () => {
    const state = await check("invalid/no-cascade.sumi.yaml");
    expect(state.diagnostics.map((d) => d.code)).toEqual([
      "schema/missing-field",
      "schema/unknown-field",
      "ref/unknown-group",
      "ref/group-cycle",
    ]);
    expect(state.components?.size).toBe(0);
  });

  test("an element still reports errors independent of its invalid group", () => {
    const { state } = checkFigure(
      "version: 1\nfigure: { id: f }\ngroups: [{ id: g, component: nope }]\n" +
        "nodes: [{ id: a, component: box, group: g, props: { colour: red } }]\n",
    );
    expect(state.diagnostics.map((d) => [d.code, d.path])).toEqual([
      ["component/unknown", ["groups", 0, "component"]],
      ["component/unknown-prop", ["nodes", 0, "props", "colour"]],
    ]);
    expect([...state.invalid].sort()).toEqual(["g:g", "n:a"]);
  });

  test("YAML errors leave nothing to resolve", () => {
    const { state } = checkFigure("version: [\n");
    expect(state.diagnostics.map((d) => d.code)).toEqual(["yaml/syntax"]);
    expect(state.components?.size).toBe(0);
  });
});

describe("custom registries", () => {
  test("defaulted components must exist in the registry", () => {
    const registry = new Registry();
    registry.register({
      version: 1,
      kind: "node",
      namespace: "acme",
      name: "widget",
      description: "A widget.",
      variants: ["default"],
      props: z.strictObject({}),
      since: "0.1.0",
      shape: "rectangle",
      sizing: "auto",
    });
    const { state } = checkFigure(
      "version: 1\nfigure: { id: f }\ngroups: [{ id: g }]\n" +
        "nodes: [{ id: a, component: acme/widget }]\nedges: [{ from: a, to: a }]\n",
      { registry },
    );
    expect(state.diagnostics.map((d) => [d.code, d.path, d.hint])).toEqual([
      ["component/unknown", ["groups", 0, "component"], "No group components are registered."],
      ["component/unknown", ["edges", 0, "component"], "No edge components are registered."],
    ]);
    expect(state.components?.get("n:a")?.id).toBe("acme/widget");
  });
});

describe("anchors on junction ends (#154)", () => {
  const figure = (edges: string) => `version: 1
figure:
  id: f
  layout:
    arrange:
      row: { gap: 8mm, items: [a, j, g, h] }
groups:
  - { id: g, label: G, arrange: { stack: { items: [c] } } }
nodes:
  - { id: a, component: box, label: A }
  - { id: j, component: junction }
  - { id: h, component: junction, variant: hidden }
  - { id: c, component: box, label: C, group: g }
edges:
${edges}`;

  test("warns at the anchor on a junction end and keeps the edge", () => {
    const { state } = checkFigure(
      figure(`  - { from: a, to: j, toAnchor: south, fromAnchor: east }
  - { id: split, from: j, to: h, fromAnchor: "north:0.25", toAnchor: west }
  - { from: a, to: g, fromAnchor: south, toAnchor: west }
`),
    );
    const edge0 = { kind: "edge", id: "edges[0]" } as const;
    const split = { kind: "edge", id: "split" } as const;
    expect(
      state.diagnostics.map((d) => [d.code, d.severity, d.path, d.location?.line, d.subject]),
    ).toEqual([
      ["component/anchor-on-junction", "warning", ["edges", 0, "toAnchor"], 15, edge0],
      ["component/anchor-on-junction", "warning", ["edges", 1, "fromAnchor"], 16, split],
      ["component/anchor-on-junction", "warning", ["edges", 1, "toAnchor"], 16, split],
    ]);
    expect(state.diagnostics[0]?.message).toBe(
      'toAnchor has no effect: "j" is a sumi/junction, drawn as a point where every line meets its center from any side.',
    );
    expect(state.diagnostics[0]?.hint).toBe(
      "Remove toAnchor. To change where the line runs, anchor the edge's other end, or move the junction in the arrange tree or with attach.",
    );
    expect(state.diagnostics[0]?.location?.column).toBe(33);
    expect(state.invalid.size).toBe(0);
    expect(state.components?.has("e:split")).toBe(true);
  });

  test("auto figures report the anchor as structured-only, not twice", () => {
    const { state } = checkFigure(`version: 1
figure: { id: f }
nodes:
  - { id: a, component: box, label: A }
  - { id: j, component: junction }
edges:
  - { from: a, to: j, toAnchor: south }
`);
    expect(state.diagnostics.map((d) => d.code)).toEqual(["layout/structured-only"]);
  });

  test("an invalid junction is not reported again", () => {
    const { state } = checkFigure(
      figure("  - { from: a, to: j, toAnchor: south }\n").replace(
        "{ id: j, component: junction }",
        "{ id: j, component: junction, tone: red }",
      ),
    );
    expect(state.diagnostics.map((d) => d.code)).toEqual(["component/tone-unsupported"]);
  });
});
