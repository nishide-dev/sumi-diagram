/**
 * Icons and images through the whole pipeline (#94), with both engines:
 * `tests/fixtures/assets/images.sumi.yaml` (structured) and
 * `images-auto.sumi.yaml` (D2, placeholders + composition) embed a PNG, a
 * JPEG, an SVG and bundled icons. The SVG, the PDF and the picture PPTX are
 * byte-deterministic and recorded as sha256 goldens
 * (`tests/fixtures/assets/outputs-sha256.json`, `SUMI_UPDATE_GOLDEN=1`).
 *
 * The D2 figure is skipped without the pinned D2 locally (required in CI).
 */

import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkD2Version, findD2Binary } from "../backends/d2/binary";
import { ASSETS_DIR } from "../compiler/testing";
import { lintGeometry } from "../lint";
import { assetProvenanceEntries, readSvgMetadata } from "./finalize";
import { inspectSvg } from "./inspect";
import { svgToPdf } from "./pdf";
import { inspectPdf } from "./pdf/testing";
import { svgToEditablePptx, svgToPptx } from "./pptx";
import { readPptx } from "./pptx/testing";
import { renderFigure } from "./render";
import { parseXml } from "./xml";

const binary = findD2Binary();
const d2 = binary.ok && (await checkD2Version(binary.value.path)).ok;
const inCI = Boolean(process.env.CI);
const update = process.env.SUMI_UPDATE_GOLDEN === "1";
const goldenPath = join(ASSETS_DIR, "outputs-sha256.json");
const golden = JSON.parse(readFileSync(goldenPath, "utf8")) as Record<string, string>;
const actual: Record<string, string> = {};
const sha256 = (bytes: string | Uint8Array) =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

afterAll(() => {
  if (update) {
    const sorted = Object.fromEntries(Object.entries({ ...golden, ...actual }).sort());
    writeFileSync(goldenPath, `${JSON.stringify(sorted, null, 2)}\n`);
  }
});

const record = (key: string, bytes: string | Uint8Array) => {
  const hash = sha256(bytes);
  actual[key] = hash;
  if (!update) expect(`${key} ${hash}`).toBe(`${key} ${golden[key] ?? "(no golden)"}`);
};

test("colour emoji badges retain their vector paths and MIT notice in each output", async () => {
  const file = "emoji-badges.sumi.yaml";
  const result = await render(file);
  expect(lintGeometry(result, { source: result.source })).toEqual([]);
  record(`${file}.svg`, result.svg);
  const pdf = svgToPdf(result.svg);
  if (!pdf.ok) throw new Error(JSON.stringify(pdf.diagnostics));
  expect(inspectPdf(pdf.value).images).toBe(0);
  expect(inspectPdf(pdf.value).info.SumiThirdPartyNotice).toContain("Microsoft Corporation");
  record(`${file}.pdf`, pdf.value);
  const pptx = svgToPptx(result.svg);
  if (!pptx.ok) throw new Error(JSON.stringify(pptx.diagnostics));
  record(`${file}.pptx`, pptx.value);
});

async function render(file: string) {
  const source = readFileSync(join(ASSETS_DIR, file), "utf8");
  const result = await renderFigure(source, { file, assetBase: ASSETS_DIR });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  expect(result.diagnostics).toEqual([]);
  return { source, ...result.value };
}

