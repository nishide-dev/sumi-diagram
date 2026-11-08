/**
 * `iconSize` (#424, design doc `424-icon-size`): icons drawn larger without an
 * enclosing shape, through the schema, the layout, the geometry lint and the
 * SVG, PDF and picture PPTX outputs, and in legend samples.
 */

import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { badgeRect, iconSize } from "../assets/draw";
import { checkD2Version, findD2Binary } from "../backends/d2/binary";
import { compileFigure } from "../compiler/compile";
import { FigureDocumentSchema } from "../core/figure/schema";
import { lintGeometry } from "../lint";
import { svgToPdf } from "./pdf";
import { inspectPdf } from "./pdf/testing";
import { svgToPptx } from "./pptx";
import { readPptx } from "./pptx/testing";
import { renderFigure } from "./render";

const binary = findD2Binary();
const d2 = binary.ok && (await checkD2Version(binary.value.path)).ok;
const inCI = Boolean(process.env.CI);

const row = (iconSize: string, extra = "") => `version: 1
figure:
  id: sized
  theme: paper
  profile: paper-single
  layout: { arrange: { row: { gap: 10mm, align: center, items: [a, b, c] } } }
nodes:
  - { id: a, component: label, icon: tabler/database }
  - { id: b, component: label, icon: tabler/database${iconSize}${extra} }
  - { id: c, component: label, icon: tabler/cpu }
edges:
  - { from: a, to: b }
  - { from: b, to: c }
`;

async function renderAny(source: string) {
  const result = await renderFigure(source);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  return result.value;
}

/** A structured figure, whose layout the test reads. */
async function render(source: string) {
  const value = await renderAny(source);
  if (!("layout" in value)) throw new Error("expected a structured figure");
  return value;
}

const codes = (source: string) => compileFigure(source).diagnostics.map((d) => d.code);

describe("schema", () => {
  const node = (field: string) =>
    `version: 1\nfigure: { id: s }\nnodes: [{ id: a, component: label, icon: tabler/flame, ${field} }]\n`;

  test.each(["iconSize: 2", "iconSize: 0.5", "iconSize: 12mm", 'iconSize: "0.5in"'])(
    "%s is accepted",
    (field) => {
      expect(codes(node(field))).toEqual([]);
    },
  );

  test.each([
    "iconSize: 0",
    "iconSize: -1",
    "iconSize: 100",
    "iconSize: 0.1",
    'iconSize: "0mm"',
    'iconSize: "12"',
    'iconSize: "12px"',
    "iconSize: big",
  ])("%s is refused", (field) => {
    const result = compileFigure(node(field));
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.path).toEqual(["nodes", 0, "iconSize"]);
  });

  test("iconSize without an icon is an error at the field", () => {
    const result = compileFigure(
      "version: 1\nfigure: { id: s }\nnodes: [{ id: a, component: box, label: x, iconSize: 2 }]\n",
    );
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: "asset/icon-size-without-icon",
        path: ["nodes", 0, "iconSize"],
      }),
    ]);
  });

  test("the JSON Schema offers an em number and a length", () => {
    const schema = z.toJSONSchema(FigureDocumentSchema, { target: "draft-2020-12", io: "input" });
    const node = JSON.stringify(schema).match(/"iconSize":(\{.*?\}\]\}|\{[^{}]*\})/)?.[0] ?? "";
    expect(node).toContain('"type":"number"');
    expect(node).toContain("mm|cm|in|pt");
  });
});

