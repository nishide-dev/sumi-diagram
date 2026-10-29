import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { BUILTIN_THEMES } from "../core/theme/builtin";
import { lintRenderedFigure } from "../lint/geometry/lint";
import { svgToPdf } from "./pdf";
import { parsePdf } from "./pdf/testing";
import { svgToEditablePptx, svgToPptx } from "./pptx";
import { readPptx } from "./pptx/testing";

const source = (theme: string, direction = "right") => `version: 1
figure:
  id: separator
  theme: ${theme}
  layout: { arrange: { stack: { items: [seq, out, sink] } } }
nodes:
  - id: seq
    component: tokens
    props:
      direction: ${direction}
      gap: 2pt
      width: 24pt
      height: 24pt
      variant: outlined
      cells: [{ id: a, label: '$A_1$', tone: purple }, { id: cut, separator: dotted, tone: gray }, { id: i, label: '$I_0$', tone: orange }]
  - { id: out, component: box, label: Out }
  - { id: sink, component: box, label: Sink }
edges:
  - { from: out, to: sink }
`;

describe("dotted token separators (#216)", () => {
  test("H3-World separates the A… and I0/V… cells in both token rows", async () => {
    const file = join(import.meta.dir, "../../research/216-token-separator/c-h3world.sumi.yaml");
    const report = await lintRenderedFigure(readFileSync(file, "utf8"), {
      file,
      assetBase: dirname(file),
    });
    expect(report.diagnostics.map((d) => [d.severity, d.code])).toEqual([
      ["info", "geometry/script-too-small"],
    ]);
    const rendered = report.rendered;
    if (!rendered || !("layout" in rendered)) throw new Error("missing H3-World layout");
    for (const id of ["seq", "bt"]) {
      const cells = rendered.layout.nodes.filter((n) => n.key.startsWith(`n:${id}-`));
      const cut = cells.findIndex((n) => n.key === `n:${id}-av`);
      expect(cells[cut + 1]?.key).toBe(`n:${id}-i0`);
      expect(cells[cut - 1]?.key).toBe(id === "seq" ? "n:seq-adots" : "n:bt-a3");
    }
    expect(rendered.svg.match(/class="sumi-token-separator"/g)).toHaveLength(2);
  });

  test("geometry lint reports overlaps against the separator's written cell", async () => {
    const text = source("paper").replace(
      "edges:\n",
      `  - { id: note, component: box, props: { width: 12pt, height: 12pt }, attach: { to: seq.a, side: east, gap: 0pt } }\nedges:\n`,
    );
    const report = await lintRenderedFigure(text, {});
    const overlaps = report.diagnostics.filter((d) => d.code === "geometry/node-overlap");
    const cut = overlaps.find((d) => d.message.includes('cell "cut"'));
    expect(cut).toBeDefined();
    expect(cut?.path).toEqual(["nodes", 0, "props", "cells", 1]);
  });

  test("divider tone inherits from tokens independently of the normal cell variant", async () => {
    const text = source("paper")
      .replace("    component: tokens", "    component: tokens\n    tone: blue")
      .replace("separator: dotted, tone: gray", "separator: dotted")
      .replace("variant: outlined", "variant: filled");
    const report = await lintRenderedFigure(text, {});
    expect(report.diagnostics).toEqual([]);
    expect(report.rendered?.svg).toMatch(/class="sumi-token-separator"[^>]*stroke="#2f62b0"/);
  });

  for (const theme of BUILTIN_THEMES.keys()) {
    for (const direction of ["right", "left", "down", "up"]) {
      test(`${theme} / ${direction}: lint, inspect and reserved geometry`, async () => {
        const report = await lintRenderedFigure(source(theme, direction), {});
        expect(report.diagnostics).toEqual([]);
        const rendered = report.rendered;
        if (!rendered || !("layout" in rendered)) throw new Error("missing structured render");
        const rect = rendered.layout.nodes.find((n) => n.key === "n:seq-cut")?.rect;
        const inspected = rendered.inspection.elements.find((e) => e.key === "n:seq-cut");
        expect(inspected?.bbox).toEqual(rect);
        const vertical = direction === "right" || direction === "left";
        expect(rect?.width).toBe(vertical ? 12 : 48);
        expect(rect?.height).toBe(vertical ? 48 : 12);
        expect(rendered.svg).toContain('class="sumi-token-separator"');
        expect(rendered.svg).toContain('stroke-linecap="round"');
      });
    }
  }

  test("PDF and picture/editable PPTX preserve divider geometry, color and dash", async () => {
    const report = await lintRenderedFigure(source("paper"), {});
    const rendered = report.rendered;
    if (!rendered) throw new Error(JSON.stringify(report.diagnostics));
    const path =
      /<path class="sumi-token-separator" d="([^"]+)" fill="none" stroke="([^"]+)" stroke-width="([^"]+)" stroke-dasharray="([^"]+)"/.exec(
        rendered.svg,
      );
    expect(path).not.toBeNull();
    const [x1, y1, x2, y2] = (path?.[1]?.match(/[-\d.]+/g) ?? []).map(Number);
    expect(x1).toBe(x2);
    const pdf = svgToPdf(rendered.svg);
    if (!pdf.ok) throw new Error(JSON.stringify(pdf.diagnostics));
    const streams = [...parsePdf(pdf.value).objects.values()]
      .filter((o) => o.stream !== undefined)
      .map((o) => new TextDecoder("latin1").decode(o.stream))
      .join("\n");
    expect(streams).toContain(`${x1} ${y1} m ${x2} ${y2} l`);
    expect(streams).toMatch(/\[\s*[\d.]+\s+[\d.]+\s*\]\s*0 d/);
    const picture = svgToPptx(rendered.svg);
    if (!picture.ok) throw new Error(JSON.stringify(picture.diagnostics));
    const svg = new TextDecoder().decode(readPptx(picture.value).get("ppt/media/figure.svg"));
    expect(svg).toContain(`stroke="${path?.[2]}"`);
    expect(svg).toContain(`stroke-dasharray="${path?.[4]}"`);
    for (const connectors of ["freeform", "glued"] as const) {
      const pptx = svgToEditablePptx(rendered.svg, rendered.compiled.ir, { connectors });
      if (!pptx.ok) throw new Error(JSON.stringify(pptx.diagnostics));
      const slide = new TextDecoder().decode(readPptx(pptx.value).get("ppt/slides/slide1.xml"));
      expect(slide).toContain('name="n:seq-cut separator"');
      expect(slide).toContain('<a:custDash><a:ds d="100000" sp="200000"/></a:custDash>');
      expect(slide).toContain(`val="${path?.[2]?.slice(1).toUpperCase()}"`);
    }
  });
});
