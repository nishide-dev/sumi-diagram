/** Reproducible Fluent Emoji Flat archive; no runtime dependency or network. */
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { importSvg } from "../src/assets/svg-import";

const version = "1.2.6";
const license = new Uint8Array(
  await (
    await fetch(
      "https://raw.githubusercontent.com/microsoft/fluentui-emoji/1ffb34c752ecf5d402f04cfb4b392c77f57c54bc/LICENSE",
    )
  ).arrayBuffer(),
);
const licenseHash = "c2cfccb812fe482101a8f04597dfc5a9991a6b2748266c47ac91b6a5aae15383";
for (const text of [license, await Bun.file("assets/icons/fluent-emoji-LICENSE.txt").bytes()]) {
  if (new Bun.CryptoHasher("sha256").update(text).digest("hex") !== licenseHash)
    throw new Error("Fluent Emoji MIT license mismatch");
}
const response = await fetch(
  `https://registry.npmjs.org/@iconify-json/fluent-emoji-flat/-/fluent-emoji-flat-${version}.tgz`,
);
if (!response.ok) throw new Error(`npm: ${response.status}`);
const bytes = new Uint8Array(await response.arrayBuffer());
const integrity = new Bun.CryptoHasher("sha512").update(bytes).digest("base64");
if (
  integrity !==
  "RY47RgPb47fYUiyrA64sIOL0+UU02s29sXpNBbIQRBUlPlfNFTKUmZDERGuxDs/7yNGWqQYvuaSYM1M4fRXlUw=="
)
  throw new Error("npm integrity mismatch");
// Keep temporary files inside the checkout, including when called by CI.
await mkdir(".sumi", { recursive: true });
const temp = await mkdtemp(".sumi/emoji-");
try {
  await Bun.write(join(temp, "package.tgz"), bytes);
  const proc = Bun.spawn(["tar", "-xzf", join(temp, "package.tgz"), "-C", temp]);
  if ((await proc.exited) !== 0) throw new Error("tar failed");
  const data = JSON.parse(await readFile(join(temp, "package/icons.json"), "utf8")) as {
    width: number;
    height: number;
    icons: Record<string, { body: string; width?: number; height?: number }>;
  };
  const icons = Object.fromEntries(
    Object.entries(data.icons)
      .sort(([a], [b]) => a.localeCompare(b, "en"))
      .map(([name, icon]) => [
        name,
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${icon.width ?? data.width} ${icon.height ?? data.height}">${icon.body}</svg>`,
      ]),
  );
  const selected: Record<string, string> = {};
  const excluded: Record<string, string> = {};
  for (const name of Object.keys(icons).sort()) {
    const svg = icons[name] as string;
    const result = importSvg(svg, { dropInvisible: true });
    if (result.ok) selected[name] = svg;
    else {
      // Retain the reason, not unsupported artwork. Local SVG references need
      // a scoped resource resolver and cannot safely be dropped or flattened.
      excluded[name] = [...new Set(result.issues.map((issue) => issue.message))].join(" ");
    }
  }
  const json = JSON.stringify({ format: 1, icons: selected, excluded });
  const archive = Bun.gzipSync(json, { level: 9 });
  const path = "assets/icons/fluent-emoji-flat.json.gz";
  const sourcePath = "src/assets/icons.ts";
  const source = await Bun.file(sourcePath).text();
  const hash = (data: Uint8Array) => new Bun.CryptoHasher("sha256").update(data).digest("hex");
  const hashPattern = /(export const EMOJI_ARCHIVE_SHA256 =\s*")([0-9a-f]{64})(";)/;
  const countPattern = /(export const EMOJI_COUNT = )(\d+)(;)/;
  if (!hashPattern.test(source) || !countPattern.test(source))
    throw new Error("emoji archive metadata is missing");
  if (process.argv.includes("--check")) {
    // Compare the decompressed JSON: gzip bytes differ between zlib builds
    // (macOS and Linux), while the content Sumi reads is what must match.
    const committedBytes = await Bun.file(path).bytes();
    const committed = new TextDecoder().decode(Bun.gunzipSync(committedBytes));
    if (committed !== json) throw new Error("emoji archive is stale");
    if (hashPattern.exec(source)?.[2] !== hash(committedBytes))
      throw new Error("EMOJI_ARCHIVE_SHA256 is stale");
    if (Number(countPattern.exec(source)?.[2]) !== Object.keys(selected).length)
      throw new Error("EMOJI_COUNT is stale");
  } else {
    await Bun.write(path, archive);
    await Bun.write(
      sourcePath,
      source
        .replace(hashPattern, `$1${hash(archive)}$3`)
        .replace(countPattern, `$1${Object.keys(selected).length}$3`),
    );
  }
  console.log(
    JSON.stringify({
      upstreamCount: Object.keys(icons).length,
      count: Object.keys(selected).length,
      excludedCount: Object.keys(excluded).length,
      npmTarballBytes: bytes.length,
      fullArchiveBytes: Bun.gzipSync(JSON.stringify({ format: 1, icons }), { level: 9 }).length,
      archiveBytes: archive.length,
      sha256: new Bun.CryptoHasher("sha256").update(archive).digest("hex"),
    }),
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
