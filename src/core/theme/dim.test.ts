/** Dimming a group and everything inside it (#175, design doc §6.53). */

import { describe, expect, test } from "bun:test";
import { checkFigure } from "../check";
import { type ElementKey, edgeKey, groupKey, nodeKey } from "../check-state";
import {
  BUILTIN_THEMES,
  DEFAULT_FONT_SET_ID,
  getTheme,
  resolveStyle,
  type Theme,
  type ThemeDefinition,
  validateTheme,
} from ".";
import { dimmedElements, dimStyle, lightenColor } from "./dim";
import { reportDim } from "./resolve";
import type { ResolvedStyle } from "./style";

const definition = (patch: Partial<ThemeDefinition> = {}): ThemeDefinition => ({
  version: 1,
  id: "test",
  fonts: DEFAULT_FONT_SET_ID,
  ...patch,
});

function builtin(id: string): Theme {
  const theme = getTheme(id);
  if (!theme) throw new Error(`missing theme ${id}`);
  return theme;
}

const codes = (raw: unknown) => validateTheme(raw).diagnostics.map((d) => [d.code, d.path]);

/**
 * A structured figure: `outer` (dim, caption) holds `a`, the group `inner`
 * (with `b`) and `c`; `x` is outside. Edges: a → b and b → c (inside),
 * x → a (into the dimmed group), c → x (out of it), x → inner (to a dimmed
 * group).
 */
const FIGURE = (theme = "color", outer = "    dim: true\n") => `version: 1
figure:
  id: f
  theme: ${theme}
  layout:
    arrange: { row: { items: [x, outer] } }
groups:
  - id: outer
    label: Outer
    caption: (a) dimmed
${outer}    arrange: { stack: { items: [a, inner, c] } }
  - id: inner
    label: Inner
    tone: blue
    variant: dashed
    arrange: { stack: { items: [b] } }
nodes:
  - { id: x, component: box, label: X, tone: orange }
  - { id: a, component: box, label: A, tone: orange }
  - { id: b, component: operator, props: { symbol: plus } }
  - { id: c, component: junction }
edges:
  - { from: a, to: b, label: in }
  - { from: b, to: c }
  - { from: x, to: a }
  - { from: c, to: x }
  - { from: x, to: inner, variant: muted }
`;

function styles(source: string): Map<ElementKey, ResolvedStyle> {
  const { state } = checkFigure(source);
  expect(state.diagnostics).toEqual([]);
  return state.styles ?? new Map();
}

const style = (map: Map<ElementKey, ResolvedStyle>, key: ElementKey): ResolvedStyle => {
  const found = map.get(key);
  if (found === undefined) throw new Error(`no style for ${key}`);
  return found;
};

