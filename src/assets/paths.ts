/**
 * Image paths (#94, design doc §6.25): `props.src` of `sumi/image` is a path
 * relative to the directory of the figure's YAML file (the asset base), with
 * `/` between directories. It must stay inside the base, also after symbolic
 * links are resolved, so a figure cannot read files elsewhere on the machine
 * (`~/.ssh/…`, `/etc/…`) into its output.
 *
 * {@link srcProblem} checks the text (pure, at check time);
 * {@link readAssetFile} checks the file system and reads (at render time).
 */

import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readSync,
  realpathSync,
  statSync,
} from "node:fs";
import { isAbsolute, join, posix, relative, sep } from "node:path";

/**
 * Why `src` is not an acceptable relative path, or `undefined` if it is:
 * no URL scheme, no absolute path (POSIX or Windows), no backslashes or
 * control characters, and no `..` that leaves the base.
 */
export function srcProblem(src: string): string | undefined {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what we reject
  if (/[\u0000-\u001f\u007f]/.test(src)) return "it contains a control character";
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(src)) {
    return /^[a-zA-Z]:/.test(src)
      ? "it is an absolute Windows path"
      : "it is a URL; images are read from files next to the figure, never downloaded";
  }
  if (src.startsWith("/") || src.startsWith("\\")) return "it is an absolute path";
  if (src.includes("\\")) return 'it contains "\\"; separate directories with "/"';
  const normalized = posix.normalize(src);
  if (normalized === "." || normalized.endsWith("/")) return "it names a directory, not a file";
  if (normalized === ".." || normalized.startsWith("../")) {
    return "it leaves the directory of the figure's YAML file";
  }
  return undefined;
}

export type ReadAsset =
  | { ok: true; bytes: Uint8Array }
  | {
      ok: false;
      reason: "not-found" | "outside-base" | "too-large";
      message: string;
    };

/**
 * Reads `src` (already accepted by {@link srcProblem}) relative to `base`: the
 * real path of the file (symbolic links resolved) must be inside the real
 * path of `base`. The file is then opened without following a symbolic link
 * in its last component, checked to be a regular file of at most `maxBytes`
 * on the open descriptor, and read from that descriptor, so a file swapped
 * after the check is not read instead.
 */
export function readAssetFile(base: string, src: string, maxBytes: number): ReadAsset {
  let realBase: string;
  try {
    realBase = realpathSync(base);
  } catch {
    return { ok: false, reason: "not-found", message: `the directory ${base} does not exist` };
  }
  let real: string;
  try {
    real = realpathSync(join(realBase, ...src.split("/")));
  } catch {
    return { ok: false, reason: "not-found", message: "the file does not exist" };
  }
  const inside = relative(realBase, real);
  if (inside === "" || inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
    return {
      ok: false,
      reason: "outside-base",
      message: "it resolves (through a symbolic link) to a file outside the figure's directory",
    };
  }
  let fd: number;
  try {
    // O_NONBLOCK: opening a FIFO must not wait for a writer (it is rejected below).
    fd = openSync(
      real,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
    );
  } catch {
    return { ok: false, reason: "not-found", message: "the file cannot be opened" };
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) {
      return { ok: false, reason: "not-found", message: "it is not a regular file" };
    }
    // O_NOFOLLOW guards only the last component: a directory on the way could
    // have been swapped for a symbolic link between the check and the open.
    // Resolve again and require the same file, still inside the base.
    let again: string;
    try {
      again = realpathSync(join(realBase, ...src.split("/")));
    } catch {
      return { ok: false, reason: "not-found", message: "the file changed while it was opened" };
    }
    const now = relative(realBase, again);
    const checked = statSync(again);
    if (
      now === "" ||
      now === ".." ||
      now.startsWith(`..${sep}`) ||
      isAbsolute(now) ||
      checked.dev !== stat.dev ||
      checked.ino !== stat.ino
    ) {
      return {
        ok: false,
        reason: "outside-base",
        message: "it changed to a file outside the figure's directory while it was opened",
      };
    }
    if (stat.size > maxBytes) {
      return {
        ok: false,
        reason: "too-large",
        message: `it is ${stat.size} bytes; the limit is ${maxBytes / 1024 / 1024} MiB per file`,
      };
    }
    // One byte more than allowed tells a file that grew since fstat.
    const buffer = new Uint8Array(Math.min(stat.size, maxBytes) + 1);
    let length = 0;
    for (;;) {
      const n = readSync(fd, buffer, length, buffer.length - length, null);
      if (n === 0) break;
      length += n;
      if (length === buffer.length) {
        return {
          ok: false,
          reason: "too-large",
          message: "it grew while it was read",
        };
      }
    }
    return { ok: true, bytes: buffer.slice(0, length) };
  } finally {
    closeSync(fd);
  }
}
