/**
 * `nodes[].sublabel` (#184, design doc §6.51) end to end in the structured
 * engine (no D2 needed): DiT's Noise, Σ and Noised Latent with their sizes
 * as a smaller second line. The layout stacks the sublabel under the label,
 * the SVG draws it as a second `<text>` at its own size, the inspection and
 * the geometry lint read each size, the PDF keeps it as text, and the
 * editable PPTX writes it as paragraphs in a smaller `sz`.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compileFigure } from "../compiler/compile";
import { getFontSet } from "../core/theme/fonts";
import { lintGeometry } from "../lint/geometry";
import { measureLabel } from "../lint/geometry/measure";
import type { Rect } from "./geometry";
import { svgToPdf } from "./pdf";
import { inspectPdf, textLines } from "./pdf/testing";
import { svgToEditablePptx, svgToPptx } from "./pptx";
import { readPptx } from "./pptx/testing";
import { type RenderedStructuredFigure, renderFigure } from "./render";
import { attribute, descendants, parseXml, type XmlElement } from "./xml";

const ROOT = join(import.meta.dir, "..", "..");
const source = readFileSync(join(ROOT, "tests/fixtures/figures/sublabel/b-dit.sumi.yaml"), "utf8");
const research = readFileSync(join(ROOT, "research/167-stage-c/figures/b-dit.sumi.yaml"), "utf8");

const fonts = getFontSet("sumi/biz-ud-gothic");
if (fonts === undefined) throw new Error("bundled font set is missing");

/** Renders a figure that must render without diagnostics of its own. */
async function render(text: string): Promise<RenderedStructuredFigure> {
  const result = await renderFigure(text);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  expect(result.diagnostics).toEqual([]);
  if (result.value.compiled.engine !== "structured") throw new Error("not structured");
  return result.value as RenderedStructuredFigure;
}

const inside = (inner: Rect, outer: Rect, slack = 1e-3) =>
  inner.x >= outer.x - slack &&
  inner.y >= outer.y - slack &&
  inner.x + inner.width <= outer.x + outer.width + slack &&
  inner.y + inner.height <= outer.y + outer.height + slack;

/** DiT's three nodes with a size under their name. */
const SUBLABELED = {
  "n:noised": ["Noised\nLatent", "32 × 32 × 4"],
  "n:noise": ["Noise", "32 × 32 × 4"],
  "n:sigma": ["Σ", "32 × 32 × 4"],
} as const;

const textOf = (element: XmlElement) =>
  [...descendants(element)]
    .filter((e) => e.name === "a:t")
    .map((e) => e.children.map((c) => (c.type === "text" ? c.text : "")).join(""))
    .join("");

/**
 * A node's text rows in the editable PPTX: its own text body, then a
 * sublabel's text box if it has one (`joined` is false then), each row with
 * its size and its top in SVG units (the box's top inset plus the spacings
 * above it).
 */
