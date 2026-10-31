import { expect, test } from "bun:test";
import { compileFigure } from "../compiler/compile";
import { getOutlineRenderer } from "../core/outline/builtin";
import { BUILTIN_THEMES } from "../core/theme/builtin";
import { lintGeometry } from "../lint";
import { svgToPdf } from "./pdf";
import { svgToPptx } from "./pptx";
import { svgToEditablePptx } from "./pptx/editable";
import { readPptx } from "./pptx/testing";
import { renderFigure } from "./render";

function source(samples = "[0, -0.5, 1, -1, 0]", mode = "bars", engine = "structured") {
  return `version: 1
figure:
  id: waveform-test
  layout: { engine: ${engine}, direction: right${engine === "structured" ? ", arrange: { row: { items: [signal] } }" : ""} }
nodes:
  - id: signal
    component: waveform
    variant: outlined
    tone: red
    props:
      samples: ${samples}
      mode: ${mode}
`;
}

test("sample and size errors have located shared diagnostics", () => {
  for (const samples of [
    "[]",
    "[0]",
    "[0, 1.1]",
    "[0, -.inf]",
    "[0, text]",
    `[${Array(2049).fill(0).join(",")}]`,
  ]) {
    const result = compileFigure(source(samples));
    expect(result.ok).toBe(false);
    const diagnostic = result.diagnostics.find((d) => d.path?.[2] === "props");
    expect(diagnostic?.path?.slice(0, 4)).toEqual(["nodes", 0, "props", "samples"]);
    expect(diagnostic?.location).toBeDefined();
  }
  for (const suffix of ["      width: 0pt\n", "      height: -1pt\n"]) {
    expect(compileFigure(source() + suffix).ok).toBe(false);
  }
  expect(compileFigure(source("[0, 1]", "unknown")).ok).toBe(false);
  expect(compileFigure(source(`[${Array(2048).fill(0).join(",")}]`)).ok).toBe(true);
});

test("bars mirror amplitudes and line mode preserves signed values", () => {
  const renderer = getOutlineRenderer("sumi/waveform");
  if (!renderer) throw new Error("Missing waveform renderer");
  const rect = { x: 0, y: 0, width: 100, height: 100 };
  const bars = renderer.draw(rect, renderer.params.parse({ samples: "-1,0,1" }));
  expect(bars.layers.slice(1).map((l) => l.path.points)).toEqual([
    [
      { x: 10, y: 10 },
      { x: 10, y: 60 },
    ],
    [
      { x: 50, y: 35 },
      { x: 50, y: 35 },
    ],
    [
      { x: 90, y: 10 },
      { x: 90, y: 60 },
    ],
  ]);
  const line = renderer.draw(rect, renderer.params.parse({ samples: "-1,0,1", mode: "line" }));
  expect(line.layers[1]?.path.points).toEqual([
    { x: 10, y: 60 },
    { x: 50, y: 35 },
    { x: 90, y: 10 },
  ]);
});

for (const theme of BUILTIN_THEMES.keys()) {
  for (const engine of ["auto", "structured"]) {
    for (const mode of ["bars", "line"]) {
      test(`${theme}/${engine}/${mode}: deterministic vector exports and native editable signal`, async () => {
        const text = source(undefined, mode, engine);
        const result = await renderFigure(text, { overrides: { theme } });
        if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
        expect(result.diagnostics).toEqual([]);
        expect(lintGeometry(result.value, {})).toEqual([]);
        expect(await renderFigure(text, { overrides: { theme } })).toEqual(result);
        expect(svgToPdf(result.value.svg).ok).toBe(true);
        expect(svgToPptx(result.value.svg).ok).toBe(true);
        for (const connectors of ["freeform", "glued"] as const) {
          const pptx = svgToEditablePptx(result.value.svg, result.value.compiled.ir, {
            connectors,
          });
          if (!pptx.ok) throw new Error(JSON.stringify(pptx.diagnostics));
          const parts = readPptx(pptx.value);
          const slide = new TextDecoder().decode(parts.get("ppt/slides/slide1.xml"));
          expect(slide).toContain("a:custGeom");
          expect(slide.match(/<a:lnTo/g)?.length).toBeGreaterThanOrEqual(mode === "bars" ? 8 : 7);
          expect(slide).not.toContain("p:pic");
          expect([...parts.keys()].some((p) => p.startsWith("ppt/media/"))).toBe(false);
        }
      }, 30_000);
    }
  }
}
