/**
 * Stroke widths, dotted lines and arrowhead sizes (#427, design record 427):
 * the schema's limits, the arrowhead room for each scale, the widths and
 * corners they set, the dotted pattern in SVG, PDF and both PPTX modes, and
 * that a figure without the options is drawn exactly as before.
 */

import { describe, expect, test } from "bun:test";
import { arrowheadLength, edgeArrowheadLength } from "../layout/route/arrowhead";
import { lintGeometry } from "../lint/geometry";
import { svgToPdf } from "./pdf";
import { svgToEditablePptx, svgToPptx } from "./pptx";
import { readPptx } from "./pptx/testing";
import { type RenderedFigure, renderFigure } from "./render";

const source = (overrides = "", extra = "") => `version: 1
figure:
  id: strokes
  theme: paper
  profile: paper-double
${overrides}  layout:
    arrange:
      stack:
        gap: 8mm
        items:
          - { row: { gap: 16mm, items: [ a, b ] } }
          - { row: { gap: 16mm, items: [ c, d ] } }
          - g
groups:
  - { id: g, label: G, arrange: { row: { gap: 6mm, items: [ e, f ] } } }
nodes:
  - { id: a, component: box, label: A }
  - { id: b, component: box, label: B }
  - { id: c, component: box, label: C }
  - { id: d, component: box, label: D }
  - { id: e, component: box, label: E }
  - { id: f, component: box, label: F }
edges:
  - { id: ab, from: a, to: b }
  - { id: cd, from: c, to: d, variant: emphasis }
  - { id: ac, from: a, to: c, variant: dotted, component: double-arrow }
${extra}`;

async function render(text: string): Promise<RenderedFigure> {
  const result = await renderFigure(text);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  return result.value;
}

const codes = async (text: string) => {
  const result = await renderFigure(text);
  return result.diagnostics.filter((d) => d.severity === "error").map((d) => d.code);
};

const styleOf = (figure: RenderedFigure, key: string) => {
  const element = figure.compiled.ir.elements.get(key as never);
  if (element === undefined) throw new Error(`no ${key}`);
  return element.style;
};

describe("limits", () => {
  test("a line width is a multiple of 0.25pt from 0.25pt to 4pt", async () => {
    for (const ok of ["0.25pt", "0.5pt", "1.75pt", "4pt"])
      expect(await codes(source(`  themeOverrides: { lineWidth: ${ok} }\n`))).toEqual([]);
    for (const bad of ["0.2pt", "0.3pt", "4.25pt", "0pt", "1mm", "2"])
      expect(await codes(source(`  themeOverrides: { lineWidth: "${bad}" }\n`))).toEqual([
        "schema/invalid-value",
      ]);
  });

  test("an arrowhead scale is 0.5 to 2, a corner radius a multiple of 0.5pt up to 10pt", async () => {
    expect(await codes(source("  themeOverrides: { arrowheadScale: 0.5 }\n"))).toEqual([]);
    expect(await codes(source("  themeOverrides: { arrowheadScale: 2 }\n"))).toEqual([]);
    expect(await codes(source("  themeOverrides: { arrowheadScale: 0.4 }\n"))).toEqual([
      "schema/invalid-value",
    ]);
    expect(await codes(source("  themeOverrides: { arrowheadScale: 2.1 }\n"))).toEqual([
      "schema/invalid-value",
    ]);
    expect(await codes(source('  themeOverrides: { cornerRadius: "10pt" }\n'))).toEqual([]);
    expect(await codes(source('  themeOverrides: { cornerRadius: "3.3pt" }\n'))).toEqual([
      "schema/invalid-value",
    ]);
  });

  test("the auto layout rejects them", async () => {
    const auto = `version: 1
figure:
  id: x
  theme: paper
  profile: paper-double
  themeOverrides: { lineWidth: 0.5pt }
  layout: { direction: right }
nodes:
  - { id: a, component: box, label: A, lineWidth: 0.5pt }
  - { id: b, component: box, label: B }
edges:
  - { from: a, to: b, arrowheadScale: 0.6 }
`;
    const result = await renderFigure(auto);
    expect(result.diagnostics.map((d) => d.code)).toEqual([
      "layout/structured-only",
      "layout/structured-only",
      "layout/structured-only",
    ]);
  });
});

