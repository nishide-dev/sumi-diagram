/**
 * `groups[].labelAt` (#127) in both engines: the inspected (re-measured)
 * title of each group lies inside the group's border at the requested
 * position, and the geometry lint finds nothing. The structured fixture runs
 * without D2; the auto fixture and the stage-B draft of figure 1 need it.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { createD2CliBackend } from "../backends/d2/backend";
import { checkD2Version, findD2Binary } from "../backends/d2/binary";
import { GROUP_LABEL_POSITIONS, type GroupLabelPosition } from "../core/figure/schema";
import { getFontSet } from "../core/theme/fonts";
import { lintGeometry } from "../lint/geometry";
import { measureLabel } from "../lint/geometry/measure";
import type { Point, Rect } from "./geometry";
import { svgToEditablePptx } from "./pptx";
import { readPptx } from "./pptx/testing";
import { type RenderedFigure, type RenderedStructuredFigure, renderFigure } from "./render";
import { attribute, descendants, parseXml } from "./xml";

const ROOT = join(import.meta.dir, "..", "..");
const FIXTURES = join(ROOT, "tests", "fixtures");

const binary = findD2Binary();
const available = binary.ok && (await checkD2Version(binary.value.path)).ok;

/** Group ID → labelAt in both fixtures. */
const GROUPS: Readonly<Record<string, GroupLabelPosition>> = {
  tl: "top-left",
  tc: "top",
  tr: "top-right",
  bl: "bottom-left",
  bc: "bottom",
  br: "bottom-right",
};

async function render(source: string): Promise<RenderedFigure> {
  const result = await renderFigure(source, { backend: createD2CliBackend() });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  expect(result.diagnostics).toEqual([]);
  expect(lintGeometry(result.value, { source })).toEqual([]);
  return result.value;
}

/** Checks every group's title box against its border, by its `labelAt`. */
function expectTitlesAt(rendered: RenderedFigure): void {
  const fonts = getFontSet(rendered.compiled.ir.meta.fontSetId);
  if (fonts === undefined) throw new Error("no font set");
  const seen = new Set<GroupLabelPosition>();
  for (const [id, at] of Object.entries(GROUPS)) {
    const group = rendered.inspection.elements.find((e) => e.key === `g:${id}`);
    const bbox = group?.bbox;
    const label = group?.labels[0];
    if (bbox === undefined || label === undefined) throw new Error(`no group ${id}`);
    const box = measureLabel(label, fonts).box as Rect;
    // Inside the border.
    expect(box.x).toBeGreaterThan(bbox.x);
    expect(box.y).toBeGreaterThan(bbox.y);
    expect(box.x + box.width).toBeLessThan(bbox.x + bbox.width);
    expect(box.y + box.height).toBeLessThan(bbox.y + bbox.height);
    // The requested edge: the title is in the top or bottom third of the group.
    const cy = box.y + box.height / 2;
    if (at.startsWith("top")) expect(cy).toBeLessThan(bbox.y + bbox.height / 3);
    else expect(cy).toBeGreaterThan(bbox.y + (2 * bbox.height) / 3);
    // The requested side: closer to the left or right border, or centred.
    const left = box.x - bbox.x;
    const right = bbox.x + bbox.width - (box.x + box.width);
    if (at.endsWith("-left")) expect(left).toBeLessThan(right / 2);
    else if (at.endsWith("-right")) expect(right).toBeLessThan(left / 2);
    else expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
    seen.add(at);
  }
  expect([...seen].sort()).toEqual([...GROUP_LABEL_POSITIONS].sort());
}

