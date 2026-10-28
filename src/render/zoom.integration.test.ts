/**
 * Zoom edges (#176, design doc §6.45) drawn end to end, without D2: the SVG
 * carries both lines (one `path.connection` with two subpaths, stroked by a
 * dashed `sumi-wire`), the geometry lint warns only when a line crosses a
 * node (`geometry/zoom-crosses-node`), the PDF and both PPTX modes take
 * them, and the DiT and H3-World figures of research/167-stage-c with their
 * zoom callout as `component: zoom` (research/176-zoom-edge) have no finding
 * about it and the same diagnostics as the originals with orthogonal lines.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";
import { lintGeometry } from "../lint/geometry";
import { lintRenderedFigure } from "../lint/geometry/lint";
import { svgToPdf } from "./pdf";
import { svgToEditablePptx, svgToPptx } from "./pptx";
import { readPptx } from "./pptx/testing";
import { type RenderedFigure, renderFigure } from "./render";

const ROOT = join(import.meta.dir, "..", "..");

/** The markup of the element with class `sumi-k-<kind>--<id>` (up to the next element). */
function chunkOf(svg: string, key: string): string {
  const cls = `sumi-k-${key[0]}--${key.slice(2).replace(/^#/, "_")}`;
  const start = svg.indexOf(`<g class="${cls} `);
  if (start < 0) throw new Error(`no markup for ${key}`);
  const next = svg.indexOf('<g class="sumi-k-', start + 1);
  return svg.slice(start, next < 0 ? svg.length : next);
}

function figure(theme: string, edges: unknown[], extra: { items?: unknown[]; nodes?: unknown[] }) {
  return stringify({
    version: 1,
    figure: {
      id: "zoom",
      theme,
      profile: "paper-double",
      layout: {
        arrange: {
          stack: {
            gap: "8mm",
            align: "center",
            items: [
              { row: { gap: "10mm", align: "center", items: ["block", "view"] } },
              ...(extra.items ?? []),
            ],
          },
        },
      },
    },
    groups: [{ id: "view", label: "view", arrange: { row: { gap: "5mm", items: ["a", "b"] } } }],
    nodes: [
      { id: "block", component: "box", label: "block" },
      { id: "a", component: "box", label: "a" },
      { id: "b", component: "box", label: "b" },
      ...(extra.nodes ?? []),
    ],
    edges: [{ from: "a", to: "b" }, ...edges],
  });
}

async function render(source: string): Promise<RenderedFigure> {
  const result = await renderFigure(source);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  expect(result.diagnostics).toEqual([]);
  return result.value;
}

