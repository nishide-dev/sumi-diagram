import { describe, expect, test } from "bun:test";
import type { DocPath } from "../diagnostics";
import { checkFigureSource, parseFigure } from "./check";

const fixtures = `${import.meta.dir}/../../../tests/fixtures/figures`;
const read = (name: string) => Bun.file(`${fixtures}/${name}`).text();

/** code, path, line, column of each diagnostic, in order. */
type Expected = [code: string, path: DocPath | undefined, line: number, column: number];

async function diagnosticsOf(name: string) {
  const { state } = checkFigureSource(await read(name), { file: name });
  return state.diagnostics;
}

function summarize(diagnostics: Awaited<ReturnType<typeof diagnosticsOf>>): Expected[] {
  return diagnostics.map((d) => [d.code, d.path, d.location?.line ?? 0, d.location?.column ?? 0]);
}

describe("valid fixtures", () => {
  test("full example from the design doc parses and is normalized", async () => {
    const result = parseFigure(await read("valid/full.sumi.yaml"));
    expect(result.diagnostics).toEqual([]);
    if (!result.ok) throw new Error("expected ok");
    const doc = result.value;
    expect(doc.figure).toEqual({
      id: "request-pipeline",
      theme: "minimal",
      profile: "paper-single",
      layout: { direction: "right" },
    });
    expect(doc.groups).toEqual([
      { id: "backend", label: "Backend", component: "container", variant: "default" },
    ]);
    expect(doc.nodes[0]).toEqual({
      id: "client",
      component: "box",
      label: "Client",
      variant: "default",
      props: {},
    });
    expect(doc.nodes[3]?.label).toBe("Database\n(primary)");
    expect(doc.edges[1]).toEqual({
      from: "api",
      to: "auth",
      label: "",
      component: "arrow",
      variant: "default",
      props: {},
    });
    expect(doc.edges[2]?.variant).toBe("dashed");
  });

  test("minimal document gets every default", async () => {
    const result = parseFigure(await read("valid/minimal.sumi.yaml"));
    expect(result).toEqual({
      ok: true,
      diagnostics: [],
      value: {
        version: 1,
        figure: {
          id: "minimal",
          theme: "minimal",
          profile: "paper-single",
          layout: { direction: "right" },
        },
        groups: [],
        nodes: [],
        edges: [],
      },
    });
  });
});

describe("invalid fixtures", () => {
  const cases: [fixture: string, expected: Expected[]][] = [
    ["yaml-syntax", [["yaml/syntax", undefined, 5, 1]]],
    ["yaml-duplicate-key", [["yaml/duplicate-key", ["figure", "theme"], 5, 3]]],
    [
      "yaml-alias-not-allowed",
      [
        ["yaml/alias-not-allowed", ["nodes", 0], 6, 5],
        ["yaml/alias-not-allowed", ["nodes", 1], 8, 5],
      ],
    ],
    ["yaml-multiple-documents", [["yaml/multiple-documents", undefined, 4, 1]]],
    ["yaml-tag-not-allowed", [["yaml/tag-not-allowed", ["figure", "title"], 4, 17]]],
    ["yaml-non-string-key", [["yaml/non-string-key", ["metadata"], 5, 3]]],
    ["schema-invalid-type", [["schema/invalid-type", ["nodes", 0, "label"], 7, 12]]],
    ["schema-missing-field", [["schema/missing-field", ["nodes", 0, "component"], 5, 5]]],
    ["schema-unknown-field", [["schema/unknown-field", ["nodes", 0, "lable"], 7, 5]]],
    ["schema-invalid-value", [["schema/invalid-value", ["figure", "layout", "direction"], 5, 16]]],
    ["schema-invalid-id", [["schema/invalid-id", ["nodes", 0, "id"], 5, 9]]],
    ["schema-invalid-metadata", [["schema/invalid-metadata", ["metadata", "scale", 1], 6, 14]]],
    ["schema-unsupported-version", [["schema/unsupported-version", ["version"], 1, 10]]],
    ["schema-unsatisfied-requires", [["schema/unsatisfied-requires", ["requires"], 2, 11]]],
    [
      "ref-duplicate-id",
      [
        ["ref/duplicate-id", ["nodes", 0, "id"], 7, 9],
        ["ref/duplicate-id", ["edges", 1, "id"], 13, 9],
      ],
    ],
    ["ref-unknown-group", [["ref/unknown-group", ["nodes", 0, "group"], 9, 12]]],
    ["ref-group-cycle", [["ref/group-cycle", ["groups", 0, "group"], 6, 12]]],
    ["ref-unknown-endpoint", [["ref/unknown-endpoint", ["edges", 0, "to"], 11, 9]]],
  ];

  for (const [fixture, expected] of cases) {
    test(fixture, async () => {
      const diagnostics = await diagnosticsOf(`invalid/${fixture}.sumi.yaml`);
      expect(summarize(diagnostics)).toEqual(expected);
      for (const d of diagnostics) {
        expect(d.severity).toBe("error");
        expect(d.location?.file).toBe(`invalid/${fixture}.sumi.yaml`);
      }
    });
  }

  test("parseFigure fails with the same diagnostics", async () => {
    const result = parseFigure(await read("invalid/ref-unknown-endpoint.sumi.yaml"));
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((d) => d.code)).toEqual(["ref/unknown-endpoint"]);
  });
});

