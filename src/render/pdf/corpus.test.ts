/** PDF contract and byte equality on gallery shapes and Japanese text (#74). */
import { afterAll, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DEFAULT_FONT_SET_ID, getFontSet } from "../../core/theme/fonts";
import { svgToPdf } from "./pdf";
import { inspectPdf } from "./testing";

const root = resolve(import.meta.dir, "../../..");
const file = join(root, "tests/fixtures/pdf/corpus-sha256.json");
const golden = JSON.parse(readFileSync(file, "utf8")) as Record<string, string>;
const update = process.env.SUMI_UPDATE_GOLDEN === "1";
const actual: Record<string, string> = {};
const fontSet = getFontSet(DEFAULT_FONT_SET_ID);
if (!fontSet) throw new Error("Missing bundled font set");
const paths = [...new Bun.Glob("docs/gallery/components/*.svg").scanSync(root)].sort();
const corpus = paths.map((path) => ({ id: path, svg: readFileSync(join(root, path), "utf8") }));
corpus.push({
  id: "japanese-mask",
  svg: readFileSync(join(root, "tests/fixtures/pdf/japanese-mask.svg"), "utf8"),
});
test("the PDF corpus includes every component/theme and Japanese mask", () => {
  expect(paths.length).toBeGreaterThanOrEqual(48);
  if (!update) expect(Object.keys(golden).sort()).toEqual(corpus.map((c) => c.id).sort());
});
for (const { id, svg } of corpus) {
  test(`PDF corpus: ${id}`, () => {
    const result = svgToPdf(svg, { fontSet });
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const pdf = inspectPdf(result.value);
    expect(pdf.version).toBe("1.7");
    expect(pdf.pages).toHaveLength(1);
    // Raster images (#94) are embedded as PDF images; everything else stays vector.
    expect(pdf.images > 0).toBe(/data:image\/(png|jpeg)/.test(svg));
    expect(pdf.fonts.length).toBeGreaterThan(0);
    for (const font of pdf.fonts) expect(font).toMatchObject({ embedded: true, subset: true });
    expect(pdf.glyphs.every((g) => g.text !== "�")).toBe(true);
    expect(pdf.info.CreationDate).toBeUndefined();
    expect(pdf.info.ModDate).toBeUndefined();
    if (id === "japanese-mask") {
      expect(pdf.glyphs.map((g) => g.text).join("")).toBe("日本語 ABC 123決定性・埋め込み");
      expect(pdf.pages[0]?.mediaBox).toEqual([0, 0, 240, 120]);
    }
    const hash = new Bun.CryptoHasher("sha256").update(result.value).digest("hex");
    actual[id] = hash;
    if (!update) {
      const expected = golden[id];
      if (expected === undefined) throw new Error(`Missing PDF golden: ${id}`);
      expect(hash).toBe(expected);
    }
  });
}
afterAll(() => {
  if (update) writeFileSync(file, `${JSON.stringify(actual, null, 2)}\n`);
});
