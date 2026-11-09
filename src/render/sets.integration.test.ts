import { describe, expect, test } from "bun:test";
import { BUILTIN_THEMES } from "../core/theme/builtin";
import { toOklch } from "../core/theme/color-math";
import { multiplyTints, tintOver } from "../core/theme/set-style";
import type { SetLayout } from "../layout/ir";
import { lintGeometry } from "../lint/geometry";
import { svgToPdf } from "./pdf";
import { parsePdf } from "./pdf/testing";
import { svgToEditablePptx, svgToPptx } from "./pptx";
import { readPptx } from "./pptx/testing";
import { type RenderedStructuredFigure, renderFigure } from "./render";
import { attribute, descendants, parseXml } from "./xml";

/** Two overlapping sets: `shared` belongs to both. Unit 10mm. */
const venn = (extra = "", theme = "color", sets?: string) => `version: 1
figure:
  id: venn
  theme: ${theme}
  profile: paper-double
  layout:
    arrange:
      place:
        unit: 10mm
        items:
          - { item: a1, at: [0, 0] }
          - { item: a2, at: [0.2, 2] }
          - { item: shared, at: [1.7, 1] }
          - { item: b1, at: [3.2, 0] }
          - { item: b2, at: [3.2, 2] }
nodes:
  - { id: a1, component: box, label: A1 }
  - { id: a2, component: box, label: A2 }
  - { id: shared, component: box, label: S, tone: gray, variant: filled }
  - { id: b1, component: box, label: B1 }
  - { id: b2, component: box, label: B2 }
${extra}sets:
${
  sets ??
  `  - { id: left, label: Left, members: [a1, a2, shared], tone: blue, labelAt: top-left }
  - { id: right, label: Right, members: [shared, b1, b2], tone: green, labelAt: top-right }`
}
`;

async function render(source: string): Promise<RenderedStructuredFigure> {
  const result = await renderFigure(source);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  if (!("layout" in result.value)) throw new Error("expected a structured figure");
  return result.value;
}

const center = (r: { x: number; y: number; width: number; height: number }) => ({
  x: r.x + r.width / 2,
  y: r.y + r.height / 2,
});

function contains(set: SetLayout, p: { x: number; y: number }): boolean {
  const o = set.outline;
  if (o.kind === "ellipse") return ((p.x - o.cx) / o.rx) ** 2 + ((p.y - o.cy) / o.ry) ** 2 <= 1;
  throw new Error("test uses circles");
}