function pptxRows(
  rendered: RenderedStructuredFigure,
  key: string,
): { rows: { text: string; sz: string; top: number }[]; joined: boolean } {
  const editable = svgToEditablePptx(rendered.svg, rendered.compiled.ir);
  if (!editable.ok) throw new Error(JSON.stringify(editable.diagnostics));
  const xml = new TextDecoder().decode(readPptx(editable.value).get("ppt/slides/slide1.xml"));
  const parsed = parseXml(xml);
  if (!parsed.ok) throw new Error(parsed.message);
  const shapes = [...descendants(parsed.root)].filter((e) => e.name === "p:sp");
  const named = (name: string) =>
    shapes.find((s) =>
      [...descendants(s)].some((e) => e.name === "p:cNvPr" && attribute(e, "name") === name),
    );
  const EMU = 6350;
  const { viewBox } = rendered.inspection.canvas;
  // The slide may center a small figure: its offset is the node shape's
  // position less the inspected box's.
  const node = named(key);
  if (node === undefined) throw new Error(`no shape of ${key}`);
  const nodeOff = [...descendants(node)].find((e) => e.name === "a:off") as XmlElement;
  const bbox = rendered.inspection.elements.find((e) => e.key === key)?.bbox;
  if (bbox === undefined) throw new Error(`no box of ${key}`);
  const dy = Number(attribute(nodeOff, "y")) / EMU - (bbox.y - viewBox.y);
  const rowsOf = (shape: XmlElement) => {
    const body = [...descendants(shape)].find((e) => e.name === "a:bodyPr") as XmlElement;
    const off = [...descendants(shape)].find((e) => e.name === "a:off") as XmlElement;
    let top =
      Number(attribute(off, "y")) / EMU - dy + viewBox.y + Number(attribute(body, "tIns")) / EMU;
    return [...descendants(shape)]
      .filter((e) => e.name === "a:p")
      .map((p) => {
        const all = [...descendants(p)];
        const sizes = all.filter((e) => e.name === "a:rPr").map((e) => attribute(e, "sz"));
        const [spacing = 0, before = 0] = all
          .filter((e) => e.name === "a:spcPts")
          .map((e) => Number(attribute(e, "val")) / 50);
        top += before;
        const row = { text: textOf(p), sz: [...new Set(sizes)].join(","), top };
        top += spacing;
        return row;
      });
  };
  const own = named(`${key} sublabel`);
  return { rows: [...rowsOf(node), ...(own ? rowsOf(own) : [])], joined: own === undefined };
}

