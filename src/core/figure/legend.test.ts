import { describe, expect, test } from "bun:test";
import { buildFigureIR, type GroupIR } from "../../compiler/ir";
import { lintFigure } from "../../lint/lint";
import { checkFigure } from "../check";
import { edgeKey, groupKey, nodeKey } from "../check-state";
import { createBuiltinRegistry } from "../registry/builtins";
import type { NodeManifest } from "../registry/manifest";
import { LEGEND_EM, legendPartIds, legendSizes } from "./legend";

/** A structured figure: `a → b` (dashed), and the legend `key` with `entries`. */
const figure = (entries: string, options: { nodes?: string; edges?: string; key?: string } = {}) =>
  `version: 1
figure:
  id: f
  theme: academic
  layout:
    arrange: { row: { items: [a, b, key] } }
nodes:
  - { id: a, component: box, label: A, tone: blue }
  - { id: b, component: circle, label: B }
  - id: key
    component: legend${options.key ?? ""}
    props:
      entries:
${entries}
${options.nodes ?? ""}edges:
  - { from: a, to: b, variant: dashed }
${options.edges ?? ""}`;

const ENTRIES = `        - { edge: { variant: dashed }, label: skip }
        - { node: { tone: blue }, label: encoder }`;

const summarize = (
  diagnostics: { code: string; path?: unknown; location?: { line: number; column: number } }[],
) => diagnostics.map((d) => [d.code, d.path, d.location?.line ?? 0, d.location?.column ?? 0]);

