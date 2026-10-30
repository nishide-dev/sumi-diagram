/**
 * `figure.fit: scale` (#183, design doc §6.48): a figure wider than its
 * profile prints at the profile's width, layout unchanged, in the SVG, the
 * PDF and both PPTX modes, and its text is checked at the printed size. The
 * fixtures are #167's figures B (DiT) and C (H3-World) with `fit: scale`
 * added; they are structured and run without D2. The auto case needs D2.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createD2CliBackend } from "../backends/d2/backend";
import { checkD2Version, findD2Binary } from "../backends/d2/binary";
import { lintGeometry } from "../lint/geometry";
import { unitsToPt } from "./geometry";
import { svgToPdf } from "./pdf";
import { inspectPdf } from "./pdf/testing";
import { svgToEditablePptx, svgToPptx } from "./pptx";
import { readPptx } from "./pptx/testing";
import { type RenderedFigure, type RenderFigureOptions, renderFigure } from "./render";
import { outputSize } from "./size";

const ROOT = join(import.meta.dir, "..", "..");
const FIT = join(ROOT, "tests", "fixtures", "figures", "fit");

const binary = findD2Binary();
const available = binary.ok && (await checkD2Version(binary.value.path)).ok;

/** 180mm in pt, as written on the root of a figure shrunk to paper-double. */
const PAPER_DOUBLE_PT = "510.23622pt";

const FIT_LINE = "\n  fit: scale\n";

async function render(text: string, options: RenderFigureOptions = {}): Promise<RenderedFigure> {
  const result = await renderFigure(text, { assetBase: FIT, ...options });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  return result.value;
}

/** The SVG without the root's printed size and the hash of the YAML (the only parts `fit` changes). */
const comparable = (svg: string): string =>
  svg
    .replace(/(<svg[^>]*?) width="[^"]*" height="[^"]*"/, "$1")
    .replace(/ input-sha256="[0-9a-f]+"/, "");

