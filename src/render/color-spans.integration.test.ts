import { describe, expect, test } from "bun:test";
import { checkFigure } from "../core/check";
import { parseLabel } from "../core/label/math";
import { BUILTIN_THEMES } from "../core/theme/builtin";
import { getFontSet } from "../core/theme/fonts";
import { measureLabel } from "../lint/geometry/measure";
import { svgToPdf } from "./pdf";
import { inspectPdf } from "./pdf/testing";
import { svgToEditablePptx, svgToPptx } from "./pptx";
import { readPptx } from "./pptx/testing";
import { type RenderedStructuredFigure, renderFigure } from "./render";
import { attribute, descendants, parseXml } from "./xml";

const source = (label: string, fields = "", theme = "paper") => `version: 1
figure:
  id: color-spans
  theme: ${theme}
  profile: paper-double
  layout:
    arrange: { stack: { items: [a] } }
nodes:
  - id: a
    component: box
    label: ${JSON.stringify(label)}
    ${fields}
edges: []
`;
async function render(yaml: string) {
  const result = await renderFigure(yaml);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.value as RenderedStructuredFigure;
}
const prompt = String.raw`The character $\textcolor{orange}{\text{\{stands still\}}}$, camera $\textcolor{blue}{\text{\{holds steady\}}}$`;

