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
import { attribute, childElements, classList, descendants, parseXml } from "./xml";

function required<T>(value: T | null | undefined): T {
  if (value === undefined || value === null) throw new Error("Missing expected geometry");
  return value;
}

function elements(xml: string) {
  const parsed = parseXml(xml);
  if (!parsed.ok) throw new Error(parsed.message);
  return [...descendants(parsed.root)];
}

function signalPaths(svg: string) {
  const shape = elements(svg).find((e) => classList(e).includes("shape"));
  if (!shape) throw new Error("Missing signal shape");
  return childElements(shape)
    .filter((e) => e.name === "path")
    .slice(1);
}

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

test.each(["auto", "structured"])(
  "%s: independent waveform frame paint survives SVG and editable PPTX",
  async (engine) => {
    const text = source(undefined, undefined, engine)
      .replace("  id: waveform-test", "  id: waveform-test\n  theme: paper")
      .replace("props:\n", "props:\n      frameStroke: '#000000'\n");
    const result = await renderFigure(text);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const shape = required(elements(result.value.svg).find((e) => classList(e).includes("shape")));
    const paths = childElements(shape).filter((e) => e.name === "path");
    expect(attribute(required(paths[0]), "stroke")).toBe("#000000");
    const signalStroke = attribute(required(paths[1]), "stroke");
    expect(signalStroke).not.toBe("#000000");
    expect(paths.slice(1).every((p) => attribute(p, "stroke") === signalStroke)).toBe(true);
    const pptx = svgToEditablePptx(result.value.svg, result.value.compiled.ir);
    if (!pptx.ok) throw new Error(JSON.stringify(pptx.diagnostics));
    const slide = new TextDecoder().decode(readPptx(pptx.value).get("ppt/slides/slide1.xml"));
    expect(slide).toContain('val="000000"');
    expect(slide).toContain(`val="${signalStroke?.slice(1).toUpperCase()}"`);
  },
);

test("independent waveform frame paint yields to inherited dimming", async () => {
  const text = source()
    .replace("items: [signal]", "items: [panel]")
    .replace(
      "nodes:\n",
      "groups:\n  - id: panel\n    dim: true\n    arrange: { row: { items: [signal] } }\nnodes:\n",
    )
    .replace("props:\n", "props:\n      frameStroke: '#000000'\n");
  const result = await renderFigure(text);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const shape = required(
    elements(result.value.svg).find(
      (e) => classList(e).includes("shape") && childElements(e).some((c) => c.name === "path"),
    ),
  );
  const paths = childElements(shape).filter((e) => e.name === "path");
  expect(attribute(required(paths[0]), "stroke")).not.toBe("#000000");
  expect(attribute(required(paths[0]), "stroke")).toBe(attribute(required(paths[1]), "stroke"));
});

