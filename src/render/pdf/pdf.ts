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
import { loadEngine, runEngine } from "./engine";
import { resolveSvgFonts } from "./fonts";
import { documentInfoEntries, setDocumentInfo } from "./info";

export interface SvgToPdfOptions {
  /** The font set the SVG was rendered with. Defaults to the one named in the SVG's Sumi metadata. */
  fontSet?: FontSet;
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
 * Converts a finalized SVG to PDF. Fails with `pdf/missing-font` /
 * `pdf/unresolved-font` (fonts, see `resolveSvgFonts()`), `pdf/engine-unavailable`
 * (the WASM engine is missing or does not match its pinned sha256),
 * `pdf/conversion-failed` (the engine rejected the SVG), or `svg/invalid`
 * (malformed Sumi metadata).
 */
export function svgToPdf(svg: string, options: SvgToPdfOptions = {}): Result<Uint8Array> {
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