describe("arrowhead room", () => {
  test("the length is (4 + 4 w) times the scale", () => {
    expect(arrowheadLength(2)).toBe(12);
    expect(arrowheadLength(2, 0.5)).toBe(6);
    expect(arrowheadLength(2, 2)).toBe(24);
    expect(edgeArrowheadLength({ strokeWidth: { units: 1 } })).toBe(8);
    expect(edgeArrowheadLength({ strokeWidth: { units: 1 }, arrowheadScale: 0.6 })).toBe(4.8);
  });

  for (const scale of [0.5, 1.5, 2]) {
    test(`scale ${scale}: the drawn head is that long, the route keeps its room, no lint finding`, async () => {
      const text = source(`  themeOverrides: { lineWidth: 0.5pt, arrowheadScale: ${scale} }\n`);
      const figure = await render(text);
      const edge = figure.compiled.ir.edges.find((e) => e.id === "ab");
      if (edge === undefined) throw new Error("no edge");
      const length = (4 + 4 * 1) * scale;
      expect(edgeArrowheadLength(edge.style)).toBeCloseTo(length, 6);
      expect(edge.style.arrowheadScale).toBe(scale);
      // The triangle: tip to base midpoint is the length.
      const chunk = /<g class="[^"]*sumi-k-e--ab[^"]*"[\s\S]*?<\/g>/.exec(figure.svg);
      const points = /<polygon points="([^"]+)"/.exec(chunk?.[0] ?? "")?.[1];
      if (points === undefined) throw new Error("no arrowhead");
      const [tip, p, q] = points
        .trim()
        .split(/\s+/)
        .map((pair) => pair.split(",").map(Number)) as [
        [number, number],
        [number, number],
        [number, number],
      ];
      const base = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2] as const;
      expect(Math.hypot(tip[0] - base[0], tip[1] - base[1])).toBeCloseTo(length, 2);
      expect(
        lintGeometry(figure, { source: text }).filter((d) => d.code.includes("arrowhead")),
      ).toEqual([]);
    });
  }

  test("a per-edge scale overrides the figure's, and 1 restores the default", async () => {
    const figure = await render(
      source(
        "  themeOverrides: { arrowheadScale: 0.5 }\n",
        "  - { id: x, from: b, to: d, arrowheadScale: 1 }\n  - { id: y, from: a, to: d, arrowheadScale: 2 }\n",
      ),
    );
    const scale = (id: string) =>
      figure.compiled.ir.edges.find((e) => e.id === id)?.style.arrowheadScale;
    expect(scale("ab")).toBe(0.5);
    expect(scale("x")).toBeUndefined();
    expect(scale("y")).toBe(2);
  });
});

describe("widths and corners", () => {
  test("lineWidth sets node frames and edges, emphasis keeps its ratio, borderless stays borderless", async () => {
    const plain = await render(source());
    const figure = await render(source("  themeOverrides: { lineWidth: 0.25pt }\n"));
    // paper: regular 1pt (2 units), bold 2pt (4 units)
    expect(styleOf(plain, "n:a").strokeWidth.units).toBe(2);
    expect(styleOf(figure, "n:a").strokeWidth.units).toBe(0.5);
    expect(styleOf(figure, "n:a").strokeWidth.pt).toBe(0.25);
    expect(styleOf(plain, "e:cd").strokeWidth.units).toBe(2);
    expect(styleOf(plain, "e:ab").strokeWidth.units).toBe(1);
    expect(styleOf(figure, "e:cd").strokeWidth.units).toBe(1);
    expect(styleOf(figure, "e:ab").strokeWidth.units).toBe(0.5);
  });

  test("frameWidth and cornerRadius set group frames; lineWidth does not", async () => {
    const figure = await render(
      source('  themeOverrides: { lineWidth: 2pt, frameWidth: 0.5pt, cornerRadius: "2pt" }\n'),
    );
    const group = styleOf(figure, "g:g");
    expect(group.strokeWidth.units).toBe(1);
    if (group.kind !== "group") throw new Error("not a group");
    expect(group.radius).toEqual({ pt: 2, units: 4 });
    expect(styleOf(figure, "n:a").strokeWidth.units).toBe(4);
  });

  test("an element's own lineWidth and cornerRadius win over the figure's", async () => {
    const text = source("  themeOverrides: { lineWidth: 0.5pt }\n").replace(
      "{ id: a, component: box, label: A }",
      '{ id: a, component: box, label: A, lineWidth: 2pt, cornerRadius: "4pt" }',
    );
    const figure = await render(text);
    const a = styleOf(figure, "n:a");
    expect(a.strokeWidth.units).toBe(4);
    if (a.kind !== "node") throw new Error("not a node");
    expect(a.radius).toEqual({ pt: 4, units: 8 });
    expect(styleOf(figure, "n:b").strokeWidth.units).toBe(1);
  });

  test("sets take frameWidth, cornerRadius and their own lineWidth", async () => {
    const text = source('  themeOverrides: { frameWidth: 0.5pt, cornerRadius: "1pt" }\n').replace(
      "edges:",
      `sets:
  - { id: s1, members: [ a, b ], shape: rect, variant: dotted }
  - { id: s2, members: [ c, d ], shape: rect, lineWidth: 2pt, cornerRadius: "0pt" }
edges:`,
    );
    const figure = await render(text);
    const [s1, s2] = figure.compiled.ir.sets ?? [];
    expect(s1?.style.strokeWidth.units).toBe(1);
    expect(s1?.style.strokeDotted).toBe(true);
    expect(s1?.style.radius.pt).toBe(1);
    expect(s2?.style.strokeWidth.units).toBe(4);
    expect(s2?.style.radius.pt).toBe(0);
  });
});

