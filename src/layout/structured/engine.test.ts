import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { stringify } from "yaml";
import { buildFigureIR } from "../../compiler/ir";
import { checkFigure } from "../../core/check";
import { getOutlineRenderer } from "../../core/outline";
import { getProfile } from "../../core/profile/builtin";
import { getFontSet } from "../../core/theme/fonts";
import { measureLabel } from "../../lint/geometry/measure";
import { type LayoutFigureOptions, layoutStructuredFigure } from "../index";
import type { LayoutIR, NodeLayout, Rect } from "../ir";
import type { TextMeasurer } from "../text";
import { layoutStructured } from "./engine";

const fixtures = `${import.meta.dir}/../../../tests/fixtures`;
const goldens = `${fixtures}/layout`;
// Set SUMI_UPDATE_GOLDEN=1 to rewrite the expected Layout IR JSON.
const update = process.env.SUMI_UPDATE_GOLDEN === "1";

/** Every character is half an em wide; ascender 0.8 em, descender 0.2 em. */
const FAKE: TextMeasurer = {
  lineWidth: (text, _font, size) => ([...text].length * size) / 2,
  verticalMetrics: (_font, size) => ({ ascent: 0.8 * size, descent: 0.2 * size }),
};

/** 4mm (the paper profiles' arrange gap) in units. */
const GAP = (4 / 25.4) * 72 * 2;
const MARGIN = 11;

function layoutOf(text: string, options: LayoutFigureOptions = {}): LayoutIR {
  const result = layoutStructuredFigure(text, { measurer: FAKE, ...options });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  return result.value.layout;
}

/** A structured figure (minimal theme: 16-unit text, 18-unit bold group labels). */
function figure(arrange: unknown, nodes: unknown[], groups: unknown[] = []): string {
  return stringify({
    version: 1,
    figure: { id: "t", layout: { arrange } },
    groups,
    nodes,
  });
}

const box = (id: string, label = "A", extra: object = {}) => ({
  id,
  component: "box",
  label,
  ...extra,
});

function rectOf(layout: LayoutIR, id: string): Rect {
  const element =
    layout.nodes.find((n) => n.key === `n:${id}`) ?? layout.groups.find((g) => g.key === `g:${id}`);
  if (element === undefined) throw new Error(`no ${id}`);
  return element.rect;
}

/** `inner` lies in `outer` (up to the 1/1000-unit rounding of both). */
const inside = (outer: Rect, inner: Rect) =>
  inner.x >= outer.x - 0.002 &&
  inner.y >= outer.y - 0.002 &&
  inner.x + inner.width <= outer.x + outer.width + 0.002 &&
  inner.y + inner.height <= outer.y + outer.height + 0.002;

const close = (actual: number, expected: number) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(0.001);