for (const engine of ["auto", "structured"]) {
  for (const mode of ["bars", "line"]) {
    for (const theme of BUILTIN_THEMES.keys()) {
      test(`${theme}/${engine}/${mode}: round painted bounds stay inside the painted frame at the minimum size`, async () => {
        const result = await renderFigure(
          `${source("[-1, 1, -1]", mode, engine)}      width: 0.5pt\n      height: 0.5pt\n`,
          { overrides: { theme } },
        );
        if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
        expect(result.diagnostics).toEqual([]);
        expect(lintGeometry(result.value, {})).toEqual([]);
        const box = result.value.inspection.elements.find((e) => e.key === "n:signal")?.bbox;
        if (!box) throw new Error("Missing frame bounds");
        const radius = required(result.value.compiled.ir.nodes[0]).style.strokeWidth.units / 2;
        const paths = signalPaths(result.value.svg);
        expect(paths).toHaveLength(mode === "line" ? 1 : 3);
        for (const path of paths) {
          expect(attribute(path, "stroke-linecap")).toBe("round");
          expect(attribute(path, "stroke-linejoin")).toBe("round");
          // A round-stroked polyline is a union of segment capsules: extrema
          // are bounded by vertex coordinates +/- half the actual stroke width.
          const coordinates = required(required(attribute(path, "d")).match(/-?[\d.]+/g)).map(
            Number,
          );
          for (let i = 0; i < coordinates.length; i += 2) {
            const x = required(coordinates[i]);
            const y = required(coordinates[i + 1]);
            expect(x - radius).toBeGreaterThanOrEqual(box.x - radius - 0.001);
            expect(x + radius).toBeLessThanOrEqual(box.x + box.width + radius + 0.001);
            expect(y - radius).toBeGreaterThanOrEqual(box.y - radius - 0.001);
            expect(y + radius).toBeLessThanOrEqual(box.y + box.height + radius + 0.001);
          }
        }
      });
    }

    for (const [name, samples] of [
      ["zero", [0, 0]],
      ["constant", [0.5, 0.5, 0.5]],
      ["dense", Array.from({ length: 2048 }, (_, i) => (i % 2 === 0 ? -1 : 1))],
    ] as const) {
      test(`${engine}/${mode}/${name}: renders all samples through every export`, async () => {
        const result = await renderFigure(source(JSON.stringify(samples), mode, engine));
        if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
        expect(result.diagnostics).toEqual([]);
        expect(lintGeometry(result.value, {})).toEqual([]);
        const paths = signalPaths(result.value.svg);
        expect(paths).toHaveLength(mode === "line" ? 1 : samples.filter((v) => v !== 0).length);
        const box = required(
          result.value.inspection.elements.find((e) => e.key === "n:signal")?.bbox,
        );
        for (const path of paths) {
          const coordinates = required(required(attribute(path, "d")).match(/-?[\d.]+/g)).map(
            Number,
          );
          if (name !== "dense") {
            const value = samples[0];
            const ys =
              mode === "line"
                ? samples.map(() => box.y + box.height * (0.35 - value * 0.25))
                : [
                    box.y + box.height * (0.35 - value * 0.25),
                    box.y + box.height * (0.35 + value * 0.25),
                  ];
            for (const [i, y] of coordinates.filter((_, i) => i % 2 === 1).entries()) {
              expect(y).toBeCloseTo(required(ys[i]), 3);
            }
          }
        }
        if (mode === "line") {
          expect(required(attribute(required(paths[0]), "d")).match(/\bL\b/g)).toHaveLength(
            samples.length - 1,
          );
        }
        expect(svgToPdf(result.value.svg).ok).toBe(true);
        expect(svgToPptx(result.value.svg).ok).toBe(true);
        const pptx = svgToEditablePptx(result.value.svg, result.value.compiled.ir);
        if (!pptx.ok) throw new Error(JSON.stringify(pptx.diagnostics));
        const slide = new TextDecoder().decode(readPptx(pptx.value).get("ppt/slides/slide1.xml"));
        const nativePaths = elements(slide).filter((e) => e.name === "a:path");
        expect(nativePaths).toHaveLength(paths.length + 1);
        expect(slide).not.toContain("p:pic");
        if (mode === "line") {
          expect(
            [...descendants(required(nativePaths[1]))].filter((e) => e.name === "a:lnTo"),
          ).toHaveLength(samples.length - 1);
        }
      }, 30_000);
    }
  }
}

