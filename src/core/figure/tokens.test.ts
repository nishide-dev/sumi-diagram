import { describe, expect, test } from "bun:test";
import { buildFigureIR, type NodeIR } from "../../compiler/ir";
import { lintFigure } from "../../lint/lint";
import { checkFigure } from "../check";
import { edgeKey, nodeKey } from "../check-state";

/** A structured figure: the box `a` above the tokens `seq` (props as YAML lines), and `extra`. */
const figure = (
  props: string,
  options: { nodes?: string; edges?: string; items?: string; seq?: string; layout?: string } = {},
) =>
  `version: 1
figure:
  id: f
  theme: color
  layout:
    arrange: { stack: { items: [a, seq${options.items ?? ""}] } }
${options.layout ?? ""}nodes:
  - { id: a, component: box, label: A }
  - id: seq
    component: tokens${options.seq ?? ""}
    props:
${props}
${options.nodes ?? ""}edges:
${options.edges ?? "  - { from: a, to: seq.x }"}
`;

const CELLS = `      gap: 1.5pt
      height: 14pt
      cells:
        - { id: x, label: X, width: 30pt, tone: gray }
        - '$A_1$'
        - { label: '…', component: label }`;

const summarize = (
  diagnostics: { code: string; path?: unknown; location?: { line: number; column: number } }[],
) => diagnostics.map((d) => [d.code, d.path, d.location?.line ?? 0, d.location?.column ?? 0]);

const codesOf = (source: string) =>
  summarize(checkFigure(source).state.diagnostics).map(([code, path]) => [code, path]);

