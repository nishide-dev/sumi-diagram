/**
 * Short cylinders end to end (#516), in both engines: the drawn paths use
 * `cylinderArc()`, the label sits in the middle of the body, the fill reaches
 * both paths, edges still end outside the shape, and PDF / PPTX come from the
 * same corrected SVG.
 *
 * The D2 half is skipped when the pinned `d2` is not installed locally.
 */

import { describe, expect, test } from "bun:test";
import { checkD2Version, findD2Binary } from "../backends/d2/binary";
import { lintGeometry } from "../lint/geometry";
import { CYLINDER_ARC_UNITS, cylinderArc } from "../lint/geometry/shapes";
import { svgToPdf } from "./pdf";
import { svgToEditablePptx, svgToPptx } from "./pptx";
import { type RenderedFigure, renderFigure } from "./render";

const binary = findD2Binary();
const d2Available = binary.ok && (await checkD2Version(binary.value.path)).ok;
const inCI = Boolean(process.env.CI);

/** Heights in pt: 34pt is 68 units; 49.5pt, 50pt and 50.5pt straddle the 100-unit boundary. */
const HEIGHTS = ["13pt", "20pt", "34pt", "49.5pt", "50pt", "50.5pt"];

const d2Source = (height: string, variant: string) => `version: 1
figure: { id: cyl, theme: sumi, profile: paper-double, layout: { direction: down } }
nodes:
  - { id: a, component: box, label: A, props: { width: 20pt, height: 14pt } }
  - { id: b, component: box, label: B, props: { width: 20pt, height: 14pt } }
  - { id: db, component: cylinder, label: PostgreSQL, variant: ${variant}, props: { width: 120pt, height: ${height} } }
  - { id: c, component: box, label: C, props: { width: 20pt, height: 14pt } }
  - { id: d, component: box, label: D, props: { width: 20pt, height: 14pt } }
edges:
  - { from: a, to: db }
  - { from: b, to: db }
  - { from: db, to: c }
  - { from: db, to: d }
`;

const structuredSource = (height: string, variant: string) => `version: 1
figure:
  id: cyl
  theme: sumi
  profile: paper-double
  layout:
    arrange:
      row:
        gap: 12mm
        items: [a, db, c]
nodes:
  - { id: a, component: box, label: A }
  - { id: db, component: cylinder, label: PostgreSQL, variant: ${variant}, props: { width: 74pt, height: ${height} } }
  - { id: c, component: box, label: C }
edges:
  - { from: a, to: db }
  - { from: db, to: c }
`;

async function render(source: string): Promise<RenderedFigure> {
  const result = await renderFigure(source);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  return result.value;
}

const numbers = (d: string) => (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);

function check(rendered: RenderedFigure, variant: string) {
  const { svg } = rendered;
  const db = rendered.inspection.elements.find((e) => e.key === "n:db");
  const bbox = db?.bbox;
  if (bbox === undefined) throw new Error("no cylinder");
  const at = svg.indexOf("sumi-k-n--db");
  const next = svg.slice(at + 20).search(/<g class="[^"]*sumi-kind-|<mask|<\/svg>/);
  const group = at < 0 ? undefined : svg.slice(svg.lastIndexOf("<g", at), at + 20 + next);
  if (group === undefined) throw new Error("no cylinder group");
  const paths = [...group.matchAll(/<path d="([^"]*)"([^>]*)>/g)];
  expect(paths).toHaveLength(2);
  const [body, rim] = paths.map((m) => m[1] ?? "");
  const arc = cylinderArc(bbox.height);
  // Path geometry: the body starts one cap below the top, the rim runs 2 caps down.
  expect(numbers(body ?? "")[1]).toBeCloseTo(bbox.y + arc, 2);
  expect(numbers(rim ?? "")[1]).toBeCloseTo(bbox.y + arc, 2);
  expect(Math.max(...numbers(rim ?? "").filter((_, i) => i % 2 === 1))).toBeCloseTo(
    bbox.y + 2 * arc,
    2,
  );
  const has = (values: number[], v: number) => values.some((x) => Math.abs(x - v) < 0.01);
  expect(has(numbers(body ?? ""), bbox.y)).toBe(true);
  expect(has(numbers(body ?? ""), bbox.y + bbox.height)).toBe(true);
  // Paint: both paths carry the same fill and stroke (a filled variant fills both).
  const paint = (attrs: string) => [
    /fill="([^"]*)"/.exec(attrs)?.[1],
    /stroke="([^"]*)"/.exec(attrs)?.[1],
  ];
  expect(paint(paths[0]?.[2] ?? "")).toEqual(paint(paths[1]?.[2] ?? ""));
  if (variant === "emphasis") expect(paint(paths[0]?.[2] ?? "")[0]).not.toBe("#ffffff");
  // The label sits in the body: its baseline is below the front of the top cap, above the bottom.
  const labelY = Number(/<text [^>]*\by="([\d.]+)"/.exec(group)?.[1]);
  expect(labelY).toBeGreaterThan(bbox.y + 2 * arc);
  expect(labelY).toBeLessThan(bbox.y + bbox.height);
  // The label is inside the shape for the geometry lint, as long as the height allows.
  return { bbox, arc };
}

