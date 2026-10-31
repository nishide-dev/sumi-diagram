/**
 * Matrices (#180, design doc §6.56) end to end, without D2:
 *
 * - the hatch lines of a hatched class are the same segments in the SVG, the
 *   PDF (the engine's content stream), the picture PPTX (its SVG) and the
 *   editable PPTX (a line shape over the cell);
 * - the H3-World figure of research/180-matrix (its masked-attention matrix
 *   written as one matrix node, by its render.ts) has no
 *   `lint/empty-label`, the other diagnostics of #177's hand-written figure,
 *   and cells of the same fills as #177's hand-written boxes.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Diagnostic } from "../core/diagnostics";
import type { LayoutIR } from "../layout/ir";
import { lintRenderedFigure } from "../lint/geometry/lint";
import { svgToPdf } from "./pdf/pdf";
import { parsePdf } from "./pdf/testing";
import { svgToEditablePptx } from "./pptx/editable";
import { svgToPptx } from "./pptx/pptx";
import { readPptx } from "./pptx/testing";
import { type RenderedFigure, renderFigure } from "./render";
import { attribute, descendants, parseXml } from "./xml";

const ROOT = join(import.meta.dir, "..", "..");

type Segment = [number, number, number, number];

/** The M/L pairs of a path's data. */
function pairs(d: string): Segment[] {
  const numbers = [
    ...d.matchAll(/M\s*([-\d.e]+)[\s,]+([-\d.e]+)\s*L\s*([-\d.e]+)[\s,]+([-\d.e]+)/g),
  ];
  return numbers.map((m) => [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])]);
}

/** Segments at 45° rising to the right (in SVG coordinates): hatch lines, never routes. */
const diagonal = (segments: Segment[]) =>
  segments.filter(([x1, y1, x2, y2]) => Math.abs(x2 - x1 - (y1 - y2)) < 1e-3 && x2 > x1);

const expectSame = (actual: Segment[], expected: Segment[], digits: number) => {
  expect(actual.length).toBe(expected.length);
  expect(actual).toEqual(expected.map((s) => s.map((v) => expect.closeTo(v, digits)) as never));
};

const SMALL = `version: 1
figure:
  id: hatch
  theme: paper
  layout:
    arrange: { row: { gap: 4mm, align: center, items: [src, mask, key] } }
nodes:
  - { id: src, component: box, label: In }
  - id: mask
    component: matrix
    props:
      rows: [S, { label: '$A_1$', tone: purple }]
      columns: [S, { label: '$A_1$', tone: purple }, P]
      cellWidth: 14pt
      gap: 1.5pt
      variant: filled
      classes:
        o: { tone: green, label: Allowed }
        x: { pattern: hatch, label: Masked }
        y: { pattern: hatch, tone: orange, variant: outlined, label: Linked }
      cells: [oxy, xoo]
  - id: key
    component: legend
    props:
      entries: [{ class: mask.o }, { class: mask.x }, { class: mask.y }]
edges:
  - { from: src, to: mask }
`;

async function render(source: string): Promise<RenderedFigure & { diagnostics: Diagnostic[] }> {
  const result = await renderFigure(source);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  return { ...result.value, diagnostics: result.diagnostics };
}

/** The `path.sumi-hatch` of every element, in drawing order, with its element's class. */
function svgHatches(svg: string): { element: string; stroke: string; segments: Segment[] }[] {
  return [
    ...svg.matchAll(
      /<g class="(sumi-k-[^ "]+)[^>]*>(?:(?!<g class="sumi-k-).)*?<path class="sumi-hatch" d="([^"]*)" fill="none" stroke="([^"]*)"/g,
    ),
  ].map((m) => ({
    element: m[1] as string,
    stroke: m[3] as string,
    segments: pairs(m[2] as string),
  }));
}

