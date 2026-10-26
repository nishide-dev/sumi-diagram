/**
 * Every run of label math keeps its font in the PDF and the picture PPTX
 * (#112, design doc §6.24), for every supported command and ASCII symbol:
 * next to math-italic letters (`$y \nabla x$`), next to text (`y $\nabla$ x`)
 * and next to CJK text the math font lacks (`損失 $\nabla x$`).
 *
 * The engine (usvg) shapes a text chunk with each run's font; a font lacking
 * another run's character used to make it fall back for the whole run.
 */

import { describe, expect, test } from "bun:test";
import { basename } from "node:path";
import {
  ASCII_SYMBOLS,
  FUNCTION_COMMANDS,
  SPACE_COMMANDS,
  SYMBOL_COMMANDS,
} from "../core/label/symbols";
import { DEFAULT_FONT_SET_ID, getFontSet } from "../core/theme/fonts";
import { fontFileFor, type MeasuredRun, measureLabel } from "../lint/geometry/measure";
import { svgToPdf } from "./pdf";
import { inspectPdf, textLines } from "./pdf/testing";
import { svgToPptx } from "./pptx";
import { readPptx } from "./pptx/testing";
import { type RenderedStructuredFigure, renderFigure } from "./render";
import { attribute, descendants, parseXml, textContent } from "./xml";

const escapeText = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const fonts = getFontSet(DEFAULT_FONT_SET_ID);
if (fonts === undefined) throw new Error("no default font set");
const fontSet = fonts;

/** Every command and ASCII symbol of label math, as typed in a label. */
const SYMBOLS = [
  ...[...SYMBOL_COMMANDS.keys()].map((name) => `\\${name}`),
  ...[...FUNCTION_COMMANDS].map((name) => `\\${name}`),
  ...[...SPACE_COMMANDS.keys()].map((name) => `\\${name}`),
  ...ASCII_SYMBOLS.keys(),
];

/** The labels: each symbol between math-italic letters, between text, and after CJK text. */
const LABELS = SYMBOLS.flatMap((s) => [`$y ${s} x$`, `y $${s}$ x`, `損失 $${s} x$`]);

/** A structured figure with one `label` node per label, in columns of 40. */
function figure(labels: readonly string[]): string {
  const ids = labels.map((_, i) => `n${i}`);
  const columns: string[] = [];
  for (let i = 0; i < ids.length; i += 40) {
    columns.push(`{ stack: { gap: 1mm, items: [${ids.slice(i, i + 40).join(", ")}] } }`);
  }
  // JSON strings are YAML double-quoted scalars.
  const nodes = labels.map(
    (label, i) => `  - { id: n${i}, component: label, label: ${JSON.stringify(label)} }`,
  );
  return `version: 1
figure:
  id: math-fonts
  theme: minimal
  profile: paper-double
  layout:
    arrange:
      row: { gap: 4mm, items: [${columns.join(", ")}] }
nodes:
${nodes.join("\n")}
edges: []
`;
}

let rendered: RenderedStructuredFigure | undefined;
async function render(): Promise<RenderedStructuredFigure> {
  if (rendered !== undefined) return rendered;
  const result = await renderFigure(figure(LABELS), {
    backend: {
      name: "d2-cli",
      render: () => {
        throw new Error("a structured figure must not reach the D2 backend");
      },
    },
  });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  rendered = result.value as RenderedStructuredFigure;
  return rendered;
}

/** Each label's measured runs (with their font class), in document order. */
async function measuredRuns(): Promise<MeasuredRun[][]> {
  const { inspection } = await render();
  const out: MeasuredRun[][] = [];
  for (const element of inspection.elements) {
    for (const label of element.labels) {
      const runs = measureLabel(label, fontSet).runs?.flat();
      if (runs === undefined) throw new Error(`"${label.text}" is not drawn as runs`);
      out.push(runs);
    }
  }
  return out;
}

/** The `minimal` theme's text color. */
const TEXT_COLOR = "#1f2328";

/** The PostScript name a PDF gives the font file of a font class (the bundled files are named so). */
const postScriptName = (font: string) => basename(fontFileFor(font, fontSet), ".ttf");