describe("diagnostic details", () => {
  test("unknown fields suggest the closest known field", async () => {
    const [d] = await diagnosticsOf("invalid/schema-unknown-field.sumi.yaml");
    expect(d?.hint).toBe(
      'Did you mean "label"? If this field was added in a newer Sumi version, upgrade Sumi.',
    );
  });

  test("unknown references suggest the closest ID", async () => {
    const [endpoint] = await diagnosticsOf("invalid/ref-unknown-endpoint.sumi.yaml");
    expect(endpoint?.hint).toBe('Did you mean "server"?');
    expect(endpoint?.subject).toEqual({ kind: "edge", id: "edges[0]" });
    const [group] = await diagnosticsOf("invalid/ref-unknown-group.sumi.yaml");
    expect(group?.hint).toBe('Did you mean "backend"?');
  });

  test("invalid enum values suggest the closest option", async () => {
    const [d] = await diagnosticsOf("invalid/schema-invalid-value.sumi.yaml");
    expect(d?.hint).toBe('Did you mean "right"?');
  });

  test("uppercase IDs suggest the lowercase form", async () => {
    const [d] = await diagnosticsOf("invalid/schema-invalid-id.sumi.yaml");
    expect(d?.hint).toBe('IDs are lowercase only; use "api".');
  });

  test("duplicates point at the first definition", async () => {
    const [node, edge] = await diagnosticsOf("invalid/ref-duplicate-id.sumi.yaml");
    expect(node?.related).toEqual([
      {
        path: ["groups", 0, "id"],
        location: expect.objectContaining({ line: 5, column: 9 }),
        message: "First defined here.",
      },
    ]);
    expect(edge?.related?.[0]?.path).toEqual(["edges", 0, "id"]);
  });

  test("duplicate keys point at the first key", async () => {
    const [d] = await diagnosticsOf("invalid/yaml-duplicate-key.sumi.yaml");
    expect(d?.related?.[0]?.location).toMatchObject({ line: 4, column: 3 });
  });

  test("group cycles name the whole cycle", async () => {
    const [d] = await diagnosticsOf("invalid/ref-group-cycle.sumi.yaml");
    expect(d?.message).toBe('Group "a" is nested inside itself: a → b → a.');
    expect(d?.related?.map((r) => r.path)).toEqual([["groups", 1, "group"]]);
  });

  test("diagnostics are JSON-serializable", async () => {
    const diagnostics = await diagnosticsOf("invalid/ref-duplicate-id.sumi.yaml");
    expect(JSON.parse(JSON.stringify(diagnostics))).toEqual(diagnostics);
  });
});

