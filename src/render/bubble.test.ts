import { expect, test } from "bun:test";
import { compileFigure } from "../compiler/compile";
import { getOutlineRenderer } from "../core/outline";
import { BUILTIN_THEMES } from "../core/theme/builtin";
import { getFontSet } from "../core/theme/fonts";
import { nodeBoundaryEntry } from "../layout/route/ports";
import { lintGeometry } from "../lint";
import { measureLabel } from "../lint/geometry/measure";
import { inspection, label } from "../lint/geometry/testing";
import { svgToPdf } from "./pdf";
import { inspectPdf, parsePdf, textLines } from "./pdf/testing";
import { svgToEditablePptx, svgToPptx } from "./pptx";
import { readPptx } from "./pptx/testing";
import { renderFigure } from "./render";
import { attribute, descendants, parseXml } from "./xml";

const sides = ["none", "left", "right", "top", "bottom"] as const;
const japanese = "こんにちは。日本語の文章は吹き出しの中で折り返します。";
const source = (engine: "auto" | "structured", theme = "paper") => `version: 1
figure:
  id: bubbles
  theme: ${theme}
  profile: paper-double
  layout:
    ${engine === "structured" ? "arrange: { stack: { items: [none, left, right, top, bottom] } }" : "direction: down"}
nodes:
${sides.map((tail) => `  - { id: ${tail}, component: bubble, label: "${japanese}", props: { tail: ${tail}, maxWidth: 80pt } }`).join("\n")}
${engine === "auto" ? "edges: [{ from: none, to: left }, { from: left, to: right }, { from: right, to: top }, { from: top, to: bottom }]" : ""}
`;

