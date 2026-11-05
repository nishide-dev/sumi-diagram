/**
 * The theme's standard arrowhead (#386): `llama` draws every triangle end as
 * an open chevron, in structured SVG (a stroked path the wire runs into), in
 * D2 SVG (a chevron marker replacing D2's triangle) and in editable PPTX (the
 * native open `arrow` end), while every other theme and every other
 * arrowhead shape keep their triangles.
 */

import { describe, expect, test } from "bun:test";
import { checkD2Version, findD2Binary } from "../backends/d2/binary";
import { compileFigure } from "../compiler/compile";
import { generateD2 } from "../compiler/d2";
import { createBuiltinRegistry } from "../core/registry/builtins";
import type { EdgeManifest } from "../core/registry/manifest";
import { buildThemeCatalog } from "../core/theme/catalog";
import { validateTheme } from "../core/theme/schema";
import { lintGeometry } from "../lint/geometry";
import { svgToPdf } from "./pdf";
import { svgToEditablePptx } from "./pptx";
import { readPptx } from "./pptx/testing";
import { type RenderedFigure, renderFigure } from "./render";
import { roundCorners, type WirePolyline } from "./wire";

const binary = findD2Binary();
const available = binary.ok && (await checkD2Version(binary.value.path)).ok;

/** A registry with an edge that asks for a diamond head and one that asks for an open head. */
function registry() {
  const r = createBuiltinRegistry();
  const arrow = r.get("sumi/arrow") as EdgeManifest;
  for (const [name, head] of [
    ["rhombus", "diamond"],
    ["chevron", "open"],
  ] as const) {
    const registered = r.register({ ...arrow, namespace: "test", name, head });
    if (!registered.ok) throw new Error(JSON.stringify(registered.diagnostics));
  }
  return r;
}

const structured = (theme: string) => `version: 1
figure:
  id: heads
  theme: ${theme}
  profile: paper-double
  layout:
    arrange: { row: { gap: 12mm, items: [ a, b, c, d ] } }
nodes:
  - { id: a, component: box, label: A }
  - { id: b, component: box, label: B }
  - { id: c, component: box, label: C }
  - { id: d, component: box, label: D }
edges:
  - { from: a, to: b }
  - { from: b, to: c, component: test/rhombus }
  - { from: c, to: d, component: double-arrow }
  - { from: a, to: d, component: double-arrow, fromAnchor: south, toAnchor: south }
`;

const auto = (theme: string) => `version: 1
figure:
  id: heads
  theme: ${theme}
  profile: paper-double
  layout: { direction: right }
nodes:
  - { id: a, component: box, label: A }
  - { id: b, component: box, label: B }
  - { id: c, component: box, label: C }
edges:
  - { from: a, to: b }
  - { from: b, to: c, component: test/rhombus }
  - { from: a, to: c, component: test/chevron }
`;

/** The markup of an edge's group (up to the next element's group). */
function chunkOf(svg: string, index: number): string {
  const start = new RegExp(`<g class="[^"]*\\bsumi-k-e--_${index} `).exec(svg)?.index;
  if (start === undefined) throw new Error(`no markup for edge ${index}`);
  const next = /<g class="[^"]*\bsumi-k-/g;
  next.lastIndex = start + 1;
  const end = next.exec(svg)?.index;
  return svg.slice(start, end ?? svg.length);
}

async function render(source: string): Promise<RenderedFigure> {
  const result = await renderFigure(source, { registry: registry() });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.value;
}