describe("expansion (#181)", () => {
  test("each cell becomes a node; the tokens' arrange item becomes a row of them", () => {
    const { state } = checkFigure(figure(CELLS, { seq: "\n    tone: purple" }));
    expect(state.diagnostics).toEqual([]);
    const { doc } = state;
    // The tokens node is gone: nothing is drawn for it.
    expect(doc.nodes?.[1]).toBeUndefined();
    expect(doc.nodes?.slice(2)).toEqual([
      {
        id: "seq-x",
        component: "box",
        label: "X",
        variant: "default",
        tone: "gray",
        props: { width: "30pt", height: "14pt" },
      },
      {
        id: "seq-2",
        component: "box",
        label: "$A_1$",
        variant: "default",
        tone: "purple",
        props: { height: "14pt" },
      },
      {
        id: "seq-3",
        component: "label",
        label: "…",
        variant: "default",
        tone: "purple",
        props: { height: "14pt" },
      },
    ]);
    expect(doc.figure?.layout.arrange).toEqual({
      stack: {
        direction: "down",
        items: ["a", { row: { direction: "right", gap: 1.5, items: ["seq-x", "seq-2", "seq-3"] } }],
      },
    });
    // The edge's cell reference is the cell's ID now.
    expect(doc.edges?.[0]).toMatchObject({ from: "a", to: "seq-x" });
    expect(doc.tokens).toEqual([
      {
        id: "seq",
        path: ["nodes", 1],
        variant: "default",
        cells: [
          { key: "x", id: "seq-x", path: ["nodes", 1, "props", "cells", 0] },
          { key: "2", id: "seq-2", path: ["nodes", 1, "props", "cells", 1] },
          { key: "3", id: "seq-3", path: ["nodes", 1, "props", "cells", 2] },
        ],
      },
    ]);
    expect(doc.expanded?.get(nodeKey("seq-2"))).toEqual({
      from: "tokens",
      path: ["nodes", 1, "props", "cells", 1],
      subject: { kind: "node", id: "seq" },
      name: 'cell "2" of tokens "seq"',
    });
    // The cells are resolved like written nodes; the tokens node has no component left.
    expect(state.components?.get(nodeKey("seq-3"))?.id).toBe("sumi/label");
    expect(state.components?.has(nodeKey("seq"))).toBe(false);
  });

  test("a stack, align, cell defaults and a cell alone", () => {
    const { state } = checkFigure(
      figure(
        `      direction: up
      gap: 2pt
      align: start
      component: square
      variant: muted
      width: 9pt
      cells: [{ id: x, label: X, variant: emphasis }, Y]`,
        { nodes: "  - { id: one, component: tokens, props: { cells: [Z] } }\n", items: ", one" },
      ),
    );
    expect(state.diagnostics).toEqual([]);
    const { doc } = state;
    expect(doc.figure?.layout.arrange).toEqual({
      stack: {
        direction: "down",
        items: [
          "a",
          { stack: { direction: "up", gap: 2, align: "start", items: ["seq-x", "seq-2"] } },
          "one-1",
        ],
      },
    });
    const byId = new Map(doc.nodes?.flatMap((n) => (n ? [[n.id, n]] : [])));
    expect(byId.get("seq-x")).toMatchObject({ component: "square", variant: "emphasis" });
    expect(byId.get("seq-2")).toMatchObject({ component: "square", variant: "muted" });
    expect(byId.get("one-1")).toMatchObject({ component: "box", label: "Z", props: {} });
  });

  test("lines: the runs below one another, a line of one cell is the cell itself", () => {
    const { state } = checkFigure(
      figure(
        `      gap: 1pt
      lineAlign: center
      lines: [[W], [{ id: x, label: A, tone: orange }, S, D]]`,
      ),
    );
    expect(state.diagnostics).toEqual([]);
    expect(state.doc.figure?.layout.arrange?.stack?.items[1]).toEqual({
      stack: {
        direction: "down",
        gap: 1,
        align: "center",
        items: [
          "seq-1",
          { row: { direction: "right", gap: 1, items: ["seq-x", "seq-3", "seq-4"] } },
        ],
      },
    });
    // Lines across a stack are side by side, with their own gap.
    const down = checkFigure(
      figure(
        "      direction: down\n      gap: 1pt\n      lineGap: 3pt\n      lines: [[x, y], [z]]",
        {
          edges: "  - { from: a, to: seq.3 }",
        },
      ),
    ).state;
    expect(down.diagnostics).toEqual([]);
    expect(down.doc.figure?.layout.arrange?.stack?.items[1]).toEqual({
      row: {
        direction: "right",
        gap: 3,
        items: [{ stack: { direction: "down", gap: 1, items: ["seq-1", "seq-2"] } }, "seq-3"],
      },
    });
  });

  test("tokens inside a group: the cells are its children and its tree holds them", () => {
    const source = `version: 1
figure: { id: f, layout: { arrange: { row: { items: [g] } } } }
groups:
  - { id: g, arrange: { row: { items: [seq] } } }
nodes:
  - { id: seq, component: tokens, props: { cells: [A, B] } }
`;
    const { state } = checkFigure(source);
    expect(state.diagnostics).toEqual([]);
    expect(state.doc.groups?.[0]?.arrange).toEqual({
      row: {
        direction: "right",
        items: [{ row: { direction: "right", items: ["seq-1", "seq-2"] } }],
      },
    });
    expect(state.doc.nodes?.slice(1).map((n) => n?.group)).toEqual(["g", "g"]);
  });

  test("cell references in attach and align, and anchors on cells", () => {
    const { state } = checkFigure(
      figure(CELLS, {
        nodes: "  - { id: note, component: label, label: n, attach: { to: seq.2, side: south } }\n",
        layout: "    align: [{ x: [a, seq.x] }]\n",
        edges:
          "  - { from: a, to: seq.x, toAnchor: straight }\n  - { from: a, to: seq.2, toAnchor: north }",
      }),
    );
    expect(state.diagnostics).toEqual([]);
    const { doc } = state;
    expect(doc.nodes?.[2]?.attach).toEqual({ to: "seq-2", side: "south" });
    expect(doc.figure?.layout.align).toEqual([{ x: ["a", "seq-x"] }]);
    expect(doc.edges?.map((e) => e?.to)).toEqual(["seq-x", "seq-2"]);
  });
});

