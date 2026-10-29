import { describe, expect, test } from "bun:test";
import { badgeRect } from "../assets/draw";
import { iconLicense, iconNames, iconSvg } from "../assets/icons";
import { importSvg } from "../assets/svg-import";
import { compileFigure } from "../compiler/compile";
import { CORNERS } from "../core/figure/schema";
import { resolveEnds } from "../layout/route/ports";
import { lintGeometry } from "../lint";
import { readSvgMetadata } from "./finalize";
import { svgToPdf } from "./pdf";
import { inspectPdf } from "./pdf/testing";
import { svgToEditablePptx, svgToPptx } from "./pptx";
import { readPptx } from "./pptx/testing";
import { renderFigure } from "./render";

test("the entire bundled colour subset passes the shared SVG importer", () => {
  expect(iconNames("emoji")).toHaveLength(47);
  expect(iconLicense("emoji")).toContain("Copyright (c) Microsoft Corporation.");
  for (const name of iconNames("emoji")) {
    const svg = iconSvg("emoji", name);
    expect(svg).toBeDefined();
    const imported = importSvg(svg as string, { dropInvisible: true });
    expect({ name, ok: imported.ok }).toEqual({ name, ok: true });
  }
});

for (const corner of CORNERS) {
  test(`${corner}: badges reserve space, keep body size, attach outside the corner`, async () => {
    const source = `version: 1
figure: { id: corners, layout: { arrange: { row: { gap: 0, items: [a, b] } } } }
nodes:
  - { id: a, component: box, label: QKV, props: { width: 30pt, height: 20pt }, badge: { icon: emoji/snowflake, corner: ${corner} } }
  - { id: b, component: box, label: Out, props: { width: 30pt, height: 20pt } }
  - { id: note, component: label, label: I, attach: { to: a, side: ${corner}, gap: 8pt } }
`;
    const rendered = await renderFigure(source);
    if (!rendered.ok || !("layout" in rendered.value))
      throw new Error(JSON.stringify(rendered.diagnostics));
    const { layout, compiled } = rendered.value;
    const body = layout.nodes.find((n) => n.key === "n:a");
    const note = layout.nodes.find((n) => n.key === "n:note");
    if (!body || !note) throw new Error("missing nodes");
    expect(body.rect.width).toBe(60);
    expect(body.rect.height).toBe(40);
    const node = compiled.ir.nodes[0];
    if (node === undefined) throw new Error("missing badge node");
    const badge = badgeRect(node, body.rect);
    if (badge === undefined) throw new Error("missing badge footprint");
    expect(badge.x).toBeGreaterThanOrEqual(0);
    expect(badge.y).toBeGreaterThanOrEqual(0);
    expect(badge.x + badge.width).toBeLessThanOrEqual(layout.canvas.width);
    expect(badge.y + badge.height).toBeLessThanOrEqual(layout.canvas.height);
    expect(
      corner.endsWith("east")
        ? note.rect.x >= body.rect.x + body.rect.width + 16
        : note.rect.x + note.rect.width <= body.rect.x - 16,
    ).toBe(true);
    expect(
      corner.startsWith("north")
        ? note.rect.y + note.rect.height <= body.rect.y - 16
        : note.rect.y >= body.rect.y + body.rect.height + 16,
    ).toBe(true);
    expect(
      lintGeometry(rendered.value).filter((d) => d.code === "geometry/badge-collision"),
    ).toEqual([]);
  });
}

