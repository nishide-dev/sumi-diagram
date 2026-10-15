/**
 * Shared pieces of the release build (`scripts/build-release.ts`) and smoke
 * test (`scripts/smoke-release.ts`): targets, argument parsing, archive names,
 * checksums and a deterministic tar.gz writer (design doc §6.8, #20).
 */

import { valid } from "semver";
import type { D2Platform } from "../../src/backends/d2/version";

/** Release targets, as `<process.platform>-<process.arch>`. Windows is deferred. */
export const RELEASE_TARGETS = [
  "darwin-arm64",
  "darwin-x64",
  "linux-x64",
  "linux-arm64",
] as const satisfies readonly D2Platform[];

export type ReleaseTarget = (typeof RELEASE_TARGETS)[number];

export function isReleaseTarget(value: string): value is ReleaseTarget {
  return (RELEASE_TARGETS as readonly string[]).includes(value);
}

/**
 * The `bun build --compile --target` for a release target. x64 uses Bun's
 * `baseline` build (no AVX2 requirement) so the binary runs on older CPUs.
 */
export function bunCompileTarget(target: ReleaseTarget): string {
  return target.endsWith("-x64") ? `bun-${target}-baseline` : `bun-${target}`;
}

/** The target of the running machine, or `undefined` if Sumi does not release for it. */
export function hostTarget(
  platform: string = process.platform,
  arch: string = process.arch,
): ReleaseTarget | undefined {
  const target = `${platform}-${arch}`;
  return isReleaseTarget(target) ? target : undefined;
}

/** Top-level directory inside the tarball, and the tarball's name without `.tar.gz`. */
export function archiveBaseName(version: string, target: ReleaseTarget): string {
  return `sumi-${version}-${target}`;
}

export class UsageError extends Error {}

export interface BuildArgs {
  target: ReleaseTarget;
  /** Release version without the leading `v` (e.g. `0.1.0`). */
  version: string;
  /** Output directory for the tarball and checksums. */
  outdir: string;
}

export const BUILD_USAGE = `Usage: bun run release:build --target <target> [--version <version>] [--outdir <dir>]

Builds dist/release/sumi-<version>-<target>.tar.gz: the compiled sumi binary,
the pinned D2 binary, the bundled fonts, licenses and checksums.

  --target   ${RELEASE_TARGETS.join(" | ")}
  --version  release version without "v"; must equal package.json's version
             (default: package.json's version)
  --outdir   output directory (default: dist/release)`;

/**
 * Parses the build script's arguments. The version is compiled into the
 * binary from package.json, so `--version` (e.g. from the tag) must match it.
 * Throws {@link UsageError} on invalid input.
 */
export function parseBuildArgs(argv: readonly string[], packageVersion: string): BuildArgs {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    const [flag, inline] = arg.includes("=") ? arg.split(/=(.*)/s, 2) : [arg, undefined];
    if (!["--target", "--version", "--outdir"].includes(flag as string)) {
      throw new UsageError(`Unknown argument "${arg}".`);
    }
    const value = inline ?? argv[++i];
    if (value === undefined || value === "" || value.startsWith("--")) {
      throw new UsageError(`${flag} needs a value.`);
    }
    if (values.has(flag as string)) throw new UsageError(`${flag} was given more than once.`);
    values.set(flag as string, value);
  }

  const target = values.get("--target");
  if (target === undefined) throw new UsageError("--target is required.");
  if (!isReleaseTarget(target)) {
    throw new UsageError(
      `Unsupported target "${target}"; expected one of ${RELEASE_TARGETS.join(", ")}.`,
    );
  }

  const version = (values.get("--version") ?? packageVersion).replace(/^v/, "");
  if (valid(version) !== version) {
    throw new UsageError(`Version "${version}" is not a semantic version (e.g. 0.1.0).`);
  }
  if (version !== packageVersion) {
    throw new UsageError(
      `Version ${version} does not match package.json (${packageVersion}); bump package.json first, since the binary reports package.json's version.`,
    );
  }

  return { target, version, outdir: values.get("--outdir") ?? "dist/release" };
}

export function sha256Hex(data: Uint8Array | string): string {
  return new Bun.CryptoHasher("sha256").update(data).digest("hex");
}

/** `sha256sum`-compatible lines (`<hex>  <name>`), sorted by name. */
export function formatSha256Sums(entries: Iterable<{ name: string; sha256: string }>): string {
  return [...entries]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((e) => `${e.sha256}  ${e.name}\n`)
    .join("");
}

