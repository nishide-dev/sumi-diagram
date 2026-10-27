/**
 * `groups[].caption` (#130) in both engines: each caption is drawn centred
 * below its group's border, the geometry lint finds nothing, and the editable
 * PPTX keeps the caption where the SVG draws it. The structured fixture runs
 * without D2; the auto fixtures need it. The stage-B draft of figure 2 renders
 * with its two captions.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { createD2CliBackend } from "../backends/d2/backend";
import { checkD2Version, findD2Binary } from "../backends/d2/binary";
import type { Diagnostic } from "../core/diagnostics";
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

/** The captioned groups of both fixtures. */
const CAPTIONED = ["enc", "inner", "dec"];

const notInfo = (diagnostics: readonly Diagnostic[]) =>
  diagnostics.filter((d) => d.severity !== "info");

async function render(source: string, assetBase?: string): Promise<RenderedFigure> {
  const result = await renderFigure(source, {
    backend: createD2CliBackend(),
    ...(assetBase !== undefined && { assetBase }),
  });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  expect(notInfo(result.diagnostics)).toEqual([]);
  expect(lintGeometry(result.value, { source })).toEqual([]);
  return result.value;
}

/**
 * Checks every caption against its group's border: below it, at most
 * `maxGap` units away, and centred within `tolerance` units.
 */
function expectCaptionsBelow(rendered: RenderedFigure, maxGap: number, tolerance: number): void {
  const fonts = getFontSet(rendered.compiled.ir.meta.fontSetId);
  if (fonts === undefined) throw new Error("no font set");
  const { elements } = rendered.inspection;
  for (const id of CAPTIONED) {
    const bbox = elements.find((e) => e.key === `g:${id}`)?.bbox;
    const label = elements.find((e) => e.key === `n:${id}-caption`)?.labels[0];
    if (bbox === undefined || label === undefined) throw new Error(`no caption of ${id}`);
    const box = measureLabel(label, fonts).box as Rect;
    const gap = box.y - (bbox.y + bbox.height);
    expect(gap).toBeGreaterThan(0);
    expect(gap).toBeLessThanOrEqual(maxGap);
    const centre = box.x + box.width / 2 - (bbox.x + bbox.width / 2);
    expect(Math.abs(centre)).toBeLessThanOrEqual(tolerance);
  }
}

/** Checks that the editable PPTX text box of each caption is centred on the SVG's anchor. */
function expectPptxCaptions(rendered: RenderedFigure): void {
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
  for (const id of CAPTIONED) {
    const key = `n:${id}-caption`;
    const shape = shapes.find((s) =>
      [...descendants(s)].some((e) => e.name === "p:cNvPr" && attribute(e, "name") === key),
    );
    const find = (name: string) => shape && [...descendants(shape)].find((e) => e.name === name);
    const [body, off, ext] = [find("a:bodyPr"), find("a:off"), find("a:ext")];
    if (body === undefined || off === undefined || ext === undefined)
      throw new Error(`no text of ${key}`);
    // A text box without a drawn shape (not the D2 container around the group).
    expect(find("a:prstGeom") && attribute(find("a:prstGeom") as never, "prst")).toBe("rect");
    expect(find("a:noFill")).toBeDefined();
    const n = (e: typeof body, name: string) => Number(attribute(e, name));
    const left = n(off, "x") + n(body, "lIns");
    const right = n(off, "x") + n(ext, "cx") - n(body, "rIns");
    const top = n(off, "y") + n(body, "tIns");
    const label = rendered.inspection.elements.find((e) => e.key === key)?.labels[0];
    if (label === undefined) throw new Error(`no label of ${key}`);
    const measured = measureLabel(label, fonts);
    const firstLine = measured.lines[0] as Rect;
    expect(Math.abs((left + right) / 2 - (label.anchor.x - viewBox.x) * EMU)).toBeLessThanOrEqual(
      TOLERANCE,
    );
    expect(Math.abs(top - (firstLine.y - viewBox.y) * EMU)).toBeLessThanOrEqual(TOLERANCE);
    // The shape is the caption's own box, not the container around the group.
    expect(Math.abs(n(ext, "cy") - (measured.box as Rect).height * EMU)).toBeLessThanOrEqual(
      TOLERANCE,
    );
  }
}

