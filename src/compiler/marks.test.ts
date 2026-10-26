/**
 * Mark components (#92, design doc §6.20): `sumi/operator` (glyph) and
 * `sumi/junction` (point). Manifest contract, component-stage checks, IR sizes
 * and labels, D2 lowering and lint exemptions, without D2. Rendering with D2
 * is covered by `builtins-render.test.ts` and the gallery.
 */

import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { checkFigure } from "../core/check";
import { createBuiltinRegistry, OPERATOR_GLYPHS } from "../core/registry/builtins";
import type { NodeManifest } from "../core/registry/manifest";
import { Registry } from "../core/registry/registry";
import { getTheme } from "../core/theme/builtin";
import { lintFigure } from "../lint/lint";
import { compileFigure, expectD2Figure } from "./compile";
import { markSizeOf } from "./ir";

const figure = (body: string, theme = "minimal") =>
  `version: 1\nfigure: { id: f, theme: ${theme}, layout: { direction: down } }\n${body}`;

function compile(source: string) {
  const result = compileFigure(source);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  return expectD2Figure(result.value);
}

const codes = (source: string) =>
  checkFigure(source).state.diagnostics.map((d) => [d.code, d.path]);

const CHAIN = `nodes:
  - { id: a, component: box, label: A }
  - { id: add, component: operator, props: { symbol: plus } }
  - { id: split, component: junction }
  - { id: b, component: box, label: B }
  - { id: c, component: box, label: C }
edges:
  - { from: a, to: add }
  - { from: add, to: split, component: line }
  - { from: split, to: b }
  - { from: split, to: c }
`;

describe("mark manifests", () => {
  const base = {
    version: 1,
    kind: "node",
    namespace: "test",
    description: "A test mark.",
    variants: ["default"],
    since: "0.4.0",
    shape: "circle",
    sizing: "fixed-aspect-1",
  } as const;
  const register = (manifest: Partial<NodeManifest>) =>
    new Registry()
      .register({ ...base, name: "mark", props: z.strictObject({}), ...manifest } as NodeManifest)
      .diagnostics.map((d) => d.path);

  test("the built-ins register", () => {
    const registry = createBuiltinRegistry();
    expect(registry.get("sumi/operator")).toMatchObject({
      mark: { type: "glyph", prop: "symbol", size: 2 },
    });
    expect(registry.get("sumi/junction")).toMatchObject({ mark: { type: "point", size: 3 } });
  });

  test("a mark requires fixed-aspect sizing and no size props", () => {
    expect(
      register({ shape: "rectangle", sizing: "auto", mark: { type: "point", size: 1 } }),
    ).toEqual([["mark"]]);
    expect(
      register({
        props: z.strictObject({ width: z.number().optional() }),
        mark: { type: "point", size: 1 },
      }),
    ).toEqual([["props"]]);
  });

  test("a glyph mark's prop is a string enum with exactly the glyph keys", () => {
    const glyphs = { a: "A", b: "B" };
    const props = (values: [string, ...string[]]) => z.strictObject({ s: z.enum(values) });
    const mark = { type: "glyph", prop: "s", glyphs, size: 2 } as const;
    expect(register({ props: props(["a", "b"]), mark })).toEqual([]);
    expect(register({ props: props(["a"]), mark })).toEqual([["mark", "glyphs"]]);
    expect(register({ props: props(["a", "b", "c"]), mark })).toEqual([["mark", "glyphs"]]);
    expect(register({ props: z.strictObject({ s: z.string() }), mark })).toEqual([
      ["mark", "glyphs"],
    ]);
    expect(register({ props: props(["a", "b"]), mark: { ...mark, prop: "t" } })).toEqual([
      ["mark", "glyphs"],
    ]);
  });
});

