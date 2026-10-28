/**
 * The structured SVG writer (#91): its output passes the real inspect
 * contract, matches the Layout IR it was drawn from, embeds working font
 * subsets, is deterministic, and goes through the geometry lint, the PDF and
 * both PPTX exports.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { EdgeIR, FigureIR, GroupIR } from "../compiler/ir";
import type { Arrowhead } from "../core/registry/manifest";
import { DEFAULT_FONT_SET_ID, getFontSet } from "../core/theme/fonts";
import type { LayoutIR } from "../layout/ir";
import { arrowheadLength } from "../layout/route/router";
import { parseGlyphCoverage } from "../lint/cmap";
import { lintGeometry } from "../lint/geometry";
import { fontFileFor, renderedLines } from "../lint/geometry/measure";
import { loadFontMetrics, parseFontMetrics } from "../lint/metrics";
import { readTables } from "../lint/sfnt";
import { checkEmbeddedFonts, finalizeStructuredSvg, readSvgMetadata } from "./finalize";
import { subsetFont } from "./font-subset";
import { BoundsBuilder, type Point } from "./geometry";
import { inspectSvg } from "./inspect";
import { svgToPdf } from "./pdf";
import { svgToEditablePptx, svgToPptx } from "./pptx";
import { readPptx } from "./pptx/testing";
import { type RenderedStructuredFigure, renderFigure } from "./render";
import {
  backgroundAt,
  CANVAS_FILL,
  dashArray,
  drawArrowhead,
  labelBackground,
  mergeSegments,
  writeStructuredSvg,
} from "./structured";
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
      if (t === undefined) continue;
      for (const run of t.runs?.flat() ?? [{ font: t.font, text: t.lines.join("") }]) {
        used.set(run.font, (used.get(run.font) ?? "") + run.text);
      }
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
      if (compiled.ir.nodes.some((n) => n.icon !== undefined)) {
        // Icons (#94) have no editable form yet: refused, never dropped.
        expect(editable.ok).toBe(false);
        expect(new Set(editable.diagnostics.map((d) => d.code))).toEqual(
          new Set(["pptx/unsupported-asset"]),
        );
        continue;
      }
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

  // The reproduction (research/109-dogfood-v0.4, A9): an edge label beside
  // the arrowhead, where the edge enters a group, sat on the group's border
  // unnoticed. The label now moves off the border where it can (past it,
  // outside the group); with no room there, the lint reports it.
  test("an edge label on a group's border is a label-collision (#116)", async () => {
    const source = `version: 1
figure:
  id: a9
  theme: academic
  layout:
    arrange:
      stack: { gap: 2mm, align: center, items: [a, grp] }
groups:
  - id: grp
    arrange: { stack: { items: [b] } }
nodes:
  - { id: a, component: box, label: A }
  - { id: b, component: box, label: B }
edges:
  - { from: a, to: b, label: gRPC }
`;
    const findings = lintGeometry(await render(source), { source });
    expect(findings.map((d) => [d.code, d.message, d.location?.line])).toEqual([
      [
        "geometry/label-collision",
        'The label of edge edges[0] overlaps the border of group "grp".',
        15,
      ],
    ]);
    // With room before the group, the label goes there.
    const roomy = source.replace("gap: 2mm", "gap: 4mm");
    expect(lintGeometry(await render(roomy), { source: roomy })).toEqual([]);
  });

  test("every shape, mark, outline and arrowhead kind passes inspection and the lint", async () => {
    const rendered = await render(ALL_SHAPES);
    expect(lintGeometry(rendered, { source: ALL_SHAPES })).toEqual([]);
    expectBoundsOfLayout(rendered);
    const { svg } = rendered;
    expect(svg).toContain("&lt;note&gt; &amp; more");
    expect(svg).toContain('stroke-dasharray="');
    expect(parseXml(svg).ok).toBe(true);
  });
});

/** Every shape's inspected bbox is its Layout IR rect (to float precision). */
function expectBoundsOfLayout(rendered: RenderedStructuredFigure): void {
  const boxes = new Map(rendered.inspection.elements.map((e) => [e.key, e.bbox]));
  for (const placed of [...rendered.layout.groups, ...rendered.layout.nodes]) {
    if (placed.kind === "node" && placed.shape === "text") continue;
    const bbox = boxes.get(placed.key);
    for (const side of ["x", "y", "width", "height"] as const) {
      expect(
        Math.abs((bbox?.[side] ?? Number.NaN) - placed.rect[side]),
        `${placed.key} ${side}`,
      ).toBeLessThan(1e-9);
    }
  }
}

