/**
 * The structured SVG writer (#91): its output passes the real inspect
 * contract, matches the Layout IR it was drawn from, embeds working font
 * subsets, is deterministic, and goes through the geometry lint, the PDF and
 * both PPTX exports.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { EdgeIR } from "../compiler/ir";
import { DEFAULT_FONT_SET_ID, getFontSet } from "../core/theme/fonts";
import { arrowheadLength } from "../layout/route/router";
import { parseGlyphCoverage } from "../lint/cmap";
import { lintGeometry } from "../lint/geometry";
import { fontFileFor, renderedLines } from "../lint/geometry/measure";
import { loadFontMetrics, parseFontMetrics } from "../lint/metrics";
import { readTables } from "../lint/sfnt";
import { checkEmbeddedFonts, readSvgMetadata } from "./finalize";
import { subsetFont } from "./font-subset";
import { BoundsBuilder, type Point } from "./geometry";
import { inspectSvg } from "./inspect";
import { svgToPdf } from "./pdf";
import { svgToEditablePptx, svgToPptx } from "./pptx";
import { readPptx } from "./pptx/testing";
import { type RenderedStructuredFigure, renderFigure } from "./render";
import { dashArray, drawArrowhead, mergeSegments } from "./structured";
import { readD2Svg } from "./svg";
import { parseXml } from "./xml";

const ROOT = join(import.meta.dir, "..", "..");
const fonts = getFontSet(DEFAULT_FONT_SET_ID);
if (fonts === undefined) throw new Error("no default font set");

/** Renders a structured figure; it must not be rendered by D2 (no backend is given that would work). */
async function render(source: string): Promise<RenderedStructuredFigure> {
  const result = await renderFigure(source, {
    backend: {
      name: "d2-cli",
      render: () => {
        throw new Error("a structured figure must not reach the D2 backend");
      },
    },
  });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  if (result.value.compiled.engine !== "structured") throw new Error("not structured");
  expect(result.diagnostics).toEqual([]);
  return result.value as RenderedStructuredFigure;
}

const FIGURES = {
  "examples/transformer": "examples/transformer/transformer.sumi.yaml",
  "examples/dit-block": "examples/dit-block/dit-block.sumi.yaml",
  "fixture A": "tests/fixtures/figures/layout/a-transformer.sumi.yaml",
  "fixture B": "tests/fixtures/figures/layout/b-adaln-panel.sumi.yaml",
} as const;

const ALL_SHAPES = `version: 1
figure:
  id: shapes
  theme: minimal
  profile: paper-double
  layout:
    arrange:
      row:
        items:
          - stack: { items: [box, square, circle, ellipse, diamond] }
          - stack: { items: [hexagon, parallelogram, cylinder, document] }
          - stack: { items: [trapezoid, stack, note, plus, dot, times] }
nodes:
  - { id: box, component: box, label: Box, variant: emphasis }
  - { id: square, component: square, label: Sq }
  - { id: circle, component: circle, label: C }
  - { id: ellipse, component: ellipse, label: Ellipse }
  - { id: diamond, component: diamond, label: "Yes?" }
  - { id: hexagon, component: hexagon, label: Hexagon }
  - { id: parallelogram, component: parallelogram, label: Input, variant: muted }
  - { id: cylinder, component: cylinder, label: "Data\\nbase" }
  - { id: document, component: document, label: Report }
  - { id: trapezoid, component: trapezoid, label: Trapezoid }
  - { id: stack, component: stack, label: Stack }
  - { id: note, component: label, label: "a <note> & more" }
  - { id: plus, component: operator, props: { symbol: concat } }
  - { id: dot, component: junction }
  - { id: times, component: operator, props: { symbol: times }, variant: emphasis }
edges:
  - { from: box, to: square }
  - { from: square, to: circle, component: double-arrow }
  - { from: circle, to: ellipse, variant: dashed }
  - { from: hexagon, to: parallelogram, component: line, variant: muted }
  - { from: trapezoid, to: stack }
  - { from: plus, to: dot, component: line }
  - { from: dot, to: times }
`;

