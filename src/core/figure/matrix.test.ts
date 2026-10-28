import { describe, expect, test } from "bun:test";
import { buildFigureIR, type GroupIR, type NodeIR } from "../../compiler/ir";
import { lintFigure } from "../../lint/lint";
import { checkFigure } from "../check";
import { groupKey, nodeKey } from "../check-state";
import { BUILTIN_THEMES } from "../theme/builtin";
import { matrixPartIds } from "./matrix";
import { nodeOrder } from "./tokens";

/** A structured figure: the box `a`, the matrix `m` (props as YAML lines) and the legend `key`. */
const figure = (
  props: string,
  options: {
    nodes?: string;
    edges?: string;
    m?: string;
    key?: string;
    theme?: string;
    layout?: string;
    groups?: string;
    items?: string;
  } = {},
) =>
  `version: 1
figure:
  id: f
  theme: ${options.theme ?? "paper"}
  layout:
    arrange: { row: { items: [${options.items ?? "a, m, key"}] } }
${options.layout ?? ""}${options.groups ?? ""}nodes:
  - { id: a, component: box, label: A }
  - id: m
    component: matrix${options.m ?? ""}
    props:
${props}
  - id: key
    component: legend
    props:
      entries:
${options.key ?? "        - { class: m.o }\n        - { class: m.x, label: Off }"}
${options.nodes ?? ""}edges:
${options.edges ?? "  - { from: a, to: m }"}
`;

const PROPS = `      rows: [S, { label: '$A_1$', tone: purple }]
      columns: [S, '$A_1$', P]
      corner: Q / K
      cellWidth: 12pt
      cellHeight: 9pt
      gap: 1.5pt
      variant: filled
      classes:
        o: { tone: green, label: Allowed }
        x: { pattern: hatch, label: Masked }
      cells: [oxx, xoo]`;

/** PROPS with one-character classes, so the rows are read character by character. */
const SOURCE = figure(PROPS);

const summarize = (
  diagnostics: { code: string; path?: unknown; location?: { line: number; column: number } }[],
) => diagnostics.map((d) => [d.code, d.path, d.location?.line ?? 0, d.location?.column ?? 0]);

const codesOf = (source: string) =>
  summarize(checkFigure(source).state.diagnostics).map(([code, path]) => [code, path]);

