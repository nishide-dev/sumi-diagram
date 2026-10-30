/**
 * Dimmed groups (#175, design doc §6.53) through the renderers: DiT's panels
 * 3 and 4 written with `dim: true` on their two groups, edge-label
 * backgrounds over a dimmed fill, the editable PPTX, and auto (D2). The
 * structured tests run without D2; the auto render needs it.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createD2CliBackend } from "../backends/d2/backend";
import { checkD2Version, findD2Binary } from "../backends/d2/binary";
import { compileFigure, expectD2Figure } from "../compiler/compile";
import { generateD2 } from "../compiler/d2";
import { getTheme } from "../core/theme";
import { lightenColor } from "../core/theme/dim";
import { lintGeometry } from "../lint/geometry";
import { svgToEditablePptx } from "./pptx";
import { readPptx } from "./pptx/testing";
import { type RenderedFigure, type RenderedStructuredFigure, renderFigure } from "./render";

const ROOT = join(import.meta.dir, "..", "..");
const DIT = readFileSync(join(ROOT, "tests/fixtures/figures/dim/b-dit.sumi.yaml"), "utf8");
/** The same figure without dim: panels 3 and 4 drawn like panel 2. */
const UNDIMMED = DIT.replaceAll("    dim: true\n", "");

const binary = findD2Binary();
const available = binary.ok && (await checkD2Version(binary.value.path)).ok;

const color = getTheme("color");
const DIM = color?.dim ?? { fontColor: "", stroke: "", lighten: 0 };

async function rendering(source: string, auto = false) {
  const result = await renderFigure(source, auto ? { backend: createD2CliBackend() } : {});
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  return result;
}

async function render(source: string, auto = false): Promise<RenderedFigure> {
  return (await rendering(source, auto)).value;
}

/**
 * Each element's markup in a structured SVG, by class (`sumi-k-n--c-ln1`):
 * from its `<g class="sumi-k-…">` to the next one or to the wires (the
 * lines of all edges, drawn after the elements; see {@link wires}).
 */
function chunks(svg: string): Map<string, string> {
  const parts = svg.split('<g class="sumi-k-').slice(1);
  return new Map(
    parts.map((part) => {
      const end = part.indexOf('<path class="sumi-wire"');
      return [`sumi-k-${part.slice(0, part.indexOf(" "))}`, end < 0 ? part : part.slice(0, end)];
    }),
  );
}

/** The wires (edge lines) of a structured SVG: their path and stroke. */
const wires = (svg: string) =>
  [...svg.matchAll(/<path class="sumi-wire" d="([^"]*)"[^>]*stroke="(#[0-9a-f]+)"/g)].map(
    ([, d, stroke]) => ({ d: d ?? "", stroke: stroke ?? "" }),
  );

const colorsIn = (markup: string, attribute: "fill" | "stroke") =>
  new Set([...markup.matchAll(new RegExp(`\\b${attribute}="(#[0-9a-f]+)"`, "g"))].map((m) => m[1]));