describe("a zoom edge in the SVG", () => {
  test("two lines in one connection path, stroked dashed by a wire of their own", async () => {
    const rendered = await render(
      figure("academic", [{ id: "z", from: "block", to: "view", component: "zoom" }], {}),
    );
    expect(lintGeometry(rendered, {})).toEqual([]);
    const { svg } = rendered;
    const chunk = chunkOf(svg, "e:z");
    const d = /<path class="connection" d="([^"]*)"/.exec(chunk)?.[1] ?? "";
    expect(d).toMatch(/^M [\d.]+ [\d.]+ L [\d.]+ [\d.]+ M [\d.]+ [\d.]+ L [\d.]+ [\d.]+$/);
    // No arrowheads and no label.
    expect(chunk).not.toContain("<polygon");
    expect(chunk).not.toContain("<text");
    const wire = [...svg.matchAll(/<path class="sumi-wire" d="([^"]*)"[^>]*>/g)].find(
      (m) => m[1] === d,
    );
    expect(wire?.[0]).toContain("stroke-dasharray");
    // The corners of the layout.
    const layout = "layout" in rendered ? rendered.layout : undefined;
    const edge = layout?.edges.find((e) => e.key === "e:z");
    const lines = edge?.route?.lines ?? [];
    expect(lines).toHaveLength(2);
    const block = layout?.nodes.find((n) => n.key === "n:block")?.rect;
    const view = layout?.groups.find((g) => g.key === "g:view")?.rect;
    if (block === undefined || view === undefined) throw new Error("no layout");
    expect(lines).toEqual([
      [
        { x: block.x + block.width, y: block.y },
        { x: view.x, y: view.y },
      ],
      [
        { x: block.x + block.width, y: block.y + block.height },
        { x: view.x, y: view.y + view.height },
      ],
    ]);
    // What the lint measures as painted: the two lines.
    const painted = rendered.inspection.painted?.find((p) => p.key === "e:z")?.path;
    expect(painted?.filter((s) => s.command === "M")).toHaveLength(2);
  });

  test("solid draws no dashes", async () => {
    const rendered = await render(
      figure(
        "minimal",
        [{ id: "z", from: "block", to: "view", component: "zoom", variant: "solid" }],
        {},
      ),
    );
    const d = /<path class="connection" d="([^"]*)"/.exec(chunkOf(rendered.svg, "e:z"))?.[1];
    const wire = [...rendered.svg.matchAll(/<path class="sumi-wire" d="([^"]*)"[^>]*>/g)].find(
      (m) => m[1] === d,
    );
    expect(wire?.[0]).toBeDefined();
    expect(wire?.[0]).not.toContain("stroke-dasharray");
  });

  test("a node in the way is geometry/zoom-crosses-node, not edge-through-node", async () => {
    // "aside", taller than "block", stands between it and the view: both
    // lines run into it.
    const source = stringify({
      version: 1,
      figure: {
        id: "zoom",
        theme: "academic",
        layout: {
          arrange: {
            row: {
              gap: "6mm",
              align: "center",
              items: ["block", { stack: { gap: "1mm", items: ["aside"] } }, "view"],
            },
          },
        },
      },
      groups: [
        {
          id: "view",
          label: "view",
          arrange: { stack: { items: ["a"] } },
        },
      ],
      nodes: [
        { id: "block", component: "box", label: "block" },
        { id: "aside", component: "box", label: "aside", props: { height: "80pt" } },
        { id: "a", component: "box", label: "a" },
      ],
      edges: [{ id: "z", from: "block", to: "view", component: "zoom" }],
    });
    const rendered = await render(source);
    const findings = lintGeometry(rendered, { source });
    expect(findings.map((f) => [f.code, f.severity, f.subject, f.path])).toEqual([
      ["geometry/zoom-crosses-node", "warning", { kind: "edge", id: "z" }, ["edges", 0]],
    ]);
    expect(findings[0]?.message).toBe(
      'A line of edge "z" passes through the shape of node "aside".',
    );
  });
});

describe("zoom edges in PDF and PPTX", () => {
  test("the PDF, the picture PPTX and both editable modes take them", async () => {
    const rendered = await render(
      figure("color", [{ id: "z", from: "block", to: "view", component: "zoom" }], {}),
    );
    expect(svgToPdf(rendered.svg).ok).toBe(true);
    expect(svgToPptx(rendered.svg).ok).toBe(true);
    for (const connectors of ["freeform", "glued"] as const) {
      const result = svgToEditablePptx(rendered.svg, rendered.compiled.ir, { connectors });
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
      const slide = new TextDecoder().decode(
        readPptx(result.value).get("ppt/slides/slide1.xml") ?? new Uint8Array(),
      );
      // The zoom edge is a freeform shape with two moveTo, never a connector.
      const shape = /<p:sp><p:nvSpPr><p:cNvPr id="\d+" name="e:z"\/>.*?<\/p:sp>/.exec(slide)?.[0];
      expect(shape).toBeDefined();
      expect(shape?.match(/<a:moveTo>/g)).toHaveLength(2);
      expect(shape).toContain("<a:custDash>");
    }
  });
});

describe("research/176-zoom-edge: the DiT and H3-World zoom callouts", () => {
  for (const name of ["b-dit", "c-h3world"]) {
    test(`${name}: no finding about the zoom edge, the original's diagnostics otherwise`, async () => {
      const lint = async (dir: string) => {
        const base = join(ROOT, "research", dir, "figures");
        const text = readFileSync(join(base, `${name}.sumi.yaml`), "utf8");
        return lintRenderedFigure(text, { assetBase: base });
      };
      const zoomed = await lint("176-zoom-edge");
      const original = await lint("167-stage-c");
      expect(zoomed.rendered).toBeDefined();
      const ir = zoomed.rendered?.compiled.ir;
      const zooms = ir?.edges.filter((e) => e.routing === "zoom") ?? [];
      expect(zooms).toHaveLength(1);
      const ids = new Set(zooms.map((e) => e.id ?? `edges[${e.index}]`));
      expect(
        zoomed.diagnostics.filter((d) => d.subject?.kind === "edge" && ids.has(d.subject.id)),
      ).toEqual([]);
      const summary = (diagnostics: typeof zoomed.diagnostics) =>
        diagnostics.map((d) => `${d.severity} ${d.code} ${d.message}`).sort();
      expect(summary(zoomed.diagnostics)).toEqual(summary(original.diagnostics));
    });
  }
});
