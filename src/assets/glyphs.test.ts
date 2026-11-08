import { describe, expect, test } from "bun:test";
import { compileFigure } from "../compiler/compile";
import type { NodeIR } from "../compiler/ir";
import { GLYPH_POSITIONS } from "../core/figure/schema";
import { glyphMarkup, glyphRect, glyphRects } from "./glyphs";

function nodeWith(glyphs: string, theme = "color"): NodeIR {
  const result = compileFigure(
    `version: 1\nfigure: { id: g, theme: ${theme} }\nnodes: [{ id: a, component: box, label: A, glyphs: ${glyphs} }]\n`,
  );
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const node = result.value.ir.nodes[0];
  if (node === undefined) throw new Error("no node");
  return node;
}

const body = { x: 100, y: 50, width: 80, height: 40 };

describe("glyph schema", () => {
  const invalid: [string, string, (string | number)[]][] = [
    ["{ kind: vector, cells: 3, tones: [blue] }", "tones has 1 entries but cells is 3", ["tones"]],
    ["{ kind: dot, cells: 2 }", "applies to a vector only", ["cells"]],
    ["{ kind: pill, direction: down }", "applies to a vector only", ["direction"]],
    ["{ kind: vector, width: 3pt }", "applies to a pill only", ["width"]],
    ["{ kind: pill, size: 0pt }", "must be positive", ["size"]],
    ["{ kind: vector, cells: 17 }", "", ["cells"]],
    ["{ kind: vector, at: middle }", "expected one of", ["at"]],
    ["{ kind: star }", "expected one of", ["kind"]],
    ["{ kind: vector, tone: chartreuse }", "", ["tone"]],
    ["{ kind: vector, extra: 1 }", "", []],
    ["{ kind: vector, tone: blue, tones: [pink] }", "cannot be combined", ["tones"]],
    ["{ kind: vector, strength: loud }", "expected one of", ["strength"]],
  ];
  for (const [glyph, message, path] of invalid) {
    test(`rejects ${glyph}`, () => {
      const result = compileFigure(
        `version: 1\nfigure: { id: g }\nnodes: [{ id: a, component: box, glyphs: [${glyph}] }]\n`,
      );
      expect(result.ok).toBe(false);
      expect(result.diagnostics[0]).toEqual(
        expect.objectContaining({
          code: expect.stringMatching(/^schema\//),
          message: expect.stringContaining(message),
        }),
      );
      expect(result.diagnostics[0]?.path?.slice(0, 4)).toEqual(["nodes", 0, "glyphs", 0]);
      if (path.length > 0) expect(result.diagnostics[0]?.path?.at(4)).toBe(path[0]);
    });
  }

  test("an empty list and more than eight glyphs are rejected", () => {
    for (const glyphs of ["[]", `[${Array(9).fill("{ kind: dot }").join(",")}]`]) {
      const result = compileFigure(
        `version: 1\nfigure: { id: g }\nnodes: [{ id: a, component: box, glyphs: ${glyphs} }]\n`,
      );
      expect(result.ok).toBe(false);
    }
  });

  test("glyphs on a component without a node body are rejected", () => {
    const result = compileFigure(`version: 1
figure: { id: g, layout: { arrange: { row: { items: [a] } } } }
nodes: [{ id: a, component: tokens, props: { cells: [A] }, glyphs: [{ kind: dot }] }]
`);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "component/glyph-unsupported",
        path: ["nodes", 0, "glyphs"],
      }),
    );
  });
});

describe("glyph resolution", () => {
  test("a vector defaults to three cells of 0.4 em going down", () => {
    const node = nodeWith("[{ kind: vector }]");
    const glyph = node.glyphs?.[0];
    const em = node.style.fontSize.units;
    expect(glyph?.at).toBe("north-east");
    expect(glyph?.parts).toHaveLength(3);
    expect(glyph?.width).toBeCloseTo(em * 0.4, 2);
    expect(glyph?.height).toBeCloseTo(em * 1.2, 2);
    expect(glyph?.parts.map((p) => p.y)).toEqual(
      [0, em * 0.4, em * 0.8].map((v) => Math.round(v * 1000) / 1000),
    );
  });

  test("direction right lays cells out in a row; tones colour each cell", () => {
    const node = nodeWith("[{ kind: vector, direction: right, tones: [pink, none, green] }]");
    const glyph = node.glyphs?.[0];
    expect(glyph?.parts.map((p) => p.y)).toEqual([0, 0, 0]);
    expect(glyph?.width).toBeGreaterThan(glyph?.height ?? 0);
    const fills = glyph?.parts.map((p) => p.fill) ?? [];
    expect(new Set(fills).size).toBe(3);
  });

  test("size is in pt (2 units each) and outline false draws no stroke", () => {
    const node = nodeWith("[{ kind: vector, cells: 2, size: 3pt, outline: false }]");
    const glyph = node.glyphs?.[0];
    expect(glyph?.width).toBe(6);
    expect(glyph?.height).toBe(12);
    expect(glyph?.strokeWidth).toBe(0);
    expect(glyphMarkup(node, body)).toContain('stroke="none"');
  });

  test("dot and pill are one rounded part; the outline is thin", () => {
    const [dot, pill] =
      nodeWith("[{ kind: dot }, { kind: pill, size: 2pt, width: 8pt }]").glyphs ?? [];
    expect(dot?.parts).toHaveLength(1);
    expect(dot?.parts[0]?.radius).toBeCloseTo((dot?.width ?? 0) / 2, 3);
    expect(pill?.width).toBe(16);
    expect(pill?.height).toBe(4);
    expect(pill?.parts[0]?.radius).toBe(2);
    expect(dot?.strokeWidth).toBeGreaterThan(0);
    expect(dot?.strokeWidth).toBeLessThanOrEqual(1.5);
  });

  test("tone fills follow the theme: color is tinted, paper is gray", () => {
    const color = nodeWith("[{ kind: dot, tone: orange }]", "color").glyphs?.[0]?.parts[0]?.fill;
    const paper = nodeWith("[{ kind: dot, tone: orange }]", "paper").glyphs?.[0]?.parts[0]?.fill;
    const none = nodeWith("[{ kind: dot }]", "color").glyphs?.[0]?.parts[0]?.fill;
    expect(color).not.toBe(none);
    expect(paper).not.toBe(color);
  });
});