for (const engine of ["auto", "structured"] as const) {
  test(`${engine}: every tail reserves space, wraps CJK and exports the same closed contour`, async () => {
    const rendered = await renderFigure(source(engine));
    if (!rendered.ok) throw new Error(JSON.stringify(rendered.diagnostics));
    const r = rendered.value;
    expect(
      [...rendered.diagnostics, ...lintGeometry(r)].filter((d) => d.severity !== "info"),
    ).toEqual([]);
    const fonts = getFontSet(r.compiled.ir.meta.fontSetId);
    if (!fonts) throw new Error("missing fonts");
    for (const n of r.compiled.ir.nodes) {
      expect(n.label.replaceAll("\n", "")).toBe(japanese);
      expect(n.label.split("\n").length).toBeGreaterThan(1);
      expect(n.label.split("\n").some((line) => /^[。、）]/u.test(line))).toBe(false);
      const geometry = r.inspection.elements.find((e) => e.key === n.key);
      if (!geometry?.bbox || !n.render) throw new Error("missing bubble geometry");
      const renderer = getOutlineRenderer(n.render.renderer);
      if (!renderer) throw new Error("missing renderer");
      const drawing = renderer.draw(geometry.bbox, renderer.params.parse(n.render.params));
      expect(drawing.layers).toHaveLength(1);
      expect(drawing.layers[0]?.path.closed).toBe(true);
      const area = drawing.safeArea;
      for (const l of geometry.labels) {
        const measured = measureLabel(l, fonts);
        expect(l.textAlign).toBe("left");
        for (const line of measured.visibleLines) {
          expect(line.x).toBeCloseTo(measured.visibleLines[0]?.x ?? NaN, 3);
        }
        for (const line of measured.visibleLines) {
          expect(line.width).toBeLessThanOrEqual(area.width + 0.01);
          expect(line.x).toBeGreaterThanOrEqual(area.x - 0.01);
          expect(line.y).toBeGreaterThanOrEqual(area.y - 0.01);
          expect(line.y + line.height).toBeLessThanOrEqual(area.y + area.height + 0.01);
        }
      }
      if (n.id === "left") {
        const box = geometry.bbox;
        const from = { x: box.x - 10, y: box.y + box.height / 2 };
        const to = { x: box.x + box.width / 2, y: from.y };
        const entry = nodeBoundaryEntry(from, to, n, box);
        expect(entry).toBeDefined();
        const x = from.x + (to.x - from.x) * (entry ?? 0);
        expect(x).toBeGreaterThan(box.x); // body, not the tail's extreme
      }
    }
    const pdf = svgToPdf(r.svg);
    if (!pdf.ok) throw new Error(JSON.stringify(pdf.diagnostics));
    const pdfInfo = inspectPdf(pdf.value);
    expect(pdfInfo.images).toBe(0);
    expect(
      textLines(pdfInfo.glyphs)
        .map((l) => l.text)
        .join("")
        .replaceAll(" ", ""),
    ).toBe(japanese.repeat(5));
    const streams = [...parsePdf(pdf.value).objects.values()].flatMap((o) =>
      o.stream ? [new TextDecoder().decode(o.stream)] : [],
    );
    expect(streams.join("\n").match(/\sh\s/g)?.length).toBeGreaterThanOrEqual(5);
    const pdfContours = streams.flatMap((stream) =>
      [...stream.matchAll(/((?:[-\d.e]+ [-\d.e]+ [ml]\s*)+)h/g)].map((match) =>
        [...(match[1] ?? "").matchAll(/([-\d.e]+) ([-\d.e]+) [ml]/g)].map((p) => ({
          x: Number(p[1]),
          y: Number(p[2]),
        })),
      ),
    );
    for (const node of r.compiled.ir.nodes) {
      const box = r.inspection.elements.find((e) => e.key === node.key)?.bbox;
      const renderer = node.render && getOutlineRenderer(node.render.renderer);
      if (!box || !renderer) throw new Error("missing PDF contour");
      const expected = renderer.draw(box, renderer.params.parse(node.render?.params)).outline;
      expect(
        pdfContours.some(
          (points) =>
            points.length === expected.length &&
            points.every(
              (p, i) =>
                Math.hypot(p.x - (expected[i]?.x ?? Infinity), p.y - (expected[i]?.y ?? Infinity)) <
                0.003,
            ),
        ),
      ).toBe(true);
    }
    const picture = svgToPptx(r.svg);
    if (!picture.ok) throw new Error(JSON.stringify(picture.diagnostics));
    const parts = readPptx(picture.value);
    const svgPart = [...parts].find(([name]) => name.endsWith(".svg"));
    expect(svgPart).toBeDefined();
    // Picture export outlines text, but must preserve every bubble path.
    expect(new TextDecoder().decode(svgPart?.[1]).match(/<path/g)?.length).toBeGreaterThanOrEqual(
      5,
    );
    const editable = svgToEditablePptx(r.svg, r.compiled.ir);
    if (!editable.ok) throw new Error(JSON.stringify(editable.diagnostics));
    const slide = new TextDecoder().decode(readPptx(editable.value).get("ppt/slides/slide1.xml"));
    expect(slide.match(/<a:close\s*\/>/g)).toHaveLength(5);
    expect(slide.match(/<a:custGeom/g)).toHaveLength(engine === "auto" ? 9 : 5);
    const xml = parseXml(slide);
    if (!xml.ok) throw new Error(xml.message);
    for (const node of r.compiled.ir.nodes) {
      const shape = [...descendants(xml.root)].find(
        (e) =>
          e.name === "p:sp" &&
          [...descendants(e)].some(
            (c) => c.name === "p:cNvPr" && attribute(c, "name") === node.key,
          ),
      );
      if (!shape || !node.render) throw new Error("missing native shape");
      const nativePath = [...descendants(shape)].find((e) => e.name === "a:path");
      const points = nativePath
        ? [...descendants(nativePath)].filter((e) => e.name === "a:pt")
        : [];
      const box = r.inspection.elements.find((e) => e.key === node.key)?.bbox;
      const renderer = getOutlineRenderer(node.render.renderer);
      if (!box || !renderer) throw new Error("missing contour");
      const drawing = renderer.draw(box, renderer.params.parse(node.render.params));
      expect(points).toHaveLength(drawing.outline.length);
      for (const [i, point] of points.entries()) {
        const expected = drawing.outline[i];
        if (!expected) throw new Error("missing point");
        // SVG writes coordinates to 0.001 unit; DrawingML preserves them in EMU.
        expect(Math.abs(Number(attribute(point, "x")) / 6350 + box.x - expected.x)).toBeLessThan(
          0.001,
        );
        expect(Math.abs(Number(attribute(point, "y")) / 6350 + box.y - expected.y)).toBeLessThan(
          0.001,
        );
      }
      const sites = [...descendants(shape)].filter((e) => e.name === "a:pos");
      expect(sites.length).toBeGreaterThanOrEqual(drawing.portOutline?.length ?? 0);
      if (node.id === "left") {
        const leftBody = Math.min(...(drawing.portOutline ?? []).map((p) => p.x));
        for (const site of sites)
          expect(Number(attribute(site, "x")) / 6350 + box.x).toBeGreaterThanOrEqual(
            leftBody - 0.001,
          );
      }
    }
  });
}

test("all themes draw every tail without fallback", async () => {
  for (const theme of BUILTIN_THEMES.keys()) {
    const s = source("structured", theme)
      .replace("stack: { items:", "grid: { columns: 2, items:")
      .replace("top, bottom]", "top, bottom, null]");
    const result = await renderFigure(s);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
    expect(lintGeometry(result.value).filter((d) => d.severity !== "info")).toEqual([]);
  }
});

