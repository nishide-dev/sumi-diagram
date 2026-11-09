/**
 * Tone on an icon-only label (#445, design doc `445-icon-tone`): the icon's
 * lines take the tone's line color, in nodes and in legend samples.
 */

import { describe, expect, test } from "bun:test";
import { compileFigure } from "../compiler/compile";
import { getTheme } from "../core/theme/builtin";
import { renderFigure } from "./render";

const figure = (theme: string, overrides: string, nodes: string) => `version: 1
figure:
  id: icon-tone
  theme: ${theme}
  ${overrides}
  layout: { arrange: { row: { gap: 6mm, items: [a, b, c] } } }
nodes:
${nodes}`;

const NODES = `  - { id: a, component: label, icon: tabler/file-text, tone: blue }
  - { id: b, component: label, icon: tabler/file-text }
  - { id: c, component: label, icon: emoji/fire, tone: red }
`;

async function render(text: string) {
  const result = await renderFigure(text);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  return result;
}

/** The strokes of the first group of each `g.sumi-icon`. */
const strokes = (svg: string) =>
  [...svg.matchAll(/class="sumi-icon"[^>]*><g[^>]*?stroke="(#[0-9a-f]{6})"/g)].map((m) => m[1]);

describe("icon-only label", () => {
  test.each(["paper", "color", "minimal", "llama"])(
    "a tone colors the icon lines in %s",
    async (theme) => {
      const result = await render(figure(theme, "", NODES));
      const line = (tone: string) =>
        getTheme(theme)?.toneLines.get(tone as "blue")?.fontColor ??
        getTheme(theme)?.toneLines.get(tone as "blue")?.stroke;
      const [toned, plain] = strokes(result.value.svg);
      expect(toned).toBe(line("blue") as string);
      expect(toned).not.toBe(plain);
      // Without a tone the icon keeps the text color.
      expect(plain).toBe(result.value.compiled.ir.nodes[1]?.style.fontColor as string);
    },
  );

  test("an emoji (filled) is not recolored", async () => {
    const toned = await render(figure("paper", "", NODES));
    const plain = await render(figure("paper", "", NODES.replace(", tone: red", "")));
    const emoji = (svg: string) =>
      svg.match(/<g class="sumi-icon"[^>]*>(?:(?!<g class="sumi-icon").)*$/s)?.[0];
    expect(emoji(toned.value.svg)).toBe(emoji(plain.value.svg));
  });

  test("a figure's tone override colors the icon", async () => {
    const result = await render(
      figure("paper", "themeOverrides: { tones: { blue: { line: '#112233' } } }", NODES),
    );
    expect(strokes(result.value.svg)[0]).toBe("#112233");
  });

  test("a box with an icon keeps its tone as the fill", async () => {
    const result = await render(
      figure(
        "paper",
        "",
        "  - { id: a, component: box, icon: tabler/database, tone: blue }\n  - { id: b, component: label, label: B }\n  - { id: c, component: label, label: C }\n",
      ),
    );
    expect(strokes(result.value.svg)[0]).toBe(
      result.value.compiled.ir.nodes[0]?.style.fontColor as string,
    );
    expect(result.value.compiled.ir.nodes[0]?.style.fill).not.toBe("transparent");
  });

  test("an icon tone under 4.5:1 on white warns", async () => {
    const result = await render(
      figure("paper", "themeOverrides: { tones: { blue: { line: '#a8c8ff' } } }", NODES),
    );
    expect(result.diagnostics.filter((d) => d.code === "theme/low-contrast")).toEqual([
      expect.objectContaining({
        path: ["figure", "themeOverrides", "tones", "blue", "line"],
        message: expect.stringContaining("on white"),
      }),
    ]);
  });

  test("a good tone does not warn", async () => {
    const result = await render(
      figure("paper", "themeOverrides: { tones: { blue: { line: '#31608e' } } }", NODES),
    );
    expect(result.diagnostics.filter((d) => d.code === "theme/low-contrast")).toEqual([]);
  });
});

describe("legend sample", () => {
  const legend = (entry: string) => `version: 1
figure: { id: lg, theme: paper, layout: { arrange: { stack: { gap: 5mm, items: [a, key] } } } }
nodes:
  - { id: a, component: label, icon: tabler/database, tone: red }
  - { id: key, component: legend, variant: plain, props: { entries: [${entry}] } }
`;

  test("iconTone colors the sample like the node's tone", async () => {
    const result = await render(
      legend(
        "{ icon: tabler/database, iconTone: red, label: Store }, { icon: tabler/database, label: Plain }",
      ),
    );
    const [node, toned, plain] = strokes(result.value.svg);
    expect(toned).toBe(node as string);
    expect(plain).not.toBe(node as string);
  });

  test("iconTone needs an icon and a known tone", () => {
    expect(compileFigure(legend("{ glyph: { kind: dot }, iconTone: red, label: x }")).ok).toBe(
      false,
    );
    expect(compileFigure(legend("{ icon: tabler/database, iconTone: mauve, label: x }")).ok).toBe(
      false,
    );
    expect(compileFigure(legend("{ icon: tabler/database, iconTone: red, label: x }")).ok).toBe(
      true,
    );
  });
});
