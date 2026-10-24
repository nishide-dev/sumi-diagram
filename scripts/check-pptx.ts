/** Generates the PPTX compatibility corpus and alternate-PNG controls (#61). */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { deflateSync } from "node:zlib";
import { DEFAULT_FONT_SET_ID, getFontSet } from "../src/core/theme/fonts";
import { readSvgMetadata } from "../src/render/finalize";
import { picturePptx } from "../src/render/pptx/package";
import { svgToPptx } from "../src/render/pptx/pptx";
import { inspectPptx } from "../src/render/pptx/testing";

const out = resolve(".sumi/pptx");
mkdirSync(out, { recursive: true });
const fonts = getFontSet(DEFAULT_FONT_SET_ID);
if (!fonts) throw new Error("Missing fonts");
// A valid 1px magenta PNG makes an app's PNG-vs-SVG choice unambiguous.
function sentinel(): Uint8Array {
  const chunk = (type: string, data: Buffer) => {
    const kind = Buffer.from(type);
    const b = Buffer.alloc(data.length + 12);
    b.writeUInt32BE(data.length, 0);
    kind.copy(b, 4);
    data.copy(b, 8);
    b.writeUInt32BE(Bun.hash.crc32(new Uint8Array(Buffer.concat([kind, data]))), b.length - 4);
    return b;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.from([0, 255, 0, 255, 255]))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const paths = [
  ...new Bun.Glob("examples/*/*.svg").scanSync("."),
  ...new Bun.Glob("docs/gallery/components/*.svg").scanSync("."),
  "tests/fixtures/pdf/japanese-mask.svg",
].sort();
const report = [];
for (const [i, path] of paths.entries()) {
  const svg = readFileSync(path, "utf8");
  const result = svgToPptx(svg, { fontSet: fonts });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const inspected = inspectPptx(result.value);
  const stem = `${out}/${i}-${basename(path, ".svg")}`;
  const metadata = readSvgMetadata(svg);
  if (!metadata.ok) throw new Error("Invalid metadata");
  const width = Number(/<svg[^>]* width="([\d.]+)pt"/.exec(svg)?.[1]);
  const height = Number(/<svg[^>]* height="([\d.]+)pt"/.exec(svg)?.[1]);
  const outlined = inspected.parts.get("ppt/media/figure.svg");
  const png = inspected.parts.get("ppt/media/figure.png");
  if (!outlined || !png) throw new Error("Missing media");
  writeFileSync(`${stem}.pptx`, result.value);
  writeFileSync(`${stem}.svg`, outlined);
  writeFileSync(`${stem}.png`, png);
  writeFileSync(
    `${stem}.control.pptx`,
    picturePptx(new TextDecoder().decode(outlined), sentinel(), width, height, metadata.value),
  );
  report.push({
    source: path,
    pptx: `${basename(stem)}.pptx`,
    control: `${basename(stem)}.control.pptx`,
    sha256: new Bun.CryptoHasher("sha256").update(result.value).digest("hex"),
    widthPt: inspected.widthPt,
    heightPt: inspected.heightPt,
    pngWidth: inspected.pngWidth,
    pngHeight: inspected.pngHeight,
  });
}
writeFileSync(`${out}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(
  `Generated and structurally checked ${report.length} PPTX + alternate-PNG controls in ${out}`,
);