test("existing textAlign overrides the chat default in both layouts and editable PPTX", async () => {
  for (const engine of ["auto", "structured"] as const) {
    for (const align of ["left", "center", "right"] as const) {
      const r = await renderFigure(`version: 1
figure:
  id: bubble-align
  layout: ${engine === "structured" ? "{ arrange: { row: { items: [a] } } }" : "{ direction: down }"}
nodes:
  - { id: a, component: bubble, label: "Long first line\\nShort", textAlign: ${align}, props: { tail: right } }
`);
      if (!r.ok) throw new Error(JSON.stringify(r.diagnostics));
      expect(lintGeometry(r.value).filter((d) => d.severity !== "info")).toEqual([]);
      const l = r.value.inspection.elements.find((e) => e.key === "n:a")?.labels[0];
      const fonts = getFontSet(r.value.compiled.ir.meta.fontSetId);
      if (!l || !fonts) throw new Error("missing label/fonts");
      expect(l.textAlign ?? "center").toBe(align);
      const lines = measureLabel(l, fonts).visibleLines;
      expect(lines).toHaveLength(2);
      const anchor = (line: (typeof lines)[number]) =>
        line.x + line.width * (align === "left" ? 0 : align === "right" ? 1 : 0.5);
      expect(anchor(lines[0] as (typeof lines)[number])).toBeCloseTo(
        anchor(lines[1] as (typeof lines)[number]),
        3,
      );
      const pptx = svgToEditablePptx(r.value.svg, r.value.compiled.ir);
      if (!pptx.ok) throw new Error(JSON.stringify(pptx.diagnostics));
      const slide = new TextDecoder().decode(readPptx(pptx.value).get("ppt/slides/slide1.xml"));
      expect(
        slide.match(
          new RegExp(`algn="${align === "left" ? "l" : align === "right" ? "r" : "ctr"}"`, "g"),
        ),
      ).toHaveLength(2);
    }
  }
});

test("tail participates in overlap, edge-through-node and label-collision lint", () => {
  const s = `version: 1
figure: { id: tail-lint }
nodes:
  - { id: bubble, component: bubble, props: { tail: left, tailSize: 10pt } }
  - { id: other, component: box }
  - { id: text, component: label, label: X }
  - { id: a, component: box }
  - { id: b, component: box }
edges: [{ from: a, to: b }]
`;
  const compiled = compileFigure(s);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  const findings = lintGeometry({
    compiled: compiled.value,
    inspection: inspection(compiled.value, {
      canvas: { x: 0, y: 0, width: 100, height: 100 },
      elements: {
        "n:bubble": { bbox: { x: 0, y: 0, width: 100, height: 80 } },
        "n:other": { bbox: { x: 1, y: 0, width: 18, height: 12 } },
        "n:text": { labels: [label("X", 11, 12)] },
        "e:#0": {
          path: [
            { x: 8, y: 0 },
            { x: 8, y: 60 },
          ],
        },
      },
    }),
  });
  const codes = findings.map((d) => d.code);
  expect(codes).toContain("geometry/node-overlap");
  expect(codes).toContain("geometry/edge-through-node");
  expect(codes).toContain("geometry/label-collision");
});

test("tail footprint reserves room even at zero gap, and contributes to page width", async () => {
  const make = (tail: string) => `version: 1
figure:
  id: bubble-footprint
  layout: { arrange: { row: { gap: 0pt, items: [a, b] } } }
nodes:
  - { id: a, component: bubble, label: Hello, props: { tail: ${tail}, tailSize: 10pt } }
  - { id: b, component: box, label: Next }
`;
  const without = await renderFigure(make("none"));
  const withTail = await renderFigure(make("left"));
  if (!without.ok || !withTail.ok) throw new Error("render failed");
  const a = withTail.value.inspection.elements.find((e) => e.key === "n:a")?.bbox;
  const b = withTail.value.inspection.elements.find((e) => e.key === "n:b")?.bbox;
  if (!a || !b) throw new Error("missing boxes");
  expect(b.x).toBeGreaterThanOrEqual(a.x + a.width);
  expect(
    withTail.value.inspection.canvas.width.pt - without.value.inspection.canvas.width.pt,
  ).toBeCloseTo(10, 5);
  const limit = without.value.inspection.canvas.width.pt + 5;
  const limited = (r: typeof withTail.value) =>
    lintGeometry({
      ...r,
      inspection: { ...r.inspection, profile: { ...r.inspection.profile, maxWidthPt: limit } },
    }).map((d) => d.code);
  expect(limited(without.value)).not.toContain("geometry/exceeds-page-width");
  expect(limited(withTail.value)).toContain("geometry/exceeds-page-width");
});

test("explicit footprint widths constrain English and Japanese wrapping", async () => {
  for (const text of ["Messages wrap inside a chat bubble.", japanese]) {
    const r = await renderFigure(`version: 1
figure: { id: fixed-bubble, layout: { arrange: { row: { items: [a] } } } }
nodes: [{ id: a, component: bubble, label: "${text}", props: { tail: left, width: 80pt } }]
`);
    if (!r.ok) throw new Error(JSON.stringify(r.diagnostics));
    expect(r.value.compiled.ir.nodes[0]?.label).toContain("\n");
    expect(lintGeometry(r.value).filter((d) => d.severity !== "info")).toEqual([]);
  }
});
