import { expect, test } from "bun:test";
import { compileFigure } from "../compiler/compile";
import { buildFigureIR } from "../compiler/ir";
import { checkFigure } from "../core/check";
import { getOutlineRenderer } from "../core/outline";
import { BUILTIN_THEMES } from "../core/theme/builtin";
import { getFontSet } from "../core/theme/fonts";
import { resolveEnds } from "../layout/route/ports";
import { lintGeometry } from "../lint";
import { geometryContextFor } from "../lint/geometry/lint";
import { measureLabel } from "../lint/geometry/measure";
import { polylinesCrossRect } from "../lint/geometry/shapes";
import { svgToPdf } from "./pdf";
import { svgToEditablePptx } from "./pptx";
import { readPptx } from "./pptx/testing";
import { renderFigure } from "./render";
import { attribute, descendants, parseXml } from "./xml";

const featureProps = [
  ["bowtie", "gap: 8"],
  ...["south", "north", "east", "west"].map((narrow) => ["trapezoid", `narrow: ${narrow}`]),
] as const;

for (const theme of BUILTIN_THEMES.keys()) {
  for (const engine of ["auto", "structured"]) {
    test(`${theme}/${engine}: separated bodies and oriented trapezoids inspect, lint and export`, async () => {
      const source = `version: 1
figure: { id: features, theme: ${theme}, profile: ${theme === "slides" ? "presentation-16x9" : "paper-double"}, layout: ${engine === "auto" ? "{ direction: right }" : "{ arrange: { row: { items: [a, b] } } }"} }
nodes:
  - { id: a, component: bowtie, variant: filled, label: LoRA, props: { gap: 8 }, badge: { icon: emoji/fire, corner: north-east } }
  - { id: b, component: trapezoid, label: Up, props: { narrow: west } }
edges: [{ from: a, to: b }]
`;
      const result = await renderFigure(source);
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
      expect(result.diagnostics).toEqual([]);
      expect(lintGeometry(result.value)).toEqual([]);
      const geometry = geometryContextFor(result.value).get("n:a");
      if (!geometry?.bbox || !geometry.labelBoundaries) throw new Error("missing boundaries");
      for (const line of geometry.labels.flatMap((label) => label.visibleLines)) {
        expect(line.x + line.width / 2).toBeCloseTo(geometry.bbox.x + geometry.bbox.width / 2, 2);
      }
      const a = result.value.inspection.elements.find((e) => e.key === "n:a");
      expect(a?.labels.map((l) => l.text)).toEqual(["LoRA"]);
      expect(result.value.svg).toContain('class="sumi-badge"');
      expect(svgToPdf(result.value.svg).ok).toBe(true);
      // Badges remain picture-only (#188); exercise editable native geometry
      // with the same two bodies and shared label, without the colour asset.
      const editable = await renderFigure(
        source.replace(", badge: { icon: emoji/fire, corner: north-east }", ""),
      );
      if (!editable.ok) throw new Error(JSON.stringify(editable.diagnostics));
      for (const connectors of ["freeform", "glued"] as const) {
        const pptx = svgToEditablePptx(editable.value.svg, editable.value.compiled.ir, {
          connectors,
        });
        if (!pptx.ok) throw new Error(JSON.stringify(pptx.diagnostics));
        const slide = new TextDecoder().decode(readPptx(pptx.value).get("ppt/slides/slide1.xml"));
        expect(slide.match(/<a:t\b[^>]*>LoRA<\/a:t>/g)).toHaveLength(1);
        const paths = [...slide.matchAll(/<a:pathLst>(.*?)<\/a:pathLst>/g)];
        expect(paths.some((match) => (match[1]?.match(/<a:path\b/g) ?? []).length === 2)).toBe(
          true,
        );
        expect(slide).not.toContain("<a:blip");
      }
    });
  }
}

const splitLabels = [
  { label: "LoRA\nUnequal length\nX", size: "" },
  { label: "Long Latin label for a split bowtie", size: "" },
  { label: "分離された図形の長い日本語ラベル", size: "" },
  { label: "Width only\nX", size: ", width: 400pt" },
  { label: "高さのみ\n短", size: ", height: 100pt" },
];