const crosses = (points: readonly Point[], r: Rect) =>
  points.slice(1).some((q, i) => {
    const p = points[i] as Point;
    const x0 = Math.min(p.x, q.x);
    const x1 = Math.max(p.x, q.x);
    const y0 = Math.min(p.y, q.y);
    const y1 = Math.max(p.y, q.y);
    return x1 > r.x && x0 < r.x + r.width && y1 > r.y && y0 < r.y + r.height;
  });

describe("structured", () => {
  const source = readFileSync(join(FIXTURES, "figures/layout/group-caption.sumi.yaml"), "utf8");

  test("each caption is centred below its group, half the group padding away", async () => {
    const rendered = (await render(source)) as RenderedStructuredFigure;
    // The label's line box adds its half-leading to the 8-unit gap.
    expectCaptionsBelow(rendered, 12, 0.01);
    const { layout } = rendered;
    for (const id of CAPTIONED) {
      const group = layout.groups.find((g) => g.key === `g:${id}`)?.rect;
      const caption = layout.nodes.find((n) => n.key === `n:${id}-caption`)?.rect;
      if (group === undefined || caption === undefined) throw new Error(`no ${id}`);
      expect(caption.y - (group.y + group.height)).toBeCloseTo(8, 3);
      expect(caption.x + caption.width / 2).toBeCloseTo(group.x + group.width / 2, 3);
    }
    // The note attached below "enc" is below its caption.
    const note = layout.nodes.find((n) => n.key === "n:note")?.rect;
    const caption = layout.nodes.find((n) => n.key === "n:enc-caption")?.rect;
    if (note === undefined || caption === undefined) throw new Error("no note");
    // attach gap: 1mm = 72 / 25.4 pt, in 0.5pt units.
    expect(note.y).toBeCloseTo(caption.y + caption.height + (2 * 72) / 25.4, 2);
    expect(note.y).toBeGreaterThan(caption.y + caption.height);
  });

  test("in a row that stretches its items, the group takes the extra height above its caption", async () => {
    const figure = (caption: string) => `version: 1
figure:
  id: stretch
  theme: academic
  layout:
    arrange: { row: { gap: 6mm, align: stretch, items: [g, b] } }
groups:
  - { id: g, label: Group${caption}, arrange: { stack: { items: [a] } } }
nodes:
  - { id: a, component: box, label: A }
  - { id: b, component: box, label: "A tall\\nnode\\nof\\nseveral\\nlines\\nand\\nmore" }
`;
    const rectOf = (rendered: RenderedFigure, key: string) => {
      const { layout } = rendered as RenderedStructuredFigure;
      const rect = [...layout.groups, ...layout.nodes].find((e) => e.key === key)?.rect;
      if (rect === undefined) throw new Error(`no ${key}`);
      return rect;
    };
    const plain = await render(figure(""));
    const b = rectOf(plain, "n:b");
    // Without a caption the group is as tall as b.
    expect(rectOf(plain, "g:g")).toMatchObject({ y: b.y, height: b.height });
    const captioned = await render(figure(", caption: (a) one"));
    const b2 = rectOf(captioned, "n:b");
    const group = rectOf(captioned, "g:g");
    const caption = rectOf(captioned, "n:g-caption");
    // With one, the group starts at b's top and grows; its caption ends at b's bottom.
    expect(group.y).toBe(b2.y);
    expect(group.height).toBeGreaterThan(rectOf(plain, "n:a").height * 2);
    expect(caption.y - (group.y + group.height)).toBeCloseTo(8, 3);
    expect(caption.y + caption.height).toBeCloseTo(b2.y + b2.height, 3);
  });

  test("no route crosses a caption", async () => {
    const { layout } = (await render(source)) as RenderedStructuredFigure;
    for (const id of CAPTIONED) {
      const box = layout.nodes.find((n) => n.key === `n:${id}-caption`)?.label?.box;
      if (box === undefined) throw new Error(`no caption of ${id}`);
      for (const edge of layout.edges) {
        expect(crosses(edge.route?.points ?? [], box)).toBe(false);
      }
    }
  });

  test("a caption's title at the bottom stays inside the border, above the caption", async () => {
    const { layout } = (await render(source)) as RenderedStructuredFigure;
    const group = layout.groups.find((g) => g.key === "g:dec");
    const caption = layout.nodes.find((n) => n.key === "n:dec-caption")?.label?.box;
    if (group?.label === undefined || caption === undefined) throw new Error("no dec");
    expect(group.label.box.y + group.label.box.height).toBeLessThan(
      group.rect.y + group.rect.height,
    );
    expect(caption.y).toBeGreaterThan(group.rect.y + group.rect.height);
  });

  test("the editable PPTX keeps each caption where the SVG draws it", async () => {
    expectPptxCaptions(await render(source));
  });
});

