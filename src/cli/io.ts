/**
 * The CLI's view of the outside world, injected so commands can be tested in
 * process: output streams, working directory and environment.
 *
 * Stream roles: **stdout** carries results (reports, JSON, formatted text,
 * SVG with `-o -`); **stderr** carries diagnostics of a command whose result
 * is a file (`render`, `fmt`), usage errors and logs.
 */

import { randomBytes } from "node:crypto";
import { chmod, lstat, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

export interface CliStream {
  write(chunk: string): unknown;
  /** Whether the stream is a terminal (enables color unless disabled). */
  isTTY?: boolean;
}

export interface CliContext {
  stdout: CliStream;
  stderr: CliStream;
  /** Directory relative paths are resolved against. */
  cwd: string;
  env: Record<string, string | undefined>;
  /** Test-only hooks into otherwise unobservable moments. */
  hooks?: CliHooks;
}

export interface CliHooks {
  /** `render`: after an output's temporary file is written, before it is committed. */
  beforeCommit?(display: string): Promise<void>;
}

/** Exit codes shared by every command. */
export const EXIT = Object.freeze({
  /** Success. */
  ok: 0,
  /** The command ran and found problems (errors, too many warnings, unformatted files, missing requirements). */
  failed: 1,
  /** Usage error (bad flags, unreadable files, invalid configuration) or internal error. */
  usage: 2,
} as const);
export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/** A user error: printed as one line without a stack trace, exit code 2. */
export class UsageError extends Error {
  override name = "UsageError";
}

/**
 * Whether to color output written to `stream`: not with `--no-color` or a
 * non-empty `NO_COLOR`; always with a non-empty `FORCE_COLOR` other than `0`;
 * otherwise only on a terminal.
 */
export function colorEnabled(
  stream: CliStream,
  env: CliContext["env"],
  flag: boolean | undefined,
): boolean {
  if (flag === false || (env.NO_COLOR ?? "") !== "") return false;
  const force = env.FORCE_COLOR ?? "";
  if (force !== "") return force !== "0";
  return stream.isTTY === true;
}

/** Reads a UTF-8 text file relative to the working directory; a failure is a {@link UsageError}. */
export async function readTextFile(context: CliContext, path: string): Promise<string> {
  try {
    return await readFile(resolve(context.cwd, path), "utf8");
  } catch (error) {
    throw new UsageError(`Cannot read ${path}: ${describeFsError(error)}`);
  }
}

/** Identity of an existing file: device and inode. */
export type FileIdentity = `${number}:${number}`;

/**
 * Where writing to a path really goes, resolved once: symbolic links in the
 * path (the file itself and every parent directory) are followed, so `dir` is
 * a real directory and `name` the entry in it that the write replaces.
 */
export interface Destination {
  /** The path as the user wrote it (for messages). */
  display: string;
  /** Real path of the directory the file is written in. */
  dir: string;
  /** Entry name in `dir`. */
  name: string;
  /** Identity of the existing file at `dir/name`, if any. */
  identity?: FileIdentity;
  /** Whether names in `dir` are compared case-insensitively by the file system. */
  caseInsensitive: boolean;
}

/**
 * Resolves `path` (relative to the working directory) to its
 * {@link Destination}: the real path of an existing file (following a link to
 * its target), otherwise the real path of the parent directory plus the base
 * name. A link whose target does not exist is a {@link UsageError}.
 */
export async function resolveDestination(context: CliContext, path: string): Promise<Destination> {
  const absolute = resolve(context.cwd, path);
  let real: string | undefined;
  try {
    real = await realpath(absolute);
  } catch {
    // Does not exist (or is a broken link): resolve the directory instead.
  }
  if (real === undefined) {
    const isLink = await lstat(absolute).then(
      (s) => s.isSymbolicLink(),
      () => false,
    );
    if (isLink) throw new UsageError(`Cannot write ${path}: it is a broken symbolic link.`);
    const parent = await realpath(dirname(absolute)).catch(() => dirname(absolute));
    real = join(parent, basename(absolute));
  }
  const dir = dirname(real);
  const identity = await fileIdentity(real);
  return {
    display: path,
    dir,
    name: basename(real),
    ...(identity !== undefined && { identity }),
    caseInsensitive: await isCaseInsensitiveDir(dir),
  };
}

/**
 * A key that is equal for two destinations exactly when they name the same
 * directory entry: case-folded (and Unicode-normalized) on a case-insensitive
 * file system.
 */
export function destinationKey(
  destination: Pick<Destination, "dir" | "name" | "caseInsensitive">,
): string {
  const path = join(destination.dir, destination.name);
  return destination.caseInsensitive ? path.normalize("NFC").toLowerCase() : path;
}

/** Whether two destinations are the same file (same entry, or the same existing file). */
export function sameDestination(a: Destination, b: Destination): boolean {
  return (
    destinationKey(a) === destinationKey(b) ||
    (a.identity !== undefined && a.identity === b.identity)
  );
}

async function fileIdentity(path: string): Promise<FileIdentity | undefined> {
  return stat(path).then(
    (s): FileIdentity => `${s.dev}:${s.ino}`,
    () => undefined,
  );
}

const caseProbes = new Map<string, Promise<boolean>>();

/**
 * Probes whether `dir` treats names case-insensitively (macOS and Windows
 * defaults): creates a temporary lowercase file and checks whether its
 * uppercase name exists. A directory that cannot be probed counts as
 * case-sensitive.
 */
export function isCaseInsensitiveDir(dir: string): Promise<boolean> {
  let probe = caseProbes.get(dir);
  if (probe === undefined) {
    probe = (async () => {
      const name = `.sumi-case-probe-${randomBytes(6).toString("hex")}`;
      const lower = join(dir, name);
      try {
        await writeFile(lower, "", { flag: "wx" });
      } catch {
        return false;
      }
      try {
        return await stat(join(dir, name.toUpperCase())).then(
          () => true,
          () => false,
        );
      } finally {
        await rm(lower, { force: true });
      }
    })();
    caseProbes.set(dir, probe);
  }
  return probe;
}

export interface WriteDestinationOptions {
  /** Refuse the write if, just before the rename, the destination is this file. */
  protect?: Destination;
  /** Called after the temporary file is written, right before the final checks (tests only). */
  beforeCommit?: () => Promise<void>;
}

/**
 * Writes `content` to a resolved {@link Destination} atomically: to a
 * temporary file in `dir`, then renamed to `dir/name`, so readers never see a
 * partial file. An existing file keeps its permissions.
 *
 * The destination is not resolved again: `rename` replaces the entry
 * `dir/name` itself and never follows a link created there in the meantime.
 * Right before the rename, the write is refused if `dir` no longer resolves
 * to itself (a parent was swapped for a link) or the entry is now the
 * protected file. A failure is a {@link UsageError}.
 */
export async function writeDestination(
  destination: Destination,
  content: string,
  options: WriteDestinationOptions = {},
): Promise<void> {
  const target = join(destination.dir, destination.name);
  const temp = join(destination.dir, `.${destination.name}.${randomBytes(6).toString("hex")}.tmp`);
  const { display } = destination;
  try {
    const mode = await stat(target).then(
      (s) => s.mode & 0o7777,
      () => undefined,
    );
    await writeFile(temp, content, { encoding: "utf8", flag: "wx" });
    if (mode !== undefined) await chmod(temp, mode);
    await options.beforeCommit?.();

    if ((await realpath(destination.dir).catch(() => undefined)) !== destination.dir) {
      throw new UsageError(`Cannot write ${display}: its directory changed while rendering.`);
    }
    const { protect } = options;
    if (protect !== undefined) {
      const now = await lstat(target).then(
        (s): FileIdentity => `${s.dev}:${s.ino}`,
        () => undefined,
      );
      if (
        destinationKey(destination) === destinationKey(protect) ||
        (now !== undefined && now === protect.identity)
      ) {
        throw new UsageError(`Cannot write ${display}: it now refers to ${protect.display}.`);
      }
    }
    await rename(temp, target);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    if (error instanceof UsageError) throw error;
    throw new UsageError(`Cannot write ${display}: ${describeFsError(error)}`);
  }
}

/**
 * Resolves `path` (relative to the working directory) and writes `content`
 * there atomically ({@link resolveDestination}, {@link writeDestination}).
 * Symbolic links are followed: writing to a link replaces the file it points
 * to and leaves the link itself in place.
 */
export async function writeFileAtomic(
  context: CliContext,
  path: string,
  content: string,
): Promise<void> {
  await writeDestination(await resolveDestination(context, path), content);
}

function describeFsError(error: unknown): string {
  if (error !== null && typeof error === "object" && "code" in error) {
    const code = String(error.code);
    const reasons: Record<string, string> = {
      ENOENT: "no such file or directory",
      EACCES: "permission denied",
      EISDIR: "is a directory",
      ENOTDIR: "not a directory",
      EROFS: "read-only file system",
    };
    return reasons[code] ?? code;
  }
  return error instanceof Error ? error.message : String(error);
}