describe("the figure IR and lint (#181)", () => {
  test("cells carry the tokens node; no lint/empty-label for blank cells", () => {
    const source = figure("      cells: [{ id: x }, {}, B]", {
      edges: "  - { from: a, to: seq.x }",
    });
    const check = checkFigure(source);
    expect(check.state.diagnostics).toEqual([]);
    const ir = buildFigureIR(check);
    const cell = ir.elements.get(nodeKey("seq-x")) as NodeIR;
    expect(cell.tokens).toEqual({
      id: "seq",
      variant: "default",
      name: 'cell "x" of tokens "seq"',
    });
    expect(ir.sourceMap.get(nodeKey("seq-x"))?.path).toEqual(["nodes", 1, "props", "cells", 0]);
    expect((ir.elements.get(nodeKey("a")) as NodeIR).tokens).toBeUndefined();
    expect(ir.elements.get(edgeKey(undefined, 0))).toMatchObject({ to: nodeKey("seq-x") });
    expect(lintFigure(source).diagnostics).toEqual([]);
  });

  test("the cells are the author's nodes for lint/no-edges", () => {
    const source = `version: 1
figure: { id: f, layout: { arrange: { row: { items: [seq] } } } }
nodes:
  - { id: seq, component: tokens, props: { cells: [A, B] } }
`;
    expect(lintFigure(source).diagnostics.map((d) => d.code)).toEqual(["lint/no-edges"]);
  });

  test("a cell's diagnostics point at the cell", () => {
    const source = figure(
      "      cells: [A, { label: '$\\\\frac$' }, { label: B, variant: nope }]",
      {
        edges: "  - { from: a, to: seq.1 }",
      },
    );
    expect(codesOf(source)).toEqual([
      ["component/invalid-math", ["nodes", 1, "props", "cells", 1, "label"]],
      ["component/unknown-variant", ["nodes", 1, "props", "cells", 2, "variant"]],
    ]);
  });
});

