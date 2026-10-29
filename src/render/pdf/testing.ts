/**
 * A minimal PDF reader for tests and the release smoke test (#59): enough of
 * PDF 1.7 to check what Sumi promises about its PDFs, without poppler or
 * another external tool, so the checks never skip.
 *
 * It reads the classic cross-reference table (and checks every in-use entry
 * points at its object), the document information dictionary, the page's
 * MediaBox, the fonts (type, embedded font file, subset tag), image XObjects,
 * and the text: it interprets the content streams (q / Q / cm, BT / Tm / Td /
 * Tf / Tj / TJ, and form XObjects via Do) and decodes each glyph through the
 * font's ToUnicode CMap, with its origin and advance in page space (pt, y up).
 *
 * The pinned krilla 0.8.2 serializer uses classic xref tables, including
 * compact dictionaries and indirect resources (supported here). Only its
 * emitted subset is supported (no object streams, xref streams,
 * encryption or incremental updates); anything else throws.
 */

import { inflateSync } from "node:zlib";

/** A PDF name (`/Font`). */
export class PdfName {
  constructor(readonly name: string) {}
}
/** An indirect reference (`12 0 R`). */
export class PdfRef {
  constructor(readonly ref: number) {}
}
type PdfValue =
  | number
  | boolean
  | null
  | string // a decoded string's bytes, as latin1
  | PdfName
  | PdfRef
  | PdfValue[]
  | PdfDict;
export interface PdfDict {
  [key: string]: PdfValue;
}

interface Token {
  kind: "num" | "name" | "str" | "op" | "punct";
  value: string;
}

const latin1 = new TextDecoder("latin1");
const WS = " \t\r\n\f\0";
const DELIM = "()<>[]{}/%";

/** Tokenizes PDF syntax (latin1 text); `stop` ends at the keyword `stream`. */
function* tokens(text: string): Generator<Token> {
  let i = 0;
  while (i < text.length) {
    const c = text.charAt(i);
    if (WS.includes(c)) {
      i++;
    } else if (c === "%") {
      while (i < text.length && text[i] !== "\n" && text[i] !== "\r") i++;
    } else if (c === "/") {
      let j = i + 1;
      while (j < text.length && !WS.includes(text.charAt(j)) && !DELIM.includes(text.charAt(j))) {
        j++;
      }
      const raw = text.slice(i + 1, j);
      yield {
        kind: "name",
        value: raw.replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))),
      };
      i = j;
    } else if (c === "(") {
      let depth = 1;
      let out = "";
      i++;
      while (i < text.length && depth > 0) {
        const d = text.charAt(i);
        if (d === "\\") {
          const e = text.charAt(i + 1);
          const simple: Record<string, string> = {
            n: "\n",
            r: "\r",
            t: "\t",
            b: "\b",
            f: "\f",
            "(": "(",
            ")": ")",
            "\\": "\\",
          };
          if (e in simple) {
            out += simple[e];
            i += 2;
          } else if (/[0-7]/.test(e)) {
            const oct = /^[0-7]{1,3}/.exec(text.slice(i + 1))?.[0] ?? "0";
            out += String.fromCharCode(parseInt(oct, 8) & 0xff);
            i += 1 + oct.length;
          } else if (e === "\r" || e === "\n") {
            i += e === "\r" && text[i + 2] === "\n" ? 3 : 2;
          } else {
            out += e;
            i += 2;
          }
          continue;
        }
        if (d === "(") depth++;
        if (d === ")" && --depth === 0) break;
        out += d;
        i++;
      }
      i++;
      yield { kind: "str", value: out };
    } else if (c === "<" && text[i + 1] !== "<") {
      const end = text.indexOf(">", i);
      const hex = text.slice(i + 1, end).replace(/\s/g, "");
      const padded = hex.length % 2 === 0 ? hex : `${hex}0`;
      let out = "";
      for (let j = 0; j < padded.length; j += 2) {
        out += String.fromCharCode(parseInt(padded.slice(j, j + 2), 16));
      }
      yield { kind: "str", value: out };
      i = end + 1;
    } else if (c === "<" || c === ">") {
      yield { kind: "punct", value: text.slice(i, i + 2) };
      i += 2;
    } else if (c === "[" || c === "]" || c === "{" || c === "}") {
      yield { kind: "punct", value: c };
      i++;
    } else {
      let j = i;
      while (j < text.length && !WS.includes(text.charAt(j)) && !DELIM.includes(text.charAt(j))) {
        j++;
      }
      if (j === i) throw new Error(`PDF syntax: unexpected "${c}" at ${i}`);
      const word = text.slice(i, j);
      yield { kind: /^[+-]?(\d+\.?\d*|\.\d+)$/.test(word) ? "num" : "op", value: word };
      i = j;
    }
  }
}