// Independent contract: filled alone is borderless in every built-in theme.
const variantCrossings = [
  ["default", 1],
  ["muted", 1],
  ["emphasis", 1],
  ["filled", 0],
  ["tinted", 1],
  ["solid", 1],
  ["outlined", 1],
] as const;

for (const theme of BUILTIN_THEMES.keys()) {
  for (const engine of ["auto", "structured"]) {
    for (const [variant, crossings] of variantCrossings) {
      test(`${theme}/${engine}/${variant}: only stroked split outlines reject centered body overlays`, async () => {
        const source = `version: 1
figure: { id: crossing, theme: ${theme}, profile: ${theme === "slides" ? "presentation-16x9" : "paper-double"}, layout: ${engine === "auto" ? "{ direction: right }" : "{ arrange: { row: { items: [a] } } }"} }
nodes:
  - { id: a, component: bowtie, variant: ${variant}, label: LoRA, props: { gap: 8 } }
`;
        const result = await renderFigure(source);
        if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
        // Deliberately center the inspection label and use the full-width label
        // area for every variant, including solid's normally left-placed text.
        // This isolates painted-outline crossings from safe-area overflow.
        const input = {
          ...result.value,
          compiled: {
            ...result.value.compiled,
            ir: {
              ...result.value.compiled.ir,
              nodes: result.value.compiled.ir.nodes.map((node) => {
                if (!node.render) throw new Error("missing outline renderer");
                return {
                  ...node,
                  render: {
                    ...node.render,
                    params: { ...node.render.params, labelOnLeft: false },
                  },
                };
              }),
            },
          },
          inspection: {
            ...result.value.inspection,
            elements: result.value.inspection.elements.map((element) => ({
              ...element,
              labels: element.labels.map((label) => ({
                ...label,
                anchor: {
                  ...label.anchor,
                  x: element.bbox ? element.bbox.x + element.bbox.width / 2 : label.anchor.x,
                },
              })),
            })),
          },
        };
        const geometry = geometryContextFor(input).get("n:a");
        const line = geometry?.labels[0]?.visibleLines[0];
        if (!geometry?.labelBoundaries || !line) throw new Error("missing geometry");
        expect(polylinesCrossRect(geometry.labelBoundaries, line, 0)).toBe(true);
        expect(
          lintGeometry(input).filter((d) => d.code === "geometry/label-overflow"),
        ).toHaveLength(crossings);
      });

      test(`${theme}/${engine}/${variant}: split labels stay readable on paint or centered on the page`, async () => {
        for (const label of ["S", "Long split label\n日本語"]) {
          const result = await renderFigure(`version: 1
figure: { id: visible, theme: ${theme}, profile: ${theme === "slides" ? "presentation-16x9" : "paper-double"}, layout: ${engine === "auto" ? "{ direction: right }" : "{ arrange: { row: { items: [a] } } }"} }
nodes:
  - { id: a, component: bowtie, variant: ${variant}, label: ${JSON.stringify(label)}, props: { gap: 64 } }
`);
          if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
          const geometry = geometryContextFor(result.value).get("n:a");
          if (!geometry?.bbox || !geometry.labelBoundaries) throw new Error("missing geometry");
          expect(geometry.labels).toHaveLength(1);
          for (const line of geometry.labels.flatMap((l) => l.visibleLines)) {
            const { x, y, width, height } = geometry.bbox;
            if (variant === "solid") {
              // Independent geometric oracle: at every y in the middle half,
              // the painted left trapezoid contains this rectangular region.
              const lip = x + (width - Math.min(64, width / 2)) / 2;
              expect(line.x).toBeGreaterThan(x);
              expect(line.x + line.width).toBeLessThan(lip);
              expect(line.y).toBeGreaterThan(y + height / 4);
              expect(line.y + line.height).toBeLessThan(y + (3 * height) / 4);
              expect(polylinesCrossRect(geometry.labelBoundaries, line, 0)).toBe(false);
            } else {
              expect(line.x + line.width / 2).toBeCloseTo(x + width / 2, 2);
            }
          }
          if (variant === "solid") expect(lintGeometry(result.value)).toEqual([]);
        }
      });
    }
  }
}