describe("stack and row", () => {
  test("items follow each other with the profile's default gap, from the margin", () => {
    // "A": 8 × 20 label → 36 × 34 box; "ABCD": 60 × 34.
    const layout = layoutOf(figure({ stack: { items: ["a", "b"] } }, [box("a"), box("b", "ABCD")]));
    expect(rectOf(layout, "a")).toEqual({ x: 23, y: 11, width: 36, height: 34 });
    const b = rectOf(layout, "b");
    expect(b).toMatchObject({ x: 11, width: 60, height: 34 });
    close(b.y, 11 + 34 + GAP);
    expect(layout.margin).toBe(MARGIN);
    expect(layout.canvas).toEqual({ width: 82, height: Math.ceil(68 + GAP + 2 * MARGIN) });
    expect(layout.engine).toBe("sumi-structured");
  });

  test("a written gap wins; up and left reverse the order", () => {
    const up = layoutOf(
      figure({ stack: { direction: "up", gap: 0, items: ["a", "b"] } }, [box("a"), box("b")]),
    );
    expect(rectOf(up, "b").y).toBe(11);
    expect(rectOf(up, "a").y).toBe(45);
    const left = layoutOf(
      figure({ row: { direction: "left", gap: "6pt", items: ["a", "b"] } }, [box("a"), box("b")]),
    );
    expect(rectOf(left, "b").x).toBe(11);
    expect(rectOf(left, "a").x).toBe(11 + 36 + 12);
  });

  test("the profile's arrange gap applies when gap is omitted", () => {
    const profile = getProfile("presentation-16x9");
    const layout = layoutOf(
      figure({ row: { items: ["a", "b"] } }, [box("a"), box("b")], []),
      profile === undefined ? {} : { profile },
    );
    close(rectOf(layout, "b").x - rectOf(layout, "a").x, 64 + 2 * GAP);
    // Doubled node padding: 8 + 2·28 wide.
    expect(rectOf(layout, "a").width).toBe(64);
  });

  test.each([
    ["start", 11],
    ["center", 21],
    ["end", 31],
  ])("align %s places items on the cross axis", (align, y) => {
    // "A\nB" is 2 lines: 40 + 14 = 54 high; "A" 34.
    const layout = layoutOf(
      figure({ row: { align, items: ["a", "t"] } }, [box("a"), box("t", "A\nB")]),
    );
    expect(rectOf(layout, "a").y).toBe(y);
    expect(rectOf(layout, "t").y).toBe(11);
  });

  test("stretch widens resizable nodes; circles, labels and explicit sizes are centered", () => {
    const layout = layoutOf(
      figure({ stack: { align: "stretch", gap: 0, items: ["a", "b", "c", "d", "l"] } }, [
        box("a"),
        box("b", "ABCD"),
        { id: "c", component: "circle", label: "A" },
        box("d", "A", { props: { width: "20pt" } }),
        { id: "l", component: "label", label: "A" },
      ]),
    );
    expect(rectOf(layout, "a")).toMatchObject({ x: 11, width: 60 });
    // Circle: max(20 + 14, hypot(8 + 7, 20 + 7)) = 34.
    expect(rectOf(layout, "c")).toMatchObject({ x: 11 + 13, width: 34, height: 34 });
    expect(rectOf(layout, "d")).toMatchObject({ x: 11 + 10, width: 40 });
    expect(rectOf(layout, "l")).toMatchObject({ x: 11 + 26, width: 8, height: 20 });
  });

  test("alignment is inherited by boxes of the same axis only", () => {
    const sameAxis = layoutOf(
      figure({ stack: { align: "end", gap: 0, items: [{ stack: { items: ["a", "b"] } }, "c"] } }, [
        box("a"),
        box("b", "ABCD"),
        box("c", "ABCDEFGH"),
      ]),
    );
    // c is 92 wide; the inner stack (60) and a in it are right-aligned.
    const right = (r: Rect) => r.x + r.width;
    expect(right(rectOf(sameAxis, "a"))).toBe(11 + 92);
    expect(right(rectOf(sameAxis, "b"))).toBe(11 + 92);
    const crossAxis = layoutOf(
      figure(
        { stack: { align: "end", gap: 0, items: [{ row: { gap: 0, items: ["a", "t"] } }, "c"] } },
        [box("a"), box("t", "A\nB"), box("c", "ABCDEFGH")],
      ),
    );
    // The row is placed at the end, but its items are centered vertically, not bottom-aligned.
    expect(rectOf(crossAxis, "a").y).toBe(11 + 10);
    expect(right(rectOf(crossAxis, "t"))).toBe(11 + 92);
  });

  test("a box with more main-axis room than it needs centers its items", () => {
    const layout = layoutOf(
      figure({ row: { align: "stretch", gap: 0, items: [{ stack: { items: ["a"] } }, "t"] } }, [
        box("a"),
        box("t", "A\nB\nC"),
      ]),
    );
    // t is 74 high; the stack is stretched to 74 and centers a (34).
    expect(rectOf(layout, "a").y).toBe(11 + 20);
  });
});

