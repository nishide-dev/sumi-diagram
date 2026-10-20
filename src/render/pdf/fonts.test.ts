import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_FONT_SET_ID, type FontSet, getFontSet } from "../../core/theme/fonts";
import { FontParseError } from "../../lint/sfnt";
import { readFontFace, resolveSvgFonts } from "./fonts";
import { svgToPdf } from "./pdf";

const fontSet = getFontSet(DEFAULT_FONT_SET_ID) as FontSet;
const bytes = (path: string) => new Uint8Array(readFileSync(path));

/** The style block D2 v0.9.0 writes (WOFF data shortened). */
const d2Svg = (slots: string[], extra = "") => `<?xml version="1.0" encoding="utf-8"?>
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
  .join("\n")}${extra}]]></style><text x="10" y="10" class="text">A</text></svg>`;

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
