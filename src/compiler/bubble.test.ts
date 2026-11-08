import { expect, test } from "bun:test";
import { parseLabel } from "../core/label/math";
import { getTheme } from "../core/theme/builtin";
import { fontSetMeasurer, measureText } from "../layout/text";
import { svgToPdf } from "../render/pdf";
import { renderFigure } from "../render/render";
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

for (const text of [String.raw`Price: \$5`, String.raw`Cost \$5; value $x$`]) {
  test(`escaped currency remains valid at default and narrow wrapping widths: ${text}`, () => {
    for (const props of ["{}", "{maxWidth: 12pt}"]) {
      const compiled = compileFigure(`version: 1
figure: {id: currency, theme: paper}
nodes: [{id: a, component: bubble, label: '${text}', props: ${props}}]
`);
      if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
      const label = compiled.value.ir.nodes[0]?.label ?? "";
      expect(label.replaceAll("\n", "").replaceAll(" ", "")).toBe(text.replaceAll(" ", ""));
      expect(parseLabel(label).ok).toBe(true);
    }
  });
}

test("punctuation backtracking keeps math atomic through structured rendering and export", async () => {
  const rendered = await renderFigure(`version: 1
figure: {id: math, theme: paper, layout: {arrange: {stack: {items: [a]}}}}
nodes: [{id: a, component: bubble, label: 'あああ$x$。', props: {maxWidth: 28pt}}]
`);
  if (!rendered.ok) throw new Error(JSON.stringify(rendered.diagnostics));
  const label = rendered.value.compiled.ir.nodes[0]?.label ?? "";
  expect(label).toContain("$x$。");
  expect(label.replaceAll("\n", "")).toBe("あああ$x$。");
  expect(parseLabel(label).ok).toBe(true);
  expect(svgToPdf(rendered.value.svg).ok).toBe(true);
});

test("backtracked opening brackets are refitted to maxWidth", () => {
  const theme = getTheme("paper");
  if (!theme) throw new Error("missing theme");
  const text = "これは（日本語メッセージ）です。";
  const compiled = compileFigure(`version: 1
figure: {id: brackets, theme: paper}
nodes: [{id: a, component: bubble, label: '${text}', props: {maxWidth: 24pt}}]
`);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  const node = compiled.value.ir.nodes[0];
  if (!node) throw new Error("missing node");
  expect(node.label.replaceAll("\n", "")).toBe(text);
  for (const line of node.label.split("\n")) {
    expect(
      measureText(line, node.style, fontSetMeasurer(theme.fontSet))?.width,
    ).toBeLessThanOrEqual(48);
    expect(line).not.toMatch(/^[。、）]/u);
    expect(line).not.toMatch(/[（]$/u);
  }
});
