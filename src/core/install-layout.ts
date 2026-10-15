/**
 * Where Sumi's runtime files live (design doc §6.8, #20).
 *
 * Sumi runs in one of two modes:
 *
 * - **source**: `bun src/cli/index.ts` from a checkout. Bundled files are
 *   found relative to the source tree (`<repo>/assets/fonts`).
 * - **compiled**: the single-file `sumi` binary from a release tarball
 *   (`bun build --compile`). Module paths then point into Bun's virtual
 *   filesystem (`/$bunfs/root/...`), so bundled files are found relative to
 *   the executable instead, in a prefix-style layout:
 *
 *   ```
 *   <prefix>/bin/sumi
 *   <prefix>/libexec/sumi/d2
 *   <prefix>/share/sumi/fonts/<font set>/...
 *   ```
 *
 * Fonts stay real files (not embedded in the binary) because D2 takes them as
 * `--font-*` file paths and `sumi doctor` verifies their checksums on disk.
 */

import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";

/** Paths inside an installed release, relative to its prefix directory. */
export const RELEASE_LAYOUT = {
  sumi: "bin/sumi",
  d2: "libexec/sumi/d2",
  fonts: "share/sumi/fonts",
} as const;

export type RunMode = "source" | "compiled";

/**
 * True if a module path is inside a `bun build --compile` executable's
 * embedded filesystem (`/$bunfs/` on POSIX, `B:/~BUN/` on Windows).
 */
export function isCompiledModulePath(modulePath: string): boolean {
  return modulePath.startsWith("/$bunfs/") || /^[A-Za-z]:[\\/]~BUN[\\/]/.test(modulePath);
}

/** How the running Sumi was started. */
export const RUN_MODE: RunMode = isCompiledModulePath(import.meta.path) ? "compiled" : "source";

/**
 * The install prefix of a compiled `sumi` at `<prefix>/bin/sumi`: the parent
 * of the executable's directory, after resolving symlinks (so a symlink to
 * the binary on `PATH` still finds the files shipped next to it).
 */
export function installPrefix(execPath: string = process.execPath): string {
  let real = execPath;
  try {
    real = realpathSync(execPath);
  } catch {
    // Keep the path as given; the files next to it are then simply missing.
  }
  return dirname(dirname(real));
}

/** Root of the source checkout (this file is `<root>/src/core/install-layout.ts`). */
const SOURCE_ROOT = join(import.meta.dir, "..", "..");

export interface LayoutOptions {
  mode?: RunMode;
  /** Path of the running executable. Defaults to `process.execPath`. */
  execPath?: string;
  /** Root of the source checkout (source mode). */
  sourceRoot?: string;
}

/**
 * Directory that holds the bundled font sets: `<repo>/assets/fonts` from
 * source, `<prefix>/share/sumi/fonts` when compiled.
 */
export function fontAssetsDir(options: LayoutOptions = {}): string {
  const { mode = RUN_MODE, execPath, sourceRoot = SOURCE_ROOT } = options;
  return mode === "compiled"
    ? join(installPrefix(execPath), RELEASE_LAYOUT.fonts)
    : join(sourceRoot, "assets", "fonts");
}

/**
 * The `d2` shipped with a compiled release (`<prefix>/libexec/sumi/d2`), or
 * `undefined` when running from source (where `.sumi/bin/d2` or `PATH` apply).
 */
export function bundledD2Path(options: LayoutOptions = {}): string | undefined {
  const { mode = RUN_MODE, execPath } = options;
  return mode === "compiled" ? join(installPrefix(execPath), RELEASE_LAYOUT.d2) : undefined;
}
