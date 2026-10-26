/**
 * The PDF's document information dictionary (#74). Our krilla wrapper writes
 * a fixed Producer marker. setDocumentInfo replaces it with Sumi provenance,
 * updating the offsets of every subsequent object and startxref. No incremental
 * update or XMP stream is added. The pinned engine writes classic xref tables;
 * unexpected structures fail closed rather than producing a damaged PDF.
 *
 * krilla's public Metadata API supports standard fields, but not arbitrary
 * Sumi provenance keys. This checked edit retains those fields without an
 * upstream patch, a second PDF implementation or a new host/WASM metadata ABI.
 */

import { assetProvenanceEntries, type SumiSvgMetadata } from "../finalize";
import { PDF_ENGINE_VERSION } from "./engine";

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
  const producer = PDF_ENGINE_VERSION;
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
    ...(metadata.d2Sha256 === undefined
      ? []
      : [["SumiD2Sha256", metadata.d2Sha256] as [string, string]]),
    ...assetProvenanceEntries(metadata),
  ];
}

const latin1 = new TextDecoder("latin1");

/**
 * Replaces the engine's document information dictionary (see the module
 * comment). The dictionary is found through the file's own structure, never
 * a fixed window: the final `startxref` gives the cross-reference table, the
 * trailer's `/Info` reference names the object and the table gives its
 * offset. It must be our `/Producer(Sumi krilla)` marker. The following
 * objects (including krilla's Catalog) move by the size delta, and their
 * xref entries are rewritten. Returns `undefined` on an unexpected structure
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
  if (!trailer.startsWith("trailer\n<<") || !trailer.endsWith(">>\n")) return undefined;
  if (/\/(Prev|Encrypt|XRefStm)\b/.test(trailer)) return undefined;
  const infoRef = /\/Info (\d+) 0 R(?=[\s/<>])/.exec(trailer);
  if (infoRef === null) return undefined;
  const info = Number(infoRef[1]);
  const entry = /^(\d{10}) 00000 n\r\n$/.exec(
    xref.slice(entriesAt + info * 20, entriesAt + info * 20 + 20),
  );
  if (info >= count || entry === null) return undefined;
  const infoAt = Number(entry[1]);
  const oldDict = "<</Producer(Sumi krilla)>>";
  const oldObject = `${info} 0 obj\n${oldDict}\nendobj\n`;
  const oldEnd = infoAt + oldObject.length;
  if (oldEnd > xrefAt || text(infoAt, oldEnd) !== oldObject) {
    return undefined;
  }

  const newDict = `<<\n${entries.map(([k, v]) => `  /${k} ${pdfTextString(v)}\n`).join("")}>>`;
  const dictAt = infoAt + `${info} 0 obj\n`.length;
  const delta = newDict.length - oldDict.length;
  const startxref = xrefAt + delta;
  const updatedEntries: string[] = [];
  for (let i = 0; i < count; i++) {
    const raw = xref.slice(entriesAt + i * 20, entriesAt + (i + 1) * 20);
    const parsed = /^(\d{10}) (\d{5}) ([nf])\r\n$/.exec(raw);
    if (parsed === null) return undefined;
    const offset = Number(parsed[1]);
    if (parsed[3] === "n") {
      if (parsed[2] !== "00000" || offset >= xrefAt || offset < 1) return undefined;
      if (offset > infoAt && offset < oldEnd) return undefined;
      const shifted = offset >= oldEnd ? offset + delta : offset;
      if (shifted < 0 || shifted > 9_999_999_999) return undefined;
      updatedEntries.push(`${String(shifted).padStart(10, "0")} 00000 n\r\n`);
    } else updatedEntries.push(raw);
  }
  const encoder = new TextEncoder();
  const parts = [
    pdf.subarray(0, dictAt),
    encoder.encode(newDict),
    pdf.subarray(dictAt + oldDict.length, xrefAt),
    encoder.encode(`${head[0]}${updatedEntries.join("")}${trailer}`),
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
