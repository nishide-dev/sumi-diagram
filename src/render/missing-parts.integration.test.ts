/**
 * The parts #614 adds (design record 614-missing-parts): an edge's `dash` on
 * any variant (and in a legend sample), bundles of parallel lines
 * (`strands`), a set label's `text` / `weight`, a cylinder's `capDepth`, and
 * the size that fits in a `geometry/label-overflow` hint, verified by a trial
 * layout. Structured layout only, so no D2 is needed.
 */

import { describe, expect, test } from "bun:test";
import { getFontSet } from "../core/theme/fonts";
import { bundleArrowheadScale, strandSpacing } from "../layout/route/arrowhead";
import { lintRenderedFigure } from "../lint/geometry/lint";
import { cylinderArc } from "../lint/geometry/shapes";
import { bundleStrands } from "./bundle";
import { svgToEditablePptx } from "./pptx";
import { type RenderedFigure, renderFigure } from "./render";
import { writeStructuredSvg } from "./structured";

async function render(text: string): Promise<RenderedFigure> {
  const result = await renderFigure(text);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  return result.value;
}

const errors = async (text: string) =>
  (await renderFigure(text)).diagnostics.filter((d) => d.severity === "error");

const styleOf = (figure: RenderedFigure, key: string) => {
  const element = figure.compiled.ir.elements.get(key as never);
  if (element === undefined) throw new Error(`no ${key}`);
  return element.style as unknown as Record<string, unknown>;
};

const two = (edge: string, extra = "") => `version: 1
figure:
  id: parts
  theme: sumi
  layout:
    arrange: {row: {gap: 16mm, items: [a, b]}}
nodes:
  - {id: a, component: box, label: A}
  - {id: b, component: box, label: B}
${extra}edges:
  - {id: ab, from: a, to: b, ${edge}}
`;

describe("edge dash on any variant (#614)", () => {
  test("muted + dotted keeps the muted color and draws round dots", async () => {
    const muted = styleOf(await render(two("variant: muted")), "e:ab");
    const dotted = styleOf(await render(two("variant: muted, dash: dotted")), "e:ab");
    expect(dotted.stroke).toBe(muted.stroke);
    expect(dotted.strokeWidth).toEqual(muted.strokeWidth);
    expect(dotted.strokeDotted).toBe(true);
    expect(dotted.strokeDash).toBe(0);
  });

  test("dashed takes the theme's dashed dashes on emphasis; dash replaces a dotted variant", async () => {
    const dashedVariant = styleOf(await render(two("variant: dashed")), "e:ab");
    const emphasis = styleOf(await render(two("variant: emphasis, dash: dashed")), "e:ab");
    expect(emphasis.strokeDash).toBe(dashedVariant.strokeDash);
    expect(emphasis.strokeDotted).toBeUndefined();
    const replaced = styleOf(await render(two("variant: dotted, dash: dashed")), "e:ab");
    expect(replaced.strokeDotted).toBeUndefined();
    expect(replaced.strokeDash).toBe(dashedVariant.strokeDash);
  });

  test("a legend edge entry draws the same dotted muted sample", async () => {
    const figure = await render(`version: 1
figure:
  id: legend-dash
  theme: sumi
  layout:
    arrange: {stack: {gap: 6mm, items: [r, key]}}
groups:
  - {id: r, variant: plain, arrange: {row: {gap: 16mm, items: [a, b]}}}
nodes:
  - {id: a, component: box, label: A}
  - {id: b, component: box, label: B}
  - id: key
    component: legend
    props:
      entries:
        - {edge: {variant: muted, dash: dotted}, label: echoed}
edges:
  - {id: ab, from: a, to: b, variant: muted, dash: dotted}
`);
    const real = styleOf(figure, "e:ab");
    const sample = styleOf(figure, "e:key-1-line");
    expect(sample.strokeDotted).toBe(true);
    expect(sample.stroke).toBe(real.stroke);
  });

  test("without dash an edge is drawn exactly as before", async () => {
    const plain = await render(two("variant: muted"));
    expect(plain.svg).not.toContain("stroke-dasharray");
  });
});