/** Parses `sha256sum` output into name → hex. Throws on a malformed line. */
export function parseSha256Sums(text: string): Map<string, string> {
  const sums = new Map<string, string>();
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    const match = /^([0-9a-f]{64}) [ *](.+)$/.exec(line);
    if (match === null) throw new Error(`Malformed checksum line: ${JSON.stringify(line)}`);
    sums.set(match[2] as string, match[1] as string);
  }
  return sums;
}

export interface TarEntry {
  /** Path inside the archive, `/`-separated, without a trailing slash. */
  path: string;
  type: "file" | "directory";
  /** Permission bits, e.g. `0o755`. */
  mode: number;
  /** File contents (files only). */
  data?: Uint8Array;
}

const BLOCK = 512;
const encoder = new TextEncoder();

function writeString(header: Uint8Array, offset: number, length: number, value: string): void {
  const bytes = encoder.encode(value);
  if (bytes.length > length) throw new Error(`Tar header field too long: ${value}`);
  header.set(bytes, offset);
}

function writeOctal(header: Uint8Array, offset: number, length: number, value: number): void {
  const digits = value.toString(8);
  if (digits.length > length - 1) throw new Error(`Tar header number too large: ${value}`);
  writeString(header, offset, length, `${digits.padStart(length - 1, "0")}\0`);
}

/** Splits a path into ustar `prefix` (≤155 bytes) and `name` (≤100 bytes). */
function splitUstarPath(path: string): [prefix: string, name: string] {
  if (encoder.encode(path).length <= 100) return ["", path];
  for (let i = path.indexOf("/"); i !== -1; i = path.indexOf("/", i + 1)) {
    const prefix = path.slice(0, i);
    const name = path.slice(i + 1);
    if (encoder.encode(prefix).length <= 155 && encoder.encode(name).length <= 100) {
      return [prefix, name];
    }
  }
  throw new Error(`Path too long for a ustar archive: ${path}`);
}

function ustarHeader(entry: TarEntry, mtime: number): Uint8Array {
  const header = new Uint8Array(BLOCK);
  const path = entry.type === "directory" ? `${entry.path}/` : entry.path;
  const [prefix, name] = splitUstarPath(path);
  writeString(header, 0, 100, name);
  writeOctal(header, 100, 8, entry.mode);
  writeOctal(header, 108, 8, 0); // uid
  writeOctal(header, 116, 8, 0); // gid
  writeOctal(header, 124, 12, entry.type === "file" ? (entry.data?.length ?? 0) : 0);
  writeOctal(header, 136, 12, mtime);
  header.fill(0x20, 148, 156); // checksum placeholder: spaces
  writeString(header, 156, 1, entry.type === "file" ? "0" : "5");
  writeString(header, 257, 6, "ustar\0");
  writeString(header, 263, 2, "00");
  writeString(header, 345, 155, prefix);
  let checksum = 0;
  for (const byte of header) checksum += byte;
  writeString(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
  return header;
}

/**
 * A deterministic ustar archive: entries sorted by path, uid/gid 0, no owner
 * names, and one fixed mtime, so the same inputs give the same bytes on every
 * platform (unlike system `tar`, whose flags for this differ between GNU tar
 * and bsdtar).
 */
export function createTar(entries: readonly TarEntry[], mtime: number): Uint8Array {
  const sorted = [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (const entry of sorted) {
    const header = ustarHeader(entry, mtime);
    chunks.push(header);
    size += BLOCK;
    if (entry.type === "file" && entry.data !== undefined && entry.data.length > 0) {
      const padded = Math.ceil(entry.data.length / BLOCK) * BLOCK;
      chunks.push(entry.data);
      if (padded > entry.data.length) chunks.push(new Uint8Array(padded - entry.data.length));
      size += padded;
    }
  }
  chunks.push(new Uint8Array(2 * BLOCK)); // end-of-archive marker
  size += 2 * BLOCK;

  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * gzip with a fixed header (mtime 0, OS byte "Unix"), so the output depends
 * only on the input and the zlib version.
 */
export function gzipDeterministic(data: Uint8Array): Uint8Array {
  const gz = Bun.gzipSync(data as Uint8Array<ArrayBuffer>, { level: 9 });
  gz.set([0, 0, 0, 0], 4); // MTIME
  gz[9] = 3; // OS: Unix
  return gz;
}
