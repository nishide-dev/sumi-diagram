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
