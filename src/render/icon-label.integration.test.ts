/**
 * An icon and a label in one node (#605, design doc `605-icon-label-nodes`):
 * `iconAt: left | top` through the schema, the structured layout, the geometry
 * lint and the SVG, PDF and PPTX outputs; and the two icon-use lint rules (#606).
 */

import { describe, expect, test } from "bun:test";
import { iconGap, iconSize } from "../assets/draw";
import { compileFigure } from "../compiler/compile";
import { lintGeometry } from "../lint";
import { svgToPdf } from "./pdf";
import { svgToPptx } from "./pptx";
import { readPptx } from "./pptx/testing";
import { renderFigure } from "./render";

const figure = (nodes: string, extra = "") => `version: 1
figure:
  id: icon-label
  theme: color
  profile: paper-single
  layout: { arrange: { row: { gap: 8mm, align: center, items: [a, b] } } }${extra}
nodes:
${nodes}
`;

const WITH_B = (a: string) => figure(`  - ${a}\n  - { id: b, component: box, label: B }`);

const PAIR = figure(`  - { id: a, component: box, label: Database, icon: tabler/database }
  - { id: b, component: box, label: Agent, icon: tabler/robot, iconAt: top, sublabel: planner }`);

async function render(source: string) {
  const result = await renderFigure(source);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  if (!("layout" in result.value)) throw new Error("expected a structured figure");
  return result.value;
}

const iconGroups = (svg: string) =>
  [
    ...svg.matchAll(
      /class="sumi-icon" transform="translate\(([-\d.]+) ([-\d.]+)\) scale\(([\d.]+)\)"/g,
    ),
  ].map((m) => ({ x: Number(m[1]), y: Number(m[2]), scale: Number(m[3]) }));

describe("schema and checks", () => {
  const codes = (source: string) =>
    compileFigure(source)
      .diagnostics.filter((d) => d.severity === "error")
      .map((d) => [d.code, d.path?.join(".")]);

  test("icon and label together are accepted by the structured engine, iconAt defaults to left", () => {
    expect(codes(PAIR)).toEqual([]);
    const ir = compileFigure(PAIR);
    if (!ir.ok) throw new Error("compile failed");
    expect(ir.value.ir.nodes.map((n) => n.iconAt)).toEqual(["left", "top"]);
  });

  test("an icon alone has no iconAt, so existing icon-only nodes are unchanged", () => {
    const result = compileFigure(
      figure(
        "  - { id: a, component: label, icon: tabler/flame }\n  - { id: b, component: box, label: B }",
      ),
    );
    if (!result.ok) throw new Error("compile failed");
    expect(result.value.ir.nodes[0]?.iconAt).toBeUndefined();
  });

  test("the auto engine keeps asset/icon-with-label, pointing at the structured layout", () => {
    const result = compileFigure(
      "version: 1\nfigure: { id: s, layout: { engine: auto } }\nnodes: [{ id: a, component: box, label: x, icon: tabler/flame }]\n",
    );
    expect(result.diagnostics[0]).toMatchObject({
      code: "asset/icon-with-label",
      path: ["nodes", 0, "icon"],
    });
    expect(result.diagnostics[0]?.hint).toContain("arrange");
  });

  test("iconAt without an icon or without a label is an error at the field", () => {
    expect(codes(WITH_B("{ id: a, component: box, label: x, iconAt: left }"))).toEqual([
      ["asset/icon-at-without-label", "nodes.0.iconAt"],
    ]);
    expect(codes(WITH_B("{ id: a, component: label, icon: tabler/flame, iconAt: top }"))).toEqual([
      ["asset/icon-at-without-label", "nodes.0.iconAt"],
    ]);
  });

  test("iconAt takes left and top only", () => {
    const result = compileFigure(
      WITH_B("{ id: a, component: box, label: x, icon: tabler/flame, iconAt: right }"),
    );
    expect(result.ok).toBe(false);
  });

  test("a sublabel is allowed with icon and label, not with an icon alone", () => {
    expect(codes(PAIR)).toEqual([]);
    expect(
      codes(WITH_B("{ id: a, component: box, icon: tabler/flame, sublabel: s }")).length,
    ).toBeGreaterThan(0);
  });
});

