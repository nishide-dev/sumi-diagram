import { expect, test } from "bun:test";
import { getTheme } from "../core/theme/builtin";
import { fontSetMeasurer, measureText } from "../layout/text";
import { compileFigure } from "./compile";

test("wrapping measures the resolved Latin/CJK fonts and obeys basic Japanese punctuation rules", () => {
  const theme = getTheme("paper");
  if (!theme) throw new Error("missing theme");
  for (const text of [
    "Hello! Messages wrap at word boundaries.",
    "日本語の文章。「括弧」と句読点、長い文章も折り返します。",
    "abcdefghijklmno",
  ]) {
    const compiled = compileFigure(`version: 1
figure: {id: wrap, theme: paper}
nodes: [{ id: a, component: bubble, label: '${text}', props: {maxWidth: 40pt} }]
`);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
    const node = compiled.value.ir.nodes[0];
    if (!node) throw new Error("missing node");
    expect(node.label).toContain("\n");
    expect(node.label.replaceAll(/\s/g, "")).toBe(text.replaceAll(/\s/g, ""));
    const measured = measureText(node.label, node.style, fontSetMeasurer(theme.fontSet));
    expect(measured?.width).toBeLessThanOrEqual(80);
    for (const line of node.label.split("\n")) {
      expect(line).not.toMatch(/^[。、」）]/u);
      expect(line).not.toMatch(/[「（]$/u);
    }
  }
});