test("shapes keep exact bounds at fractional sizes", async () => {
  const source = `version: 1
figure:
  id: precision
  theme: minimal
  profile: paper-double
  layout:
    arrange:
      row:
        items:
          - stack:
              align: stretch
              items: [oval, row: { gap: 0.0005pt, items: [b1, b2] }]
          - doc
          - doc2
          - cyl
nodes:
  - { id: oval, component: ellipse, label: O }
  - { id: b1, component: box, label: B, props: { width: 20pt } }
  - { id: b2, component: box, label: B, props: { width: 20pt } }
  - { id: doc, component: document, label: D, props: { height: 20pt } }
  - { id: doc2, component: document, label: D, props: { height: 33.5pt } }
  - { id: cyl, component: cylinder, label: C, props: { height: 41.5pt } }
`;
  const rendered = await render(source);
  const oval = rendered.layout.nodes.find((n) => n.key === "n:oval");
  expect(oval?.rect.width).toBe(80.001);
  expectBoundsOfLayout(rendered);
});

/** The fill of each labeled edge's label background in the SVG (`undefined`: none), by edge index. */
function svgLabelBackgrounds(svg: string): Map<number, string | undefined> {
  const out = new Map<number, string | undefined>();
  for (const [, index = "", body = ""] of svg.matchAll(
    /<g class="sumi-k-e--_(\d+) sumi-kind-edge"[^>]*>(.*?)<\/g>/g,
  )) {
    if (!body.includes("<text")) continue;
    out.set(Number(index), /<rect [^>]*fill="([^"]*)"\/><text/.exec(body)?.[1]);
  }
  return out;
}

/** The fill of each edge label's shape in the editable PPTX (`undefined`: no fill), by edge index. */
function pptxLabelBackgrounds(svg: string, ir: FigureIR): Map<number, string | undefined> {
  const editable = svgToEditablePptx(svg, ir);
  if (!editable.ok) throw new Error(JSON.stringify(editable.diagnostics));
  const slide = new TextDecoder().decode(readPptx(editable.value).get("ppt/slides/slide1.xml"));
  const out = new Map<number, string | undefined>();
  for (const [, index = "", fill] of slide.matchAll(
    /name="e:#(\d+) label 0"\/>.*?<\/a:prstGeom>(?:<a:noFill\/>|<a:solidFill><a:srgbClr val="([0-9A-F]{6})">)/g,
  )) {
    out.set(Number(index), fill === undefined ? undefined : `#${fill.toLowerCase()}`);
  }
  return out;
}

/**
 * Draws a rendered figure again with the writer, as a theme with another
 * edge `fill` would (themes are built in only, so the IR is changed), and/or
 * with another layout or group styles; finalized like `renderFigure()` does.
 */