describe("geometry", () => {
  test("left: the icon sits left of the text, both centred on the node's middle line", async () => {
    const out = await render(
      figure(
        "  - { id: a, component: box, label: Database, icon: tabler/database }\n  - { id: b, component: box, label: B }",
      ),
    );
    const node = out.layout.nodes.find((n) => n.key === "n:a");
    const ir = out.compiled.ir.nodes[0];
    if (node?.label === undefined || ir === undefined) throw new Error("no node");
    const [icon] = iconGroups(out.svg);
    const side = iconSize(ir);
    // Tabler icons are 24 units wide: scale * 24 is the side.
    expect((icon?.scale ?? 0) * 24).toBeCloseTo(side, 2);
    const iconRight = (icon?.x ?? 0) + side;
    expect(node.label.box.x - iconRight).toBeCloseTo(iconGap(ir), 1);
    // Centred vertically on the text, no overlap, and inside the box.
    expect((icon?.y ?? 0) + side / 2).toBeCloseTo(node.label.box.y + node.label.box.height / 2, 1);
    expect(icon?.x).toBeGreaterThanOrEqual(node.rect.x);
    expect(node.label.box.x + node.label.box.width).toBeLessThanOrEqual(
      node.rect.x + node.rect.width,
    );
  });

  test("top: the icon sits above the label and sublabel, centred", async () => {
    const out = await render(PAIR);
    const node = out.layout.nodes.find((n) => n.key === "n:b");
    const ir = out.compiled.ir.nodes[1];
    if (node?.label === undefined || ir === undefined) throw new Error("no node");
    const icon = iconGroups(out.svg)[1];
    const side = iconSize(ir);
    expect((icon?.y ?? 0) + side + iconGap(ir)).toBeCloseTo(node.label.box.y, 1);
    expect((icon?.x ?? 0) + side / 2).toBeCloseTo(node.rect.x + node.rect.width / 2, 1);
    expect(node.sublabel).toBeDefined();
  });

  test("default icon sizes: 1.2 em for left, 1.8 em for top, iconSize overrides", async () => {
    const out = await render(PAIR);
    const [a, b] = out.compiled.ir.nodes;
    const em = a?.style.fontSize.units as number;
    expect(iconSize(a as never)).toBeCloseTo(1.2 * em, 5);
    expect(iconSize(b as never)).toBeCloseTo(1.8 * em, 5);
    const sized = await render(PAIR.replace("iconAt: top,", "iconAt: top, iconSize: 3,"));
    expect(iconSize(sized.compiled.ir.nodes[1] as never)).toBeCloseTo(3 * em, 5);
  });

  test.each([
    ["left", "width: 60mm"],
    ["top", "width: 60mm, height: 30mm"],
  ])("a node wider than its content centres icon and text as one group (%s)", async (at, props) => {
    const out = await render(
      figure(
        `  - { id: a, component: box, label: Database, icon: tabler/database, iconAt: ${at}, props: { ${props} } }\n  - { id: b, component: box, label: B }`,
      ),
    );
    const node = out.layout.nodes.find((n) => n.key === "n:a");
    const ir = out.compiled.ir.nodes[0];
    if (node?.label === undefined || ir === undefined) throw new Error("no node");
    const icon = iconGroups(out.svg)[0];
    const side = iconSize(ir);
    const l = node.label.box;
    const left = at === "left" ? (icon?.x ?? 0) : Math.min(icon?.x ?? 0, l.x);
    const right = at === "left" ? l.x + l.width : Math.max((icon?.x ?? 0) + side, l.x + l.width);
    expect((left + right) / 2).toBeCloseTo(node.rect.x + node.rect.width / 2, 1);
    if (at === "top") {
      const top = icon?.y ?? 0;
      const bottom = l.y + l.height;
      expect((top + bottom) / 2).toBeCloseTo(node.rect.y + node.rect.height / 2, 1);
    }
  });

  test("the node grows to hold icon and label, and iconSize applies", async () => {
    const plain = await render(
      figure(
        "  - { id: a, component: box, label: Database }\n  - { id: b, component: box, label: B }",
      ),
    );
    const left = await render(PAIR.replace("iconAt: top, ", ""));
    const big = await render(
      figure(`  - { id: a, component: box, label: Database, icon: tabler/database, iconSize: 3 }
  - { id: b, component: box, label: B }`),
    );
    const w = (r: typeof plain, key = "n:a") =>
      r.layout.nodes.find((n) => n.key === key)?.rect.width as number;
    const h = (r: typeof plain, key = "n:a") =>
      r.layout.nodes.find((n) => n.key === key)?.rect.height as number;
    const em = plain.compiled.ir.nodes[0]?.style.fontSize.units as number;
    expect(w(left)).toBeGreaterThan(w(plain));
    expect(Math.abs(w(left) - w(plain) - (1.2 * em + (em * 2) / 5))).toBeLessThan(2);
    expect(h(big)).toBeGreaterThan(h(plain));
    expect(w(big)).toBeGreaterThan(w(left));
  });

  test("works on circle, ellipse, diamond and a bare label node", async () => {
    const out = await render(`version: 1
figure: { id: s, theme: color, profile: paper-double, layout: { arrange: { row: { gap: 8mm, items: [a, b, c, d] } } } }
nodes:
  - { id: a, component: circle, label: GPU, icon: tabler/cpu }
  - { id: b, component: ellipse, label: Env, icon: tabler/world }
  - { id: c, component: diamond, label: Gate, icon: tabler/lock, iconAt: top }
  - { id: d, component: label, label: Paper, icon: tabler/file-text, tone: blue }
`);
    expect(iconGroups(out.svg)).toHaveLength(4);
    const source = "";
    expect(lintGeometry(out, { source }).filter((d) => d.severity !== "info")).toEqual([]);
  });

  test("a clean icon-label figure trips no geometry finding", async () => {
    const out = await render(PAIR);
    expect(lintGeometry(out, { source: PAIR }).filter((d) => d.severity !== "info")).toEqual([]);
  });

  test("an icon-label node too small for both is reported by label-overflow", async () => {
    const source = figure(
      "  - { id: a, component: box, label: Database, icon: tabler/database, props: { width: 20pt, height: 14pt } }\n  - { id: b, component: box, label: B }",
    );
    const out = await render(source);
    expect(lintGeometry(out, { source }).map((d) => d.code)).toContain("geometry/label-overflow");
  });

  test("an icon-only node keeps its size, so existing figures are unchanged", async () => {
    const out = await render(
      figure(
        "  - { id: a, component: box, icon: tabler/database }\n  - { id: b, component: box, label: B }",
      ),
    );
    const em = out.compiled.ir.nodes[0]?.style.fontSize.units as number;
    const rect = out.layout.nodes[0]?.rect;
    expect(rect?.width).toBeGreaterThan(em);
    expect(out.compiled.ir.nodes[0]?.iconAt).toBeUndefined();
  });
});

