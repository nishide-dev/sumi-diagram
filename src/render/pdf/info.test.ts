import { describe, expect, test } from "bun:test";
import { documentInfoEntries, pdfTextString, setDocumentInfo } from "./info";
import { inspectPdf, parsePdf } from "./testing";

const encode = (s: string) => new TextEncoder().encode(s);
const decode = (b: Uint8Array) => new TextDecoder("latin1").decode(b);

/** A tiny classic-xref PDF with Info before Catalog, as krilla writes it. */
function krillaLike(): Uint8Array {
  const objects = [
    "1 0 obj\n<<\n  /Type /Catalog\n  /Pages 2 0 R\n>>\nendobj\n\n",
    "2 0 obj\n<<\n  /Type /Pages\n  /Count 1\n  /Kids [3 0 R]\n>>\nendobj\n\n",
    "3 0 obj\n<<\n  /Type /Page\n  /Parent 2 0 R\n  /MediaBox [0 0 10 20]\n>>\nendobj\n\n",
    "4 0 obj\n<</Producer(Sumi krilla)>>\nendobj\n",
    "5 0 obj\n<</Type/Catalog/Pages 2 0 R>>\nendobj\n",
  ];
  let text = "%PDF-1.7\n%\x80\x80\x80\x80\n\n";
  const offsets: number[] = [];
  for (const o of objects) {
    offsets.push(text.length);
    text += o;
  }
  const xref = text.length;
  text += `xref\n0 6\n0000000000 65535 f\r\n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n\r\n`).join("")}`;
  text += `trailer\n<</Size 6/Root 5 0 R/Info 4 0 R>>\nstartxref\n${xref}\n%%EOF`;
  return Uint8Array.from(text, (c) => c.charCodeAt(0));
}

describe("pdfTextString", () => {
  test("escapes literal strings and hex-encodes non-ASCII as UTF-16BE", () => {
    expect(pdfTextString("plain")).toBe("(plain)");
    expect(pdfTextString("a(b)\\c")).toBe("(a\\(b\\)\\\\c)");
    expect(pdfTextString("図")).toBe("<FEFF56F3>");
    expect(pdfTextString("tab\there")).toBe("<FEFF00740061006200090068006500720065>");
  });
});

describe("setDocumentInfo", () => {
  test("replaces the marker and shifts Catalog and startxref offsets correctly", () => {
    const pdf = krillaLike();
    expect(() => parsePdf(pdf)).not.toThrow();
    const out = setDocumentInfo(pdf, [
      ["Title", "fig (1)"],
      ["SumiTheme", "テーマ"],
    ]);
    if (out === undefined) throw new Error("not replaced");
    expect(decode(out)).toContain(
      "4 0 obj\n<<\n  /Title (fig \\(1\\))\n  /SumiTheme <FEFF30C630FC30DE>\n>>",
    );
    // parsePdf checks that startxref and every xref entry point where they should.
    expect(inspectPdf(out).info).toEqual({ Title: "fig (1)", SumiTheme: "テーマ" });
    expect(inspectPdf(out).pages).toEqual([{ mediaBox: [0, 0, 10, 20] }]);
  });

  test("rejects unexpected markers, Info references, and unsupported trailers", () => {
    const pdf = decode(krillaLike());
    expect(setDocumentInfo(encode(pdf.replace("(Sumi krilla)", "(other)")), [])).toBeUndefined();
    expect(setDocumentInfo(encode(pdf.replace("/Info 4 0 R", "/Info 3 0 R")), [])).toBeUndefined();
    expect(setDocumentInfo(encode("%PDF-1.7\n"), [])).toBeUndefined();
    expect(setDocumentInfo(encode(pdf.replace("/Info 4", "/Prev 0/Info 4")), [])).toBeUndefined();
    expect(
      setDocumentInfo(encode(pdf.replace("/Info 4", "/Encrypt 1 0 R/Info 4")), []),
    ).toBeUndefined();
  });

  test("keeps following offsets valid when the dictionary shrinks", () => {
    const out = setDocumentInfo(krillaLike(), []);
    expect(out).toBeDefined();
    if (out === undefined) return;
    expect(inspectPdf(out).info).toEqual({});
    expect(inspectPdf(out).pages).toEqual([{ mediaBox: [0, 0, 10, 20] }]);
  });
});

describe("documentInfoEntries", () => {
  test("without Sumi metadata, only the producer", () => {
    expect(documentInfoEntries(undefined)).toEqual([
      ["Producer", "krilla 0.8.2, krilla-svg 0.8.1"],
    ]);
  });
});