describe("a Venn diagram of two sets", () => {
  test("a node in both sets lies in the overlap, and every member is enclosed", async () => {
    const rendered = await render(venn());
    const { layout } = rendered;
    const [left, right] = layout.sets ?? [];
    if (left === undefined || right === undefined) throw new Error("two sets expected");
    expect([left.id, right.id]).toEqual(["left", "right"]);
    const rect = (key: string) => layout.nodes.find((n) => n.key === key)?.rect;
    const shared = rect("n:shared");
    if (shared === undefined) throw new Error("missing node");
    // Every corner of every member is inside its set; the shared node is inside both.
    const corners = (r: NonNullable<typeof shared>) => [
      { x: r.x, y: r.y },
      { x: r.x + r.width, y: r.y },
      { x: r.x, y: r.y + r.height },
      { x: r.x + r.width, y: r.y + r.height },
    ];
    for (const key of ["n:a1", "n:a2", "n:shared"])
      for (const p of corners(rect(key) as NonNullable<typeof shared>))
        expect(contains(left, p)).toBe(true);
    for (const key of ["n:b1", "n:b2", "n:shared"])
      for (const p of corners(rect(key) as NonNullable<typeof shared>))
        expect(contains(right, p)).toBe(true);
    // Non-members stay out: a1 is not in the right set, b1 not in the left.
    expect(corners(rect("n:b1") as NonNullable<typeof shared>).some((p) => contains(left, p))).toBe(
      false,
    );
    expect(
      corners(rect("n:a1") as NonNullable<typeof shared>).some((p) => contains(right, p)),
    ).toBe(false);
    // The shared node's center lies in the lens where the circles overlap.
    expect(contains(left, center(shared))).toBe(true);
    expect(contains(right, center(shared))).toBe(true);
    // No warnings: the figure is clean.
    expect(lintGeometry(rendered, { source: venn() }).filter((d) => d.severity !== "info")).toEqual(
      [],
    );
  });

  test("the canvas holds the outlines and labels, and sets reserve no arrange space", async () => {
    const { layout } = await render(venn());
    const { canvas, margin } = layout;
    for (const set of layout.sets ?? []) {
      for (const box of [set.rect, ...(set.label ? [set.label.box] : [])]) {
        expect(box.x).toBeGreaterThanOrEqual(margin - 1e-6);
        expect(box.y).toBeGreaterThanOrEqual(margin - 1e-6);
        expect(box.x + box.width).toBeLessThanOrEqual(canvas.width - margin + 1e-6);
        expect(box.y + box.height).toBeLessThanOrEqual(canvas.height - margin + 1e-6);
      }
    }
    // Moving the same members without the sets keeps their relative positions.
    const without = await render(
      venn()
        .replace(/sets:[\s\S]*$/, "")
        .concat("sets: []\n")
        .replace("sets: []\n", ""),
    );
    const a = (l: typeof layout, key: string) => l.nodes.find((n) => n.key === key)?.rect;
    const dx = (a(layout, "n:b1")?.x ?? 0) - (a(layout, "n:a1")?.x ?? 0);
    expect((a(without.layout, "n:b1")?.x ?? 0) - (a(without.layout, "n:a1")?.x ?? 0)).toBeCloseTo(
      dx,
      6,
    );
    expect(without.layout.sets).toBeUndefined();
  });

  test("SVG: below the nodes and edges, above the groups, with an opaque tint (#440)", async () => {
    const source = venn().replace("sets:", "edges:\n  - { from: a1, to: b1 }\nsets:");
    const { svg } = await render(source);
    const at = (needle: string) => svg.indexOf(needle);
    const firstSet = at('class="sumi-set sumi-set-left"');
    expect(firstSet).toBeGreaterThan(0);
    expect(at('class="sumi-set sumi-set-right"')).toBeGreaterThan(firstSet);
    expect(at("sumi-k-n--a1")).toBeGreaterThan(at('class="sumi-set sumi-set-right"'));
    expect(at("sumi-k-e--_0")).toBeGreaterThan(at("sumi-k-n--b2"));
    // The outlines carry no fill; the tints are opaque shapes of their own, painted first.
    const shape = svg.match(/<circle class="sumi-set-shape"[^>]*>/g) ?? [];
    expect(shape).toHaveLength(2);
    for (const circle of shape) {
      expect(circle).toMatch(/fill="none"/);
      expect(circle).toMatch(/stroke="#[0-9a-f]{6}"/);
    }
    const tints = svg.match(/<circle class="sumi-set-fill"[^>]*>/g) ?? [];
    expect(tints).toHaveLength(2);
    for (const circle of tints) {
      expect(circle).toMatch(/fill="#[0-9a-f]{6}"/);
      expect(circle).not.toContain("opacity");
    }
    expect(svg).not.toMatch(/<[a-z]+ class="sumi-set[^"]*"[^>]*fill-opacity/);
    expect(at('class="sumi-set-fills"')).toBeLessThan(firstSet);
    expect(svg).toContain(">Left</text>");
    // Two different tones give two different tints.
    expect(new Set(tints.map((s) => /fill="(#[0-9a-f]{6})"/.exec(s)?.[1])).size).toBe(2);
  });

  test("an overlap is painted with the product of the two tints, clipped to the sets (#440)", async () => {
    const { svg } = await render(venn());
    const tints = [...svg.matchAll(/<circle class="sumi-set-fill"[^>]*fill="(#[0-9a-f]{6})"/g)].map(
      (m) => m[1] as string,
    );
    expect(tints).toHaveLength(2);
    const product = multiplyTints(tints);
    const overlap =
      /<g clip-path="url\(#(sumi-clip-\d+)\)"><circle class="sumi-set-overlap"[^>]*>/.exec(svg);
    expect(overlap).not.toBeNull();
    expect(overlap?.[0]).toContain(`fill="${product}"`);
    expect(svg).toMatch(new RegExp(`<clipPath id="${overlap?.[1]}"><circle `));
    // Darker than both tints, in the hues of both.
    expect(toOklch(product).l).toBeLessThan(Math.min(...tints.map((t) => toOklch(t).l)));
    expect(toOklch(product).c).toBeGreaterThan(0.01);
    // Painted after every tint and before every outline.
    expect(svg.indexOf("sumi-set-overlap")).toBeGreaterThan(svg.lastIndexOf("sumi-set-fill"));
    expect(svg.indexOf("sumi-set-overlap")).toBeLessThan(svg.indexOf('class="sumi-set-shape"'));
  });

  test("a set looks the same on a gray panel as on white: the tint does not mix with what lies beneath (#440)", async () => {
    const onWhite = await render(venn());
    const source = venn().replace(
      "  layout:",
      "  themeOverrides: { groupFill: '#e0e0e0' }\n  layout:",
    );
    const panel = await render(
      source
        .replace("- { item: a1", "- { item: p, at: [-1, -1] }\n          - { item: a1")
        .replace(
          "nodes:",
          "groups:\n  - { id: p, arrange: { row: { items: [pad] } } }\nnodes:\n  - { id: pad, component: box, label: pad }",
        ),
    );
    const fills = (svg: string) =>
      (svg.match(/<[a-z]+ class="sumi-set-(?:fill|overlap)"[^>]*>/g) ?? []).map(
        (m) => /fill="(#[0-9a-f]{6})"/.exec(m)?.[1],
      );
    expect(fills(panel.svg)).toEqual(fills(onWhite.svg));
  });

  test("an unfilled set (outlined, or no strength) paints no tint layer", async () => {
    const { svg } = await render(
      venn("", "color", "  - { id: left, members: [a1, a2], tone: blue, variant: outlined }"),
    );
    expect(svg).not.toContain("sumi-set-fill");
    expect(svg).not.toContain("clipPath");
  });

  test("the inspection reads each set's shape and label", async () => {
    const { inspection, layout } = await render(venn());
    expect(inspection.sets?.map((s) => s.id)).toEqual(["left", "right"]);
    const [left] = inspection.sets ?? [];
    const placed = layout.sets?.[0];
    expect(left?.bbox.x).toBeCloseTo(placed?.rect.x ?? 0, 1);
    expect(left?.bbox.width).toBeCloseTo(placed?.rect.width ?? 0, 1);
    expect(left?.region.kind).toBe("ellipse");
    expect(left?.labels[0]?.text).toBe("Left");
  });

  test("output is deterministic", async () => {
    expect((await render(venn())).svg).toBe((await render(venn())).svg);
  });
});