describe("structured", () => {
  const source = readFileSync(join(FIXTURES, "figures/layout/group-label-at.sumi.yaml"), "utf8");

  test("each title sits inside its group at labelAt; no geometry findings", async () => {
    expectTitlesAt(await render(source));
  });

  test("the router goes around a moved title in the straight path of an edge", async () => {
    // a → out: straight down from a would cross the bottom title of g1.
    // top → c: straight down into c would cross the top-right title of g2.
    const rendered = await render(`version: 1
figure:
  id: around
  theme: academic
  layout:
    arrange:
      row:
        gap: 8mm
        align: start
        items:
          - stack: { gap: 6mm, items: [g1, out] }
          - stack: { gap: 6mm, align: end, items: [top, g2] }
groups:
  - { id: g1, label: Bottom title, labelAt: bottom, arrange: { stack: { items: [a] } } }
  - { id: g2, label: Top right title, labelAt: top-right, arrange: { row: { items: [b, c] } } }
nodes:
  - { id: a, component: box, label: Inner }
  - { id: out, component: box, label: Output }
  - { id: top, component: box, label: Top }
  - { id: b, component: box, label: Left }
  - { id: c, component: box, label: Right }
edges:
  - { from: a, to: out }
  - { from: top, to: c }
`);
    if (rendered.compiled.engine !== "structured") throw new Error("not structured");
    const { layout } = rendered as RenderedStructuredFigure;
    const crosses = (points: readonly Point[], r: Rect) =>
      points.slice(1).some((q, i) => {
        const p = points[i] as Point;
        const x0 = Math.min(p.x, q.x);
        const x1 = Math.max(p.x, q.x);
        const y0 = Math.min(p.y, q.y);
        const y1 = Math.max(p.y, q.y);
        return x1 > r.x && x0 < r.x + r.width && y1 > r.y && y0 < r.y + r.height;
      });
    for (const [edge, group, end] of [
      ["e:#0", "g:g1", "n:a"],
      ["e:#1", "g:g2", "n:c"],
    ] as const) {
      const title = layout.groups.find((g) => g.key === group)?.label?.box;
      const node = layout.nodes.find((n) => n.key === end)?.rect;
      const route = layout.edges.find((e) => e.key === edge)?.route;
      if (title === undefined || node === undefined || route === undefined)
        throw new Error(`no ${edge}`);
      // The node's vertical centre line runs through the title: a straight edge would cross it.
      const cx = node.x + node.width / 2;
      expect(cx).toBeGreaterThan(title.x);
      expect(cx).toBeLessThan(title.x + title.width);
      expect(crosses(route.points, title)).toBe(false);
    }
  });

  test("omitted labelAt and labelAt: top give the same SVG", async () => {
    const one = (labelAt: string) =>
      render(`version: 1
figure: { id: t, theme: academic, layout: { arrange: { stack: { items: [g] } } } }
groups:
  - { id: g, label: Group${labelAt}, arrange: { stack: { items: [a] } } }
nodes:
  - { id: a, component: box, label: A wide content node }
`);
    // The input differs (and with it its hash in the metadata); the drawing does not.
    const drawing = (svg: string) => svg.replace(/ input-sha256="[0-9a-f]+"/, "");
    expect(drawing((await one(", labelAt: top")).svg)).toBe(drawing((await one("")).svg));
  });

  test("the editable PPTX keeps the title where the SVG draws it", async () => {
    const rendered = await render(source);
    const pptx = svgToEditablePptx(rendered.svg, rendered.compiled.ir);
    if (!pptx.ok) throw new Error(JSON.stringify(pptx.diagnostics));
    const xml = new TextDecoder().decode(readPptx(pptx.value).get("ppt/slides/slide1.xml"));
    const parsed = parseXml(xml);
    if (!parsed.ok) throw new Error(parsed.message);
    const shapes = [...descendants(parsed.root)].filter((e) => e.name === "p:sp");
    const fonts = getFontSet(rendered.compiled.ir.meta.fontSetId);
    if (fonts === undefined) throw new Error("no font set");
    const { viewBox } = rendered.inspection.canvas;
    // One D2 unit is 0.5pt = 6350 EMU; the PPTX rounds each value to whole EMU.
    const EMU = 6350;
    const TOLERANCE = 2;
    for (const id of Object.keys(GROUPS)) {
      const shape = shapes.find((s) =>
        [...descendants(s)].some((e) => e.name === "p:cNvPr" && attribute(e, "name") === `g:${id}`),
      );
      const find = (name: string) => shape && [...descendants(shape)].find((e) => e.name === name);
      const [body, off, ext] = [find("a:bodyPr"), find("a:off"), find("a:ext")];
      if (body === undefined || off === undefined || ext === undefined)
        throw new Error(`no text of g:${id}`);
      const n = (e: typeof body, name: string) => Number(attribute(e, name));
      // The text area: the shape's extent less the insets. Its paragraphs are
      // centred and start at the top inset.
      const left = n(off, "x") + n(body, "lIns");
      const right = n(off, "x") + n(ext, "cx") - n(body, "rIns");
      const top = n(off, "y") + n(body, "tIns");
      // The SVG as inspected: the anchor (horizontal centre) and the first line's top.
      const group = rendered.inspection.elements.find((e) => e.key === `g:${id}`);
      const label = group?.labels[0];
      if (label === undefined) throw new Error(`no label of g:${id}`);
      const firstLine = measureLabel(label, fonts).lines[0] as Rect;
      expect(Math.abs((left + right) / 2 - (label.anchor.x - viewBox.x) * EMU)).toBeLessThanOrEqual(
        TOLERANCE,
      );
      expect(Math.abs(top - (firstLine.y - viewBox.y) * EMU)).toBeLessThanOrEqual(TOLERANCE);
    }
  });
});

describe.skipIf(!available)("auto (D2)", () => {
  test("each title sits inside its group at labelAt; no geometry findings", async () => {
    const source = readFileSync(join(FIXTURES, "compile/group-label-at.sumi.yaml"), "utf8");
    expectTitlesAt(await render(source));
  });
});

describe("the stage-B draft of figure 1 (research/124-stage-b)", () => {
  test("with its group titles at top-left, it renders without diagnostics", async () => {
    const draft = parse(
      readFileSync(join(ROOT, "research/124-stage-b/figures/seq2seq-attention.sumi.yaml"), "utf8"),
    );
    // Not part of #127: the version gate (this build may be older than the
    // draft's >=0.5.0) and edges[].labelAt (#128).
    delete draft.requires;
    for (const edge of draft.edges) delete edge.labelAt;
    expect(draft.groups.map((g: { labelAt?: string }) => g.labelAt)).toEqual([
      "top-left",
      "top-left",
    ]);
    const rendered = await render(stringify(draft));
    for (const id of ["encoder", "decoder"]) {
      const group = rendered.inspection.elements.find((e) => e.key === `g:${id}`);
      expect(group?.labels[0]?.text).toBe(id === "encoder" ? "Encoder" : "Decoder");
    }
  });
});