const rootSize = (svg: string): [string, string] => {
  const match = /<svg[^>]*? width="([^"]*)" height="([^"]*)"/.exec(svg);
  return [match?.[1] ?? "", match?.[2] ?? ""];
};

/** Distinct font sizes (pt, as drawn) of the labels, and of the scripts of label math. */
function fontSizes(rendered: RenderedFigure): { labels: number[]; scripts: number[] } {
  const labels = new Set<number>();
  const scripts = new Set<number>();
  for (const element of rendered.inspection.elements) {
    for (const label of element.labels) {
      labels.add(unitsToPt(label.fontSizeUnits));
      for (const run of (label.runs ?? []).flat()) {
        if (run.fontSizeUnits < label.fontSizeUnits) scripts.add(unitsToPt(run.fontSizeUnits));
      }
    }
  }
  const sorted = (set: Set<number>) => [...set].map((n) => Math.round(n * 100) / 100).sort();
  return { labels: sorted(labels), scripts: sorted(scripts) };
}

describe("structured: #167 figures B and C on paper-double", () => {
  const cases = [
    // name, natural width and height (mm), scale, label sizes, script sizes (pt, as drawn)
    ["b-dit", 257, 119.94, 0.7004, [7, 8], [4.9]],
    ["c-h3world", 232.48, 163.51, 0.7743, [7, 8, 9], [5.6]],
  ] as const;

  test.each(cases)(
    "%s prints at 180mm, scaled, with the layout unchanged",
    async (name, naturalWidth, naturalHeight, scale, labels, scripts) => {
      const text = readFileSync(join(FIT, `${name}.sumi.yaml`), "utf8");
      expect(text).toContain(FIT_LINE);
      const fitted = await render(text);
      const natural = await render(text.replace(FIT_LINE, "\n"));

      const size = outputSize(fitted.inspection);
      expect(size.fits).toBe(true);
      expect(size.widthMm).toBe(180);
      expect(size.scale).toBe(scale);
      expect(size.heightMm).toBeCloseTo(naturalHeight * (180 / naturalWidth), 1);
      expect(outputSize(natural.inspection)).toMatchObject({
        widthMm: naturalWidth,
        heightMm: naturalHeight,
        fits: false,
      });
      expect(outputSize(natural.inspection).scale).toBeUndefined();

      // Only the root's printed size (and the source hash) differ.
      expect(rootSize(fitted.svg)[0]).toBe(PAPER_DOUBLE_PT);
      expect(comparable(fitted.svg)).toBe(comparable(natural.svg));
      expect(fitted.inspection.canvas).toEqual(natural.inspection.canvas);
      expect(fitted.inspection.elements).toEqual(natural.inspection.elements);

      // The text as drawn, and as printed.
      expect(fontSizes(fitted)).toEqual({ labels: [...labels], scripts: [...scripts] });
    },
  );

  test("text is checked at its printed size: B's 7pt edge labels print at 4.9pt", async () => {
    const b = await render(readFileSync(join(FIT, "b-dit.sumi.yaml"), "utf8"));
    const diagnostics = lintGeometry(b);
    expect(diagnostics.map((d) => [d.code, d.severity, d.subject?.id])).toEqual([
      ["geometry/script-too-small", "info", "stage-c-dit"],
      ["geometry/group-empty-area", "info", "incontext"],
      // Two edges 2pt from a group's border (natural size) print 1.4pt from it.
      ["geometry/edge-near-border", "info", "edges[8]"],
      ["geometry/edge-near-border", "info", "edges[9]"],
      ["geometry/text-too-small", "error", "edges[26]"],
      ["geometry/text-too-small", "error", "edges[27]"],
      ["geometry/text-too-small", "error", "edges[28]"],
      ["geometry/text-too-small", "error", "edges[29]"],
    ]);
    expect(diagnostics[4]?.message).toContain("printed at 4.9pt (7pt shrunk to 70%");
    expect(diagnostics[0]?.message).toContain("down to 3.43pt");
    expect(diagnostics[2]?.message).toContain("(0.49mm between the lines)");
  });

  test("C reports its existing micro-jogs and reports its scripts once, as information", async () => {
    const c = await render(readFileSync(join(FIT, "c-h3world.sumi.yaml"), "utf8"));
    const diagnostics = lintGeometry(c);
    expect(diagnostics.map((d) => [d.code, d.severity, d.subject?.id])).toEqual([
      ["geometry/script-too-small", "info", "stage-c-h3world"],
      ["geometry/edge-jog", "info", "edges[17]"],
      ["geometry/edge-jog", "info", "edges[20]"],
    ]);
    expect(diagnostics[0]?.message).toContain("down to 4.34pt (5.6pt shrunk to 77.4%");
  });

  test("the PDF page and both PPTX slides are 180mm wide", async () => {
    const b = await render(readFileSync(join(FIT, "b-dit.sumi.yaml"), "utf8"));
    const [, height] = rootSize(b.svg);
    const pdf = svgToPdf(b.svg);
    if (!pdf.ok) throw new Error(JSON.stringify(pdf.diagnostics));
    const inspected = inspectPdf(pdf.value);
    const [x0, y0, x1, y1] = inspected.pages[0]?.mediaBox ?? [];
    expect([x0, y0]).toEqual([0, 0]);
    expect(x1).toBeCloseTo(510.236, 2);
    expect(y1).toBeCloseTo(Number.parseFloat(height), 2);
    // The text shrinks with the page: 8pt node labels print at 5.6pt.
    const sizes = new Set(inspected.glyphs.map((g) => Math.round(g.size * 100) / 100));
    expect(sizes.has(5.6)).toBe(true);
    expect(Math.max(...sizes)).toBeLessThan(6.31);

    const slideSize = (bytes: Uint8Array) => {
      const xml = new TextDecoder().decode(readPptx(bytes).get("ppt/presentation.xml"));
      return /<p:sldSz cx="(\d+)" cy="(\d+)"/.exec(xml)?.slice(1).map(Number);
    };
    const picture = svgToPptx(b.svg);
    if (!picture.ok) throw new Error(JSON.stringify(picture.diagnostics));
    // 180mm = 6,480,000 EMU.
    expect(slideSize(picture.value)?.[0]).toBe(6480000);
    const editable = svgToEditablePptx(b.svg, b.compiled.ir);
    if (!editable.ok) throw new Error(JSON.stringify(editable.diagnostics));
    expect(slideSize(editable.value)?.[0]).toBe(6480000);
    const slide = new TextDecoder().decode(readPptx(editable.value).get("ppt/slides/slide1.xml"));
    const fontSizesHundredths = new Set([...slide.matchAll(/ sz="(\d+)"/g)].map((m) => m[1]));
    // 8pt and 7pt labels at 70%: 5.6pt and 4.9pt.
    expect([...fontSizesHundredths].sort()).toEqual(["490", "560"]);
  });

  test("C: the PDF page and the picture PPTX are 180mm wide (its images rule out the editable PPTX)", async () => {
    const c = await render(readFileSync(join(FIT, "c-h3world.sumi.yaml"), "utf8"));
    const [, height] = rootSize(c.svg);
    const pdf = svgToPdf(c.svg);
    if (!pdf.ok) throw new Error(JSON.stringify(pdf.diagnostics));
    const [, , x1, y1] = inspectPdf(pdf.value).pages[0]?.mediaBox ?? [];
    expect(x1).toBeCloseTo(510.236, 2);
    expect(y1).toBeCloseTo(Number.parseFloat(height), 2);
    const picture = svgToPptx(c.svg);
    if (!picture.ok) throw new Error(JSON.stringify(picture.diagnostics));
    const xml = new TextDecoder().decode(readPptx(picture.value).get("ppt/presentation.xml"));
    expect(xml).toContain('<p:sldSz cx="6480000"');
  });

  test.each(["freeform", "glued"] as const)(
    "B: the editable PPTX (%s) scales every length, stroke, inset, line spacing and text size",
    async (connectors) => {
      const text = readFileSync(join(FIT, "b-dit.sumi.yaml"), "utf8");
      const fitted = await render(text);
      const natural = await render(text.replace(FIT_LINE, "\n"));
      const scale = fitted.inspection.scale ?? 1;
      const slideOf = (rendered: RenderedFigure) => {
        const result = svgToEditablePptx(rendered.svg, rendered.compiled.ir, { connectors });
        if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
        return new TextDecoder().decode(readPptx(result.value).get("ppt/slides/slide1.xml"));
      };
      const a = slideOf(natural);
      const b = slideOf(fitted);
      // The same shapes in the same order: every length attribute (offsets,
      // extents, path points and sizes, line widths, insets, text sizes, line
      // spacing) is the natural one times the scale, give or take rounding.
      const LENGTH = / (x|y|cx|cy|w|h|lIns|rIns|tIns|sz|val)="(-?\d+)"/g;
      const lengths = (xml: string) =>
        [...xml.replace(/<a:alpha val="\d+"\/>/g, "").matchAll(LENGTH)].map(
          (m) => [m[1], Number(m[2])] as const,
        );
      const before = lengths(a);
      const after = lengths(b);
      expect(after.map(([name]) => name)).toEqual(before.map(([name]) => name));
      expect(before.length).toBeGreaterThan(500);
      for (const [i, [name, value]] of before.entries()) {
        const scaled = after[i]?.[1] ?? Number.NaN;
        if (Math.abs(scaled - value * scale) > 1.5)
          throw new Error(`${name} #${i}: ${scaled} is not ${value} × ${scale}`);
      }
      // Line spacing and insets are among them.
      expect(b).toMatch(/<a:spcPts val="\d+"\/>/);
      expect(b).toMatch(/ tIns="\d+"/);
      // Arrowheads pick the DrawingML size nearest the printed marker: never larger.
      const RANK = { sm: 0, med: 1, lg: 2 } as const;
      const ends = (xml: string) =>
        [...xml.matchAll(/<a:(?:head|tail)End type="\w+" w="(sm|med|lg)" len="(sm|med|lg)"/g)].map(
          (m) => RANK[m[1] as keyof typeof RANK] + RANK[m[2] as keyof typeof RANK],
        );
      const endsBefore = ends(a);
      const endsAfter = ends(b);
      expect(endsAfter).toHaveLength(endsBefore.length);
      expect(endsAfter.length).toBeGreaterThan(0);
      for (const [i, rank] of endsAfter.entries())
        expect(rank).toBeLessThanOrEqual(endsBefore[i] ?? -1);
    },
  );

  test("the editable PPTX refuses text that would print below 1pt", async () => {
    // One 3000pt-wide box shrunk to 88mm: 8pt text prints at about 0.67pt.
    const text = `version: 1
figure:
  id: huge
  profile: paper-single
  fit: scale
  layout: { arrange: { row: { items: [a] } } }
nodes:
  - { id: a, component: box, label: A, props: { width: 3000pt, height: 40pt } }
`;
    const huge = await render(text);
    expect(huge.inspection.scale).toBeLessThan(0.1);
    const result = svgToEditablePptx(huge.svg, huge.compiled.ir);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((d) => [d.code, d.severity])).toEqual([
      ["pptx/unsupported-size", "error"],
    ]);
    expect(result.diagnostics[0]?.message).toContain("smaller than 1pt");
    // The picture PPTX keeps it (the text is outlined).
    expect(svgToPptx(huge.svg).ok).toBe(true);
  });

  test("a figure narrower than the profile is never enlarged", async () => {
    const text = `version: 1
figure:
  id: narrow
  profile: paper-double
  fit: scale
  layout: { arrange: { row: { items: [a, b] } } }
nodes:
  - { id: a, component: box, label: A }
  - { id: b, component: box, label: B }
edges:
  - { from: a, to: b }
`;
    const fitted = await render(text);
    const natural = await render(text.replace(FIT_LINE, "\n"));
    expect(fitted.svg.replace(/ input-sha256="[0-9a-f]+"/, "")).toBe(
      natural.svg.replace(/ input-sha256="[0-9a-f]+"/, ""),
    );
    expect(fitted.inspection.scale).toBeUndefined();
    expect(outputSize(fitted.inspection).scale).toBeUndefined();
  });
});

describe.skipIf(!available)("auto (D2)", () => {
  test("a wide auto figure prints at the profile width, layout unchanged", async () => {
    const nodes = Array.from({ length: 9 }, (_, i) => `n${i}`);
    const text = `version: 1
figure:
  id: wide-auto
  profile: paper-single
  fit: scale
nodes:
${nodes.map((id) => `  - { id: ${id}, component: box, label: Step ${id} }`).join("\n")}
edges:
${nodes
  .slice(1)
  .map((id, i) => `  - { from: n${i}, to: ${id} }`)
  .join("\n")}
`;
    const backend = createD2CliBackend();
    const fitted = await render(text, { backend });
    const natural = await render(text.replace(FIT_LINE, "\n"), { backend });
    expect(outputSize(natural.inspection).fits).toBe(false);
    const size = outputSize(fitted.inspection);
    expect(size).toMatchObject({ widthMm: 88, fits: true });
    expect(size.scale).toBeLessThan(1);
    expect(comparable(fitted.svg)).toBe(comparable(natural.svg));
    expect(lintGeometry(fitted).filter((d) => d.code === "geometry/exceeds-page-width")).toEqual(
      [],
    );
  }, 60_000);
});
