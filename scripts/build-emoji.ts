/** Reproducible Fluent Emoji Flat archive; no runtime dependency or network. */
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";

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
  const selected = { fire: icons.fire, snowflake: icons.snowflake };
  const archive = Bun.gzipSync(JSON.stringify({ format: 1, icons: selected }), { level: 9 });
  const path = "assets/icons/fluent-emoji-flat.json.gz";
  if (process.argv.includes("--check")) {
    if (!Buffer.from(archive).equals(Buffer.from(await Bun.file(path).arrayBuffer())))
      throw new Error("emoji archive is stale");
  } else await Bun.write(path, archive);
  console.log(
    JSON.stringify({
      upstreamCount: Object.keys(icons).length,
      count: Object.keys(selected).length,
      npmTarballBytes: bytes.length,
      fullArchiveBytes: Bun.gzipSync(JSON.stringify({ format: 1, icons }), { level: 9 }).length,
      archiveBytes: archive.length,
      sha256: new Bun.CryptoHasher("sha256").update(archive).digest("hex"),
    }),
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