describe("hatch lines (#180)", async () => {
  const rendered = await render(SMALL);
  const { svg } = rendered;
  const hatches = svgHatches(svg);
  const segments = hatches.flatMap((h) => h.segments);

  test("the SVG hatches the cells and samples of hatched classes in their colors", () => {
    expect(rendered.diagnostics).toEqual([]);
    expect(hatches.map((h) => h.element)).toEqual([
      "sumi-k-n--mask-1-2",
      "sumi-k-n--mask-1-3",
      "sumi-k-n--mask-2-1",
      "sumi-k-n--key-2-box",
      "sumi-k-n--key-3-box",
    ]);
    // Gray's line color without a tone, the tone's with one (paper).
    expect(hatches.map((h) => h.stroke)).toEqual([
      "#6b6e78",
      "#bd5410",
      "#6b6e78",
      "#6b6e78",
      "#bd5410",
    ]);
    // Equal cells, equal hatching.
    const relative = (h: (typeof hatches)[number], rect: { x: number; y: number }) =>
      h.segments.map(([x1, y1, x2, y2]) => [x1 - rect.x, y1 - rect.y, x2 - rect.x, y2 - rect.y]);
    const layout = (rendered as { layout: LayoutIR }).layout;
    const rect = (id: string) => {
      const node = layout.nodes.find((n) => n.key === `n:${id}`);
      if (node === undefined) throw new Error(id);
      return node.rect;
    };
    expect(relative(hatches[0] as never, rect("mask-1-2"))).toEqual(
      relative(hatches[2] as never, rect("mask-2-1")).map((s) =>
        s.map((v) => expect.closeTo(v, 6)),
      ),
    );
  });

  test("the PDF draws the same segments", () => {
    const pdf = svgToPdf(svg);
    if (!pdf.ok) throw new Error(JSON.stringify(pdf.diagnostics));
    const parsed = parsePdf(pdf.value);
    const found: Segment[] = [];
    for (const object of parsed.objects.values()) {
      if (object.stream === undefined) continue;
      const text = new TextDecoder("latin1").decode(object.stream);
      // The SVG's coordinates under one `cm` per drawing (f32), each line an `m` and an `l`.
      for (const m of text.matchAll(
        /([-\d.]+) ([-\d.]+) m ([-\d.]+) ([-\d.]+) l(?= [-\d.]+ [-\d.]+ m|\s*S)/g,
      )) {
        found.push([Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])]);
      }
    }
    expectSame(diagonal(found), segments, 3);
  });

  test("the picture PPTX draws the same segments", () => {
    const pptx = svgToPptx(svg);
    if (!pptx.ok) throw new Error(JSON.stringify(pptx.diagnostics));
    const media = readPptx(pptx.value).get("ppt/media/figure.svg");
    const parsed = parseXml(new TextDecoder().decode(media));
    if (!parsed.ok) throw new Error(parsed.message);
    const found = [...descendants(parsed.root)]
      .filter((e) => e.name === "path" && attribute(e, "fill") === "none")
      .flatMap((e) => pairs(attribute(e, "d") ?? ""));
    expectSame(diagonal(found), segments, 3);
  });

  test("the editable PPTX draws them as a line shape over each hatched node", () => {
    const layout = (rendered as { layout: LayoutIR }).layout;
    for (const connectors of ["freeform", "glued"] as const) {
      const pptx = svgToEditablePptx(svg, rendered.compiled.ir, { connectors });
      if (!pptx.ok) throw new Error(JSON.stringify(pptx.diagnostics));
      const slide = parseXml(
        new TextDecoder().decode(readPptx(pptx.value).get("ppt/slides/slide1.xml")),
      );
      if (!slide.ok) throw new Error(slide.message);
      const shapes = [...descendants(slide.root)].filter((e) => e.name === "p:sp");
      const nameOf = (sp: (typeof shapes)[number]) =>
        [...descendants(sp)]
          .find((e) => e.name === "p:cNvPr")
          ?.attributes.find((a) => a.name === "name")?.value;
      const hatched = shapes.filter((sp) => nameOf(sp)?.endsWith(" hatch"));
      expect(hatched.map(nameOf)).toEqual(
        hatches.map((h) => `${h.element.replace("sumi-k-n--", "n:")} hatch`),
      );
      for (const [i, sp] of hatched.entries()) {
        const hatch = hatches[i] as (typeof hatches)[number];
        const key = hatch.element.replace("sumi-k-n--", "n:");
        const rect = layout.nodes.find((n) => n.key === key)?.rect;
        if (rect === undefined) throw new Error(key);
        const all = [...descendants(sp)];
        // No fill, a line in the hatch's color and width, round caps.
        expect(all.some((e) => e.name === "a:noFill")).toBe(true);
        const ln = all.find((e) => e.name === "a:ln");
        expect(ln && attribute(ln, "w")).toBe("6350");
        expect(ln && attribute(ln, "cap")).toBe("rnd");
        const color = all.find((e) => e.name === "a:srgbClr");
        expect(color && `#${attribute(color, "val")?.toLowerCase()}`).toBe(hatch.stroke);
        // Points relative to the node's box, in EMU (6350 per unit).
        const points = all
          .filter((e) => e.name === "a:pt")
          .map((e) => [Number(attribute(e, "x")) / 6350, Number(attribute(e, "y")) / 6350]);
        const found: Segment[] = [];
        for (let j = 0; j + 1 < points.length; j += 2) {
          const [a, b] = [points[j] as number[], points[j + 1] as number[]];
          found.push([
            (a[0] as number) + rect.x,
            (a[1] as number) + rect.y,
            (b[0] as number) + rect.x,
            (b[1] as number) + rect.y,
          ]);
        }
        expectSame(found, hatch.segments, 3);
      }
    }
  });
});