describe("the theme's arrowhead field", () => {
  test("accepts triangle and open, rejects anything else, and is absent unless written", () => {
    const base = { version: 1, id: "t", fonts: "sumi/biz-ud-gothic" };
    const arrowheadOf = (raw: unknown) => {
      const result = validateTheme(raw);
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
      return result.value.arrowhead;
    };
    expect(arrowheadOf(base)).toBeUndefined();
    for (const arrowhead of ["triangle", "open"] as const) {
      expect(arrowheadOf({ ...base, arrowhead })).toBe(arrowhead);
    }
    const bad = validateTheme({ ...base, arrowhead: "chevron" });
    expect(bad.ok).toBe(false);
    expect(bad.diagnostics.map((d) => [d.code, d.path])).toEqual([
      ["theme/invalid-value", ["arrowhead"]],
    ]);
  });

  test("the catalog lists it: open for llama, triangle for every other theme", () => {
    expect(Object.fromEntries(buildThemeCatalog().map((t) => [t.id, t.arrowhead]))).toEqual({
      minimal: "triangle",
      academic: "triangle",
      slides: "triangle",
      color: "triangle",
      paper: "triangle",
      llama: "open",
    });
  });

  test("replaces triangle ends only; other shapes and other themes are kept", () => {
    const heads = (theme: string) => {
      const compiled = compileFigure(structured(theme), { registry: registry() });
      if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
      return compiled.value.ir.edges.map((e) => [e.sourceArrowhead, e.targetArrowhead]);
    };
    expect(heads("llama")).toEqual([
      [undefined, "open"],
      [undefined, "diamond"],
      ["open", "open"],
      ["open", "open"],
    ]);
    expect(heads("paper")).toEqual([
      [undefined, "triangle"],
      [undefined, "diamond"],
      ["triangle", "triangle"],
      ["triangle", "triangle"],
    ]);
  });
});

describe("structured SVG", () => {
  test("an open head is a stroked chevron the wire runs into; no triangle is drawn", async () => {
    const rendered = await render(structured("llama"));
    const chunk = chunkOf(rendered.svg, 0);
    expect(chunk).not.toContain("<polygon");
    const head =
      /<path class="sumi-arrowhead" d="M ([\d.]+) ([\d.]+) L ([\d.]+) ([\d.]+) L ([\d.]+) ([\d.]+)" fill="none" stroke="#344854" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"\/>/.exec(
        chunk,
      );
    if (head === null) throw new Error(`no chevron in ${chunk}`);
    const [x1, y1, vx, vy, x2, y2] = head.slice(1).map(Number) as [
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    const tip = /<path class="connection" d="M [\d.]+ [\d.]+ L ([\d.]+) ([\d.]+)"/.exec(chunk);
    const [tx, ty] = [Number(tip?.[1]), Number(tip?.[2])];
    // Pointing right: the vertex half a stroke (0.5 units) behind the tip,
    // the arms 0.75 × the 8-unit arrowhead back and to each side.
    expect([vx, vy]).toEqual([tx - 0.5, ty]);
    expect([x1, y1, x2, y2]).toEqual([vx - 6, vy + 6, vx - 6, vy - 6]);
    // The wire (round caps) ends at the vertex, not at a triangle's base.
    const wires = [...rendered.svg.matchAll(/<path class="sumi-wire" d="([^"]*)"/g)].map(
      (m) => m[1] ?? "",
    );
    expect(wires.some((d) => d.includes(`${vx} ${vy}`))).toBe(true);
    // The diamond keeps its filled polygon.
    expect(chunkOf(rendered.svg, 1)).toContain("<polygon");
  });

  test("turns before an open head are as round as before a triangle (no cramped stem)", async () => {
    const rendered = await render(structured("llama"));
    expect(lintGeometry(rendered)).toEqual([]);
  });

  test("PDF and editable PPTX take it: the native open arrow end", async () => {
    const rendered = await render(structured("llama"));
    expect(svgToPdf(rendered.svg).ok).toBe(true);
    const pptx = svgToEditablePptx(rendered.svg, rendered.compiled.ir);
    if (!pptx.ok) throw new Error(JSON.stringify(pptx.diagnostics));
    const slide = new TextDecoder().decode(readPptx(pptx.value).get("ppt/slides/slide1.xml"));
    expect(slide.match(/<a:tailEnd type="arrow"/g)?.length).toBe(3);
    expect(slide.match(/<a:headEnd type="arrow"/g)?.length).toBe(2);
    expect(slide).toContain('<a:tailEnd type="diamond"');
    expect(slide).not.toContain('type="triangle"');
  });

  test("another theme draws the same figure with filled triangles", async () => {
    const rendered = await render(structured("paper"));
    expect(rendered.svg).not.toContain("sumi-arrowhead");
    expect(chunkOf(rendered.svg, 0)).toContain("<polygon");
  });
});