describe("bundles of parallel lines (#614)", () => {
  test("the lines are offset sideways and rounded about one centre", () => {
    const route = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 80 },
    ];
    const strands = bundleStrands(route, 3, 4, 8);
    expect(strands).toHaveLength(3);
    // Heading east, the first line is offset to the right (y + 4), the last to the left (y − 4).
    expect(strands[0]?.pieces[0]?.[0]).toEqual({ x: 0, y: 4 });
    expect(strands[2]?.pieces[0]?.[0]).toEqual({ x: 0, y: -4 });
    // A right turn: the line on the right is inside (radius 8 − 4), the left one outside (8 + 4).
    const radius = (i: number) => {
      const arc = strands[i]?.arcs[0];
      return arc === undefined
        ? 0
        : Math.hypot(arc.to.x - arc.from.x, arc.to.y - arc.from.y) / Math.SQRT2;
    };
    expect(radius(0)).toBeCloseTo(4, 6);
    expect(radius(1)).toBeCloseTo(8, 6);
    expect(radius(2)).toBeCloseTo(12, 6);
    // Every line ends on the last leg, parallel to it.
    for (const strand of strands) {
      const [a, b] = strand.pieces.at(-1) ?? [];
      expect(a?.x).toBe(b?.x);
      expect(b?.y).toBe(80);
    }
  });

  test("a bundle draws its lines under one grown arrowhead", async () => {
    const figure = await render(two("strands: 4"));
    expect(figure.svg).toContain("sumi-bundle");
    const style = styleOf(figure, "e:ab") as { strokeWidth: { units: number } };
    const expected = bundleArrowheadScale(style.strokeWidth.units, 4);
    expect(expected).toBeGreaterThan(1);
    expect(styleOf(figure, "e:ab").arrowheadScale).toBe(expected);
    const path = /<path class="sumi-wire sumi-bundle" d="([^"]+)"/.exec(figure.svg)?.[1] ?? "";
    expect(path.match(/M /g)).toHaveLength(4);
    // Neighbouring lines are two line widths apart.
    const ys = [...path.matchAll(/M [\d.]+ ([\d.]+)/g)].map((m) => Number(m[1]));
    expect(ys[1] as number).toBeCloseTo(
      (ys[0] as number) - strandSpacing(style.strokeWidth.units),
      6,
    );
  });

  test("a written arrowheadScale wins; the figure without strands is unchanged", async () => {
    const figure = await render(two("strands: 3, arrowheadScale: 0.75"));
    expect(styleOf(figure, "e:ab").arrowheadScale).toBe(0.75);
    expect((await render(two(""))).svg).not.toContain("sumi-bundle");
  });

  test("with sharp corners every line keeps a sharp, mitred corner", () => {
    const route = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 80 },
    ];
    const strands = bundleStrands(route, 3, 4, 0);
    for (const strand of strands) expect(strand.arcs).toEqual([]);
    expect(strands[0]?.pieces[0]?.[1]).toEqual({ x: 96, y: 4 });
    expect(strands[2]?.pieces[0]?.[1]).toEqual({ x: 104, y: -4 });
  });

  test("edgeCorners: sharp draws no arcs in a bundle", async () => {
    const bent = (overrides: string) => `version: 1
figure:
  id: bent
  theme: sumi
${overrides}  layout:
    arrange: {place: {unit: 1mm, items: [{item: a, at: [0, 0]}, {item: b, at: [40, 25]}]}}
nodes:
  - {id: a, component: box, label: A}
  - {id: b, component: box, label: B}
edges:
  - {from: a, to: b, strands: 3, fromAnchor: east, toAnchor: north}
`;
    const bundle = (svg: string) =>
      /<path class="sumi-wire sumi-bundle" d="([^"]+)"/.exec(svg)?.[1] ?? "";
    expect(bundle((await render(bent(""))).svg)).toContain("C ");
    const sharp = bundle((await render(bent("  themeOverrides: {edgeCorners: sharp}\n"))).svg);
    expect(sharp.match(/M /g)).toHaveLength(3);
    expect(sharp).not.toContain("C ");
  });

  test("tight bends and wide bundles: no line runs backwards or vanishes", () => {
    const cases: [{ x: number; y: number }[], number, number][] = [
      [
        [
          { x: 0, y: 0 },
          { x: 4, y: 0 },
          { x: 4, y: 4 },
        ],
        5,
        4,
      ],
      [
        [
          { x: 0, y: 0 },
          { x: 40, y: 0 },
          { x: 40, y: 3 },
          { x: 80, y: 3 },
        ],
        5,
        4,
      ],
      [
        [
          { x: 0, y: 0 },
          { x: 30, y: 0 },
          { x: 30, y: 6 },
          { x: 0, y: 6 },
        ],
        4,
        8,
      ],
    ];
    for (const [route, count, spacing] of cases) {
      const strands = bundleStrands(route, count, spacing, 8);
      expect(strands).toHaveLength(count);
      const dirs = route.slice(1).map((p, i) => {
        const a = route[i] as { x: number; y: number };
        const length = Math.hypot(p.x - a.x, p.y - a.y);
        return { x: (p.x - a.x) / length, y: (p.y - a.y) / length };
      });
      for (const strand of strands) {
        // Drawn: straight pieces, or (on a bend too short for any) a quarter circle.
        expect(strand.pieces.length + strand.arcs.length).toBeGreaterThan(0);
        for (const [a, b] of strand.pieces) {
          const length = Math.hypot(b.x - a.x, b.y - a.y);
          expect(length).toBeGreaterThan(0);
          // Every piece runs the way one of the route's legs runs, never against it.
          const u = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
          expect(dirs.some((d) => Math.abs(d.x * u.x + d.y * u.y - 1) < 1e-9)).toBe(true);
        }
      }
      // The lines stay apart (in order) and parallel on the first leg.
      const ys = strands.map((s) => {
        const first = s.path[0] as { y: number };
        return first.y;
      });
      for (let i = 1; i < ys.length; i++) expect(ys[i] as number).toBeLessThan(ys[i - 1] as number);
    }
  });

  test("a wide bundle on roomy legs keeps its spacing", () => {
    const strands = bundleStrands(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
      5,
      4,
      8,
    );
    expect(strands.map((s) => s.offset)).toEqual([-8, -4, 0, 4, 8]);
  });

  for (const head of ["triangle", "arrow", "open", "diamond", "circle", "box"] as const) {
    test(`every strand meets a ${head} head`, async () => {
      const figure = await render(two("strands: 3"));
      if (!("layout" in figure)) throw new Error("structured figure expected");
      const ir = {
        ...figure.compiled.ir,
        edges: figure.compiled.ir.edges.map((e) => ({ ...e, targetArrowhead: head })),
      };
      const fonts = getFontSet(ir.meta.fontSetId);
      if (fonts === undefined) throw new Error("no fonts");
      const svg = writeStructuredSvg(ir, figure.layout, fonts);
      const d = /<path class="sumi-wire sumi-bundle" d="([^"]+)"/.exec(svg)?.[1] ?? "";
      const ends = d
        .split("M ")
        .filter((part) => part.trim() !== "")
        .map((part) => {
          const numbers = part
            .trim()
            .split(/[ LC]+/)
            .filter(Boolean)
            .map(Number);
          return { x: numbers.at(-2) as number, y: numbers.at(-1) as number };
        });
      expect(ends).toHaveLength(3);
      const group = /<g class="[^"]*sumi-kind-edge"[^>]*>(.*?)<\/g>/.exec(svg)?.[1] ?? "";
      const width = (figure.compiled.ir.edges[0]?.style.strokeWidth.units ?? 0) as number;
      // The distance from a strand's end to the head's outline: within half a line width.
      const outline = headOutline(group);
      for (const end of ends) expect(outline(end)).toBeLessThanOrEqual(width / 2 + 1e-6);
    });
  }

  test("the editable PPTX says it draws a bundle as one line", async () => {
    const figure = await render(two("strands: 4"));
    const pptx = svgToEditablePptx(figure.svg, figure.compiled.ir);
    expect(pptx.diagnostics.map((d) => d.code)).toContain("pptx/bundle-as-one-line");
    const plain = await render(two(""));
    expect(
      svgToEditablePptx(plain.svg, plain.compiled.ir).diagnostics.map((d) => d.code),
    ).not.toContain("pptx/bundle-as-one-line");
  });

  test("a zoom edge cannot be a bundle", async () => {
    expect((await errors(two("component: zoom, strands: 2"))).map((d) => d.path)).toContainEqual([
      "edges",
      0,
      "strands",
    ]);
  });

  test("a curve, a zoom and the auto engine cannot take strands", async () => {
    expect((await errors(two("strands: 2, route: curve"))).map((d) => d.path)).toContainEqual([
      "edges",
      0,
      "strands",
    ]);
    const auto = `version: 1
figure: {id: auto}
nodes:
  - {id: a, component: box, label: A}
  - {id: b, component: box, label: B}
edges:
  - {from: a, to: b, strands: 2}
`;
    expect((await errors(auto)).map((d) => d.code)).toContain("layout/structured-only");
  });
});