function redraw(
  rendered: RenderedStructuredFigure,
  changes: {
    edgeFill?: string;
    groupFill?: Record<string, string>;
    layout?: LayoutIR;
    /** Hollow (`false`) or filled arrowheads (#192): the built-in themes only fill them. */
    filled?: boolean;
    targetArrowhead?: Arrowhead;
  },
): { svg: string; ir: FigureIR } {
  const { compiled } = rendered;
  const changed: Pick<FigureIR, "groups" | "edges"> = {
    groups: compiled.ir.groups.map((g) => {
      const fill = changes.groupFill?.[g.id];
      return fill === undefined
        ? g
        : { ...g, style: { ...g.style, fill: fill as GroupIR["style"]["fill"] } };
    }),
    edges: compiled.ir.edges.map((e) => ({
      ...e,
      ...(changes.targetArrowhead !== undefined && { targetArrowhead: changes.targetArrowhead }),
      style: {
        ...e.style,
        fill: (changes.edgeFill ?? e.style.fill) as EdgeIR["style"]["fill"],
        filled: changes.filled ?? e.style.filled,
      },
    })),
  };
  // `elements` (read by the editable PPTX) holds the changed elements too.
  const ir: FigureIR = {
    ...compiled.ir,
    ...changed,
    elements: new Map(
      [...changed.groups, ...compiled.ir.nodes, ...changed.edges].map((e) => [e.key, e] as const),
    ),
  };
  if (fonts === undefined) throw new Error("no default font set");
  const svg = writeStructuredSvg(ir, changes.layout ?? rendered.layout, fonts);
  const finalized = finalizeStructuredSvg(svg, { ...compiled, ir }, { source: "" });
  if (!finalized.ok) throw new Error(JSON.stringify(finalized.diagnostics));
  return { svg: finalized.value.svg, ir };
}

const groupFill = (rendered: RenderedStructuredFigure, id: string): string => {
  const fill = rendered.compiled.ir.groups.find((g) => g.id === id)?.style.fill;
  if (fill === undefined) throw new Error(`no group ${id}`);
  return fill;
};