describe.skipIf(!available)("auto (D2)", () => {
  const source = readFileSync(join(FIXTURES, "compile/group-caption.sumi.yaml"), "utf8");

  test("each caption is centred below its group; edges stay orthogonal", async () => {
    const rendered = await render(source);
    // In the container's padding (4mm, 23 units) below the border; D2 rounds
    // the container's and the label's positions to half units.
    expectCaptionsBelow(rendered, 23, 2.5);
    // With the caption outside the container (#124's outside-bottom-center),
    // D2 moves the contents but not the far ends of edges, which run askew.
    for (const element of rendered.inspection.elements) {
      let from: Point | undefined;
      for (const segment of element.path ?? []) {
        if (segment.command === "L" && from !== undefined) {
          expect(from.x === segment.to.x || from.y === segment.to.y).toBe(true);
        }
        from = segment.to;
      }
    }
  });

  test("the editable PPTX keeps each caption where the SVG draws it", async () => {
    expectPptxCaptions(await render(source));
  });

  test("an edge that leaves a captioned group downwards crosses the caption: reported at the caption", async () => {
    const text = `version: 1
figure: { id: down, theme: academic, layout: { direction: down } }
groups:
  - { id: enc, label: Encoder, caption: (a) the encoder }
nodes:
  - { id: a, component: box, label: Input, group: enc }
  - { id: c, component: box, label: Output }
edges:
  - { from: a, to: c }
`;
    const result = await renderFigure(text, { backend: createD2CliBackend() });
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const findings = lintGeometry(result.value, { source: text });
    expect(findings.map((d) => [d.code, d.path])).toEqual([
      ["geometry/edge-crosses-label", ["edges", 0]],
    ]);
    const [finding] = findings;
    expect(finding?.message).toBe('Edge edges[0] crosses the label of the caption of group "enc".');
    expect(finding?.hint).toContain("the auto layout does not route edges around it");
    expect(finding?.related?.[0]?.path).toEqual(["groups", 0, "caption"]);
    expect(finding?.related?.[0]?.location?.line).toBe(4);
  });
});

describe("the stage-B draft of figure 2 (research/124-stage-b)", () => {
  test("renders with a caption under each row; no geometry findings", async () => {
    const dir = join(ROOT, "research/124-stage-b/figures");
    const draft = parse(readFileSync(join(dir, "training-pipeline.sumi.yaml"), "utf8"));
    // Not part of #130: the version gate (this build may be older than the
    // draft's >=0.5.0), the legend (#131), and the "batch" label's
    // labelSide, which puts it where another line runs (a
    // layout/edge-label-overlap warning, design doc §6.30).
    delete draft.requires;
    for (const edge of draft.edges) delete edge.labelSide;
    draft.nodes = draft.nodes.filter((n: { component: string }) => n.component !== "legend");
    const row = draft.figure.layout.arrange.stack.items[1].row;
    row.items = row.items.filter((item: string) => item !== "key");
    expect(draft.groups.map((g: { caption?: string }) => g.caption)).toEqual([
      "(a) data and augmentation",
      "(b) one optimisation step",
    ]);
    const rendered = await render(stringify(draft), dir);
    for (const [id, text] of [
      ["data-stage", "(a) data and augmentation"],
      ["train-step", "(b) one optimisation step"],
    ] as const) {
      const group = rendered.inspection.elements.find((e) => e.key === `g:${id}`)?.bbox;
      const label = rendered.inspection.elements.find((e) => e.key === `n:${id}-caption`)
        ?.labels[0];
      if (group === undefined || label === undefined) throw new Error(`no caption of ${id}`);
      expect(label.text).toBe(text);
      expect(label.anchor.y).toBeGreaterThan(group.y + group.height);
      expect(label.anchor.x).toBeCloseTo(group.x + group.width / 2, 2);
    }
  });
});