describe("shapes, variants and tint", () => {
  for (const shape of ["circle", "ellipse", "hull", "rect"] as const) {
    test(`${shape}: encloses its members and lints clean`, async () => {
      const source = venn(
        "",
        "color",
        `  - { id: left, label: Left, members: [a1, a2, shared], tone: blue, shape: ${shape}, labelAt: top-left }
  - { id: right, label: Right, members: [shared, b1, b2], tone: green, shape: ${shape}, labelAt: top-right }`,
      );
      const rendered = await render(source);
      const set = rendered.inspection.sets?.[0];
      expect(set).toBeDefined();
      const node = rendered.inspection.elements.find((e) => e.key === "n:a1")?.bbox;
      if (set === undefined || node === undefined) throw new Error("missing");
      const { bbox } = set;
      expect(node.x).toBeGreaterThan(bbox.x);
      expect(node.y).toBeGreaterThan(bbox.y);
      expect(node.x + node.width).toBeLessThan(bbox.x + bbox.width);
      expect(node.y + node.height).toBeLessThan(bbox.y + bbox.height);
      expect(lintGeometry(rendered, { source }).filter((d) => d.severity !== "info")).toEqual([]);
    });
  }

  test("variants: default and dashed tint, filled has no outline, outlined no tint", async () => {
    const one = (variant: string, extra = "") =>
      venn(
        "",
        "color",
        `  - { id: left, members: [a1, a2], tone: blue, variant: ${variant}${extra} }`,
      );
    const shapeOf = async (v: string, extra = "", cls = "sumi-set-shape") =>
      (await render(one(v, extra))).svg.match(new RegExp(`<circle class="${cls}"[^>]*>`))?.[0] ??
      "";
    const tintOf = async (v: string, extra = "") =>
      /fill="(#[0-9a-f]{6})"/.exec(await shapeOf(v, extra, "sumi-set-fill"))?.[1];
    expect(await shapeOf("default")).toMatch(/fill="none".*stroke="#/);
    expect(await tintOf("default")).toBeDefined();
    expect(await shapeOf("dashed")).toContain("stroke-dasharray");
    expect(await tintOf("dashed")).toBe(await tintOf("default"));
    expect(await shapeOf("filled")).toMatch(/stroke="none" stroke-width="0"/);
    expect(await tintOf("filled")).toBeDefined();
    // `filled` is the stronger tint (0.28 against 0.2); fillOpacity is the tint's strength, never a transparency.
    expect(toOklch((await tintOf("filled")) ?? "#000000").l).toBeLessThan(
      toOklch((await tintOf("default")) ?? "#000000").l,
    );
    expect(await shapeOf("outlined")).toMatch(/fill="none"/);
    expect(await tintOf("outlined")).toBeUndefined();
    expect(toOklch((await tintOf("default", ", fillOpacity: 0.5")) ?? "#000000").l).toBeLessThan(
      toOklch((await tintOf("default")) ?? "#000000").l,
    );
    expect(await shapeOf("default", ", fillOpacity: 0.5", "sumi-set-fill")).not.toContain(
      "opacity",
    );
  });

  for (const theme of BUILTIN_THEMES.keys()) {
    test(`${theme}: a tinted set shows in the theme (the tint is the tone's line color)`, async () => {
      const { svg, diagnostics } = await renderFigure(venn("", theme)).then((r) => {
        if (!r.ok) throw new Error(JSON.stringify(r.diagnostics));
        return { svg: r.value.svg, diagnostics: r.diagnostics };
      });
      expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
      const tints = (svg.match(/<circle class="sumi-set-fill"[^>]*fill="(#[0-9a-f]{6})"/g) ?? [])
        .length;
      expect(tints).toBe(2);
    });
  }

  test("figure.themeOverrides.tones recolors a set like any toned element", async () => {
    const source = venn().replace(
      "  layout:",
      '  themeOverrides: { tones: { blue: { line: "#123456" } } }\n  layout:',
    );
    const { svg } = await render(source);
    expect(svg).toMatch(
      new RegExp(`<circle class="sumi-set-fill"[^>]*fill="${tintOver("#123456", 0.2)}"`),
    );
  });
});

describe("sets of groups, labels and edges", () => {
  test("a group is a member by its whole frame; the nodes inside it are not flagged", async () => {
    const source = `version: 1
figure:
  id: g
  theme: color
  profile: paper-double
  layout: { arrange: { row: { gap: 14mm, items: [g, c] } } }
groups:
  - { id: g, arrange: { row: { items: [a, b] } } }
nodes:
  - { id: a, component: box, label: A }
  - { id: b, component: box, label: B }
  - { id: c, component: box, label: C }
sets:
  - { id: s, label: Both, members: [g, c], shape: rect }
`;
    const rendered = await render(source);
    expect(lintGeometry(rendered, { source }).filter((d) => d.severity !== "info")).toEqual([]);
    const set = rendered.inspection.sets?.[0];
    const group = rendered.inspection.elements.find((e) => e.key === "g:g")?.bbox;
    if (!set || !group) throw new Error("missing");
    expect(set.bbox.x).toBeLessThan(group.x);
    expect(set.bbox.x + set.bbox.width).toBeGreaterThan(group.x + group.width);
  });

  test("an edge label inside a set is backed by the blended tint, not plain white", async () => {
    const source = venn().replace("sets:", "edges:\n  - { from: a1, to: a2, label: link }\nsets:");
    const { svg } = await render(source);
    const background =
      /<rect x="[\d.]+" y="[\d.]+" width="[\d.]+" height="[\d.]+" fill="(#[0-9a-f]{6})"\/><text[^>]*>link/.exec(
        svg,
      )?.[1];
    expect(background).toBeDefined();
    expect(background).not.toBe("#ffffff");
  });

  test("edges may cross set boundaries freely: no finding", async () => {
    const source = venn().replace(
      "sets:",
      "edges:\n  - { from: a1, to: b1 }\n  - { from: a2, to: b2 }\nsets:",
    );
    const rendered = await render(source);
    expect(lintGeometry(rendered, { source }).filter((d) => d.severity !== "info")).toEqual([]);
  });
});

describe("lint", () => {
  test("a node inside the outline that is not a member is a warning naming both", async () => {
    const source = venn("  - { id: stray, component: box, label: Stray }\n", "color").replace(
      "          - { item: b2, at: [3.2, 2] }",
      "          - { item: b2, at: [3.2, 2] }\n          - { item: stray, at: [0.9, 0.4] }",
    );
    const rendered = await render(source);
    const findings = lintGeometry(rendered, { source }).filter(
      (d) => d.code === "geometry/set-contains-non-member" && d.subject?.id === "left",
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: "warning",
      subject: { kind: "set", id: "left" },
      path: ["sets", 0],
    });
    expect(findings[0]?.message).toContain('node "stray"');
    expect(findings[0]?.related?.[0]?.path).toEqual(["nodes", 5]);
    expect(findings[0]?.location?.line).toBeGreaterThan(0);
    // Making it a member (of the left set) resolves the warning.
    const fixed = source.replace("members: [a1, a2, shared]", "members: [a1, a2, shared, stray]");
    const again = await render(fixed);
    expect(
      lintGeometry(again, { source: fixed }).filter(
        (d) => d.code === "geometry/set-contains-non-member" && d.subject?.id === "left",
      ),
    ).toEqual([]);
  });

  test("a set's label colliding with another label is reported; moving it clears it", async () => {
    const crowded = venn().replace("labelAt: top-left", "labelAt: top-right");
    const rendered = await render(crowded);
    const findings = lintGeometry(rendered, { source: crowded }).filter(
      (d) => d.code === "geometry/set-label-collision",
    );
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.hint).toContain("labelAt");
    const fine = await render(venn());
    expect(
      lintGeometry(fine, { source: venn() }).filter(
        (d) => d.code === "geometry/set-label-collision",
      ),
    ).toEqual([]);
  });

  test("a set's outline through the text of an outside label is reported (#420)", async () => {
    // A tilted ellipse around a, b and shared reaches the title of a group below them.
    const source = `version: 1
figure:
  id: through-text
  theme: color
  layout:
    arrange:
      place:
        unit: 10mm
        items:
          - { item: a, at: [0, 0] }
          - { item: b, at: [2, 0.6] }
          - { item: card, at: [1, 1.2] }
nodes:
  - { id: a, component: circle, label: A }
  - { id: b, component: circle, label: B }
  - { id: c, component: box, label: Note, group: card }
groups:
  - { id: card, label: Card title, arrange: { stack: { items: [c] } } }
sets:
  - { id: s, members: [a, b], shape: ellipse, angle: auto, padding: 6mm, variant: dashed }
`;
    const rendered = await render(source);
    const hits = lintGeometry(rendered, { source }).filter(
      (d) => d.code === "geometry/set-outline-crosses-text",
    );
    expect(hits.map((d) => d.subject?.id)).toEqual(["s"]);
    expect(hits[0]?.message).toContain("crosses the text");
    // Text of a member (its own label, inside the outline) is fine, and so is a clear set.
    const clear = source.replace("padding: 6mm", "padding: 1mm").replace("[1, 1.2]", "[1, 3]");
    const fine = await render(clear);
    expect(
      lintGeometry(fine, { source: clear }).filter(
        (d) => d.code === "geometry/set-outline-crosses-text",
      ),
    ).toEqual([]);
    const plain = await render(venn());
    expect(
      lintGeometry(plain, { source: venn() }).filter(
        (d) => d.code === "geometry/set-outline-crosses-text",
      ),
    ).toEqual([]);
  });

  test("a subset's label inside its superset is fine (containment)", async () => {
    const source = venn(
      "",
      "color",
      `  - { id: outer, label: All, members: [a1, a2, shared, b1, b2], tone: gray, shape: ellipse, padding: 14mm, labelAt: bottom }
  - { id: inner, label: Left, members: [a1, a2], tone: blue, shape: ellipse, labelAt: left }`,
    );
    const rendered = await render(source);
    const findings = lintGeometry(rendered, { source }).filter(
      (d) =>
        d.code === "geometry/set-label-collision" || d.code === "geometry/set-contains-non-member",
    );
    expect(findings.map((d) => d.message)).toEqual([]);
  });
});