for (const mode of ["bars", "line"]) {
  test(`${mode}: editable XML preserves exact coordinates, separate frame/signal styles and zero behavior`, async () => {
    const result = await renderFigure(
      source("[-1, 0, 1]", mode).replace("    tone: red\n", "") +
        "      width: 50pt\n      height: 50pt\n",
      { overrides: { theme: "minimal" } },
    );
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    for (const connectors of ["freeform", "glued"] as const) {
      const pptx = svgToEditablePptx(result.value.svg, result.value.compiled.ir, { connectors });
      if (!pptx.ok) throw new Error(JSON.stringify(pptx.diagnostics));
      const slide = new TextDecoder().decode(readPptx(pptx.value).get("ppt/slides/slide1.xml"));
      const all = elements(slide);
      const shapes = all.filter((e) => e.name === "p:sp");
      const frame = required(
        shapes.find((e) =>
          [...descendants(e)].some(
            (p) => p.name === "p:cNvPr" && attribute(p, "name") === "n:signal",
          ),
        ),
      );
      const signal = required(
        shapes.find((e) =>
          [...descendants(e)].some(
            (p) => p.name === "p:cNvPr" && attribute(p, "name") === "n:signal signal",
          ),
        ),
      );
      const frameElements = [...descendants(frame)];
      expect(frameElements.filter((e) => e.name === "a:path")).toHaveLength(1);
      expect(frameElements.some((e) => e.name === "a:close")).toBe(true);
      expect(attribute(required(frameElements.find((e) => e.name === "a:ln")), "cap")).toBe("flat");
      expect(attribute(required(frameElements.find((e) => e.name === "a:miter")), "lim")).toBe(
        "400000",
      );
      expect(frameElements.some((e) => e.name === "a:round")).toBe(false);
      const signalElements = [...descendants(signal)];
      expect(attribute(required(signalElements.find((e) => e.name === "a:ln")), "cap")).toBe("rnd");
      expect(signalElements.some((e) => e.name === "a:round")).toBe(true);
      expect(signalElements.some((e) => e.name === "a:miter")).toBe(false);
      const svgFrame = required(
        elements(result.value.svg).find((e) => classList(e).includes("shape")),
      );
      const svgFramePath = required(childElements(svgFrame)[0]);
      expect(attribute(svgFramePath, "stroke-linejoin")).toBeUndefined();
      expect(attribute(svgFramePath, "stroke-linecap")).toBeUndefined();
      const paths = all.filter((e) => e.name === "a:path").slice(1);
      const coordinates = paths.map((path) =>
        [...descendants(path)]
          .filter((e) => e.name === "a:pt")
          .map((e) => [Number(attribute(e, "x")), Number(attribute(e, "y"))]),
      );
      expect(coordinates).toEqual(
        mode === "bars"
          ? [
              [
                [63500, 63500],
                [63500, 381000],
              ],
              [
                [571500, 63500],
                [571500, 381000],
              ],
            ]
          : [
              [
                [63500, 381000],
                [317500, 222250],
                [571500, 63500],
              ],
            ],
      );
      for (const path of paths) expect(attribute(path, "fill")).toBe("none");
      expect(slide).toContain(
        '<a:ln w="12700" cap="rnd"><a:solidFill><a:srgbClr val="525252"></a:srgbClr></a:solidFill><a:round/></a:ln>',
      );
      for (const path of signalPaths(result.value.svg)) {
        expect(attribute(path, "stroke-linecap")).toBe("round");
        expect(attribute(path, "stroke-linejoin")).toBe("round");
      }
    }
  });
}

test("auto layout composes a waveform between connected nodes", async () => {
  const text =
    source(undefined, "line", "auto") +
    `  - id: input
    component: box
    label: Input
  - id: output
    component: box
    label: Output
edges:
  - { from: input, to: signal }
  - { from: signal, to: output }
`;
  const result = await renderFigure(text);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  expect(result.diagnostics).toEqual([]);
  expect(lintGeometry(result.value, {})).toEqual([]);
  const nodes = result.value.inspection.elements;
  const input = required(nodes.find((e) => e.key === "n:input")?.bbox);
  const signal = required(nodes.find((e) => e.key === "n:signal")?.bbox);
  const output = required(nodes.find((e) => e.key === "n:output")?.bbox);
  expect(input.x + input.width).toBeLessThan(signal.x);
  expect(signal.x + signal.width).toBeLessThan(output.x);
  expect(nodes.filter((e) => e.kind === "edge" && e.path !== undefined)).toHaveLength(2);
  expect(signalPaths(result.value.svg)).toHaveLength(1);
  for (const connectors of ["freeform", "glued"] as const) {
    const pptx = svgToEditablePptx(result.value.svg, result.value.compiled.ir, { connectors });
    if (!pptx.ok) throw new Error(JSON.stringify(pptx.diagnostics));
    const all = elements(
      new TextDecoder().decode(readPptx(pptx.value).get("ppt/slides/slide1.xml")),
    );
    const frameId = attribute(
      required(all.find((e) => e.name === "p:cNvPr" && attribute(e, "name") === "n:signal")),
      "id",
    );
    const group = required(all.find((e) => e.name === "p:grpSp"));
    expect(
      [...descendants(group)].some((e) => e.name === "p:cNvPr" && attribute(e, "id") === frameId),
    ).toBe(true);
    for (const endpoint of ["a:stCxn", "a:endCxn"]) {
      expect(all.filter((e) => e.name === endpoint && attribute(e, "id") === frameId)).toHaveLength(
        connectors === "glued" ? 1 : 0,
      );
    }
  }
}, 30_000);

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
          expect(slide.match(/<a:lnTo/g)?.length).toBeGreaterThanOrEqual(mode === "bars" ? 6 : 7);
          expect(slide).not.toContain("p:pic");
          expect([...parts.keys()].some((p) => p.startsWith("ppt/media/"))).toBe(false);
        }
      }, 30_000);
    }
  }
}