describe("colour assets and output notices", () => {
  for (const engine of ["auto", "structured"] as const) {
    test(`${engine}: LoRA and projection badges survive SVG, vector PDF and picture PPTX`, async () => {
      const source = `version: 1
figure: { id: badges, theme: paper, ${engine === "structured" ? "layout: { arrange: { row: { items: [lora, qkv, out] } } }" : ""} }
nodes:
  - { id: lora, component: bowtie, label: LoRA, tone: pink, badge: { icon: emoji/fire, corner: north-east } }
  - { id: qkv, component: box, label: QKV, badge: { icon: emoji/snowflake, corner: north-east } }
  - { id: out, component: box, icon: emoji/fire }
`;
      const rendered = await renderFigure(source);
      if (!rendered.ok) throw new Error(JSON.stringify(rendered.diagnostics));
      const { svg, compiled } = rendered.value;
      expect(svg.match(/class="sumi-badge"/g)).toHaveLength(2);
      expect(svg).toContain('fill="#ff6723"');
      expect(svg).not.toContain("currentColor");
      expect(
        lintGeometry(rendered.value).filter((d) => d.code === "geometry/badge-collision"),
      ).toEqual([]);
      const metadata = readSvgMetadata(svg);
      expect(metadata.ok && metadata.value?.notices).toEqual([
        expect.objectContaining({
          name: "Fluent Emoji Flat",
          license: "MIT",
          text: expect.stringContaining("Microsoft Corporation"),
        }),
      ]);
      const pdf = svgToPdf(svg);
      if (!pdf.ok) throw new Error(JSON.stringify(pdf.diagnostics));
      expect(inspectPdf(pdf.value).images).toBe(0);
      const pptx = svgToPptx(svg);
      if (!pptx.ok) throw new Error(JSON.stringify(pptx.diagnostics));
      const parts = readPptx(pptx.value);
      const picture = [...parts.entries()].find(([name]) => name.endsWith(".svg"));
      expect(picture).toBeDefined();
      expect(new TextDecoder().decode(picture?.[1])).toMatch(/#ff6723/i);
      const custom = new TextDecoder().decode(parts.get("docProps/custom.xml"));
      expect(custom).toContain("Fluent Emoji Flat");
      expect(custom).toContain("Microsoft Corporation");
      expect(svgToEditablePptx(svg, compiled.ir).diagnostics.map((d) => d.code)).toContain(
        "pptx/unsupported-asset",
      );
    }, 30_000);
  }
});

test("unknown badge icons report the written badge path", () => {
  const result = compileFigure(`version: 1
figure: { id: invalid }
nodes: [{ id: a, component: box, badge: { icon: emoji/snwoflake, corner: north-east } }]
`);
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "asset/unknown-icon",
      path: ["nodes", 0, "badge", "icon"],
      hint: 'Did you mean "emoji/snowflake"?',
    }),
  );
});

test("badges on expanded components are rejected before expansion can drop them", () => {
  const result = compileFigure(`version: 1
figure: { id: invalid, layout: { arrange: { row: { items: [a] } } } }
nodes:
  - { id: a, component: tokens, props: { cells: [A] }, badge: { icon: emoji/fire, corner: north-east } }
`);
  expect(result.ok).toBe(false);
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({ code: "component/badge-unsupported", path: ["nodes", 0, "badge"] }),
  );
});

test("lint checks foreign overlaps while permitting the badge's own body", async () => {
  const source = `version: 1
figure: { id: collision, layout: { arrange: { row: { items: [a] } } } }
nodes:
  - { id: a, component: box, label: A, badge: { icon: emoji/fire, corner: north-east } }
  - { id: note, component: box, label: Other, attach: { to: a, side: north-east, gap: 0 } }
`;
  const result = await renderFigure(source);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  // Attach placement now keeps the footprints apart. Force a foreign body
  // into the badge to exercise the lint independently of placement.
  const a = result.value.inspection.elements.find((e) => e.key === "n:a");
  const node = result.value.compiled.ir.nodes[0];
  if (!a?.bbox || !node) throw new Error("missing badge body");
  const footprint = badgeRect(node, a.bbox);
  if (!footprint) throw new Error("missing badge");
  const inspection = {
    ...result.value.inspection,
    elements: result.value.inspection.elements.map((e) =>
      e.key === "n:note" ? { ...e, bbox: footprint } : e,
    ),
  };
  expect(
    lintGeometry({ ...result.value, inspection }, { source }).filter(
      (d) => d.code === "geometry/badge-collision",
    ),
  ).toEqual([
    expect.objectContaining({
      path: ["nodes", 0, "badge"],
      related: expect.arrayContaining([expect.objectContaining({ path: ["nodes", 1] })]),
    }),
  ]);
});

