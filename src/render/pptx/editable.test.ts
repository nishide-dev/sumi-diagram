import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { editableCorpus } from "../../../scripts/pptx-validator/editable-corpus";
import { DEFAULT_FONT_SET_ID, getFontSet } from "../../core/theme/fonts";
import { attribute, childElements, descendants, parseXml, textContent } from "../xml";
import { svgToEditablePptx } from "./editable";
import { readPptx } from "./testing";

const root = resolve(import.meta.dir, "../../..");
const update = process.env.SUMI_UPDATE_GOLDEN === "1";
const corpus = editableCorpus();
const goldenDir = resolve(root, "tests/fixtures/pptx-editable");
const hashPath = resolve(root, "tests/fixtures/pptx-editable-sha256.json");
const hashes = JSON.parse(readFileSync(hashPath, "utf8")) as Record<string, string>;
const actual: Record<string, string> = {};
if (update) mkdirSync(goldenDir, { recursive: true });
test("editable corpus includes every current component and examples", () =>
  expect(corpus.length).toBeGreaterThanOrEqual(53));
for (const item of corpus)
  for (const connectors of ["freeform", "glued"] as const)
    test(`${item.id}: editable ${connectors}`, () => {
      const result = svgToEditablePptx(item.svg, item.ir, { connectors });
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
      expect(result.diagnostics.map((d) => d.code)).toContain("pptx/experimental-editable");
      const parts = readPptx(result.value);
      expect([...parts.keys()].some((p) => p.startsWith("ppt/media/"))).toBe(false);
      for (const [name, bytes] of parts)
        if (name.endsWith(".xml") || name.endsWith(".rels"))
          expect(parseXml(new TextDecoder().decode(bytes)).ok).toBe(true);
      const slide = new TextDecoder().decode(parts.get("ppt/slides/slide1.xml"));
      const parsed = parseXml(slide);
      if (!parsed.ok) throw new Error(parsed.message);
      const all = [...descendants(parsed.root)];
      expect(all.some((e) => e.name === "p:pic")).toBe(false);
      const names = new Map(
        all
          .filter((e) => e.name === "p:cNvPr")
          .map((e) => [attribute(e, "name"), attribute(e, "id")]),
      );
      const ids = all.filter((e) => e.name === "p:cNvPr").map((e) => attribute(e, "id"));
      expect(new Set(ids).size).toBe(ids.length);
      for (const element of item.ir.elements.values()) {
        expect(names.has(element.key)).toBe(true);
        const shape = all.find(
          (e) =>
            ["p:sp", "p:cxnSp"].includes(e.name) &&
            [...descendants(e)].some(
              (n) => n.name === "p:cNvPr" && attribute(n, "name") === element.key,
            ),
        );
        expect(shape).toBeDefined();
        if (!shape) continue;
        if (element.kind === "edge") {
          expect(shape.name).toBe(connectors === "glued" ? "p:cxnSp" : "p:sp");
          if (connectors === "glued") {
            const refs = [...descendants(shape)].filter((e) =>
              ["a:stCxn", "a:endCxn"].includes(e.name),
            );
            expect(refs.map((e) => attribute(e, "id"))).toEqual([
              names.get(element.from),
              names.get(element.to),
            ]);
          }
        } else if (element.label.trim()) {
          const tx = childElements(shape).find((e) => e.name === "p:txBody");
          expect(tx).toBeDefined();
          expect(tx && textContent(tx).replace(/\s/g, "")).toBe(element.label.replace(/\s/g, ""));
        }
      }
      const golden = resolve(goldenDir, `${item.id.replaceAll("/", "_")}.${connectors}.xml`);
      if (update) writeFileSync(golden, `${slide}\n`);
      expect(`${slide}\n`).toBe(readFileSync(golden, "utf8"));
      const again = svgToEditablePptx(item.svg, item.ir, { connectors });
      const hash = new Bun.CryptoHasher("sha256").update(result.value).digest("hex");
      expect(again.ok && new Bun.CryptoHasher("sha256").update(again.value).digest("hex")).toBe(
        hash,
      );
      const key = `${item.id}.${connectors}`;
      actual[key] = hash;
      if (!update) {
        const expected = hashes[key];
        if (!expected) throw new Error(`Missing native golden ${key}`);
        expect(hash).toBe(expected);
      }
    });
test("native package manifest covers the corpus", () => {
  if (update) writeFileSync(hashPath, `${JSON.stringify(actual, null, 2)}\n`);
  else
    expect(Object.keys(hashes).sort()).toEqual(
      corpus.flatMap((item) => [`${item.id}.freeform`, `${item.id}.glued`]).sort(),
    );
});
test("unsupported native input is a diagnostic, not a damaged package", () => {
  const item = corpus[0];
  if (!item) throw new Error("Empty corpus");
  expect(svgToEditablePptx("<svg", item.ir).ok).toBe(false);
  expect(svgToEditablePptx(item.svg, item.ir, { connectors: "bad" as "freeform" }).ok).toBe(false);
  const fontSet = getFontSet(DEFAULT_FONT_SET_ID);
  if (!fontSet) throw new Error("Missing fonts");
  const missing = svgToEditablePptx(item.svg, item.ir, {
    fontSet: { ...fontSet, regular: "/missing/editable-font.ttf" },
  });
  expect(missing.diagnostics[0]?.code).toBe("pptx/missing-font");
});

// #170 (design doc §6.41): an edge label's box takes the fill of the <rect>
// the SVG draws before the label. In D2's SVG that is the edge's `fill`
// (white in the built-in themes, but any color is kept); without one, D2
// masks the line under the label, so the box stays white; with neither
// (structured SVG, edge `fill: transparent`), it has no fill.
test("D2 edge labels: the SVG's label rect, else white under a mask, else no fill", () => {
  const item = corpus.find((c) => c.id === "examples/decision-flow/decision-flow");
  if (!item) throw new Error("missing decision-flow");
  const fills = (svg: string) => {
    const result = svgToEditablePptx(svg, item.ir);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const slide = new TextDecoder().decode(readPptx(result.value).get("ppt/slides/slide1.xml"));
    return [
      ...slide.matchAll(
        /name="e:#\d+ label 0"\/>.*?<\/a:prstGeom>(<a:noFill\/>|<a:solidFill><a:srgbClr val="([0-9A-F]{6})">)/g,
      ),
    ].map((m) => m[2] ?? "none");
  };
  const rect =
    /<rect x="[^"]*" y="[^"]*" width="[^"]*" height="[^"]*" rx="10" fill="#ffffff" \/>(?=<text)/g;
  const count = item.svg.match(rect)?.length ?? 0;
  expect(count).toBeGreaterThan(0);
  expect(fills(item.svg)).toEqual(Array(count).fill("FFFFFF"));
  expect(fills(item.svg.replace(rect, (r) => r.replace("#ffffff", "#ff0000")))).toEqual(
    Array(count).fill("FF0000"),
  );
  const unboxed = item.svg.replace(rect, "");
  expect(unboxed).toContain('mask="url(#');
  expect(fills(unboxed)).toEqual(Array(count).fill("FFFFFF"));
  expect(fills(unboxed.replace(/ mask="url\(#[^"]*\)"/g, ""))).toEqual(Array(count).fill("none"));
});
