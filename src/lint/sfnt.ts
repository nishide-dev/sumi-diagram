/**
 * Shared low-level access to TrueType / OpenType (sfnt) files for the font
 * readers (`cmap.ts`, `metrics.ts`): a bounds-checked big-endian reader and
 * the table directory. Every read is confined to the window it is made on, so
 * a malformed offset or length throws a {@link FontParseError} instead of
 * reading outside the table it belongs to.
 */

export class FontParseError extends Error {
  override name = "FontParseError";
}

/** sfnt versions of single fonts: TrueType outlines (two spellings) and CFF (`OTTO`). */
const SFNT_VERSIONS = new Set([0x00010000, 0x74727565, 0x4f54544f]);
const TTC_TAG = 0x74746366; // "ttcf"

/** Bounds-checked big-endian reader over a window of the font file. */
export class Reader {
  readonly #view: DataView;
  readonly #name: string;
  constructor(bytes: Uint8Array, name = "font") {
    this.#view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.#name = name;
  }
  get length(): number {
    return this.#view.byteLength;
  }
  #check(offset: number, size: number): void {
    if (!Number.isInteger(offset) || offset < 0 || offset + size > this.#view.byteLength) {
      throw new FontParseError(
        `read of ${size} bytes at offset ${offset} is outside the ${this.#name} (${this.#view.byteLength} bytes)`,
      );
    }
  }
  /** A reader restricted to `[offset, offset + length)` of this one. */
  window(offset: number, length: number, name: string): Reader {
    this.#check(offset, length);
    const { buffer, byteOffset } = this.#view;
    return new Reader(new Uint8Array(buffer, byteOffset + offset, length), name);
  }
  u16(offset: number): number {
    this.#check(offset, 2);
    return this.#view.getUint16(offset);
  }
  i16(offset: number): number {
    this.#check(offset, 2);
    return this.#view.getInt16(offset);
  }
  u32(offset: number): number {
    this.#check(offset, 4);
    return this.#view.getUint32(offset);
  }
}

/** Big-endian tag value of a 4-character table tag, e.g. `tag("cmap")`. */
export function tag(name: string): number {
  if (name.length !== 4) throw new Error(`internal error: table tag "${name}" is not 4 characters`);
  let value = 0;
  for (let i = 0; i < 4; i++) value = value * 256 + name.charCodeAt(i);
  return value;
}

/** The tables of a single (non-collection) sfnt font, each as a reader over its declared range. */
export interface SfntTables {
  /** The table with the given tag, or `undefined` if the font has none. */
  get(name: string): Reader | undefined;
  /** The table with the given tag; throws {@link FontParseError} if it is missing. */
  require(name: string): Reader;
}

/** Reads the table directory of a font file. */
export function readTables(bytes: Uint8Array): SfntTables {
  const file = new Reader(bytes);
  const sfntVersion = file.u32(0);
  if (sfntVersion === TTC_TAG) {
    throw new FontParseError("font collections (.ttc) are not supported");
  }
  if (!SFNT_VERSIONS.has(sfntVersion)) {
    throw new FontParseError("not a TrueType or OpenType font");
  }
  const numTables = file.u16(4);
  const records = new Map<number, { offset: number; length: number }>();
  for (let i = 0; i < numTables; i++) {
    const record = 12 + i * 16;
    const tableTag = file.u32(record);
    // The first record of a tag wins; duplicates are malformed but harmless here.
    if (!records.has(tableTag)) {
      records.set(tableTag, { offset: file.u32(record + 8), length: file.u32(record + 12) });
    }
  }
  const get = (name: string): Reader | undefined => {
    const record = records.get(tag(name));
    return record && file.window(record.offset, record.length, `${name} table`);
  };
  return {
    get,
    require(name) {
      const table = get(name);
      if (table === undefined) throw new FontParseError(`the font has no ${name} table`);
      return table;
    },
  };
}