describe("formats", () => {
  test("PDF and picture PPTX are built from the same SVG, emoji keep their colours", async () => {
    const source = figure(`  - { id: a, component: box, label: Store, icon: emoji/fire }
  - { id: b, component: box, label: Tool, icon: tabler/tool }`);
    const out = await render(source);
    expect(out.svg).toContain('class="sumi-icon"');
    const pdf = svgToPdf(out.svg);
    const pptx = svgToPptx(out.svg);
    if (!pdf.ok || !pptx.ok) throw new Error("conversion failed");
    expect(pdf.value.length).toBeGreaterThan(0);
    const picture = [...readPptx(pptx.value).entries()].find(([name]) => name.endsWith(".svg"));
    const text = new TextDecoder().decode(picture?.[1]);
    // The emoji keep fill colours of their own in the picture too; the Tabler icon strokes the text colour.
    expect(text).toContain("#ff6723");
    expect(text).toContain('stroke="#1f2328"');
    expect(out.svg).toContain("#ff6723");
  });
});

describe("icon-use lint (#606)", () => {
  const nodes = (specs: string[]) =>
    specs
      .map(
        (spec, i) =>
          `  - { id: n${i}, component: box, label: L${i}${spec === "" ? "" : `, icon: ${spec}`} }`,
      )
      .join("\n");
  const stack = (specs: string[]) =>
    `version: 1
figure: { id: s, theme: color, profile: paper-double, layout: { arrange: { row: { gap: 3mm, items: [${specs.map((_, i) => `n${i}`).join(", ")}] } } } }
nodes:
${nodes(specs)}
`;
  const codes = async (specs: string[]) => {
    const source = stack(specs);
    return lintGeometry(await render(source), { source }).map((d) => d.code);
  };

  test("Tabler and emoji together report geometry/icon-family-mix", async () => {
    expect(await codes(["tabler/user", "emoji/fire", ""])).toContain("geometry/icon-family-mix");
    expect(await codes(["tabler/user", "tabler/database", ""])).not.toContain(
      "geometry/icon-family-mix",
    );
  });

  test("icons on 80%+ of 6+ nodes report geometry/icon-overuse", async () => {
    const all = Array(6).fill("tabler/user");
    expect(await codes(all)).toContain("geometry/icon-overuse");
    expect(await codes([...all.slice(0, 4), "", ""])).not.toContain("geometry/icon-overuse");
    expect(await codes(["tabler/user", "tabler/user", "tabler/user", ""])).not.toContain(
      "geometry/icon-overuse",
    );
  });
});