describe("rounded wires (wire.ts)", () => {
  test("an open head's extra wire does not change the turn before it", () => {
    const options = { radius: 8, minRadius: 1, clearance: 1, obstacles: [] };
    const p = (x: number, y: number) => ({ x, y });
    // A triangle's wire stops at the base, 8 units before the tip at (40, 12);
    // an open head's wire runs to its vertex, 0.5 units before it.
    const triangle: WirePolyline = { points: [p(0, 0), p(40, 0), p(40, 4)] };
    const open: WirePolyline = {
      points: [p(0, 0), p(40, 0), p(40, 11.5)],
      keepEnd: 7.5,
      headEnd: 7.5,
    };
    expect(roundCorners([open], options).arcs).toEqual(roundCorners([triangle], options).arcs);
    // Without the allowance the turn would take half the longer leg.
    const plain = roundCorners([{ points: open.points, keepEnd: 7.5 }], options).arcs;
    expect(plain).not.toEqual(roundCorners([triangle], options).arcs);
  });
});

describe("D2 SVG", () => {
  test("an open end is written to D2 as a filled triangle", () => {
    const compiled = compileFigure(auto("llama"), { registry: registry() });
    if (!compiled.ok || compiled.value.engine !== "auto") throw new Error("not an auto figure");
    const d2 = generateD2(compiled.value.ir);
    expect(d2).not.toContain("shape: open");
    expect(d2.match(/shape: triangle\n\s*style\.filled: true/g)?.length).toBe(2);
  });

  test.skipIf(!available)(
    "the triangle marker of an open end becomes a chevron; a shared triangle stays",
    async () => {
      // Under paper, the arrow (triangle) and test/chevron (open) share D2's marker.
      const rendered = await render(auto("paper"));
      const markerOf = (index: number) =>
        /marker-end="url\(#([^)]+)\)"/.exec(chunkOf(rendered.svg, index))?.[1] ?? "";
      const triangle = markerOf(0);
      const open = markerOf(2);
      expect(open).toBe(`${triangle}-open`);
      const marker = (id: string) =>
        new RegExp(`<marker id="${id}"[^>]*>(.*?)</marker>`).exec(rendered.svg)?.[1] ?? "";
      expect(marker(triangle)).toContain("<polygon");
      expect(marker(open)).toMatch(
        /^<path d="M [\d.]+ [\d.]+ L [\d.]+ [\d.]+ L [\d.]+ [\d.]+" fill="none" stroke="#000000" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"\/>$/,
      );
      // The diamond keeps D2's own marker.
      expect(markerOf(1)).not.toContain("-open");
      expect(svgToPdf(rendered.svg).ok).toBe(true);
    },
  );

  test.skipIf(!available)("llama draws every arrow of an auto figure open", async () => {
    const rendered = await render(auto("llama"));
    for (const index of [0, 2]) {
      expect(chunkOf(rendered.svg, index)).toMatch(/marker-end="url\(#[^)]+-open\)"/);
    }
    const pptx = svgToEditablePptx(rendered.svg, rendered.compiled.ir);
    if (!pptx.ok) throw new Error(JSON.stringify(pptx.diagnostics));
    const slide = new TextDecoder().decode(readPptx(pptx.value).get("ppt/slides/slide1.xml"));
    expect(slide.match(/<a:tailEnd type="arrow"/g)?.length).toBe(2);
  });
});