test("split label placement follows resolved ink and opacity, independent of variant name", () => {
  for (const variant of ["default", "solid"]) {
    for (const [fontColor, opacity, onLeft] of [
      ["#fff", 1, true],
      ["#ffffff", 1, true],
      ["#777777", 1, true], // 4.48:1 on white
      ["#767676", 1, false], // 4.54:1 on white
      ["#000", 1, false],
      ["#000000", 0.1, true],
    ] as const) {
      const checked = checkFigure(`version: 1
figure: { id: resolved }
nodes: [{ id: a, component: bowtie, variant: ${variant}, label: S, props: { gap: 64 } }]
`);
      const style = checked.state.styles?.get("n:a");
      if (style?.kind !== "node") throw new Error("missing resolved style");
      checked.state.styles?.set("n:a", { ...style, fontColor, opacity });
      const node = buildFigureIR(checked).nodes[0];
      expect(node?.render?.params?.labelOnLeft === true).toBe(onLeft);
    }
  }
});

for (const theme of BUILTIN_THEMES.keys()) {
  for (const engine of ["auto", "structured"]) {
    for (const { label, size } of splitLabels) {
      test(`${theme}/${engine}: split label ${JSON.stringify(label)}${size} stays clear and exports at the SVG position`, async () => {
        const result = await renderFigure(`version: 1
figure: { id: labels, theme: ${theme}, profile: ${theme === "slides" ? "presentation-16x9" : "paper-double"}, layout: ${engine === "auto" ? "{ direction: right }" : "{ arrange: { row: { items: [a] } } }"} }
nodes:
  - { id: a, component: bowtie, variant: filled, label: ${JSON.stringify(label)}, props: { gap: 8${size} } }
`);
        if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
        expect(result.diagnostics).toEqual([]);
        expect(lintGeometry(result.value)).toEqual([]);
        const geometry = geometryContextFor(result.value).get("n:a");
        if (!geometry?.bbox || !geometry.labelBoundaries) throw new Error("missing boundaries");
        const lines = geometry.labels.flatMap((l) => l.visibleLines);
        expect(lines).toHaveLength(label.split("\n").length);
        for (const line of lines) {
          expect(line.x + line.width / 2).toBeCloseTo(geometry.bbox.x + geometry.bbox.width / 2, 2);
        }
        const svgLabel = result.value.inspection.elements.find((e) => e.key === "n:a")?.labels[0];
        const fonts = getFontSet(result.value.compiled.ir.meta.fontSetId);
        if (!svgLabel || !fonts) throw new Error("missing label or fonts");
        expect(svgLabel.text).toBe(label);
        const firstLine = measureLabel(svgLabel, fonts).lines[0];
        if (!firstLine) throw new Error("missing first line");
        const { viewBox, width, height } = result.value.inspection.canvas;
        // PPTX centres canvases smaller than its one-inch minimum slide size.
        const dx = Math.floor(Math.max(0, 914400 - Math.round(width.pt * 12700)) / 2);
        const dy = Math.floor(Math.max(0, 914400 - Math.round(height.pt * 12700)) / 2);
        for (const connectors of ["freeform", "glued"] as const) {
          const pptx = svgToEditablePptx(result.value.svg, result.value.compiled.ir, {
            connectors,
          });
          if (!pptx.ok) throw new Error(JSON.stringify(pptx.diagnostics));
          const xml = new TextDecoder().decode(readPptx(pptx.value).get("ppt/slides/slide1.xml"));
          const parsed = parseXml(xml);
          if (!parsed.ok) throw new Error(parsed.message);
          const shape = [...descendants(parsed.root)].find(
            (e) =>
              e.name === "p:sp" &&
              [...descendants(e)].some(
                (child) => child.name === "p:cNvPr" && attribute(child, "name") === "n:a",
              ),
          );
          if (!shape) throw new Error("missing split shape");
          const elements = [...descendants(shape)];
          const number = (tag: string, name: string) => {
            const element = elements.find((e) => e.name === tag);
            if (!element) throw new Error(`missing ${tag}`);
            const value = attribute(element, name);
            if (value === undefined) throw new Error(`missing ${name}`);
            return Number(value);
          };
          expect(xml.match(/<a:t\b/g)).toHaveLength(label.split("\n").length);
          expect(elements.filter((e) => e.name === "a:path")).toHaveLength(2);
          const left = number("a:off", "x") + number("a:bodyPr", "lIns");
          const right = number("a:off", "x") + number("a:ext", "cx") - number("a:bodyPr", "rIns");
          const top = number("a:off", "y") + number("a:bodyPr", "tIns");
          // One SVG unit is 6350 EMU; each DrawingML value rounds to an integer.
          expect(
            Math.abs((left + right) / 2 - dx - (svgLabel.anchor.x - viewBox.x) * 6350),
          ).toBeLessThanOrEqual(2);
          expect(Math.abs(top - dy - (firstLine.y - viewBox.y) * 6350)).toBeLessThanOrEqual(2);
        }
      });
    }
  }
}