describe.each([
  ["structured", structuredSource, true],
  ["d2", d2Source, d2Available || inCI],
] as const)("short cylinder, %s engine", (engine, source, enabled) => {
  describe.skipIf(!enabled)("rendering", () => {
    for (const variant of ["default", "emphasis"]) {
      test.each(HEIGHTS)(`${variant}, height %s`, async (height) => {
        const rendered = await render(source(height, variant));
        expect(rendered.compiled.engine).toBe(engine === "d2" ? "auto" : "structured");
        const { bbox, arc } = check(rendered, variant);
        // Shorter than 100 units: shallower caps; from 100 units: D2's 24.
        expect(arc).toBe(bbox.height >= 100 ? CYLINDER_ARC_UNITS : cylinderArc(bbox.height));
        if (bbox.height < 100) expect(arc).toBeLessThan(CYLINDER_ARC_UNITS);
        else expect(arc).toBe(CYLINDER_ARC_UNITS);
        // A label that fits (>= 16pt is enough for one line) passes the geometry lint.
        if (bbox.height >= 32) {
          const findings = lintGeometry(rendered);
          expect(
            findings.filter((d: { code: string }) => d.code === "geometry/label-overflow"),
          ).toEqual([]);
        }
      });
    }

    test("the PDF and PPTX exports read the corrected SVG", async () => {
      const rendered = await render(source("34pt", "default"));
      expect(svgToPdf(rendered.svg).ok).toBe(true);
      expect(svgToPptx(rendered.svg).ok).toBe(true);
      expect(svgToEditablePptx(rendered.svg, rendered.compiled.ir).ok).toBe(true);
    });
  });
});

describe.skipIf(!d2Available && !inCI)("D2 edges at a shortened cap (#516)", () => {
  test.each(["20pt", "34pt", "50pt"])(
    "edges into and out of the top and bottom (off-centre too) stay outside the shape, height %s",
    async (height) => {
      const rendered = await render(d2Source(height, "default"));
      const bbox = rendered.inspection.elements.find((e) => e.key === "n:db")?.bbox;
      if (bbox === undefined) throw new Error("no cylinder");
      for (const edge of rendered.inspection.elements.filter((e) => e.key.startsWith("e:"))) {
        const route = edge.path ?? [];
        const ends = [route[0]?.to, route[route.length - 1]?.to].filter((p) => p !== undefined);
        for (const p of ends) {
          const inside =
            p.x > bbox.x && p.x < bbox.x + bbox.width && p.y > bbox.y && p.y < bbox.y + bbox.height;
          expect(inside).toBe(false);
        }
        // The two sources enter off-centre: each end is within a cap's depth of the shape.
        const near = ends.filter(
          (p) =>
            p.x >= bbox.x &&
            p.x <= bbox.x + bbox.width &&
            Math.min(Math.abs(p.y - bbox.y), Math.abs(p.y - (bbox.y + bbox.height))) <= 6,
        );
        expect(near.length).toBeGreaterThan(0);
      }
    },
  );
});