describe("groups", () => {
  test("padding surrounds the content; a label takes its height and half the padding on top", () => {
    const layout = layoutOf(
      figure(
        { stack: { items: ["g"] } },
        [box("a")],
        [{ id: "g", label: "G", arrange: { stack: { items: ["a"] } } }],
      ),
    );
    // Label: 18-unit bold, 9 × 22.5 → 23 high, + 8 below; padding 16.
    const group = layout.groups[0];
    expect(group?.rect).toEqual({ x: 11, y: 11, width: 68, height: 34 + 32 + 23 + 8 });
    expect(group?.content).toEqual({ x: 27, y: 58, width: 36, height: 34 });
    expect(rectOf(layout, "a")).toEqual({ x: 27, y: 58, width: 36, height: 34 });
    expect(group?.label?.box).toEqual({ x: 40.5, y: 27, width: 9, height: 22.5 });
    // Baseline: top + half-leading (22.5 − 18) / 2 + ascender 14.4.
    expect(group?.label?.anchor).toEqual({ x: 45, y: 27 + 2.25 + 14.4 });
    expect(layout.nodes[0]?.parent).toBe("g:g");
  });

  describe("labelAt (#127)", () => {
    // A wide content (ABCDEFGH: 92 wide) so that left / centre / right differ.
    const labelled = (labelAt?: string) =>
      layoutOf(
        figure(
          { stack: { items: ["g"] } },
          [box("a", "ABCDEFGH")],
          [
            {
              id: "g",
              label: "G",
              ...(labelAt !== undefined && { labelAt }),
              arrange: { stack: { items: ["a"] } },
            },
          ],
        ),
      );

    test("a whitespace-only label keeps its blank band, which labelAt moves; no label has none", () => {
      // component/label-at-without-label warns about both; the figure still lays out.
      const layout = (label: string, labelAt: string) =>
        layoutOf(
          figure(
            { stack: { items: ["g"] } },
            [box("a")],
            [{ id: "g", label, labelAt, arrange: { stack: { items: ["a"] } } }],
          ),
        ).groups[0];
      const top = layout(" ", "top");
      const bottom = layout(" ", "bottom");
      if (top === undefined || bottom === undefined) throw new Error("no group");
      // The band: 23 (the 22.5-unit line rounded up) + 8, above or below the child.
      expect(top.rect.height).toBe(34 + 32 + 23 + 8);
      expect(bottom.rect).toEqual(top.rect);
      expect(top.content.y).toBe(top.rect.y + 16 + 23 + 8);
      expect(bottom.content.y).toBe(bottom.rect.y + 16);
      const none = layout("", "bottom");
      expect(none?.label).toBeUndefined();
      expect(none?.rect.height).toBe(34 + 32);
      expect(none?.content.y).toBe((none?.rect.y ?? 0) + 16);
    });

    test("omitted is top (centre): the same Layout IR", () => {
      expect(JSON.stringify(labelled("top"))).toBe(JSON.stringify(labelled()));
    });

    test.each([
      ["top-left", "left", "top"],
      ["top", "center", "top"],
      ["top-right", "right", "top"],
      ["bottom-left", "left", "bottom"],
      ["bottom", "center", "bottom"],
      ["bottom-right", "right", "bottom"],
    ] as const)("%s: the band and the label sit at the %s / %s", (labelAt, x, y) => {
      const layout = labelled(labelAt);
      const group = layout.groups[0];
      if (group?.label === undefined) throw new Error("no label");
      const { rect, content } = group;
      const label = group.label.box;
      // The group's size does not depend on the position.
      expect(rect).toEqual({ x: 11, y: 11, width: 92 + 32, height: 34 + 32 + 23 + 8 });
      expect(inside(rect, label)).toBe(true);
      // Inside the padding, on the requested side.
      if (x === "left") close(label.x, rect.x + 16);
      if (x === "right") close(label.x + label.width, rect.x + rect.width - 16);
      if (x === "center") close(label.x + label.width / 2, rect.x + rect.width / 2);
      if (y === "top") {
        close(label.y, rect.y + 16);
        // The band (label + half the padding, label height rounded up) is above the content.
        expect(content.y).toBe(rect.y + 16 + 23 + 8);
      } else {
        close(label.y + label.height, rect.y + rect.height - 16);
        expect(content.y).toBe(rect.y + 16);
        expect(content.y + content.height).toBe(label.y + label.height - 22.5 - 8 - 0.5);
      }
      expect(content.height).toBe(34);
      expect(rectOf(layout, "a")).toEqual(content);
      // The anchor stays the label's horizontal centre (text-anchor: middle).
      close(group.label.anchor.x, label.x + label.width / 2);
    });
  });

  test("an empty group is its padding; a wide label widens the group and centers the content", () => {
    const layout = layoutOf(
      figure(
        { row: { gap: 0, items: ["e", "g"] } },
        [box("a")],
        [
          { id: "e" },
          { id: "g", label: "A long group label", arrange: { stack: { items: ["a"] } } },
        ],
      ),
    );
    expect(rectOf(layout, "e")).toMatchObject({ width: 32, height: 32 });
    const g = rectOf(layout, "g");
    expect(g.width).toBe(162 + 32);
    close(rectOf(layout, "a").x, g.x + 16 + (162 - 36) / 2);
  });

  test("groups are listed parents first", () => {
    const layout = layoutOf(
      figure(
        { stack: { items: ["outer"] } },
        [box("a")],
        [
          { id: "inner", arrange: { stack: { items: ["a"] } } },
          { id: "outer", arrange: { stack: { items: ["inner"] } } },
        ],
      ),
    );
    expect(layout.groups.map((g) => g.key)).toEqual(["g:outer", "g:inner"]);
    expect(layout.groups[1]?.parent).toBe("g:outer");
  });
});