describe("set label text and weight (#614)", () => {
  const sets = (fields: string) => `version: 1
figure:
  id: band
  theme: sumi
  layout:
    arrange: {row: {gap: 16mm, items: [a, b]}}
nodes:
  - {id: a, component: box, label: A}
  - {id: b, component: box, label: B}
sets:
  - {id: s, members: [a], shape: rect, label: Round 1${fields}}
`;
  test("text sets the size as a role, weight the weight; omitted is the group title's", async () => {
    const plain = (await render(sets(""))).compiled.ir.sets?.[0]?.style;
    const large = (await render(sets(", text: large, weight: regular"))).compiled.ir.sets?.[0]
      ?.style;
    const small = (await render(sets(", text: small"))).compiled.ir.sets?.[0]?.style;
    const box = styleOf(await render(sets("")), "n:a") as { fontSize: { units: number } };
    expect(large?.fontSize.units).toBe(Math.round(box.fontSize.units * 1.5));
    expect(large?.bold).toBe(false);
    expect(small?.fontSize.units).toBeLessThanOrEqual(plain?.fontSize.units ?? 0);
    expect((await render(sets(", text: heading"))).compiled.ir.sets?.[0]?.style).toEqual(
      plain as NonNullable<typeof plain>,
    );
  });
});

describe("cylinder capDepth (#614)", () => {
  const cylinder = (props: string) => `version: 1
figure:
  id: cyl
  theme: sumi
  layout:
    arrange: {row: {gap: 6mm, items: [db]}}
nodes:
  - {id: db, component: cylinder, label: Replay buffer${props}}
`;
  test("a written cap depth makes the cylinder the label plus three caps tall", async () => {
    const deep = await render(cylinder(""));
    const flat = await render(cylinder(", props: {capDepth: 2pt}"));
    const height = (f: RenderedFigure) =>
      ("layout" in f ? f.layout : undefined)?.nodes.find((n) => n.key === "n:db")?.rect.height ?? 0;
    expect(height(deep) - height(flat)).toBe(3 * (cylinderArc(height(deep)) - 4));
    expect(cylinderArc(40, 4)).toBe(4);
    expect(cylinderArc(9, 4)).toBe(3);
    expect(await errors(cylinder(", props: {capDepth: 2pt}"))).toEqual([]);
  });

  test("capDepth needs the structured engine", async () => {
    const auto = `version: 1
figure: {id: cyl}
nodes:
  - {id: db, component: cylinder, label: DB, props: {capDepth: 2pt}}
`;
    expect((await errors(auto)).map((d) => d.code)).toContain("layout/structured-only");
  });
});

