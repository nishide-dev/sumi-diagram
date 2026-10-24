/** Picture PPTX export: fonts outlined for portable SVG, resvg PNG fallback. */
import type { Diagnostic } from "../../core/diagnostics";
import type { Result } from "../../core/result";
import { type FontSet, getFontSet } from "../../core/theme/fonts";
import { readSvgMetadata } from "../finalize";
import { loadEngine, runEngine } from "../pdf/engine";
import { resolveSvgFonts } from "../pdf/fonts";
import { exceedsPdfInputLimits } from "../pdf/pdf";
import { attribute, parseXml } from "../xml";
import { picturePptx } from "./package";

const failure = (code: string, message: string): Result<never> => ({
  ok: false,
  diagnostics: [{ code, severity: "error", message } satisfies Diagnostic],
});
export interface SvgToPptxOptions {
  fontSet?: FontSet;
}

/** Converts a finalized SVG into one slide with one picture, not editable diagram shapes. */
export function svgToPptx(svg: string, options: SvgToPptxOptions = {}): Result<Uint8Array> {
  const tooLarge = exceedsPdfInputLimits(svg);
  if (tooLarge) return failure("pptx/input-too-large", tooLarge.replaceAll("PDF", "PPTX"));
  const parsed = parseXml(svg);
  if (!parsed.ok) return failure("svg/invalid", parsed.message);
  const pt = (name: string) => {
    const match = /^([\d.]+)pt$/.exec(attribute(parsed.root, name) ?? "");
    return match ? Number(match[1]) : Number.NaN;
  };
  const width = pt("width");
  const height = pt("height");
  if (![width, height].every((n) => Number.isFinite(n) && n > 0 && n <= 4032))
    return failure(
      "pptx/unsupported-size",
      "PPTX requires positive SVG width/height in pt, at most 4032pt (56 inches) per side. Use a smaller output profile.",
    );
  const metadata = readSvgMetadata(svg);
  if (!metadata.ok) return metadata;
  const fontSet =
    options.fontSet ?? (metadata.value ? getFontSet(metadata.value.fontSet) : undefined);
  if (!fontSet)
    return failure("pptx/missing-font", "The SVG names no known font set and none was given.");
  const resolved = resolveSvgFonts(svg, fontSet, "pptx");
  if (!resolved.ok) return resolved;
  let module: WebAssembly.Module;
  try {
    module = loadEngine();
  } catch (e) {
    return failure(
      "pptx/engine-unavailable",
      `The picture engine cannot be loaded: ${e instanceof Error ? e.message : String(e)}.`,
    );
  }
  const result = runEngine(
    module,
    new TextEncoder().encode(resolved.value.svg),
    resolved.value.fonts,
    "picture",
  );
  if (!result.ok)
    return failure(
      "pptx/conversion-failed",
      `The picture engine rejected the SVG: ${result.message}.`,
    );
  try {
    const bytes = result.pdf;
    if (bytes.length < 12) throw new Error("Truncated picture assets");
    const pngLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
      0,
      true,
    );
    if (pngLength < 8 || pngLength + 4 >= bytes.length)
      throw new Error("Invalid picture assets length");
    const png = bytes.subarray(4, 4 + pngLength);
    if (Buffer.from(png.subarray(0, 8)).toString("hex") !== "89504e470d0a1a0a")
      throw new Error("Missing PNG fallback");
    const outlined = new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(4 + pngLength),
    );
    const tree = parseXml(outlined);
    if (!tree.ok || tree.root.name !== "svg" || /<(?:text|tspan)\b/.test(outlined))
      throw new Error("Invalid outlined SVG");
    return {
      ok: true,
      value: picturePptx(outlined, png, width, height, metadata.value),
      diagnostics: [],
    };
  } catch (e) {
    return failure(
      "pptx/conversion-failed",
      `Cannot create the picture package: ${e instanceof Error ? e.message : String(e)}.`,
    );
  }
}