describe("glyph geometry", () => {
  const expected = {
    north: [140, 50],
    "north-east": [180, 50],
    east: [180, 70],
    "south-east": [180, 90],
    south: [140, 90],
    "south-west": [100, 90],
    west: [100, 70],
    "north-west": [100, 50],
    center: [140, 70],
  } as const;
  for (const at of GLYPH_POSITIONS) {
    test(`${at}: the footprint is centered on the body's anchor`, () => {
      const node = nodeWith(`[{ kind: vector, at: ${at} }]`);
      const glyph = node.glyphs?.[0];
      if (glyph === undefined) throw new Error("no glyph");
      const rect = glyphRect(glyph, body);
      const [x, y] = expected[at];
      expect(rect.x + rect.width / 2).toBeCloseTo(x, 3);
      expect(rect.y + rect.height / 2).toBeCloseTo(y, 3);
      // The footprint holds the parts and half of the outline around them.
      expect(rect.width).toBeCloseTo(glyph.width + glyph.strokeWidth, 3);
      expect(rect.height).toBeCloseTo(glyph.height + glyph.strokeWidth, 3);
      expect(glyphRects(node, body)).toEqual([rect]);
    });
  }

  test("dx and dy move the glyph by ems of the node's font size", () => {
    const plain = nodeWith("[{ kind: dot }]");
    const moved = nodeWith("[{ kind: dot, dx: 0.5, dy: -1 }]");
    const em = plain.style.fontSize.units;
    const a = glyphRects(plain, body)[0];
    const b = glyphRects(moved, body)[0];
    expect((b?.x ?? 0) - (a?.x ?? 0)).toBeCloseTo(0.5 * em, 2);
    expect((b?.y ?? 0) - (a?.y ?? 0)).toBeCloseTo(-em, 2);
  });

  test("a node without glyphs has no footprint and no markup", () => {
    const result = compileFigure(
      `version: 1\nfigure: { id: g }\nnodes: [{ id: a, component: box }]\n`,
    );
    const node = result.ok ? result.value.ir.nodes[0] : undefined;
    if (node === undefined) throw new Error("no node");
    expect(glyphRects(node, body)).toEqual([]);
    expect(glyphMarkup(node, body)).toBe("");
  });

  test("the markup draws one rect per part inside g.sumi-glyphs", () => {
    const markup = glyphMarkup(
      nodeWith("[{ kind: vector, cells: 4 }, { kind: dot, at: south }]"),
      body,
    );
    expect(markup.startsWith('<g class="sumi-glyphs">')).toBe(true);
    expect(markup.match(/<rect /g)).toHaveLength(5);
    expect(markup).toContain("sumi-glyph-vector");
    expect(markup).toContain("sumi-glyph-dot");
  });
});

describe("solid strength", () => {
  const themes = ["minimal", "academic", "slides", "color", "paper", "llama"];
  for (const theme of themes) {
    test(`${theme}: solid takes the tone's accent with a 0.5pt ink outline and differs from soft`, () => {
      const soft = nodeWith("[{ kind: dot, tone: blue }]", theme).glyphs?.[0];
      const solid = nodeWith("[{ kind: dot, tone: blue, strength: solid }]", theme).glyphs?.[0];
      const plain = nodeWith("[{ kind: dot, strength: solid }]", theme).glyphs?.[0];
      const compiled = compileFigure(
        `version: 1\nfigure: { id: g, theme: ${theme} }\nnodes: [{ id: a, component: box }]\n`,
      );
      if (!compiled.ok) throw new Error("compile");
      const node = compiled.value.ir.nodes[0];
      expect(solid?.strokeWidth).toBe(1);
      expect(solid?.stroke).toBe(node?.style.fontColor);
      expect(solid?.parts[0]?.fill).not.toBe(soft?.parts[0]?.fill);
      // The accent is distinct from the paper-white default fill of `none`.
      expect(solid?.parts[0]?.fill).not.toBe(plain?.parts[0]?.fill);
      expect(plain?.parts[0]?.fill).toBe(node?.style.fill);
    });
  }

  test("soft stays the default and solid applies to every cell tone", () => {
    const a = nodeWith("[{ kind: vector, tones: [pink, none, green] }]").glyphs?.[0];
    const b = nodeWith("[{ kind: vector, strength: soft, tones: [pink, none, green] }]")
      .glyphs?.[0];
    expect(b).toEqual(a);
    const s = nodeWith("[{ kind: vector, strength: solid, tones: [pink, none, green] }]")
      .glyphs?.[0];
    expect(s?.strokeWidth).toBe(1);
    expect(new Set(s?.parts.map((p) => p.fill)).size).toBe(3);
  });
});
