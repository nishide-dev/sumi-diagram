import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_FONT_SET_ID, type FontSet, getFontSet } from "../../core/theme/fonts";
import { type GlyphCoverage, parseGlyphCoverage } from "../../lint/cmap";
import { FontParseError, readTables } from "../../lint/sfnt";
import { readFontFace, resolveSvgFonts } from "./fonts";
import { svgToPdf } from "./pdf";
import { inspectPdf, textLines } from "./testing";

const fontSet = getFontSet(DEFAULT_FONT_SET_ID) as FontSet;
const bytes = (path: string) => new Uint8Array(readFileSync(path));

/** A font's `cmap` subtables as `platform/encoding fFormat`. */
function cmapSubtables(font: Uint8Array): string[] {
  const cmap = readTables(font).require("cmap");
  return Array.from({ length: cmap.u16(2) }, (_, i) => {
    const record = 4 + i * 8;
    return `${cmap.u16(record)}/${cmap.u16(record + 2)} f${cmap.u16(cmap.u32(record + 4))}`;
  });
}

/** A font's table tags. */
function tableTags(font: Uint8Array): string[] {
  const view = new DataView(font.buffer, font.byteOffset, font.byteLength);
  return Array.from({ length: view.getUint16(4) }, (_, i) =>
    String.fromCharCode(...font.subarray(12 + i * 16, 16 + i * 16)),
  );
}

/** The style block D2 v0.9.0 writes (WOFF data shortened). */
const d2Svg = (slots: string[], extra = "", label = "A") => `<?xml version="1.0" encoding="utf-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="10pt" height="10pt" viewBox="0 0 20 20"><style type="text/css"><![CDATA[
${slots
  .map(
    (slot) => `.d2-123 .text${slot === "regular" ? "" : `-${slot}`} {
	font-family: "d2-123-font-${slot}";
}
@font-face {
	font-family: d2-123-font-${slot};
	src: url("data:application/font-woff;base64,d09GRg==");
}`,
  )
  .join("\n")}${extra}]]></style><text x="10" y="10" class="text">${label}</text></svg>`;

describe("readFontFace", () => {
  test("reads the bundled fonts' real family, weight and style", () => {
    expect(readFontFace(bytes(fontSet.regular))).toEqual({
      family: "BIZ UDPGothic",
      weight: 400,
      italic: false,
    });
    expect(readFontFace(bytes(fontSet.bold))).toEqual({
      family: "BIZ UDPGothic",
      weight: 700,
      italic: false,
    });
    expect(readFontFace(bytes(fontSet.mono as string))).toEqual({
      family: "BIZ UDGothic",
      weight: 400,
      italic: false,
    });
  });

  test("rejects files that are not fonts", () => {
    expect(() => readFontFace(new TextEncoder().encode("not a font at all"))).toThrow(
      FontParseError,
    );
  });
});

