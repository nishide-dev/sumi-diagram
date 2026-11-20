/**
 * An icon and a label in one node (#605, design doc `605-icon-label-nodes`):
 * `iconAt: left | top` through the schema, the structured layout, the geometry
 * lint and the SVG, PDF and PPTX outputs; and the two icon-use lint rules (#606).
 */

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { iconGap, iconSize } from "../assets/draw";
import { compileFigure } from "../compiler/compile";
import { lintFigure, lintGeometry } from "../lint";
import { geometryContextFor } from "../lint/geometry/lint";
import { svgToPdf } from "./pdf";
import { inspectPdf } from "./pdf/testing";
import { svgToPptx } from "./pptx";
import { svgToEditablePptx } from "./pptx/editable";
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

  // SHA-256 of the SVG (input hash and version attributes stripped) that origin/main (e0fd373b)
  // drew for this icon-only figure: icon-only nodes must keep drawing exactly that.
  test("icon-only nodes are drawn exactly as origin/main drew them", async () => {
    const out = await render(`version: 1
figure:
  id: icon-only
  theme: color
  profile: paper-single
  layout: { arrange: { row: { gap: 8mm, align: center, items: [a, b, c] } } }
nodes:
  - { id: a, component: box, icon: tabler/database }
  - { id: b, component: label, icon: tabler/robot, iconSize: 2, tone: blue }
  - { id: c, component: box, label: Plain }
`);
    const hash = createHash("sha256")
      .update(
        out.svg
          .replace(/input-sha256="[^"]*"/, "")
          .replace(/(sumi-version|backend-version)="[^"]*"/g, '$1="X"'),
      )
      .digest("hex");
    expect(hash).toBe("cd9e81c4405526682997be2382e6abfe4f01b133d1e3988a9c23d0504f6448be");
    expect(out.compiled.ir.nodes.map((n) => n.iconAt)).toEqual([undefined, undefined, undefined]);
  });
});

describe("alignment and one shared geometry", () => {
  const wide = (at: string, align: string, label = "Database") =>
    figure(
      `  - { id: a, component: box, label: ${JSON.stringify(label)}, icon: tabler/database, iconAt: ${at}, textAlign: ${align}, props: { width: 60mm } }\n  - { id: b, component: box, label: B }`,
    );

  test.each([
    ["left", "left"],
    ["left", "right"],
    ["left", "center"],
    ["top", "left"],
    ["top", "right"],
    ["top", "center"],
  ])(
    "iconAt %s with textAlign %s keeps icon and text inside the node, as one group",
    async (at, align) => {
      const source = wide(at, align);
      const out = await render(source);
      const node = out.layout.nodes.find((n) => n.key === "n:a");
      const ir = out.compiled.ir.nodes[0];
      if (node?.label === undefined || ir === undefined) throw new Error("no node");
      const icon = iconGroups(out.svg)[0];
      const side = iconSize(ir);
      const iconRect = { x: icon?.x ?? 0, y: icon?.y ?? 0, width: side, height: side };
      const l = node.label.box;
      const r = node.rect;
      for (const box of [iconRect, l]) {
        expect(box.x).toBeGreaterThanOrEqual(r.x);
        expect(box.x + box.width).toBeLessThanOrEqual(r.x + r.width);
      }
      if (align === "left") {
        // The group starts at the left inset: the icon (left) or the wider of icon and text (top).
        expect(Math.min(iconRect.x, l.x)).toBeLessThan(r.x + r.width / 4);
      }
      if (align === "right") {
        expect(Math.max(iconRect.x + side, l.x + l.width)).toBeGreaterThan(r.x + (3 * r.width) / 4);
      }
      expect(lintGeometry(out, { source }).map((d) => d.code)).not.toContain(
        "geometry/label-overflow",
      );
    },
  );

  test.each([
    ["one line", "Database"],
    ["two lines", "Data\nbase"],
    ["a blank line", "Data\n\nbase"],
  ])("the lint places the icon where the SVG draws it: %s", async (_name, label) => {
    for (const at of ["left", "top"]) {
      const out = await render(
        figure(
          `  - { id: a, component: box, label: ${JSON.stringify(label)}, sublabel: sub, icon: tabler/database, iconAt: ${at} }\n  - { id: b, component: box, label: B }`,
        ),
      );
      const context = geometryContextFor(out as never);
      const element = context.elements.find((e) => e.key === "n:a");
      const linted = element?.labels.at(-1)?.box;
      const icon = iconGroups(out.svg)[0];
      const side = iconSize(out.compiled.ir.nodes[0] as never);
      // The SVG writes the translation to 0.1 unit.
      expect(Math.abs((linted?.x ?? Number.NaN) - (icon?.x ?? 0))).toBeLessThan(0.06);
      expect(Math.abs((linted?.y ?? Number.NaN) - (icon?.y ?? 0))).toBeLessThan(0.06);
      expect(linted?.width).toBeCloseTo(side, 2);
    }
  });
});