for (const [file, needsD2] of [
  ["images.sumi.yaml", false],
  ["images-auto.sumi.yaml", true],
] as const) {
  describe.skipIf(needsD2 && !d2 && !inCI)(file, () => {
    test("renders deterministically to SVG, PDF and picture PPTX", async () => {
      const first = await render(file);
      const second = await render(file);
      expect(second.svg).toBe(first.svg);
      expect(lintGeometry(first, { source: first.source })).toEqual([]);

      // The SVG: one image per image node, one icon group per icon node, no nested <svg>.
      const { ir } = first.compiled;
      const images = ir.nodes.filter((n) => n.image !== undefined).length;
      const icons = ir.nodes.filter((n) => n.icon !== undefined).length;
      expect(first.svg.match(/<image class="sumi-image"/g)?.length).toBe(images);
      expect(first.svg.match(/<g class="sumi-icon"/g)?.length).toBe(icons);
      expect(first.svg.match(/<svg\b/g)?.length).toBe(2); // the root and svg.d2-svg
      expect(first.svg).not.toMatch(/href="(?!data:)/);
      expect(inspectSvg(first.svg, ir).ok).toBe(true);

      // Provenance: assets-sha256 and the Tabler notice, kept in every format.
      const metadata = readSvgMetadata(first.svg);
      if (!metadata.ok || metadata.value === undefined) throw new Error("no metadata");
      expect(metadata.value.assetsSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(metadata.value.notices).toEqual([
        expect.objectContaining({ name: "Tabler Icons", version: "3.49.0", license: "MIT" }),
      ]);
      record(`${file}.svg`, first.svg);

      const pdf = svgToPdf(first.svg);
      if (!pdf.ok) throw new Error(JSON.stringify(pdf.diagnostics));
      const again = svgToPdf(second.svg);
      expect(again.ok && sha256(again.value)).toBe(sha256(pdf.value));
      const inspected = inspectPdf(pdf.value);
      // The PNG and the JPEG are PDF images; the SVG image and the icons stay vector.
      expect(inspected.images).toBeGreaterThanOrEqual(2);
      expect(inspected.info).toMatchObject(
        Object.fromEntries(assetProvenanceEntries(metadata.value)),
      );
      record(`${file}.pdf`, pdf.value);

      const pptx = svgToPptx(first.svg);
      if (!pptx.ok) throw new Error(JSON.stringify(pptx.diagnostics));
      const parts = readPptx(pptx.value);
      const custom = new TextDecoder().decode(parts.get("docProps/custom.xml"));
      expect(custom).toContain("SumiAssetsSha256");
      expect(custom).toContain("SumiThirdPartyNotice");
      record(`${file}.pptx`, pptx.value);

      // The editable PPTX refuses icons and images rather than dropping them.
      const editable = svgToEditablePptx(first.svg, ir);
      expect(editable.ok).toBe(false);
      expect(editable.diagnostics.map((d) => [d.code, d.subject?.id])).toEqual(
        ir.nodes
          .filter((n) => n.icon !== undefined || n.image !== undefined)
          .map((n) => ["pptx/unsupported-asset", n.id]),
      );
    }, 60_000);
  });
}

describe("icons follow the node's text color", () => {
  test("currentColor becomes the font color of the node's theme, variant and tone", async () => {
    const source = `version: 1
figure: { id: colors, theme: color, layout: { arrange: { row: { items: [a, b] } } } }
nodes:
  - { id: a, component: box, icon: tabler/flame }
  - { id: b, component: box, icon: tabler/flame, variant: muted }
`;
    const result = await renderFigure(source);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const groups = [...result.value.svg.matchAll(/<g class="sumi-icon"[^>]*><g([^>]*)>/g)].map(
      (m) => m[1],
    );
    const [a, b] = result.value.compiled.ir.nodes;
    expect(groups).toEqual([
      ` fill="none" stroke="${a?.style.fontColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`,
      ` fill="none" stroke="${b?.style.fontColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`,
    ]);
    expect(a?.style.fontColor).not.toBe(b?.style.fontColor);
    const parsed = parseXml(result.value.svg);
    expect(parsed.ok).toBe(true);
  });

  test("a tone is the background under an image; the frame is drawn over it", async () => {
    const source = `version: 1
figure: { id: toned, theme: color, layout: { arrange: { row: { items: [a] } } } }
nodes:
  - { id: a, component: image, variant: framed, tone: orange, props: { src: gradient.png, width: 40pt, height: 20pt } }
`;
    const result = await renderFigure(source, { assetBase: ASSETS_DIR });
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const node =
      /<g class="sumi-k-n--a[^"]*">([\s\S]*?)<\/g><\/svg>/.exec(result.value.svg)?.[1] ?? "";
    const order = ['<g class="shape">', '<image class="sumi-image"', "sumi-image-frame"].map((s) =>
      node.indexOf(s),
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((p, q) => p - q)).toEqual(order);
    const fill = result.value.compiled.ir.nodes[0]?.style.fill;
    expect(node).toContain(`fill="${fill}"`);
    expect(node).toMatch(/sumi-image-frame"[^>]*fill="none"/);
  });

  test("icons are checked like labels by the geometry lint", async () => {
    // Two icon-only label nodes attached to the same side overlap.
    const overlap = `version: 1
figure: { id: overlap, layout: { arrange: { row: { items: [box] } } } }
nodes:
  - { id: box, component: box, label: Box }
  - { id: a, component: label, icon: tabler/flame, attach: { to: box, side: east } }
  - { id: b, component: label, icon: tabler/flame, attach: { to: box, side: east } }
`;
    const first = await renderFigure(overlap);
    if (!first.ok) throw new Error(JSON.stringify(first.diagnostics));
    const collisions = lintGeometry(first.value, { source: overlap }).filter(
      (d) => d.code === "geometry/label-collision",
    );
    expect(collisions.map((d) => [d.message, d.path])).toEqual([
      ['The icon of node "a" overlaps the icon of node "b".', ["nodes", 1, "icon"]],
    ]);
    // An icon larger than an explicitly sized node overflows it.
    const tiny = `version: 1
figure: { id: tiny, layout: { arrange: { row: { items: [a] } } } }
nodes:
  - { id: a, component: box, icon: tabler/flame, props: { width: 4pt, height: 4pt } }
`;
    const second = await renderFigure(tiny);
    if (!second.ok) throw new Error(JSON.stringify(second.diagnostics));
    expect(lintGeometry(second.value, { source: tiny }).map((d) => d.code)).toContain(
      "geometry/label-overflow",
    );
  });

  test("a figure without assets has no assets-sha256 or notice", async () => {
    const result = await renderFigure(
      "version: 1\nfigure: { id: plain, layout: { arrange: { row: { items: [a] } } } }\nnodes: [{ id: a, component: box, label: A }]\n",
    );
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.value.svg).not.toContain("assets-sha256");
    expect(result.value.svg).not.toContain("sumi:notice");
  });
});