describe("H3-World (#180)", async () => {
  async function lint(
    file: string,
  ): Promise<{ rendered: RenderedFigure; diagnostics: Diagnostic[] }> {
    const path = join(ROOT, file);
    const report = await lintRenderedFigure(readFileSync(path, "utf8"), {
      file,
      assetBase: dirname(path),
    });
    if (report.rendered === undefined) throw new Error(JSON.stringify(report.diagnostics, null, 2));
    return { rendered: report.rendered, diagnostics: report.diagnostics };
  }
  const matrix = await lint("research/180-matrix/figures/c-h3world.sumi.yaml");
  const hand = await lint("research/177-outlined-tones/figures/c-h3world.sumi.yaml");

  test("no lint/empty-label, and otherwise the hand-written figure's diagnostics", () => {
    const codes = (diagnostics: Diagnostic[]) => diagnostics.map((d) => `${d.severity} ${d.code}`);
    expect(codes(matrix.diagnostics)).toEqual(
      codes(hand.diagnostics).filter((c) => c !== "warning lint/empty-label"),
    );
    // #177's 81 cells and the 9 tokens left of the LoRA (a tokens node here).
    expect(codes(hand.diagnostics).filter((c) => c === "warning lint/empty-label")).toHaveLength(
      90,
    );
  });

  test("the cells have the hand-written boxes' fills; masked cells are hatched", () => {
    const fill = (svg: string, id: string) => {
      const m = new RegExp(
        `class="sumi-k-n--${id} [^"]*"[^>]*><g class="shape"><rect [^>]*fill="([^"]*)"`,
      ).exec(svg);
      if (m === null) throw new Error(id);
      return m[1];
    };
    const hatched = new Set(svgHatches(matrix.rendered.svg).map((h) => h.element));
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const id = `mask-${r + 1}-${c + 1}`;
        const handFill = fill(hand.rendered.svg, `m-${r}-${c}`);
        // #177's masked cells are white boxes; here they are hatched.
        const masked = handFill === "#ffffff";
        expect([id, hatched.has(`sumi-k-n--${id}`)]).toEqual([id, masked]);
        if (!masked) expect([id, fill(matrix.rendered.svg, id)]).toEqual([id, handFill]);
      }
    }
    // The legend's sample of the masked class is hatched too.
    expect(hatched.has("sumi-k-n--mask-key-3-box")).toBe(true);
  });
});