/** Parses PDF objects from a token stream; operators are returned as `{ op }` markers. */
class Parser {
  readonly #it: Iterator<Token>;
  #peeked: Token[] = [];
  constructor(text: string) {
    this.#it = tokens(text);
  }
  next(): Token | undefined {
    const t = this.#peeked.shift() ?? this.#it.next().value;
    return t === undefined ? undefined : t;
  }
  #peek(n: number): Token | undefined {
    while (this.#peeked.length <= n) {
      const t = this.#it.next();
      if (t.done) return undefined;
      this.#peeked.push(t.value);
    }
    return this.#peeked[n];
  }
  /** The next object, or an operator token, or `undefined` at the end. */
  value(): PdfValue | PdfOp | undefined {
    const t = this.next();
    if (t === undefined) return undefined;
    if (t.kind === "num") {
      const gen = this.#peek(0);
      const r = this.#peek(1);
      if (
        /^\d+$/.test(t.value) &&
        gen?.kind === "num" &&
        /^\d+$/.test(gen.value) &&
        r?.kind === "op" &&
        r.value === "R"
      ) {
        this.#peeked.splice(0, 2);
        return new PdfRef(Number(t.value));
      }
      return Number(t.value);
    }
    if (t.kind === "name") return new PdfName(t.value);
    if (t.kind === "str") return t.value;
    if (t.kind === "punct" && t.value === "[") {
      const items: PdfValue[] = [];
      for (;;) {
        const p = this.#peek(0);
        if (p === undefined) throw new Error("PDF syntax: unterminated array");
        if (p.kind === "punct" && p.value === "]") {
          this.next();
          return items;
        }
        items.push(this.object());
      }
    }
    if (t.kind === "punct" && t.value === "<<") {
      const dict: PdfDict = {};
      for (;;) {
        const k = this.next();
        if (k === undefined) throw new Error("PDF syntax: unterminated dictionary");
        if (k.kind === "punct" && k.value === ">>") return dict;
        if (k.kind !== "name") throw new Error(`PDF syntax: dictionary key ${k.value}`);
        dict[k.value] = this.object();
      }
    }
    if (t.kind === "op" && (t.value === "true" || t.value === "false")) return t.value === "true";
    if (t.kind === "op" && t.value === "null") return null;
    return new PdfOp(t.value);
  }
  object(): PdfValue {
    const v = this.value();
    if (v === undefined || isToken(v)) {
      throw new Error(`PDF syntax: expected an object, got ${v?.value ?? "the end"}`);
    }
    return v;
  }
}

/** An operator (or stray punctuation) where an object could be. */
class PdfOp {
  constructor(readonly value: string) {}
}

function isToken(v: PdfValue | PdfOp | undefined): v is PdfOp {
  return v instanceof PdfOp;
}

interface PdfObject {
  value: PdfValue;
  /** Decoded stream data (FlateDecode inflated). */
  stream?: Uint8Array;
}

export interface ParsedPdf {
  version: string;
  trailer: PdfDict;
  objects: Map<number, PdfObject>;
  resolve(v: PdfValue | undefined): PdfValue | undefined;
}

