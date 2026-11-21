/**
 * Sequence diagrams (#630, design record 630) drawn end to end: the demo
 * figures (an OAuth-like exchange, an agent's tool-call loop and #603 run 9
 * redrawn) render and lint with no error or warning, run 9 fits screen-doc,
 * the editable PPTX carries the lifelines, messages and frames, `fmt` keeps
 * the box in schema order, and figures without a sequence are drawn as before.
 * Structured layout only, so no D2 is needed.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FIXTURES_DIR } from "../compiler/testing";
import { formatFigureSource } from "../core/figure/format";
import { lintRenderedFigure } from "../lint/geometry/lint";
import { svgToEditablePptx } from "./pptx";
import { readPptx } from "./pptx/testing";
import { type RenderedFigure, renderFigure } from "./render";

const DEMOS = ["oauth", "agent-loop", "mcp-mrtr"];
const source = (name: string) =>
  readFileSync(join(FIXTURES_DIR, "sequence", `${name}.sumi.yaml`), "utf8");

async function render(text: string): Promise<RenderedFigure> {
  const result = await renderFigure(text);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  return result.value;
}

describe("sequence diagrams end to end (#630)", () => {
  test.each(DEMOS)("%s renders and lints with no error or warning", async (name) => {
    const text = source(name);
    const report = await lintRenderedFigure(text, { file: `${name}.sumi.yaml` });
    const blocking = report.diagnostics.filter((d) => d.severity !== "info");
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });

  test("#603 run 9 redrawn fits screen-doc", async () => {
    const result = await renderFigure(source("mcp-mrtr"));
    if (!result.ok || !("layout" in result.value)) throw new Error("not rendered");
    const { canvas } = result.value.layout;
    // screen-doc: at most 200mm wide and 150mm tall (canvas units are half points).
    expect(canvas.width / 2).toBeLessThanOrEqual((200 * 72) / 25.4);
    expect(canvas.height / 2).toBeLessThanOrEqual((150 * 72) / 25.4);
    expect(result.diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
  });

  test.each(DEMOS)("%s formats to itself", (name) => {
    const formatted = formatFigureSource(source(name));
    if (!formatted.ok) throw new Error(JSON.stringify(formatted.diagnostics));
    expect(formatted.changed).toBe(false);
  });

  test("fmt puts a sequence and its rows in schema order", () => {
    const messy = `version: 1
figure:
  id: order
  layout:
    arrange:
      sequence:
        rows:
          - {rows: [ab], fragment: loop, weight: regular}
          - {over: [a], note: n}
        participants: [a, b]
nodes:
  - {id: a, component: box, label: A}
  - {id: b, component: box, label: B}
  - {id: n, component: box, label: N}
edges:
  - {id: ab, from: a, to: b}
`;
    const formatted = formatFigureSource(messy, { canonicalOrder: true });
    if (!formatted.ok) throw new Error(JSON.stringify(formatted.diagnostics));
    const out = formatted.text;
    expect(out.indexOf("participants:")).toBeLessThan(out.indexOf("rows:"));
    expect(out).toContain("{fragment: loop, weight: regular, rows: [ab]}");
    expect(out).toContain("{note: n, over: [a]}");
  });

  test("the editable PPTX draws the lifelines, messages, notes and frames", async () => {
    const figure = await render(source("oauth"));
    const pptx = svgToEditablePptx(figure.svg, figure.compiled.ir);
    if (!pptx.ok) throw new Error(JSON.stringify(pptx.diagnostics));
    expect(pptx.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const slide = new TextDecoder().decode(readPptx(pptx.value).get("ppt/slides/slide1.xml"));
    for (const name of [
      "e:login",
      "e:check",
      "e:seq-1-life-1-1",
      "n:consent",
      "n:seq-1-f1-label",
      "set seq-1-f1 outline",
    ])
      expect(slide).toContain(`name="${name}"`);
    // Lifelines keep their dashes.
    expect(slide).toContain("<a:custDash>");
  });
});
