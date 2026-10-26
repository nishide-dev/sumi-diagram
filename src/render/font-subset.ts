/**
 * Font subsets for the `@font-face` rules of structured SVGs (#91, design doc
 * §6.23). D2 embeds WOFF subsets of the font set in its SVGs; the structured
 * SVG writer embeds TrueType subsets of the same files, so a browser draws
 * the figure with the fonts its labels were measured with (and
 * `svg/missing-font-face` holds).
 *
 * The glyph outlines are subset by `subsetter` (the crate krilla uses for
 * PDFs) in the bundled WASM engine (`subset` operation). Its subsets are made
 * for PDF CID fonts and drop `cmap` and `OS/2`, which browsers need, so this
 * module adds them back:
 *
 * 1. Maps the text's code points to glyph IDs with the font's own `cmap`
 *    (characters the font lacks are left out: browsers fall back for them,
 *    as for D2's subsets; `lint/missing-glyph` reports them).
 * 2. Adds the components of composite glyphs (transitively) and sorts the
 *    glyph IDs, so the request — and the subset's new glyph IDs, `.notdef`
 *    first and then in that order — are known here.
 * 3. Writes a `cmap` (format 4 for the BMP under 3/1, format 12 under 3/10)
 *    mapping each code point to its new glyph ID, copies the original `OS/2`,
 *    and reassembles the font (tables sorted by tag, checksums,
 *    `head.checkSumAdjustment`).
 *
 * The result is deterministic: the engine is a single WASM module and
 * everything here is integer arithmetic in a fixed order. The `name` table
 * (copyright and the OFL notice) is kept by subsetter.
 */

import { readFileSync } from "node:fs";
import { parseGlyphCoverage } from "../lint/cmap";
import { FontParseError } from "../lint/sfnt";
import { loadEngine, runEngine } from "./pdf/engine";

/** Raw tables of a TrueType font, by tag. */
function rawTables(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fail = (message: string): never => {
    throw new FontParseError(message);
  };
  if (bytes.length < 12) fail("the font is truncated");
  const count = view.getUint16(4);
  const tables = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i++) {
    const record = 12 + i * 16;
    if (record + 16 > bytes.length) fail("the table directory is truncated");
    const tag = String.fromCharCode(...bytes.subarray(record, record + 4));
    const offset = view.getUint32(record + 8);
    const length = view.getUint32(record + 12);
    if (offset + length > bytes.length) fail(`the ${tag} table is outside the font`);
    if (!tables.has(tag)) tables.set(tag, bytes.subarray(offset, offset + length));
  }
  return tables;
}

const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/** Glyph IDs of the components of composite glyphs reachable from `glyphs` (TrueType `glyf`). */
function compositeClosure(tables: Map<string, Uint8Array>, glyphs: Set<number>): Set<number> {
  const head = tables.get("head");
  const loca = tables.get("loca");
  const glyf = tables.get("glyf");
  const maxp = tables.get("maxp");
  if (!head || !loca || !glyf || !maxp) {
    throw new FontParseError("the font has no TrueType outlines (glyf / loca)");
  }
  const longLoca = view(head).getInt16(50) === 1;
  const numGlyphs = view(maxp).getUint16(4);
  const locaView = view(loca);
  const offsetOf = (gid: number): number => {
    if (gid > numGlyphs) throw new FontParseError(`glyph ${gid} is outside loca`);
    return longLoca ? locaView.getUint32(gid * 4) : locaView.getUint16(gid * 2) * 2;
  };
  const glyfView = view(glyf);
  const result = new Set(glyphs);
  const pending = [...glyphs];
  for (let gid = pending.pop(); gid !== undefined; gid = pending.pop()) {
    const start = offsetOf(gid);
    const end = offsetOf(gid + 1);
    if (end - start < 10 || glyfView.getInt16(start) >= 0) continue;
    let at = start + 10;
    for (;;) {
      const flags = glyfView.getUint16(at);
      const component = glyfView.getUint16(at + 2);
      if (component >= numGlyphs)
        throw new FontParseError(`component glyph ${component} is out of range`);
      if (!result.has(component)) {
        result.add(component);
        pending.push(component);
      }
      at += 4 + (flags & 0x1 ? 4 : 2);
      if (flags & 0x8) at += 2;
      else if (flags & 0x40) at += 4;
      else if (flags & 0x80) at += 8;
      if (!(flags & 0x20)) break;
    }
  }
  return result;
}

