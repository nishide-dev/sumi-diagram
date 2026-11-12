/**
 * Hollow arrowheads in auto (#483): D2 fills an unfilled head with the
 * canvas color to hide the line under it. The finished SVG points each such
 * end at a marker copy without fill, ends the line at the head's base and
 * moves the copy's reference point there, so the head stays in place.
 */

import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { checkD2Version, findD2Binary } from "../backends/d2/binary";
import { compileFigure, expectD2Figure } from "../compiler/compile";
import { generateD2 } from "../compiler/d2";
import { withStyles } from "../compiler/testing";
import { createBuiltinRegistry } from "../core/registry/builtins";
import type { Arrowhead } from "../core/registry/manifest";
import { finalizeSvg } from "./finalize";
import { parsePath } from "./geometry";
import { cutPath, untrimmedRoutes } from "./hollow-arrowheads";
import { svgToPdf } from "./pdf";
import { svgToEditablePptx, svgToPptx } from "./pptx";
import { readPptx } from "./pptx/testing";
import { expectD2Rendered, renderCompiledFigure } from "./render";
import { attribute, childElements, classList, descendants, parseXml, type XmlElement } from "./xml";

const binary = findD2Binary();
const available = binary.ok && (await checkD2Version(binary.value.path)).ok;

const HEADS = ["triangle", "diamond", "circle", "box", "cross"] as const;
type Head = (typeof HEADS)[number];

/** A figure with one edge per head (heads at both ends, all unfilled) and a dashed one. */
async function render(
  background: "canvas" | "transparent" = "canvas",
  heads: readonly Head[] = HEADS,
) {
  const registry = createBuiltinRegistry();
  for (const head of heads) {
    const registered = registry.register({
      version: 1,
      kind: "edge",
      namespace: "test",
      name: head,
      description: `Test edge ${head}.`,
      variants: ["default"],
      props: z.strictObject({}),
      since: "0.1.0",
      direction: "both",
      head,
      tail: head,
    });
    if (!registered.ok) throw new Error(JSON.stringify(registered.diagnostics));
  }
  const text = `version: 1
figure: { id: hollow, theme: academic, background: ${background} }
nodes:
${heads.map((h) => `  - { id: a${h}, component: box, label: ${h} }\n  - { id: b${h}, component: box, label: ${h} }`).join("\n")}
  - { id: wide, component: box, label: wide }
  - { id: far, component: box, label: far }
edges:
${heads.map((h) => `  - { from: a${h}, to: b${h}, component: test/${h} }`).join("\n")}
  - { from: wide, to: far, component: test/triangle, label: dashed }
`;
  const compiled = compileFigure(text, { registry });
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  const figure = expectD2Figure(compiled.value);
  const last = figure.ir.edges.at(-1)?.key;
  const ir = withStyles(
    figure.ir,
    Object.fromEntries(
      figure.ir.edges.map((e) => [
        e.key,
        { filled: false, ...(e.key === last && { strokeDash: 3 }) },
      ]),
    ),
  );
  const value = { ...figure, ir, d2Source: generateD2(ir) };
  const rendered = await renderCompiledFigure(text, { value, diagnostics: [] });
  if (!rendered.ok) throw new Error(JSON.stringify(rendered.diagnostics));
  return { ...rendered.value, raw: expectD2Rendered(rendered.value).artifact.svg };
}