for (const engine of ["auto", "structured"] as const) {
  test(`${engine}: every curated emoji survives replacement and badge output paths`, async () => {
    const names = iconNames("emoji");
    const source = `version: 1
figure: { id: all-emoji, ${engine === "structured" ? `layout: { arrange: { stack: { items: [${names.map((_, i) => `a${i}`).join(",")}] } } }` : ""} }
nodes:
${names.map((name, i) => `  - { id: a${i}, component: box, icon: emoji/${name}, badge: { icon: emoji/${name}, corner: north-east } }`).join("\n")}
`;
    const result = await renderFigure(source);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const { svg, compiled } = result.value;
    expect(svg.match(/class="sumi-badge"/g)).toHaveLength(47);
    expect(svg.match(/class="sumi-icon"/g)).toHaveLength(94);
    for (const name of names) {
      const imported = importSvg(iconSvg("emoji", name) as string, { dropInvisible: true });
      if (!imported.ok) throw new Error(name);
      expect(svg).toContain(imported.value.markup);
    }
    const pdf = svgToPdf(svg);
    if (!pdf.ok) throw new Error(JSON.stringify(pdf.diagnostics));
    expect(inspectPdf(pdf.value).images).toBe(0);
    const pptx = svgToPptx(svg);
    if (!pptx.ok) throw new Error(JSON.stringify(pptx.diagnostics));
    const parts = readPptx(pptx.value);
    expect([...parts.keys()].some((name) => name.endsWith(".svg"))).toBe(true);
    expect([...parts.keys()].some((name) => name.endsWith(".png"))).toBe(true);
    expect(svgToEditablePptx(svg, compiled.ir).diagnostics.map((d) => d.code)).toContain(
      "pptx/unsupported-asset",
    );
  }, 30_000);
}

test("dim deliberately preserves the original colour emoji palette without an image warning", async () => {
  const result = await renderFigure(`version: 1
figure: { id: dim, layout: { arrange: { row: { items: [g] } } } }
groups: [{ id: g, dim: true, arrange: { row: { items: [a] } } }]
nodes: [{ id: a, group: g, component: box, icon: emoji/fire, badge: { icon: emoji/snowflake, corner: north-east } }]
`);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  for (const name of ["fire", "snowflake"]) {
    const imported = importSvg(iconSvg("emoji", name) as string, { dropInvisible: true });
    if (!imported.ok) throw new Error(name);
    expect(result.value.svg).toContain(imported.value.markup);
  }
  expect(result.diagnostics.map((d) => d.code)).not.toContain("theme/undimmed-image");
});

for (const corner of CORNERS) {
  for (const direction of ["right", "left"] as const) {
    test(`tiny ${corner} body reserves the actual union in ${direction} order`, async () => {
      const result = await renderFigure(`version: 1
figure: { id: tiny, layout: { arrange: { row: { gap: 0, direction: ${direction}, items: [b, a] } } } }
nodes:
  - { id: a, component: box, props: { width: 2pt, height: 2pt }, badge: { icon: emoji/fire, corner: ${corner} } }
  - { id: b, component: box, props: { width: 20pt, height: 20pt } }
`);
      if (!result.ok || !("layout" in result.value))
        throw new Error(JSON.stringify(result.diagnostics));
      const a = result.value.layout.nodes.find((n) => n.key === "n:a");
      const b = result.value.layout.nodes.find((n) => n.key === "n:b");
      const node = result.value.compiled.ir.nodes[0];
      if (!a || !b || !node) throw new Error("missing nodes");
      const badge = badgeRect(node, a.rect);
      if (!badge) throw new Error("missing badge");
      expect(a.rect.width).toBe(4);
      expect(a.rect.height).toBe(4);
      expect(
        direction === "right"
          ? badge.x >= b.rect.x + b.rect.width
          : badge.x + badge.width <= b.rect.x,
      ).toBe(true);
      expect(
        lintGeometry(result.value).filter((d) => d.code === "geometry/badge-collision"),
      ).toEqual([]);
    });
  }
}

