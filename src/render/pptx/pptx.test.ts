import { afterAll, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DEFAULT_FONT_SET_ID, getFontSet } from "../../core/theme/fonts";
import { svgToPptx } from "./pptx";
import { inspectPptx } from "./testing";

const root = resolve(import.meta.dir, "../../..");
const goldenPath = join(root, "tests/fixtures/pptx-sha256.json");
const golden = JSON.parse(readFileSync(goldenPath, "utf8")) as Record<string, string>;
const update = process.env.SUMI_UPDATE_GOLDEN === "1";
const actual: Record<string, string> = {};
const fontSet = getFontSet(DEFAULT_FONT_SET_ID);
if (!fontSet) throw new Error("Missing fonts");
const cases = [
  ...new Bun.Glob("examples/*/*.svg").scanSync(root),
  ...new Bun.Glob("docs/gallery/components/*.svg").scanSync(root),
  "tests/fixtures/pdf/japanese-mask.svg",
].sort();
test("PPTX corpus matches its recorded input set", () => {
  expect(cases.length).toBeGreaterThanOrEqual(53);
  if (!update) expect(Object.keys(golden).sort()).toEqual(cases);
});
for (const path of cases)
  test(`picture PPTX: ${path}`, () => {
    const svg = readFileSync(join(root, path), "utf8");
    const result = svgToPptx(svg, { fontSet });
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const inspected = inspectPptx(result.value);
    const w = Number(/<svg[^>]* width="([\d.]+)pt"/.exec(svg)?.[1]);
    const h = Number(/<svg[^>]* height="([\d.]+)pt"/.exec(svg)?.[1]);
    expect(inspected.widthPt).toBe(Math.max(72, w));
    expect(inspected.heightPt).toBe(Math.max(72, h));
    expect(inspected.pngWidth).toBe(Math.ceil((w * 8) / 3));
    expect(inspected.pngHeight).toBe(Math.ceil((h * 8) / 3));
    const hash = new Bun.CryptoHasher("sha256").update(result.value).digest("hex");
    actual[path] = hash;
    if (!update) {
      const expected = golden[path];
      if (!expected) throw new Error(`Missing golden ${path}`);
      expect(hash).toBe(expected);
    }
    const again = svgToPptx(svg, { fontSet });
    expect(again.ok && new Bun.CryptoHasher("sha256").update(again.value).digest("hex")).toBe(hash);
    if (path.includes("decision-flow")) {
      const corrupted = result.value.slice();
      corrupted[31] = (corrupted[31] ?? 0) ^ 1;
      expect(() => inspectPptx(corrupted)).toThrow();
    }
  });
test("large valid slides keep a bounded PNG fallback", () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="4032pt" height="4032pt"><rect width="10" height="10" fill="red"/></svg>';
  const result = svgToPptx(svg, { fontSet });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const inspected = inspectPptx(result.value);
  expect(inspected.widthPt).toBe(4032);
  expect(inspected.pngWidth * inspected.pngHeight).toBeLessThanOrEqual(16_100_000);
  expect(inspected.pngWidth).toBeLessThan(8192);
});

test("PPTX errors are diagnostics, not exceptions", () => {
  expect(svgToPptx("<svg").diagnostics[0]?.code).toBe("svg/invalid");
  expect(
    svgToPptx('<svg xmlns="http://www.w3.org/2000/svg" width="5000pt" height="10pt"/>')
      .diagnostics[0]?.code,
  ).toBe("pptx/unsupported-size");
  expect(
    svgToPptx('<svg xmlns="http://www.w3.org/2000/svg" width="10pt" height="10pt"/>').diagnostics[0]
      ?.code,
  ).toBe("pptx/missing-font");
  expect(
    svgToPptx('<svg xmlns="http://www.w3.org/2000/svg" width="10pt" height="10pt"/>', {
      fontSet: { ...fontSet, regular: "/missing/font.ttf" },
    }).diagnostics[0]?.code,
  ).toBe("pptx/missing-font");
});
afterAll(() => {
  if (update) writeFileSync(goldenPath, `${JSON.stringify(actual, null, 2)}\n`);
});