describe("errors (#181)", () => {
  test("a cell reference to an unknown cell or to a node that is not tokens", () => {
    expect(
      codesOf(
        figure(CELLS, {
          edges:
            "  - { from: a, to: seq.y }\n  - { from: a.x, to: seq.x }\n  - { from: nope.x, to: a }",
        }),
      ),
    ).toEqual([
      ["ref/unknown-endpoint", ["edges", 2, "from"]],
      ["ref/unknown-cell", ["edges", 0, "to"]],
      ["ref/unknown-cell", ["edges", 1, "from"]],
    ]);
    const [unknown] = checkFigure(figure(CELLS, { edges: "  - { from: a, to: seq.y }" })).state
      .diagnostics;
    expect(unknown?.message).toBe('Unknown cell "y" of tokens "seq" in edge edges[0].');
    expect(unknown?.hint).toBe(
      'A cell is named by its id, or by its 1-based position when it has none. Did you mean "x"?',
    );
  });

  test("the tokens node itself as an endpoint, attach target or align item", () => {
    const found = codesOf(
      figure(CELLS, {
        nodes: "  - { id: note, component: label, label: n, attach: { to: seq, side: south } }\n",
        layout: "    align: [{ x: [a, seq] }]\n",
        edges: "  - { from: a, to: seq }",
      }),
    );
    expect(found).toHaveLength(3);
    expect(found).toContainEqual([
      "ref/tokens-reference",
      ["figure", "layout", "align", 0, "x", 1],
    ]);
    expect(found).toContainEqual(["ref/tokens-reference", ["nodes", 2, "attach", "to"]]);
    expect(found).toContainEqual(["ref/tokens-reference", ["edges", 0, "to"]]);
  });

  test("an element that uses a cell's ID, and two tokens that make the same ID", () => {
    expect(
      codesOf(
        figure(CELLS, {
          nodes: "  - { id: seq-x, component: box, label: taken }\n",
          items: ", seq-x",
          edges: "  - { from: a, to: seq-x }",
        }),
      ),
    ).toEqual([["ref/reserved-id", ["nodes", 2, "id"]]]);
    // p-q expands first (p-q-1); p's cell q-1 makes the same ID.
    const source = `version: 1
figure: { id: f, layout: { arrange: { row: { items: [p, p-q] } } } }
nodes:
  - { id: p-q, component: tokens, props: { cells: [A] } }
  - { id: p, component: tokens, props: { cells: [{ id: q-1, label: B }] } }
edges: []
`;
    expect(codesOf(source)).toEqual([["ref/reserved-id", ["nodes", 0, "props", "cells", 0, "id"]]]);
  });

  test("cells: duplicated or too long IDs, components that cannot be cells", () => {
    expect(codesOf(figure("      cells: [{ id: x }, { id: x }]"))).toEqual([
      ["component/invalid-prop", ["nodes", 1, "props", "cells", 1, "id"]],
    ]);
    const long = "c".repeat(62);
    expect(codesOf(figure(`      cells: [{ id: x }, { id: ${long} }]`))).toEqual([
      ["component/invalid-prop", ["nodes", 1, "props", "cells", 1, "id"]],
    ]);
    expect(codesOf(figure("      cells: [{ id: x, component: operator }]"))).toEqual([
      ["component/invalid-prop", ["nodes", 1, "props", "cells", 0, "component"]],
    ]);
    expect(codesOf(figure("      component: tokens\n      cells: [{ id: x }]"))).toEqual([
      ["component/invalid-prop", ["nodes", 1, "props", "component"]],
    ]);
    expect(codesOf(figure("      cells: [{ id: x, component: nope }]"))).toEqual([
      ["component/unknown", ["nodes", 1, "props", "cells", 0, "component"]],
    ]);
    // Exactly one of cells and lines.
    // (The edge to seq.x depends on the tokens: no error of its own.)
    expect(codesOf(figure("      gap: 1pt"))).toEqual([
      ["component/invalid-prop", ["nodes", 1, "props"]],
    ]);
  });

  test("attach, a label, an icon and labelRotation on the tokens node", () => {
    const tokens = (field: string) =>
      codesOf(figure(CELLS, { seq: `\n    ${field}` })).map(([code]) => code);
    const attached = `version: 1
figure: { id: f, layout: { arrange: { row: { items: [a] } } } }
nodes:
  - { id: a, component: box, label: A }
  - { id: seq, component: tokens, attach: { to: a, side: east }, props: { cells: [B] } }
`;
    expect(codesOf(attached)).toEqual([["layout/attached-tokens", ["nodes", 1, "attach"]]]);
    expect(tokens("label: Seq")).toEqual(["component/unexpected-label"]);
    expect(tokens("icon: tabler/x")).toEqual(["asset/icon-unsupported"]);
    expect(tokens("labelRotation: 90")).toContain("component/label-rotation-unsupported");
  });

  test("auto figures: layout/structured-only, and the cell references depend on it silently", () => {
    const source = `version: 1
figure: { id: f }
nodes:
  - { id: a, component: box, label: A }
  - { id: seq, component: tokens, props: { cells: [{ id: x }] } }
edges:
  - { from: a, to: seq.x }
  - { from: seq.x, to: a.y }
`;
    expect(codesOf(source)).toEqual([["layout/structured-only", ["nodes", 1, "component"]]]);
  });

  test("a malformed cell reference is schema/invalid-id", () => {
    const [d] = checkFigure(figure(CELLS, { edges: "  - { from: a, to: seq.X }" })).state
      .diagnostics;
    expect(d?.code).toBe("schema/invalid-id");
    expect(d?.message).toBe(
      'Invalid reference "seq.X" at edges[0].to; expected an ID (^[a-z][a-z0-9_-]{0,63}$) or a tokens cell as <node>.<cell>.',
    );
    expect(d?.hint).toBe('IDs are lowercase only; use "seq.x".');
    // Without a dot, exactly as before (#181).
    const [plain] = checkFigure(figure(CELLS, { edges: "  - { from: a, to: Seq }" })).state
      .diagnostics;
    expect(plain?.message).toBe(
      'Invalid ID "Seq" at edges[0].to; IDs must match ^[a-z][a-z0-9_-]{0,63}$.',
    );
  });
});
