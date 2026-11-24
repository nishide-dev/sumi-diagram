/**
 * `lint/unexplained-colors` (#643, design record 643): three or more colors,
 * at least two of them marking a kind of element, and neither a legend nor
 * text naming a color.
 */

import { describe, expect, test } from "bun:test";
import { lintFigure } from "../lint";

const CODE = "lint/unexplained-colors";

/** A sequence of four steps whose edges are colored by kind, as #639 run 8. */
const edges = (extra = { nodes: "", label: "" }) => `version: 1
figure:
  id: colors
  theme: sumi
  layout: {arrange: {row: {items: [a, b, c, d]}}}
nodes:
  - {id: a, component: box, label: Agent, tone: blue}
  - {id: b, component: box, label: Surface}
  - {id: c, component: box, label: Provider${extra.label}}
  - {id: d, component: box, label: Merchant}
${extra.nodes}edges:
  - {from: a, to: b, label: request}
  - {from: b, to: c, tone: orange, label: signed}
  - {from: c, to: d, tone: orange, label: token}
  - {from: d, to: c, tone: green, variant: dashed, label: receipt}
  - {from: c, to: b, tone: green, variant: dashed, label: receipt}
`;

const found = (text: string) => lintFigure(text).diagnostics.filter((d) => d.code === CODE);

describe("lint/unexplained-colors (#643)", () => {
  test("colored edges with no legend and no text are an info", () => {
    const hits = found(edges());
    expect(hits).toHaveLength(1);
    expect(hits[0]?.severity).toBe("info");
    expect(hits[0]?.message).toContain("orange (2 edges), green (2 edges)");
    expect(hits[0]?.hint).toContain("props.float");
  });

  test("a legend, or text that names a color, explains them", () => {
    const legend = `  - id: key
    component: legend
    props:
      float: bottom-right
      entries:
        - {edge: {tone: orange}, label: signed}
        - {edge: {tone: green, variant: dashed}, label: receipt}
`;
    expect(found(edges({ nodes: legend, label: "" }))).toEqual([]);
    expect(found(edges({ nodes: "", label: " (orange: signed)" }))).toEqual([]);
    expect(found(edges({ nodes: "", label: " (橙は署名済み)" }))).toEqual([]);
  });

  test("two colors, or one coded color, are not reported", () => {
    // Without the blue node only two colors are used.
    expect(found(edges().replace(", tone: blue", ""))).toEqual([]);
    // One edge per tone marks nothing: three colors, no code.
    const single = edges()
      .replace("  - {from: c, to: d, tone: orange, label: token}\n", "")
      .replace("  - {from: c, to: b, tone: green, variant: dashed, label: receipt}\n", "");
    expect(found(single)).toEqual([]);
  });

  test("edges in the color of their end repeat that node's color", () => {
    // Each vertex's edges in its own color, as the GCN reproduction.
    const text = `version: 1
figure:
  id: vertices
  theme: sumi
  layout: {arrange: {row: {items: [x, y, z, w]}}}
nodes:
  - {id: x, component: circle, label: X, tone: blue}
  - {id: y, component: circle, label: Y, tone: orange}
  - {id: z, component: circle, label: Z, tone: green}
  - {id: w, component: circle, label: W}
edges:
  - {from: x, to: w, tone: blue}
  - {from: w, to: x, tone: blue}
  - {from: y, to: w, tone: orange}
  - {from: w, to: y, tone: orange}
  - {from: z, to: w, tone: green}
  - {from: w, to: z, tone: green}
`;
    expect(found(text)).toEqual([]);
  });

  const panels = (labels: [string, string, string]) => `version: 1
figure:
  id: panels
  theme: sumi
  layout: {arrange: {row: {items: [left, right]}}}
groups:
  - {id: left, label: Inference, arrange: {stack: {items: [q, th, ac, r, t1, t2]}}}
  - {id: right, label: Training, arrange: {stack: {items: [base, mg, d1, e1]}}}
nodes:
  - {id: q, component: box, label: Question}
  - {id: th, component: box, label: Thought}
  - {id: ac, component: box, label: Action}
  - {id: mg, component: box, label: Merge}
  - {id: r, component: box, label: ${labels[0]}, tone: blue}
  - {id: t1, component: box, label: Search, tone: green}
  - {id: t2, component: box, label: Answer, tone: orange}
  - {id: base, component: box, label: Base model}
  - {id: d1, component: box, label: ${labels[1]}, tone: blue}
  - {id: e1, component: box, label: ${labels[2]}, tone: green}
edges:
  - {from: q, to: r}
`;

  test("nodes of one color in different groups whose labels share no word are a code", () => {
    // #639 run 6: the report and the data synthesis in blue, tools and environments in green.
    expect(found(panels(["Report", "Data synthesis", "Environments"]))).toHaveLength(1);
    // Labels that name the kind explain the color: "Attention" in every orange block.
    expect(found(panels(["Report store", "Report cache", "Search index"]))).toEqual([]);
  });

  test("a fill scheme that paints most blocks by type is not reported", () => {
    // Every labelled node toned (the DiT and Transformer reproductions): the labels name each block.
    const scheme = panels(["Report", "Data synthesis", "Environments"])
      .replace("label: Question}", "label: Question, tone: gray}")
      .replace("label: Base model}", "label: Base model, tone: gray}")
      .replace("label: Thought}", "label: Thought, tone: gray}")
      .replace("label: Action}", "label: Action, tone: gray}")
      .replace("label: Merge}", "label: Merge, tone: gray}");
    expect(found(scheme)).toEqual([]);
  });
});