describe("expansion (#131)", () => {
  test("a legend becomes a frame group with its ID, place and parent, holding its parts", () => {
    const { state } = checkFigure(figure(ENTRIES, { key: "\n    label: Key\n    variant: plain" }));
    expect(state.diagnostics).toEqual([]);
    const { doc } = state;
    // The legend node gives way to the frame group (same ID, so the arrange item now names it).
    expect(doc.nodes?.[2]).toBeUndefined();
    const frame = doc.groups?.at(-1);
    expect(frame).toMatchObject({
      id: "key",
      label: "Key",
      component: "sumi/legend",
      variant: "plain",
    });
    expect(frame?.arrange).toEqual({
      stack: {
        direction: "down",
        gap: 3,
        align: "start",
        items: [
          {
            row: {
              direction: "right",
              gap: 4,
              align: "center",
              items: [
                {
                  row: {
                    direction: "right",
                    gap: 19,
                    align: "center",
                    items: ["key-1-start", "key-1-end"],
                  },
                },
                "key-1-label",
              ],
            },
          },
          {
            row: {
              direction: "right",
              gap: 4,
              align: "center",
              items: ["key-2-box", "key-2-label"],
            },
          },
        ],
      },
    });
    const nodes = doc.nodes?.slice(3) ?? [];
    expect(nodes.map((n) => [n?.id, n?.component, n?.variant, n?.group])).toEqual([
      ["key-1-label", "sumi/label", "default", "key"],
      ["key-1-start", "sumi/junction", "hidden", "key"],
      ["key-1-end", "sumi/junction", "hidden", "key"],
      ["key-2-label", "sumi/label", "default", "key"],
      ["key-2-box", "box", "default", "key"],
    ]);
    expect(nodes.at(-1)).toMatchObject({ tone: "blue", props: { width: "20pt", height: "9pt" } });
    expect(doc.edges?.at(-1)).toMatchObject({
      id: "key-1-line",
      from: "key-1-start",
      to: "key-1-end",
      component: "arrow",
      variant: "dashed",
    });
    // Every part is resolved and styled; the frame by the legend's theme styles.
    expect(state.components?.get(groupKey("key"))).toMatchObject({
      id: "sumi/legend",
      variant: "plain",
      manifest: { kind: "group" },
    });
    expect(state.components?.get(nodeKey("key"))).toBeUndefined();
    expect(state.styles?.get(groupKey("key"))).toMatchObject({
      kind: "group",
      strokeWidth: { pt: 0 },
    });
    expect(state.styles?.get(edgeKey("key-1-line", 1))).toEqual(
      state.styles?.get(edgeKey(undefined, 0)),
    );
    expect(doc.legends).toEqual([
      {
        id: "key",
        path: ["nodes", 2],
        entries: [
          {
            kind: "edge",
            sample: "e:key-1-line",
            path: ["nodes", 2, "props", "entries", 0],
            label: "skip",
          },
          {
            kind: "node",
            sample: "n:key-2-box",
            path: ["nodes", 2, "props", "entries", 1],
            label: "encoder",
          },
        ],
      },
    ]);
  });

  test("the IR traces every part to the legend and its entry", () => {
    const check = checkFigure(figure(ENTRIES));
    const ir = buildFigureIR(check);
    const frame = ir.elements.get("g:key") as GroupIR;
    expect(frame).toMatchObject({ kind: "group", component: "sumi/legend", variant: "default" });
    expect(frame.legend).toEqual({ id: "key", name: 'legend "key"' });
    expect(frame.children).toEqual([
      "n:key-1-label",
      "n:key-1-start",
      "n:key-1-end",
      "n:key-2-label",
      "n:key-2-box",
    ]);
    expect(ir.sourceMap.get("g:key")?.path).toEqual(["nodes", 2]);
    expect(ir.sourceMap.get("e:key-1-line")?.path).toEqual([
      "nodes",
      2,
      "props",
      "entries",
      0,
      "edge",
    ]);
    expect(ir.sourceMap.get("n:key-2-box")?.path).toEqual([
      "nodes",
      2,
      "props",
      "entries",
      1,
      "node",
    ]);
    expect(ir.sourceMap.get("n:key-2-label")?.path).toEqual(["nodes", 2, "props", "entries", 1]);
    expect(ir.elements.get("e:key-1-line")?.legend?.name).toBe(
      'the sample line of entry 1 of legend "key"',
    );
    // The author's elements carry no legend.
    expect(ir.elements.get("n:a")?.legend).toBeUndefined();
    expect(ir.elements.get("e:#0")?.legend).toBeUndefined();
  });

  test("samples scale with the entries' text size", () => {
    expect(legendSizes(8, 0.5)).toEqual({ sample: 20, box: 9, textGap: 4, rowGap: 3, line: 19 });
    expect(legendSizes(16, 0.5)).toEqual({ sample: 40, box: 18, textGap: 8, rowGap: 6, line: 39 });
    expect(LEGEND_EM.sample).toBe(2.5);
    const slides = checkFigure(figure(ENTRIES).replace("theme: academic", "theme: slides")).state;
    expect(slides.doc.nodes?.at(-1)?.props).toEqual({ width: "40pt", height: "18pt" });
  });

  test("a fixed-aspect sample box is a square of the box height", () => {
    const { state } = checkFigure(figure("        - { node: { component: circle }, label: op }"));
    expect(state.diagnostics).toEqual([]);
    expect(state.doc.nodes?.at(-1)).toMatchObject({
      id: "key-1-box",
      props: { width: "9pt", height: "9pt" },
    });
  });

  test("reserved IDs are the legend's ID, the entry number and the part", () => {
    expect(legendPartIds("key", 3)).toEqual({
      label: "key-3-label",
      box: "key-3-box",
      start: "key-3-start",
      end: "key-3-end",
      line: "key-3-line",
    });
  });
});