for (const [component, props] of featureProps) {
  for (const side of ["north", "south", "east", "west"] as const) {
    for (const offset of [0.25, 0.5, 0.75]) {
      test(`${component}/${props}: ${side}:${offset} contacts a painted segment`, async () => {
        const result = await renderFigure(`version: 1
figure: { id: ports, profile: paper-double, layout: { arrange: { stack: { items: [a, b] } } } }
nodes:
  - { id: a, component: box, label: A }
  - { id: b, component: ${component}, label: B, props: { ${props} } }
edges: [{ from: a, to: b, toAnchor: "${side}:${offset}" }]
`);
        if (!result.ok || !("layout" in result.value))
          throw new Error(JSON.stringify(result.diagnostics));
        const { layout, compiled } = result.value;
        const pair = resolveEnds(compiled.ir, layout)[0];
        const node = compiled.ir.nodes.find((n) => n.id === "b");
        const placed = layout.nodes.find((n) => n.key === "n:b");
        if (!pair || "error" in pair || !node?.render || !placed) throw new Error("missing port");
        const renderer = getOutlineRenderer(node.render.renderer);
        if (!renderer) throw new Error("missing renderer");
        const drawing = renderer.draw(placed.rect, renderer.params.parse(node.render.params));
        const p = pair.to.outline;
        const onBoundary = (drawing.boundaries ?? [drawing.outline]).some((points) =>
          points.some((a, i) => {
            const b = points[(i + 1) % points.length];
            if (!b) return false;
            const cross = (p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x);
            return (
              Math.abs(cross) / Math.hypot(b.x - a.x, b.y - a.y) < 0.002 &&
              p.x >= Math.min(a.x, b.x) - 0.002 &&
              p.x <= Math.max(a.x, b.x) + 0.002 &&
              p.y >= Math.min(a.y, b.y) - 0.002 &&
              p.y <= Math.max(a.y, b.y) + 0.002
            );
          }),
        );
        expect(onBoundary).toBe(true);
        expect(layout.edges[0]?.route?.points.at(-1)).toEqual(p);
      });
    }
  }
}

for (const direction of ["down", "up", "left", "right"]) {
  test(`D2 ${direction}: gap-facing endpoints touch the painted outline`, async () => {
    const result = await renderFigure(`version: 1
figure: { id: auto, layout: { direction: ${direction} } }
nodes:
  - { id: a, component: bowtie, variant: filled, label: LoRA, props: { gap: 8 } }
  - { id: b, component: bowtie, variant: filled, label: LoRA, props: { gap: 8 } }
edges: [{ from: a, to: b }]
`);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.diagnostics).toEqual([]);
    expect(lintGeometry(result.value)).toEqual([]);
  });
}

for (const layout of ["{ direction: right }", "{ arrange: { row: { items: [a] } } }"]) {
  for (const size of ["width: 30pt, height: 30pt", "width: 30pt", "height: 5pt"]) {
    test(`${layout}/${size}: explicit small split bowtie reports label/outline overlap`, async () => {
      const source = `version: 1
figure: { id: small, theme: paper, layout: ${layout} }
nodes:
  - { id: a, component: bowtie, label: LoRA, props: { gap: 8, ${size} } }
`;
      const result = await renderFigure(source);
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
      const geometry = geometryContextFor(result.value).get("n:a");
      if (!geometry?.bbox || !geometry.labelBoundaries) throw new Error("missing geometry");
      const line = geometry.labels[0]?.visibleLines[0];
      if (!line) throw new Error("missing label");
      expect(polylinesCrossRect(geometry.labelBoundaries, line, 0)).toBe(true);
      expect(
        lintGeometry(result.value, { source }).filter((d) => d.code === "geometry/label-overflow"),
      ).toMatchObject([
        { severity: "error", path: ["nodes", 0, "props"], subject: { kind: "node", id: "a" } },
      ]);
    });
  }
}