describe("sublabel (#184): DiT", () => {
  test("renders with the research figure's findings (width and sparse panel)", async () => {
    const rendered = await render(source);
    const codes = (r: RenderedStructuredFigure, text: string) =>
      lintGeometry(r, { source: text }).map((d) => d.code);
    expect(codes(rendered, source)).toEqual([
      "geometry/exceeds-page-width",
      "geometry/group-empty-area",
    ]);
    expect(codes(await render(research), research)).toEqual([
      "geometry/exceeds-page-width",
      "geometry/group-empty-area",
    ]);
  });

  test("each node draws its label and a smaller sublabel <text> under it", async () => {
    const rendered = await render(source);
    for (const [key, [label, sublabel]] of Object.entries(SUBLABELED)) {
      const element = rendered.inspection.elements.find((e) => e.key === key);
      const placed = rendered.layout.nodes.find((n) => n.key === key);
      if (element === undefined || placed?.label === undefined || placed.sublabel === undefined)
        throw new Error(`no ${key}`);
      // Per-text sizes as inspected: 8pt (16 units) over 7pt (14 units).
      expect(element.labels.map((l) => [l.text, l.fontSizeUnits])).toEqual([
        [label, 16],
        [sublabel, 14],
      ]);
      expect(placed.sublabel.fontSizeUnits).toBe(14);
      // Stacked without a gap, centered on one x.
      const { box: lb } = placed.label;
      const { box: sb } = placed.sublabel;
      expect(sb.y).toBeCloseTo(lb.y + lb.height, 3);
      expect(sb.x + sb.width / 2).toBeCloseTo(lb.x + lb.width / 2, 3);
      // Re-measured: every sublabel line below every label line, all in the node.
      const [ml, ms] = element.labels.map((l) => measureLabel(l, fonts));
      const labelBottom = Math.max(...(ml?.visibleLines ?? []).map((r) => r.y + r.height));
      for (const line of ms?.visibleLines ?? []) {
        expect(line.y).toBeGreaterThanOrEqual(labelBottom - 1e-6);
        expect(inside(line, placed.rect)).toBe(true);
        expect(inside(line, sb)).toBe(true);
      }
    }
    // Nodes without a sublabel have one <text>.
    const patchify = rendered.inspection.elements.find((e) => e.key === "n:patchify");
    expect(patchify?.labels).toHaveLength(1);
  });

  test("the node is sized around the label and the sublabel", async () => {
    const figure = (sublabel: string) => `version: 1
figure: { id: f, theme: color, layout: { arrange: { stack: { items: [noise] } } } }
nodes:
  - { id: noise, component: box, label: Noise${sublabel} }
`;
    const plain = (await render(figure(""))).layout.nodes[0];
    const both = (await render(figure(', sublabel: "32 × 32 × 4 latent"'))).layout.nodes[0];
    if (plain === undefined || both?.label === undefined || both.sublabel === undefined)
      throw new Error("no node");
    // As tall as the label alone plus the sublabel's lines; as wide as the wider.
    // (node sizes are whole units)
    const taller = both.rect.height - plain.rect.height;
    expect(taller).toBeGreaterThanOrEqual(both.sublabel.box.height);
    expect(taller).toBeLessThan(both.sublabel.box.height + 1);
    expect(both.sublabel.fontSizeUnits).toBe(14);
    expect(both.rect.width - plain.rect.width).toBeCloseTo(
      both.sublabel.box.width - both.label.box.width,
      0,
    );
  });

  test("the PDF keeps the sublabel as text at 7pt", async () => {
    const rendered = await render(source);
    const pdf = svgToPdf(rendered.svg, { fontSet: fonts });
    if (!pdf.ok) throw new Error(JSON.stringify(pdf.diagnostics));
    const inspected = inspectPdf(pdf.value);
    expect(inspected.images).toBe(0);
    const lines = textLines(inspected.glyphs).map((l) => [l.text, l.size]);
    const sizes = lines.filter(([text]) => text === "32 × 32 × 4").map(([, size]) => size);
    expect(sizes).toHaveLength(3);
    for (const size of sizes) expect(size).toBeCloseTo(7, 3);
    const noise = lines.find(([text]) => text === "Noise");
    expect(noise?.[1]).toBeCloseTo(8, 3);
  });

  test("the editable PPTX writes the sublabel as smaller paragraphs in the node's text", async () => {
    const rendered = await render(source);
    expect(svgToPptx(rendered.svg, { fontSet: fonts }).ok).toBe(true);
    for (const [key, [label, sublabel]] of Object.entries(SUBLABELED)) {
      const { rows, joined } = pptxRows(rendered, key);
      // The label's lines at 8pt, the sublabel's at 7pt: in the node's text
      // under a one-line label, in a box of its own under two lines (it
      // starts 1/8pt higher than the label's line spacing reaches).
      expect(joined).toBe(key !== "n:noised");
      expect(rows.map((r) => [r.text, r.sz])).toEqual([
        ...label.split("\n").map((line) => [line, "800"]),
        [sublabel, "700"],
      ]);
    }
  });

  // Each PPTX line's top (a text box's top inset plus the spacing above the
  // line) is where the SVG draws it, whether the sublabel joins the node's
  // text or, where that would need negative spacing, gets a box of its own.
  test.each([
    ["color", "Noise", "32 × 32 × 4"],
    ["color", "Noised\\nLatent", "32 × 32 × 4"],
    ["slides", "Noise", "32 × 32 × 4"],
    ["slides", "Two\\nlines", "a\\n$x_i$"],
    ["academic", "Σ", "$x_t^2$\\nsize"],
    ["minimal", "Encoder", "frozen\\n$W_q$, $W_k$"],
  ])(
    "the editable PPTX puts every line where the SVG does (%s, %j / %j)",
    async (theme, label, sublabel) => {
      const text = `version: 1
figure: { id: f, theme: ${theme}, layout: { arrange: { stack: { items: [a] } } } }
nodes:
  - { id: a, component: box, label: "${label}", sublabel: "${sublabel}" }
`;
      const rendered = await render(text);
      const { rows } = pptxRows(rendered, "n:a");
      const element = rendered.inspection.elements.find((e) => e.key === "n:a");
      // In the SVG: each text's first line's top, then its baselines, which
      // advance by its line height (a later line's own top depends on its
      // runs: math and scripts reach higher or lower, while PowerPoint's
      // exact line spacing, like the SVG, keeps the baselines evenly spaced).
      const want = (element?.labels ?? []).flatMap((l) => {
        const first = measureLabel(l, fonts).lines[0]?.y as number;
        return measureLabel(l, fonts).lines.map((_, k) => first + k * l.lineHeightUnits);
      });
      expect(rows).toHaveLength(want.length);
      // Within the rounding of spacing to 1/100 pt (0.02 units) and of EMU.
      for (const [i, y] of want.entries()) {
        expect(Math.abs((rows[i]?.top as number) - y)).toBeLessThan(0.015);
      }
    },
  );

  test("with labelRotation the block turns as a whole", async () => {
    const turned = `version: 1
figure: { id: f, theme: academic, layout: { arrange: { row: { gap: 6mm, items: [a, b, c] } } } }
nodes:
  - { id: a, component: box, label: Visual VAE Encoder, sublabel: frozen, labelRotation: -90 }
  - { id: b, component: box, label: "Two\\nlines", sublabel: "and\\ntwo", labelRotation: 90 }
  - { id: c, component: label, label: Query, sublabel: "$d_k = 64$", labelRotation: -90 }
`;
    const rendered = await render(turned);
    expect(lintGeometry(rendered, { source: turned })).toEqual([]);
    for (const [key, degrees] of [
      ["n:a", -90],
      ["n:b", 90],
      ["n:c", -90],
    ] as const) {
      const placed = rendered.layout.nodes.find((n) => n.key === key);
      const element = rendered.inspection.elements.find((e) => e.key === key);
      if (placed?.label === undefined || placed.sublabel === undefined || element === undefined)
        throw new Error(`no ${key}`);
      expect(element.labels.map((l) => l.rotation?.degrees)).toEqual([degrees, degrees]);
      const { box: lb } = placed.label;
      const { box: sb } = placed.sublabel;
      // -90 reads bottom to top: the label is left of the sublabel; 90 right.
      if (degrees === -90) expect(sb.x).toBeCloseTo(lb.x + lb.width, 3);
      else expect(lb.x).toBeCloseTo(sb.x + sb.width, 3);
      expect(sb.y + sb.height / 2).toBeCloseTo(lb.y + lb.height / 2, 3);
      for (const label of element.labels) {
        for (const line of measureLabel(label, fonts).visibleLines)
          expect(inside(line, placed.rect)).toBe(true);
      }
    }
    // The editable PPTX turns each text box about its own center.
    const editable = svgToEditablePptx(rendered.svg, rendered.compiled.ir);
    if (!editable.ok) throw new Error(JSON.stringify(editable.diagnostics));
    const xml = new TextDecoder().decode(readPptx(editable.value).get("ppt/slides/slide1.xml"));
    expect(xml).toContain('name="n:a label"');
    expect(xml).toContain('name="n:a sublabel"');
    expect([...xml.matchAll(/rot="(\d+)"/g)].map((m) => m[1])).toEqual([
      "16200000",
      "16200000",
      "5400000",
      "5400000",
      "16200000",
      "16200000",
    ]);
  });

  test("text-too-small reads the sublabel's own size in a figure shrunk by fit", async () => {
    const text = source.replace(
      "  profile: paper-double\n",
      "  profile: paper-double\n  fit: scale\n",
    );
    const rendered = await render(text);
    const small = lintGeometry(rendered, { source: text }).filter(
      (d) => d.code === "geometry/text-too-small",
    );
    const sublabels = small.filter((d) => d.path?.at(-1) === "sublabel");
    expect(sublabels.map((d) => d.subject?.id).sort()).toEqual(["noise", "noised", "sigma"]);
    // 7pt shrunk to about 71%: below the 5pt minimum for scaled figures.
    expect(sublabels[0]?.message).toMatch(
      /^The sublabel of node "\w+" is printed at 4\.9\d*pt \(7pt shrunk to 7\d(\.\d)?% by figure\.fit: scale\), below the 5pt minimum font size of profile "paper-double" for a scaled figure\.$/,
    );
    // The 8pt labels of the same nodes print above it.
    expect(small.filter((d) => d.path?.at(-1) === "label").map((d) => d.subject?.id)).not.toContain(
      "noise",
    );
  });

  test("the auto engine refuses it (layout/structured-only)", () => {
    const auto = `version: 1
figure: { id: f }
nodes:
  - { id: noise, component: box, label: Noise, sublabel: "32 × 32 × 4" }
`;
    const compiled = compileFigure(auto);
    expect(compiled.ok).toBe(false);
    expect(compiled.diagnostics.map((d) => [d.code, d.path])).toEqual([
      ["layout/structured-only", ["nodes", 0, "sublabel"]],
    ]);
  });
});