describe("attach", () => {
  const gap = (2 / 25.4) * 72 * 2;

  test.each(["west", "east", "north", "south"] as const)(
    "%s: beside the target, gap away, centered on that side",
    (side) => {
      const layout = layoutOf(
        figure({ stack: { items: ["a"] } }, [
          box("a", "ABCD"),
          box("n", "A", { attach: { to: "a", side, gap: "2mm" } }),
        ]),
      );
      const a = rectOf(layout, "a");
      const n = rectOf(layout, "n");
      const cx = (r: Rect) => r.x + r.width / 2;
      const cy = (r: Rect) => r.y + r.height / 2;
      if (side === "west") close(a.x - (n.x + n.width), gap);
      if (side === "east") close(n.x - (a.x + a.width), gap);
      if (side === "north") close(a.y - (n.y + n.height), gap);
      if (side === "south") close(n.y - (a.y + a.height), gap);
      if (side === "west" || side === "east") close(cy(n), cy(a));
      else close(cx(n), cx(a));
      // The content starts at the margin whichever element is outermost.
      expect(Math.min(a.x, n.x)).toBe(MARGIN);
      expect(Math.min(a.y, n.y)).toBe(MARGIN);
      expect(layout.nodes.find((x) => x.key === "n:n")?.placement).toBe("attach");
    },
  );

  test("chains and groups as targets", () => {
    const layout = layoutOf(
      figure(
        { stack: { items: ["g"] } },
        [
          box("a"),
          box("n", "N", { attach: { to: "g", side: "west" } }),
          box("m", "M", { attach: { to: "n", side: "north" } }),
        ],
        [{ id: "g", arrange: { stack: { items: ["a"] } } }],
      ),
    );
    const g = rectOf(layout, "g");
    const n = rectOf(layout, "n");
    const m = rectOf(layout, "m");
    expect(n.x + n.width).toBe(g.x);
    expect(m.y + m.height).toBe(n.y);
    expect(layout.nodes.find((x) => x.key === "n:m")?.parent).toBeUndefined();
  });

  test("a group grows to hold the nodes attached inside it", () => {
    const layout = layoutOf(
      figure(
        { stack: { items: ["g"] } },
        [box("a", "ABCD"), box("n", "A", { attach: { to: "a", side: "west" } })],
        [{ id: "g", arrange: { stack: { items: ["a"] } } }],
      ),
    );
    const g = layout.groups[0];
    const a = rectOf(layout, "a");
    const n = rectOf(layout, "n");
    expect(layout.nodes.find((x) => x.key === "n:n")?.parent).toBe("g:g");
    expect(n.x).toBe((g?.rect.x ?? 0) + 16);
    expect(a.x).toBe(n.x + 36);
    expect(g?.rect.width).toBe(36 + 60 + 32);
    expect(g?.content).toEqual({ x: n.x, y: a.y, width: 96, height: 34 });
  });
});

