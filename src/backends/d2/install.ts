/**
 * Installs the pinned D2 CLI from its official GitHub release, verifying the
 * tarball's SHA-256. Used by `bun run d2:install` (dev / CI); kept separate
 * from the script so distribution (#20) can reuse it.
 */

import { chmod, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { runCommand } from "../../core/subprocess";
import { checkD2Version } from "./binary";
import {
  D2_RELEASE_BASE_URL,
  D2_TARBALL_BINARY,
  D2_VERSION,
  type D2ReleaseAsset,
  d2ReleaseAsset,
} from "./version";

export interface InstallD2Options {
  /** Destination path of the `d2` binary (e.g. `<project>/.sumi/bin/d2`). */
  destination: string;
  /** Reinstall even if the destination already holds the pinned version. */
  force?: boolean;
  platform?: string;
  arch?: string;
  /** Progress messages. */
  log?: (message: string) => void;
  /** Release asset to install. Defaults to the pinned asset for `platform`/`arch`. */
  asset?: D2ReleaseAsset;
  /** Fetches a URL's bytes. Defaults to `fetch`. */
  download?: (url: string) => Promise<Uint8Array>;
}

export type InstallD2Outcome = "installed" | "already-installed";

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Downloads, verifies and extracts the pinned `d2` to `options.destination`.
 * Throws on failure.
 *
 * All work happens in a fresh, exclusively created directory next to the
 * destination; the verified binary is then renamed into place, so concurrent
 * installs never share files and a failure leaves nothing behind.
 */
export async function installD2(options: InstallD2Options): Promise<InstallD2Outcome> {
  const { destination, log = () => {}, download = fetchBytes } = options;
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;

  if (!options.force && (await Bun.file(destination).exists())) {
    const check = await checkD2Version(destination);
    if (check.ok) return "already-installed";
    log(`Replacing ${destination}: ${check.diagnostics[0]?.message ?? "version check failed"}`);
  }

  const asset = options.asset ?? d2ReleaseAsset(platform, arch);
  if (asset === undefined) {
    throw new Error(
      `D2 v${D2_VERSION} has no prebuilt release for ${platform}-${arch}; install it manually and set SUMI_D2_PATH.`,
    );
  }

  const url = `${D2_RELEASE_BASE_URL}/${asset.name}`;
  log(`Downloading ${url}`);
  const tarball = await download(url);
  const actual = new Bun.CryptoHasher("sha256").update(tarball).digest("hex");
  if (actual !== asset.sha256) {
    throw new Error(`SHA-256 mismatch for ${asset.name}: expected ${asset.sha256}, got ${actual}`);
  }
  log(`Verified SHA-256 ${actual}`);

  const parent = dirname(destination);
  await mkdir(parent, { recursive: true });
  const work = await mkdtemp(join(parent, `.${basename(destination)}-install-`));
  try {
    const archive = join(work, "d2.tar.gz");
    await Bun.write(archive, tarball);
    const tar = await runCommand(["tar", "-xzf", archive, "-C", work, D2_TARBALL_BINARY]);
    if (tar.exitCode !== 0) throw new Error(`tar failed: ${tar.stderr.trim()}`);

    const binary = join(work, D2_TARBALL_BINARY);
    await chmod(binary, 0o755);
    const check = await checkD2Version(binary);
    if (!check.ok) {
      throw new Error(check.diagnostics[0]?.message ?? "Extracted d2 failed the version check");
    }
    await rename(binary, destination);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
  return "installed";
}
