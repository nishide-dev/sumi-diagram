/**
 * `nodes[].labelRotation` (#178) end to end in the structured engine (no D2
 * needed): the layout sizes nodes around the turned label, the SVG writes
 * `rotate(±90 cx cy)` on the `<text>`, the inspection reads it back, the
 * geometry lint checks the turned box, the PDF keeps the text as text, and
 * both PPTX modes carry it.
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
import { inspectPdf } from "./pdf/testing";
import { svgToEditablePptx, svgToPptx } from "./pptx";
import { readPptx } from "./pptx/testing";
import { type RenderedStructuredFigure, renderFigure } from "./render";
import { attribute, descendants, parseXml } from "./xml";

const ROOT = join(import.meta.dir, "..", "..");
const source = readFileSync(
  join(ROOT, "tests/fixtures/figures/layout/label-rotation.sumi.yaml"),
  "utf8",
);

async function render(text: string): Promise<RenderedStructuredFigure> {
  const result = await renderFigure(text);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  expect(result.diagnostics).toEqual([]);
  if (result.value.compiled.engine !== "structured") throw new Error("not structured");
  return result.value as RenderedStructuredFigure;
}

const TURNED = { "n:query": -90, "n:vae": -90, "n:b": 90, "n:c": 90 } as const;

const fonts = getFontSet("sumi/biz-ud-gothic");
if (fonts === undefined) throw new Error("bundled font set is missing");

const inside = (inner: Rect, outer: Rect, slack = 1e-6) =>
  inner.x >= outer.x - slack &&
  inner.y >= outer.y - slack &&
  inner.x + inner.width <= outer.x + outer.width + slack &&
  inner.y + inner.height <= outer.y + outer.height + slack;

describe("labelRotation (#178)", () => {
  test("renders without findings; the SVG turns exactly the turned labels", async () => {
    const rendered = await render(source);
    expect(lintGeometry(rendered, { source })).toEqual([]);
    const transforms = [...rendered.svg.matchAll(/<text [^>]*transform="([^"]*)"/g)].map(
      (m) => m[1],
    );
    expect(transforms).toHaveLength(4);
    for (const t of transforms) expect(t).toMatch(/^rotate\((-90|90) [\d.]+ [\d.]+\)$/);
  });

  test("the inspection reads each turned label, and its turned box is the layout's", async () => {
    const rendered = await render(source);
    for (const [key, degrees] of Object.entries(TURNED)) {
      const element = rendered.inspection.elements.find((e) => e.key === key);
      const placed = rendered.layout.nodes.find((n) => n.key === key);
      const label = element?.labels[0];
      if (label === undefined || placed?.label === undefined) throw new Error(`no ${key}`);
      expect(label.rotation?.degrees).toBe(degrees);
      expect(placed.label.rotation).toBe(degrees);
      const box = placed.label.box;
      // Turned about the center of the layout's (turned) box.
      expect(label.rotation?.center.x).toBeCloseTo(box.x + box.width / 2, 3);
      expect(label.rotation?.center.y).toBeCloseTo(box.y + box.height / 2, 3);
      // The re-measured lines lie in the layout's box, which is taller than wide.
      const measured = measureLabel(label, fonts);
      for (const line of measured.visibleLines) expect(inside(line, box, 1e-3)).toBe(true);
      // ... and inside the node (a label node has no shape: its rect is the box).
      expect(inside(measured.box as Rect, placed.rect, 1e-3)).toBe(true);
    }
    // One line of text, turned: tall and narrow.
    const query = rendered.layout.nodes.find((n) => n.key === "n:query");
    expect(query?.rect.height).toBeGreaterThan(2 * (query?.rect.width ?? 0));
  });

  test("a node is sized around its turned label", async () => {
    const upright = await render(source.replaceAll(/, labelRotation: -?90/g, ""));
    const turned = await render(source);
    const size = (r: RenderedStructuredFigure, key: string) => {
      const rect = r.layout.nodes.find((n) => n.key === key)?.rect;
      if (rect === undefined) throw new Error(`no ${key}`);
      return rect;
    };
    // A label node takes its text's box exactly (whole units): swapped.
    const q0 = size(upright, "n:query");
    const q1 = size(turned, "n:query");
    expect([q1.width, q1.height]).toEqual([q0.height, q0.width]);
    // A box adds the same padding around the turned label: narrower, taller.
    const b0 = size(upright, "n:b");
    const b1 = size(turned, "n:b");
    expect(b1.width).toBeLessThan(b0.width);
    expect(b1.height).toBeGreaterThan(b0.height);
    // An upright figure's SVG has no transform.
    expect(upright.svg).not.toContain("transform=");
  });

  test("label-overflow checks the turned box", async () => {
    // Wide enough for the label upright, too low for it turned.
    const figure = (rotation: string) => `version: 1
figure: { id: f, theme: academic, layout: { arrange: { stack: { items: [vae] } } } }
nodes:
  - { id: vae, component: box, label: Visual VAE Encoder${rotation}, props: { width: 100pt, height: 20pt } }
`;
    const findings = async (text: string) => {
      const result = await renderFigure(text);
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
      return lintGeometry(result.value, { source: text }).map((d) => [d.code, d.subject?.id]);
    };
    expect(await findings(figure(""))).toEqual([]);
    expect(await findings(figure(", labelRotation: -90"))).toEqual([
      ["geometry/label-overflow", "vae"],
    ]);
  });

  test("the PDF keeps turned labels as extractable text in embedded TrueType fonts", async () => {
    const rendered = await render(source);
    const pdf = svgToPdf(rendered.svg, { fontSet: fonts });
    if (!pdf.ok) throw new Error(JSON.stringify(pdf.diagnostics));
    const inspected = inspectPdf(pdf.value);
    expect(inspected.images).toBe(0);
    for (const font of inspected.fonts) {
      expect(font).toMatchObject({ subtype: "CIDFontType2", embedded: true });
    }
    const text = inspected.glyphs.map((g) => g.text).join("");
    for (const word of ["Query", "VisualVAEEncoder", "Two", "lines", "Output"]) {
      expect(text.replaceAll(" ", "")).toContain(word);
    }
    // "Query" runs up the page (-90°): one x, rising y (PDF y points up).
    const start = text.indexOf("Query");
    const query = inspected.glyphs.slice(start, start + 5);
    expect(query.map((g) => g.text).join("")).toBe("Query");
    for (const g of query) expect(g.x).toBeCloseTo(query[0]?.x as number, 3);
    for (let i = 1; i < query.length; i++) {
      expect(query[i]?.y as number).toBeGreaterThan(query[i - 1]?.y as number);
    }
  });

  test("the picture PPTX and the editable PPTX (a text box turned with rot)", async () => {
    const rendered = await render(source);
    const picture = svgToPptx(rendered.svg, { fontSet: fonts });
    expect(picture.ok).toBe(true);
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
    const textOf = (s: ReturnType<typeof named>) =>
      [...descendants(s as NonNullable<typeof s>)]
        .filter((e) => e.name === "a:t")
        .map((e) => e.children.map((c) => (c.type === "text" ? c.text : "")).join(""))
        .join("");
    for (const [key, degrees] of Object.entries(TURNED)) {
      const node = named(key);
      const label = named(`${key} label`);
      if (node === undefined || label === undefined) throw new Error(`no shapes of ${key}`);
      // The node's shape keeps no text; its label is a text box of its own, turned.
      expect([...descendants(node)].some((e) => e.name === "p:txBody")).toBe(false);
      const xfrm = [...descendants(label)].find((e) => e.name === "a:xfrm");
      expect(attribute(xfrm as NonNullable<typeof xfrm>, "rot")).toBe(
        String(((degrees + 360) % 360) * 60000),
      );
      // Turned about the SVG's center: the box's center is the rotation's.
      const n = (name: string, a: string) => {
        const e = [...descendants(label)].find((x) => x.name === name);
        return Number(attribute(e as NonNullable<typeof e>, a));
      };
      const center = rendered.inspection.elements.find((e) => e.key === key)?.labels[0]?.rotation
        ?.center;
      const { viewBox } = rendered.inspection.canvas;
      const EMU = 6350;
      expect(
        Math.abs(n("a:off", "x") + n("a:ext", "cx") / 2 - ((center?.x ?? 0) - viewBox.x) * EMU),
      ).toBeLessThanOrEqual(2);
      expect(
        Math.abs(n("a:off", "y") + n("a:ext", "cy") / 2 - ((center?.y ?? 0) - viewBox.y) * EMU),
      ).toBeLessThanOrEqual(2);
    }
    expect(textOf(named("n:vae label"))).toBe("Visual VAE Encoder");
    // Upright labels stay in their shapes.
    expect(textOf(named("n:a"))).toBe("Patch embed");
  });

  test("the editable PPTX puts each turned line where the SVG draws it", async () => {
    // Read back from the text box: the upright text's anchor (the centre of
    // the text area between the insets) and each line's top (the top inset,
    // then one line spacing per line), turn them with `rot` about the box's
    // centre, and compare with the SVG's geometry as inspected.
    const rendered = await render(source);
    const editable = svgToEditablePptx(rendered.svg, rendered.compiled.ir);
    if (!editable.ok) throw new Error(JSON.stringify(editable.diagnostics));
    const xml = new TextDecoder().decode(readPptx(editable.value).get("ppt/slides/slide1.xml"));
    const parsed = parseXml(xml);
    if (!parsed.ok) throw new Error(parsed.message);
    const EMU = 6350; // one unit = 0.5pt
    const TOLERANCE = 0.002; // units: rounding to whole EMU is under 0.0002
    const turn = (p: { x: number; y: number }, degrees: number, c: { x: number; y: number }) =>
      degrees > 0
        ? { x: c.x - (p.y - c.y), y: c.y + (p.x - c.x) }
        : { x: c.x + (p.y - c.y), y: c.y - (p.x - c.x) };
    const checked: string[] = [];
    for (const key of Object.keys(TURNED)) {
      const shape = [...descendants(parsed.root)].find(
        (s) =>
          s.name === "p:sp" &&
          [...descendants(s)].some(
            (e) => e.name === "p:cNvPr" && attribute(e, "name") === `${key} label`,
          ),
      );
      if (shape === undefined) throw new Error(`no text box of ${key}`);
      const all = [...descendants(shape)];
      const one = (name: string) => {
        const e = all.find((x) => x.name === name);
        if (e === undefined) throw new Error(`${key}: no ${name}`);
        return e;
      };
      const num = (name: string, a: string) => Number(attribute(one(name), a));
      const label = rendered.inspection.elements.find((e) => e.key === key)?.labels[0];
      const rotation = label?.rotation;
      if (label === undefined || rotation === undefined) throw new Error(`no label of ${key}`);
      const degrees = ((num("a:xfrm", "rot") / 60000 + 180) % 360) - 180;
      expect(degrees).toBe(rotation.degrees);
      const c = rotation.center;
      // EMU offsets from the box's centre, which is the rotation's centre.
      const [ox, oy, cx, cy] = [
        num("a:off", "x"),
        num("a:off", "y"),
        num("a:ext", "cx"),
        num("a:ext", "cy"),
      ];
      const [lIns, rIns, tIns] = ["lIns", "rIns", "tIns"].map((a) => num("a:bodyPr", a)) as [
        number,
        number,
        number,
      ];
      const anchorX = c.x + (ox + lIns + (ox + cx - rIns) - 2 * (ox + cx / 2)) / 2 / EMU;
      const firstTop = c.y + (oy + tIns - (oy + cy / 2)) / EMU;
      const paragraphs = all.filter((e) => e.name === "a:p");
      const spacing =
        Number(attribute(all.find((e) => e.name === "a:spcPts") as never, "val")) / 50;
      expect(spacing).toBeCloseTo(label.lineHeightUnits, 1);
      // The SVG: the label's lines upright (its own frame) and as drawn (turned).
      const { rotation: _, ...upright } = label;
      const uprightLines = measureLabel(upright, fonts).lines;
      const turnedLines = measureLabel(label, fonts).lines;
      expect(paragraphs).toHaveLength(uprightLines.length);
      for (const [i, line] of uprightLines.entries()) {
        const top = firstTop + i * spacing;
        // Upright: the anchor and the line's top as the SVG has them.
        expect(Math.abs(anchorX - label.anchor.x)).toBeLessThan(TOLERANCE);
        expect(Math.abs(top - line.y)).toBeLessThan(TOLERANCE);
        // Turned: the point lands on the turned line box's edge, at its middle.
        const p = turn({ x: anchorX, y: top }, degrees, c);
        const want = turn({ x: label.anchor.x, y: line.y }, degrees, c);
        expect(Math.abs(p.x - want.x) + Math.abs(p.y - want.y)).toBeLessThan(TOLERANCE);
        const box = turnedLines[i] as Rect;
        expect(p.x).toBeGreaterThan(box.x - TOLERANCE);
        expect(p.x).toBeLessThan(box.x + box.width + TOLERANCE);
        expect(p.y).toBeGreaterThan(box.y - TOLERANCE);
        expect(p.y).toBeLessThan(box.y + box.height + TOLERANCE);
        const onEdge =
          Math.min(
            Math.abs(p.x - box.x),
            Math.abs(p.x - box.x - box.width),
            Math.abs(p.y - box.y),
            Math.abs(p.y - box.y - box.height),
          ) < TOLERANCE;
        expect(onEdge).toBe(true);
      }
      const texts = paragraphs.map((p) =>
        [...descendants(p)]
          .filter((e) => e.name === "a:t")
          .map((e) => e.children.map((ch) => (ch.type === "text" ? ch.text : "")).join(""))
          .join(""),
      );
      checked.push(`${key}: ${texts.join(" / ")}`);
    }
    expect(checked).toEqual([
      "n:query: Query",
      "n:vae: Visual VAE Encoder",
      "n:b: Math x̂t2",
      "n:c: Two / much longer lines",
    ]);
  });

  test("the auto engine refuses it (layout/structured-only)", () => {
    const auto = `version: 1
figure: { id: f }
nodes:
  - { id: vae, component: box, label: Visual VAE Encoder, labelRotation: -90 }
`;
    const compiled = compileFigure(auto);
    expect(compiled.ok).toBe(false);
    expect(compiled.diagnostics.map((d) => [d.code, d.path])).toEqual([
      ["layout/structured-only", ["nodes", 0, "labelRotation"]],
    ]);
  });
});
