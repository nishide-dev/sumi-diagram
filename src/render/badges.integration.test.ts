import { describe, expect, test } from "bun:test";
import { badgeRect } from "../assets/draw";
import { iconLicense, iconNames, iconSvg } from "../assets/icons";
import { importSvg } from "../assets/svg-import";
import { compileFigure } from "../compiler/compile";
import { CORNERS } from "../core/figure/schema";
import { lintGeometry } from "../lint";
import { readSvgMetadata } from "./finalize";
import { svgToPdf } from "./pdf";
import { inspectPdf } from "./pdf/testing";
import { svgToEditablePptx, svgToPptx } from "./pptx";
import { readPptx } from "./pptx/testing";
import { renderFigure } from "./render";

test("the entire bundled colour subset passes the shared SVG importer", () => {
  expect(iconNames("emoji")).toEqual(["fire", "snowflake"]);
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
  - { id: note, component: label, label: Other, attach: { to: a, side: north-east, gap: 0 } }
`;
  const result = await renderFigure(source);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  expect(
    lintGeometry(result.value, { source }).filter((d) => d.code === "geometry/badge-collision"),
  ).toEqual([
    expect.objectContaining({
      path: ["nodes", 0, "badge"],
      related: expect.arrayContaining([expect.objectContaining({ path: ["nodes", 1] })]),
    }),
  ]);
});
