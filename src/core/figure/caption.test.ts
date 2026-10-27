import { describe, expect, test } from "bun:test";
import { buildFigureIR, type GroupIR, type NodeIR } from "../../compiler/ir";
import { lintFigure } from "../../lint/lint";
import { checkFigure } from "../check";
import { nodeKey } from "../check-state";
import { getProfile } from "../profile/builtin";
import { captionId } from "./caption";

const structured = (groups: string, nodes = "", extra = "") => `version: 1
figure:
  id: f
  theme: academic
  layout:
    arrange: { stack: { items: [g] } }
groups:
${groups}
nodes:
  - { id: a, component: box, label: A }
${nodes}${extra}`;

const summarize = (
  diagnostics: { code: string; path?: unknown; location?: { line: number; column: number } }[],
) => diagnostics.map((d) => [d.code, d.path, d.location?.line ?? 0, d.location?.column ?? 0]);

describe("expansion (#130)", () => {
  test("a caption becomes a label node with the reserved ID and the group's parent", () => {
    const { state } = checkFigure(`version: 1
figure: { id: f }
groups:
  - { id: outer }
  - { id: g, group: outer, caption: (a) one }
nodes:
  - { id: a, component: box, label: A, group: g }
`);
    expect(state.diagnostics).toEqual([]);
    expect(captionId("g")).toBe("g-caption");
    expect(state.doc.nodes?.at(-1)).toEqual({
      id: "g-caption",
      component: "sumi/label",
      label: "(a) one",
      variant: "default",
      props: {},
      group: "outer",
    });
    expect([...(state.doc.captions ?? [])]).toEqual([
      [1, { group: "g", path: ["groups", 1, "caption"] }],
    ]);
    expect(state.components?.get(nodeKey("g-caption"))?.id).toBe("sumi/label");
  });

  test("an element with the reserved ID is an error at its ID, and the caption is not expanded", () => {
    const { state } = checkFigure(
      structured(
        "  - { id: g, caption: (a) one, arrange: { stack: { items: [a, g-caption] } } }",
        "  - { id: g-caption, component: box, label: Mine }\n",
      ),
    );
    expect(summarize(state.diagnostics)).toEqual([["ref/reserved-id", ["nodes", 1, "id"], 11, 11]]);
    const [error] = state.diagnostics;
    expect(error?.message).toBe('The ID "g-caption" is reserved for the caption of group "g".');
    expect(error?.subject).toEqual({ kind: "node", id: "g-caption" });
    expect(error?.related).toEqual([
      {
        path: ["groups", 0, "caption"],
        location: { line: 8, column: 23, endLine: 8, endColumn: 30 },
        message: "The caption is written here.",
      },
    ]);
    expect(state.doc.captions).toBeUndefined();
    expect(state.doc.nodes).toHaveLength(2);
  });

  test("a group with the reserved ID is reported too", () => {
    const { state } = checkFigure(`version: 1
figure: { id: f }
groups:
  - { id: g, caption: (a) one }
  - { id: g-caption }
`);
    expect(summarize(state.diagnostics)).toEqual([["ref/reserved-id", ["groups", 1, "id"], 5, 11]]);
  });

  test("an invalid group's caption is not expanded", () => {
    const { state } = checkFigure(`version: 1
figure: { id: f }
groups:
  - { id: g, caption: (a) one, group: nope }
`);
    expect(state.diagnostics.map((d) => d.code)).toEqual(["ref/unknown-group"]);
    expect(state.doc.captions).toBeUndefined();
  });
});

describe("diagnostics about a caption point at the caption field", () => {
  test("label math errors are located inside the caption", () => {
    const { state } = checkFigure(
      structured(
        "  - { id: g, caption: '(a) $\\frac{1}{2}$', arrange: { stack: { items: [a] } } }",
      ),
    );
    expect(summarize(state.diagnostics)).toEqual([
      ["component/invalid-math", ["groups", 0, "caption"], 8, 29],
    ]);
    expect(state.diagnostics[0]?.subject).toEqual({ kind: "group", id: "g" });
  });

  test("auto: label math in a caption is named as the caption", () => {
    const { state } = checkFigure(`version: 1
figure: { id: f }
groups:
  - { id: g, caption: "(a) $x_1$" }
`);
    expect(summarize(state.diagnostics)).toEqual([
      ["component/unsupported-in-auto", ["groups", 0, "caption"], 4, 23],
    ]);
    expect(state.diagnostics[0]?.message).toContain('the label of the caption of group "g"');
  });

  test("profile: a caption below the minimum font size", () => {
    const { state } = checkFigure(
      structured("  - { id: g, caption: (a) one, arrange: { stack: { items: [a] } } }").replace(
        "theme: academic",
        "theme: academic\n  profile: presentation-16x9",
      ),
    );
    const caption = state.diagnostics.find((d) => d.path?.[0] === "groups");
    expect(caption?.code).toBe("profile/font-too-small");
    expect(caption?.path).toEqual(["groups", 0, "caption"]);
    expect(caption?.location?.line).toBe(9);
    expect(caption?.subject).toEqual({ kind: "group", id: "g" });
    expect(caption?.message).toContain('of the caption of group "g"');
  });

  test("lint rules: a long caption, and captions are not counted as nodes", () => {
    const report = lintFigure(`version: 1
figure: { id: f }
groups:
  - { id: g, caption: "${"a very long caption ".repeat(4).trim()}" }
  - { id: h, caption: (b) two }
`);
    expect(summarize(report.diagnostics)).toEqual([
      ["lint/empty-figure", ["nodes"], 1, 1],
      ["lint/long-label", ["groups", 0, "caption"], 4, 23],
    ]);
    expect(report.diagnostics[1]?.message).toStartWith('The label of the caption of group "g" has');
  });
});