/** Parses the whole file through its cross-reference table. */
export function parsePdf(bytes: Uint8Array): ParsedPdf {
  const text = latin1.decode(bytes);
  const version = /^%PDF-(\d\.\d)/.exec(text)?.[1];
  if (version === undefined) throw new Error("not a PDF (no %PDF- header)");
  const startxref = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(text);
  if (startxref === null) throw new Error("no startxref at the end");
  const xrefAt = Number(startxref[1]);
  if (!text.startsWith("xref", xrefAt)) throw new Error(`startxref ${xrefAt} is not "xref"`);
  const trailerAt = text.indexOf("trailer", xrefAt);
  const sections = text
    .slice(xrefAt + 4, trailerAt)
    .trim()
    .split(/\r?\n|\r/);
  const offsets = new Map<number, number>();
  for (let i = 0; i < sections.length; ) {
    const [first, count] = (sections[i] ?? "").trim().split(/\s+/).map(Number);
    if (first === undefined || count === undefined) throw new Error("bad xref subsection");
    for (let k = 0; k < count; k++) {
      const entry = /^(\d{10}) (\d{5}) ([nf])/.exec(sections[i + 1 + k] ?? "");
      if (entry === null) throw new Error(`bad xref entry for object ${first + k}`);
      if (entry[3] === "n") offsets.set(first + k, Number(entry[1]));
    }
    i += 1 + count;
  }
  const trailer = new Parser(text.slice(trailerAt + 7)).object() as PdfDict;
  if (trailer.Prev !== undefined || trailer.Encrypt !== undefined) {
    throw new Error("incremental updates and encryption are not supported");
  }

  const objects = new Map<number, PdfObject>();
  for (const [num, at] of offsets) {
    const header = new RegExp(`^${num} 0 obj\\b`).exec(text.slice(at, at + 32));
    if (header === null)
      throw new Error(`xref offset ${at} of object ${num} is not "${num} 0 obj"`);
    const parser = new Parser(text.slice(at + header[0].length, text.indexOf("endobj", at)));
    const value = parser.object();
    const after = parser.next();
    let stream: Uint8Array | undefined;
    if (after?.kind === "op" && after.value === "stream") {
      const dict = value as PdfDict;
      const begin = text.indexOf("stream", at + header[0].length) + 6;
      const dataAt = begin + (text[begin] === "\r" ? 2 : 1);
      const length = dict.Length;
      if (typeof length !== "number")
        throw new Error(`object ${num}: stream /Length is not direct`);
      const raw = bytes.subarray(dataAt, dataAt + length);
      const filter = dict.Filter;
      if (filter === undefined) stream = raw;
      else if (filter instanceof PdfName) {
        // A JPEG image (#94) is embedded as it is (DCTDecode); its data is not inspected.
        if (filter.name === "DCTDecode") stream = raw;
        else if (filter.name !== "FlateDecode")
          throw new Error(`unsupported filter ${filter.name}`);
        else stream = new Uint8Array(inflateSync(raw));
      } else throw new Error(`object ${num}: unsupported /Filter`);
    }
    objects.set(num, stream === undefined ? { value } : { value, stream });
  }
  const resolve = (v: PdfValue | undefined): PdfValue | undefined => {
    let cur = v;
    for (let guard = 0; guard < 32; guard++) {
      if (cur instanceof PdfRef) {
        cur = objects.get(cur.ref)?.value;
      } else return cur;
    }
    throw new Error("reference cycle");
  };
  return { version, trailer, objects, resolve };
}

export interface PdfFont {
  /** e.g. `ABCDEF+BIZUDPGothic-Regular`. */
  baseFont: string;
  /** The descendant font's subtype for Type0 fonts (e.g. `CIDFontType2`), else the font's. */
  subtype: string;
  /** Whether a font program (FontFile / FontFile2 / FontFile3) is embedded. */
  embedded: boolean;
  /** Whether the name has a subset tag (six capital letters and `+`). */
  subset: boolean;
}

