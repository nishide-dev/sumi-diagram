/**
 * Legend samples (#409) drawn end to end: icon, glyph, edge and set swatches
 * in rows and groups, under every theme, in SVG, PDF and both PPTX modes.
 */

import { describe, expect, test } from "bun:test";
import { BUILTIN_THEMES } from "../core/theme/builtin";
import { getFontSet } from "../core/theme/fonts";
import { lintGeometry } from "../lint";
import { measureLabel } from "../lint/geometry/measure";
import type { Rect } from "./geometry";
import { svgToPdf } from "./pdf";
import { svgToEditablePptx, svgToPptx } from "./pptx";
import { renderFigure } from "./render";

const source = (theme: string, icons = true) => `version: 1
figure:
  id: legend-samples
  theme: ${theme}
  profile: paper-double
  layout:
    arrange:
      stack:
        gap: 5mm
        align: start
        items:
          - row: { gap: 20mm, align: center, items: [paper, title, flask] }
          - key
nodes:
  - { id: paper, component: ${icons ? "label" : "box"}, ${icons ? "icon: tabler/file-text" : "label: Paper"}, glyphs: [{ kind: vector, tone: blue, strength: solid, dx: 0.3, dy: -0.25 }] }
  - { id: title, component: ${icons ? "label" : "box"}, ${icons ? "icon: tabler/letter-t" : "label: Title"} }
  - { id: flask, component: ${icons ? "label" : "box"}, ${icons ? "icon: tabler/flask" : "label: Flask"}, glyphs: [{ kind: dot, tone: red }] }
  - id: key
    component: legend
    variant: plain
    props:
      flow: row
      perRow: 2
      entries:
${
  icons
    ? `        - { heading: "Entity:", icon: tabler/file-text, labelAt: left, label: Paper }
        - { icon: tabler/letter-t, labelAt: left, label: Title }
        - { icon: tabler/flask, labelAt: left, label: Flask }`
    : `        - { heading: "Entity:", node: {}, labelAt: left, label: Paper }`
}
        - { heading: "Feature:", glyph: { kind: vector, tone: blue, strength: solid }, labelAt: left, label: Initial }
        - { glyph: { kind: dot, tone: red }, labelAt: left, label: Dot }
        - { heading: "Pairs:", edge: { component: double-arrow, tone: blue }, label: Positive }
        - { edge: { component: double-arrow, variant: dashed, tone: red }, label: Negative }
        - { set: { tone: green }, label: Hyperedge }
edges:
  - { from: paper, to: title, component: double-arrow, tone: blue }
  - { from: title, to: flask, component: double-arrow, variant: dashed, tone: red }
sets:
  - { id: group, members: [paper, title], shape: ellipse, tone: green, padding: 3mm }
`;

test("solid node, glyph cells and legend sample share solid fill overrides", async () => {
  const result = await renderFigure(`version: 1
figure: { id: parity, theme: paper, themeOverrides: { tones: { yellow: { line: '#876200' } }, solidFills: { yellow: '#112233' } }, layout: { arrange: { stack: { items: [a, key] } } } }
nodes:
  - { id: a, component: box, variant: solid, tone: yellow, label: A, glyphs: [{ kind: vector, tones: [yellow, yellow], strength: solid }] }
  - id: key
    component: legend
    props:
      entries:
        - { glyph: { kind: dot, tone: yellow, strength: solid }, label: Sample }
`);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const nodes = result.value.compiled.ir.nodes;
  const node = nodes.find((n) => n.key === "n:a");
  expect(node?.style.fill).toBe("#112233");
  const parts = nodes.flatMap((n) => n.glyphs?.flatMap((g) => g.parts) ?? []);
  expect(parts).toHaveLength(3);
  expect(parts.map((p) => p.fill)).toEqual(["#112233", "#112233", "#112233"]);
  expect(result.value.svg.match(/fill="#112233"/g)?.length).toBeGreaterThanOrEqual(4);
});