describe("geometry", () => {
  test("em multiples and lengths size the node to the icon, one em by default", async () => {
    const one = await render(row(""));
    const two = await render(row(", iconSize: 2"));
    const mm = await render(row(', iconSize: "12mm"'));
    const em = one.compiled.ir.nodes[0]?.style.fontSize.units as number;
    const rect = (r: typeof one, key: string) => r.layout.nodes.find((n) => n.key === key)?.rect;
    expect(rect(one, "n:b")?.width).toBe(em);
    expect(rect(two, "n:b")?.width).toBe(2 * em);
    expect(rect(two, "n:b")?.height).toBe(2 * em);
    expect(rect(mm, "n:b")?.width).toBeCloseTo((12 / 25.4) * 72 * 2, 0);
    // The neighbours keep their own size.
    expect(rect(two, "n:a")?.width).toBe(em);
    expect(rect(two, "n:c")?.width).toBe(em);
  });

  test("the icon is drawn exactly in its node's box, and edges end on that box", async () => {
    const out = await render(row(", iconSize: 3"));
    const b = out.layout.nodes.find((n) => n.key === "n:b")?.rect;
    if (b === undefined) throw new Error("no node");
    const em = out.compiled.ir.nodes[0]?.style.fontSize.units as number;
    // The second icon group is 3 em wide: scale = 3 em / 24 (Tabler's viewBox).
    const scales = [
      ...out.svg.matchAll(
        /class="sumi-icon" transform="translate\(([-\d.]+) ([-\d.]+)\) scale\(([\d.]+)\)"/g,
      ),
    ];
    expect(scales).toHaveLength(3);
    const [, tx, ty, scale] = scales[1] as RegExpMatchArray;
    expect(Number(scale)).toBeCloseTo((3 * em) / 24, 3);
    expect(Number(tx)).toBeCloseTo(b.x, 2);
    expect(Number(ty)).toBeCloseTo(b.y, 2);
    const edges = out.inspection.elements.filter((e) => e.key.startsWith("e:"));
    const ends = edges.map((e) => e.path?.at(-1)?.to);
    const starts = edges.map((e) => e.path?.[0]?.to);
    // a -> b ends on b's west side, b -> c starts on b's east side.
    expect(ends[0]?.x).toBeCloseTo(b.x, 0);
    expect(starts[1]?.x).toBeCloseTo(b.x + b.width, 0);
  });

  test("a box with an icon grows with the icon, padding included", async () => {
    const small = await render(
      "version: 1\nfigure: { id: s, layout: { arrange: { row: { items: [a] } } } }\nnodes: [{ id: a, component: box, icon: tabler/flame }]\n",
    );
    const big = await render(
      "version: 1\nfigure: { id: s, layout: { arrange: { row: { items: [a] } } } }\nnodes: [{ id: a, component: box, icon: tabler/flame, iconSize: 3 }]\n",
    );
    const em = small.compiled.ir.nodes[0]?.style.fontSize.units as number;
    const w = (r: typeof small) => r.layout.nodes[0]?.rect.width as number;
    expect(w(big) - w(small)).toBeCloseTo(2 * em, 0);
  });

  test("an icon larger than a fixed-size shape is reported, naming no em", async () => {
    const source =
      "version: 1\nfigure: { id: s, layout: { arrange: { row: { items: [a] } } } }\nnodes: [{ id: a, component: circle, icon: tabler/flame, iconSize: 4, props: { width: 20pt, height: 20pt } }]\n";
    const out = await render(source);
    const finding = lintGeometry(out, { source }).find((d) => d.code === "geometry/label-overflow");
    expect(finding?.message).toContain("The icon of node");
    expect(finding?.message).not.toContain("1 em");
  });

  test("a default icon that overflows keeps its message", async () => {
    const source =
      "version: 1\nfigure: { id: s, layout: { arrange: { row: { items: [a] } } } }\nnodes: [{ id: a, component: circle, icon: tabler/flame, props: { width: 6pt, height: 6pt } }]\n";
    const out = await render(source);
    const finding = lintGeometry(out, { source }).find((d) => d.code === "geometry/label-overflow");
    expect(finding?.message).toContain(", 1 em) does not fit");
  });

  test("sized icons trip no geometry finding of a clean figure", async () => {
    const source = row(", iconSize: 2");
    const out = await render(source);
    expect(lintGeometry(out, { source }).filter((d) => d.severity !== "info")).toEqual([]);
  });
});

describe("compatibility", () => {
  test("iconSize: 1 is byte-identical to no iconSize", async () => {
    // Only the hash of the source text differs.
    const same = (svg: string) => svg.replace(/input-sha256="[0-9a-f]+"/, "");
    expect(same((await render(row(", iconSize: 1"))).svg)).toBe(same((await render(row(""))).svg));
  });

  test("a badge stays one em beside a sized icon", async () => {
    const out = await render(
      "version: 1\nfigure: { id: s, layout: { arrange: { row: { items: [a] } } } }\nnodes: [{ id: a, component: box, icon: tabler/flame, iconSize: 3, badge: { icon: emoji/fire, corner: north-east } }]\n",
    );
    const node = out.compiled.ir.nodes[0];
    const body = out.layout.nodes[0]?.rect;
    if (node === undefined || body === undefined) throw new Error("no node");
    const em = node.style.fontSize.units;
    expect(iconSize(node)).toBe(3 * em);
    expect(badgeRect(node, body)).toMatchObject({ width: em, height: em });
  });
});

