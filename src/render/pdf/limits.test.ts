/**
 * Robustness of the PDF conversion (PR #65 review): engine traps become
 * diagnostics, oversized or deeply nested input is refused before the
 * engine runs, and the document information is found however long the
 * cross-reference table is.
 */

import { describe, expect, test } from "bun:test";
import { DEFAULT_FONT_SET_ID, type FontSet, getFontSet } from "../../core/theme/fonts";
import { loadEngine, runEngine } from "./engine";
import { resolveSvgFonts } from "./fonts";
import { exceedsPdfInputLimits, PDF_INPUT_LIMITS, svgToPdf } from "./pdf";
import { inspectPdf, parsePdf } from "./testing";

const fontSet = getFontSet(DEFAULT_FONT_SET_ID) as FontSet;
const svgOf = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="100pt" height="100pt" viewBox="0 0 200 200">${body}</svg>`;
const nested = (depth: number) =>
  svgOf(`${'<g opacity="0.99">'.repeat(depth)}<rect width="5" height="5"/>${"</g>".repeat(depth)}`);
const encode = (s: string) => new TextEncoder().encode(s);

describe("engine traps", () => {
  test("a trap is a failed result, and the next conversion gets a fresh instance", () => {
    const fonts = resolveSvgFonts(svgOf(""), fontSet);
    if (!fonts.ok) throw new Error("fonts");
    const module = loadEngine();
    // 1,000 nested groups overflow the engine's stack (out-of-bounds access).
    const trapped = runEngine(module, encode(nested(1000)), fonts.value.fonts);
    expect(trapped).toMatchObject({ ok: false, message: expect.stringContaining("RuntimeError") });
    const after = runEngine(module, encode(nested(10)), fonts.value.fonts);
    expect(after.ok).toBe(true);
  });

  test("a module without the engine's exports is a failed result, not an exception", () => {
    const empty = new WebAssembly.Module(new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]));
    expect(runEngine(empty, encode(svgOf("")), [])).toMatchObject({ ok: false });
  });
});

describe("input limits", () => {
  test("the deepest accepted nesting converts", () => {
    const depth = PDF_INPUT_LIMITS.maxDepth - 2; // <svg> and the <rect> count too
    const result = svgToPdf(nested(depth), { fontSet });
    expect(result.diagnostics).toEqual([]);
  });

  test("deeper nesting is pdf/input-too-large, before the engine runs", () => {
    const result = svgToPdf(nested(1000), { fontSet });
    expect(result.diagnostics).toMatchObject([
      { code: "pdf/input-too-large", message: expect.stringContaining("nests elements 65 deep") },
    ]);
  });

  test("too many elements or bytes is pdf/input-too-large", () => {
    const many = svgOf("<g/>".repeat(PDF_INPUT_LIMITS.maxElements));
    expect(exceedsPdfInputLimits(many)).toContain(
      `more than ${PDF_INPUT_LIMITS.maxElements} elements`,
    );
    const big = svgOf(`<!--${"x".repeat(PDF_INPUT_LIMITS.maxBytes)}-->`);
    expect(svgToPdf(big, { fontSet }).diagnostics).toMatchObject([
      { code: "pdf/input-too-large", message: expect.stringContaining("bytes, more than") },
    ]);
  });
});

test("document information is set even when the xref table exceeds 64 KiB", () => {
  // Each rect with its own opacity becomes two objects (a graphics state and
  // a form XObject): 2,000 make the table alone longer than 64 KiB.
  const body = Array.from(
    { length: 2000 },
    (_, i) =>
      `<rect x="${i % 200}" y="${Math.floor(i / 200)}" width="1" height="1" opacity="0.5"/>`,
  ).join("");
  const result = svgToPdf(svgOf(body), { fontSet });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const pdf = result.value;
  const text = new TextDecoder("latin1").decode(pdf);
  const xrefAt = Number(/startxref\n(\d+)\n%%EOF$/.exec(text)?.[1]);
  expect(pdf.length - xrefAt).toBeGreaterThan(64 * 1024);
  expect(() => parsePdf(pdf)).not.toThrow();
  expect(inspectPdf(pdf).info).toEqual({ Producer: "svg2pdf 0.13.0" });
});