// #170 (design doc §6.41): an edge label's background is the color painted
// beneath it, not the edge's `fill` (white), in the SVG and the editable PPTX.
describe("edge label backgrounds (#170)", () => {
  const nested = (theme: string, outer: string, inner: string) => `version: 1
figure:
  id: label-bg
  theme: ${theme}
  layout:
    arrange:
      row: { gap: 6mm, items: [top, outer] }
groups:
  - id: outer
${outer}
    arrange: { stack: { items: [inner] } }
  - id: inner
${inner}
    arrange: { stack: { gap: 6mm, items: [a, b] } }
nodes:
  - { id: top, component: box, label: Top }
  - { id: a, component: box, label: A }
  - { id: b, component: box, label: B }
edges:
  - { from: a, to: b, label: inside }
  - { from: top, to: outer, label: outside }
`;

  async function backgrounds(source: string) {
    const rendered = await render(source);
    const svg = svgLabelBackgrounds(rendered.svg);
    // The editable PPTX paints the same color behind each label.
    expect(pptxLabelBackgrounds(rendered.svg, rendered.compiled.ir)).toEqual(svg);
    return { rendered, svg };
  }

  test("a filled group (minimal: surface)", async () => {
    const { rendered, svg } = await backgrounds(nested("minimal", "", ""));
    expect(groupFill(rendered, "inner")).toBe("#f6f8fa");
    expect(svg).toEqual(
      new Map([
        [0, "#f6f8fa"],
        [1, "#ffffff"],
      ]),
    );
  });

  test("a toned group", async () => {
    const { rendered, svg } = await backgrounds(nested("minimal", "", "    tone: yellow"));
    const fill = groupFill(rendered, "inner");
    expect(fill).not.toBe("#f6f8fa");
    expect(svg.get(0)).toBe(fill);
  });

  test("a transparent inner group inside a colored outer one", async () => {
    const { rendered, svg } = await backgrounds(nested("academic", "    tone: blue", ""));
    expect(groupFill(rendered, "inner")).toBe("transparent");
    const outer = groupFill(rendered, "outer");
    expect(outer).not.toBe("transparent");
    expect(svg.get(0)).toBe(outer);
    expect(svg.get(1)).toBe("#ffffff");
  });

  test("transparent groups only, as academic draws them by default: the canvas", async () => {
    const { rendered, svg } = await backgrounds(nested("academic", "", ""));
    expect(groupFill(rendered, "outer")).toBe("transparent");
    expect(groupFill(rendered, "inner")).toBe("transparent");
    expect(svg).toEqual(
      new Map([
        [0, "#ffffff"],
        [1, "#ffffff"],
      ]),
    );
  });

  // The #116 reproduction: the label sits on the group's border (reported by
  // geometry/label-collision). The color is the one under the box's center:
  // here above the border, so the canvas, though its lower part is on the
  // group (the other way round in the labelBackground() test below).
  test("a box across a group border takes the color under its center", async () => {
    const source = `version: 1
figure:
  id: a9
  theme: minimal
  layout:
    arrange:
      stack: { gap: 2mm, align: center, items: [a, grp] }
groups:
  - id: grp
    arrange: { stack: { items: [b] } }
nodes:
  - { id: a, component: box, label: A }
  - { id: b, component: box, label: B }
edges:
  - { from: a, to: b, label: gRPC }
`;
    const { rendered, svg } = await backgrounds(source);
    const box = rendered.layout.edges[0]?.route?.label?.box;
    const rect = rendered.layout.groups[0]?.rect;
    if (box === undefined || rect === undefined) throw new Error("no label or group");
    const cy = box.y + box.height / 2;
    // It does straddle the border, with its center outside the group.
    expect(box.y + box.height).toBeGreaterThan(rect.y);
    expect(cy).toBeLessThan(rect.y);
    expect(groupFill(rendered, "grp")).toBe("#f6f8fa");
    expect(svg.get(0)).toBe(CANVAS_FILL);
  });

  // A label centered exactly on a group's border counts as inside the group.
  test("a box centered on a group border takes the group's color", async () => {
    const rendered = await render(nested("minimal", "", ""));
    const box = rendered.layout.edges[0]?.route?.label?.box;
    if (box === undefined) throw new Error("no label");
    const cy = box.y + box.height / 2;
    // The inner group's top border moved to run through the label's center.
    const at = (y: number): LayoutIR => ({
      ...rendered.layout,
      groups: rendered.layout.groups.map((g) =>
        g.key === "g:inner"
          ? { ...g, rect: { ...g.rect, y, height: g.rect.height + g.rect.y - y } }
          : g,
      ),
    });
    // Inner group yellow, outer transparent: inside is yellow, outside the canvas.
    const groupFill = { inner: "#ffee00", outer: "transparent" };
    const on = redraw(rendered, { groupFill, layout: at(cy) });
    expect(svgLabelBackgrounds(on.svg).get(0)).toBe("#ffee00");
    expect(pptxLabelBackgrounds(on.svg, on.ir).get(0)).toBe("#ffee00");
    const below = redraw(rendered, { groupFill, layout: at(cy + 0.001) });
    expect(svgLabelBackgrounds(below.svg).get(0)).toBe(CANVAS_FILL);
    expect(pptxLabelBackgrounds(below.svg, below.ir).get(0)).toBe(CANVAS_FILL);
  });

  // The edge's `fill` (#31) turns the background on or off; its color is not used.
  test("the edge fill is a switch: transparent draws none, another color still the one beneath", async () => {
    const rendered = await render(nested("minimal", "", ""));
    const none = redraw(rendered, { edgeFill: "transparent" });
    const nothing = new Map([
      [0, undefined],
      [1, undefined],
    ]);
    expect(svgLabelBackgrounds(none.svg)).toEqual(nothing);
    expect(pptxLabelBackgrounds(none.svg, none.ir)).toEqual(nothing);
    const red = redraw(rendered, { edgeFill: "#ff0000" });
    const beneath = new Map([
      [0, "#f6f8fa"],
      [1, "#ffffff"],
    ]);
    expect(svgLabelBackgrounds(red.svg)).toEqual(beneath);
    expect(pptxLabelBackgrounds(red.svg, red.ir)).toEqual(beneath);
  });

  test("labelBackground() paints the groups under the center over the canvas", () => {
    const rect = (x: number, y: number, width: number, height: number) => ({
      x,
      y,
      width,
      height,
    });
    const outer = { rect: rect(0, 0, 100, 100), fill: "#336699", opacity: 1 };
    const inner = { rect: rect(10, 10, 40, 40), fill: "transparent", opacity: 1 };
    const label = rect(20, 20, 10, 4);
    expect(labelBackground(label, [])).toBe(CANVAS_FILL);
    expect(labelBackground(label, [outer, inner])).toBe("#336699");
    expect(labelBackground(label, [outer, { ...inner, fill: "#eee" }])).toBe("#eee");
    expect(labelBackground(label, [{ ...outer, fill: "transparent" }, inner])).toBe(CANVAS_FILL);
    // Translucent groups are blended over what is beneath; invisible ones skipped.
    expect(labelBackground(label, [{ ...outer, fill: "#000000", opacity: 0.5 }])).toBe("#808080");
    expect(labelBackground(label, [outer, { ...inner, fill: "#ffffff", opacity: 0 }])).toBe(
      "#336699",
    );
    // Across the inner group's border: the center decides.
    expect(labelBackground(rect(46, 20, 10, 4), [outer, { ...inner, fill: "#eee" }])).toBe(
      "#336699",
    );
    expect(labelBackground(rect(41, 20, 10, 4), [outer, { ...inner, fill: "#eee" }])).toBe("#eee");
    // Outside every group: the canvas.
    expect(labelBackground(rect(200, 200, 10, 4), [outer])).toBe(CANVAS_FILL);
    // Exactly on the border: inside.
    expect(labelBackground(rect(45, 20, 10, 4), [outer, { ...inner, fill: "#eee" }])).toBe("#eee");
    // Overlapping siblings: the one painted later is on top, whatever the order.
    const red = { rect: rect(0, 0, 30, 30), fill: "#ff0000", opacity: 1 };
    const blue = { rect: rect(15, 15, 30, 30), fill: "#0000ff", opacity: 1 };
    expect(labelBackground(label, [red, blue])).toBe("#0000ff");
    expect(labelBackground(label, [blue, red])).toBe("#ff0000");
    // Several translucent layers, each over the result beneath it (rounded per layer):
    // black at 0.5 over white is #808080, red at 0.5 over that is #c04040.
    const black = { rect: rect(0, 0, 100, 100), fill: "#000000", opacity: 0.5 };
    expect(labelBackground(label, [black, { ...red, opacity: 0.5 }])).toBe("#c04040");
    expect(labelBackground(label, [{ ...red, opacity: 0.5 }, black])).toBe("#804040");
    // A translucent layer over an opaque one, with a `#rgb` fill.
    expect(labelBackground(label, [outer, { ...inner, fill: "#fff", opacity: 0.5 }])).toBe(
      "#99b3cc",
    );
  });
});