describe.each(Object.entries(FIGURES))("%s", (_name, path) => {
  const source = readFileSync(join(ROOT, path), "utf8");

  test("passes the real inspection, matching the Layout IR it was drawn from", async () => {
    const rendered = await render(source);
    const { svg, layout, compiled } = rendered;
    const again = inspectSvg(svg, compiled.ir);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    const byKey = new Map(again.value.elements.map((e) => [e.key, e]));
    expect(byKey.size).toBe(compiled.ir.elements.size);
    const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-9);
    for (const placed of [...layout.groups, ...layout.nodes]) {
      const geometry = byKey.get(placed.key);
      if (placed.kind === "node" && placed.shape === "text") {
        expect(geometry?.bbox).toBeUndefined();
      } else {
        for (const side of ["x", "y", "width", "height"] as const) {
          close(geometry?.bbox?.[side] ?? Number.NaN, placed.rect[side]);
        }
      }
      if (placed.label !== undefined) {
        const label = geometry?.labels[0];
        expect(label?.anchor).toEqual(placed.label.anchor);
        expect(label?.lineHeightUnits).toBe(
          placed.label.lines.length > 1 ? placed.label.lineHeightUnits : placed.label.fontSizeUnits,
        );
        expect(renderedLines(label?.text ?? "")).toEqual([...placed.label.lines]);
        expect(label?.font).toBe(placed.label.font);
      } else expect(geometry?.labels).toEqual([]);
    }
    for (const edge of layout.edges) {
      const path = byKey.get(edge.key)?.path ?? [];
      expect(path.map((s) => s.command)).toEqual(
        (edge.route?.points ?? []).map((_, i) => (i === 0 ? "M" : "L")),
      );
      expect(path.map((s) => s.to)).toEqual([...(edge.route?.points ?? [])]);
      expect(byKey.get(edge.key)?.labels.map((l) => l.anchor)).toEqual(
        edge.route?.label === undefined ? [] : [edge.route.label.anchor],
      );
    }
    expect(again.value.canvas.viewBox).toEqual({
      x: 0,
      y: 0,
      width: layout.canvas.width,
      height: layout.canvas.height,
    });
  });

  test("is byte-deterministic and carries the structured backend in its metadata", async () => {
    const first = await render(source);
    const second = await render(source);
    expect(second.svg).toBe(first.svg);
    const metadata = readSvgMetadata(first.svg);
    expect(metadata).toEqual({ ok: true, value: first.metadata, diagnostics: [] });
    expect(first.metadata.backend).toEqual({
      name: "sumi-structured",
      version: first.metadata.sumiVersion,
    });
    expect(first.metadata.d2Sha256).toBeUndefined();
    expect(first.svg).not.toContain("d2-sha256");
  });

  test("embeds a working font subset for every font class it uses", async () => {
    const { svg, layout } = await render(source);
    const read = readD2Svg(svg);
    if (!read.ok) throw new Error("unreadable");
    expect(checkEmbeddedFonts(read.doc.drawing)).toEqual([]);
    const faces = [
      ...svg.matchAll(
        /font-family: (sumi-\d+-font-([a-z-]+));\n\tsrc: url\("data:font\/ttf;base64,([^"]+)"\)/g,
      ),
    ];
    const used = new Map<string, string>();
    for (const t of [
      ...layout.groups.map((g) => g.label),
      ...layout.nodes.map((n) => n.label),
      ...layout.edges.map((e) => e.route?.label),
    ]) {
      if (t !== undefined) used.set(t.font, (used.get(t.font) ?? "") + t.lines.join(""));
    }
    expect(faces.map((f) => f[2]).sort()).toEqual([...used.keys()].sort());
    for (const [, , font = "", base64 = ""] of faces) {
      const bytes = new Uint8Array(Buffer.from(base64, "base64"));
      const coverage = parseGlyphCoverage(bytes);
      const metrics = parseFontMetrics(bytes);
      const original = loadFontMetrics(fontFileFor(font, fonts));
      for (const char of new Set(used.get(font))) {
        expect(coverage.has(char.codePointAt(0) ?? 0), char).toBe(true);
        expect(metrics.measureEm(char)).toBe(original.measureEm(char));
      }
      expect(readTables(bytes).get("OS/2")).toBeDefined();
    }
  });

  test("converts to PDF and both PPTX modes", async () => {
    const { svg, compiled } = await render(source);
    const pdf = svgToPdf(svg);
    expect(pdf.ok && pdf.diagnostics).toEqual([]);
    const picture = svgToPptx(svg);
    expect(picture.ok && picture.diagnostics).toEqual([]);
    for (const connectors of ["freeform", "glued"] as const) {
      const editable = svgToEditablePptx(svg, compiled.ir, { connectors });
      if (!editable.ok) throw new Error(JSON.stringify(editable.diagnostics));
      const slide = new TextDecoder().decode(readPptx(editable.value).get("ppt/slides/slide1.xml"));
      // Every edge is a visible line (the connection path carries no stroke paint).
      for (const edge of compiled.ir.edges) {
        const shape = new RegExp(
          `name="${edge.key}"[\\s\\S]*?<a:ln w="\\d+" cap="rnd"><a:solidFill>`,
        );
        expect(shape.test(slide), edge.key).toBe(true);
      }
    }
  });
});

