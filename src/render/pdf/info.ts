/**
 * The PDF's document information dictionary (#59). svg2pdf 0.13 writes a
 * fixed `/Producer (svg2pdf)` as the last object before the cross-reference
 * table. {@link setDocumentInfo} replaces that object's dictionary with
 * Sumi's provenance (the same fields as the SVG metadata: no timestamps, no
 * paths, so the PDF stays deterministic) and shifts `startxref` by the size
 * difference. The objects before it keep their offsets, so the xref table
 * itself is unchanged. No XMP metadata stream is written.
 *
 * Why here and not in the engine: svg2pdf 0.13's `to_pdf` writes the
 * dictionary itself from crate-private state (`Context`, `tree_to_stream`),
 * so setting it in Rust would mean a second, larger patch to svg2pdf (or
 * re-implementing `to_pdf`), and a new WASM build whenever the provenance
 * fields change. The byte edit is checked strictly against svg2pdf's output
 * and the golden PDFs.
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
 * comment). The dictionary is found through the file's own structure, never
 * a fixed window: the final `startxref` gives the cross-reference table, the
 * trailer's `/Info` reference names the object and the table gives its
 * offset. It must be svg2pdf's `/Producer (svg2pdf)` object and the last one
 * before the table, so no other offset moves. Returns `undefined` otherwise
 * (the engine changed); the caller reports that as an error.
 */
export function setDocumentInfo(
  pdf: Uint8Array,
  entries: readonly [string, string][],
): Uint8Array | undefined {
  const text = (from: number, to = pdf.length) => latin1.decode(pdf.subarray(from, to));
  const endAt = Math.max(0, pdf.length - 64);
  const end = /startxref\n(\d+)\n%%EOF$/.exec(text(endAt));
  if (end === null) return undefined;
  const xrefAt = Number(end[1]);
  const startxrefAt = endAt + end.index;
  if (!(xrefAt > 0 && xrefAt < startxrefAt)) return undefined;
  // The table and trailer (latin1, so string offsets are byte offsets).
  const xref = text(xrefAt, startxrefAt);
  const head = /^xref\n0 (\d+)\n/.exec(xref);
  if (head === null) return undefined;
  const count = Number(head[1]);
  const entriesAt = head[0].length;
  const trailerAt = entriesAt + count * 20;
  const trailer = xref.slice(trailerAt);
  if (!trailer.startsWith("trailer\n<<\n") || !trailer.endsWith(">>\n")) return undefined;
  const infoRef = /\n {2}\/Info (\d+) 0 R\n/.exec(trailer);
  if (infoRef === null) return undefined;
  const info = Number(infoRef[1]);
  const entry = /^(\d{10}) 00000 n\r\n$/.exec(
    xref.slice(entriesAt + info * 20, entriesAt + info * 20 + 20),
  );
  if (info >= count || entry === null) return undefined;
  const infoAt = Number(entry[1]);
  const oldDict = "<<\n  /Producer (svg2pdf)\n>>";
  const oldObject = `${info} 0 obj\n${oldDict}\nendobj\n\n`;
  if (infoAt + oldObject.length !== xrefAt || text(infoAt, xrefAt) !== oldObject) {
    return undefined;
  }

  const newDict = `<<\n${entries.map(([k, v]) => `  /${k} ${pdfTextString(v)}\n`).join("")}>>`;
  const dictAt = infoAt + `${info} 0 obj\n`.length;
  const startxref = xrefAt + (newDict.length - oldDict.length);
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
