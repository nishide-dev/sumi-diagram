/**
 * Self-update and update notices (#597).
 *
 * `sumi update` replaces the running install with another release. It only
 * handles the layout `install.sh` creates:
 *
 * ```
 * <SUMI_HOME>/sumi-<version>-<target>/bin/sumi     the release (the running executable)
 * <SUMI_BIN_DIR>/sumi -> <SUMI_HOME>/sumi-<version>-<target>/bin/sumi
 * ```
 *
 * The new release is downloaded, checked against `SHA256SUMS`, unpacked into
 * a staging directory inside `SUMI_HOME` and run once (`--version`) before
 * anything visible changes. Then its directory is renamed into place and the
 * `sumi` symlink is switched with one `rename()`, so the old release keeps
 * working until the very last step and after any failure. Network access is
 * limited to the GitHub latest-release API and the release assets, with the
 * same `SUMI_LATEST_URL` / `SUMI_DOWNLOAD_BASE` overrides as `install.sh`.
 */

import { realpathSync } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { gt, valid } from "semver";
import type { Diagnostic } from "./diagnostics";
import { RUN_MODE, type RunMode } from "./install-layout";
import { runCommand } from "./subprocess";

export const RELEASE_REPO = "nishide-dev/sumi-diagram";
export const DEFAULT_LATEST_URL = `https://api.github.com/repos/${RELEASE_REPO}/releases/latest`;
export const INSTALL_COMMAND = `curl -fsSL https://raw.githubusercontent.com/${RELEASE_REPO}/main/install.sh | sh`;
export const SKILL_UPDATE_COMMAND = "npx skills update sumi";

/** Environment variables shared with `install.sh`, plus the update-only switches. */
export const ENV = {
  home: "SUMI_HOME",
  binDir: "SUMI_BIN_DIR",
  latestUrl: "SUMI_LATEST_URL",
  downloadBase: "SUMI_DOWNLOAD_BASE",
  noUpdateCheck: "SUMI_NO_UPDATE_CHECK",
} as const;

type Env = Record<string, string | undefined>;
export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;

/** Test-only seams, passed through the CLI context. */
export interface UpdateEnvironment {
  fetch?: FetchLike;
  /** Overrides the run mode (the notice and `update` only apply to compiled installs). */
  mode?: RunMode;
  execPath?: string;
  /** The version of the running CLI. */
  currentVersion?: string;
  now?: () => number;
  /** Called after the new release is in place and before the symlink is switched. */
  beforeSwitch?: () => Promise<void> | void;
  /** Replaces running `<release>/bin/sumi --version`; returns its output. */
  runVersion?: (binary: string) => Promise<string>;
}

/** A failure with a stable diagnostic code; printed by the CLI. */
export class UpdateError extends Error {
  override name = "UpdateError";
  readonly diagnostic: Diagnostic;
  constructor(code: string, message: string, hint?: string) {
    super(message);
    this.diagnostic = {
      code: `update/${code}`,
      severity: "error",
      message,
      ...(hint !== undefined && { hint }),
    };
  }
}

// ---------------------------------------------------------------- versions

/** A release version without a leading `v`, or `undefined` if it is not semver. */
export function normalizeVersion(input: string): string | undefined {
  const bare = input.trim().replace(/^v/, "");
  return valid(bare) ?? undefined;
}

/** `1` if `a` is newer than `b`, `-1` if older, `0` if equal. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  if (a === b) return 0;
  if (gt(a, b)) return 1;
  return gt(b, a) ? -1 : 0;
}

/** The release target for a platform and CPU, the same names as `install.sh`. */
export function platformTarget(
  platform: string = process.platform,
  arch: string = process.arch,
): string | undefined {
  const os = platform === "darwin" || platform === "linux" ? platform : undefined;
  const cpu = arch === "x64" ? "x64" : arch === "arm64" ? "arm64" : undefined;
  return os !== undefined && cpu !== undefined ? `${os}-${cpu}` : undefined;
}

export const archiveName = (version: string, target: string): string => `sumi-${version}-${target}`;

// ---------------------------------------------------------------- network

const DEFAULT_TIMEOUT_MS = 30_000;

