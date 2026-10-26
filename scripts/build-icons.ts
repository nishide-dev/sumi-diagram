/**
 * Builds the bundled icon archive (`bun run icons:build [--check]`; #94,
 * design doc §6.25) from the pinned npm package of Tabler Icons:
 *
 * 1. Downloads `@tabler/icons@<TABLER_VERSION>` from the npm registry (cached
 *    in `.sumi/cache/`) and verifies its sha512 integrity.
 * 2. Takes every outline icon except the ones in Tabler's own Brand category
 *    (logos are trademarks; research #86 §6.4). The category comes from the
 *    package's `icons.json` and must agree with `categories/outline/Brand/`.
 * 3. Checks every icon through the same allow-list importer that renders it
 *    (`importSvg()`), so the archive holds no icon Sumi would refuse.
 * 4. Writes `assets/icons/tabler-outline.json.gz` (the original SVG bytes of
 *    each icon, by name, sorted) and the package's LICENSE next to it, and
 *    the archive's sha256 into `src/assets/icons.ts` (`TABLER_ARCHIVE_SHA256`).
 *
 * `--check` rebuilds in memory and fails if the committed archive's content
 * (decompressed), its sha256 constant or the LICENSE differ. The gzip bytes
 * themselves are not compared (zlib versions may differ); the runtime checks
 * the committed bytes against the constant.
 */

import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { TABLER_VERSION } from "../src/assets/icons";
import { importSvg } from "../src/assets/svg-import";
import { runCommand } from "../src/core/subprocess";
import { sha256Hex } from "./release/lib";

const ROOT = resolve(import.meta.dir, "..");
const ICONS_TS = join(ROOT, "src", "assets", "icons.ts");
const OUT_DIR = join(ROOT, "assets", "icons");
const ARCHIVE = join(OUT_DIR, "tabler-outline.json.gz");
const LICENSE = join(OUT_DIR, "tabler-LICENSE.txt");
const CACHE = join(ROOT, ".sumi", "cache");

/** The pinned package: the version (`TABLER_VERSION`) and the registry's sha512 integrity. */
const TARBALL = `https://registry.npmjs.org/@tabler/icons/-/icons-${TABLER_VERSION}.tgz`;
const INTEGRITY =
  "sha512-l+GnSkFETx0U26icxv1VUFnxxiTqXfCcVRiRAnyMwibupM2S2L/hSaZ9gmSgz01rkrsH/93NvLsxykqdanc6lw==";

const log = (message: string) => console.error(message);

async function tarball(): Promise<Uint8Array> {
  const cached = join(CACHE, `tabler-icons-${TABLER_VERSION}.tgz`);
  const verify = (bytes: Uint8Array) =>
    `sha512-${new Bun.CryptoHasher("sha512").update(bytes).digest("base64")}` === INTEGRITY;
  if (existsSync(cached)) {
    const bytes = new Uint8Array(await readFile(cached));
    if (verify(bytes)) return bytes;
  }
  log(`Downloading ${TARBALL}`);
  const response = await fetch(TARBALL);
  if (!response.ok) throw new Error(`${TARBALL}: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!verify(bytes))
    throw new Error(`${TARBALL} does not match the pinned integrity ${INTEGRITY}`);
  await mkdir(CACHE, { recursive: true });
  await writeFile(cached, bytes);
  return bytes;
}

interface Built {
  json: string;
  license: string;
  count: number;
}

async function build(): Promise<Built> {
  const work = await mkdtemp(join(tmpdir(), "sumi-icons-"));
  try {
    const archive = join(work, "package.tgz");
    await writeFile(archive, await tarball());
    const result = await runCommand(["tar", "-xzf", archive, "-C", work], {
      cwd: work,
      timeoutMs: 120_000,
    });
    if (result.exitCode !== 0) throw new Error(`tar failed: ${result.stderr}`);
    const pkg = join(work, "package");
    const meta = JSON.parse(await readFile(join(pkg, "icons.json"), "utf8")) as Record<
      string,
      { category?: string; styles?: { outline?: unknown } }
    >;
    const brand = new Set(
      Object.entries(meta)
        .filter(([, icon]) => icon.category === "Brand")
        .map(([name]) => name),
    );
    const brandDir = new Set(
      (await readdir(join(pkg, "categories", "outline", "Brand"))).map((f) =>
        f.replace(/\.svg$/, ""),
      ),
    );
    if (brand.size === 0 || [...brandDir].some((name) => !brand.has(name))) {
      throw new Error("icons.json and categories/outline/Brand/ disagree on the Brand icons.");
    }
    const files = (await readdir(join(pkg, "icons", "outline")))
      .filter((f) => f.endsWith(".svg"))
      .sort();
    const icons: Record<string, string> = {};
    for (const file of files) {
      const name = file.slice(0, -4);
      if (brand.has(name)) continue;
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) throw new Error(`Unexpected icon name ${name}`);
      const svg = await readFile(join(pkg, "icons", "outline", file), "utf8");
      const imported = importSvg(svg);
      if (!imported.ok) {
        throw new Error(
          `${file} does not pass the importer: ${imported.issues.map((i) => i.message).join("; ")}`,
        );
      }
      icons[name] = svg;
    }
    const count = Object.keys(icons).length;
    const json = JSON.stringify({
      format: 1,
      set: "tabler",
      package: `@tabler/icons@${TABLER_VERSION}`,
      style: "outline",
      excluded: "Brand",
      icons,
    });
    const license = await readFile(join(pkg, "LICENSE"), "utf8");
    return { json, license, count };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

const check = Bun.argv.includes("--check");
const built = await build();
log(`Tabler Icons ${TABLER_VERSION}: ${built.count} outline icons (Brand excluded)`);
const source = await readFile(ICONS_TS, "utf8");
const pattern = /(export const TABLER_ARCHIVE_SHA256 =\s*")([0-9a-f]{64})(";)/;
const recorded = pattern.exec(source)?.[2];
if (check) {
  const problems: string[] = [];
  const committed = new Uint8Array(await readFile(ARCHIVE));
  if (new TextDecoder().decode(Bun.gunzipSync(committed)) !== built.json) {
    problems.push(`${ARCHIVE} differs from the pinned package`);
  }
  if (sha256Hex(committed) !== recorded) problems.push("TABLER_ARCHIVE_SHA256 is stale");
  if ((await readFile(LICENSE, "utf8")) !== built.license) problems.push(`${LICENSE} differs`);
  if (problems.length > 0) {
    console.error(`${problems.join("\n")}\nRun \`bun run icons:build\`.`);
    process.exit(1);
  }
  log("The icon archive is up to date.");
} else {
  const gz = Bun.gzipSync(new TextEncoder().encode(built.json), { level: 9 });
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(ARCHIVE, gz);
  await writeFile(LICENSE, built.license);
  if (recorded === undefined) throw new Error(`${ICONS_TS} has no TABLER_ARCHIVE_SHA256`);
  await writeFile(ICONS_TS, source.replace(pattern, `$1${sha256Hex(gz)}$3`));
  log(`Wrote ${ARCHIVE} (${gz.length} bytes, sha256 ${sha256Hex(gz)})`);
}