describe("lint sees the icon", () => {
  test("text that fits but an icon that does not is label-overflow", async () => {
    const source = figure(
      "  - { id: a, component: box, label: Hi, icon: tabler/database, iconSize: 6, props: { width: 40mm, height: 8mm } }\n  - { id: b, component: box, label: B }",
    );
    const out = await render(source);
    const text = lintGeometry(out, { source }).find((d) => d.code === "geometry/label-overflow");
    expect(text).toBeDefined();
    // Without the icon the same box holds its label.
    const plain = figure(
      "  - { id: a, component: box, label: Hi, props: { width: 40mm, height: 8mm } }\n  - { id: b, component: box, label: B }",
    );
    expect(lintGeometry(await render(plain), { source: plain }).map((d) => d.code)).not.toContain(
      "geometry/label-overflow",
    );
  });

  test("an icon that sticks out of its node over a neighbour's label is label-collision", async () => {
    const source = `version: 1
figure:
  id: collide
  theme: color
  profile: paper-single
  layout: { arrange: { row: { gap: 0mm, align: center, items: [b, a] } } }
nodes:
  - { id: b, component: label, label: Neighbour }
  - { id: a, component: box, label: Hi, icon: tabler/database, iconSize: 4, props: { width: 12mm, height: 20mm } }
`;
    const out = await render(source);
    const codes = lintGeometry(out, { source }).map((d) => d.code);
    expect(codes).toContain("geometry/label-collision");
  });

  test("lint/icon-enclosure: an icon-only plain box is reported, a labelled one is not", () => {
    const codes = (node: string) =>
      lintFigure(`version: 1\nfigure: { id: s }\nnodes: [${node}]\n`).diagnostics.map(
        (d) => d.code,
      );
    expect(codes("{ id: a, component: box, icon: tabler/flame }")).toContain("lint/icon-enclosure");
    expect(codes("{ id: a, component: box, label: Fire, icon: tabler/flame }")).not.toContain(
      "lint/icon-enclosure",
    );
    expect(
      codes("{ id: a, component: box, label: Fire, icon: tabler/flame, iconAt: top }"),
    ).not.toContain("lint/icon-enclosure");
  });
});

describe("formats", () => {
  const source = figure(`  - { id: a, component: box, label: Store, icon: emoji/fire }
  - { id: b, component: box, label: Tool, icon: tabler/tool }`);

  test("PDF carries the icon paths and picture PPTX the colours", async () => {
    const out = await render(source);
    const bare = await render(
      figure(
        `  - { id: a, component: box, label: Store }\n  - { id: b, component: box, label: Tool }`,
      ),
    );
    const pdf = svgToPdf(out.svg);
    const pdfBare = svgToPdf(bare.svg);
    const pptx = svgToPptx(out.svg);
    if (!pdf.ok || !pdfBare.ok || !pptx.ok) throw new Error("conversion failed");
    // The Tabler icon strokes its lines: more stroked paths than the same figure without icons.
    expect(inspectPdf(pdf.value).strokes.length).toBeGreaterThan(
      inspectPdf(pdfBare.value).strokes.length,
    );
    const picture = [...readPptx(pptx.value).entries()].find(([name]) => name.endsWith(".svg"));
    const text = new TextDecoder().decode(picture?.[1]);
    // The emoji keep fill colours of their own; the Tabler icon strokes the text colour.
    expect(text).toContain("#ff6723");
    expect(text).toContain('stroke="#1f2328"');
    expect(out.svg).toContain("#ff6723");
  });

  test("the editable PPTX refuses the icon like an icon-only node", async () => {
    const out = await render(source);
    const result = svgToEditablePptx(out.svg, out.compiled.ir);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((d) => d.code)).toContain("pptx/unsupported-asset");
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

  test("the 80% share is inclusive and the minimum is six nodes", async () => {
    const icons = (n: number, total: number) =>
      Array.from({ length: total }, (_, i) => (i < n ? "tabler/user" : ""));
    // 8 of 10 is exactly 80%.
    expect(await codes(icons(8, 10))).toContain("geometry/icon-overuse");
    expect(await codes(icons(7, 10))).not.toContain("geometry/icon-overuse");
    // Six nodes are enough; five are not, even when all draw icons.
    expect(await codes(icons(5, 6))).toContain("geometry/icon-overuse");
    expect(await codes(icons(5, 5))).not.toContain("geometry/icon-overuse");
  });

  test("badges and legend samples are not node icons", async () => {
    const badged = `version: 1
figure: { id: s, theme: color, profile: paper-double, layout: { arrange: { row: { gap: 3mm, items: [n0, n1, n2, n3, n4, n5] } } } }
nodes:
${Array.from({ length: 6 }, (_, i) => `  - { id: n${i}, component: box, label: L${i}, badge: { icon: emoji/fire, corner: north-east }${i === 0 ? ", icon: tabler/user" : ""} }`).join("\n")}
`;
    const out = await render(badged);
    const found = lintGeometry(out, { source: badged }).map((d) => d.code);
    expect(found).not.toContain("geometry/icon-overuse");
    expect(found).not.toContain("geometry/icon-family-mix");
    const legend = `version: 1
figure: { id: lg, theme: paper, profile: paper-double, layout: { arrange: { stack: { gap: 5mm, align: start, items: [a, b, key] } } } }
nodes:
  - { id: a, component: box, label: A }
  - { id: b, component: box, label: B }
  - id: key
    component: legend
    variant: plain
    props:
      entries:
${["tabler/database", "tabler/cpu", "emoji/fire", "tabler/user", "tabler/flame", "tabler/brain"].map((n) => `        - { icon: ${n}, label: ${n.split("/")[1]} }`).join("\n")}
`;
    const legendFound = lintGeometry(await render(legend), { source: legend }).map((d) => d.code);
    expect(legendFound).not.toContain("geometry/icon-overuse");
    expect(legendFound).not.toContain("geometry/icon-family-mix");
  });

  describe("glyphs", () => {
    test("a glyph touching only its own icon is allowed, one covering the label is not", async () => {
      const make = (glyph: string) =>
        figure(
          `  - { id: a, component: box, label: Hi, icon: tabler/database, iconSize: 3, glyphs: [${glyph}] }\n  - { id: b, component: box, label: B }`,
        );
      const onIcon = make("{ kind: dot, at: west, dx: 1 }");
      const found = lintGeometry(await render(onIcon), { source: onIcon }).map((d) => d.code);
      expect(found).not.toContain("geometry/glyph-collision");
    });
  });
});
