/**
 * The PDF export (#59): the examples' PDFs are byte-identical goldens
 * (`examples/<name>/<name>.pdf`), converted here from the committed SVGs, so
 * no D2 is needed and every CI platform checks the same bytes. Each is also
 * checked structurally with the in-repo reader (`testing.ts`): page = the
 * SVG's pt size, fonts embedded as subsets of the bundled files, no raster
 * images, the document information, and every label line at the position
 * and width Sumi's geometry lint measures.
 *
 * Set SUMI_UPDATE_GOLDEN=1 to rewrite the PDFs (`bun run gallery` writes the
 * same bytes).
 */

import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compileFigure } from "../../compiler/compile";
import { getFontSet } from "../../core/theme/fonts";
import { measureLabel, renderedLines } from "../../lint/geometry/measure";
import { assetProvenanceEntries, readSvgMetadata } from "../finalize";
import { inspectSvg } from "../inspect";
import { loadEngine, PDF_ENGINE_VERSION, PDF_WASM_PATH, PDF_WASM_SHA256 } from "./engine";
import { svgToPdf } from "./pdf";
import { inspectPdf, textLines } from "./testing";

const ROOT = join(import.meta.dir, "..", "..", "..");
const update = process.env.SUMI_UPDATE_GOLDEN === "1";
const EXAMPLES = [...new Bun.Glob("examples/*/*.sumi.yaml").scanSync(ROOT)]
  .map((p) =>
    p
      .split("\\")
      .join("/")
      .replace(/\.sumi\.yaml$/, ""),
  )
  .sort();
const sha256 = (bytes: Uint8Array) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

test("the engine module matches its pinned sha256", () => {
  expect(sha256(new Uint8Array(readFileSync(PDF_WASM_PATH)))).toBe(PDF_WASM_SHA256);
  expect(() => loadEngine(join(ROOT, "assets", "fonts", "biz-ud-gothic", "OFL.txt"))).toThrow(
    /expected [0-9a-f]{64}/,
  );
});

test("there are examples to check", () => {
  expect(EXAMPLES.length).toBeGreaterThanOrEqual(4);
});

describe.each(EXAMPLES)("%s", (example) => {
  const svg = readFileSync(join(ROOT, `${example}.svg`), "utf8");
  const converted = svgToPdf(svg);
  if (!converted.ok) throw new Error(JSON.stringify(converted.diagnostics));
  const pdf = converted.value;

  test("is byte-identical to the golden and deterministic", () => {
    const golden = join(ROOT, `${example}.pdf`);
    if (update) writeFileSync(golden, pdf);
    expect(sha256(pdf)).toBe(sha256(new Uint8Array(readFileSync(golden))));
    const again = svgToPdf(svg);
    expect(again.ok && sha256(again.value)).toBe(sha256(pdf));
    expect(converted.diagnostics).toEqual([]);
  });

  const inspected = inspectPdf(pdf);

  test("is one page of exactly the SVG's size in pt", () => {
    const width = Number(/<svg[^>]* width="([\d.]+)pt"/.exec(svg)?.[1]);
    const height = Number(/<svg[^>]* height="([\d.]+)pt"/.exec(svg)?.[1]);
    expect(inspected.version).toBe("1.7");
    expect(inspected.pages).toEqual([{ mediaBox: [0, 0, width, height] }]);
  });

  test("embeds subsets of the bundled fonts and no raster images", () => {
    expect(inspected.images).toBe(0);
    expect(inspected.fonts.length).toBeGreaterThan(0);
    for (const font of inspected.fonts) {
      expect(font).toMatchObject({ subtype: "CIDFontType2", embedded: true, subset: true });
      expect(font.baseFont).toMatch(
        /^[A-Z]{6}\+(BIZUDP?Gothic-(Regular|Bold)|Inter-(Regular|Bold)|STIXTwoMath-Regular|STIXTwoText-Italic)$/,
      );
    }
  });

  test("carries Sumi's metadata in the document information", () => {
    const metadata = readSvgMetadata(svg);
    if (!metadata.ok || metadata.value === undefined) throw new Error("no metadata");
    const m = metadata.value;
    expect(inspected.info).toEqual({
      Title: m.figureId,
      Creator: `Sumi ${m.sumiVersion}`,
      Producer: `Sumi ${m.sumiVersion} (${PDF_ENGINE_VERSION})`,
      SumiBackend: `${m.backend.name} ${m.backend.version}`,
      SumiTheme: m.theme,
      SumiProfile: m.profile,
      SumiFontSet: m.fontSet,
      SumiInputSha256: m.inputSha256,
      ...(m.d2Sha256 !== undefined && { SumiD2Sha256: m.d2Sha256 }),
      // Icons and images (#94): the assets' hash and the third-party notices.
      ...Object.fromEntries(assetProvenanceEntries(m)),
    });
  });

  test("draws every label line as text where Sumi measures it", () => {
    const source = readFileSync(join(ROOT, `${example}.sumi.yaml`), "utf8");
    const compiled = compileFigure(source);
    if (!compiled.ok) throw new Error("compile failed");
    // The figure's own font set: `paper` examples are set in Inter.
    const fontSet = getFontSet(compiled.value.fontSet.id);
    if (fontSet === undefined) throw new Error("no font set");
    const inspection = inspectSvg(svg, compiled.value.ir);
    if (!inspection.ok) throw new Error("inspect failed");
    const vb = inspection.value.canvas.viewBox;
    const pageHeight = inspected.pages[0]?.mediaBox[3] ?? 0;
    const lines = textLines(inspected.glyphs);
    const unmatched = new Set(lines);
    let expected = 0;
    const expectText = (
      text: string,
      box: { x: number; width: number },
      y: number,
      size: number,
    ) => {
      expected++;
      const x0 = (box.x - vb.x) * 0.5;
      const width = box.width * 0.5;
      const baseline = pageHeight - (y - vb.y) * 0.5;
      const hit = lines.find(
        (l) =>
          unmatched.has(l) &&
          l.text === text &&
          Math.abs(l.x0 - x0) < 0.01 &&
          Math.abs(l.y - baseline) < 0.01,
      );
      expect(hit, `"${text}" at x ${x0}, baseline ${baseline}`).toBeDefined();
      if (hit === undefined) return;
      unmatched.delete(hit);
      expect(Math.abs(hit.x1 - hit.x0 - width)).toBeLessThan(0.01);
      expect(hit.size).toBeCloseTo(size * 0.5, 4);
    };
    for (const element of inspection.value.elements) {
      for (const label of element.labels) {
        const measured = measureLabel(label, fontSet);
        if (measured.runs !== undefined) {
          // Label math (#93): every run is text in its font, size and baseline.
          for (const run of measured.runs.flat()) {
            if (run.text.trim() === "") continue;
            expectText(run.text, run.box, run.baseline, run.fontSizeUnits);
          }
          continue;
        }
        renderedLines(label.text).forEach((text, i) => {
          const box = measured.lines[i];
          if (box === undefined || text.trim() === "") return;
          expectText(text, box, label.anchor.y + i * label.lineHeightUnits, label.fontSizeUnits);
        });
      }
    }
    expect(expected).toBeGreaterThan(0);
    expect([...unmatched].map((l) => l.text)).toEqual([]);
  });
});
