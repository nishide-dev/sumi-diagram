import { expect, test } from "bun:test";
import { BUILTIN_THEMES } from "../core/theme/builtin";
import { lintGeometry } from "../lint/geometry/lint";
import { svgToPdf } from "./pdf";
import { svgToPptx } from "./pptx";
import { renderFigure } from "./render";

const source = `version: 1
figure:
  id: fill-render
  profile: paper-double
  fit: scale
  layout:
    density: compact
    arrange: { row: { gap: 12mm, align: stretch, items: [g, tall] } }
groups:
  - id: g
    caption: Column
    arrange:
      stack:
        gap: 6mm
        justify: stretch
        items: [a, b]
nodes:
  - { id: a, component: box, label: First, props: { width: 100pt }, badge: { icon: emoji/fire, corner: north-east } }
  - { id: b, component: box, label: Second }
  - { id: tall, component: box, label: Tall, props: { height: 100pt } }
edges: [{ from: a, to: b }]
`;

for (const theme of BUILTIN_THEMES.keys()) {
  test(`fill survives caption expansion, routing, SVG/PDF/PPTX with ${theme}`, async () => {
    const result = await renderFigure(source, { overrides: { theme } });
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const rendered = result.value;
    expect(lintGeometry(rendered)).toEqual([]);
    expect(svgToPdf(rendered.svg).ok).toBe(true);
    expect(svgToPptx(rendered.svg).ok).toBe(true);
    if (!("layout" in rendered)) throw new Error("Expected structured");
    const group = rendered.layout.groups[0];
    const a = rendered.layout.nodes.find((n) => n.key === "n:a")?.rect;
    const b = rendered.layout.nodes.find((n) => n.key === "n:b")?.rect;
    if (group === undefined || a === undefined || b === undefined)
      throw new Error("Missing fill geometry");
    expect(a.y).toBeGreaterThanOrEqual(group.content.y);
    expect(b.y + b.height).toBeCloseTo(group.content.y + group.content.height, 2);
    expect(a.height).toBeGreaterThan(30);
  });
}