test("props validate at the public boundary and default geometry stays identical", () => {
  for (const props of ["gap: -1", "gap: 65", "gap: 1pt", "gap: true"]) {
    expect(
      compileFigure(
        `version: 1\nfigure: { id: invalid }\nnodes: [{ id: a, component: bowtie, props: { ${props} } }]`,
      ).ok,
    ).toBe(false);
  }
  expect(
    compileFigure(
      "version: 1\nfigure: { id: invalid }\nnodes: [{ id: a, component: trapezoid, props: { narrow: sideways } }]",
    ).ok,
  ).toBe(false);
  const rect = { x: 0, y: 0, width: 160, height: 80 };
  for (const [id, explicit] of [
    ["sumi/bowtie", { gap: 0 }],
    ["sumi/trapezoid", { narrow: "south" }],
  ] as const) {
    const renderer = getOutlineRenderer(id);
    if (!renderer) throw new Error("missing renderer");
    expect(renderer.draw(rect, renderer.params.parse(explicit))).toEqual(
      renderer.draw(rect, renderer.params.parse({})),
    );
  }
});

test("an unrelated edge detours around the whole split bowtie, including its gap", async () => {
  const result = await renderFigure(`version: 1
figure: { id: obstacle, layout: { arrange: { stack: { gap: 10mm, items: [a, split, b] } } } }
nodes:
  - { id: a, component: box, label: A }
  - { id: split, component: bowtie, label: LoRA, props: { gap: 64, width: 50pt } }
  - { id: b, component: box, label: B }
edges: [{ from: a, to: b, fromAnchor: south, toAnchor: north }]
`);
  if (!result.ok || !("layout" in result.value))
    throw new Error(JSON.stringify(result.diagnostics));
  const rect = result.value.layout.nodes.find((n) => n.key === "n:split")?.rect;
  const points = result.value.layout.edges[0]?.route?.points;
  if (!rect || !points) throw new Error("missing routed obstacle");
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (!a || !b) throw new Error("missing segment");
    if (a.x === b.x && a.x > rect.x && a.x < rect.x + rect.width) {
      expect(Math.max(a.y, b.y) <= rect.y || Math.min(a.y, b.y) >= rect.y + rect.height).toBe(true);
    }
    if (a.y === b.y && a.y > rect.y && a.y < rect.y + rect.height) {
      expect(Math.max(a.x, b.x) <= rect.x || Math.min(a.x, b.x) >= rect.x + rect.width).toBe(true);
    }
  }
});

test("glued PPTX sites use the actual gap lip and sideways sloping outline", async () => {
  const result = await renderFigure(`version: 1
figure: { id: sites, layout: { arrange: { stack: { items: [a, b] } } } }
nodes:
  - { id: a, component: bowtie, label: LoRA, props: { gap: 8 } }
  - { id: b, component: trapezoid, label: B, props: { narrow: east } }
edges: [{ from: a, to: b, fromAnchor: south, toAnchor: north }]
`);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const { svg, compiled, inspection } = result.value;
  const pptx = svgToEditablePptx(svg, compiled.ir, { connectors: "glued" });
  if (!pptx.ok) throw new Error(JSON.stringify(pptx.diagnostics));
  const xml = new TextDecoder().decode(readPptx(pptx.value).get("ppt/slides/slide1.xml"));
  const edge = inspection.elements.find((e) => e.key === compiled.ir.edges[0]?.key)?.path;
  const endpoints = [edge?.[0]?.to, edge?.at(-1)?.to];
  for (const [i, key] of ["n:a", "n:b"].entries()) {
    const box = inspection.elements.find((e) => e.key === key)?.bbox;
    const point = endpoints[i];
    if (!box || !point) throw new Error("missing geometry");
    const x = Math.round((point.x - box.x) * 6350);
    const y = Math.round((point.y - box.y) * 6350);
    expect(xml).toContain(`<a:pos x="${x}" y="${y}"/>`);
  }
  expect(xml).toContain('<a:stCxn id="2" idx="0"/>');
  expect(xml).toContain('<a:endCxn id="3" idx="0"/>');
});