describe("resolveSvgFonts", () => {
  test("rewrites D2's per-diagram families to the real faces and drops @font-face", () => {
    const result = resolveSvgFonts(d2Svg(["regular", "bold", "mono"]), fontSet);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const { svg, fonts, faces } = result.value;
    expect(svg).not.toContain("@font-face");
    expect(svg).not.toContain("d2-123-font");
    expect(svg).toContain(
      `.d2-123 .text {\n\tfont-family: "BIZ UDPGothic"; font-weight: 400; font-style: normal;\n}`,
    );
    expect(svg).toContain(
      `.d2-123 .text-bold {\n\tfont-family: "BIZ UDPGothic"; font-weight: 700; font-style: normal;\n}`,
    );
    expect(svg).toContain(
      `.d2-123 .text-mono {\n\tfont-family: "BIZ UDGothic"; font-weight: 400; font-style: normal;\n}`,
    );
    expect([...faces.keys()]).toEqual(["regular", "bold", "mono"]);
    // The font set's distinct files, regular first (the engine's fallback).
    expect(fonts.map((f) => f.length)).toEqual(
      [fontSet.regular, fontSet.bold, fontSet.mono as string].map((p) => bytes(p).length),
    );
  });

  test("fonts of texts drawn in one font each are handed over unchanged", () => {
    const input = d2Svg(
      ["regular", "bold", "math"],
      "",
      'A</text><text class="text-bold">∇ ∣</text><text class="text-math">y∇x',
    );
    const result = resolveSvgFonts(input, fontSet);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.value.fonts[0]).toEqual(bytes(fontSet.regular));
    expect(result.value.fonts[1]).toEqual(bytes(fontSet.bold));
  });

  test("fonts of a text with runs in several fonts also map the other runs' characters (#112)", () => {
    // Text (regular), math-italic and math runs in one <text>, like a label with math;
    // U+1F600 is in no font, so no font may claim it (it keeps falling back as before).
    const label =
      '損失 <tspan class="text-math-italic">y</tspan><tspan class="text-math">∇∣</tspan>' +
      '<tspan class="text-math-italic">x</tspan> \u{1F600}';
    const result = resolveSvgFonts(d2Svg(["regular", "math", "math-italic"], "", label), fontSet);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const files = [fontSet.regular, fontSet.math as string, fontSet.mathItalic as string];
    const original = files.map((f) => parseGlyphCoverage(bytes(f)));
    // Handed: the set's files (regular first), then the math files the SVG uses.
    const { fonts } = result.value;
    const handed = [0, fonts.length - 2, fonts.length - 1].map((i) =>
      parseGlyphCoverage(fonts[i] as Uint8Array),
    );
    expect(handed).toHaveLength(3);
    const chars = [..."損失 y∇∣x"].map((c) => c.codePointAt(0) as number);
    for (const [i, coverage] of handed.entries()) {
      for (const cp of chars)
        expect(coverage.has(cp), `${files[i]} U+${cp.toString(16)}`).toBe(true);
      expect(coverage.has(0x1f600)).toBe(false);
      const before = original[i] as GlyphCoverage;
      // Existing mappings keep their glyphs; added ones map to the space glyph.
      expect([...before.entries()].filter(([cp, glyph]) => coverage.glyph(cp) !== glyph)).toEqual(
        [],
      );
      for (const cp of chars.filter((c) => !before.has(c))) {
        expect(coverage.glyph(cp)).toBe(before.glyph(0x20));
      }
      expect(coverage.size).toBe(before.size + chars.filter((c) => !before.has(c)).length);
    }
    // The italic font lacked ∇ and the CJK text: the case that lost the italic (#112).
    expect(original[2]?.has(0x2207)).toBe(false);
    expect(original[2]?.has(0x640d)).toBe(false);
    // The math font is handed without GSUB / GPOS, as before.
    expect(tableTags(fonts[fonts.length - 2] as Uint8Array)).not.toContain("GSUB");
  });

  test("a rewritten cmap keeps the font's variation sequences (format 14)", () => {
    const gothic = bytes(fontSet.regular);
    const result = resolveSvgFonts(
      d2Svg(["regular", "math"], "", 'a<tspan class="text-math">\u{1D400}</tspan>'),
      fontSet,
    );
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const handed = result.value.fonts[0] as Uint8Array;
    expect(handed).not.toEqual(gothic);
    expect(cmapSubtables(gothic)).toContain("0/5 f14");
    // Gothic's mapping needs too many format 4 segments: format 12 only.
    expect(cmapSubtables(handed)).toEqual(["0/5 f14", "3/10 f12"]);
  });

  test("leaves the rest of the SVG untouched", () => {
    const input = d2Svg(["regular"]);
    const result = resolveSvgFonts(input, fontSet);
    if (!result.ok) throw new Error("failed");
    const strip = (s: string) =>
      s
        .replace(/@font-face\s*\{[^}]*\}\s*/g, "")
        .replace(/font-family:[^;]*;( font-[a-z]+: [^;]*;)*/g, "");
    expect(strip(result.value.svg)).toBe(strip(input));
  });

  test("a slot without a file is pdf/unresolved-font", () => {
    const result = resolveSvgFonts(d2Svg(["regular", "fancy"]), fontSet);
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toMatchObject([
      { code: "pdf/unresolved-font", severity: "error", message: expect.stringContaining("fancy") },
    ]);
  });

  test("a D2 family left anywhere else is pdf/unresolved-font", () => {
    const result = resolveSvgFonts(
      d2Svg(["regular"], '\n.x { font: 10px "d2-123-font-regular"; }'),
      fontSet,
    );
    expect(result.diagnostics.map((d) => d.code)).toEqual(["pdf/unresolved-font"]);
  });

  test("labels that look like D2 families or CSS are text, not fonts: kept verbatim", () => {
    for (const label of [
      "d2-123-font-regular",
      'font-family: "d2-123-font-regular";',
      "@font-face { font-family: x; }",
    ]) {
      const escaped = label.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
      const input = d2Svg(["regular"], "", escaped);
      const result = resolveSvgFonts(input, fontSet);
      if (!result.ok) throw new Error(`${label}: ${JSON.stringify(result.diagnostics)}`);
      expect(result.value.svg).toContain(`<text x="10" y="10" class="text">${escaped}</text>`);
      expect(result.value.svg).not.toContain("d2-123-font-regular;\n\tsrc");

      // …and drawn as that text in the PDF.
      const pdf = svgToPdf(input, { fontSet });
      if (!pdf.ok) throw new Error(`${label}: ${JSON.stringify(pdf.diagnostics)}`);
      expect(textLines(inspectPdf(pdf.value).glyphs).map((l) => l.text)).toEqual([label]);
    }
  });

  test("a D2 family in a font-family or style attribute is pdf/unresolved-font", () => {
    for (const attribute of [
      'font-family="d2-123-font-bold"',
      'style="font-family: d2-123-font-bold"',
    ]) {
      const input = d2Svg(["regular"]).replace('class="text">', `class="text" ${attribute}>`);
      expect(resolveSvgFonts(input, fontSet).diagnostics).toMatchObject([
        { code: "pdf/unresolved-font", message: expect.stringContaining("d2-123-font-bold") },
      ]);
    }
  });

  test("an unreadable font file is pdf/missing-font", () => {
    const broken: FontSet = { ...fontSet, bold: join(import.meta.dir, "no-such-font.ttf") };
    const result = resolveSvgFonts(d2Svg(["regular"]), broken);
    expect(result.diagnostics).toMatchObject([
      { code: "pdf/missing-font", message: expect.stringContaining("no-such-font.ttf") },
    ]);
  });
});

describe("svgToPdf errors", () => {
  test("an SVG with no font set (no Sumi metadata, none given) is pdf/missing-font", () => {
    const result = svgToPdf(d2Svg(["regular"]));
    expect(result.diagnostics.map((d) => d.code)).toEqual(["pdf/missing-font"]);
  });

  test("an SVG the engine cannot read is pdf/conversion-failed", () => {
    const result = svgToPdf('<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0"/>', {
      fontSet,
    });
    expect(result.diagnostics).toMatchObject([
      { code: "pdf/conversion-failed", message: expect.stringContaining("PDF engine rejected") },
    ]);
  });

  test("malformed metadata is svg/invalid", () => {
    const result = svgToPdf("<svg");
    expect(result.diagnostics.map((d) => d.code)).toEqual(["svg/invalid"]);
  });

  test("a minimal SVG converts with the given font set", () => {
    const result = svgToPdf(d2Svg(["regular"]), { fontSet });
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(new TextDecoder().decode(result.value.subarray(0, 8))).toBe("%PDF-1.7");
  });
});