describe("expansion (#180)", () => {
  test("a matrix becomes a plain frame group of header labels and cell boxes", () => {
    const { state } = checkFigure(SOURCE);
    expect(state.diagnostics).toEqual([]);
    const { doc } = state;
    // The matrix node gives way to the frame (same ID: the edge and the arrange item name it).
    expect(doc.nodes?.[1]).toBeUndefined();
    expect(doc.groups?.find((g) => g?.id === "m")).toEqual({
      id: "m",
      label: "",
      component: "sumi/container",
      variant: "plain",
      arrange: {
        stack: {
          direction: "down",
          gap: 1.5,
          align: "end",
          items: [
            {
              row: {
                direction: "right",
                gap: 1.5,
                align: "center",
                items: [
                  "m-corner",
                  {
                    row: { direction: "right", gap: 1.5, items: ["m-col-1", "m-col-2", "m-col-3"] },
                  },
                ],
              },
            },
            {
              stack: {
                direction: "down",
                gap: 1.5,
                align: "end",
                items: [
                  {
                    row: {
                      direction: "right",
                      gap: 1.5,
                      align: "center",
                      items: [
                        "m-row-1",
                        {
                          row: { direction: "right", gap: 1.5, items: ["m-1-1", "m-1-2", "m-1-3"] },
                        },
                      ],
                    },
                  },
                  {
                    row: {
                      direction: "right",
                      gap: 1.5,
                      align: "center",
                      items: [
                        "m-row-2",
                        {
                          row: { direction: "right", gap: 1.5, items: ["m-2-1", "m-2-2", "m-2-3"] },
                        },
                      ],
                    },
                  },
                ],
              },
            },
          ],
        },
      },
    });
    const parts = doc.nodes?.filter((n) => n?.group === "m") ?? [];
    expect(parts.map((n) => n?.id)).toEqual([
      "m-1-1",
      "m-1-2",
      "m-1-3",
      "m-2-1",
      "m-2-2",
      "m-2-3",
      "m-row-1",
      "m-row-2",
      "m-col-1",
      "m-col-2",
      "m-col-3",
      "m-corner",
    ]);
    expect(parts[0]).toEqual({
      id: "m-1-1",
      component: "sumi/box",
      label: "",
      variant: "filled",
      tone: "green",
      props: { width: "12pt", height: "9pt" },
      group: "m",
    });
    expect(parts[1]).toMatchObject({ id: "m-1-2", variant: "filled", props: { width: "12pt" } });
    expect(parts[1]?.tone).toBeUndefined();
    // Row headers are as high as a cell (and as wide as their text), column headers as wide.
    expect(parts[7]).toEqual({
      id: "m-row-2",
      component: "sumi/label",
      label: "$A_1$",
      variant: "default",
      tone: "purple",
      props: { height: "9pt" },
      group: "m",
    });
    expect(parts[8]).toMatchObject({ id: "m-col-1", label: "S", props: { width: "12pt" } });
    // Hatched cells and toned headers are marked for the theme stage.
    expect([...(doc.paints ?? new Map())]).toEqual([
      [nodeKey("m-1-2"), { hatch: true }],
      [nodeKey("m-1-3"), { hatch: true }],
      [nodeKey("m-2-1"), { hatch: true }],
      [nodeKey("m-row-2"), { toneText: true }],
      [nodeKey("key-2-box"), { hatch: true }],
    ]);
    expect(doc.expanded?.get(nodeKey("m-2-1"))).toEqual({
      from: "matrix",
      path: ["nodes", 1, "props", "cells", 1],
      subject: { kind: "node", id: "m" },
      name: 'cell 2, 1 (class "x") of matrix "m"',
    });
    expect(doc.expanded?.get(groupKey("m"))?.path).toEqual(["nodes", 1]);
    expect(doc.matrices?.map((x) => [x.id, x.cellVariant, Object.keys(x.classes)])).toEqual([
      ["m", "filled", ["o", "x"]],
    ]);
  });

  test("rows as lists, strings of names and strings of one-character names", () => {
    const rows = (cells: string) =>
      checkFigure(figure(PROPS.replace("cells: [oxx, xoo]", cells)))
        .state.doc.nodes?.filter((n) => n?.id.match(/^m-\d/))
        .map((n) => n?.tone ?? "-");
    expect(rows("cells: [oxx, xoo]")).toEqual(["green", "-", "-", "-", "green", "green"]);
    expect(rows('cells: ["o x x", " x  o o "]')).toEqual([
      "green",
      "-",
      "-",
      "-",
      "green",
      "green",
    ]);
    expect(rows("cells: [[o, x, x], [x, o, o]]")).toEqual([
      "green",
      "-",
      "-",
      "-",
      "green",
      "green",
    ]);
    // With a longer class name, a string is split at whitespace.
    const long = figure(
      PROPS.replace(
        "o: { tone: green, label: Allowed }",
        "on: { tone: green, label: Allowed }",
      ).replace("cells: [oxx, xoo]", "cells: [on x x, x on on]"),
      { key: "        - { class: m.on }" },
    );
    const { state } = checkFigure(long);
    expect(state.diagnostics).toEqual([]);
    expect(state.doc.nodes?.filter((n) => n?.id === "m-2-3").map((n) => n?.tone)).toEqual([
      "green",
    ]);
  });

  test("headers on the right and at the bottom, without headers, and headerWidth", () => {
    const props = PROPS.replace("cells: [oxx, xoo]", "cells: [oxx, xoo]");
    const frame = (extra: string) =>
      checkFigure(figure(`${props}\n${extra}`)).state.doc.groups?.find((g) => g?.id === "m")
        ?.arrange;
    const flipped = frame("      rowsAt: right\n      columnsAt: bottom") as {
      stack: { align: string; items: { row?: { items: unknown[] }; stack?: unknown }[] };
    };
    expect(flipped.stack.align).toBe("start");
    // The cells first, then the column headers; the corner right of them.
    expect(flipped.stack.items[0]?.stack).toBeDefined();
    expect(flipped.stack.items[1]?.row?.items.at(-1)).toBe("m-corner");
    const bare = checkFigure(
      figure(
        PROPS.replace(/ {6}rows: .*\n {6}columns: .*\n {6}corner: .*\n/, "").replace(
          "cells: [oxx, xoo]",
          "cells: [oxx, xoo]",
        ),
      ),
    );
    expect(bare.state.diagnostics).toEqual([]);
    expect(bare.state.doc.groups?.find((g) => g?.id === "m")?.arrange).toEqual({
      stack: {
        direction: "down",
        gap: 1.5,
        align: "end",
        items: [
          { row: { direction: "right", gap: 1.5, items: ["m-1-1", "m-1-2", "m-1-3"] } },
          { row: { direction: "right", gap: 1.5, items: ["m-2-1", "m-2-2", "m-2-3"] } },
        ],
      },
    });
    const wide = checkFigure(figure(`${props}\n      headerWidth: 20pt\n      headerGap: 3pt`));
    expect(wide.state.doc.nodes?.find((n) => n?.id === "m-row-1")?.props).toEqual({
      width: "20pt",
      height: "9pt",
    });
    expect(wide.state.doc.nodes?.find((n) => n?.id === "m-corner")?.props).toEqual({
      width: "20pt",
    });
    expect(JSON.stringify(wide.state.doc.groups?.find((g) => g?.id === "m")?.arrange)).toContain(
      '"gap":3',
    );
  });

  test("defaults: 10pt square cells that touch, the default variant", () => {
    const { state } = checkFigure(
      figure("      classes: { o: { label: On } }\n      cells: [oo]", {
        key: "        - { class: m.o }",
      }),
    );
    expect(state.diagnostics).toEqual([]);
    expect(state.doc.nodes?.find((n) => n?.id === "m-1-2")).toMatchObject({
      variant: "default",
      props: { width: "10pt", height: "10pt" },
    });
    expect(state.doc.groups?.find((g) => g?.id === "m")?.arrange).toEqual({
      stack: {
        direction: "down",
        gap: 0,
        align: "end",
        items: [{ row: { direction: "right", gap: 0, items: ["m-1-1", "m-1-2"] } }],
      },
    });
  });

  test("the parts take the matrix node's place in document order", () => {
    const { state } = checkFigure(SOURCE);
    const order = nodeOrder(state.doc).map((i) => state.doc.nodes?.[i]?.id);
    expect(order.slice(0, 3)).toEqual(["a", "m-1-1", "m-1-2"]);
    expect(order.indexOf("m-corner")).toBeLessThan(order.indexOf("key-1-label"));
  });

  test("the IR: cells are boxes, the frame a plain container, all traced to the matrix", () => {
    const check = checkFigure(SOURCE);
    const ir = buildFigureIR(check);
    const cell = ir.elements.get(nodeKey("m-1-2")) as NodeIR;
    expect(cell).toMatchObject({ component: "sumi/box", variant: "filled", parent: groupKey("m") });
    expect(cell.matrix).toMatchObject({ id: "m", variant: "default" });
    expect(cell.matrix?.name).toBe('cell 1, 2 (class "x") of matrix "m"');
    expect(cell.matrix?.fields).toMatchObject({
      label: ["nodes", 1, "props", "cells", 0],
      tone: ["nodes", 1, "props", "cells", 0],
      variant: ["nodes", 1, "props", "variant"],
      "props.width": ["nodes", 1, "props", "cellWidth"],
      "props.height": ["nodes", 1, "props", "cellHeight"],
    });
    expect(ir.sourceMap.get(nodeKey("m-1-2"))?.path).toEqual(["nodes", 1, "props", "cells", 0]);
    const frame = ir.elements.get(groupKey("m")) as GroupIR;
    expect(frame).toMatchObject({ component: "sumi/container", variant: "plain" });
    expect(frame.matrix?.name).toBe('matrix "m"');
    // The edge into the matrix ends at the frame.
    expect(ir.edges[0]?.to).toBe(groupKey("m"));
  });
});