describe("dim colors", () => {
  test("solid-area dimming keeps text at least 3:1 against every built-in tone fill (#214)", () => {
    // Independent WCAG calculation, not the implementation's color helper.
    const luminance = (hex: string) => {
      const channels = [1, 3, 5].map((i) => {
        const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return (
        0.2126 * (channels[0] ?? 0) + 0.7152 * (channels[1] ?? 0) + 0.0722 * (channels[2] ?? 0)
      );
    };
    for (const theme of BUILTIN_THEMES.values()) {
      if (!theme.dim) throw new Error("missing dim");
      const base = resolveStyle(theme, { kind: "node", id: "sumi/box", variant: "default" }).style;
      for (const tone of theme.toneLines.values()) {
        const ink = tone.stroke;
        if (!ink) throw new Error("missing tone ink");
        const style = { ...base, fill: ink, stroke: ink, fontColor: "#ffffff" };
        const dimmed = dimStyle(style, theme.dim, true);
        expect(dimmed.fill).toBe(lightenColor(ink, theme.dim.lighten));
        expect(dimmed.stroke).toBe(theme.dim.stroke);
        const a = luminance(dimmed.fontColor);
        const b = luminance(dimmed.fill);
        expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toBeGreaterThanOrEqual(3);
      }
    }
  });

  test("lightenColor mixes toward white and writes #rrggbb", () => {
    expect(lightenColor("#000000", 0.5)).toBe("#808080");
    expect(lightenColor("#cfe8f3", 0.5)).toBe("#e7f4f9");
    expect(lightenColor("#abc", 0)).toBe("#aabbcc");
    expect(lightenColor("#123456", 1)).toBe("#ffffff");
    expect(lightenColor("transparent", 0.5)).toBe("transparent");
  });

  test("dimStyle changes colors only; ink fills follow the stroke; transparent stays", () => {
    const dim = { fontColor: "#999999", stroke: "#888888", lighten: 0.5 };
    const theme = builtin("color");
    const box = resolveStyle(theme, {
      kind: "node",
      id: "sumi/box",
      variant: "emphasis",
      tone: "blue",
    }).style;
    const dimmed = dimStyle(box, dim);
    expect(dimmed).toEqual({
      ...box,
      fill: lightenColor(box.fill, 0.5),
      stroke: "#888888",
      fontColor: "#999999",
    });
    expect(Object.isFrozen(dimmed)).toBe(true);
    const junction = resolveStyle(theme, { kind: "node", id: "sumi/junction", variant: "default" });
    expect(dimStyle(junction.style, dim)).toMatchObject({ fill: "#888888", stroke: "#888888" });
    // Ink is compared expanded: #000 and #000000 are the same color.
    const short = { ...junction.style, fill: "#000", stroke: "#000000" };
    expect(dimStyle(short, dim)).toMatchObject({ fill: "#888888", stroke: "#888888" });
    expect(dimStyle({ ...short, fill: "#FFF" }, dim).fill).toBe("#ffffff");
    const hidden = resolveStyle(theme, { kind: "node", id: "sumi/junction", variant: "hidden" });
    expect(dimStyle(hidden.style, dim)).toMatchObject({
      fill: "transparent",
      stroke: "transparent",
    });
    const label = resolveStyle(theme, { kind: "node", id: "sumi/label", variant: "default" });
    expect(dimStyle(label.style, dim)).toMatchObject({ fill: "transparent" });
  });

  test("every built-in theme defines dim; dimmed text and lines are lighter than the originals", () => {
    for (const theme of BUILTIN_THEMES.values()) {
      const dim = theme.dim;
      expect(dim).toBeDefined();
      if (dim === undefined) continue;
      expect(dim.lighten).toBeGreaterThan(0);
      expect(dim.lighten).toBeLessThan(1);
      const luminance = (c: string) => Number.parseInt(c.slice(1, 3), 16);
      const text = theme.base.node.fontColor ?? "#000000";
      expect(luminance(dim.fontColor)).toBeGreaterThan(luminance(text));
      expect(dim.stroke).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  test("theme validation: tokens, missing fields, transparent, type and range", () => {
    const theme = validateTheme(
      definition({
        tokens: { color: { dim: "#AAAAAA" }, amount: { dim: 0.25 } },
        dim: { fontColor: "{color.dim}", stroke: "#999", lighten: "{amount.dim}" },
      }),
    );
    expect(theme.ok && theme.value.dim).toEqual({
      fontColor: "#aaaaaa",
      stroke: "#999",
      lighten: 0.25,
    });
    expect(codes(definition({ dim: { fontColor: "#999999" } as never }))).toEqual([
      ["theme/missing-field", ["dim", "stroke"]],
      ["theme/missing-field", ["dim", "lighten"]],
    ]);
    expect(
      codes(definition({ dim: { fontColor: "transparent", stroke: "1pt", lighten: 2 } })),
    ).toEqual([
      ["theme/invalid-value", ["dim", "fontColor"]],
      ["theme/type-mismatch", ["dim", "stroke"]],
      ["theme/out-of-range", ["dim", "lighten"]],
    ]);
    expect(
      codes(definition({ dim: { fontColor: "#999999", stroke: "#999999", lighten: "50%" } })),
    ).toEqual([["theme/invalid-token", ["dim", "lighten"]]]);
    expect(
      codes(definition({ dim: { fontColor: "#999999", stroke: "#999999", lighten: "1pt" } })),
    ).toEqual([["theme/type-mismatch", ["dim", "lighten"]]]);
    expect(
      codes(
        definition({
          dim: { fontColor: "#999999", stroke: "#999999", lighten: 0.5, fill: "#fff" } as never,
        }),
      ),
    ).toEqual([["theme/unknown-field", ["dim", "fill"]]]);
  });
});

describe("which elements are dimmed", () => {
  test("the group, nested groups, members, the caption and edges with both ends inside", () => {
    const { state } = checkFigure(FIGURE());
    expect([...dimmedElements(state.doc).keys()].sort()).toEqual(
      [
        groupKey("outer"),
        groupKey("inner"),
        nodeKey("a"),
        nodeKey("b"),
        nodeKey("c"),
        nodeKey("outer-caption"),
        edgeKey(undefined, 0),
        edgeKey(undefined, 1),
      ].sort(),
    );
    // Every dimmed element names the field it inherits.
    for (const path of dimmedElements(state.doc).values())
      expect(path).toEqual(["groups", 0, "dim"]);
  });

  test("nested dim is dimmed once and names the outermost dim", () => {
    const nested = FIGURE("color").replace(
      "    variant: dashed\n",
      "    variant: dashed\n    dim: true\n",
    );
    const { state } = checkFigure(nested);
    expect(dimmedElements(state.doc).get(nodeKey("b"))).toEqual(["groups", 0, "dim"]);
    expect(styles(nested)).toEqual(styles(FIGURE("color")));
    // Only the inner group dimmed: the outer group, its caption and a stay.
    const innerOnly = FIGURE("color", "").replace(
      "    variant: dashed\n",
      "    variant: dashed\n    dim: true\n",
    );
    const inner = dimmedElements(checkFigure(innerOnly).state.doc);
    expect([...inner.keys()].sort()).toEqual([groupKey("inner"), nodeKey("b")].sort());
  });

  test("attached nodes: beside a member they are inside, beside the dimmed group outside", () => {
    const source = `version: 1
figure:
  id: f
  theme: color
  layout:
    arrange: { row: { items: [x, panel] } }
groups:
  - id: panel
    dim: true
    arrange: { stack: { items: [a] } }
nodes:
  - { id: x, component: box, label: X }
  - { id: a, component: box, label: A }
  - { id: note, component: label, label: note, attach: { to: a, side: east } }
  - { id: tag, component: label, label: tag, attach: { to: panel, side: north } }
edges:
  - { from: a, to: note, component: line }
  - { from: x, to: tag, component: line }
`;
    const { state } = checkFigure(source);
    expect(state.diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
    const dimmed = dimmedElements(state.doc);
    // Attached to a member: in the member's (dimmed) group.
    expect(dimmed.has(nodeKey("note"))).toBe(true);
    expect(dimmed.has(edgeKey(undefined, 0))).toBe(true);
    // Attached to the dimmed group itself: its sibling, drawn as written.
    expect(dimmed.has(nodeKey("tag"))).toBe(false);
    expect(dimmed.has(edgeKey(undefined, 1))).toBe(false);
  });

  test("edges and zoom lines between two separately dimmed groups are dimmed", () => {
    const source = `version: 1
figure:
  id: f
  theme: color
  layout:
    arrange: { row: { items: [left, right] } }
groups:
  - id: left
    dim: true
    arrange: { stack: { items: [a] } }
  - id: right
    dim: true
    arrange: { stack: { items: [b] } }
nodes:
  - { id: a, component: box, label: A }
  - { id: b, component: box, label: B }
edges:
  - { from: a, to: b }
  - { from: a, to: right, component: zoom }
`;
    const { state } = checkFigure(source);
    expect(state.diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
    const dimmed = dimmedElements(state.doc);
    expect(dimmed.get(edgeKey(undefined, 0))).toEqual(["groups", 0, "dim"]);
    expect(dimmed.has(edgeKey(undefined, 1))).toBe(true);
    const dim = builtin("color").dim;
    for (const index of [0, 1]) {
      expect(style(state.styles ?? new Map(), edgeKey(undefined, index)).stroke).toBe(
        dim?.stroke ?? "",
      );
    }
  });

  test("a figure without dim has no dimmed elements and the same styles as before", () => {
    const { state } = checkFigure(FIGURE("color", ""));
    expect(dimmedElements(state.doc).size).toBe(0);
  });
});

describe("dimmed styles", () => {
  for (const id of BUILTIN_THEMES.keys()) {
    test(`theme ${id}: colors from dim, the variant and tone kept, other properties unchanged`, () => {
      const theme = builtin(id);
      const dim = theme.dim;
      if (dim === undefined) throw new Error("no dim");
      const plain = styles(FIGURE(id, ""));
      const dimmed = styles(FIGURE(id));
      for (const [key, before] of plain) {
        const after = style(dimmed, key);
        const inside = dimmedElements(checkFigure(FIGURE(id)).state.doc).has(key);
        expect(after).toEqual(inside ? dimStyle(before, dim) : before);
      }
      // The inner group keeps its dashes and its tone's (now pale) fill.
      const inner = style(dimmed, groupKey("inner"));
      expect(inner.strokeDash).toBe(style(plain, groupKey("inner")).strokeDash);
      expect(inner.strokeDash).toBeGreaterThan(0);
      expect(inner.fill).toBe(lightenColor(theme.tones.get("blue")?.fill ?? "", dim.lighten));
      // The caption is gray; the edges into and out of the group are not.
      expect(style(dimmed, nodeKey("outer-caption")).fontColor).toBe(dim.fontColor);
      expect(style(dimmed, edgeKey(undefined, 2))).toEqual(style(plain, edgeKey(undefined, 2)));
      expect(style(dimmed, edgeKey(undefined, 4))).toEqual(style(plain, edgeKey(undefined, 4)));
      expect(style(dimmed, nodeKey("x"))).toEqual(style(plain, nodeKey("x")));
    });
  }

  test("a legend, tokens cells and zoom lines inside a dimmed group are dimmed", () => {
    const source = `version: 1
figure:
  id: f
  theme: color
  layout:
    arrange: { row: { items: [src, panel] } }
groups:
  - id: panel
    dim: true
    arrange: { stack: { items: [seq, key] } }
nodes:
  - { id: src, component: box, label: Src }
  - { id: seq, component: tokens, props: { cells: [A, B] }, tone: green }
  - id: key
    component: legend
    props:
      entries:
        - { edge: { variant: dashed }, label: skip }
        - { node: { tone: green }, label: token }
edges:
  - { from: seq.1, to: seq.2, variant: dashed }
  - { from: src, to: panel, component: zoom }
`;
    const { state } = checkFigure(source);
    expect(state.diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
    const dim = builtin("color").dim;
    const map = state.styles ?? new Map();
    const dimmed = dimmedElements(state.doc);
    const parts = [...map.keys()].filter(
      (k) => k.startsWith("n:key-") || k.startsWith("e:key-") || k.startsWith("n:seq-"),
    );
    expect(parts.length).toBeGreaterThanOrEqual(7);
    for (const key of [...parts, groupKey("key"), edgeKey(undefined, 0)]) {
      expect(dimmed.has(key)).toBe(true);
      const s = style(map, key);
      if (s.fontColor !== "transparent") expect(s.fontColor).toBe(dim?.fontColor ?? "");
    }
    // The zoom from outside to the dimmed group is not.
    expect(dimmed.has(edgeKey(undefined, 1))).toBe(false);
  });
});

describe("dim diagnostics", () => {
  test("dim must be true", () => {
    const { state } = checkFigure(FIGURE("color", "    dim: false\n"));
    expect(state.diagnostics.map((d) => [d.code, d.path])).toEqual([
      ["schema/invalid-value", ["groups", 0, "dim"]],
    ]);
  });

  test("an image inside a dimmed group is drawn as it is (theme/undimmed-image)", () => {
    const source = FIGURE().replace(
      "  - { id: a, component: box, label: A, tone: orange }",
      "  - { id: a, component: image, props: { src: x.png, width: 20pt, height: 20pt } }",
    );
    const { state } = checkFigure(source);
    const found = state.diagnostics.filter((d) => d.code === "theme/undimmed-image");
    expect(found.map((d) => [d.severity, d.path, d.subject])).toEqual([
      ["warning", ["nodes", 1], { kind: "node", id: "a" }],
    ]);
    expect(found[0]?.message).toContain('dimmed group "outer"');
  });

  test("a theme without dim draws dimmed groups as they are (theme/missing-dim)", () => {
    const result = validateTheme(definition());
    if (!result.ok) throw new Error("invalid");
    const { state } = checkFigure(FIGURE());
    state.diagnostics = [];
    reportDim(state, () => undefined, result.value, dimmedElements(state.doc));
    expect(state.diagnostics.map((d) => [d.code, d.severity, d.path])).toEqual([
      ["theme/missing-dim", "warning", ["groups", 0, "dim"]],
    ]);
  });
});