/** The interior fill of each edge's arrowheads in the SVG, by edge index. */
function svgHeadFills(svg: string): Map<number, string[]> {
  const out = new Map<number, string[]>();
  for (const [, index = "", body = ""] of svg.matchAll(
    /<g class="sumi-k-e--_(\d+) sumi-kind-edge"[^>]*>(.*?)<\/g>/g,
  )) {
    out.set(
      Number(index),
      [...body.matchAll(/<(?:polygon|circle) [^>]*fill="([^"]*)"/g)].map(([, fill = ""]) => fill),
    );
  }
  return out;
}

// #192 (design doc §6.41): a hollow arrowhead is painted inside with the
// color beneath its center, as an edge label's background is (#170).
describe("hollow arrowheads (#192)", () => {
  // As in the #170 tests: a -> b inside `inner` (in `outer`), and
  // top -> outer, whose head lies outside `outer`, on the canvas.
  const nested = (theme: string, outer: string, inner: string) => `version: 1
figure:
  id: hollow-heads
  theme: ${theme}
  layout:
    arrange:
      row: { gap: 6mm, items: [top, outer] }
groups:
  - id: outer
${outer}
    arrange: { stack: { items: [inner] } }
  - id: inner
${inner}
    arrange: { stack: { gap: 6mm, items: [a, b] } }
nodes:
  - { id: top, component: box, label: Top }
  - { id: a, component: box, label: A }
  - { id: b, component: box, label: B }
edges:
  - { from: a, to: b }
  - { from: top, to: outer }
`;
  const HOLLOW = ["triangle", "arrow", "diamond", "circle", "box"] as const;

  /** The head fills of edges 0 and 1, checked to be the same for every hollow head type. */
  async function hollowFills(source: string) {
    const rendered = await render(source);
    const fills = HOLLOW.map((head) => {
      const { svg } = redraw(rendered, { filled: false, targetArrowhead: head });
      const all = svgHeadFills(svg);
      expect(all.get(0)).toHaveLength(1);
      expect(all.get(1)).toHaveLength(1);
      return [all.get(0)?.[0], all.get(1)?.[0]];
    });
    for (const f of fills) expect(f).toEqual(fills[0] as (string | undefined)[]);
    return { rendered, fills: fills[0] as (string | undefined)[] };
  }

  test("a filled group (minimal: surface), and the canvas outside it", async () => {
    const { rendered, fills } = await hollowFills(nested("minimal", "", ""));
    expect(groupFill(rendered, "inner")).toBe("#f6f8fa");
    expect(fills).toEqual(["#f6f8fa", CANVAS_FILL]);
  });

  test("a toned group", async () => {
    const { rendered, fills } = await hollowFills(nested("minimal", "", "    tone: yellow"));
    const fill = groupFill(rendered, "inner");
    expect(fill).not.toBe("#f6f8fa");
    expect(fills[0]).toBe(fill);
  });

  test("a transparent inner group inside a colored outer one", async () => {
    const { rendered, fills } = await hollowFills(nested("academic", "    tone: blue", ""));
    expect(groupFill(rendered, "inner")).toBe("transparent");
    const outer = groupFill(rendered, "outer");
    expect(outer).not.toBe("transparent");
    expect(fills).toEqual([outer, CANVAS_FILL]);
  });

  test("transparent groups only, as academic draws them by default: the canvas", async () => {
    const { fills } = await hollowFills(nested("academic", "", ""));
    expect(fills).toEqual([CANVAS_FILL, CANVAS_FILL]);
  });

  test("filled arrowheads keep the line color", async () => {
    const rendered = await render(nested("minimal", "", ""));
    const stroke = rendered.compiled.ir.edges[0]?.style.stroke;
    for (const head of HOLLOW) {
      const { svg } = redraw(rendered, { filled: true, targetArrowhead: head });
      expect(svgHeadFills(svg).get(0)).toEqual([stroke as string]);
    }
  });

  // A head across a group border takes the color under its center, half its
  // length behind the tip; a center exactly on the border is inside.
  test("a head across a group border takes the color under its center", async () => {
    const rendered = await render(nested("minimal", "", ""));
    const points = rendered.layout.edges[0]?.route?.points;
    const edge = rendered.compiled.ir.edges[0];
    if (points === undefined || edge === undefined) throw new Error("no route");
    const tip = points[points.length - 1] as Point;
    const prev = points[points.length - 2] as Point;
    // a -> b runs down: the head's center is above the tip.
    expect(prev.x).toBe(tip.x);
    expect(prev.y).toBeLessThan(tip.y);
    const cy = tip.y - arrowheadLength(edge.style.strokeWidth.units) / 2;
    // The inner group's top border moved to run through the head's center.
    const at = (y: number): LayoutIR => ({
      ...rendered.layout,
      groups: rendered.layout.groups.map((g) =>
        g.key === "g:inner"
          ? { ...g, rect: { ...g.rect, y, height: g.rect.height + g.rect.y - y } }
          : g,
      ),
    });
    const groupFill = { inner: "#ffee00", outer: "transparent" };
    for (const head of HOLLOW) {
      const changes = { groupFill, filled: false, targetArrowhead: head };
      const on = redraw(rendered, { ...changes, layout: at(cy) });
      expect(svgHeadFills(on.svg).get(0)).toEqual(["#ffee00"]);
      const below = redraw(rendered, { ...changes, layout: at(cy + 0.001) });
      expect(svgHeadFills(below.svg).get(0)).toEqual([CANVAS_FILL]);
    }
  });

  // DrawingML line ends have no interior: a hollow `arrow` is an open arrow,
  // the other hollow heads are refused (editable-geometry.test.ts).
  test("a hollow arrow head stays an open arrow line end in the editable PPTX", async () => {
    const rendered = await render(nested("minimal", "", ""));
    const { svg, ir } = redraw(rendered, { filled: false, targetArrowhead: "arrow" });
    const editable = svgToEditablePptx(svg, ir);
    if (!editable.ok) throw new Error(JSON.stringify(editable.diagnostics));
    const slide = new TextDecoder().decode(readPptx(editable.value).get("ppt/slides/slide1.xml"));
    expect([...slide.matchAll(/<a:tailEnd type="([a-z]+)"/g)].map(([, t]) => t)).toEqual([
      "arrow",
      "arrow",
    ]);
  });

  test("backgroundAt() is labelBackground() at a point", () => {
    const outer = { rect: { x: 0, y: 0, width: 100, height: 100 }, fill: "#336699", opacity: 1 };
    const inner = { rect: { x: 10, y: 10, width: 40, height: 40 }, fill: "#eee", opacity: 1 };
    expect(backgroundAt({ x: 20, y: 20 }, [])).toBe(CANVAS_FILL);
    expect(backgroundAt({ x: 20, y: 20 }, [outer, inner])).toBe("#eee");
    expect(backgroundAt({ x: 50, y: 20 }, [outer, inner])).toBe("#eee");
    expect(backgroundAt({ x: 50.001, y: 20 }, [outer, inner])).toBe("#336699");
    expect(backgroundAt({ x: 200, y: 20 }, [outer, inner])).toBe(CANVAS_FILL);
    expect(backgroundAt({ x: 25, y: 22 }, [outer, inner])).toBe(
      labelBackground({ x: 20, y: 20, width: 10, height: 4 }, [outer, inner]),
    );
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
    // A hollow head is painted with the color beneath its center (#192):
    // half arrowheadLength() behind the tip.
    const hollow = { ...edge, style: { ...edge.style, filled: false } } as unknown as EdgeIR;
    const half = arrowheadLength(2) / 2;
    const fill = (groups: Parameters<typeof drawArrowhead>[4]) =>
      /fill="([^"]*)"/.exec(drawArrowhead("triangle", tip, { x: 0, y: 1 }, hollow, groups))?.[1];
    // A group whose bottom border runs through the center, or just above it.
    const group = (bottom: number) => ({
      rect: { x: 0, y: bottom - 100, width: 200, height: 100 },
      fill: "#123456",
      opacity: 1,
    });
    expect(fill([group(tip.y - half)])).toBe("#123456");
    expect(fill([group(tip.y - half - 0.001)])).toBe(CANVAS_FILL);
    expect(fill(undefined)).toBe(CANVAS_FILL);
  });
});

describe("font subsets (large)", () => {
  test("too many BMP segments for format 4 write a valid format-12-only cmap", () => {
    const original = parseGlyphCoverage(new Uint8Array(readFileSync(fonts.regular)));
    let text = "";
    for (let cp = 0x20; cp < 0xfffe; cp++) {
      if ((cp < 0xd800 || cp > 0xdfff) && original.has(cp)) text += String.fromCodePoint(cp);
    }
    const bytes = subsetFont(fonts.regular, text);
    const cmap = readTables(bytes).require("cmap");
    expect(cmap.u16(2)).toBe(1); // one encoding record
    expect([cmap.u16(4), cmap.u16(6), cmap.u16(cmap.u32(8))]).toEqual([3, 10, 12]);
    expect(cmap.u32(cmap.u32(8) + 4)).toBe(cmap.length - cmap.u32(8));
    const coverage = parseGlyphCoverage(bytes);
    for (const char of text) expect(coverage.has(char.codePointAt(0) ?? 0)).toBe(true);
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