describe("styles (#180)", () => {
  test("hatched cells and samples get the hatch color; toned headers the tone's line color", () => {
    for (const [id, theme] of BUILTIN_THEMES) {
      const { state } = checkFigure(
        figure(PROPS.replace("cells: [oxx, xoo]", "cells: [oxx, xoo]"), { theme: id }),
      );
      expect(state.diagnostics).toEqual([]);
      const gray = theme.toneLines.get("gray")?.stroke;
      const purple = theme.toneLines.get("purple")?.fontColor;
      const style = (key: string) => state.styles?.get(nodeKey(key));
      expect(style("m-1-2")).toMatchObject({ kind: "node", hatch: gray });
      expect(style("key-2-box")).toMatchObject({ hatch: gray });
      expect(style("m-1-1")).not.toHaveProperty("hatch");
      expect(style("key-1-box")).not.toHaveProperty("hatch");
      expect(style("m-row-2")?.fontColor).toBe(purple);
      // A header without a tone is drawn as any label.
      expect(style("m-row-1")?.fontColor).toBe(style("key-1-label")?.fontColor);
    }
  });

  test("a hatched class with a tone takes the tone's line color", () => {
    const { state } = checkFigure(
      figure(PROPS.replace("x: { pattern: hatch,", "x: { pattern: hatch, tone: orange,")),
    );
    const theme = BUILTIN_THEMES.get("paper");
    expect(state.styles?.get(nodeKey("m-1-3"))).toMatchObject({
      hatch: theme?.toneLines.get("orange")?.stroke,
      fill: "#f9e0bc",
    });
  });

  test("a dimmed group dims the hatch lines too (#175)", () => {
    const source = figure(PROPS, {
      items: "a, panel",
      groups: "groups:\n  - { id: panel, dim: true, arrange: { row: { items: [m, key] } } }\n",
    });
    const { state } = checkFigure(source);
    expect(state.diagnostics).toEqual([]);
    const dim = BUILTIN_THEMES.get("paper")?.dim;
    expect(state.styles?.get(nodeKey("m-1-2"))).toMatchObject({ hatch: dim?.stroke });
    expect(state.styles?.get(nodeKey("key-2-box"))).toMatchObject({ hatch: dim?.stroke });
    expect(state.styles?.get(nodeKey("m-row-2"))?.fontColor).toBe(dim?.fontColor);
  });
});