test("attached tiny badge footprints and chains stay apart inside nested groups", async () => {
  const result = await renderFigure(`version: 1
figure: { id: chain, layout: { arrange: { row: { items: [outer] } } } }
groups:
  - { id: outer, arrange: { row: { items: [inner] } } }
  - { id: inner, group: outer, arrange: { row: { items: [a] } } }
nodes:
  - { id: a, component: box, group: inner, props: { width: 2pt, height: 2pt }, badge: { icon: emoji/fire, corner: north-east } }
  - { id: b, component: box, group: inner, props: { width: 2pt, height: 2pt }, badge: { icon: emoji/fire, corner: north-west }, attach: { to: a, side: east, gap: 0 } }
  - { id: c, component: box, group: inner, props: { width: 2pt, height: 2pt }, badge: { icon: emoji/fire, corner: south-west }, attach: { to: b, side: east, gap: 0 } }
`);
  if (!result.ok || !("layout" in result.value))
    throw new Error(JSON.stringify(result.diagnostics));
  expect(lintGeometry(result.value).filter((d) => d.code === "geometry/badge-collision")).toEqual(
    [],
  );
  const boxes = result.value.compiled.ir.nodes.map((node) => {
    const placed =
      "layout" in result.value && result.value.layout.nodes.find((n) => n.key === node.key);
    if (!placed) throw new Error("missing node");
    return badgeRect(node, placed.rect);
  });
  expect(boxes[0] && boxes[1] && boxes[0].x + boxes[0].width <= boxes[1].x).toBe(true);
  expect(boxes[1] && boxes[2] && boxes[1].x + boxes[1].width <= boxes[2].x).toBe(true);
});

for (const side of ["north", "south"] as const) {
  for (const offset of [0.25, 0.5, 0.75]) {
    test(`bowtie ${side}:${offset} routes onto the concave silhouette`, async () => {
      const result = await renderFigure(`version: 1
figure: { id: ports, layout: { arrange: { stack: { items: [a, b] } } } }
nodes:
  - { id: a, component: box }
  - { id: b, component: bowtie, label: B }
edges: [{ from: a, to: b, toAnchor: "${side}:${offset}" }]
`);
      if (!result.ok || !("layout" in result.value))
        throw new Error(JSON.stringify(result.diagnostics));
      const { compiled, layout } = result.value;
      const pair = resolveEnds(compiled.ir, layout)[0];
      const b = layout.nodes.find((n) => n.key === "n:b");
      if (!pair || "error" in pair || !b) throw new Error("missing routed end");
      const inset = (b.rect.height * Math.min(offset, 1 - offset)) / 2;
      expect(pair.to.outline.x).toBeCloseTo(b.rect.x + b.rect.width * offset, 3);
      expect(pair.to.outline.y).toBeCloseTo(
        side === "north" ? b.rect.y + inset : b.rect.y + b.rect.height - inset,
        3,
      );
      expect(layout.edges[0]?.route?.points.at(-1)).toEqual(pair.to.outline);
    });
  }
}

test("badge geometry survives actual fit downscaling", async () => {
  const result = await renderFigure(`version: 1
figure: { id: scaled, fit: scale, layout: { arrange: { row: { items: [a] } } } }
nodes: [{ id: a, component: box, label: A, props: { width: 283.5pt, height: 20pt }, badge: { icon: emoji/fire, corner: north-east } }]
`);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  expect(result.value.inspection.scale).toBeLessThan(1);
  expect(result.value.inspection.scale).toBeGreaterThan(0);
  expect(lintGeometry(result.value).filter((d) => d.code === "geometry/badge-collision")).toEqual(
    [],
  );
  expect(svgToPdf(result.value.svg).ok).toBe(true);
  expect(svgToPptx(result.value.svg).ok).toBe(true);
});
