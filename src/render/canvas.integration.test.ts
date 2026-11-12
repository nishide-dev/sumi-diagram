import { expect, test } from "bun:test";
import { inflateSync } from "node:zlib";
import { htmlThemeVariables } from "../assets/html-render";
import { BUILTIN_THEMES } from "../core/theme/builtin";
import { pageTextContrast } from "../core/theme/node-variants";
import type { Theme } from "../core/theme/schema";
import { svgToPdf } from "./pdf/pdf";
import { svgToEditablePptx } from "./pptx/editable";
import { svgToPptx } from "./pptx/pptx";
import { readPptx } from "./pptx/testing";
import { renderFigure } from "./render";

test("a dark theme canvas reaches both SVG engines and exports", async () => {
  const themes = BUILTIN_THEMES as Map<string, Theme>;
  const original = themes.get("minimal");
  if (!original) throw new Error("missing theme");
  themes.set("minimal", { ...original, canvas: "#30364f" });
  try {
    expect(htmlThemeVariables(themes.get("minimal") as Theme)["--sumi-bg"]).toBe("#30364f");
    expect(pageTextContrast("#ffffff", 1, "#30364f")).toBeGreaterThan(4.5);
    expect(pageTextContrast("#30364f", 1, "#30364f")).toBe(1);
    const contrast = await renderFigure(`version: 1
figure: { id: contrast, theme: minimal, themeOverrides: { tones: { blue: { line: '#30364f' } } } }
nodes:
  - { id: a, component: box, variant: outlined, tone: blue, label: Hello }
`);
    expect(contrast.diagnostics.some((d) => d.code === "theme/low-contrast")).toBe(true);
    for (const layout of ["direction: right", "arrange: { row: { items: [a] } }"]) {
      const rendered = await renderFigure(
        `version: 1\nfigure: { id: canvas, theme: minimal, layout: { ${layout} } }\nnodes:\n  - { id: a, component: box, label: Hello }\n`,
      );
      if (!rendered.ok) throw new Error(JSON.stringify(rendered.diagnostics));
      expect(rendered.value.svg).toContain('fill="#30364f"');
      const pdf = svgToPdf(rendered.value.svg);
      if (!pdf.ok) throw new Error(JSON.stringify(pdf.diagnostics));
      // The first fill painted in the page content is the canvas (#30364f = 48/255, 54/255, 79/255).
      expect(firstFill(pdf.value)).toEqual([0.1882, 0.2118, 0.3098]);
      const picture = svgToPptx(rendered.value.svg);
      const editable = svgToEditablePptx(rendered.value.svg, rendered.value.compiled.ir);
      for (const result of [picture, editable]) {
        if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
        const master = readPptx(result.value).get("ppt/slideMasters/slideMaster1.xml");
        expect(new TextDecoder().decode(master)).toContain('val="30364F"');
      }
    }
  } finally {
    themes.set("minimal", original);
  }
});

/** The RGB of the first `rg` (non-stroking color) operator in the PDF's content streams. */
function firstFill(pdf: Uint8Array): number[] | undefined {
  const bytes = Buffer.from(pdf);
  const text = bytes.toString("latin1");
  for (const match of text.matchAll(/stream\r?\n/g)) {
    const start = (match.index ?? 0) + match[0].length;
    const end = text.indexOf("endstream", start);
    let content: string;
    try {
      content = inflateSync(bytes.subarray(start, end)).toString("latin1");
    } catch {
      continue;
    }
    const rg = content.match(/([\d.]+) ([\d.]+) ([\d.]+) rg/);
    if (rg) return rg.slice(1, 4).map((v) => Math.round(Number(v) * 10000) / 10000);
  }
  return undefined;
}
