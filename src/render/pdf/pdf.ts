/**
 * SVG → vector PDF (#59, design doc §6.12), stage `pdf`.
 *
 * Input is a finalized Sumi SVG (`finalizeSvg()` / `renderFigure()`). The
 * page is the SVG's `width` × `height` in pt; shapes stay vectors; text stays
 * text in a subset of the font set's own files (never system fonts); the
 * bytes are deterministic (same SVG, same fonts, same engine → same PDF, on
 * every platform, because the engine is one WASM module).
 */

import type { Diagnostic } from "../../core/diagnostics";
import type { Result } from "../../core/result";
import { type FontSet, getFontSet } from "../../core/theme/fonts";
import { readSvgMetadata } from "../finalize";
import { childElements, parseXml, type XmlElement } from "../xml";
import { loadEngine, runEngine } from "./engine";
import { resolveSvgFonts } from "./fonts";
import { documentInfoEntries, setDocumentInfo } from "./info";

export interface SvgToPdfOptions {
  /** The font set the SVG was rendered with. Defaults to the one named in the SVG's Sumi metadata. */
  fontSet?: FontSet;
}

/**
 * What the PDF engine accepts. The engine (usvg) walks the SVG tree
 * recursively in WebAssembly with a 1 MiB stack: nested groups with opacity
 * overflowed it at a depth of about 400 (a trap, which is also caught, see
 * `runEngine()`), while groups that each add opacity, a mask, a clip path, a
 * transform and text converted fine at 192. D2's SVGs are flat (depth 5,
 * under 100 elements for the examples), so the limits leave a wide margin for
 * real figures and stop pathological input with a clear diagnostic.
 */
export const PDF_INPUT_LIMITS = Object.freeze({
  /** UTF-8 size of the SVG. */
  maxBytes: 32 * 1024 * 1024,
  /** Element nesting depth, the root `<svg>` being 1. */
  maxDepth: 64,
  /** Number of elements. */
  maxElements: 200_000,
});

/** Checks {@link PDF_INPUT_LIMITS}; the message of the first limit exceeded, if any. */
export function exceedsPdfInputLimits(svg: string): string | undefined {
  const bytes = Buffer.byteLength(svg, "utf8");
  if (bytes > PDF_INPUT_LIMITS.maxBytes) {
    return `The SVG is ${bytes} bytes, more than the ${PDF_INPUT_LIMITS.maxBytes} the PDF engine accepts.`;
  }
  const parsed = parseXml(svg);
  if (!parsed.ok) return undefined; // reported as svg/invalid
  let elements = 0;
  const stack: [XmlElement, number][] = [[parsed.root, 1]];
  for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
    const [element, depth] = item;
    if (depth > PDF_INPUT_LIMITS.maxDepth) {
      return `The SVG nests elements ${depth} deep, more than the ${PDF_INPUT_LIMITS.maxDepth} the PDF engine accepts.`;
    }
    if (++elements > PDF_INPUT_LIMITS.maxElements) {
      return `The SVG has more than ${PDF_INPUT_LIMITS.maxElements} elements, the most the PDF engine accepts.`;
    }
    for (const child of childElements(element)) stack.push([child, depth + 1]);
  }
  return undefined;
}

function failed(code: string, message: string, hint?: string): Result<never> {
  const diagnostic: Diagnostic = {
    code,
    severity: "error",
    message,
    ...(hint !== undefined && { hint }),
  };
  return { ok: false, diagnostics: [diagnostic] };
}

/**
 * Converts a finalized SVG to PDF. Fails with `pdf/input-too-large` (see
 * {@link PDF_INPUT_LIMITS}), `pdf/missing-font` /
 * `pdf/unresolved-font` (fonts, see `resolveSvgFonts()`), `pdf/engine-unavailable`
 * (the WASM engine is missing or does not match its pinned sha256),
 * `pdf/conversion-failed` (the engine rejected the SVG or stopped with a
 * trap), or `svg/invalid`
 * (malformed Sumi metadata).
 */
export function svgToPdf(svg: string, options: SvgToPdfOptions = {}): Result<Uint8Array> {
  const tooLarge = exceedsPdfInputLimits(svg);
  if (tooLarge !== undefined) {
    return failed(
      "pdf/input-too-large",
      tooLarge,
      "Sumi's own SVGs stay far below these limits; is this SVG from `sumi render`?",
    );
  }
  const metadata = readSvgMetadata(svg);
  if (!metadata.ok) return metadata;
  const fontSetId = metadata.value?.fontSet;
  const fontSet = options.fontSet ?? (fontSetId === undefined ? undefined : getFontSet(fontSetId));
  if (fontSet === undefined) {
    return failed(
      "pdf/missing-font",
      fontSetId === undefined
        ? "The SVG names no font set and none was given, so its fonts cannot be embedded."
        : `The SVG's font set "${fontSetId}" is not a built-in font set.`,
    );
  }
  const fonts = resolveSvgFonts(svg, fontSet);
  if (!fonts.ok) return fonts;

  let module: WebAssembly.Module;
  try {
    module = loadEngine();
  } catch (e) {
    return failed(
      "pdf/engine-unavailable",
      `The PDF engine cannot be loaded: ${e instanceof Error ? e.message : String(e)}.`,
      "Reinstall Sumi; in a checkout, run `bun run pdf:wasm`.",
    );
  }
  const converted = runEngine(module, new TextEncoder().encode(fonts.value.svg), fonts.value.fonts);
  if (!converted.ok) {
    return failed(
      "pdf/conversion-failed",
      `The PDF engine rejected the SVG: ${converted.message}.`,
    );
  }
  const pdf = setDocumentInfo(converted.pdf, documentInfoEntries(metadata.value));
  if (pdf === undefined) {
    return failed(
      "pdf/conversion-failed",
      "The PDF engine's output does not end with the document information Sumi expects.",
    );
  }
  return { ok: true, value: pdf, diagnostics: [] };
}