describe("label math keeps each run's font (#112)", () => {
  test("the command table is covered", async () => {
    expect(SYMBOLS.length).toBeGreaterThan(150);
    expect((await measuredRuns()).length).toBe(LABELS.length);
  });

  test("PDF: every glyph of every run is drawn with the run's font, where it was measured", async () => {
    const { svg, inspection } = await render();
    const pdf = svgToPdf(svg);
    if (!pdf.ok) throw new Error(JSON.stringify(pdf.diagnostics));
    const inspected = inspectPdf(pdf.value);
    const pageHeight = inspected.pages[0]?.mediaBox[3] ?? 0;
    const vb = inspection.canvas.viewBox;
    const lines = new Set(textLines(inspected.glyphs));
    const wrong: string[] = [];
    for (const runs of await measuredRuns()) {
      for (const run of runs) {
        if (run.text.trim() === "") continue;
        // A whitespace-only run draws nothing; a run's own spaces may be dropped at its ends.
        const text = run.text.trim();
        const baseline = pageHeight - (run.baseline - vb.y) * 0.5;
        const hit = [...lines].find(
          (l) =>
            l.text.trim() === text &&
            Math.abs(l.y - baseline) < 0.01 &&
            l.x0 >= (run.box.x - vb.x) * 0.5 - 0.01 &&
            l.x1 <= (run.box.x + run.box.width - vb.x) * 0.5 + 0.01,
        );
        const expected = postScriptName(run.font);
        if (hit === undefined) {
          wrong.push(`"${run.text}" (${run.font}): not drawn as one run`);
          continue;
        }
        lines.delete(hit);
        const actual = hit.font.replace(/^[A-Z]{6}\+/, "");
        if (actual !== expected)
          wrong.push(`"${run.text}" (${run.font}): ${actual}, not ${expected}`);
      }
    }
    expect(wrong).toEqual([]);
    expect([...lines].map((l) => l.text).filter((t) => t.trim() !== "")).toEqual([]);
    expect(inspected.fonts.map((f) => f.baseFont.replace(/^[A-Z]{6}\+/, "")).sort()).toEqual([
      "BIZUDPGothic-Regular",
      "STIXTwoMath-Regular",
      "STIXTwoText-Italic",
    ]);
  });

  test("picture PPTX: the outlines equal those of each run drawn alone in its font", async () => {
    const { svg } = await render();
    const labels = await measuredRuns();
    // The same figure with every run as its own <text> at its measured
    // position: one font per text, so nothing can fall back across runs.
    const parsed = parseXml(svg);
    if (!parsed.ok) throw new Error(parsed.message);
    let alone = "";
    let copied = 0;
    let texts = 0;
    for (const element of descendants(parsed.root)) {
      if (element.name !== "text") continue;
      const runs = labels[texts++] ?? [];
      // The inspection lists labels in document order.
      expect(runs.map((r) => r.text).join("")).toBe(textContent(element));
      const fill = attribute(element, "fill");
      expect(fill).toBe(TEXT_COLOR);
      const own = runs
        .map(
          (r) =>
            `<text x="${r.box.x}" y="${r.baseline}" fill="${fill}" class="${r.font === "regular" ? "text" : `text-${r.font}`}" xml:space="preserve" style="text-anchor:start;font-size:${r.fontSizeUnits}px;font-kerning:none">${escapeText(r.text)}</text>`,
        )
        .join("");
      alone += svg.slice(copied, element.start) + own;
      copied = element.end;
    }
    alone += svg.slice(copied);
    expect(texts).toBe(LABELS.length);

    const outlines = (input: string): string[] => {
      const pptx = svgToPptx(input, { fontSet });
      if (!pptx.ok) throw new Error(JSON.stringify(pptx.diagnostics));
      const outlined = new TextDecoder().decode(readPptx(pptx.value).get("ppt/media/figure.svg"));
      const tree = parseXml(outlined);
      if (!tree.ok) throw new Error(tree.message);
      // Glyphs are the paths in the text color (no edges or shapes in this figure).
      return [...descendants(tree.root)]
        .filter((e) => e.name === "path" && attribute(e, "fill") === TEXT_COLOR)
        .map((e) => attribute(e, "d") ?? "");
    };
    const actual = outlines(svg);
    const expected = outlines(alone);
    // Most runs draw something (not the whitespace-only ones).
    expect(actual.length).toBeGreaterThan(LABELS.length * 2);
    expect(actual.length).toBe(expected.length);
    const numbers = (d: string) => (d.match(/-?[\d.]+(?:e-?\d+)?/g) ?? []).map(Number);
    const commands = (d: string) => d.replace(/-?[\d.]+(?:e-?\d+)?/g, "").replace(/\s+/g, "");
    const differing = actual.flatMap((d, i) => {
      const e = expected[i] ?? "";
      const [a, b] = [numbers(d), numbers(e)];
      const same =
        commands(d) === commands(e) &&
        a.length === b.length &&
        a.every((v, j) => Math.abs(v - (b[j] ?? Number.NaN)) < 0.01);
      return same ? [] : [i];
    });
    expect(differing).toEqual([]);
  });
});