export interface PdfGlyph {
  /** Non-stroking RGB paint at the glyph (DeviceRGB or the engine's sRGB ICC space). */
  color?: readonly number[];
  /** The Unicode text of the glyph (from ToUnicode). */
  text: string;
  /** Origin on the baseline, page space (pt, y up). */
  x: number;
  y: number;
  /** Advance width in page space (pt). */
  advance: number;
  /** Effective font size (pt). */
  size: number;
  font: string;
}

export interface PdfInspection {
  version: string;
  info: Record<string, string>;
  pages: { mediaBox: number[] }[];
  fonts: PdfFont[];
  /** Number of image XObjects (raster images) anywhere in the file. */
  images: number;
  /** Glyphs of the first page in drawing order. */
  glyphs: PdfGlyph[];
}

const nameOf = (v: PdfValue | undefined): string | undefined =>
  v instanceof PdfName ? v.name : undefined;
const asDict = (v: PdfValue | undefined): PdfDict | undefined =>
  v !== null &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  !(v instanceof PdfName) &&
  !(v instanceof PdfRef)
    ? (v as PdfDict)
    : undefined;

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
/** `m × n` (apply m first, then n), as PDF composes `cm` with the CTM. */
function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}
const apply = (m: Matrix, x: number, y: number): [number, number] => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
];

interface LoadedFont {
  name: string;
  toUnicode: Map<number, string>;
  widths: Map<number, number>;
  defaultWidth: number;
}

function parseToUnicode(cmap: string): Map<number, string> {
  const map = new Map<number, string>();
  const utf16 = (hex: string) => {
    let s = "";
    for (let i = 0; i + 3 < hex.length; i += 4)
      s += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
    return s;
  };
  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of (block[1] ?? "").matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      map.set(parseInt(m[1] ?? "0", 16), utf16(m[2] ?? ""));
    }
  }
  for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of (block[1] ?? "").matchAll(
      /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g,
    )) {
      const lo = parseInt(m[1] ?? "0", 16);
      const hi = parseInt(m[2] ?? "0", 16);
      const base = utf16(m[3] ?? "");
      for (let c = lo; c <= hi; c++) {
        map.set(
          c,
          base.slice(0, -1) + String.fromCharCode(base.charCodeAt(base.length - 1) + (c - lo)),
        );
      }
    }
  }
  return map;
}

