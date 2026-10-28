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
import { type RenderedFigure, renderFigure } from "./render";

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