describe("DiT with panels 3 and 4 dimmed (structured)", () => {
  test("dim changes colors only: the same layout and diagnostics as without it", async () => {
    const dimmed = (await render(DIT)) as RenderedStructuredFigure;
    const plain = (await render(UNDIMMED)) as RenderedStructuredFigure;
    const rects = (r: RenderedStructuredFigure) =>
      JSON.stringify([...r.layout.nodes, ...r.layout.groups].map((e) => [e.key, e.rect]));
    expect(rects(dimmed)).toBe(rects(plain));
    expect(JSON.stringify(dimmed.layout.edges.map((e) => e.route))).toBe(
      JSON.stringify(plain.layout.edges.map((e) => e.route)),
    );
    // The research copy is too wide and has a sparse panel (#248).
    const codes = async (source: string) => {
      const result = await rendering(source);
      return [...result.diagnostics, ...lintGeometry(result.value, { source })].map((d) => d.code);
    };
    expect(await codes(DIT)).toEqual(["geometry/exceeds-page-width", "geometry/group-empty-area"]);
    expect(await codes(DIT)).toEqual(await codes(UNDIMMED));
  });

  test("panels 3 and 4 draw gray text and lines, pale fills and a gray frame; panel 2 does not", async () => {
    const { svg } = await render(DIT);
    const plainSvg = (await render(UNDIMMED)).svg;
    const elements = chunks(svg);
    const plainElements = chunks(plainSvg);
    const dimmedIds = [...elements.keys()].filter((k) =>
      /^sumi-k-(n--[ci]-|g--(cross|incontext)$|n--(cross|incontext)-caption$)/.test(k),
    );
    // 2 groups, 2 captions, 15 + 12 nodes.
    expect(dimmedIds.length).toBe(2 + 2 + 27);
    for (const id of dimmedIds) {
      const markup = elements.get(id) ?? "";
      const before = plainElements.get(id) ?? "";
      // Text and strokes in the dim gray only.
      for (const stroke of colorsIn(markup, "stroke"))
        expect([id, stroke]).toEqual([id, DIM.stroke]);
      const texts = [...markup.matchAll(/<text [^>]*fill="(#[0-9a-f]+)"/g)].map((m) => m[1]);
      for (const text of texts) expect([id, text]).toEqual([id, DIM.fontColor]);
      // Shape fills: the undimmed fills moved toward white.
      const shapeFills = (m: string) =>
        [...m.matchAll(/<(?:rect|circle|path) [^>]*fill="(#[0-9a-f]+)"/g)].map((x) => x[1] ?? "");
      expect([id, shapeFills(markup)]).toEqual([
        id,
        shapeFills(before).map((fill) =>
          fill === DIM.stroke ? fill : lightenColor(fill, DIM.lighten),
        ),
      ]);
    }
    // Panel 2 and the left panel are unchanged.
    for (const [id, markup] of elements) {
      if (dimmedIds.includes(id) || id.startsWith("sumi-k-e-")) continue;
      expect([id, markup]).toEqual([id, plainElements.get(id) ?? ""]);
    }
    // Wires: right of panel 3's left border gray, the others as before.
    const rendered = (await render(DIT)) as RenderedStructuredFigure;
    const left = rendered.layout.groups.find((g) => g.key === "g:cross")?.rect.x ?? Number.NaN;
    const before = wires(plainSvg);
    const after = wires(svg);
    expect(after.map((w) => w.d)).toEqual(before.map((w) => w.d));
    let gray = 0;
    for (const [i, wire] of after.entries()) {
      const xs = [...wire.d.matchAll(/[ML] ([\d.]+) /g)].map((m) => Number(m[1]));
      const inside = xs.every((x) => x > left);
      if (inside) gray += 1;
      expect([wire.d, wire.stroke]).toEqual([
        wire.d,
        inside ? DIM.stroke : (before[i]?.stroke ?? ""),
      ]);
    }
    expect(gray).toBeGreaterThanOrEqual(20);
    // Edges (arrowheads): only those of panels 3 and 4 change, to gray.
    const edges = [...elements].filter(([id]) => id.startsWith("sumi-k-e-"));
    const changed = edges.filter(([id, m]) => m !== plainElements.get(id));
    for (const [id, markup] of changed) {
      for (const c of [...colorsIn(markup, "stroke"), ...colorsIn(markup, "fill")]) {
        expect([id, c]).toEqual([id, DIM.stroke]);
      }
    }
    // The arrowheads of the 5 + 4 arrows of panels 3 and 4 (the others are lines).
    expect(changed.length).toBe(9);
  });

  test("the editable PPTX writes the dim colors", async () => {
    const rendered = await render(DIT);
    const editable = svgToEditablePptx(rendered.svg, rendered.compiled.ir);
    if (!editable.ok) throw new Error(JSON.stringify(editable.diagnostics));
    const xml = new TextDecoder().decode(readPptx(editable.value).get("ppt/slides/slide1.xml"));
    expect(xml).toContain(`<a:srgbClr val="${DIM.stroke.slice(1).toUpperCase()}">`);
    const paleBlue = lightenColor("#cfe8f3", DIM.lighten).slice(1).toUpperCase();
    expect(xml).toContain(`<a:srgbClr val="${paleBlue}">`);
  });
});

