/**
 * The PDF's document information dictionary (#59). svg2pdf 0.13 writes a
 * fixed `/Producer (svg2pdf)` as the last object before the cross-reference
 * table. {@link setDocumentInfo} replaces that object's dictionary with
 * Sumi's provenance (the same fields as the SVG metadata: no timestamps, no
 * paths, so the PDF stays deterministic) and shifts `startxref` by the size
 * difference. The objects before it keep their offsets, so the xref table
 * itself is unchanged. No XMP metadata stream is written.
 */

import type { SumiSvgMetadata } from "../finalize";
import { SVG2PDF_VERSION } from "./engine";

/** Encodes a PDF text string: a literal for printable ASCII, else UTF-16BE hex with a BOM. */
export function pdfTextString(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) {
    return `(${value.replace(/[\\()]/g, (c) => `\\${c}`)})`;
  }
  let hex = "FEFF";
  for (let i = 0; i < value.length; i++) {
    hex += value.charCodeAt(i).toString(16).toUpperCase().padStart(4, "0");
  }
  return `<${hex}>`;
}

/** The entries Sumi writes, in order (PDF names without the slash → text). */
export function documentInfoEntries(metadata: SumiSvgMetadata | undefined): [string, string][] {
  const producer = `svg2pdf ${SVG2PDF_VERSION}`;
  if (metadata === undefined) return [["Producer", producer]];
  return [
    ["Title", metadata.figureId],
    ["Creator", `Sumi ${metadata.sumiVersion}`],
    ["Producer", `Sumi ${metadata.sumiVersion} (${producer})`],
    ["SumiBackend", `${metadata.backend.name} ${metadata.backend.version}`],
    ["SumiTheme", metadata.theme],
    ["SumiProfile", metadata.profile],
    ["SumiFontSet", metadata.fontSet],
    ["SumiInputSha256", metadata.inputSha256],
    ["SumiD2Sha256", metadata.d2Sha256],
  ];
}

const latin1 = new TextDecoder("latin1");

/**
 * Replaces svg2pdf's document information dictionary (see the module
 * comment). Returns `undefined` if the PDF does not end the way svg2pdf 0.13
 * writes it (the engine changed); the caller reports that as an error.
 */
export function setDocumentInfo(
  pdf: Uint8Array,
  entries: readonly [string, string][],
): Uint8Array | undefined {
  // Only the tail is text we touch; decode it byte for byte (latin1).
  const tailStart = Math.max(0, pdf.length - 64 * 1024);
  const tail = latin1.decode(pdf.subarray(tailStart));
  const info = /\n(\d+) 0 obj\n<<\n {2}\/Producer \(svg2pdf\)\n>>\nendobj\n\nxref\n/.exec(tail);
  const trailer = /trailer\n<<\n(?:.*\n)*? {2}\/Info (\d+) 0 R\n>>\nstartxref\n(\d+)\n%%EOF$/.exec(
    tail,
  );
  if (info === null || trailer === null || info[1] !== trailer[1]) return undefined;
  const oldDict = "<<\n  /Producer (svg2pdf)\n>>";
  const newDict = `<<\n${entries.map(([k, v]) => `  /${k} ${pdfTextString(v)}\n`).join("")}>>`;
  const dictAt = tailStart + info.index + info[0].indexOf(oldDict);
  const startxref = Number(trailer[2]) + (newDict.length - oldDict.length);
  const startxrefAt = tailStart + trailer.index + trailer[0].lastIndexOf("startxref\n");
  const encoder = new TextEncoder();
  const parts = [
    pdf.subarray(0, dictAt),
    encoder.encode(newDict),
    pdf.subarray(dictAt + oldDict.length, startxrefAt),
    encoder.encode(`startxref\n${startxref}\n%%EOF`),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
