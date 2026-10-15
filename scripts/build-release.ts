/**
 * Builds a release tarball (`bun run release:build --target <t> [--version <v>]`;
 * design doc §6.8, #20):
 *
 * ```
 * sumi-<version>-<target>/
 *   bin/sumi                   compiled with `bun build --compile`
 *   libexec/sumi/d2            pinned D2 CLI (MPL-2.0), checksum-verified
 *   share/sumi/fonts/<set>/    bundled fonts (OFL-1.1), checksum-verified
 *   licenses/                  D2's LICENSE / THIRD_PARTY_NOTICES, the fonts' OFL
 *   LICENSE                    Sumi's license (MIT)
 *   NOTICE  README.md  VERSION
 *   SHA256SUMS                 sha256 of every other file in the tree
 * ```
 *
 * Writes `<outdir>/sumi-<version>-<target>.tar.gz`, its `.sha256`, and
 * `<outdir>/SHA256SUMS` over all tarballs in `<outdir>`. The archive itself is
 * deterministic (sorted entries, fixed owner and mtime from SOURCE_DATE_EPOCH
 * or the last commit); the compiled binary is whatever Bun produces.
 *
 * When the target is the host platform, the staged binaries are run as a
 * quick check; the full check is `bun run release:smoke <tarball>`.
 */

import { existsSync } from "node:fs";
import { chmod, copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import pkg from "../package.json";
import { downloadD2Release } from "../src/backends/d2/install";
import { D2_RELEASE_ASSETS, D2_TARBALL_BINARY, D2_VERSION } from "../src/backends/d2/version";
import { RELEASE_LAYOUT } from "../src/core/install-layout";
import { type CommandArgv, runCommand } from "../src/core/subprocess";
import { BUNDLED_FONT_SHA256, FONT_ASSETS_DIR } from "../src/core/theme/fonts";
import {
  archiveBaseName,
  BUILD_USAGE,
  bunCompileTarget,
  createTar,
  formatSha256Sums,
  gzipDeterministic,
  hostTarget,
  parseBuildArgs,
  sha256Hex,
  type TarEntry,
  UsageError,
} from "./release/lib";

const ROOT = resolve(import.meta.dir, "..");
const D2_CACHE_DIR = join(ROOT, ".sumi", "cache");
const D2_SOURCE_URL = `https://github.com/terrastruct/d2/tree/v${D2_VERSION}`;

const log = (message: string) => console.error(message);

async function run(argv: CommandArgv, cwd = ROOT): Promise<string> {
  const result = await runCommand(argv, { cwd, timeoutMs: 600_000 });
  if (result.exitCode !== 0) {
    throw new Error(
      `${argv.join(" ")} exited with ${result.exitCode ?? result.signal}:\n${result.stderr}${result.stdout}`,
    );
  }
  return result.stdout;
}

/** The D2 release tarball for a target, from `.sumi/cache` or downloaded (always sha256-verified). */
async function d2Tarball(target: keyof typeof D2_RELEASE_ASSETS): Promise<string> {
  const asset = D2_RELEASE_ASSETS[target];
  const cached = join(D2_CACHE_DIR, asset.name);
  if (existsSync(cached) && sha256Hex(await readFile(cached)) === asset.sha256) {
    log(`Using cached ${asset.name} (sha256 verified)`);
    return cached;
  }
  const bytes = await downloadD2Release(asset, { log });
  await mkdir(D2_CACHE_DIR, { recursive: true });
  await Bun.write(cached, bytes);
  return cached;
}

/** Seconds since the epoch for every archive entry: SOURCE_DATE_EPOCH, else the last commit. */
async function archiveMtime(): Promise<number> {
  const fromEnv = process.env.SOURCE_DATE_EPOCH;
  if (fromEnv !== undefined && /^\d+$/.test(fromEnv)) return Number(fromEnv);
  try {
    return Number((await run(["git", "log", "-1", "--format=%ct"])).trim()) || 0;
  } catch {
    return 0;
  }
}

async function listFiles(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(path, base)));
    else if (entry.isFile()) out.push(relative(base, path).split("\\").join("/"));
    else throw new Error(`Unexpected non-regular file in the staging tree: ${path}`);
  }
  return out;
}