describe("IR", () => {
  const ir = (text: string) => {
    const check = checkFigure(text);
    expect(check.state.diagnostics).toEqual([]);
    return buildFigureIR(check);
  };

  test("structured: the group's place in the tree becomes a stack of the group and its caption", () => {
    const value = ir(`version: 1
figure:
  id: f
  layout:
    arrange:
      stack:
        align: stretch
        items: [g, { row: { align: stretch, items: [h] } }]
groups:
  - { id: g, caption: (a) one, arrange: { stack: { items: [a] } } }
  - { id: h, caption: (b) two, arrange: { stack: { items: [b] } } }
nodes:
  - { id: a, component: box, label: A }
  - { id: b, component: box, label: B }
  - { id: n, component: label, label: note, attach: { to: g, side: south } }
  - { id: m, component: label, label: side, attach: { to: g, side: east } }
`);
    const gap = (getProfile("paper-single")?.layout.groupPadding.pt ?? 0) / 2;
    expect(gap).toBe(4);
    expect(value.arrange).toEqual({
      kind: "stack",
      direction: "down",
      align: "stretch",
      items: [
        // In a stretching stack, the caption's stack stretches too.
        {
          kind: "stack",
          direction: "down",
          gapPt: gap,
          align: "stretch",
          items: ["g:g", "n:g-caption"],
        },
        {
          kind: "row",
          direction: "right",
          align: "stretch",
          // A row's cross axis is vertical: the caption is centred under the group.
          items: [
            {
              kind: "stack",
              direction: "down",
              gapPt: gap,
              align: "center",
              items: ["g:h", "n:h-caption"],
            },
          ],
        },
      ],
    });
    const caption = value.elements.get("n:g-caption") as NodeIR;
    expect(caption.captionOf).toBe("g:g");
    expect(caption.parent).toBeUndefined();
    expect(caption.shape).toBe("text");
    expect((value.elements.get("g:g") as GroupIR).caption).toBe("n:g-caption");
    expect(value.sourceMap.get("n:g-caption")).toEqual({
      path: ["groups", 0, "caption"],
      location: { line: 10, column: 23, endLine: 10, endColumn: 30 },
    });
    // A node attached below a captioned group goes below its caption.
    expect((value.elements.get("n:n") as NodeIR).attach?.to).toBe("n:g-caption");
    expect((value.elements.get("n:m") as NodeIR).attach?.to).toBe("g:g");
  });

  test("structured: in other boxes the caption is centred", () => {
    const value = ir(
      structured("  - { id: g, caption: (a) one, arrange: { stack: { items: [a] } } }").replace(
        "stack: { items: [g] }",
        "stack: { align: start, items: [g] }",
      ),
    );
    expect(value.arrange?.items[0]).toMatchObject({ kind: "stack", align: "center" });
  });

  test("auto: the caption node is the D2 container around its group", () => {
    const value = ir(`version: 1
figure: { id: f }
groups:
  - { id: outer, caption: (a) outer }
  - { id: g, group: outer, caption: (i) inner }
nodes:
  - { id: a, component: box, label: A, group: g }
`);
    expect((value.elements.get("g:outer") as GroupIR).d2Path).toEqual([
      "n_outer-caption",
      "g_outer",
    ]);
    expect((value.elements.get("n:g-caption") as NodeIR).d2Path).toEqual([
      "n_outer-caption",
      "g_outer",
      "n_g-caption",
    ]);
    expect((value.elements.get("n:a") as NodeIR).d2Path).toEqual([
      "n_outer-caption",
      "g_outer",
      "n_g-caption",
      "g_g",
      "n_a",
    ]);
    expect(value.roots).toEqual(["g:outer", "n:outer-caption"]);
  });
});
