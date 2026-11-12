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
import { readD2Svg } from "./svg";
import { childElements } from "./xml";

test("transparent removes only the outer canvas in both engines and exports", async () => {
  for (const layout of ["direction: right", "arrange: { row: { items: [a, b] } }"]) {
    const source = `version: 1
figure: { id: transparent, theme: sumi-dark, layout: { ${layout} } }
nodes:
  - { id: a, component: box, label: Hello }
  - { id: b, component: box, label: World }
edges:
  - { from: a, to: b, label: Link }
`;
    const normal = await renderFigure(source);
    const transparent = await renderFigure(source, { overrides: { background: "transparent" } });
    if (!normal.ok || !transparent.ok) throw new Error("render failed");
    const read = readD2Svg(normal.value.svg);
    if (!read.ok) throw new Error("invalid SVG");
    const rect = childElements(read.doc.drawing).find((e) => e.name === "rect");
    if (!rect) throw new Error("missing canvas");
    const expected = (
      normal.value.svg.slice(0, rect.start) + normal.value.svg.slice(rect.end)
    ).replace(' theme="sumi-dark"', ' theme="sumi-dark" background="transparent"');
    expect(transparent.value.svg).toBe(expected);
    expect(transparent.value.metadata.background).toBe("transparent");
    const pdf = svgToPdf(transparent.value.svg);
    const expectedPdf = svgToPdf(expected);
    expect(pdf).toEqual(expectedPdf);
    const picture = svgToPptx(transparent.value.svg);
    const editable = svgToEditablePptx(transparent.value.svg, transparent.value.compiled.ir);
    expect(picture).toEqual(svgToPptx(expected));
    expect(editable).toEqual(svgToEditablePptx(expected, normal.value.compiled.ir));
    for (const result of [picture, editable]) {
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
      const master = new TextDecoder().decode(
        readPptx(result.value).get("ppt/slideMasters/slideMaster1.xml"),
      );
      expect(master).toContain("<a:noFill/>");
      expect(master).not.toContain("<a:solidFill><a:srgbClr");
    }
  }
});

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
