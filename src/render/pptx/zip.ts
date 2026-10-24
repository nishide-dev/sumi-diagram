/** Deterministic ZIP32 for our fixed OOXML parts: UTF-8 names, no clock/extra fields. */
export interface ZipEntry {
  name: string;
  data: string | Uint8Array;
}

export function zip(entries: readonly ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  const seen = new Set<string>();
  let offset = 0;
  if (entries.length > 65535) throw new Error("Too many ZIP entries");
  for (const entry of entries) {
    if (
      seen.has(entry.name) ||
      !/^[\w[\]./-]+$/.test(entry.name) ||
      entry.name.split("/").includes("..")
    )
      throw new Error("Invalid or duplicate ZIP part");
    seen.add(entry.name);
    const name = encoder.encode(entry.name);
    const raw =
      typeof entry.data === "string" ? encoder.encode(entry.data) : new Uint8Array(entry.data);
    const compressed = Bun.deflateSync(raw, { level: 9 });
    const [method, body] = compressed.length < raw.length ? [8, compressed] : [0, raw];
    if (offset + body.length + name.length + 30 > 0xffffffff)
      throw new Error("ZIP32 size exceeded");
    const crc = Bun.hash.crc32(raw);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(8, method, true);
    local.setUint16(12, 33, true); // DOS 1980-01-01, time zero.
    local.setUint32(14, crc, true);
    local.setUint32(18, body.length, true);
    local.setUint32(22, raw.length, true);
    local.setUint16(26, name.length, true);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, method, true);
    cd.setUint16(14, 33, true);
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
  const result = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of parts) {
    result.set(part, at);
    at += part.length;
  }
  return result;
}
