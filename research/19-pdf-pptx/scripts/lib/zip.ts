/**
 * Minimal deterministic ZIP writer (DEFLATE via Bun.deflateSync, CRC-32 via
 * Bun.hash.crc32): entries in the given order, fixed DOS timestamp
 * (1980-01-01 00:00), no extra fields, no data descriptors. Enough for OOXML
 * (PPTX) packages; no dependency.
 */

export interface ZipEntry {
  name: string;
  data: Uint8Array | string;
}

const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01

export function zip(entries: readonly ZipEntry[]): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = enc.encode(entry.name);
    const raw = typeof entry.data === "string" ? enc.encode(entry.data) : entry.data;
    const deflated = Bun.deflateSync(raw as Uint8Array<ArrayBuffer>, { level: 9 });
    // Store when DEFLATE does not help (PNG); method 8 = deflate, 0 = stored.
    const [method, body] = deflated.length < raw.length ? [8, deflated] : [0, raw];
    const crc = Bun.hash.crc32(raw as Uint8Array<ArrayBuffer>);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, method, true);
    local.setUint16(10, DOS_TIME, true);
    local.setUint16(12, DOS_DATE, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, body.length, true);
    local.setUint32(22, raw.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, method, true);
    cd.setUint16(12, DOS_TIME, true);
    cd.setUint16(14, DOS_DATE, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, body.length, true);
    cd.setUint32(24, raw.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);

    chunks.push(new Uint8Array(local.buffer), name, body);
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + body.length;
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  const parts = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