describe("label-overflow gives a size that fits (#614)", () => {
  const figure = (component: string, size: string) => `version: 1
figure:
  id: fit
  theme: sumi
  layout:
    arrange: {row: {gap: 8mm, items: [a, n]}}
nodes:
  - {id: a, component: box, label: Start}
  - {id: n, component: ${component}, label: "More\\nresearch?", props: {${size}}}
edges:
  - {from: a, to: n}
`;
  for (const [component, size] of [
    ["diamond", "width: 20mm, height: 12mm"],
    ["cylinder", "width: 30mm, height: 8mm"],
    ["ellipse", "width: 14mm, height: 9mm"],
  ] as const) {
    test(`${component}: the verified size renders without the overflow`, async () => {
      const report = await lintRenderedFigure(figure(component, size), { file: "fit.sumi.yaml" });
      const overflow = report.diagnostics.find((d) => d.code === "geometry/label-overflow");
      expect(overflow?.hint).toMatch(/Verified: props\.(width|height): [\d.]+mm/);
      const width = /props\.width: ([\d.]+mm)/.exec(overflow?.hint ?? "")?.[1];
      const height = /props\.height: ([\d.]+mm)/.exec(overflow?.hint ?? "")?.[1];
      const [w, h] = size.split(", ").map((part) => part.split(": ")[1]);
      const fixed = figure(component, `width: ${width ?? w}, height: ${height ?? h}`);
      const after = await lintRenderedFigure(fixed, { file: "fit.sumi.yaml" });
      expect(after.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
      // No overflow at any level, not only as an error.
      expect(after.diagnostics.filter((d) => d.code === "geometry/label-overflow")).toEqual([]);
    });
  }

  test("a node sized to its label gets no size", async () => {
    const report = await lintRenderedFigure(
      figure("diamond", "width: 20mm").replace(", props: {width: 20mm}", ""),
      { file: "fit.sumi.yaml" },
    );
    expect(report.diagnostics.filter((d) => d.code === "geometry/label-overflow")).toEqual([]);
  });
});

type Pt = { x: number; y: number };

function segmentDistance(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

/** The distance from a point to the arrowhead drawn in an edge group's markup (polygon, circle or chevron). */
function headOutline(group: string): (p: Pt) => number {
  const polygon = /<polygon points="([^"]+)"/.exec(group)?.[1];
  if (polygon !== undefined) {
    const points = polygon.split(" ").map((pair) => {
      const [x, y] = pair.split(",").map(Number);
      return { x: x as number, y: y as number };
    });
    return (p) =>
      Math.min(
        ...points.map((a, i) => segmentDistance(p, a, points[(i + 1) % points.length] as Pt)),
      );
  }
  const circle = /<circle cx="([^"]+)" cy="([^"]+)" r="([^"]+)"/.exec(group);
  if (circle !== null) {
    const [cx, cy, r] = circle.slice(1).map(Number) as [number, number, number];
    return (p) => Math.abs(Math.hypot(p.x - cx, p.y - cy) - r);
  }
  const chevron = /<path class="sumi-arrowhead"[^>]* d="([^"]+)"/.exec(group)?.[1] ?? "";
  const numbers = chevron
    .split(/[ ML]+/)
    .filter(Boolean)
    .map(Number);
  const points: Pt[] = [];
  for (let i = 0; i + 1 < numbers.length; i += 2)
    points.push({ x: numbers[i] as number, y: numbers[i + 1] as number });
  return (p) => Math.min(...points.slice(1).map((b, i) => segmentDistance(p, points[i] as Pt, b)));
}