/** The edge's connection path and its markers by end. */
function edgeParts(svg: string, index: number) {
  const parsed = parseXml(svg);
  if (!parsed.ok) throw new Error(parsed.message);
  const all = [...descendants(parsed.root)];
  const markers = new Map(
    all.filter((e) => e.name === "marker").map((e) => [attribute(e, "id"), e]),
  );
  const group = all.find((e) => e.name === "g" && classList(e).includes(`sumi-k-e--_${index}`));
  const path = group && childElements(group).find((c) => classList(c).includes("connection"));
  if (!path) throw new Error(`no path for edge ${index}`);
  const marker = (end: "start" | "end") =>
    markers.get(/^url\(#(.+)\)$/.exec(attribute(path, `marker-${end}`) ?? "")?.[1]) as XmlElement;
  return { path, start: marker("start"), end: marker("end") };
}

const points = (path: XmlElement) => {
  const parsed = parsePath(attribute(path, "d") ?? "");
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.segments.map((s) => s.to);
};

describe.skipIf(!available)("hollow arrowheads in auto", () => {
  test("no marker of a hollow head is filled, with or without a canvas", async () => {
    for (const background of ["canvas", "transparent"] as const) {
      const { svg } = await render(background);
      HEADS.forEach((_, index) => {
        const { start, end } = edgeParts(svg, index);
        for (const marker of [start, end]) {
          for (const shape of descendants(marker)) {
            if (shape === marker) continue;
            expect(attribute(shape, "fill") ?? "none").toBe("none");
            expect(classList(shape).filter((c) => c.startsWith("fill-"))).toEqual([]);
          }
        }
      });
      // D2's own (unreferenced) markers are the only canvas-filled ones left.
      const used = new Set(
        [...svg.matchAll(/marker-(?:start|end)="url\(#([^)]+)\)"/g)].map((m) => m[1]),
      );
      for (const m of svg.matchAll(/<marker id="([^"]+)"[^>]*>(.*?)<\/marker>/gs)) {
        if (used.has(m[1])) expect(m[2]).not.toContain('fill="#FFFFFF"');
      }
    }
  });

  test("the line stops at the base and the heads stay where D2 put them", async () => {
    const { svg, raw } = await render();
    // Marker x of the line's new end: the base (stroke center) less the round cap's half width.
    const expected: Partial<Record<Arrowhead, { start: number; end: number }>> = {
      triangle: { start: 12.5 + 0.5, end: 0.5 - 0.5 },
      box: { start: 15.5 + 0.5, end: 0.5 - 0.5 },
    };
    HEADS.forEach((head, index) => {
      const before = edgeParts(raw, index);
      const after = edgeParts(svg, index);
      const [from, to] = [points(before.path)[0], points(before.path).at(-1)];
      const cut = points(after.path);
      for (const end of ["start", "end"] as const) {
        const original = Number(attribute(before[end], "refX"));
        const moved = Number(attribute(after[end], "refX"));
        // Straight ends here: the line's end moves along the line by the reference point's shift.
        const anchor = end === "start" ? from : to;
        const now = end === "start" ? cut[0] : cut.at(-1);
        if (!anchor || !now) throw new Error("empty path");
        expect(Math.hypot(now.x - anchor.x, now.y - anchor.y)).toBeCloseTo(
          Math.abs(moved - original),
          2,
        );
        const want = expected[head]?.[end];
        if (want !== undefined) expect(moved).toBeCloseTo(want, 2);
        if (head === "cross") expect(moved).toBe(original);
      }
    });
    // The dashed edge keeps its dash phase where its start was cut.
    const dashed = edgeParts(svg, HEADS.length);
    const shift = Number(attribute(dashed.start, "refX")) - 1.5;
    expect(attribute(dashed.path, "style")).toContain(`stroke-dashoffset:${shift}`);
  });

  test("PDF and picture PPTX carry the unfilled heads", async () => {
    const { svg } = await render("transparent");
    const pdf = svgToPdf(svg);
    expect(pdf.ok).toBe(true);
    const pptx = svgToPptx(svg);
    if (!pptx.ok) throw new Error(JSON.stringify(pptx.diagnostics));
    const bytes = readPptx(pptx.value).get("ppt/media/figure.svg");
    if (bytes === undefined) throw new Error("no embedded SVG");
    const media = new TextDecoder().decode(bytes);
    // The picture's SVG paints only the nodes white (one rectangle each) and the
    // label mask's opaque rectangle (a mask, not paint); no head.
    const white = media.match(/fill="#ffffff"/gi)?.length ?? 0;
    expect(white).toBe(HEADS.length * 2 + 2 + 1);
  });
});

describe.skipIf(!available)("hollow arrowheads in editable PPTX", () => {
  test("the lines end where D2 drew them, not at the SVG's cut", async () => {
    // Editable PPTX rejects unfilled native heads (#485); give it filled ones so it
    // draws the cut SVG, and compare with D2's own SVG (before the cut).
    const heads = ["triangle", "diamond", "circle"] as const;
    const rendered = await render("canvas", heads);
    const d2 = expectD2Rendered(rendered);
    const uncut = finalizeSvg(d2.artifact, d2.compiled, { source: "hollow" });
    if (!uncut.ok) throw new Error(JSON.stringify(uncut.diagnostics));
    const ir = withStyles(
      d2.compiled.ir,
      Object.fromEntries(d2.compiled.ir.edges.map((e) => [e.key, { filled: true }])),
    );
    const slide = (svg: string) => {
      const result = svgToEditablePptx(svg, ir);
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
      return new TextDecoder().decode(readPptx(result.value).get("ppt/slides/slide1.xml"));
    };
    expect(rendered.svg).toContain("data-sumi-route=");
    expect(slide(rendered.svg)).toBe(slide(uncut.value.svg));
    // Without the recorded routes, the cut lines would reach PowerPoint.
    const stripped = rendered.svg.replace(/\sdata-sumi-route="[^"]*"/g, "");
    expect(slide(stripped)).not.toBe(slide(uncut.value.svg));
  });
});

describe("cutPath", () => {
  const segments = (d: string) => {
    const parsed = parsePath(d);
    if (!parsed.ok) throw new Error(parsed.message);
    return parsed.segments;
  };
  const insideBox = (x0: number, x1: number) => (p: { x: number; y: number }) =>
    p.x >= x0 && p.x <= x1 && Math.abs(p.y) <= 5;

  test("cuts a straight end where it leaves the head, then backs off", () => {
    const cut = cutPath(segments("M 0 0 L 100 0"), "end", insideBox(90, 100), 0.5);
    expect(cut?.at(-1)?.to.x).toBeCloseTo(89.5, 6);
    const start = cutPath(segments("M 0 0 L 100 0"), "start", insideBox(0, 12), 0);
    expect(start?.[0]?.to.x).toBeCloseTo(12, 6);
  });

  test("splits a curve and keeps the rest of the path", () => {
    const cut = cutPath(segments("M 0 0 L 50 0 C 60 0 70 0 80 0"), "end", insideBox(75, 80));
    expect(cut?.map((s) => s.command)).toEqual(["M", "L", "C"]);
    expect(cut?.at(-1)?.to.x).toBeCloseTo(75, 4);
  });

  test("leaves a path whose end is outside the head, and gives up inside it", () => {
    const path = segments("M 0 0 L 10 0");
    expect(cutPath(path, "end", insideBox(20, 30))).toEqual(path);
    expect(cutPath(path, "end", insideBox(-1, 11))).toBeUndefined();
  });
});

describe("untrimmedRoutes", () => {
  test("puts back D2's route and stroke, and leaves other paths alone", () => {
    const svg =
      '<g><path d="M 1 0 L 9 0" stroke="#000" data-sumi-route="M 0 0 L 10 0"/>' +
      '<path d="M 0 5 L 4 5" stroke="none" data-sumi-route-stroke="#123"/>' +
      '<path d="M 0 9 L 4 9" stroke="#000"/></g>';
    expect(untrimmedRoutes(svg)).toBe(
      '<g><path d="M 0 0 L 10 0" stroke="#000"/>' +
        '<path d="M 0 5 L 4 5" stroke="#123"/>' +
        '<path d="M 0 9 L 4 9" stroke="#000"/></g>',
    );
  });
});