describe("mark usage", () => {
  test("a figure with marks checks and lints cleanly (no lint/empty-label)", () => {
    expect(lintFigure(figure(CHAIN)).diagnostics).toEqual([]);
  });

  test("marks take no label; points take no tone; operators need a known symbol", () => {
    expect(
      codes(
        figure(`nodes:
  - { id: p, component: operator, label: plus, props: { symbol: plus } }
  - { id: q, component: operator, props: { symbol: divide } }
  - { id: r, component: operator }
  - { id: j, component: junction, label: x }
  - { id: k, component: junction, tone: red }
  - { id: o, component: operator, tone: red, props: { symbol: times } }
  - { id: blank, component: junction, label: " " }
`),
      ),
    ).toEqual([
      ["component/unexpected-label", ["nodes", 0, "label"]],
      ["component/invalid-prop", ["nodes", 1, "props", "symbol"]],
      ["component/invalid-prop", ["nodes", 2, "props", "symbol"]],
      ["component/unexpected-label", ["nodes", 3, "label"]],
      ["component/tone-unsupported", ["nodes", 4, "tone"]],
    ]);
  });

  test("an operator's glyph counts for the profile's minimum font size", () => {
    const source = figure(CHAIN).replace("layout:", "profile: presentation-16x9, layout:");
    const flagged = checkFigure(source)
      .state.diagnostics.filter((d) => d.code === "profile/font-too-small")
      .map((d) => d.subject?.id);
    expect(flagged).toContain("add");
    expect(flagged).not.toContain("split");
  });

  test("a point draws no text even with a blank label", () => {
    const source = (label: string) =>
      `version: 1\nfigure: { id: f, profile: presentation-16x9 }\nnodes: [{ id: j, component: junction${label} }]\n`;
    expect(checkFigure(source("")).state.diagnostics).toEqual([]);
    expect(checkFigure(source(', label: " "')).state.diagnostics).toEqual([]);
  });

  test("lint/missing-glyph checks the glyph a mark draws, at its prop", () => {
    const registry = createBuiltinRegistry();
    const registered = registry.register({
      version: 1,
      kind: "node",
      namespace: "test",
      name: "mark",
      description: "A glyph mark with a character the bundled fonts lack.",
      variants: ["default"],
      since: "0.4.0",
      props: z.strictObject({ symbol: z.enum(["unicorn"]) }),
      shape: "circle",
      sizing: "fixed-aspect-1",
      mark: { type: "glyph", prop: "symbol", glyphs: { unicorn: "\u{1f984}" }, size: 2 },
    });
    expect(registered.ok).toBe(true);
    const source =
      "version: 1\nfigure: { id: f }\nnodes: [{ id: m, component: test/mark, props: { symbol: unicorn } }]\n";
    expect(
      lintFigure(source, { registry }).diagnostics.map((d) => [d.code, d.path, d.message]),
    ).toEqual([
      [
        "lint/missing-glyph",
        ["nodes", 0, "props", "symbol"],
        'The symbol of node "m" has a character missing from the regular font of font set sumi/biz-ud-gothic: "\u{1f984}" (U+1F984).',
      ],
    ]);
    // The built-in operator's glyphs are all in the bundled font set.
    expect(lintFigure(figure(CHAIN)).diagnostics).toEqual([]);
  });
});

describe("mark IR and D2", () => {
  test("glyph marks draw the symbol; points draw nothing; sizes follow the theme", () => {
    for (const themeId of ["minimal", "academic", "slides", "color"]) {
      const { ir, d2Source } = compile(figure(CHAIN, themeId));
      const theme = getTheme(themeId);
      if (!theme) throw new Error(themeId);
      const add = ir.nodes.find((n) => n.id === "add");
      const split = ir.nodes.find((n) => n.id === "split");
      expect(add?.label).toBe("+");
      expect(split?.label).toBe("");
      expect(add?.mark?.type).toBe("glyph");
      expect(split?.mark?.type).toBe("point");
      // Operator: twice the font size. Junction: three stroke widths.
      expect(add?.width?.pt).toBe(2 * (add?.style.fontSize.pt ?? 0));
      expect(split?.width?.pt).toBe(3 * (split?.style.strokeWidth.pt ?? 0));
      expect(add?.height).toEqual(add?.width);
      expect(split?.height).toEqual(split?.width);
      // A junction is a dot in the line color.
      expect(split?.style.fill).toBe(split?.style.stroke);
      expect(d2Source).toContain(
        `"n_add": {\n  label: "+"\n  class: ["sumi-k-n--add"; "sumi-kind-node"]\n  shape: circle\n  width: ${add?.width?.units}\n  height: ${add?.width?.units}\n`,
      );
      expect(d2Source).toContain(
        `"n_split": {\n  label: ""\n  class: ["sumi-k-n--split"; "sumi-kind-node"]\n  shape: circle\n  width: ${split?.width?.units}\n  height: ${split?.width?.units}\n`,
      );
    }
  });

  test("every symbol has its glyph, in the bundled fonts (regular and bold)", () => {
    for (const [symbol, glyph] of Object.entries(OPERATOR_GLYPHS)) {
      for (const variant of ["default", "emphasis"]) {
        const source = figure(
          `nodes: [{ id: op, component: operator, variant: ${variant}, props: { symbol: ${symbol} } }]\n`,
          "slides",
        );
        expect(compile(source).ir.nodes[0]?.label).toBe(glyph);
        expect(lintFigure(source).diagnostics).toEqual([]);
      }
    }
  });

  test("mark sizes round to whole D2 units, at least one", () => {
    const node = (fontPt: number, strokePt: number) =>
      ({
        fontSize: { pt: fontPt, units: fontPt * 2 },
        strokeWidth: { pt: strokePt, units: strokePt * 2 },
      }) as Parameters<typeof markSizeOf>[1];
    expect(markSizeOf({ type: "glyph", prop: "s", glyphs: {}, size: 2 }, node(7.5, 1))).toEqual({
      pt: 15,
      units: 30,
    });
    expect(markSizeOf({ type: "glyph", prop: "s", glyphs: {}, size: 1.3 }, node(7.5, 1))).toEqual({
      pt: 10,
      units: 20,
    });
    expect(markSizeOf({ type: "point", size: 3 }, node(8, 0))).toEqual({ pt: 0.5, units: 1 });
  });
});
