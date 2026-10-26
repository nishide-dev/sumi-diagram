/**
 * Format detection and pixel size of user images (#94): PNG and JPEG are read
 * only as far as their headers (signature, `IHDR`, the JPEG frame header).
 * Sumi never decodes, re-encodes or changes image data; the bytes are
 * embedded as they are.
 */

export type ImageFormat = "png" | "jpeg" | "svg";

export const IMAGE_MIME: Readonly<Record<ImageFormat, string>> = {
  png: "image/png",
  jpeg: "image/jpeg",
  svg: "image/svg+xml",
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The format by content: PNG / JPEG signatures, else SVG if it starts like XML or `<svg`; `undefined` otherwise. */
export function sniffFormat(bytes: Uint8Array): ImageFormat | undefined {
  if (PNG_SIGNATURE.every((b, i) => bytes[i] === b)) return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  // SVG: text whose first markup is an XML declaration, comment, DOCTYPE or
  // <svg. The strict parser then decides whether the root really is <svg>
  // (a long license comment may come before it).
  const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, 256));
  const text = head.replace(/^﻿/, "").trimStart();
  return /^<(?:\?xml|!--|!DOCTYPE|svg[\s>/])/i.test(text) ? "svg" : undefined;
}

/** The format an extension names (`.png`, `.jpg` / `.jpeg`, `.svg`; any case). */
export function formatOfExtension(path: string): ImageFormat | undefined {
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase();
  if (ext === "png") return "png";
  if (ext === "jpg" || ext === "jpeg") return "jpeg";
  if (ext === "svg") return "svg";
  return undefined;
}

export interface PixelSize {
  width: number;
  height: number;
}

/** The pixel size from a PNG's `IHDR`, or a reason it cannot be read. */
export function pngSize(bytes: Uint8Array): PixelSize | string {
  if (bytes.length < 33) return "the PNG is truncated before its IHDR chunk";
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const type = String.fromCharCode(...bytes.subarray(12, 16));
  if (view.getUint32(8) !== 13 || type !== "IHDR")
    return "the PNG does not start with an IHDR chunk";
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width === 0 || height === 0) return "the PNG has a zero width or height";
  return { width, height };
}

/** Start-of-frame markers (SOF0–SOF15 except DHT, JPG and DAC), which carry the size. */
const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

/** The pixel size from a JPEG's frame header, or a reason it cannot be read. */
export function jpegSize(bytes: Uint8Array): PixelSize | string {
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return "the JPEG has a malformed marker";
    const marker = bytes[at + 1] as number;
    if (marker === 0xff) {
      at++; // fill byte
      continue;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      at += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) break; // end of image / start of scan before a frame
    const length = ((bytes[at + 2] as number) << 8) | (bytes[at + 3] as number);
    if (length < 2) return "the JPEG has a malformed segment";
    if (at + 2 + length > bytes.length) return "the JPEG is truncated";
    if (SOF.has(marker)) {
      // length, precision, height, width, component count, then 3 bytes per component.
      const components = bytes[at + 9] ?? 0;
      if (length < 8 || components === 0 || length !== 8 + 3 * components) {
        return "the JPEG has a malformed frame header";
      }
      const height = ((bytes[at + 5] as number) << 8) | (bytes[at + 6] as number);
      const width = ((bytes[at + 7] as number) << 8) | (bytes[at + 8] as number);
      if (width === 0 || height === 0) return "the JPEG has a zero width or height";
      return { width, height };
    }
    at += 2 + length;
  }
  return "the JPEG has no frame header";
}
