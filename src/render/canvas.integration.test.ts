import { expect, test } from "bun:test";
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
      expect(pdf.ok).toBe(true);
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
