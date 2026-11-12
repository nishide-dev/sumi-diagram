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
    const opaquePdf = svgToPdf(normal.value.svg);
    if (!pdf.ok || !opaquePdf.ok) throw new Error("PDF conversion failed");
    const transparentPaint = pdfStreams(pdf.value);
    const opaquePaint = pdfStreams(opaquePdf.value);
    // Exactly one canvas-coloured paint (the outer canvas) is gone; the label knockouts and
    // canvas-coloured node fills keep theirs.
    const canvasPaint = /0\.1882353 0\.21176471 0\.30980393 rg/g;
    const opaqueCount = opaquePaint.match(canvasPaint)?.length ?? 0;
    expect(opaqueCount).toBeGreaterThan(1);
    expect(transparentPaint.match(canvasPaint)?.length ?? 0).toBe(opaqueCount - 1);
    expect(firstFill(opaquePdf.value)).toEqual([0.1882, 0.2118, 0.3098]);
    const picture = svgToPptx(transparent.value.svg);
    const editable = svgToEditablePptx(transparent.value.svg, transparent.value.compiled.ir);
    const opaqueEditable = svgToEditablePptx(normal.value.svg, normal.value.compiled.ir);
    if (!picture.ok || !editable.ok || !opaqueEditable.ok)
      throw new Error("PPTX conversion failed");
    const media = readPptx(picture.value);
    // The picture is the transparent SVG itself and its PNG fallback is see-through at the corner.
    const embedded = new TextDecoder().decode(media.get("ppt/media/figure.svg"));
    const canvasFills = (svg: string) => svg.match(/fill="#30364f"/gi)?.length ?? 0;
    expect(embedded).not.toMatch(
      /<rect x="0" y="0" width="[\d.]+" height="[\d.]+" fill="#30364f"/i,
    );
    expect(canvasFills(embedded)).toBe(canvasFills(transparent.value.svg));
    expect(canvasFills(embedded)).toBeGreaterThan(0);
    const png = media.get("ppt/media/figure.png");
    if (png === undefined) throw new Error("missing PNG");
    expect(pngCornerAlpha(png)).toBe(0);
    // The editable slide keeps every shape and colour of the opaque one.
    const slide = (pptx: Uint8Array) =>
      new TextDecoder().decode(readPptx(pptx).get("ppt/slides/slide1.xml"));
    const colours = (xml: string) =>
      [...xml.matchAll(/srgbClr val="([0-9A-F]{6})"/g)].map((m) => m[1]).sort();
    expect(colours(slide(editable.value))).toEqual(colours(slide(opaqueEditable.value)));
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

function pdfStreams(pdf: Uint8Array): string {
  const bytes = Buffer.from(pdf);
  const text = bytes.toString("latin1");
  const streams: string[] = [];
  for (const match of text.matchAll(/stream\r?\n/g)) {
    const start = (match.index ?? 0) + match[0].length;
    const end = text.indexOf("endstream", start);
    try {
      streams.push(inflateSync(bytes.subarray(start, end)).toString("latin1"));
    } catch {
      // Non-compressed streams are not page paint streams.
    }
  }
  return streams.join("\n");
}

test("transparent keeps panels, sets, label knockouts and canvas-coloured nodes", async () => {
  const source = `version: 1
figure:
  id: rich
  theme: sumi-dark
  layout: { arrange: { row: { gap: 12mm, items: [panel, c] } } }
groups:
  - { id: panel, label: Panel, variant: filled, arrange: { row: { gap: 10mm, items: [a, b] } } }
sets: [{ id: s, members: [a, b], shape: rect, tone: blue }]
nodes:
  - { id: a, component: box, label: Hello }
  - { id: b, component: box, label: World, tone: blue, variant: tinted }
  - { id: c, component: box, label: Out }
edges:
  - { from: a, to: b, label: Link }
  - { from: b, to: c, label: Next }
`;
  const normal = await renderFigure(source);
  const transparent = await renderFigure(
    source.replace("id: rich", "id: rich\n  background: transparent"),
  );
  if (!normal.ok || !transparent.ok) throw new Error("render failed");
  // Exactly the first (outer) canvas rect is gone; every other paint, including the
  // canvas-coloured node fills and label knockouts, is unchanged.
  const canvasRect = /<rect x="0" y="0" width="[\d.]+" height="[\d.]+" fill="#30364f"\/>/;
  expect(normal.value.svg).toMatch(canvasRect);
  expect(transparent.value.svg).not.toMatch(canvasRect);
  const strip = (svg: string) =>
    svg
      .replace(canvasRect, "")
      .replace(/ background="transparent"/, "")
      .replace(/input-sha256="[0-9a-f]+"/, "");
  expect(strip(transparent.value.svg)).toBe(strip(normal.value.svg));
  expect(transparent.value.svg.match(/fill="#30364f"/g)?.length).toBeGreaterThan(1);
  // The PDF paints the panel, the set and the nodes but no full-page canvas first.
  const pdf = svgToPdf(transparent.value.svg);
  if (!pdf.ok) throw new Error("PDF conversion failed");
  const first = firstFill(pdf.value);
  expect(first).toBeDefined();
  expect(first).not.toEqual([0.1882, 0.2118, 0.3098]);
});

/** Alpha of the top-left pixel of an 8-bit RGBA, non-interlaced PNG. */
function pngCornerAlpha(png: Uint8Array): number {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let offset = 8;
  const idat: Uint8Array[] = [];
  let colourType = -1;
  while (offset < png.length) {
    const length = view.getUint32(offset);
    const type = new TextDecoder().decode(png.subarray(offset + 4, offset + 8));
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") colourType = data[9] ?? -1;
    if (type === "IDAT") idat.push(data);
    offset += 12 + length;
  }
  if (colourType !== 6) throw new Error(`PNG colour type ${colourType}, expected RGBA`);
  const raw = inflateSync(Buffer.concat(idat));
  // Row 0: one filter byte, then R G B A of pixel 0 (filters do not change the first pixel's alpha
  // for None/Sub/Up on row 0, and Average/Paeth add only zero predictors there).
  return raw[4] ?? -1;
}