describe("sizes from props and outline components", () => {
  test.each([
    ["circle", { width: "20pt" }],
    ["circle", { height: "20pt" }],
    ["square", { width: "20pt" }],
    ["square", { height: "20pt" }],
  ])("%s with only %o stays square", (component, props) => {
    const layout = layoutOf(
      figure({ stack: { items: ["c"] } }, [{ id: "c", component, label: "A", props }]),
    );
    expect(rectOf(layout, "c")).toMatchObject({ width: 40, height: 40 });
  });

  const MULTILINE = "Long label here\nSecond line here\nThird line here";
  test.each(["trapezoid", "stack"])(
    "%s: sized by its renderer's footprint, never stretched, the label in its safe area",
    (component) => {
      const nodes = [
        { id: "o", component, label: MULTILINE },
        box("o2", "x", { attach: { to: "o", side: "east" } }),
        box("big", "X", { props: { width: "200pt", height: "200pt" } }),
      ];
      // Stretching would change the renderer's safe area (a taller trapezoid
      // has deeper slants), so outline components keep their footprint.
      for (const arrange of [
        { stack: { align: "center", items: ["o", "big"] } },
        { stack: { align: "stretch", items: ["o", "big"] } },
        { row: { align: "stretch", items: ["o", "big"] } },
      ]) {
        const result = layoutStructuredFigure(figure(arrange, nodes));
        if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
        const { ir, layout } = result.value;
        const node = layout.nodes.find((n) => n.key === "n:o");
        const irNode = ir.nodes.find((n) => n.key === "n:o");
        const renderer = getOutlineRenderer(irNode?.render?.renderer ?? "");
        if (node?.label === undefined || renderer === undefined) throw new Error("no outline");
        const params = renderer.params.parse(irNode?.render?.params ?? {});
        const { safeArea } = renderer.draw(node.rect, params);
        expect(inside(safeArea, node.label.box)).toBe(true);
        const padded = {
          width: Math.ceil(node.label.width + 28),
          height: Math.ceil(node.label.height + 14),
        };
        const footprint = renderer.footprint(padded, params);
        expect(node.rect.width).toBe(Math.ceil(footprint.width));
        expect(node.rect.height).toBe(Math.ceil(footprint.height));
      }
    },
  );
});

describe("labels and the geometry lint's re-measurement", () => {
  test.each(["Add & Norm", "Two\nlines", "\nblank\n\nlines\n", "Japanese 日本語\nand more"])(
    "%j: the glyph boxes the lint measures lie inside the layout's line box",
    (label) => {
      const text = figure({ stack: { items: ["t", "l"] } }, [
        box("t", label),
        { id: "l", component: "label", label },
      ]);
      const result = layoutStructuredFigure(text);
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
      const fonts = getFontSet(result.value.ir.meta.fontSetId);
      if (fonts === undefined) throw new Error("no fonts");
      for (const node of result.value.layout.nodes) {
        const layoutLabel = node.label;
        if (layoutLabel === undefined) throw new Error("no label");
        const measured = measureLabel(
          {
            text: layoutLabel.lines.join("\n"),
            anchor: layoutLabel.anchor,
            fontSizeUnits: layoutLabel.fontSizeUnits,
            lines: layoutLabel.lines.length,
            lineHeightUnits: layoutLabel.lineHeightUnits,
            font: layoutLabel.font,
          },
          fonts,
        );
        expect(measured.texts).toEqual([...layoutLabel.lines]);
        for (const line of measured.visibleLines) expect(inside(layoutLabel.box, line)).toBe(true);
        expect(inside(node.rect, layoutLabel.box)).toBe(true);
      }
    },
  );
});