/** Inspects a PDF (see the module comment). Throws on anything it cannot read. */
export function inspectPdf(bytes: Uint8Array): PdfInspection {
  const pdf = parsePdf(bytes);
  const { resolve } = pdf;
  const info: Record<string, string> = {};
  const infoDict = asDict(resolve(pdf.trailer.Info));
  for (const [k, v] of Object.entries(infoDict ?? {})) {
    if (typeof v !== "string") continue;
    // UTF-16BE with a BOM, else PDFDocEncoding (ASCII here).
    if (v.startsWith("\xfe\xff")) {
      let s = "";
      for (let i = 2; i + 1 < v.length; i += 2)
        s += String.fromCharCode((v.charCodeAt(i) << 8) | v.charCodeAt(i + 1));
      info[k] = s;
    } else info[k] = v;
  }

  const fonts: PdfFont[] = [];
  let images = 0;
  for (const { value } of pdf.objects.values()) {
    const dict = asDict(value);
    if (dict === undefined) continue;
    if (nameOf(dict.Type) === "XObject" && nameOf(dict.Subtype) === "Image") images++;
    if (nameOf(dict.Type) !== "Font" || nameOf(dict.Subtype) === "CIDFontType2") continue;
    if (nameOf(dict.Subtype) === "CIDFontType0") continue;
    const baseFont = nameOf(dict.BaseFont) ?? "";
    const descendants = resolve(dict.DescendantFonts);
    const descendant = Array.isArray(descendants) ? asDict(resolve(descendants[0])) : undefined;
    const fontDict = descendant ?? dict;
    const descriptor = asDict(resolve(fontDict.FontDescriptor));
    fonts.push({
      baseFont,
      subtype: nameOf(fontDict.Subtype) ?? "",
      embedded:
        descriptor !== undefined &&
        (descriptor.FontFile !== undefined ||
          descriptor.FontFile2 !== undefined ||
          descriptor.FontFile3 !== undefined),
      subset: /^[A-Z]{6}\+/.test(baseFont),
    });
  }

  const catalog = asDict(resolve(pdf.trailer.Root));
  const pageTree = asDict(resolve(catalog?.Pages));
  const kids = resolve(pageTree?.Kids);
  const pageDicts = (Array.isArray(kids) ? kids : []).map((k) => asDict(resolve(k)) ?? {});
  const pages = pageDicts.map((p) => ({
    mediaBox: ((resolve(p.MediaBox) as PdfValue[] | undefined) ?? []).map((v) =>
      Number(resolve(v)),
    ),
  }));

  const fontCache = new Map<string, LoadedFont>();
  const loadFont = (resources: PdfDict, name: string): LoadedFont => {
    const ref = asDict(resolve(resources.Font))?.[name];
    const key = ref instanceof PdfRef ? `r${ref.ref}` : name;
    const cached = fontCache.get(key);
    if (cached !== undefined) return cached;
    const dict = asDict(resolve(ref)) ?? {};
    const toUnicodeRef = dict.ToUnicode;
    const toUnicodeObj =
      toUnicodeRef instanceof PdfRef ? pdf.objects.get(toUnicodeRef.ref) : undefined;
    const toUnicode = toUnicodeObj?.stream
      ? parseToUnicode(latin1.decode(toUnicodeObj.stream))
      : new Map<number, string>();
    const descendants = resolve(dict.DescendantFonts);
    const cid = Array.isArray(descendants) ? asDict(resolve(descendants[0])) : undefined;
    const widths = new Map<number, number>();
    const w = resolve(cid?.W);
    if (Array.isArray(w)) {
      for (let i = 0; i < w.length; ) {
        const first = Number(resolve(w[i]));
        const next = resolve(w[i + 1]);
        if (Array.isArray(next)) {
          for (const [k, v] of next.entries()) widths.set(first + k, Number(resolve(v)));
          i += 2;
        } else {
          const last = Number(next);
          const width = Number(resolve(w[i + 2]));
          for (let c = first; c <= last; c++) widths.set(c, width);
          i += 3;
        }
      }
    }
    const loaded = {
      name: nameOf(dict.BaseFont) ?? name,
      toUnicode,
      widths,
      defaultWidth: Number(resolve(cid?.DW) ?? 1000),
    };
    fontCache.set(key, loaded);
    return loaded;
  };

  const glyphs: PdfGlyph[] = [];
  const run = (
    content: Uint8Array,
    resources: PdfDict,
    start: Matrix,
    depth: number,
    initialColor: readonly number[] = [0, 0, 0],
  ) => {
    if (depth > 16) throw new Error("form XObjects nested too deeply");
    const parser = new Parser(latin1.decode(content));
    const operands: PdfValue[] = [];
    const stack: { ctm: Matrix; color: readonly number[] }[] = [];
    let color = initialColor;
    let ctm = start;
    let tm: Matrix = IDENTITY;
    let tlm: Matrix = IDENTITY;
    let font: LoadedFont | undefined;
    let size = 0;
    const show = (s: string) => {
      if (font === undefined) throw new Error("text shown without a font");
      for (let i = 0; i + 1 < s.length; i += 2) {
        const code = (s.charCodeAt(i) << 8) | s.charCodeAt(i + 1);
        const trm = multiply([size, 0, 0, size, 0, 0], multiply(tm, ctm));
        const [x, y] = apply(trm, 0, 0);
        const w = (font.widths.get(code) ?? font.defaultWidth) / 1000;
        const [ax, ay] = apply(trm, w, 0);
        glyphs.push({
          text: font.toUnicode.get(code) ?? "�",
          x,
          y,
          advance: Math.hypot(ax - x, ay - y),
          size: Math.hypot(trm[0], trm[1]),
          font: font.name,
          color,
        });
        tm = multiply([1, 0, 0, 1, w * size, 0], tm);
      }
    };
    for (;;) {
      const v = parser.value();
      if (v === undefined) break;
      if (!isToken(v)) {
        operands.push(v);
        continue;
      }
      const nums = operands.map(Number) as Matrix;
      switch (v.value) {
        case "q":
          stack.push({ ctm, color });
          break;
        case "Q":
          ({ ctm, color } = stack.pop() ?? { ctm: IDENTITY, color: initialColor });
          break;
        case "rg":
        case "sc":
        case "scn":
          if (operands.length === 3) color = operands.map(Number);
          break;
        case "g":
          color = [Number(operands[0]), Number(operands[0]), Number(operands[0])];
          break;
        case "cm":
          ctm = multiply(nums, ctm);
          break;
        case "BT":
          tm = IDENTITY;
          tlm = IDENTITY;
          break;
        case "Tm":
          tm = nums;
          tlm = nums;
          break;
        case "Td":
          tlm = multiply([1, 0, 0, 1, nums[0], nums[1]], tlm);
          tm = tlm;
          break;
        case "Tf":
          font = loadFont(resources, nameOf(operands[0]) ?? "");
          size = Number(operands[1]);
          break;
        case "Tj":
          show(String(operands[0]));
          break;
        case "TJ":
          for (const part of (operands[0] as PdfValue[]) ?? []) {
            if (typeof part === "string") show(part);
            else tm = multiply([1, 0, 0, 1, (-Number(part) / 1000) * size, 0], tm);
          }
          break;
        case "Do": {
          const ref = asDict(resolve(resources.XObject))?.[nameOf(operands[0]) ?? ""];
          const obj = ref instanceof PdfRef ? pdf.objects.get(ref.ref) : undefined;
          const dict = asDict(obj?.value);
          if (dict !== undefined && nameOf(dict.Subtype) === "Form" && obj?.stream) {
            const matrix = (resolve(dict.Matrix) as PdfValue[] | undefined)?.map(Number) as
              | Matrix
              | undefined;
            run(
              obj.stream,
              asDict(resolve(dict.Resources)) ?? resources,
              multiply(matrix ?? IDENTITY, ctm),
              depth + 1,
              color,
            );
          }
          break;
        }
      }
      operands.length = 0;
    }
  };
  const page = pageDicts[0];
  if (page !== undefined) {
    const contents = resolve(page.Contents);
    const refs = Array.isArray(contents) ? contents : [page.Contents];
    const resources = asDict(resolve(page.Resources)) ?? {};
    for (const ref of refs) {
      const obj = ref instanceof PdfRef ? pdf.objects.get(ref.ref) : undefined;
      if (obj?.stream) run(obj.stream, resources, IDENTITY, 0);
    }
  }
  return { version: pdf.version, info, pages, fonts, images, glyphs };
}

export interface PdfTextLine {
  text: string;
  /** Left end of the first glyph and right end of the last (pt, page space). */
  x0: number;
  x1: number;
  /** Baseline (pt, page space, y up). */
  y: number;
  size: number;
  font: string;
}

/**
 * Groups glyphs into lines: consecutive glyphs with the same font, size and
 * baseline whose origins continue where the previous glyph ended.
 */
export function textLines(glyphs: readonly PdfGlyph[], tolerance = 0.01): PdfTextLine[] {
  const lines: PdfTextLine[] = [];
  for (const g of glyphs) {
    const last = lines.at(-1);
    if (
      last !== undefined &&
      last.font === g.font &&
      Math.abs(last.size - g.size) < tolerance &&
      Math.abs(last.y - g.y) < tolerance &&
      Math.abs(last.x1 - g.x) < Math.max(tolerance, g.size * 0.05)
    ) {
      last.text += g.text;
      last.x1 = g.x + g.advance;
    } else {
      lines.push({
        text: g.text,
        x0: g.x,
        x1: g.x + g.advance,
        y: g.y,
        size: g.size,
        font: g.font,
      });
    }
  }
  return lines;
}
