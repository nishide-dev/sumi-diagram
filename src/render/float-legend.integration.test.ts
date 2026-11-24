/**
 * Floating legends (#643, design record 643): `props.float` places a legend
 * at a corner or side of its container's content area without adding to the
 * container's size; lifelines of a sequence stop above it; anything it covers
 * is `geometry/float-overlap`. Structured layout only, so no D2 is needed.
 */

import { describe, expect, test } from "bun:test";
import { checkFigure } from "../core/check";
import { layoutStructuredFigure } from "../layout";
import type { Rect } from "../layout/ir";
import { lintRenderedFigure } from "../lint/geometry/lint";
import { decodeElementClass } from "./inspect";
import { svgToPdf } from "./pdf";
import { svgToEditablePptx } from "./pptx";
import { readPptx } from "./pptx/testing";
import { renderFigure } from "./render";

const LEGEND = (props: string, extra = "") => `  - id: key
    component: legend
${extra}    props:
${props}      entries:
        - {edge: {tone: orange}, label: signed}
        - {edge: {tone: green, variant: dashed}, label: receipt}
`;

/** A wide row on top and a short box at its left below: the bottom right is free. */
const ROW = (legend: string, items = "[a, b, c]") => `version: 1
figure:
  id: float
  theme: sumi
  profile: paper-double
  layout:
    arrange:
      stack:
        align: start
        items:
          - row: {gap: 12mm, items: [p, q, r, s]}
          - stack: {items: ${items}}
nodes:
  - {id: p, component: box, label: First stage}
  - {id: q, component: box, label: Second stage}
  - {id: r, component: box, label: Third stage}
  - {id: s, component: box, label: Fourth stage}
  - {id: a, component: box, label: Store}
  - {id: b, component: box, label: Cache}
  - {id: c, component: box, label: Log}
${legend}edges:
  - {from: p, to: q, tone: orange}
  - {from: q, to: r, tone: green, variant: dashed}
  - {from: r, to: s}
`;

function layout(text: string) {
  const result = layoutStructuredFigure(text);
  if (!result.ok)
    throw new Error(result.diagnostics.map((d) => `${d.code} ${d.message}`).join("\n"));
  const { layout } = result.value;
  const rect = (key: string): Rect => {
    const found = [...layout.nodes, ...layout.groups].find((n) => n.key === key);
    if (!found) throw new Error(`missing ${key}`);
    return found.rect;
  };
  return { layout, rect, diagnostics: result.diagnostics };
}

const right = (r: Rect) => r.x + r.width;
const bottom = (r: Rect) => r.y + r.height;
const codes = (text: string) => checkFigure(text).state.diagnostics.map((d) => d.code);