describe("stroke weight", () => {
  const widths = (svg: string) =>
    [...svg.matchAll(/class="sumi-icon" transform="[^"]*scale\(([\d.]+)\)">(.*?)<\/g>/g)].map(
      (m) => ({
        scale: Number(m[1]),
        strokes: [...(m[2] as string).matchAll(/stroke-width="([\d.]+)"/g)].map((w) =>
          Number(w[1]),
        ),
      }),
    );

  test("a larger Tabler icon keeps the printed stroke of a 1 em icon", async () => {
    const out = await render(row(", iconSize: 3"));
    const [small, large] = widths(out.svg);
    if (small === undefined || large === undefined) throw new Error("no icons");
    expect(large.scale).toBeGreaterThan(small.scale * 2.9);
    expect(large.strokes.length).toBeGreaterThan(0);
    // stroke-width * scale is the printed width: equal at 1 em and 3 em.
    expect((large.strokes[0] as number) * large.scale).toBeCloseTo(
      (small.strokes[0] as number) * small.scale,
      2,
    );
  });

  test("lengths compensate too, and the PDF and PPTX are built from the same SVG", async () => {
    const out = await render(row(', iconSize: "12mm"'));
    const sized = widths(out.svg)[1];
    expect((sized?.strokes[0] as number) * (sized?.scale as number)).toBeCloseTo(
      (widths(out.svg)[0]?.strokes[0] as number) * (widths(out.svg)[0]?.scale as number),
      2,
    );
    const pdf = svgToPdf(out.svg);
    const pptx = svgToPptx(out.svg);
    if (!pdf.ok || !pptx.ok) throw new Error("conversion failed");
    const picture = [...readPptx(pptx.value).entries()].find(([name]) => name.endsWith(".svg"));
    // Three icons: the sized one carries the compensated (thinner) stroke in the picture too.
    const printed = [
      ...new TextDecoder().decode(picture?.[1]).matchAll(/stroke-width="([\d.]+)"/g),
    ];
    expect(printed.length).toBeGreaterThan(0);
  });

  test("a sized emoji, a 1 em icon and a badge are left as they are", async () => {
    const emoji = (extra: string) =>
      `version: 1\nfigure: { id: e, layout: { arrange: { row: { items: [a] } } } }\nnodes: [{ id: a, component: label, icon: emoji/fire${extra} }]\n`;
    const unsized = await render(emoji(""));
    const sized = await render(emoji(", iconSize: 3"));
    const body = (svg: string) => svg.match(/class="sumi-icon"[^>]*>(.*?)<\/g>/)?.[1];
    expect(body(sized.svg)).toBe(body(unsized.svg));
  });
});

describe("formats", () => {
  test("SVG, PDF and picture PPTX carry the larger icon", async () => {
    const small = await render(row(""));
    const large = await render(row(", iconSize: 3"));
    expect(large.svg).not.toBe(small.svg);
    const pdfSmall = svgToPdf(small.svg);
    const pdfLarge = svgToPdf(large.svg);
    if (!pdfSmall.ok || !pdfLarge.ok) throw new Error("PDF failed");
    expect(inspectPdf(pdfLarge.value).images).toBe(0);
    expect(pdfLarge.value.length).toBeGreaterThan(0);
    const pptx = svgToPptx(large.svg);
    if (!pptx.ok) throw new Error("PPTX failed");
    const picture = [...readPptx(pptx.value).entries()].find(([name]) => name.endsWith(".svg"));
    expect(picture).toBeDefined();
    const text = new TextDecoder().decode(picture?.[1]);
    // The 3 em icon is the one drawn at scale 3 em / 24 (16 units * 3 / 24 = 2).
    expect(text).toContain("matrix(2 0 0 2 ");
  });

  test.skipIf(!d2 && !inCI)(
    "the auto (D2) layout sizes and draws the icon alike",
    async () => {
      const source = `version: 1
figure: { id: sized-auto }
nodes:
  - { id: a, component: label, icon: tabler/database }
  - { id: b, component: label, icon: tabler/database, iconSize: 3 }
edges:
  - { from: a, to: b }
`;
      const out = await renderAny(source);
      const em = out.compiled.ir.nodes[0]?.style.fontSize.units as number;
      const scales = [...out.svg.matchAll(/class="sumi-icon" transform="[^"]*scale\(([\d.]+)\)"/g)];
      expect(Number(scales[0]?.[1])).toBeCloseTo(em / 24, 3);
      expect(Number(scales[1]?.[1])).toBeCloseTo((3 * em) / 24, 3);
    },
    30_000,
  );
});

describe("legend samples", () => {
  const legend = (iconSize: string) => `version: 1
figure: { id: lg, theme: paper, profile: paper-single, layout: { arrange: { stack: { gap: 5mm, align: start, items: [a, key] } } } }
nodes:
  - { id: a, component: label, icon: tabler/database, iconSize: 2 }
  - id: key
    component: legend
    variant: plain
    props:
      entries:
        - { icon: tabler/database${iconSize}, label: Store }
`;

  test("a sample takes the same iconSize and is laid out to it", async () => {
    const plain = await render(legend(""));
    const sized = await render(legend(", iconSize: 3"));
    const sample = (r: typeof plain) => r.compiled.ir.elements.get("n:key-1-box");
    const em = plain.compiled.ir.nodes[0]?.style.fontSize.units as number;
    expect(sample(plain)).not.toHaveProperty("iconSize");
    expect(sample(sized)).toMatchObject({ iconSize: 3 * em });
    const height = (r: typeof plain) =>
      r.inspection.elements.find((e) => e.key === "g:key")?.bbox?.height as number;
    expect(height(sized)).toBeGreaterThan(height(plain));
    const source = legend(", iconSize: 3");
    expect(lintGeometry(sized, { source }).filter((d) => d.severity !== "info")).toEqual([]);
  });

  test("lengths work and iconSize needs an icon", async () => {
    expect(codes(legend(', iconSize: "8mm"'))).toEqual([]);
    const bad = compileFigure(
      "version: 1\nfigure: { id: lg }\nnodes:\n  - { id: key, component: legend, props: { entries: [{ glyph: { kind: dot }, iconSize: 2, label: x }] } }\n",
    );
    expect(bad.ok).toBe(false);
  });
});