describe("diagnostics", () => {
  test("auto figures reject a legend with layout/structured-only at its component", () => {
    const { state } = checkFigure(`version: 1
figure: { id: f }
nodes:
  - id: key
    component: legend
    props: { entries: [{ edge: {}, label: flow }] }
`);
    expect(summarize(state.diagnostics)).toEqual([
      ["layout/structured-only", ["nodes", 0, "component"], 5, 16],
    ]);
    expect(state.diagnostics[0]?.message).toBe(
      "sumi/legend needs the structured layout engine, but this figure uses the auto engine.",
    );
    expect(state.doc.legends).toBeUndefined();
  });

  test("a node with a reserved ID is an error at its ID, related to the entry", () => {
    const { state } = checkFigure(
      figure(ENTRIES, {
        nodes:
          "  - { id: key-2-box, component: box, label: Mine, attach: { to: a, side: south } }\n",
      }),
    );
    expect(summarize(state.diagnostics)).toEqual([["ref/reserved-id", ["nodes", 3, "id"], 16, 11]]);
    const [error] = state.diagnostics;
    expect(error?.message).toBe('The ID "key-2-box" is reserved for entry 2 of legend "key".');
    expect(error?.related).toEqual([
      {
        path: ["nodes", 2, "props", "entries", 1],
        location: { line: 15, column: 11, endLine: 15, endColumn: 51 },
        message: "The legend entry is written here.",
      },
    ]);
    // Not expanded.
    expect(state.doc.legends).toBeUndefined();
    expect(state.doc.groups).toEqual([]);
  });

  test("a group or an edge with a reserved ID is reported too", () => {
    const group = checkFigure(
      figure(ENTRIES)
        .replace("nodes:\n", "groups:\n  - { id: key-1-label, label: Mine }\nnodes:\n")
        .replace("items: [a, b, key]", "items: [a, b, key, key-1-label]"),
    );
    expect(summarize(group.state.diagnostics)).toEqual([
      ["ref/reserved-id", ["groups", 0, "id"], 8, 11],
    ]);
    expect(group.state.diagnostics[0]?.subject).toEqual({ kind: "group", id: "key-1-label" });
    const edge = checkFigure(
      figure(ENTRIES, { edges: "  - { id: key-1-line, from: b, to: a }\n" }),
    );
    expect(summarize(edge.state.diagnostics)).toEqual([
      ["ref/reserved-id", ["edges", 1, "id"], 18, 11],
    ]);
    expect(edge.state.diagnostics[0]?.message).toBe(
      'The ID "key-1-line" is reserved for the sample line of entry 1 of legend "key".',
    );
  });

  test("entries need exactly one of edge and node, and a label", () => {
    const { state } = checkFigure(
      figure(`        - { label: nothing }
        - { edge: {}, node: {}, label: both }
        - { edge: {} }`),
    );
    expect(summarize(state.diagnostics)).toEqual([
      ["component/invalid-prop", ["nodes", 2, "props", "entries", 0], 14, 11],
      ["component/invalid-prop", ["nodes", 2, "props", "entries", 1], 15, 11],
      ["component/invalid-prop", ["nodes", 2, "props", "entries", 2, "label"], 16, 11],
    ]);
    expect(state.diagnostics[0]?.message).toBe(
      'Invalid prop "entries[0]" for sumi/legend: an entry needs exactly one of "edge" or "node".',
    );
  });

  test("a sample's unknown component or variant points at the entry's field", () => {
    const { state } = checkFigure(
      figure(`        - { edge: { component: arow }, label: flow }
        - { node: { variant: bold }, label: box }`),
    );
    expect(summarize(state.diagnostics)).toEqual([
      // Parts are resolved groups, nodes, then edges: the sample box first.
      ["component/unknown-variant", ["nodes", 2, "props", "entries", 1, "node", "variant"], 15, 30],
      ["component/unknown", ["nodes", 2, "props", "entries", 0, "edge", "component"], 14, 32],
    ]);
    expect(state.diagnostics[0]?.subject).toEqual({ kind: "node", id: "key" });
  });

  test("a sample box must be a shape", () => {
    const { state } = checkFigure(
      figure("        - { node: { component: junction }, label: split }"),
    );
    expect(summarize(state.diagnostics)).toEqual([
      ["component/invalid-prop", ["nodes", 2, "props", "entries", 0, "node", "component"], 14, 32],
    ]);
    expect(state.diagnostics[0]?.message).toBe(
      'Invalid prop "entries[0].node.component" for sumi/legend: sumi/junction is drawn as a fixed mark, so it cannot be a sample box.',
    );
  });

  test("label math errors point into the entry's label", () => {
    const { state } = checkFigure(figure("        - { edge: {}, label: '$\\\\frac{a}{b}$' }"));
    expect(summarize(state.diagnostics)).toEqual([
      ["component/invalid-math", ["nodes", 2, "props", "entries", 0, "label"], 14, 32],
    ]);
  });

  test("a legend cannot be attached or carry an icon", () => {
    const attached = checkFigure(
      figure(ENTRIES)
        .replace("items: [a, b, key]", "items: [a, b]")
        .replace("component: legend", "component: legend\n    attach: { to: a, side: south }"),
    );
    expect(summarize(attached.state.diagnostics)).toEqual([
      ["layout/attached-legend", ["nodes", 2, "attach"], 12, 13],
    ]);
    const icon = checkFigure(figure(ENTRIES, { key: "\n    icon: tabler/key" }));
    expect(summarize(icon.state.diagnostics)).toEqual([
      ["asset/icon-unsupported", ["nodes", 2, "icon"], 12, 11],
    ]);
  });

  test("a legend's frame and parts stay out of the structural counts", () => {
    const only = lintFigure(`version: 1
figure:
  id: f
  layout: { arrange: { stack: { items: [key] } } }
nodes:
  - id: key
    component: legend
    props: { entries: [{ edge: {}, label: flow }] }
`);
    // Not an empty figure, and the sample line is not the author's edge.
    expect(only.diagnostics.map((d) => d.code)).toEqual(["lint/unused-legend-entry"]);
    const two = lintFigure(`version: 1
figure:
  id: f
  layout: { arrange: { stack: { items: [a, b, key] } } }
nodes:
  - { id: a, component: box, label: A }
  - { id: b, component: box, label: B }
  - id: key
    component: legend
    props: { entries: [{ node: {}, label: block }] }
`);
    expect(two.diagnostics.map((d) => [d.code, d.message])).toEqual([
      ["lint/no-edges", "The figure has 2 nodes but no edges."],
    ]);
  });
});