describe("no cascading diagnostics", () => {
  test("elements depending on invalid elements are skipped", async () => {
    const { state } = checkFigureSource(await read("invalid/no-cascade.sumi.yaml"));
    // Only root causes: edges to the invalid nodes, the node inside the cycle
    // and the edge to a cyclic group are not reported.
    expect(summarize(state.diagnostics)).toEqual([
      ["schema/missing-field", ["nodes", 0, "component"], 10, 5],
      ["schema/unknown-field", ["nodes", 1, "colour"], 13, 5],
      ["ref/unknown-group", ["nodes", 2, "group"], 16, 12],
      ["ref/group-cycle", ["groups", 0, "group"], 6, 12],
    ]);
    expect([...state.invalid].sort()).toEqual([
      // Edges and the node inside the cycle are invalid through a dependency.
      "e:#0",
      "e:#1",
      "e:#2",
      "g:loop-a",
      "g:loop-b",
      "n:inner",
      "n:lost",
      "n:missing-component",
      "n:typo",
    ]);
    // A node with only unknown fields is kept in the partial document.
    expect(state.doc.nodes?.[1]?.id).toBe("typo");
    expect(state.doc.nodes?.[0]).toBeUndefined();
  });

  const duplicateOrders: [order: string, groupsFirst: boolean][] = [
    ["group first", true],
    ["node first", false],
  ];
  for (const [order, groupsFirst] of duplicateOrders) {
    test(`a node/group duplicate invalidates both definitions (${order})`, () => {
      const groups = "groups:\n  - id: api\n  - id: child\n    group: api\n";
      const nodes =
        "nodes:\n  - id: api\n    component: box\n  - id: x\n    component: box\n    group: api\n";
      const text = [
        "version: 1\nfigure: { id: f }\n",
        groupsFirst ? groups : nodes,
        groupsFirst ? nodes : groups,
        "edges:\n  - { from: api, to: x }\n  - { from: child, to: api }\n",
      ].join("");
      const { state } = checkFigureSource(text);
      expect(state.diagnostics.map((d) => [d.code, d.path])).toEqual([
        ["ref/duplicate-id", groupsFirst ? ["nodes", 0, "id"] : ["groups", 0, "id"]],
      ]);
      expect([...state.invalid].sort()).toEqual([
        "e:#0",
        "e:#1",
        "g:api",
        "g:child",
        "n:api",
        "n:x",
      ]);
    });
  }

  test("duplicate edge IDs invalidate both edges", () => {
    const { state } = checkFigureSource(
      "version: 1\nfigure: { id: f }\nnodes: [{ id: a, component: box }]\n" +
        "edges:\n  - { id: e, from: a, to: a }\n  - { from: a, to: a }\n  - { id: e, from: a, to: a }\n",
    );
    expect(state.diagnostics.map((d) => d.code)).toEqual(["ref/duplicate-id"]);
    expect([...state.invalid]).toEqual(["e:e"]);
  });

  const endpointCases: [from: string, to: string, end: "from" | "to"][] = [
    ["bad", "missing", "to"],
    ["missing", "bad", "from"],
  ];
  for (const [from, to, end] of endpointCases) {
    test(`an invalid endpoint still reports an independent unknown endpoint (${end})`, () => {
      const { state } = checkFigureSource(
        "version: 1\nfigure: { id: f }\nnodes:\n  - id: bad\n" +
          `edges:\n  - { from: ${from}, to: ${to} }\n  - { from: bad, to: bad }\n`,
      );
      expect(state.diagnostics.map((d) => [d.code, d.path])).toEqual([
        ["schema/missing-field", ["nodes", 0, "component"]],
        ["ref/unknown-endpoint", ["edges", 0, end]],
      ]);
      expect([...state.invalid].sort()).toEqual(["e:#0", "e:#1", "n:bad"]);
    });
  }

  test("an unreadable collection disables checks that depend on it", () => {
    const { state } = checkFigureSource(
      "version: 1\nfigure: { id: f }\nnodes: nope\nedges:\n  - { from: a, to: b }\n",
    );
    expect(state.diagnostics.map((d) => d.code)).toEqual(["schema/invalid-type"]);
    expect(state.doc.nodes).toBeUndefined();
  });

  test("an unsupported version stops validation", async () => {
    const diagnostics = await diagnosticsOf("invalid/schema-unsupported-version.sumi.yaml");
    expect(diagnostics.map((d) => d.code)).toEqual(["schema/unsupported-version"]);
  });
});

describe("edge cases", () => {
  test("an empty file is not a figure", () => {
    expect(checkFigureSource("").state.diagnostics).toEqual([
      expect.objectContaining({ code: "schema/invalid-type", path: [] }),
    ]);
  });

  test("standard YAML tags are allowed", () => {
    const result = parseFigure("version: 1\nfigure: { id: f, title: !!str 2024 }\n");
    expect(result.ok && result.value.figure.title).toBe("2024");
  });

  test("merge keys are rejected", () => {
    const { state } = checkFigureSource("version: 1\nfigure:\n  <<: { id: f }\n");
    expect(state.diagnostics.map((d) => d.code)).toEqual(["yaml/alias-not-allowed"]);
  });

  test("a satisfied requires range is kept", () => {
    const result = parseFigure('version: 1\nrequires: ">=0.0.0"\nfigure: { id: f }\n');
    expect(result.ok && result.value.requires).toBe(">=0.0.0");
  });

  test("a malformed requires range is an invalid value", () => {
    const { state } = checkFigureSource('version: 1\nrequires: "soon"\nfigure: { id: f }\n');
    expect(summarize(state.diagnostics)).toEqual([["schema/invalid-value", ["requires"], 2, 11]]);
  });

  test("metadata is passed through untouched", () => {
    const result = parseFigure(
      "version: 1\nfigure: { id: f }\nmetadata: { date: 2024-01-01, tags: [a, 1, null] }\n",
    );
    expect(result.ok && result.value.metadata).toEqual({
      date: "2024-01-01",
      tags: ["a", 1, null],
    });
  });

  test("self loops, multi-edges and group endpoints are allowed", () => {
    const result = parseFigure(
      [
        "version: 1",
        "figure: { id: f }",
        "groups: [{ id: g }]",
        "nodes: [{ id: a, component: box, group: g }]",
        "edges: [{ from: a, to: a }, { from: a, to: a }, { from: g, to: a }]",
      ].join("\n"),
    );
    expect(result.diagnostics).toEqual([]);
  });
});