describe("edge-label backgrounds over a dimmed group (structured, §6.41)", () => {
  test("the background is the group's dimmed fill", async () => {
    const source = (dim: string) => `version: 1
figure:
  id: f
  theme: minimal
  layout:
    arrange: { row: { items: [g] } }
groups:
  - id: g
${dim}    arrange: { stack: { gap: 12mm, items: [a, b] } }
nodes:
  - { id: a, component: box, label: A }
  - { id: b, component: box, label: B }
edges:
  - { from: a, to: b, label: x }
`;
    const background = async (dim: string) => {
      const { svg } = await render(source(dim));
      const edge = [...chunks(svg)].find(([id]) => id.startsWith("sumi-k-e-"))?.[1] ?? "";
      return /<rect [^>]*fill="(#[0-9a-f]+)"/.exec(edge)?.[1];
    };
    const minimal = getTheme("minimal");
    const surface = "#f6f8fa";
    expect(await background("")).toBe(surface);
    expect(await background("    dim: true\n")).toBe(
      lightenColor(surface, minimal?.dim?.lighten ?? 0),
    );
  });
});

describe("auto (D2)", () => {
  const source = `version: 1
figure: { id: dim-auto, theme: color }
groups:
  - { id: g, label: Dimmed, caption: (b) dimmed, dim: true, tone: blue }
nodes:
  - { id: a, component: box, label: A, tone: orange, group: g }
  - { id: b, component: box, label: B, group: g }
  - { id: c, component: box, label: C }
edges:
  - { from: a, to: b, label: inside }
  - { from: b, to: c }
`;
  const styleOf = (d2: string, name: string) => {
    const start = d2.indexOf(`"${name}": {`);
    const style = d2.slice(
      d2.indexOf("style: {", start),
      d2.indexOf("}", d2.indexOf("style: {", start)),
    );
    return Object.fromEntries(
      [...style.matchAll(/^\s*([a-z-]+): (.+)$/gm)].map(([, k, v]) => [k, v?.replaceAll('"', "")]),
    );
  };

  test("D2 styles carry the dim colors (per element, as for any style)", () => {
    const result = compileFigure(source);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.diagnostics).toEqual([]);
    const d2 = generateD2(expectD2Figure(result.value).ir);
    const tone = (name: string) => color?.tones.get(name as "blue")?.fill ?? "";
    expect(styleOf(d2, "g_g")).toMatchObject({
      stroke: DIM.stroke,
      "font-color": DIM.fontColor,
      fill: lightenColor(tone("blue"), DIM.lighten),
    });
    expect(styleOf(d2, "n_a")).toMatchObject({
      stroke: DIM.stroke,
      "font-color": DIM.fontColor,
      fill: lightenColor(tone("orange"), DIM.lighten),
    });
    expect(styleOf(d2, "n_g-caption")).toMatchObject({ "font-color": DIM.fontColor });
    expect(styleOf(d2, "n_c")).toMatchObject({ stroke: "#1f2328", "font-color": "#1f2328" });
    expect(d2).toContain(`stroke: "${DIM.stroke}"`);
  });

  test.skipIf(!available)("renders through D2 in the dim colors", async () => {
    const { value: rendered, diagnostics } = await rendering(source, true);
    expect(diagnostics).toEqual([]);
    const paleOrange = lightenColor(color?.tones.get("orange")?.fill ?? "", DIM.lighten);
    expect(rendered.svg).toContain(`stroke="${DIM.stroke}" fill="${paleOrange}"`);
    expect(rendered.svg).toMatch(
      new RegExp(`<text [^>]*fill="${DIM.fontColor}"[^>]*>\\(b\\) dimmed<`),
    );
  });
});