describe("dotted lines", () => {
  const text = source("  themeOverrides: { lineWidth: 0.5pt, arrowheadScale: 0.6 }\n");

  test("SVG: round dots three stroke widths apart", async () => {
    const figure = await render(text);
    const edge = figure.compiled.ir.edges.find((e) => e.id === "ac");
    expect(edge?.style.strokeDotted).toBe(true);
    expect(edge?.style.strokeDash).toBe(0);
    const wire = /<path class="sumi-wire"[^>]*stroke-dasharray="0,3"[^>]*>/.exec(figure.svg)?.[0];
    expect(wire).toContain('stroke-linecap="round"');
    expect(wire?.match(/stroke-linecap/g)).toHaveLength(1);
  });

  test("a dotted container draws a dotted frame", async () => {
    const figure = await render(
      text.replace("{ id: g, label: G,", "{ id: g, label: G, variant: dotted,"),
    );
    const group = styleOf(figure, "g:g");
    expect(group.strokeDotted).toBe(true);
    expect(figure.svg).toContain('stroke-dasharray="0,3" stroke-linecap="round"');
  });

  test("PDF and picture PPTX draw it", async () => {
    const figure = await render(text);
    expect(svgToPdf(figure.svg).ok).toBe(true);
    expect(svgToPptx(figure.svg).ok).toBe(true);
  });

  test("editable PPTX: sysDot with round caps, the line width and the head size", async () => {
    const figure = await render(text);
    const pptx = svgToEditablePptx(figure.svg, figure.compiled.ir);
    if (!pptx.ok) throw new Error(JSON.stringify(pptx.diagnostics));
    const slide = new TextDecoder().decode(readPptx(pptx.value).get("ppt/slides/slide1.xml"));
    expect(slide).toContain('<a:prstDash val="sysDot"/>');
    expect(slide).toMatch(/<a:ln w="6350" cap="rnd">/);
    // 0.5pt line, scale 0.6: a 2.4pt head is the small end.
    expect(slide).toMatch(/<a:tailEnd type="triangle" w="sm" len="sm"\/>/);
  });

  test("a dashed variant is unchanged: no dots", async () => {
    const figure = await render(source().replace("variant: dotted", "variant: dashed"));
    expect(figure.svg).not.toContain('stroke-dasharray="0,');
  });
});

describe("compatibility", () => {
  test("a figure without the options has no new style fields and the same SVG as an empty override", async () => {
    const plain = await render(source().replace("variant: dotted", "variant: dashed"));
    for (const element of plain.compiled.ir.elements.values()) {
      expect("strokeDotted" in element.style).toBe(false);
      expect("arrowheadScale" in element.style).toBe(false);
    }
    const sameDefaults = await render(
      source("  themeOverrides: { arrowheadScale: 1 }\n").replace(
        "variant: dotted",
        "variant: dashed",
      ),
    );
    const bare = (svg: string) => svg.replace(/input-sha256="[0-9a-f]+"/, "");
    expect(bare(sameDefaults.svg)).toBe(bare(plain.svg));
  });
});