describe("every theme", () => {
  for (const theme of BUILTIN_THEMES.keys()) {
    test(`${theme}: renders with no finding, every part inside the frame`, async () => {
      const text = source(theme);
      const result = await renderFigure(text);
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
      expect(result.diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
      expect(
        lintGeometry(result.value, { source: text }).filter((d) => d.severity !== "info"),
      ).toEqual([]);
      const { elements, sets } = result.value.inspection;
      const frame = elements.find((e) => e.key === "g:key")?.bbox;
      if (frame === undefined) throw new Error("no frame");
      const parts = [...result.value.compiled.ir.elements.values()].filter(
        (e) => e.legend?.id === "key" && e.key !== "g:key" && e.kind === "node",
      );
      expect(parts.length).toBeGreaterThan(8);
      const fonts = getFontSet(result.value.compiled.ir.meta.fontSetId);
      if (fonts === undefined) throw new Error("no font set");
      for (const part of parts) {
        const geometry = elements.find((e) => e.key === part.key);
        const label = geometry?.labels[0];
        // A text node has no bbox: its measured text box is what must fit.
        const box = geometry?.bbox ?? (label && (measureLabel(label, fonts).box as Rect));
        if (box === undefined) throw new Error(`no box of ${part.key}`);
        expect(box.x).toBeGreaterThanOrEqual(frame.x - 0.01);
        expect(box.y).toBeGreaterThanOrEqual(frame.y - 0.01);
        expect(box.x + box.width).toBeLessThanOrEqual(frame.x + frame.width + 0.01);
        expect(box.y + box.height).toBeLessThanOrEqual(frame.y + frame.height + 0.01);
      }
      // The swatch is the sample box exactly: no padding.
      const swatch = sets?.find((s) => s.id === "key-8-set");
      const body = elements.find((e) => e.key === "n:key-8-box")?.bbox;
      if (swatch === undefined || body === undefined) throw new Error("no swatch");
      expect(swatch.bbox.x).toBeCloseTo(body.x, 1);
      expect(swatch.bbox.y).toBeCloseTo(body.y, 1);
      expect(swatch.bbox.width).toBeCloseTo(body.width, 1);
      expect(swatch.bbox.height).toBeCloseTo(body.height, 1);
    });
  }
});

describe("headed groups", () => {
  test("entries of every group start at one x, and wrapped lines under the first entry", async () => {
    const result = await renderFigure(source("color"));
    if (!result.ok) throw new Error("render failed");
    const { elements } = result.value.inspection;
    const fonts = getFontSet(result.value.compiled.ir.meta.fontSetId);
    if (fonts === undefined) throw new Error("no font set");
    const left = (key: string) => {
      const geometry = elements.find((e) => e.key === key);
      const label = geometry?.labels[0];
      const box = geometry?.bbox ?? (label && (measureLabel(label, fonts).box as Rect));
      if (box === undefined) throw new Error(`no x of ${key}`);
      return box.x;
    };
    // Entries 1 (Entity), 2 (Paper's wrap: Title) ... : source() has groups
    // Entity (icons 1-3), Feature (4-5) and Pairs (6-8); perRow 2 wraps the first.
    const first = left("n:key-1-label");
    const wrapped = left("n:key-3-label");
    expect(wrapped).toBeCloseTo(first, 0);
    expect(left("n:key-4-label")).toBeCloseTo(first, 0);
    // The headings share the left edge, and the entries sit right of the widest.
    expect(left("n:key-1-heading")).toBeCloseTo(left("n:key-4-heading"), 0);
    expect(first).toBeGreaterThan(left("n:key-1-heading") + 20);
  });
});

describe("formats", () => {
  test("the SVG draws the glyph of a sample like that of a node, centered in its box", async () => {
    const result = await renderFigure(source("paper"));
    if (!result.ok) throw new Error("render failed");
    const { svg } = result.value;
    // Two glyph samples and two glyph nodes.
    expect(svg.match(/class="sumi-glyphs"/g)).toHaveLength(4);
    expect(svg).toContain("sumi-set-key-8-set");
    const sample = result.value.compiled.ir.elements.get("n:key-4-box");
    expect(sample).toMatchObject({ glyphs: [{ kind: "vector", at: "center", strokeWidth: 1 }] });
  });

  test("PDF and picture PPTX are written", async () => {
    const result = await renderFigure(source("color"));
    if (!result.ok) throw new Error("render failed");
    expect(svgToPdf(result.value.svg).ok).toBe(true);
    expect(svgToPptx(result.value.svg).ok).toBe(true);
  });

  test("editable PPTX draws glyph cells and swatches as shapes; an icon is the existing limit", async () => {
    const plain = await renderFigure(source("color", false));
    if (!plain.ok) throw new Error("render failed");
    const editable = svgToEditablePptx(plain.value.svg, plain.value.compiled.ir);
    expect(editable.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(editable.ok).toBe(true);
    const withIcons = await renderFigure(source("color"));
    if (!withIcons.ok) throw new Error("render failed");
    const refused = svgToEditablePptx(withIcons.value.svg, withIcons.value.compiled.ir);
    expect(refused.diagnostics.map((d) => d.code)).toContain("pptx/unsupported-asset");
    // The message names the legend entry, not the hidden sample node.
    const icon = refused.diagnostics.find((d) => d.message.includes("entry 1"));
    expect(icon?.message).toBe(
      'The editable PPTX cannot carry the icon of entry 1 of legend "key" yet.',
    );
    expect(icon?.path).toEqual(["nodes", 3, "props", "entries", 0, "icon"]);
    expect(icon?.subject).toEqual({ kind: "node", id: "key" });
  });
});

describe("text scale (#543)", () => {
  const legend = (overrides: string) => `version: 1
figure: { id: scaled-legend, theme: sumi, profile: paper-double, ${overrides} layout: { arrange: { stack: { items: [key] } } } }
nodes:
  - id: key
    component: legend
    props:
      entries:
        - { edge: { component: arrow, variant: dashed }, label: Negative }
        - { node: {}, label: Box }
`;
  const render = async (overrides: string) => {
    const result = await renderFigure(legend(overrides));
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    // The metadata and the scoped class name hash the source, which differs.
    return result.value.svg
      .replace(/<metadata>[\s\S]*?<\/metadata>/, "")
      .replace(/sumi-\d+/g, "sumi-x");
  };
  const sampleBox = (svg: string) => {
    const box = [
      ...svg.matchAll(
        /<rect x="(\S+)" y="\S+" width="(\S+)" height="(\S+)" fill="[^"]+" stroke="#30364f"/g,
      ),
    ][0];
    return { x: Number(box?.[1]), width: Number(box?.[2]), height: Number(box?.[3]) };
  };
  const textX = (svg: string) =>
    Math.min(...[...svg.matchAll(/<text x="(\S+)"/g)].map((m) => Number(m[1])));

  test("a scale of 1 draws the same legend as no scale", async () => {
    expect(await render("themeOverrides: { textScale: 1 },")).toBe(await render(""));
  });

  test("samples, dashes and the sample-to-text gap grow with the scale", async () => {
    const plain = await render("");
    const scaled = await render("themeOverrides: { textScale: 2 },");
    const [a, b] = [sampleBox(plain), sampleBox(scaled)];
    expect(b.width).toBe(2 * a.width);
    expect(b.height).toBe(2 * a.height);
    const gap = (svg: string) => textX(svg) - sampleBox(svg).x - sampleBox(svg).width;
    expect(gap(scaled)).toBeGreaterThanOrEqual(2 * gap(plain) - 1);
    // The dash period follows the line width, and the line still holds whole periods.
    const period = (svg: string) => {
      const [on, off] =
        svg
          .match(/stroke-dasharray="([^"]+)"/)?.[1]
          ?.split(",")
          .map(Number) ?? [];
      return (on ?? 0) + (off ?? 0);
    };
    expect(period(scaled)).toBeGreaterThan(1.9 * period(plain));
    const wire = (svg: string) => {
      const m = svg.match(/class="sumi-wire" d="M ([\d.]+) \S+ L ([\d.]+)/);
      return Number(m?.[2]) - Number(m?.[1]);
    };
    expect(wire(scaled) / period(scaled)).toBeGreaterThanOrEqual(wire(plain) / period(plain) - 0.5);
  });
});