describe("diagnostics (#180)", () => {
  test("props are checked where they are written", () => {
    const at = (cells: string, extra = "") =>
      codesOf(figure(`${PROPS.replace("cells: [oxx, xoo]", cells)}${extra}`));
    expect(at("cells: [oxq, xoo]")).toEqual([
      ["component/invalid-prop", ["nodes", 1, "props", "cells", 0]],
    ]);
    const unknown = checkFigure(
      figure(PROPS.replace("cells: [oxx, xoo]", "cells: [[o, x, q], [x, o, o]]")),
    );
    expect(summarize(unknown.state.diagnostics)[0]?.slice(0, 2)).toEqual([
      "component/invalid-prop",
      ["nodes", 1, "props", "cells", 0, 2],
    ]);
    expect(unknown.state.diagnostics[0]?.message).toBe(
      'Invalid prop "cells[0][2]" for sumi/matrix: cell 3 of row 1 has the unknown class "q".',
    );
    expect(unknown.state.diagnostics[0]?.hint).toBe('Did you mean "o"?');
    const far = checkFigure(
      figure(PROPS.replace("cells: [oxx, xoo]", "cells: [[o, x, zz], [x, o, o]]")),
    );
    expect(far.state.diagnostics[0]?.hint).toBe("Classes of the matrix: o, x.");
    expect(at("cells: [oxx, xo]")).toEqual([
      ["component/invalid-prop", ["nodes", 1, "props", "cells", 1]],
    ]);
    expect(at("cells: [oxx]")).toEqual([["component/invalid-prop", ["nodes", 1, "props", "rows"]]]);
    expect(at("cells: [ox, xo]")).toEqual([
      ["component/invalid-prop", ["nodes", 1, "props", "columns"]],
    ]);
    const corner = figure(
      PROPS.replace(/ {6}rows: .*\n/, "").replace("cells: [oxx, xoo]", "cells: [oxx, xoo]"),
    );
    expect(codesOf(corner)).toEqual([["component/invalid-prop", ["nodes", 1, "props", "corner"]]]);
    expect(
      codesOf(
        figure("      classes: {}\n      cells: [o]", { key: "        - { node: {}, label: x }" }),
      ),
    ).toEqual([["component/invalid-prop", ["nodes", 1, "props", "classes"]]]);
  });

  test("an unknown cell variant is reported once, where it is written", () => {
    const source = figure(
      PROPS.replace("x: { pattern: hatch,", "x: { pattern: hatch, variant: dashed,"),
    );
    const { state } = checkFigure(source);
    expect(summarize(state.diagnostics)).toEqual([
      ["component/unknown-variant", ["nodes", 1, "props", "classes", "x", "variant"], 21, 39],
    ]);
    expect(state.diagnostics[0]?.message).toBe(
      'Unknown variant "dashed" for the cells of sumi/matrix (sumi/box).',
    );
    expect(codesOf(figure(PROPS.replace("variant: filled", "variant: fill")))).toEqual([
      ["component/unknown-variant", ["nodes", 1, "props", "variant"]],
    ]);
  });

  test("fields a matrix cannot draw", () => {
    const attached = figure(PROPS, { m: "\n    attach: { to: a, side: south }", items: "a, key" });
    expect(codesOf(attached)).toEqual([["layout/attached-matrix", ["nodes", 1, "attach"]]]);
    expect(codesOf(figure(PROPS, { m: "\n    icon: tabler/flame" }))).toEqual([
      ["asset/icon-unsupported", ["nodes", 1, "icon"]],
    ]);
    expect(codesOf(figure(PROPS, { m: "\n    label: M\n    sublabel: s" }))).toEqual([
      ["component/sublabel-unsupported", ["nodes", 1, "sublabel"]],
    ]);
    const turned = codesOf(figure(PROPS, { m: "\n    label: M\n    labelRotation: 90" }));
    expect(turned).toContainEqual([
      "component/label-rotation-unsupported",
      ["nodes", 1, "labelRotation"],
    ]);
    // A label is the frame's title.
    const titled = checkFigure(figure(PROPS, { m: "\n    label: Mask" }));
    expect(titled.state.diagnostics).toEqual([]);
    expect(titled.state.doc.groups?.find((g) => g?.id === "m")?.label).toBe("Mask");
  });

  test("a part's ID used elsewhere, or too long", () => {
    const { state } = checkFigure(
      figure(PROPS, {
        nodes: "  - { id: m-row-1, component: box, label: X }\n",
        items: "a, m, key, m-row-1",
      }),
    );
    expect(summarize(state.diagnostics).map(([c, p]) => [c, p])).toEqual([
      ["ref/reserved-id", ["nodes", 3, "id"]],
    ]);
    expect(state.diagnostics[0]?.message).toBe(
      'The ID "m-row-1" is reserved for a part of matrix "m".',
    );
    const id = `m${"x".repeat(58)}`;
    const long = figure(PROPS, { items: `a, ${id}, key` })
      .replace("  - id: m\n", `  - id: ${id}\n`)
      .replace("m.o", `${id}.o`)
      .replace("m.x", `${id}.x`)
      .replace("to: m }", `to: ${id} }`);
    expect(codesOf(long)).toEqual([["component/invalid-prop", ["nodes", 1, "id"]]]);
    expect(matrixPartIds.cell("m", 2, 3)).toBe("m-2-3");
  });

  test("auto figures: layout/structured-only", () => {
    const source = `version: 1
figure:
  id: f
nodes:
  - id: m
    component: matrix
    props: { classes: { o: { label: On } }, cells: [oo] }
edges: []
`;
    expect(codesOf(source)).toEqual([["layout/structured-only", ["nodes", 0, "component"]]]);
  });
});