describe("lint/unused-legend-entry", () => {
  test("an entry whose fields match no edge or node is a warning at the entry", () => {
    const report = lintFigure(
      figure(`        - { edge: { variant: dashed }, label: skip }
        - { edge: {}, label: flow }
        - { node: { tone: blue }, label: encoder }
        - { node: { tone: red }, label: decoder }
        - { node: { component: circle }, label: op }`),
    );
    expect(summarize(report.diagnostics)).toEqual([
      ["lint/unused-legend-entry", ["nodes", 2, "props", "entries", 1], 15, 11],
      ["lint/unused-legend-entry", ["nodes", 2, "props", "entries", 3], 17, 11],
    ]);
    expect(report.diagnostics.map((d) => d.message)).toEqual([
      'Entry 2 of legend "key" ("flow") explains no edge: no edge of the figure has sumi/arrow, variant "default".',
      'Entry 4 of legend "key" ("decoder") explains no node: no node of the figure has sumi/box, variant "default", tone "red".',
    ]);
    expect(report.diagnostics[0]?.subject).toEqual({ kind: "node", id: "key" });
    expect(report.diagnostics[0]?.severity).toBe("warning");
  });

  test("another legend's samples do not count as uses", () => {
    const report = lintFigure(
      figure(ENTRIES, {
        nodes: "  - id: key2\n    component: legend\n    attach: null\n",
      })
        .replace(
          "    attach: null\n",
          "    props: { entries: [{ edge: { component: line }, label: line }] }\n",
        )
        .replace("items: [a, b, key]", "items: [a, b, key, key2]"),
    );
    expect(report.diagnostics.map((d) => [d.code, d.path])).toEqual([
      ["lint/unused-legend-entry", ["nodes", 3, "props", "entries", 0]],
    ]);
  });
});

test("the manifest declares the structured engine only", () => {
  const manifest = createBuiltinRegistry().get("sumi/legend") as NodeManifest;
  expect(manifest.engines).toEqual(["structured"]);
  expect(manifest.variants).toEqual(["default", "plain"]);
});

describe("manifest engines (#131)", () => {
  const box = () => ({ ...(createBuiltinRegistry().get("sumi/box") as NodeManifest) });

  test("must be a non-empty list of distinct engines", () => {
    for (const engines of [[], ["auto", "auto"], ["d2"]]) {
      const result = createBuiltinRegistry().register({
        ...box(),
        namespace: "acme",
        engines,
      } as unknown as NodeManifest);
      expect(result.diagnostics.map((d) => d.code)).toEqual(["component/invalid-manifest"]);
    }
  });

  test("a component the figure's engine cannot draw is an error at its reference", () => {
    const registry = createBuiltinRegistry();
    const registered = registry.register({ ...box(), namespace: "acme", engines: ["auto"] });
    expect(registered.ok).toBe(true);
    const { state } = checkFigure(
      `version: 1
figure:
  id: f
  layout: { arrange: { stack: { items: [a] } } }
nodes:
  - { id: a, component: acme/box, label: A }
`,
      { registry },
    );
    expect(summarize(state.diagnostics)).toEqual([
      ["layout/auto-only", ["nodes", 0, "component"], 6, 25],
    ]);
    expect(state.diagnostics[0]?.message).toBe(
      "acme/box needs the auto layout engine, but this figure uses the structured engine.",
    );
  });
});