describe("output", () => {
  test("labels: centered in the node, baseline from the font's metrics", () => {
    const layout = layoutOf(figure({ stack: { items: ["t"] } }, [box("t", "AB\nA")]));
    const label = layout.nodes[0]?.label;
    expect(label).toMatchObject({
      lines: ["AB", "A"],
      lineWidths: [16, 8],
      font: "regular",
      fontSizeUnits: 16,
      lineHeightUnits: 20,
      width: 16,
      height: 40,
      box: { x: 25, y: 18, width: 16, height: 40 },
      anchor: { x: 33, y: 18 + 2 + 12.8 },
    });
  });

  test("edges keep their anchors and measured labels, without a route", () => {
    const text = stringify({
      version: 1,
      figure: { id: "t", layout: { arrange: { stack: { items: ["a", "b"] } } } },
      nodes: [box("a"), box("b")],
      edges: [
        { from: "a", to: "b", fromAnchor: "south:0.25", toAnchor: "north", label: "x" },
        { from: "a", to: "b" },
      ],
    });
    const layout = layoutOf(text, { route: false });
    expect(layout.edges).toEqual([
      expect.objectContaining({
        key: "e:#0",
        from: "n:a",
        to: "n:b",
        fromAnchor: { side: "south", offset: 0.25 },
        toAnchor: { side: "north", offset: 0.5 },
        labelMetrics: expect.objectContaining({ lines: ["x"], fontSizeUnits: 14 }),
      }),
      { key: "e:#1", kind: "edge", from: "n:a", to: "n:b" },
    ]);
    expect(layout.edges[0]?.route).toBeUndefined();
  });

  test("the result is frozen", () => {
    const layout = layoutOf(figure({ stack: { items: ["a"] } }, [box("a")]));
    expect(Object.isFrozen(layout)).toBe(true);
    expect(Object.isFrozen(layout.nodes[0]?.rect)).toBe(true);
  });

  test("an auto figure is not laid out here", () => {
    const check = checkFigure(stringify({ version: 1, figure: { id: "t" }, nodes: [box("a")] }));
    expect(() => layoutStructured(buildFigureIR(check))).toThrow(/structured figure/);
  });

  test("a figure with errors returns its diagnostics", () => {
    const result = layoutStructuredFigure(figure({ stack: { items: ["a", "zz"] } }, [box("a")]));
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((d) => d.code)).toContain("layout/unknown-item");
  });
});

describe.each(["a-transformer", "b-adaln-panel", "group-label-at", "group-caption", "align-unet", "align-side-kv"])(
  "%s (bundled fonts)",
  (name) => {
    const text = readFileSync(`${fixtures}/figures/layout/${name}.sumi.yaml`, "utf8");
    const run = () => {
      const result = layoutStructuredFigure(text, { route: false });
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
      return result.value.layout;
    };

    test("is byte-identical across runs and matches the golden Layout IR", () => {
      const first = `${JSON.stringify(run(), null, 2)}\n`;
      expect(`${JSON.stringify(run(), null, 2)}\n`).toBe(first);
      const golden = `${goldens}/${name}.layout.json`;
      if (update) {
        mkdirSync(goldens, { recursive: true });
        writeFileSync(golden, first);
      }
      expect(first).toBe(readFileSync(golden, "utf8"));
    });

    test("touching rectangles still touch after rounding; everything is inside the margins", () => {
      const layout = run();
      const all = [...layout.nodes, ...layout.groups];
      for (const { rect } of all) {
        expect(rect.x).toBeGreaterThanOrEqual(layout.margin);
        expect(rect.y).toBeGreaterThanOrEqual(layout.margin);
        expect(rect.x + rect.width).toBeLessThanOrEqual(layout.canvas.width - layout.margin + 1e-9);
        expect(rect.y + rect.height).toBeLessThanOrEqual(
          layout.canvas.height - layout.margin + 1e-9,
        );
      }
      if (name === "a-transformer") {
        // A stack with gap 0 (direction up): norm1 sits exactly on mha.
        const mha = rectOf(layout, "enc-mha");
        const norm = rectOf(layout, "enc-norm1");
        expect(norm.y + norm.height).toBe(mha.y);
      }
    });
  },
);

