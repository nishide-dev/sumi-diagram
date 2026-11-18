import { expect, test } from "bun:test";
import { lintGeometry } from "../lint";
import { readSvgMetadata } from "./finalize";
import { svgToEditablePptx } from "./pptx/editable";
import { pictureCanvas, svgToPptx } from "./pptx/pptx";
import { readPptx } from "./pptx/testing";
import { renderFigure } from "./render";

const figure = (overrides: string, extra = "") => `version: 1
figure: { id: canvas, theme: sumi${extra}${overrides === "" ? "" : `, themeOverrides: { ${overrides} }`}, layout: { arrange: { row: { items: [a, b] } } } }
nodes:
  - { id: a, component: box, label: Hello }
  - { id: b, component: box, label: World }
edges:
  - { from: a, to: b, label: Link }
`;

const masterOf = (pptx: Uint8Array) =>
  new TextDecoder().decode(readPptx(pptx).get("ppt/slideMasters/slideMaster1.xml"));

async function render(source: string, background?: "transparent") {
  const result = await renderFigure(source, background ? { overrides: { background } } : {});
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.value;
}

const YELLOW = "#fff2c2";

test("an override reaches the SVG, its metadata, both PPTX exports and the node fills", async () => {
  const plain = await render(figure(""));
  const custom = await render(figure(`canvas: "${YELLOW}"`));
  // `sumi` always records its canvas: an SVG without it was drawn on the former cream.
  expect(plain.metadata.canvas).toBe("#ffffff");
  expect(custom.metadata.canvas).toBe(YELLOW);
  expect(custom.svg).toContain(`canvas="${YELLOW}"`);
  // The painted background and the nodes' fills are the override; white is gone.
  expect(custom.svg).toContain(`fill="${YELLOW}"`);
  expect(plain.svg).toContain('fill="#ffffff"');
  expect(plain.svg).not.toContain(`fill="${YELLOW}"`);
  const picture = svgToPptx(custom.svg);
  const editable = svgToEditablePptx(custom.svg, custom.compiled.ir);
  const plainPicture = svgToPptx(plain.svg);
  if (!picture.ok || !editable.ok || !plainPicture.ok) throw new Error("PPTX failed");
  for (const result of [picture.value, editable.value])
    expect(masterOf(result)).toContain(`<a:srgbClr val="${YELLOW.slice(1).toUpperCase()}"/>`);
  expect(masterOf(plainPicture.value)).toContain('<a:srgbClr val="FFFFFF"/>');
  const slide = new TextDecoder().decode(readPptx(editable.value).get("ppt/slides/slide1.xml"));
  expect(slide).toContain(YELLOW.slice(1).toUpperCase());
});

test("transparent with an override leaves the outer background unpainted but keeps the override as the ground", async () => {
  const opaque = await render(figure(`canvas: "${YELLOW}"`));
  const clear = await render(figure(`canvas: "${YELLOW}"`), "transparent");
  expect(clear.metadata.background).toBe("transparent");
  // The override is still recorded: node fills and label grounds are drawn on it.
  expect(clear.metadata.canvas).toBe(YELLOW);
  const painted = (svg: string) => svg.match(new RegExp(`fill="${YELLOW}"`, "g"))?.length ?? 0;
  expect(painted(clear.svg)).toBe(painted(opaque.svg) - 1);
  expect(painted(clear.svg)).toBeGreaterThan(0);
  const picture = svgToPptx(clear.svg);
  const editable = svgToEditablePptx(clear.svg, clear.compiled.ir);
  if (!picture.ok || !editable.ok) throw new Error("PPTX failed");
  for (const result of [picture.value, editable.value]) {
    expect(masterOf(result)).toContain("<a:noFill/>");
    expect(masterOf(result)).not.toContain("<a:solidFill><a:srgbClr");
  }
});

test("the contrast checks and the geometry lint measure against the override", async () => {
  const codes = (text: string) => lintCodes(text);
  const tone = (canvas: string) => `version: 1
figure: { id: t, theme: sumi, themeOverrides: { canvas: "${canvas}", tones: { blue: { line: '#30364f' } } } }
nodes:
  - { id: a, component: box, variant: outlined, tone: blue, label: Hello }
`;
  expect(await codes(tone("#ffffff"))).not.toContain("theme/low-contrast");
  expect(await codes(tone("#30364f"))).toContain("theme/low-contrast");
  // An edge as dark as the canvas it is drawn on barely shows.
  const edge = (canvas: string) => `version: 1
figure: { id: e, theme: minimal, themeOverrides: { canvas: "${canvas}" }, layout: { arrange: { row: { gap: 20mm, items: [a, b] } } } }
nodes:
  - { id: a, component: box, label: A }
  - { id: b, component: box, label: B }
edges:
  - { from: a, to: b }
`;
  expect(await codes(edge("#ffffff"))).not.toContain("geometry/low-stroke-contrast");
  expect(await codes(edge("#1f2328"))).toContain("geometry/low-stroke-contrast");
});

async function lintCodes(text: string): Promise<string[]> {
  const result = await renderFigure(text);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return [
    ...result.diagnostics.map((d) => d.code),
    ...lintGeometry(result.value, { source: text, file: "x.sumi.yaml" }).map((d) => d.code),
  ];
}

test("an SVG made before sumi turned white keeps its cream master in a picture PPTX", async () => {
  const fresh = await render(figure(""));
  // What an older Sumi wrote: no `canvas` attribute.
  const bare = fresh.svg.replace(/ canvas="[^"]*"/, "");
  const meta = (version: string, canvas?: string) => {
    const svg = bare.replace(/sumi-version="[^"]*"/, `sumi-version="${version}"`);
    const read = readSvgMetadata(
      canvas ? svg.replace(' theme="sumi"', ` theme="sumi" canvas="${canvas}"`) : svg,
    );
    if (!read.ok || !read.value) throw new Error("metadata");
    return read.value;
  };
  expect(pictureCanvas(meta("0.18.2"))).toBe("#f8f8ee");
  expect(pictureCanvas(meta("0.19.0"))).toBe("#f8f8ee");
  expect(pictureCanvas(meta("0.9.0"))).toBe("#f8f8ee");
  expect(pictureCanvas(meta("0.19.1"))).toBe("#ffffff");
  expect(pictureCanvas(meta("0.20.0"))).toBe("#ffffff");
  expect(pictureCanvas(meta("0.10.0"))).toBe("#f8f8ee");
  expect(pictureCanvas(meta("0.18.2", "#123456"))).toBe("#123456");
  const old = svgToPptx(bare.replace(/sumi-version="[^"]*"/, 'sumi-version="0.18.2"'));
  const current = svgToPptx(bare.replace(/sumi-version="[^"]*"/, 'sumi-version="0.19.1"'));
  if (!old.ok || !current.ok) throw new Error("PPTX failed");
  expect(masterOf(old.value)).toContain('<a:srgbClr val="F8F8EE"/>');
  expect(masterOf(current.value)).toContain('<a:srgbClr val="FFFFFF"/>');
});