describe("floating legends (#643)", () => {
  test("a floating legend adds nothing to the figure's size", () => {
    const without = layout(ROW(""));
    const floated = layout(ROW(LEGEND("      float: bottom-right\n")));
    expect(floated.layout.canvas).toEqual(without.layout.canvas);
    // Listed in the arrange tree instead, the same legend makes the figure taller.
    const listed = layout(ROW(LEGEND(""), "[a, b, c, key]"));
    expect(listed.layout.canvas.height).toBeGreaterThan(without.layout.canvas.height);
  });

  test("it sits flush in its corner, or inset by {at, inset}", () => {
    const flush = layout(ROW(LEGEND("      float: bottom-right\n")));
    const key = flush.rect("g:key");
    const content = flush.layout.content as Rect;
    expect(right(key)).toBeCloseTo(right(content), 3);
    expect(bottom(key)).toBeCloseTo(bottom(content), 3);
    const inset = layout(ROW(LEGEND("      float: {at: bottom-right, inset: 2mm}\n")));
    const moved = inset.rect("g:key");
    const units = (2 * 72) / 25.4 / 0.5;
    expect(right(key) - right(moved)).toBeCloseTo(units, 1);
    expect(bottom(key) - bottom(moved)).toBeCloseTo(units, 1);
    const top = layout(ROW(LEGEND("      float: top-left\n"))).rect("g:key");
    expect(top.x).toBeCloseTo(content.x, 3);
    expect(top.y).toBeCloseTo(content.y, 3);
  });

  test("with group:, it floats in that group's content area", () => {
    const text = `version: 1
figure:
  id: panel
  theme: sumi
  layout: {arrange: {row: {items: [panel]}}}
groups:
  - id: panel
    label: Panel
    arrange: {stack: {align: start, items: [{row: {items: [p, q, r]}}, a]}}
nodes:
  - {id: p, component: box, label: First stage}
  - {id: q, component: box, label: Second stage}
  - {id: r, component: box, label: Third stage}
  - {id: a, component: box, label: A}
${LEGEND("      float: bottom-right\n", "    group: panel\n")}edges:
  - {from: p, to: q, tone: orange}
  - {from: q, to: r, tone: green, variant: dashed}
`;
    const floated = layout(text);
    const panel = floated.layout.groups.find((g) => g.key === "g:panel");
    const key = floated.rect("g:key");
    expect(panel).toBeDefined();
    const content = panel?.content as Rect;
    expect(right(key)).toBeCloseTo(right(content), 3);
    expect(bottom(key)).toBeCloseTo(bottom(content), 3);
    const without = layout(text.replace(/ {2}- id: key[\s\S]*?(?=edges:)/, ""));
    expect(floated.rect("g:panel")).toEqual(without.rect("g:panel"));
  });

  test("placing it twice, or floating a node that is not a legend, is an error", () => {
    expect(codes(ROW(LEGEND("      float: bottom-right\n"), "[a, b, c, key]"))).toContain(
      "layout/duplicate-placement",
    );
    const box = ROW("  - {id: k, component: box, label: K, props: {float: bottom-right}}\n");
    const found = codes(box);
    expect(found).toContain("component/unknown-prop");
    expect(found).not.toContain("layout/unplaced");
    expect(codes(ROW(LEGEND("      float: middle\n")))).toContain("component/invalid-prop");
  });

  test("a legend that does not fit its area, or is pushed out by its inset, is layout/float-too-large", () => {
    const small = `version: 1
figure:
  id: small
  theme: sumi
  layout: {arrange: {row: {items: [a]}}}
nodes:
  - {id: a, component: box, label: A}
${LEGEND("      float: top-left\n")}`;
    const tooLarge = layout(small).diagnostics.filter((d) => d.code === "layout/float-too-large");
    expect(tooLarge).toHaveLength(1);
    expect(tooLarge[0]?.message).toContain("overflows the width by");
    expect(tooLarge[0]?.message).toContain("the height by");
    expect(tooLarge[0]?.message).toContain("the figure grows");
    // It fits the free corner, but an inset larger than the room pushes it out, which grew the canvas silently before.
    const fits = layout(ROW(LEGEND("      float: bottom-right\n")));
    expect(fits.diagnostics.map((d) => d.code)).not.toContain("layout/float-too-large");
    const pushed = layout(ROW(LEGEND("      float: {at: top-right, inset: 60mm}\n")));
    const found = pushed.diagnostics.filter((d) => d.code === "layout/float-too-large");
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain("the height by");
    expect(found[0]?.message).not.toContain("the width by");
    expect(found[0]?.message).toContain("with the inset 60.0mm");
    expect(found[0]?.hint).toContain("reduce the inset");
  });

  test("in a group it names the group whose frame it sticks out of", () => {
    const text = `version: 1
figure:
  id: panel
  theme: sumi
  layout: {arrange: {row: {items: [panel]}}}
groups:
  - {id: panel, label: Panel, arrange: {row: {items: [a]}}}
nodes:
  - {id: a, component: box, label: A}
${LEGEND("      float: top-left\n", "    group: panel\n")}`;
    const found = layout(text).diagnostics.filter((d) => d.code === "layout/float-too-large");
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain('the content area of group "panel"');
    expect(found[0]?.message).toContain("sticks out of the group's frame");
  });

  test("the side positions centre it on the other axis", () => {
    for (const [at, check] of [
      [
        "right",
        (k: Rect, c: Rect) => [right(k) - right(c), k.y + k.height / 2 - (c.y + c.height / 2)],
      ],
      ["left", (k: Rect, c: Rect) => [k.x - c.x, k.y + k.height / 2 - (c.y + c.height / 2)]],
      ["top", (k: Rect, c: Rect) => [k.y - c.y, k.x + k.width / 2 - (c.x + c.width / 2)]],
      [
        "bottom",
        (k: Rect, c: Rect) => [bottom(k) - bottom(c), k.x + k.width / 2 - (c.x + c.width / 2)],
      ],
    ] as const) {
      const placed = layout(ROW(LEGEND(`      float: ${at}\n`)));
      const [edge, centre] = check(placed.rect("g:key"), placed.layout.content as Rect);
      expect(edge).toBeCloseTo(0, 2);
      expect(centre).toBeCloseTo(0, 2);
    }
  });

  test("covering content is geometry/float-overlap; free space is not", async () => {
    const free = await lintRenderedFigure(ROW(LEGEND("      float: bottom-right\n")));
    expect(free.diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
    const covering = await lintRenderedFigure(ROW(LEGEND("      float: top-left\n")));
    const found = covering.diagnostics.filter((d) => d.code === "geometry/float-overlap");
    expect(found).toHaveLength(1);
    expect(found[0]?.severity).toBe("warning");
    expect(found[0]?.message).toContain('node "p"');
    expect(found[0]?.path).toEqual(["nodes", 7, "props", "float"]);
  });
});

describe("floating legends in a sequence (#643)", () => {
  const sequence = (float: string) => `version: 1
figure:
  id: seq
  theme: sumi
  layout:
    arrange:
      sequence:
        participants: [a, b, c, d]
        rows:
          - {fragment: "Pay", rows: [ab, bc, cd, dd, dc, cd2, dc2]}
nodes:
  - {id: a, component: box, label: Alice}
  - {id: b, component: box, label: Bob}
  - {id: c, component: box, label: Carol}
  - {id: d, component: box, label: Dave}
${LEGEND(`      float: ${float}\n`)}edges:
  - {id: ab, from: a, to: b, label: ask}
  - {id: bc, from: b, to: c, tone: orange, label: signed request}
  - {id: cd, from: c, to: d, tone: orange, label: signed request}
  - {id: dd, from: d, to: d, label: check}
  - {id: dc, from: d, to: c, tone: green, variant: dashed, label: receipt}
  - {id: cd2, from: c, to: d, label: confirm}
  - {id: dc2, from: d, to: c, tone: green, variant: dashed, label: receipt}
`;
  const lifelineBottom = (layout: ReturnType<typeof layoutStructuredFigure>, i: number) => {
    if (!layout.ok) throw new Error("not laid out");
    const end = layout.value.layout.nodes.find((n) => n.key === `n:seq-1-end-${i}`);
    if (end === undefined) throw new Error(`missing end ${i}`);
    return end.rect.y + end.rect.height / 2;
  };

  test("the lifelines under the legend stop above it; the others run to the bottom", () => {
    const text = sequence("{at: bottom-left, inset: 2mm}");
    const floated = layoutStructuredFigure(text);
    const plain = layoutStructuredFigure(text.replace(/ {2}- id: key[\s\S]*?(?=edges:)/, ""));
    if (!floated.ok || !plain.ok) throw new Error("not laid out");
    expect(floated.value.layout.canvas).toEqual(plain.value.layout.canvas);
    const legend = floated.value.layout.groups.find((g) => g.key === "g:key")?.rect as Rect;
    // Alice's lifeline (no message after the first row) ends above the legend.
    expect(lifelineBottom(floated, 1)).toBeLessThan(legend.y);
    expect(lifelineBottom(plain, 1)).toBeGreaterThan(legend.y);
    // Dave's lifeline is clear of the legend: it is not cut.
    expect(lifelineBottom(floated, 4)).toBe(lifelineBottom(plain, 4));
  });

  test("inside a fragment frame it lints clean; over lifeline rows it overlaps", async () => {
    const clean = await lintRenderedFigure(sequence("{at: bottom-left, inset: 2mm}"));
    expect(clean.diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
    const crossing = await lintRenderedFigure(sequence("{at: bottom-right, inset: 2mm}"));
    expect(crossing.diagnostics.map((d) => d.code)).toContain("geometry/float-overlap");
  });
});

async function rendered(text: string) {
  const result = await renderFigure(text);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  const figure = result.value;
  if (!("layout" in figure)) throw new Error("not a structured figure");
  return figure;
}

/** The element keys of the SVG in paint order (each element's first `sumi-k-` class). */
function paintOrder(svg: string): string[] {
  const keys: string[] = [];
  for (const match of svg.matchAll(/class="([^"]*sumi-k-[^"]*)"/g)) {
    const key = (match[1] ?? "")
      .split(" ")
      .map(decodeElementClass)
      .find((k) => k !== undefined);
    if (key !== undefined && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

const overlaps = (diagnostics: readonly { code: string; message: string }[]) =>
  diagnostics.filter((d) => d.code === "geometry/float-overlap").map((d) => d.message);

describe("floating legends are painted last and exported (#643)", () => {
  // The legend over the first row, so the content it covers is painted before it.
  const covering = ROW(LEGEND("      float: top-left\n"));

  test("the SVG paints the whole legend after every other element", async () => {
    const figure = await rendered(covering);
    const order = paintOrder(figure.svg);
    const mine = (key: string) =>
      key === "g:key" || key.startsWith("n:key-") || key.startsWith("e:key-");
    const first = order.findIndex(mine);
    expect(first).toBeGreaterThan(0);
    expect(order.slice(first).every(mine)).toBe(true);
    expect(order.slice(0, first).some((key) => key.startsWith("e:"))).toBe(true);
    // The frame first, then its parts: the sample lines are over the frame.
    expect(order[first]).toBe("g:key");
  });

  test("the editable PPTX stacks the legend's shapes last, and the PDF renders", async () => {
    const figure = await rendered(covering);
    const pptx = svgToEditablePptx(figure.svg, figure.compiled.ir);
    if (!pptx.ok) throw new Error(JSON.stringify(pptx.diagnostics));
    const slide = new TextDecoder().decode(readPptx(pptx.value).get("ppt/slides/slide1.xml"));
    const names = [...slide.matchAll(/name="([^"]+)"/g)].map((m) => m[1] as string);
    const first = names.indexOf("g:key");
    expect(first).toBeGreaterThan(0);
    const after = names.slice(first).filter((n) => /^[gne]:/.test(n));
    expect(after.every((n) => n === "g:key" || /^[ne]:key-/.test(n))).toBe(true);
    expect(names.slice(0, first)).toContain("n:p");
  });

  test("the PDF is converted from the SVG that paints the legend last", async () => {
    // The PDF engine draws the SVG's elements in document order: the input carries the order.
    const figure = await rendered(covering);
    const input = figure.svg;
    const order = paintOrder(input);
    expect(order.at(-1)?.startsWith("e:key-")).toBe(true);
    expect(order.indexOf("g:key")).toBeGreaterThan(order.indexOf("n:p"));
    const pdf = svgToPdf(input);
    if (!pdf.ok) throw new Error(JSON.stringify(pdf.diagnostics));
    expect(new TextDecoder().decode(pdf.value.slice(0, 5))).toBe("%PDF-");
  });

  test("a set sample is painted with its floating legend, over the frame", async () => {
    const text = ROW(
      LEGEND("      float: top-left\n").replace(
        "        - {edge: {tone: orange}, label: signed}\n",
        "        - {edge: {tone: orange}, label: signed}\n        - {set: {tone: green}, label: Hyperedge}\n",
      ),
    ).replace("edges:\n", "sets:\n  - {id: hyper, members: [a, b], tone: green}\nedges:\n");
    const { svg } = await rendered(text);
    const at = (pattern: RegExp) => svg.search(pattern);
    const frame = svg.indexOf(
      [...svg.matchAll(/class="([^"]*sumi-k-[^"]*)"/g)].find((m) =>
        (m[1] ?? "").split(" ").some((c) => decodeElementClass(c) === "g:key"),
      )?.[0] ?? "\u0000",
    );
    const swatch = at(/sumi-set-key-\d+-set\b/);
    const content = at(/sumi-set-hyper\b/);
    expect(frame).toBeGreaterThan(0);
    expect(content).toBeGreaterThan(0);
    // The figure's own set is painted with the content, the swatch after the legend's frame.
    expect(content).toBeLessThan(frame);
    expect(swatch).toBeGreaterThan(frame);
  });

  test("the other edges are routed exactly as without the legend", async () => {
    const strip = (text: string) => text.replace(/ {2}- id: key[\s\S]*?(?=edges:)/, "");
    for (const text of [covering, ROW(LEGEND("      float: bottom-right\n"))]) {
      const floated = await rendered(text);
      const plain = await rendered(strip(text));
      const routes = (figure: typeof floated) =>
        figure.layout.edges
          .filter((e) => !e.key.startsWith("e:key-"))
          .map((e) => [e.key, e.route?.points]);
      expect(routes(floated)).toEqual(routes(plain));
    }
  });
});

describe("geometry/float-overlap reads drawn shapes (#643)", () => {
  test("a group's empty inside is free; its frame is not", async () => {
    const panel = (inset: string) => `version: 1
figure:
  id: panel
  theme: sumi
  profile: paper-double
  layout: {arrange: {row: {items: [panel]}}}
groups:
  - id: panel
    label: Panel
    arrange: {stack: {align: start, items: [{row: {gap: 12mm, items: [p, q, r, s]}}, {stack: {items: [a, b, c]}}]}}
nodes:
  - {id: p, component: box, label: First stage}
  - {id: q, component: box, label: Second stage}
  - {id: r, component: box, label: Third stage}
  - {id: s, component: box, label: Fourth stage}
  - {id: a, component: box, label: Store}
  - {id: b, component: box, label: Cache}
  - {id: c, component: box, label: Log}
${LEGEND(`      float: {at: bottom-right, inset: ${inset}}\n`)}edges:
  - {from: p, to: q, tone: orange}
  - {from: q, to: r, tone: green, variant: dashed}
`;
    // The root's content is the panel's frame: flush, the legend lies on that frame.
    const flush = await lintRenderedFigure(panel("0"));
    expect(overlaps(flush.diagnostics).join()).toContain('group "panel"');
    // Inset past the padding, it lies in the panel's empty inside: nothing is covered.
    const inside = await lintRenderedFigure(panel("5mm"));
    expect(overlaps(inside.diagnostics)).toEqual([]);
  });

  test("a circle node's bounding-box corner is free; its shape is not", async () => {
    const circle = (size: string) => `version: 1
figure:
  id: circle
  theme: sumi
  layout: {arrange: {row: {items: [c]}}}
nodes:
  - {id: c, component: circle, label: C, props: {width: ${size}, height: ${size}}}
${LEGEND("      float: top-left\n")}`;
    const corner = await lintRenderedFigure(circle("200mm"));
    expect(overlaps(corner.diagnostics)).toEqual([]);
    const small = await lintRenderedFigure(circle("30mm"));
    expect(overlaps(small.diagnostics).join()).toContain('node "c"');
  });

  test("a circle set is its drawn outline, not its bounding box", async () => {
    const sets = (b: string) => `version: 1
figure:
  id: setf
  theme: sumi
  profile: paper-double
  layout:
    arrange:
      place:
        unit: 1mm
        items:
          - {item: a, at: [0, 0]}
          - {item: b, at: [${b}]}
nodes:
  - {id: a, component: circle, label: A}
  - {id: b, component: circle, label: B}
${LEGEND("      float: top\n")}sets:
  - {id: s, members: [b], shape: circle, padding: 14mm}
`;
    // The legend lies in the corner of the circle's bounding box, clear of the circle.
    const clear = await rendered(sets("46, 26"));
    const legend = clear.layout.groups.find((g) => g.key === "g:key")?.rect as Rect;
    const box = clear.layout.sets?.[0]?.rect as Rect;
    expect(right(legend) > box.x && bottom(legend) > box.y).toBe(true);
    expect(overlaps((await lintRenderedFigure(sets("46, 26"))).diagnostics)).toEqual([]);
    // Closer, the circle runs across the legend.
    const across = overlaps((await lintRenderedFigure(sets("40, 21"))).diagnostics);
    expect(across.join()).toContain('set "s"');
  });
});