describe("randomized containment", () => {
  /** Park–Miller LCG: deterministic across runs and platforms. */
  function random(seed: number) {
    let state = seed;
    return () => {
      state = (state * 48271) % 2147483647;
      return state / 2147483647;
    };
  }

  /** A random structured figure with nested boxes, groups and attached nodes inside groups. */
  function randomFigure(seed: number): string {
    const rnd = random(seed);
    const pick = <T>(list: readonly T[]): T => list[Math.floor(rnd() * list.length)] as T;
    const nodes: object[] = [];
    const groups: object[] = [];
    let next = 0;
    const leaf = (): string => {
      const id = `n${next++}`;
      const label = "W".repeat(1 + Math.floor(rnd() * 8)) + (rnd() < 0.3 ? "\nx" : "");
      const component = pick(["box", "box", "circle", "label", "ellipse", "diamond", "cylinder"]);
      nodes.push({ id, component, label });
      return id;
    };
    const arrange = (depth: number, inGroup: string[]): object => {
      const kind = pick(["stack", "row"]);
      const items: unknown[] = [];
      const count = 1 + Math.floor(rnd() * 3);
      for (let i = 0; i < count; i++) {
        const r = rnd();
        if (depth < 3 && r < 0.2) items.push(arrange(depth + 1, inGroup));
        else if (depth < 3 && r < 0.4) items.push(group(depth + 1));
        else {
          const id = leaf();
          inGroup.push(id);
          items.push(id);
        }
      }
      return {
        [kind]: {
          ...(rnd() < 0.5 && { align: pick(["start", "center", "end", "stretch"]) }),
          ...(rnd() < 0.5 && { gap: pick([0, "1mm", "3pt"]) }),
          ...(rnd() < 0.3 && { direction: kind === "stack" ? "up" : "left" }),
          items,
        },
      };
    };
    const group = (depth: number): string => {
      const id = `g${next++}`;
      const members: string[] = [];
      const tree = arrange(depth, members);
      groups.push({ id, ...(rnd() < 0.5 && { label: "Group" }), arrange: tree });
      // Attach a few nodes to members (and to attached nodes: chains).
      const targets = [...members];
      for (let i = 0; targets.length > 0 && i < Math.floor(rnd() * 3); i++) {
        const attached = `n${next++}`;
        nodes.push({
          id: attached,
          component: "box",
          label: "A".repeat(1 + Math.floor(rnd() * 5)),
          attach: {
            to: pick(targets),
            side: pick(["north", "east", "south", "west"]),
            gap: pick([0, "2mm"]),
          },
        });
        targets.push(attached);
      }
      return id;
    };
    const root = {
      [pick(["stack", "row"])]: {
        align: pick(["center", "stretch", "stretch"]),
        items: [group(1), group(1), leaf()],
      },
    };
    return stringify({ version: 1, figure: { id: "r", layout: { arrange: root } }, groups, nodes });
  }

  test("every node and group (attached ones included) lies inside its parent's content", () => {
    let attachedInGroups = 0;
    let roomyWithAttached = 0;
    for (let seed = 1; seed <= 1000; seed++) {
      // Placement only: routing is not under test here, and would dominate the time.
      const layout = layoutOf(randomFigure(seed), { route: false });
      const groups = new Map(layout.groups.map((g) => [g.key, g]));
      const children: (NodeLayout | (typeof layout.groups)[number])[] = [
        ...layout.nodes,
        ...layout.groups,
      ];
      for (const child of children) {
        if (child.parent === undefined) continue;
        const parent = groups.get(child.parent);
        if (parent === undefined) throw new Error(`no parent ${child.parent}`);
        if (child.kind === "node" && child.placement === "attach") attachedInGroups++;
        expect({ seed, key: child.key, inside: inside(parent.content, child.rect) }).toEqual({
          seed,
          key: child.key,
          inside: true,
        });
      }
      for (const group of layout.groups) {
        expect(inside(group.rect, group.content)).toBe(true);
        if (group.label !== undefined) expect(inside(group.rect, group.label.box)).toBe(true);
        // Groups with attached nodes that got more room than their content needs
        // (stretched, or widened by their label): the case the overhang argument covers.
        const members = children.filter((c) => c.parent === group.key);
        const extent = members.reduce(
          (r, { rect }) => ({
            x0: Math.min(r.x0, rect.x),
            x1: Math.max(r.x1, rect.x + rect.width),
            y0: Math.min(r.y0, rect.y),
            y1: Math.max(r.y1, rect.y + rect.height),
          }),
          { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity },
        );
        const roomy =
          group.content.width > extent.x1 - extent.x0 + 1 ||
          group.content.height > extent.y1 - extent.y0 + 1;
        if (roomy && members.some((c) => c.kind === "node" && c.placement === "attach")) {
          roomyWithAttached++;
        }
      }
    }
    expect(attachedInGroups).toBeGreaterThan(100);
    expect(roomyWithAttached).toBeGreaterThan(20);
  });
});