describe("structured text colors (#186)", () => {
  test("tone boundaries survive merging, font fallback, nested colors, scripts and accents", async () => {
    const parsed = parseLabel(String.raw`$\textcolor{orange}{x_i+\textcolor{blue}{\hat y}}$`);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(
      parsed.value.lines[0]?.filter((r) => r.text.trim()).map((r) => [r.text.trim(), r.tone]),
    ).toEqual([
      ["x", "orange"],
      ["i", "orange"],
      ["+", "orange"],
      ["y", "blue"],
    ]);
    const rendered = await render(
      source("$\\textcolor{orange}{\\text{入力ABC}}\\textcolor{blue}{\\text{XYZ}}$"),
    );
    const runs = rendered.inspection.elements[0]?.labels[0]?.runs?.flat() ?? [];
    expect(runs.map((r) => r.text).join("")).toBe("入力ABCXYZ");
    expect(runs.filter((r) => r.text.includes("XYZ"))[0]?.fill).toBe(
      BUILTIN_THEMES.get("paper")?.toneLines.get("blue")?.fontColor,
    );
    expect(
      runs
        .filter((r) => !r.text.includes("XYZ"))
        .every((r) => r.fill === BUILTIN_THEMES.get("paper")?.toneLines.get("orange")?.fontColor),
    ).toBe(true);
  });

  test("SVG, PDF glyphs and editable PPTX keep each theme's toneLines text colors", async () => {
    for (const [id, theme] of BUILTIN_THEMES) {
      const rendered = await render(source(prompt, "textAlign: left", id));
      const expected = (tone: "orange" | "blue") => theme.toneLines.get(tone)?.fontColor ?? "";
      const runs = rendered.inspection.elements[0]?.labels[0]?.runs?.flat() ?? [];
      expect(runs.find((r) => r.text.includes("stands still"))?.fill).toBe(expected("orange"));
      expect(runs.find((r) => r.text.includes("holds steady"))?.fill).toBe(expected("blue"));
      const pdf = svgToPdf(rendered.svg);
      expect(pdf.ok).toBe(true);
      if (!pdf.ok) continue;
      const glyphs = inspectPdf(pdf.value).glyphs;
      expect(glyphs.map((g) => g.text).join("")).toBe(
        "The character {stands still}, camera {holds steady}",
      );
      for (const [phrase, tone] of [
        ["{stands still}", "orange"],
        ["{holds steady}", "blue"],
      ] as const) {
        const start = glyphs
          .map((g) => g.text)
          .join("")
          .indexOf(phrase);
        const rgb =
          expected(tone)
            .slice(1)
            .match(/../g)
            ?.map((c) => Number.parseInt(c, 16) / 255) ?? [];
        for (const glyph of glyphs.slice(start, start + phrase.length)) {
          expect(glyph.color?.length).toBe(3);
          for (let c = 0; c < 3; c++) expect(glyph.color?.[c]).toBeCloseTo(rgb[c] ?? -1, 3);
        }
      }
      const pptx = svgToEditablePptx(rendered.svg, rendered.compiled.ir);
      expect(pptx.ok).toBe(true);
      if (pptx.ok) {
        const xml = new TextDecoder().decode(readPptx(pptx.value).get("ppt/slides/slide1.xml"));
        expect(xml).toContain('algn="l"');
        for (const tone of ["orange", "blue"] as const)
          expect(xml).toContain(`val="${expected(tone).slice(1).toUpperCase()}"`);
        expect(xml).toContain("{stands still}");
        expect(xml).toContain("{holds steady}");
      }
      expect(svgToPptx(rendered.svg).ok).toBe(true);
    }
  });

  test("filled nodes use the same tone-line text color without background adaptation", async () => {
    const rendered = await render(
      source(String.raw`$\textcolor{orange}{\text{Highlight}}$`, "tone: orange"),
    );
    expect(rendered.svg).toContain('fill="#f9e0bc"');
    expect(rendered.inspection.elements[0]?.labels[0]?.runs?.flat().map((r) => r.fill)).toEqual([
      "#bd5410",
    ]);
  });

  test("literal text and auto math retain their existing behavior", () => {
    expect(parseLabel(String.raw`literal \textcolor{orange}{text}`)).toEqual({
      ok: true,
      value: {
        hasMath: false,
        lines: [
          [{ text: String.raw`literal \textcolor{orange}{text}`, font: "text", script: "base" }],
        ],
      },
    });
    const escaped = parseLabel(String.raw`$\text{\\textcolor{orange}{literal}}$`);
    expect(escaped.ok && escaped.value.lines[0]?.[0]?.text).toBe(
      String.raw`\textcolor{orange}{literal}`,
    );
    expect(parseLabel(String.raw`$\text{\textcolor{orange}{literal}}$`).ok).toBe(false);
    const auto = source(prompt).replace("  layout:\n    arrange: { stack: { items: [a] } }\n", "");
    expect(checkFigure(auto).state.diagnostics.map((d) => [d.code, d.severity])).toEqual([
      ["component/unsupported-in-auto", "warning"],
    ]);
  });

  test("color preserves atom spacing and widths across span boundaries", async () => {
    for (const [plain, colored] of [
      ["x+y", String.raw`x\textcolor{orange}{+}y`],
      ["x=y", String.raw`x\textcolor{orange}{=}y`],
      [String.raw`x\leq y`, String.raw`x\textcolor{blue}{\leq}y`],
      ["x+y", String.raw`\textcolor{orange}{x+}y`],
      ["x+y", String.raw`x\textcolor{orange}{+y}`],
      ["x+y", String.raw`\textcolor{orange}{x}\textcolor{blue}{+y}`],
      ["x+y=z", String.raw`x\textcolor{orange}{+\textcolor{blue}{y=}}z`],
      ["-x+y", String.raw`\textcolor{orange}{-x+}y`],
      ["x+-y", String.raw`x+\textcolor{orange}{-y}`],
      ["x+=y", String.raw`x\textcolor{orange}{+}=y`],
      ["x+", String.raw`x\textcolor{orange}{+}`],
      ["(x+y)", String.raw`\textcolor{orange}{(}x+\textcolor{blue}{y)}`],
      [String.raw`x\,+y`, String.raw`x\textcolor{orange}{\,+}y`],
      ["x_i+y^2", String.raw`\textcolor{orange}{x_i+}y^2`],
      ["x_i+y", String.raw`\textcolor{orange}{x}_i+y`],
      ["x_{i+j}", String.raw`x_{i\textcolor{orange}{+}j}`],
    ]) {
      const uncolored = parseLabel(`$${plain}$`);
      const parsed = parseLabel(`$${colored}$`);
      if (!uncolored.ok || !parsed.ok) throw new Error(`invalid pair: ${plain}, ${colored}`);
      // Compare per-character font/script as well as the exact spacing text;
      // run boundaries alone may differ when a tone changes.
      const characters = (runs: typeof parsed.value.lines) =>
        runs.flatMap((line) =>
          line.flatMap((r) => [...r.text].map((c) => [c, r.font, r.script, r.accent])),
        );
      expect(characters(parsed.value.lines)).toEqual(characters(uncolored.value.lines));
      const before = await render(source(`$${plain}$`));
      const after = await render(source(`$${colored}$`));
      expect(after.layout.nodes[0]?.rect).toEqual(before.layout.nodes[0]?.rect);
      const fonts = getFontSet(before.compiled.fontSet.id);
      const a = before.inspection.elements[0]?.labels[0];
      const b = after.inspection.elements[0]?.labels[0];
      if (!fonts || !a || !b) throw new Error("missing measured label");
      expect(measureLabel(b, fonts).box?.width).toBeCloseTo(
        measureLabel(a, fonts).box?.width ?? -1,
        4,
      );
    }
  });

  test("malformed colors use invalid-math and alignment is structured-only", () => {
    for (const label of [
      String.raw`$\textcolor{#ff0000}{x}$`,
      String.raw`$\textcolor{unknown}{x}$`,
      String.raw`$\textcolor{orange}x$`,
      String.raw`$\textcolor{orange}{x$`,
    ]) {
      expect(checkFigure(source(label)).state.diagnostics.map((d) => d.code)).toEqual([
        "component/invalid-math",
      ]);
    }
    const auto = source("Plain", "textAlign: left").replace(
      "  layout:\n    arrange: { stack: { items: [a] } }\n",
      "",
    );
    expect(checkFigure(auto).state.diagnostics.map((d) => [d.code, d.path])).toEqual([
      ["layout/structured-only", ["nodes", 0, "textAlign"]],
    ]);
    expect(checkFigure(source("Plain", "textAlign: justify")).state.diagnostics[0]?.code).toBe(
      "schema/invalid-value",
    );
  });

  test("left/right alignment, with sublabels and turned accent chunks, measures correctly", async () => {
    for (const align of ["left", "right"] as const) {
      for (const rotation of [undefined, 90, -90] as const) {
        for (const [label, sublabel] of [
          ["A long first line\nshort", "small"],
          [String.raw`$\textcolor{orange}{\hat x_i}+y$`, "A much wider sublabel\nsmall"],
        ] as const) {
          const rendered = await render(
            source(
              label,
              `textAlign: ${align}\n    sublabel: ${JSON.stringify(sublabel)}${rotation === undefined ? "" : `\n    labelRotation: ${rotation}`}`,
            ),
          );
          const fonts = getFontSet(rendered.compiled.fontSet.id);
          if (!fonts) throw new Error("missing fonts");
          const labels = rendered.inspection.elements[0]?.labels ?? [];
          expect(labels).toHaveLength(2);
          const reference =
            rotation === undefined
              ? rendered
              : await render(
                  source(label, `textAlign: ${align}\n    sublabel: ${JSON.stringify(sublabel)}`),
                );
          const originalBox = reference.layout.nodes[0]?.rect;
          const turnedBox = rendered.layout.nodes[0]?.rect;
          if (!originalBox || !turnedBox) throw new Error("missing node bounds");
          const originalCenter = {
            x: originalBox.x + originalBox.width / 2,
            y: originalBox.y + originalBox.height / 2,
          };
          const turnedCenter = {
            x: turnedBox.x + turnedBox.width / 2,
            y: turnedBox.y + turnedBox.height / 2,
          };
          const sharedEdges: number[] = [];
          for (const [index, inspected] of labels.entries()) {
            expect(inspected.textAlign).toBe(align);
            const measured = measureLabel(inspected, fonts);
            expect(measured.box).toBeDefined();
            const turn = inspected.rotation;
            const originalLabel = reference.inspection.elements[0]?.labels[index];
            if (!originalLabel) throw new Error("missing reference label");
            const ownLines = measureLabel(originalLabel, fonts).lines;
            expect(turn?.degrees).toBe(rotation);
            for (const [i, line] of measured.lines.entries()) {
              const own = ownLines[i];
              if (!own) throw new Error("missing upright line");
              if (turn === undefined) {
                sharedEdges.push(align === "left" ? line.x : line.x + line.width);
              } else {
                const { x: cx, y: cy } = originalCenter;
                const sign = rotation === 90 ? 1 : -1;
                // Rotate the independently rendered upright block about the
                // node center, then translate to the turned node's center.
                const expectedX =
                  turnedCenter.x + (rotation === 90 ? -(own.y + own.height - cy) : own.y - cy);
                const expectedY =
                  turnedCenter.y + (rotation === 90 ? own.x - cx : -(own.x + own.width - cx));
                expect(line.x).toBeCloseTo(expectedX, 3);
                expect(line.y).toBeCloseTo(expectedY, 3);
                expect(line.width).toBeCloseTo(own.height, 4);
                expect(line.height).toBeCloseTo(own.width, 4);
                const atTop = (align === "left") === (sign === 1);
                sharedEdges.push(atTop ? line.y : line.y + line.height);
              }
            }
          }
          // Both blocks and every line share one edge, even when the sublabel
          // is wider. Separate per-label anchors cannot satisfy this assertion.
          for (const edge of sharedEdges) expect(edge).toBeCloseTo(sharedEdges[0] ?? NaN, 3);

          const pptx = svgToEditablePptx(rendered.svg, rendered.compiled.ir);
          if (!pptx.ok) throw new Error(JSON.stringify(pptx.diagnostics));
          const parsed = parseXml(
            new TextDecoder().decode(readPptx(pptx.value).get("ppt/slides/slide1.xml")),
          );
          if (!parsed.ok) throw new Error(parsed.message);
          const all = [...descendants(parsed.root)];
          const emu = 6350 * (rendered.inspection.scale ?? 1);
          const slidePadding = (pt: number) =>
            Math.floor(
              Math.max(0, 914400 - Math.round(pt * 12700 * (rendered.inspection.scale ?? 1))) / 2,
            ) / emu;
          for (const [index, inspected] of labels.entries()) {
            const name =
              rotation === undefined ? "n:a" : `n:a ${index === 0 ? "label" : "sublabel"}`;
            const shape = all.find(
              (s) =>
                s.name === "p:sp" &&
                [...descendants(s)].some(
                  (e) => e.name === "p:cNvPr" && attribute(e, "name") === name,
                ),
            );
            if (!shape) throw new Error(`missing ${name}`);
            const parts = [...descendants(shape)];
            const prop = (tag: string, key: string) => {
              const e = parts.find((p) => p.name === tag);
              if (!e) throw new Error(`missing ${tag}`);
              return attribute(e, key);
            };
            expect(prop("a:xfrm", "rot")).toBe(
              rotation === undefined ? undefined : String(((rotation + 360) % 360) * 60000),
            );
            expect(
              parts
                .filter((p) => p.name === "a:pPr")
                .every((p) => attribute(p, "algn") === (align === "left" ? "l" : "r")),
            ).toBe(true);
            const x =
              Number(prop("a:off", "x")) / emu +
              rendered.inspection.canvas.viewBox.x -
              slidePadding(rendered.inspection.canvas.width.pt);
            const y =
              Number(prop("a:off", "y")) / emu +
              rendered.inspection.canvas.viewBox.y -
              slidePadding(rendered.inspection.canvas.height.pt);
            const width = Number(prop("a:ext", "cx")) / emu;
            const height = Number(prop("a:ext", "cy")) / emu;
            const left = Number(prop("a:bodyPr", "lIns")) / emu;
            const right = Number(prop("a:bodyPr", "rIns")) / emu;
            expect(align === "left" ? right : left).toBe(0);
            expect(align === "left" ? x + left : x + width - right).toBeCloseTo(
              inspected.anchor.x,
              3,
            );
            if (inspected.rotation) {
              expect(x + width / 2).toBeCloseTo(inspected.rotation.center.x, 3);
              expect(y + height / 2).toBeCloseTo(inspected.rotation.center.y, 3);
            }
            // Upright label+sublabel share a body; its top inset belongs to
            // the main label. Rotated texts each have their own body/inset.
            if (rotation !== undefined || index === 0) {
              const { rotation: _, ...upright } = inspected;
              expect(y + Number(prop("a:bodyPr", "tIns")) / emu).toBeCloseTo(
                measureLabel(upright, fonts).lines[0]?.y ?? NaN,
                3,
              );
            }
          }
        }
      }
    }
  });

  test("omitting alignment and explicit center give identical SVG", async () => {
    const drawing = (svg: string) => svg.replace(/input-sha256="[^"]*"/, "");
    expect(drawing((await render(source(prompt))).svg)).toBe(
      drawing((await render(source(prompt, "textAlign: center"))).svg),
    );
  });

  test("inherited dim overrides colored label, sublabel and internal edge runs", async () => {
    const yaml = `version: 1
figure:
  id: dim-colors
  theme: paper
  profile: paper-double
  layout: { arrange: { stack: { items: [g] } } }
groups:
  - id: g
    dim: true
    label: '$\\textcolor{orange}{G}$'
    arrange: { stack: { gap: 8mm, items: [a, b] } }
nodes:
  - { id: a, component: box, label: '$\\textcolor{orange}{A}$', sublabel: '$\\textcolor{blue}{a}$' }
  - { id: b, component: box, label: '$\\textcolor{blue}{B}$' }
edges:
  - { from: a, to: b, label: '$\\textcolor{orange}{e}$' }
`;
    const rendered = await render(yaml);
    const fills = rendered.inspection.elements.flatMap((e) =>
      e.labels.flatMap((l) => l.runs?.flat().map((r) => r.fill) ?? []),
    );
    expect(fills.length).toBe(5);
    expect(fills.every((fill) => fill === BUILTIN_THEMES.get("paper")?.dim?.fontColor)).toBe(true);
  });
});