describe("text and width", () => {
  test("a set label is held to the minimum font size like any text", async () => {
    const source = venn().replace("  layout:", "  target: { minFontSize: 20pt }\n  layout:");
    const rendered = await render(source);
    const findings = lintGeometry(rendered, { source }).filter(
      (d) => d.code === "geometry/text-too-small" && d.subject?.kind === "set",
    );
    expect(findings.map((d) => d.subject?.id)).toEqual(["left", "right"]);
    expect(findings[0]?.message).toContain('The label of set "left" is drawn at 9pt');
    expect(findings[0]?.path).toEqual(["sets", 0, "label"]);
  });

  test("the width breakdown names the sets when they reach beyond the arrange items", async () => {
    const source = venn()
      .replace("profile: paper-double", "profile: paper-single")
      .replace("unit: 10mm", "unit: 20mm");
    const rendered = await render(source);
    const [finding] = lintGeometry(rendered, { source }).filter(
      (d) => d.code === "geometry/exceeds-page-width",
    );
    expect(finding?.hint).toContain("Set enclosures (outlines and labels) span");
  });
});

describe("PDF and PPTX", () => {
  test("PDF paints the tints opaque: no transparency state (#440), and the overlap is clipped", async () => {
    const { svg } = await render(venn());
    const pdf = svgToPdf(svg);
    if (!pdf.ok) throw new Error(JSON.stringify(pdf.diagnostics));
    const states = [...parsePdf(pdf.value).objects.values()].flatMap(({ value }) =>
      typeof value === "object" && value !== null && "ca" in value
        ? [(value as { ca: number }).ca]
        : [],
    );
    expect(states).not.toContain(0.2);
    expect(svg).toContain("clip-path");
  });

  test("picture PPTX exports", async () => {
    const { svg } = await render(venn());
    const pptx = svgToPptx(svg);
    expect(pptx.ok).toBe(true);
  });

  test("editable PPTX: opaque freeforms for the tints and the overlap, then the outlines, between the groups and the nodes (#440)", async () => {
    const rendered = await render(venn());
    const result = svgToEditablePptx(rendered.svg, rendered.compiled.ir);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const slide = new TextDecoder().decode(readPptx(result.value).get("ppt/slides/slide1.xml"));
    const parsed = parseXml(slide);
    if (!parsed.ok) throw new Error(parsed.message);
    const names = [...descendants(parsed.root)]
      .filter((e) => e.name === "p:cNvPr")
      .map((e) => attribute(e, "name"));
    const order = (name: string) => names.indexOf(name);
    expect(order("set left")).toBeGreaterThanOrEqual(0);
    expect(order("set right")).toBeGreaterThan(order("set left"));
    // The overlap lies over both tints and under both outlines.
    expect(order("set overlap left + right")).toBeGreaterThan(order("set right"));
    expect(order("set left outline")).toBeGreaterThan(order("set overlap left + right"));
    expect(order("n:a1")).toBeGreaterThan(order("set right label"));
    expect(slide).not.toContain("<a:alpha");
    expect(slide).toContain("custGeom");
    // The overlap is filled in the product of the two tints.
    const tints = [
      ...rendered.svg.matchAll(/<circle class="sumi-set-fill"[^>]*fill="(#[0-9a-f]{6})"/g),
    ].map((m) => m[1] as string);
    expect(slide).toContain(`<a:srgbClr val="${multiplyTints(tints).slice(1).toUpperCase()}">`);
    // The tint shapes fill their path (the outline element is unfilled).
    expect(slide).not.toMatch(
      /name="set left"[\s\S]*?<a:path [^>]*fill="none"[\s\S]*?name="set right"/,
    );
  });
});

describe("label background at a set boundary", () => {
  test("only a label wholly inside the tint takes the tinted background", async () => {
    const { labelBackground } = await import("./structured");
    const inside = (p: { x: number; y: number }) => Math.hypot(p.x - 50, p.y - 50) <= 30;
    const groups = [
      { rect: { x: 20, y: 20, width: 60, height: 60 }, fill: "#ffcccc", opacity: 1, inside },
    ];
    const within = labelBackground({ x: 40, y: 45, width: 20, height: 10 }, groups);
    expect(within).not.toBe("#ffffff");
    // Centre inside, but a corner outside the circle: stays on the canvas colour.
    const straddling = labelBackground({ x: 55, y: 62, width: 40, height: 10 }, groups);
    expect(straddling).toBe("#ffffff");
  });
});
