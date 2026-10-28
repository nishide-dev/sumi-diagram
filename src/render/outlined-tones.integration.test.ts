/**
 * Outlined tones and edge tones (#177, design doc §6.54): the structured
 * writer and D2 draw an outlined node's frame and text and a toned edge's
 * line, arrowhead and label in the tone's line color. The structured tests
 * run without D2; the auto test needs it.
 */

import { describe, expect, test } from "bun:test";
import { createD2CliBackend } from "../backends/d2/backend";
import { checkD2Version, findD2Binary } from "../backends/d2/binary";
import { BUILTIN_THEMES } from "../core/theme/builtin";
import { lintGeometry } from "../lint/geometry";
import { svgToEditablePptx } from "./pptx/editable";
import { readPptx } from "./pptx/testing";
import { type RenderedFigure, type RenderedStructuredFigure, renderFigure } from "./render";
import { attribute, childElements, descendants, parseXml, type XmlElement } from "./xml";

const binary = findD2Binary();
const available = binary.ok && (await checkD2Version(binary.value.path)).ok;

async function render(source: string, auto = false): Promise<RenderedFigure> {
  const result = await renderFigure(source, auto ? { backend: createD2CliBackend() } : {});
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  return result.value;
}

const line = (theme: string, tone: "orange" | "purple") => {
  const color = BUILTIN_THEMES.get(theme)?.toneLines.get(tone)?.stroke;
  if (color === undefined) throw new Error(`no ${tone} line in ${theme}`);
  return color;
};

/** The SVG of one element: from its reverse-lookup class up to the next element's. */
function element(svg: string, cls: string): string {
  const start = svg.search(new RegExp(`class="[^"]*\\b${cls}\\b`));
  if (start < 0) throw new Error(`no ${cls}`);
  const next = svg.slice(start + 1).search(/class="[^"]*\bsumi-k-/);
  return svg.slice(start, next < 0 ? undefined : start + 1 + next);
}

const figure = (theme: string, engine: "structured" | "auto") => `version: 1
figure:
  id: f
  theme: ${theme}
  layout:
    ${engine === "structured" ? "arrange: { row: { gap: 12mm, items: [enc, vae] } }" : "direction: right"}
nodes:
  - { id: enc, component: box, label: Encoder, tone: purple, variant: outlined }
  - { id: vae, component: box, label: VAE, tone: orange, variant: outlined }
edges:
  - { from: enc, to: vae, tone: orange, label: z }
`;

describe("structured", () => {
  for (const theme of ["paper", "color"]) {
    test(`${theme}: outlined frames and text, a toned line, arrowhead and label`, async () => {
      const source = figure(theme, "structured");
      const rendered = await render(source);
      const { svg } = rendered;
      const purple = line(theme, "purple");
      const orange = line(theme, "orange");
      const enc = element(svg, "sumi-k-n--enc");
      expect(enc).toContain(`stroke="${purple}"`);
      expect(enc).toContain(`fill="${purple}"`); // the label's text
      expect(enc).toContain('fill="#ffffff"');
      // The line is drawn as the net's wire (#101), in the edge's color.
      expect(svg).toMatch(new RegExp(`<path class="sumi-wire" [^>]*stroke="${orange}"`));
      const edge = element(svg, "sumi-k-e--_0");
      // The filled arrowhead and the label text are the line color too.
      expect(edge.match(new RegExp(`fill="${orange}"`, "g"))?.length).toBeGreaterThanOrEqual(2);
      expect(lintGeometry(rendered, { source })).toEqual([]);
    });
  }
});

/** The color of `element`'s own `a:solidFill`, e.g. of `p:spPr`, `a:ln` or `a:rPr`. */
function solidFill(element: XmlElement | undefined): string | undefined {
  const fill = element && childElements(element).find((e) => e.name === "a:solidFill");
  const color = fill && childElements(fill).find((e) => e.name === "a:srgbClr");
  return color && attribute(color, "val");
}

/** A shape of an editable PPTX slide by name: its fill, outline, text colors and arrowhead. */
function pptxShape(root: XmlElement, name: string) {
  const shape = [...descendants(root)].find(
    (e) =>
      ["p:sp", "p:cxnSp"].includes(e.name) &&
      [...descendants(e)].some((n) => n.name === "p:cNvPr" && attribute(n, "name") === name),
  );
  if (shape === undefined) throw new Error(`no shape ${name}`);
  const spPr = childElements(shape).find((e) => e.name === "p:spPr");
  const ln = spPr && childElements(spPr).find((e) => e.name === "a:ln");
  return {
    element: shape.name,
    fill: solidFill(spPr),
    line: solidFill(ln),
    text: [...descendants(shape)].filter((e) => e.name === "a:rPr").map(solidFill),
    arrowhead: ln !== undefined && childElements(ln).some((e) => e.name === "a:tailEnd"),
  };
}

describe("editable PPTX", () => {
  for (const connectors of ["freeform", "glued"] as const) {
    test(`${connectors}: outlined frames and text, a toned line, arrowhead and label`, async () => {
      const rendered = (await render(figure("paper", "structured"))) as RenderedStructuredFigure;
      const pptx = svgToEditablePptx(rendered.svg, rendered.compiled.ir, { connectors });
      if (!pptx.ok) throw new Error(JSON.stringify(pptx.diagnostics));
      const xml = new TextDecoder().decode(readPptx(pptx.value).get("ppt/slides/slide1.xml"));
      const parsed = parseXml(xml);
      if (!parsed.ok) throw new Error(parsed.message);
      const hex = (color: string) => color.slice(1).toUpperCase();
      const purple = hex(line("paper", "purple"));
      const orange = hex(line("paper", "orange"));
      expect(pptxShape(parsed.root, "n:enc")).toMatchObject({
        fill: "FFFFFF",
        line: purple,
        text: [purple],
      });
      expect(pptxShape(parsed.root, "n:vae")).toMatchObject({
        fill: "FFFFFF",
        line: orange,
        text: [orange],
      });
      // The arrowhead is the line's tail end, drawn in the line's color.
      expect(pptxShape(parsed.root, "e:#0")).toMatchObject({
        element: connectors === "glued" ? "p:cxnSp" : "p:sp",
        line: orange,
        arrowhead: true,
      });
      expect(pptxShape(parsed.root, "e:#0 label 0")).toMatchObject({ text: [orange] });
    });
  }
});

describe.skipIf(!available)("auto (D2)", () => {
  test("D2 draws the same colors", async () => {
    const { svg } = await render(figure("color", "auto"), true);
    const purple = line("color", "purple");
    const orange = line("color", "orange");
    const enc = element(svg, "sumi-k-n--enc");
    expect(enc).toContain(`stroke="${purple}"`);
    expect(enc).toContain(`fill="${purple}"`);
    const edge = element(svg, "sumi-k-e--_0");
    expect(edge).toContain(`stroke="${orange}"`);
    expect(edge).toContain(`fill="${orange}"`);
  });
});