describe("legend entries from classes (#180)", () => {
  test("a class entry draws the class's sample box with its label", () => {
    const { state } = checkFigure(SOURCE);
    const box = state.doc.nodes?.find((n) => n?.id === "key-1-box");
    expect(box).toMatchObject({ component: "box", variant: "filled", tone: "green" });
    expect(state.doc.nodes?.find((n) => n?.id === "key-1-label")?.label).toBe("Allowed");
    // The entry's own label wins.
    expect(state.doc.nodes?.find((n) => n?.id === "key-2-label")?.label).toBe("Off");
    expect(state.doc.legends?.[0]?.entries.map((e) => e.class)).toEqual([
      { matrix: "m", name: "o" },
      { matrix: "m", name: "x" },
    ]);
    expect(state.doc.expanded?.get(nodeKey("key-1-box"))?.path).toEqual([
      "nodes",
      2,
      "props",
      "entries",
      0,
      "class",
    ]);
  });

  test("names of Object.prototype are no classes (review of #211)", () => {
    for (const name of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      // As a legend entry's class.
      const entry = checkFigure(
        figure(PROPS, { key: `        - { class: m.${name}, label: Ghost }` }),
      );
      expect([
        name,
        codesOf(figure(PROPS, { key: `        - { class: m.${name}, label: Ghost }` })),
      ]).toEqual([name, [["ref/unknown-class", ["nodes", 2, "props", "entries", 0, "class"]]]]);
      expect(entry.state.doc.nodes?.some((n) => n?.id === "key-1-box")).toBe(false);
      // As a cell's class.
      const cells = figure(
        PROPS.replace("cells: [oxx, xoo]", `cells: [[o, x, ${name}], [x, o, o]]`),
      );
      expect([name, codesOf(cells)]).toEqual([
        name,
        [["component/invalid-prop", ["nodes", 1, "props", "cells", 0, 2]]],
      ]);
    }
  });

  test("__proto__ cannot name a class: it is reported, not dropped", () => {
    const source = figure(
      PROPS.replace(
        "o: { tone: green, label: Allowed }",
        '"__proto__": { tone: green, label: Allowed }',
      ),
      { key: "        - { class: m.x }" },
    );
    const { state } = checkFigure(source);
    expect(summarize(state.diagnostics).map(([code, path]) => [code, path])).toEqual([
      ["component/invalid-prop", ["nodes", 1, "props", "classes", "__proto__"]],
    ]);
    expect(state.diagnostics[0]?.message).toBe(
      'Invalid prop "classes.__proto__" for sumi/matrix: "__proto__" is reserved and cannot be used as a name.',
    );
  });

  test("unknown matrices and classes, a class without a label", () => {
    const entry = (key: string) => codesOf(figure(PROPS, { key }));
    expect(entry("        - { class: a.o }")).toEqual([
      ["ref/unknown-class", ["nodes", 2, "props", "entries", 0, "class"]],
    ]);
    const unknown = checkFigure(figure(PROPS, { key: "        - { class: m.q }" }));
    expect(summarize(unknown.state.diagnostics)).toEqual([
      ["ref/unknown-class", ["nodes", 2, "props", "entries", 0, "class"], 27, 20],
    ]);
    expect(unknown.state.diagnostics[0]?.message).toBe(
      'Unknown class "q" of matrix "m" in entry 1 of legend "key".',
    );
    expect(unknown.state.diagnostics[0]?.hint).toBe('Did you mean "o"?');
    const unlabeled = figure(
      PROPS.replace("x: { pattern: hatch, label: Masked }", "x: { pattern: hatch }"),
      {
        key: "        - { class: m.x }",
      },
    );
    expect(codesOf(unlabeled)).toEqual([
      ["component/invalid-prop", ["nodes", 2, "props", "entries", 0]],
    ]);
    // A class entry with edge or node fields too, or without either.
    expect(entry("        - { class: m.o, node: {} }")).toEqual([
      ["component/invalid-prop", ["nodes", 2, "props", "entries", 0]],
    ]);
    expect(entry("        - { class: mo }")).toEqual([
      ["component/invalid-prop", ["nodes", 2, "props", "entries", 0, "class"]],
    ]);
    // A matrix is no sample box of a node entry, and no cell of tokens.
    expect(entry("        - { node: { component: matrix }, label: m }")).toEqual([
      ["component/invalid-prop", ["nodes", 2, "props", "entries", 0, "node", "component"]],
    ]);
    const cell = figure(PROPS, {
      items: "a, m, key, seq",
      nodes:
        "  - { id: seq, component: tokens, props: { cells: [{ label: x, component: matrix }] } }\n",
    });
    expect(codesOf(cell)).toEqual([
      ["component/invalid-prop", ["nodes", 3, "props", "cells", 0, "component"]],
    ]);
    // A matrix with an error of its own: the legend is not expanded, silently.
    const broken = figure(PROPS.replace("cells: [oxx, xoo]", "cells: [oxq, xoo]"));
    expect(codesOf(broken)).toEqual([
      ["component/invalid-prop", ["nodes", 1, "props", "cells", 0]],
    ]);
  });
});

describe("lint (#180)", () => {
  test("no empty-label for cells, unused classes warned, class entries never unused", () => {
    expect(lintFigure(SOURCE).diagnostics).toEqual([]);
    const unused = lintFigure(
      figure(PROPS.replace("cells: [oxx, xoo]", "cells: [ooo, ooo]")),
    ).diagnostics;
    expect(summarize(unused)).toEqual([
      ["lint/unused-matrix-class", ["nodes", 1, "props", "classes", "x"], 21, 12],
    ]);
    expect(unused[0]?.message).toBe('Class "x" of matrix "m" is used by none of its cells.');
    expect(unused[0]?.severity).toBe("warning");
  });

  test("the matrix's parts are not counted as the author's nodes for lint/no-edges", () => {
    const source = figure(PROPS.replace("cells: [oxx, xoo]", "cells: [oxx, xoo]"), {
      edges: "  []",
      items: "m, key",
    }).replace("  - { id: a, component: box, label: A }\n", "");
    expect(lintFigure(source).diagnostics).toEqual([]);
  });
});