test("compact density (#182) and a dimmed panel (#175) draw a matrix without diagnostics", async () => {
  const compact = SMALL.replace("  layout:\n", "  layout:\n    density: compact\n");
  expect((await render(compact)).diagnostics).toEqual([]);
  const dimmed = SMALL.replace(
    "arrange: { row: { gap: 4mm, align: center, items: [src, mask, key] } }",
    "arrange: { row: { gap: 4mm, align: center, items: [src, panel] } }",
  ).replace(
    "nodes:\n",
    "groups:\n  - { id: panel, dim: true, arrange: { row: { gap: 4mm, items: [mask, key] } } }\nnodes:\n",
  );
  const rendered = await render(dimmed);
  expect(rendered.diagnostics).toEqual([]);
  expect(new Set(svgHatches(rendered.svg).map((h) => h.stroke))).toEqual(new Set(["#949494"]));
});

test("a flush matrix touches its neighbors; text and ellipsis cells keep the grid (#280)", async () => {
  const source = (flush: boolean) => `version: 1
figure:
  id: flush
  theme: paper
  layout:
    arrange:
      grid:
        columns: 1
        rowGap: 0
        items:
          - heads
          - sim
nodes:
  - id: heads
    component: tokens
    props: { gap: 0, width: 30pt, height: 14pt, cells: ['$T_1$', '$T_2$', '…', '$T_N$'] }
  - id: sim
    component: matrix
    props:
      cellWidth: 30pt
      cellHeight: 20pt
      variant: outlined
      ${flush ? "flush: true" : "gap: 0"}
      classes:
        d: { tone: blue, variant: tinted }
        o: {}
      ellipsisColumns: [3]
      ellipsisRows: [3]
      cells:
        - [{ class: d, text: '$I_1\\cdot T_1$' }, { class: o, text: '$I_1\\cdot T_2$' }, o, { class: o, text: '$I_1\\cdot T_N$' }]
        - [{ class: o, text: '$I_2\\cdot T_1$' }, { class: d, text: '$I_2\\cdot T_2$' }, o, { class: o, text: '$I_2\\cdot T_N$' }]
        - [o, o, o, o]
        - [{ class: o, text: '$I_N\\cdot T_1$' }, { class: o, text: '$I_N\\cdot T_2$' }, o, { class: d, text: '$I_N\\cdot T_N$' }]
`;
  const rect = (r: RenderedFigure, key: string) => {
    const found = (r as { layout: LayoutIR }).layout.nodes.find((n) => n.key === key)?.rect;
    if (found === undefined) throw new Error(key);
    return found;
  };
  const flush = await render(source(true));
  expect(flush.diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
  const head = rect(flush, "n:heads-1");
  const first = rect(flush, "n:sim-1-1");
  expect(first.x).toBe(head.x);
  expect(first.y).toBeCloseTo(head.y + head.height, 6);
  // The ellipsis row and column keep the cell size, so the grid stays regular.
  const dots = rect(flush, "n:sim-3-3");
  const last = rect(flush, "n:sim-4-4");
  expect([dots.width, dots.height]).toEqual([first.width, first.height]);
  expect(last.x - dots.x).toBeCloseTo(dots.width, 6);
  expect(last.y - dots.y).toBeCloseTo(dots.height, 6);
  // Without flush the frame's padding separates them.
  const padded = await render(source(false));
  expect(rect(padded, "n:sim-1-1").y).toBeGreaterThan(rect(padded, "n:heads-1").y + head.height);
  // An ellipsis cell draws its symbol but no border or fill of its own.
  expect(flush.svg).toMatch(/sumi-k-n--sim-3-3[^>]*>(?:(?!<g class="sumi-k-).)*?⋱/s);
});