/** Reads a URL, an absolute path or a `file://` URL (like `install.sh`'s download). */
async function fetchBytes(
  source: string,
  f: FetchLike,
  timeoutMs: number,
  what: string,
): Promise<Uint8Array> {
  if (source.startsWith("file://") || isAbsolute(source)) {
    const path = source.startsWith("file://") ? decodeURIComponent(source.slice(7)) : source;
    try {
      return new Uint8Array(await readFile(path));
    } catch {
      throw new UpdateError("download-failed", `Could not read ${what}: ${source}`);
    }
  }
  try {
    const response = await f(source, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) {
      throw new UpdateError(
        "download-failed",
        `Could not download ${what} (HTTP ${response.status}): ${source}`,
      );
    }
    return new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    if (error instanceof UpdateError) throw error;
    const reason = error instanceof Error ? error.message : String(error);
    throw new UpdateError("download-failed", `Could not download ${what} (${reason}): ${source}`);
  }
}

/** The version of the latest release (`tag_name` of the latest-release JSON). */
export async function resolveLatestVersion(
  env: Env,
  f: FetchLike = fetch,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<string> {
  const url = env[ENV.latestUrl] ?? DEFAULT_LATEST_URL;
  const bytes = await fetchBytes(url, f, timeoutMs, "the latest release information");
  let tag: unknown;
  try {
    tag = (JSON.parse(new TextDecoder().decode(bytes)) as { tag_name?: unknown }).tag_name;
  } catch {
    // handled below
  }
  const version = typeof tag === "string" ? normalizeVersion(tag) : undefined;
  if (version === undefined) {
    throw new UpdateError(
      "bad-release-info",
      "Could not resolve the latest release tag.",
      "Pass --version <x> explicitly.",
    );
  }
  return version;
}

// ---------------------------------------------------------------- layout

export interface InstallLayout {
  /** `SUMI_HOME`: the directory that holds the version directories. */
  home: string;
  /** The running release: `<home>/sumi-<version>-<target>`. */
  prefix: string;
  version: string;
  target: string;
  /** `<SUMI_BIN_DIR>/sumi` and whether it is a symlink to the running executable. */
  link: string;
  linked: boolean;
}

export type LayoutResult = { ok: true; layout: InstallLayout } | { ok: false; reason: string };

const PREFIX_NAME = /^sumi-(.+)-(darwin|linux)-(x64|arm64)$/;

function binDirOf(env: Env): string {
  return resolve(env[ENV.binDir] ?? join(env.HOME ?? homedir(), ".local", "bin"));
}

/** Recognizes an `install.sh` layout from the running executable. */
export async function detectInstall(options: {
  env: Env;
  execPath?: string;
  mode?: RunMode;
  platform?: string;
  arch?: string;
}): Promise<LayoutResult> {
  const { env, mode = RUN_MODE, execPath = process.execPath } = options;
  if (mode !== "compiled") {
    return { ok: false, reason: "Sumi is running from a source checkout, not a release install." };
  }
  let real: string;
  try {
    real = realpathSync(execPath);
  } catch {
    return { ok: false, reason: `Cannot resolve the running executable (${execPath}).` };
  }
  const prefix = dirname(dirname(real));
  const match = PREFIX_NAME.exec(basename(prefix));
  if (basename(real) !== "sumi" || basename(dirname(real)) !== "bin" || match === null) {
    return {
      ok: false,
      reason: `${real} is not inside <home>/sumi-<version>-<target>/bin/ as install.sh lays it out.`,
    };
  }
  const version = normalizeVersion(match[1] ?? "");
  const target = `${match[2]}-${match[3]}`;
  if (version === undefined) {
    return { ok: false, reason: `"${basename(prefix)}" does not carry a valid version.` };
  }
  const expectedTarget = platformTarget(options.platform, options.arch);
  if (expectedTarget === undefined) {
    return {
      ok: false,
      reason: "This platform has no Sumi release (macOS and Linux, x64 and arm64).",
    };
  }
  if (target !== expectedTarget) {
    return {
      ok: false,
      reason: `This install is for ${target}, but Sumi is running on ${expectedTarget}.`,
    };
  }
  const home = dirname(prefix);
  const configured = env[ENV.home];
  if (configured !== undefined && configured !== "") {
    let configuredReal: string;
    try {
      configuredReal = realpathSync(resolve(configured));
    } catch {
      configuredReal = resolve(configured);
    }
    if (configuredReal !== home) {
      return {
        ok: false,
        reason: `${ENV.home} (${configured}) is not the directory that holds the running Sumi (${home}).`,
      };
    }
  }
  const link = join(binDirOf(env), "sumi");
  let linked = false;
  try {
    linked = (await lstat(link)).isSymbolicLink() && (await realpath(link)) === real;
  } catch {
    // no link: reported by the caller
  }
  return { ok: true, layout: { home, prefix, version, target, link, linked } };
}

// ---------------------------------------------------------------- checksums

const sha256 = (bytes: Uint8Array): string =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

/** The expected checksum of `archive` in a `SHA256SUMS` file (exactly one entry). */
export function checksumFor(sums: string, archive: string): string {
  const found: string[] = [];
  for (const line of sums.split("\n")) {
    const match = /^(\S+)\s+\*?(\S+)\s*$/.exec(line);
    if (match !== null && match[2] === archive) found.push(match[1] ?? "");
  }
  const [hash] = found;
  if (found.length > 1) {
    throw new UpdateError("checksum-missing", `Duplicate checksum for ${archive} in SHA256SUMS.`);
  }
  if (hash === undefined || !/^[0-9a-fA-F]{64}$/.test(hash)) {
    throw new UpdateError(
      "checksum-missing",
      `Missing or invalid checksum for ${archive} in SHA256SUMS.`,
    );
  }
  return hash.toLowerCase();
}

// ---------------------------------------------------------------- update

export interface UpdateOptions {
  env: Env;
  /** Install this version (also older ones) instead of the latest. */
  version?: string;
  /** Only report. */
  check?: boolean;
  log?: (line: string) => void;
  update?: UpdateEnvironment;
}

export type UpdateOutcome =
  | { status: "up-to-date"; current: string; latest: string }
  | { status: "available"; current: string; latest: string }
  | {
      status: "updated";
      from: string;
      to: string;
      direction: "upgrade" | "downgrade";
      path: string;
      linked: boolean;
    };

const STAGING_PREFIX = ".sumi-update.";
const STALE_STAGING_MS = 60 * 60 * 1000;

/** Removes staging directories that an interrupted update left behind. */
async function removeStaleStaging(home: string, now: number): Promise<void> {
  try {
    for (const entry of await readdir(home)) {
      if (!entry.startsWith(STAGING_PREFIX)) continue;
      const path = join(home, entry);
      try {
        if (now - (await stat(path)).mtimeMs > STALE_STAGING_MS) {
          await rm(path, { recursive: true, force: true });
        }
      } catch {
        // someone else's update may be finishing: leave it
      }
    }
  } catch {
    // an unreadable home is reported by the update itself
  }
}

async function defaultRunVersion(binary: string): Promise<string> {
  const result = await runCommand([binary, "--version"], { timeoutMs: 30_000 });
  if (result.exitCode !== 0) {
    throw new Error(`exit ${result.exitCode ?? result.signal}: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

/** Lists the archive and rejects entries that could escape the extraction directory. */
async function checkArchiveEntries(archive: string, name: string): Promise<void> {
  const listed = await runCommand(["tar", "-tzf", archive], { timeoutMs: 120_000 });
  if (listed.exitCode !== 0) {
    throw new UpdateError("bad-archive", `Could not read the archive: ${listed.stderr.trim()}`);
  }
  for (const entry of listed.stdout.split("\n").filter((e) => e !== "")) {
    const parts = entry.split("/");
    if (isAbsolute(entry) || parts.includes("..") || parts[0] !== name) {
      throw new UpdateError("bad-archive", `The archive contains an unexpected entry: ${entry}`);
    }
  }
}

export async function runUpdate(options: UpdateOptions): Promise<UpdateOutcome> {
  const { env, log = () => {} } = options;
  const u = options.update ?? {};
  const f = u.fetch ?? fetch;
  const now = u.now ?? Date.now;
  const detected = await detectInstall({
    env,
    ...(u.mode !== undefined && { mode: u.mode }),
    ...(u.execPath !== undefined && { execPath: u.execPath }),
  });
  if (!detected.ok) {
    throw new UpdateError(
      "unsupported-layout",
      `sumi update only handles installs made by install.sh. ${detected.reason}`,
      `Install or update with: ${INSTALL_COMMAND}`,
    );
  }
  const { layout } = detected;
  const current = u.currentVersion ?? layout.version;

  const wanted =
    options.version !== undefined
      ? normalizeVersion(options.version)
      : await resolveLatestVersion(env, f);
  if (wanted === undefined) {
    throw new UpdateError("bad-version", `"${options.version}" is not a valid version.`);
  }
  const order = compareVersions(wanted, current);
  if (options.version === undefined) {
    // "latest" older than the running version (a pre-release build) is not an update.
    if (order <= 0) return { status: "up-to-date", current, latest: wanted };
  } else if (order === 0) {
    return { status: "up-to-date", current, latest: wanted };
  }
  if (options.check) return { status: "available", current, latest: wanted };

  const direction = order > 0 ? "upgrade" : "downgrade";
  const { home, target } = layout;
  const name = archiveName(wanted, target);
  const archive = `${name}.tar.gz`;
  const base = (
    env[ENV.downloadBase] ?? `https://github.com/${RELEASE_REPO}/releases/download/v${wanted}`
  ).replace(/\/+$/, "");
  log(
    `${direction === "downgrade" ? "Downgrading" : "Updating"} Sumi ${current} -> ${wanted} (${target})`,
  );

  await removeStaleStaging(home, now());
  let work: string | undefined;
  let placed: string | undefined;
  try {
    work = await mkdtemp(join(home, STAGING_PREFIX));
    log(`Downloading ${archive}`);
    const bytes = await fetchBytes(`${base}/${archive}`, f, DEFAULT_TIMEOUT_MS * 10, archive);
    const sums = await fetchBytes(`${base}/SHA256SUMS`, f, DEFAULT_TIMEOUT_MS, "SHA256SUMS");
    const expected = checksumFor(new TextDecoder().decode(sums), archive);
    if (sha256(bytes) !== expected) {
      throw new UpdateError(
        "checksum-mismatch",
        `Checksum mismatch for ${archive}; nothing was changed.`,
        "Try again later; if it persists, the download or the release may be corrupt.",
      );
    }
    log("Checksum verified");

    const archivePath = join(work, archive);
    await writeFile(archivePath, bytes);
    await checkArchiveEntries(archivePath, name);
    const extracted = join(work, "x");
    await mkdir(extracted);
    const unpack = await runCommand(["tar", "-xzf", archivePath, "-C", extracted], {
      timeoutMs: 120_000,
    });
    if (unpack.exitCode !== 0) {
      throw new UpdateError("bad-archive", `Could not extract ${archive}: ${unpack.stderr.trim()}`);
    }
    const staged = join(extracted, name);
    const binary = join(staged, "bin", "sumi");
    if (!(await stat(binary).catch(() => undefined))?.isFile()) {
      throw new UpdateError("bad-archive", `The archive lacks ${name}/bin/sumi.`);
    }
    // The new release must run on this machine before anything is replaced.
    try {
      const out = (await (u.runVersion ?? defaultRunVersion)(binary)).trim();
      if (normalizeVersion(out) !== wanted) {
        throw new Error(`reports version "${out}", expected ${wanted}`);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new UpdateError(
        "verify-failed",
        `The downloaded release does not run (${reason}); nothing was changed.`,
      );
    }

    // Commit: put the directory in place, then switch the link atomically.
    const dest = join(home, name);
    if (dest === layout.prefix) {
      throw new UpdateError("same-directory", `${dest} is the running release.`);
    }
    await rm(dest, { recursive: true, force: true });
    await rename(staged, dest);
    placed = dest;
    await u.beforeSwitch?.();
    if (layout.linked) {
      const tmpLink = join(dirname(layout.link), `.sumi.update.${process.pid}`);
      await rm(tmpLink, { force: true });
      await symlink(join(dest, "bin", "sumi"), tmpLink);
      try {
        await rename(tmpLink, layout.link);
      } catch (error) {
        await rm(tmpLink, { force: true });
        throw error;
      }
      // The old release is no longer referenced by the link: drop it.
      await rm(layout.prefix, { recursive: true, force: true }).catch(() => {});
    }
    placed = undefined;
    return {
      status: "updated",
      from: current,
      to: wanted,
      direction,
      path: join(dest, "bin", "sumi"),
      linked: layout.linked,
    };
  } catch (error) {
    if (placed !== undefined) await rm(placed, { recursive: true, force: true }).catch(() => {});
    if (error instanceof UpdateError) throw error;
    const reason = error instanceof Error ? error.message : String(error);
    throw new UpdateError(
      "failed",
      `The update failed (${reason}); the installed version was left as it was.`,
    );
  } finally {
    if (work !== undefined) await rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------------------------------------------------------------- notice

export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const RETRY_AFTER_FAILURE_MS = 60 * 60 * 1000;
export const NOTICE_TIMEOUT_MS = 2_000;

export interface UpdateCache {
  /** When the latest release was last fetched (ms since the epoch). */
  checkedAt?: number;
  latest?: string;
  /** When the last attempt failed; the next attempt waits {@link RETRY_AFTER_FAILURE_MS}. */
  failedAt?: number;
}

/** Cache file: `$XDG_CACHE_HOME/sumi` or `~/.cache/sumi`. */
export function cacheFile(env: Env): string | undefined {
  const root =
    env.XDG_CACHE_HOME ?? (env.HOME !== undefined ? join(env.HOME, ".cache") : undefined);
  return root === undefined || root === "" ? undefined : join(root, "sumi", "update-check.json");
}

async function readCache(path: string): Promise<UpdateCache> {
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    return {
      ...(typeof raw.checkedAt === "number" && { checkedAt: raw.checkedAt }),
      ...(typeof raw.latest === "string" && { latest: raw.latest }),
      ...(typeof raw.failedAt === "number" && { failedAt: raw.failedAt }),
    };
  } catch {
    return {};
  }
}

async function writeCache(path: string, cache: UpdateCache): Promise<void> {
  try {
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify(cache)}\n`);
    await rename(tmp, path);
  } catch {
    // a cache that cannot be written only costs another request
  }
}

/** True when the update check is switched off by the environment (CI, `SUMI_NO_UPDATE_CHECK=1`). */
export function updateCheckDisabled(env: Env): boolean {
  const ci = env.CI;
  return (
    (ci !== undefined && ci !== "" && ci !== "0" && ci !== "false") ||
    env[ENV.noUpdateCheck] === "1"
  );
}

export interface UpdateNotice {
  current: string;
  latest: string;
  available: boolean;
  source: "cache" | "network";
}

/**
 * The latest release, at most once a day (cached), for `sumi doctor`. Returns
 * `undefined` when the check is off, nothing is known yet, or the network is
 * unavailable: a failure is never reported.
 */
export async function checkForUpdate(options: {
  env: Env;
  current: string;
  update?: UpdateEnvironment;
}): Promise<UpdateNotice | undefined> {
  const { env, current } = options;
  const u = options.update ?? {};
  if ((u.mode ?? RUN_MODE) !== "compiled" || updateCheckDisabled(env)) return undefined;
  const now = (u.now ?? Date.now)();
  const file = cacheFile(env);
  const cache = file === undefined ? {} : await readCache(file);
  const make = (latest: string, source: UpdateNotice["source"]): UpdateNotice => ({
    current,
    latest,
    available: compareVersions(latest, current) > 0,
    source,
  });
  const cached = cache.latest !== undefined ? normalizeVersion(cache.latest) : undefined;
  if (
    cached !== undefined &&
    cache.checkedAt !== undefined &&
    now - cache.checkedAt < CHECK_INTERVAL_MS
  ) {
    return make(cached, "cache");
  }
  if (cache.failedAt !== undefined && now - cache.failedAt < RETRY_AFTER_FAILURE_MS) {
    return cached !== undefined ? make(cached, "cache") : undefined;
  }
  try {
    const latest = await resolveLatestVersion(env, u.fetch ?? fetch, NOTICE_TIMEOUT_MS);
    if (file !== undefined) await writeCache(file, { checkedAt: now, latest });
    return make(latest, "network");
  } catch {
    if (file !== undefined) await writeCache(file, { ...cache, failedAt: now });
    return cached !== undefined ? make(cached, "cache") : undefined;
  }
}

// ---------------------------------------------------------------- skill

export type SkillStatus = "current" | "skill-outdated" | "cli-outdated" | "invalid";

export interface SkillVersionReport {
  version: string;
  cli: string;
  status: SkillStatus;
  message: string;
}

/** Compares the Skill's version with the CLI's and names the side to update. */
export function compareSkillVersion(skill: string, cli: string): SkillVersionReport {
  const normalized = normalizeVersion(skill);
  if (normalized === undefined) {
    return {
      version: skill,
      cli,
      status: "invalid",
      message: `"${skill}" is not a valid Skill version; the Skill's SKILL.md metadata.version should be a release version.`,
    };
  }
  const order = compareVersions(normalized, cli);
  if (order === 0) {
    return {
      version: normalized,
      cli,
      status: "current",
      message: `The Skill (${normalized}) matches the CLI (${cli}).`,
    };
  }
  return order < 0
    ? {
        version: normalized,
        cli,
        status: "skill-outdated",
        message: `The Skill (${normalized}) is older than the CLI (${cli}): run \`${SKILL_UPDATE_COMMAND}\``,
      }
    : {
        version: normalized,
        cli,
        status: "cli-outdated",
        message: `The CLI (${cli}) is older than the Skill (${normalized}): run \`sumi update\``,
      };
}