describe("geometry lint on structured SVGs", () => {
  test("the examples and the B panel are clean", async () => {
    for (const path of Object.values(FIGURES).filter((p) => !p.includes("a-transformer"))) {
      const source = readFileSync(join(ROOT, path), "utf8");
      expect(lintGeometry(await render(source), { source })).toEqual([]);
    }
  });

  // #89: the existing geometry rules work on SVGs drawn from the Layout IR.
  test("exceeds-page-width fires on a structured figure wider than its profile", async () => {
    const source = readFileSync(join(ROOT, FIGURES["fixture A"]), "utf8");
    const rendered = await render(source);
    expect(rendered.inspection.canvas.width.mm).toBeGreaterThan(88);
    const codes = lintGeometry(rendered, { source }).map((d) => d.code);
    expect(codes).toEqual(["geometry/exceeds-page-width"]);
    const narrow = source.replace("profile: paper-single", "profile: paper-double");
    expect(lintGeometry(await render(narrow), { source: narrow })).toEqual([]);
  });

  test("every shape, mark, outline and arrowhead kind passes inspection and the lint", async () => {
    const rendered = await render(ALL_SHAPES);
    expect(lintGeometry(rendered, { source: ALL_SHAPES })).toEqual([]);
    const { svg } = rendered;
    expect(svg).toContain("&lt;note&gt; &amp; more");
    expect(svg).toContain('stroke-dasharray="');
    expect(parseXml(svg).ok).toBe(true);
  });
});

describe("drawing helpers", () => {
  test("dash arrays follow D2's formula", () => {
    expect(dashArray(1, 3)).toEqual([3, 3]);
    expect(dashArray(2, 0)).toBeUndefined();
    const [dash, gap] = dashArray(2, 5) ?? [0, 0];
    expect(dash).toBe(10);
    expect(gap).toBeCloseTo((Math.log10(9.4) * 0.5 + 0.5) * 10, 9);
  });

  test("merges collinear segments into maximal ones", () => {
    const p = (x: number, y: number): Point => ({ x, y });
    expect(
      mergeSegments([
        [p(0, 0), p(0, 10)],
        [p(0, 5), p(0, 20)],
        [p(5, 3), p(1, 3)],
        [p(0, 30), p(0, 40)],
        [p(2, 2), p(2, 2)],
        [p(0, 0), p(3, 4)],
      ]),
    ).toEqual([
      [p(1, 3), p(5, 3)],
      [p(0, 0), p(0, 20)],
      [p(0, 30), p(0, 40)],
      [p(0, 0), p(3, 4)],
    ]);
  });

  test("arrowheads stay within arrowheadLength() of the tip, behind it", () => {
    const edge = { style: { stroke: "#000000", strokeWidth: { units: 2 }, filled: true } };
    const tip = { x: 100, y: 50 };
    for (const filled of [true, false]) {
      for (const head of ["triangle", "arrow", "diamond", "circle", "box", "cross"] as const) {
        const svg = drawArrowhead(head, tip, { x: 0, y: 1 }, {
          ...edge,
          style: { ...edge.style, filled },
        } as unknown as EdgeIR);
        const numbers = [...svg.matchAll(/(?:points|d|cx|cy|r)="([^"]*)"/g)];
        expect(numbers.length).toBeGreaterThan(0);
        const parsed = parseXml(`<svg>${svg}</svg>`);
        expect(parsed.ok).toBe(true);
        const bounds = new BoundsBuilder();
        for (const [, value = ""] of svg.matchAll(/points="([^"]*)"/g)) {
          for (const pair of value.split(" ")) {
            const [x, y] = pair.split(",").map(Number);
            bounds.add({ x: x ?? 0, y: y ?? 0 });
          }
        }
        const box = bounds.rect();
        if (box !== undefined) {
          expect(box.y + box.height).toBeLessThanOrEqual(tip.y + 1e-9);
          expect(box.y).toBeGreaterThanOrEqual(tip.y - arrowheadLength(2) - 1e-9);
        }
      }
    }
    expect(drawArrowhead("none", tip, { x: 0, y: 1 }, edge as unknown as EdgeIR)).toBe("");
  });
});

describe("font subsets", () => {
  test("map every character the font has, keep advances and add composite components", () => {
    const text = "Ä fi +×−•‖ 日本語 𠮷";
    const bytes = subsetFont(fonts.regular, text);
    const coverage = parseGlyphCoverage(bytes);
    const original = loadFontMetrics(fonts.regular);
    const originalCoverage = parseGlyphCoverage(new Uint8Array(readFileSync(fonts.regular)));
    for (const char of new Set(text)) {
      const cp = char.codePointAt(0) ?? 0;
      expect(coverage.has(cp)).toBe(originalCoverage.has(cp));
      if (coverage.has(cp))
        expect(parseFontMetrics(bytes).measureEm(char)).toBe(original.measureEm(char));
    }
    expect(subsetFont(fonts.regular, text)).toEqual(bytes);
    const tables = readTables(bytes);
    for (const name of [
      "cmap",
      "OS/2",
      "glyf",
      "loca",
      "head",
      "hhea",
      "hmtx",
      "maxp",
      "name",
      "post",
    ]) {
      expect(tables.get(name), name).toBeDefined();
    }
  });
});
