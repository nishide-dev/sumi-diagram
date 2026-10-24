/** Strict ZIP32 reader for PPTX contract tests and release smoke; never extracts to disk. */
import { inflateRawSync } from "node:zlib";
import { attribute, childElements, descendants, parseXml } from "../xml";

export function readPptx(bytes: Uint8Array): Map<string, Uint8Array> {
  const b = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (i: number) => b.getUint16(i, true);
  const u32 = (i: number) => b.getUint32(i, true);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const end = bytes.length - 22;
  if (end < 0 || u32(end) !== 0x06054b50 || u16(end + 20) !== 0 || u32(end + 4) !== 0)
    throw new Error("Not a single-disk ZIP32");
  const count = u16(end + 10);
  if (u16(end + 8) !== count || u32(end + 16) + u32(end + 12) !== end)
    throw new Error("Invalid ZIP directory");
  let at = u32(end + 16);
  const result = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i++) {
    if (u32(at) !== 0x02014b50 || u16(at + 8) !== 0x800 || u16(at + 30) !== 0 || u16(at + 32) !== 0)
      throw new Error("Unsupported ZIP entry");
    const method = u16(at + 10);
    const crc = u32(at + 16);
    const size = u32(at + 20);
    const rawSize = u32(at + 24);
    const nameLength = u16(at + 28);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    const local = u32(at + 42);
    if (
      result.has(name) ||
      u32(local) !== 0x04034b50 ||
      u16(local + 6) !== 0x800 ||
      u16(local + 8) !== method ||
      u32(local + 14) !== crc ||
      u32(local + 18) !== size ||
      u32(local + 22) !== rawSize ||
      u16(local + 26) !== nameLength ||
      u16(local + 28) !== 0 ||
      decoder.decode(bytes.subarray(local + 30, local + 30 + nameLength)) !== name
    )
      throw new Error("ZIP local/central mismatch");
    if (u16(local + 10) !== 0 || u16(local + 12) !== 33) throw new Error("ZIP clock is not fixed");
    const start = local + 30 + nameLength;
    const data = bytes.subarray(start, start + size);
    const raw =
      method === 0 ? data : method === 8 ? new Uint8Array(inflateRawSync(data)) : undefined;
    if (!raw || raw.length !== rawSize || Bun.hash.crc32(new Uint8Array(raw)) !== crc)
      throw new Error("ZIP CRC/size mismatch");
    result.set(name, raw);
    at += 46 + nameLength;
  }
  if (at !== end) throw new Error("ZIP directory length mismatch");
  return result;
}

/** Independent relationships/XML/picture/media/size checks of an exported package. */
export function inspectPptx(bytes: Uint8Array) {
  const parts = readPptx(bytes);
  const xml = (name: string) => {
    const part = parts.get(name);
    if (!part) throw new Error(`Missing part ${name}`);
    const parsed = parseXml(new TextDecoder("utf-8", { fatal: true }).decode(part));
    if (!parsed.ok) throw new Error(`${name}: ${parsed.message}`);
    return parsed.root;
  };
  for (const name of parts.keys()) if (name.endsWith(".xml") || name.endsWith(".rels")) xml(name);
  // Every relationship must be internal and resolve to an actual package part.
  for (const name of parts.keys())
    if (name.endsWith(".rels")) {
      const ids = new Set<string>();
      const ownerDir = name === "_rels/.rels" ? "" : name.slice(0, name.lastIndexOf("/_rels/"));
      for (const rel of childElements(xml(name))) {
        const id = attribute(rel, "Id");
        const target = attribute(rel, "Target");
        if (!id || ids.has(id) || !target || attribute(rel, "TargetMode"))
          throw new Error("Invalid/external relationship");
        ids.add(id);
        const path: string[] = [];
        for (const segment of `${ownerDir}/${target}`.split("/")) {
          if (segment === "..") {
            if (!path.pop()) throw new Error("Relationship escapes package");
          } else if (segment && segment !== ".") path.push(segment);
        }
        if (!parts.has(path.join("/"))) throw new Error(`Unresolved relationship ${target}`);
      }
    }
  const slide = xml("ppt/slides/slide1.xml");
  const all = [...descendants(slide)];
  if (
    all.filter((e) => e.name === "p:pic").length !== 1 ||
    all.some((e) => ["p:sp", "p:cxnSp", "p:txBody"].includes(e.name))
  )
    throw new Error("Not a single-picture slide");
  const blip = all.find((e) => e.name === "a:blip");
  const svgBlip = all.find((e) => e.name === "asvg:svgBlip");
  if (
    !blip ||
    attribute(blip, "r:embed") !== "rId2" ||
    !svgBlip ||
    attribute(svgBlip, "r:embed") !== "rId3"
  )
    throw new Error("Missing SVG/PNG blips");
  const presentation = xml("ppt/presentation.xml");
  const size = [...descendants(presentation)].find((e) => e.name === "p:sldSz");
  const cx = Number(size && attribute(size, "cx"));
  const cy = Number(size && attribute(size, "cy"));
  if (![cx, cy].every((n) => Number.isInteger(n) && n >= 914400 && n <= 51206400))
    throw new Error("Invalid slide size");
  const png = parts.get("ppt/media/figure.png");
  const svg = parts.get("ppt/media/figure.svg");
  if (!png || !svg || Buffer.from(png.subarray(0, 8)).toString("hex") !== "89504e470d0a1a0a")
    throw new Error("Missing image media");
  const outlined = new TextDecoder().decode(svg);
  if (!parseXml(outlined).ok || /<(?:text|tspan)\b|@font-face/.test(outlined))
    throw new Error("SVG has live text/fonts");
  const header = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const pngWidth = header.getUint32(16);
  const pngHeight = header.getUint32(20);
  if (
    pngWidth < 1 ||
    pngHeight < 1 ||
    pngWidth > 8192 ||
    pngHeight > 8192 ||
    pngWidth * pngHeight > 16_100_000
  )
    throw new Error("PNG dimensions exceed budget");
  return { parts, widthPt: cx / 12700, heightPt: cy / 12700, pngWidth, pngHeight };
}