function notice(version: string, target: string): string {
  return `Sumi ${version} (${target})
https://github.com/nishide-dev/sumi-diagram

This distribution contains the following components.

1. Sumi (bin/sumi)
   License: MIT License, see LICENSE.
   bin/sumi is a single-file executable built with Bun (https://bun.sh, MIT License)
   and includes Sumi's npm dependencies: commander (MIT), semver (ISC),
   yaml (ISC), zod (MIT).

2. D2 ${D2_VERSION} (libexec/sumi/d2)
   License: Mozilla Public License 2.0, see licenses/d2/LICENSE.txt and
   licenses/d2/THIRD_PARTY_NOTICES.txt.
   Unmodified binary from the official release
   https://github.com/terrastruct/d2/releases/tag/v${D2_VERSION}
   Source code: ${D2_SOURCE_URL}

3. BIZ UDPGothic / BIZ UDGothic 1.051 (share/sumi/fonts/biz-ud-gothic)
   Copyright 2022 The BIZ UDGothic Project Authors.
   License: SIL Open Font License 1.1, see licenses/biz-ud-gothic/OFL.txt.
   Unmodified fonts from https://github.com/googlefonts/morisawa-biz-ud-gothic/releases/tag/v1.051
`;
}

async function build(argv: string[]): Promise<void> {
  const args = parseBuildArgs(argv, pkg.version);
  const { target, version } = args;
  const outdir = resolve(ROOT, args.outdir);
  const name = archiveBaseName(version, target);
  const work = await mkdtemp(join(tmpdir(), "sumi-release-"));
  const stage = join(work, name);
  const at = (path: string) => join(stage, path);

  try {
    // 1. Sumi itself.
    log(`Compiling bin/sumi for ${bunCompileTarget(target)}`);
    await mkdir(at("bin"), { recursive: true });
    await run([
      process.execPath,
      "build",
      join(ROOT, "src", "cli", "index.ts"),
      "--compile",
      `--target=${bunCompileTarget(target)}`,
      // A CLI must not pick up the user's .env or bunfig.toml from the cwd.
      "--no-compile-autoload-dotenv",
      "--no-compile-autoload-bunfig",
      "--outfile",
      at(RELEASE_LAYOUT.sumi),
    ]);

    // 2. D2 and its license files, from the checksum-verified release tarball.
    const d2Archive = await d2Tarball(target);
    const d2Root = dirname(dirname(D2_TARBALL_BINARY)); // d2-v<version>
    const d2Files = [
      D2_TARBALL_BINARY,
      `${d2Root}/LICENSE.txt`,
      `${d2Root}/THIRD_PARTY_NOTICES.txt`,
    ];
    await run(["tar", "-xzf", d2Archive, "-C", work, ...d2Files]);
    await mkdir(dirname(at(RELEASE_LAYOUT.d2)), { recursive: true });
    await mkdir(at("licenses/d2"), { recursive: true });
    await copyFile(join(work, D2_TARBALL_BINARY), at(RELEASE_LAYOUT.d2));
    await copyFile(join(work, d2Root, "LICENSE.txt"), at("licenses/d2/LICENSE.txt"));
    await copyFile(
      join(work, d2Root, "THIRD_PARTY_NOTICES.txt"),
      at("licenses/d2/THIRD_PARTY_NOTICES.txt"),
    );

    // 3. Fonts, verified against the recorded checksums.
    for (const file of await listFiles(FONT_ASSETS_DIR)) {
      const source = join(FONT_ASSETS_DIR, file);
      const expected = BUNDLED_FONT_SHA256.get(source);
      if (expected !== undefined && sha256Hex(await readFile(source)) !== expected) {
        throw new Error(`${source} does not match its recorded sha256 ${expected}`);
      }
      const destination = at(join(RELEASE_LAYOUT.fonts, file));
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(source, destination);
    }
    for (const font of BUNDLED_FONT_SHA256.keys()) {
      const staged = at(join(RELEASE_LAYOUT.fonts, relative(FONT_ASSETS_DIR, font)));
      if (!existsSync(staged)) throw new Error(`Bundled font missing from the stage: ${font}`);
    }
    await mkdir(at("licenses/biz-ud-gothic"), { recursive: true });
    await copyFile(
      join(FONT_ASSETS_DIR, "biz-ud-gothic", "OFL.txt"),
      at("licenses/biz-ud-gothic/OFL.txt"),
    );

    // 4. Top-level documents.
    const license = join(ROOT, "LICENSE");
    if (!existsSync(license)) throw new Error(`${license} is missing; a release must ship it.`);
    await copyFile(license, at("LICENSE"));
    await Bun.write(at("NOTICE"), notice(version, target));
    const readme = (await readFile(join(import.meta.dir, "release", "README.dist.md"), "utf8"))
      .replaceAll("{{version}}", version)
      .replaceAll("{{target}}", target)
      .replaceAll("{{d2Version}}", D2_VERSION);
    await Bun.write(at("README.md"), readme);
    await Bun.write(at("VERSION"), `${version}\n`);

    // 5. Permissions and the inner checksum list.
    const executables = new Set<string>([RELEASE_LAYOUT.sumi, RELEASE_LAYOUT.d2]);
    const files = (await listFiles(stage)).sort();
    for (const file of files) await chmod(at(file), executables.has(file) ? 0o755 : 0o644);
    const sums = [];
    for (const file of files)
      sums.push({ name: file, sha256: sha256Hex(await readFile(at(file))) });
    await Bun.write(at("SHA256SUMS"), formatSha256Sums(sums));

    // 6. Quick check on the host platform (the full one is release:smoke).
    if (hostTarget() === target) {
      const reported = (await run([at(RELEASE_LAYOUT.sumi), "--version"], work)).trim();
      if (reported !== version) throw new Error(`bin/sumi --version printed "${reported}"`);
      const d2 = (await run([at(RELEASE_LAYOUT.d2), "--version"], work)).trim();
      if (d2 !== `v${D2_VERSION}`) throw new Error(`libexec/sumi/d2 --version printed "${d2}"`);
      log(`Checked bin/sumi --version (${reported}) and libexec/sumi/d2 --version (${d2})`);
    } else {
      log(
        `Cross build for ${target}: skipping the run check (host is ${hostTarget() ?? "other"}).`,
      );
    }

    // 7. Deterministic archive.
    const mtime = await archiveMtime();
    const entries: TarEntry[] = [];
    const dirs = new Set<string>([name]);
    for (const file of [...files, "SHA256SUMS"]) {
      const parts = file.split("/");
      for (let i = 1; i < parts.length; i++) dirs.add(`${name}/${parts.slice(0, i).join("/")}`);
      entries.push({
        path: `${name}/${file}`,
        type: "file",
        mode: executables.has(file) ? 0o755 : 0o644,
        data: new Uint8Array(await readFile(at(file))),
      });
    }
    for (const dir of dirs) entries.push({ path: dir, type: "directory", mode: 0o755 });
    const archive = gzipDeterministic(createTar(entries, mtime));

    await mkdir(outdir, { recursive: true });
    const archiveName = `${name}.tar.gz`;
    const archivePath = join(outdir, archiveName);
    const archiveSha = sha256Hex(archive);
    await Bun.write(archivePath, archive);
    await Bun.write(
      `${archivePath}.sha256`,
      formatSha256Sums([{ name: archiveName, sha256: archiveSha }]),
    );

    const all = [];
    for (const file of (await readdir(outdir)).filter((f) => f.endsWith(".tar.gz"))) {
      all.push({ name: file, sha256: sha256Hex(await readFile(join(outdir, file))) });
    }
    await Bun.write(join(outdir, "SHA256SUMS"), formatSha256Sums(all));

    const size = (await stat(archivePath)).size;
    log(
      `Wrote ${relative(ROOT, archivePath)} (${(size / 1024 / 1024).toFixed(1)} MiB, sha256 ${archiveSha})`,
    );
    console.log(archivePath);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

const argv = Bun.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  console.log(BUILD_USAGE);
  process.exit(0);
}
try {
  await build(argv);
} catch (error) {
  if (error instanceof UsageError) {
    console.error(`error: ${error.message}\n\n${BUILD_USAGE}`);
    process.exit(2);
  }
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