class Writer {
  readonly #bytes: number[] = [];
  u16(value: number): this {
    this.#bytes.push((value >>> 8) & 0xff, value & 0xff);
    return this;
  }
  u32(value: number): this {
    return this.u16(Math.floor(value / 0x10000) & 0xffff).u16(value & 0xffff);
  }
  bytes(): Uint8Array {
    return Uint8Array.from(this.#bytes);
  }
}

/** A raw `cmap` subtable with its encoding record. */
interface CmapSubtable {
  platform: number;
  encoding: number;
  body: Uint8Array;
}

/**
 * A `cmap` table for `mapping` (code point → glyph ID, ascending by code
 * point), plus `kept` subtables copied as they are (e.g. format 14 variation
 * sequences, whose offsets are relative to the subtable itself).
 */
function cmapTable(
  mapping: readonly (readonly [number, number])[],
  kept: readonly CmapSubtable[] = [],
): Uint8Array {
  // Format 4 (BMP): runs of consecutive code points with consecutive glyph IDs.
  const runs: { start: number; end: number; delta: number }[] = [];
  for (const [cp, gid] of mapping) {
    if (cp > 0xfffe) continue;
    const last = runs.at(-1);
    if (
      last !== undefined &&
      last.end + 1 === cp &&
      last.start + last.delta + (cp - last.start) === gid
    ) {
      last.end = cp;
    } else runs.push({ start: cp, end: cp, delta: gid - cp });
  }
  runs.push({ start: 0xffff, end: 0xffff, delta: 1 });
  const segX2 = runs.length * 2;
  const log2 = Math.floor(Math.log2(runs.length));
  const searchRange = 2 * 2 ** log2;
  const format4 = new Writer()
    .u16(4)
    .u16(16 + runs.length * 8)
    .u16(0);
  format4
    .u16(segX2)
    .u16(searchRange)
    .u16(log2)
    .u16(segX2 - searchRange);
  for (const run of runs) format4.u16(run.end);
  format4.u16(0);
  for (const run of runs) format4.u16(run.start);
  for (const run of runs) format4.u16((run.delta + 0x10000) & 0xffff);
  for (const _ of runs) format4.u16(0);
  // Format 12: every code point, in groups with consecutive glyph IDs.
  const groups: { start: number; end: number; gid: number }[] = [];
  for (const [cp, gid] of mapping) {
    const last = groups.at(-1);
    if (last !== undefined && last.end + 1 === cp && last.gid + (cp - last.start) === gid) {
      last.end = cp;
    } else groups.push({ start: cp, end: cp, gid });
  }
  const format12 = new Writer()
    .u16(12)
    .u16(0)
    .u32(16 + groups.length * 12)
    .u32(0);
  format12.u32(groups.length);
  for (const group of groups) format12.u32(group.start).u32(group.end).u32(group.gid);
  const subtables: CmapSubtable[] = [...kept];
  // Format 4's length is 16 bits: with too many segments (some 8,000), only format 12 is written.
  if (16 + runs.length * 8 <= 0xffff)
    subtables.push({ platform: 3, encoding: 1, body: format4.bytes() });
  subtables.push({ platform: 3, encoding: 10, body: format12.bytes() });
  subtables.sort((a, b) => a.platform - b.platform || a.encoding - b.encoding);
  const header = new Writer().u16(0).u16(subtables.length);
  let offset = 4 + subtables.length * 8;
  for (const { platform, encoding, body } of subtables) {
    header.u16(platform).u16(encoding).u32(offset);
    offset += body.length;
  }
  return concat([header.bytes(), ...subtables.map((t) => t.body)]);
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function checksum(bytes: Uint8Array): number {
  let sum = 0;
  const padded = new Uint8Array(Math.ceil(bytes.length / 4) * 4);
  padded.set(bytes);
  const v = view(padded);
  for (let i = 0; i < padded.length; i += 4) sum = (sum + v.getUint32(i)) >>> 0;
  return sum;
}

/** Assembles a TrueType font from its tables (sorted by tag, 4-byte aligned, checksummed). */
function assemble(tables: Map<string, Uint8Array>): Uint8Array {
  const tags = [...tables.keys()].sort();
  const count = tags.length;
  const log2 = Math.floor(Math.log2(count));
  const searchRange = 16 * 2 ** log2;
  const header = new Writer().u32(0x00010000).u16(count).u16(searchRange).u16(log2);
  header.u16(count * 16 - searchRange);
  let offset = 12 + count * 16;
  const bodies: Uint8Array[] = [];
  let headOffset: number | undefined;
  for (const tag of tags) {
    let data = tables.get(tag) as Uint8Array;
    if (tag === "head") {
      data = data.slice();
      view(data).setUint32(8, 0);
      headOffset = offset;
    }
    bodies.push(data);
    offset += Math.ceil(data.length / 4) * 4;
  }
  const out = new Uint8Array(offset);
  out.set(header.bytes().subarray(0, 12), 0);
  const v = view(out);
  let at = 12 + count * 16;
  tags.forEach((tag, i) => {
    const data = bodies[i] as Uint8Array;
    const record = 12 + i * 16;
    for (let j = 0; j < 4; j++) out[record + j] = tag.charCodeAt(j);
    v.setUint32(record + 4, checksum(data));
    v.setUint32(record + 8, at);
    v.setUint32(record + 12, data.length);
    out.set(data, at);
    at += Math.ceil(data.length / 4) * 4;
  });
  if (headOffset !== undefined) {
    v.setUint32(headOffset + 8, (0xb1b0afba - checksum(out)) >>> 0);
  }
  return out;
}

/**
 * A copy of a TrueType font without the given tables (rebuilt directory and
 * checksums). The PDF export drops the label-math fonts' `GSUB` / `GPOS`
 * (#93): their shaping (contextual `f` alternates, kerning) would change the
 * advances that the layout and the SVG subsets (which have neither table) use.
 */
export function withoutTables(bytes: Uint8Array, tags: readonly string[]): Uint8Array {
  const tables = rawTables(bytes);
  for (const tag of tags) tables.delete(tag);
  return assemble(tables);
}

/**
 * A copy of a TrueType font whose `cmap` also maps `extra` code points (to
 * glyph IDs): its Unicode mapping is rewritten as format 4 (3/1) and format
 * 12 (3/10) subtables, which every reader picks first; format 14 (variation
 * sequences) subtables are kept, other subtables dropped. Code points the
 * font already maps keep their glyph. Used by the PDF export (#112, see
 * `pdf/fonts.ts`).
 */
export function withCodePoints(bytes: Uint8Array, extra: ReadonlyMap<number, number>): Uint8Array {
  const tables = rawTables(bytes);
  const coverage = parseGlyphCoverage(bytes);
  const mapping = new Map(coverage.entries());
  for (const [cp, gid] of extra) if (!mapping.has(cp)) mapping.set(cp, gid);
  const sorted = [...mapping].sort((a, b) => a[0] - b[0]);
  const cmap = tables.get("cmap") as Uint8Array;
  const v = view(cmap);
  const kept: CmapSubtable[] = [];
  for (let i = 0; i < v.getUint16(2); i++) {
    const record = 4 + i * 8;
    const offset = v.getUint32(record + 4);
    if (v.getUint16(offset) !== 14) continue;
    const length = v.getUint32(offset + 2);
    if (offset + length > cmap.length)
      throw new FontParseError("cmap format 14 subtable is truncated");
    kept.push({
      platform: v.getUint16(record),
      encoding: v.getUint16(record + 2),
      body: cmap.subarray(offset, offset + length),
    });
  }
  tables.set("cmap", cmapTable(sorted, kept));
  return assemble(tables);
}

const fontBytes = new Map<string, Uint8Array>();

function readFont(path: string): Uint8Array {
  let bytes = fontBytes.get(path);
  if (bytes === undefined) {
    bytes = new Uint8Array(readFileSync(path));
    fontBytes.set(path, bytes);
  }
  return bytes;
}

/**
 * A TrueType subset of the font at `path` with the glyphs of `text`'s
 * characters (see the module comment). Throws `FontParseError` for an
 * unusable font and `Error` if the engine is unavailable or fails.
 */
export function subsetFont(path: string, text: string): Uint8Array {
  const bytes = readFont(path);
  const tables = rawTables(bytes);
  const coverage = parseGlyphCoverage(bytes);
  const codePoints = [...new Set([...text].map((c) => c.codePointAt(0) as number))].sort(
    (a, b) => a - b,
  );
  const mapped = codePoints
    .map((cp) => [cp, coverage.glyph(cp)] as const)
    .filter(([, gid]) => gid !== 0);
  // `.notdef` is always in a subset (subsetter adds it), so its components are too.
  const glyphs = [...compositeClosure(tables, new Set([0, ...mapped.map(([, gid]) => gid)]))]
    .filter((gid) => gid !== 0)
    .sort((a, b) => a - b);
  const request = new Uint8Array(glyphs.length * 2);
  for (const [i, gid] of glyphs.entries()) view(request).setUint16(i * 2, gid, true);
  const result = runEngine(loadEngine(), request, [bytes], "subset");
  if (!result.ok) throw new Error(`the font engine cannot subset ${path}: ${result.message}`);
  const out = result.pdf;
  const n = view(out).getUint32(0, true);
  const order = Array.from({ length: n }, (_, i) => view(out).getUint16(4 + i * 2, true));
  const expected = [0, ...glyphs];
  if (order.length !== expected.length || order.some((gid, i) => gid !== expected[i])) {
    throw new Error("internal error: the font subset has an unexpected glyph order");
  }
  const newId = new Map(order.map((gid, i) => [gid, i]));
  const subset = rawTables(out.subarray(4 + n * 2));
  subset.set("cmap", cmapTable(mapped.map(([cp, gid]) => [cp, newId.get(gid) as number])));
  const os2 = tables.get("OS/2");
  if (os2 !== undefined) subset.set("OS/2", os2);
  return assemble(subset);
}
