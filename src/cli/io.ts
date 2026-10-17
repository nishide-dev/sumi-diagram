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

/** A Node / Bun `Writable` as far as {@link guardStream} uses it. */
interface WritableLike extends CliStream {
  write(chunk: string, callback?: (error?: Error | null) => void): unknown;
  on?(event: "error", listener: (error: Error) => void): unknown;
}

/** An output stream that survives its reader going away; see {@link guardStream}. */
export interface GuardedStream extends CliStream {
  /** The reader has closed the pipe (EPIPE); later output is discarded. */
  readonly closed: boolean;
  /** The first write failure other than EPIPE (output was lost). */
  readonly failure: Error | undefined;
  /** Resolves once every write so far has completed or failed. */
  settled(): Promise<void>;
}

/**
 * The one `error` listener each real stream gets, for good: it forwards to
 * the latest guard of that stream. Never removing it means a late `error`
 * event (for example from an asynchronous `_destroy()` after `run()` has
 * returned) cannot crash the process, and repeated `run()` calls on the same
 * stream add no listeners.
 */
const errorSinks = new WeakMap<object, { current: (error: Error) => void }>();

const errorCode = (error: unknown): unknown =>
  typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;

/**
 * Wraps an output stream so a closed reader (`sumi … | head -1`) is not an
 * error: on EPIPE the stream is marked {@link GuardedStream.closed} and later
 * writes are dropped. The command keeps running and exits with its own status
 * (design §6.4). Any other failure of a real stream (an error with a system
 * `code`, such as ENOSPC) is kept in {@link GuardedStream.failure} for the
 * caller to report. A synchronous throw without a `code` is not an I/O error
 * and propagates.
 *
 * Bun and Node report a failed write to a pipe asynchronously: to the write's
 * callback, or as an `error` event that would otherwise crash the process.
 * Streams with `on` (real `Writable`s) are therefore written with a callback
 * and share one persistent `error` listener per stream ({@link errorSinks});
 * plain test streams are called as they are.
 */
export function guardStream(stream: WritableLike): GuardedStream {
  const writable = typeof stream.on === "function";
  let closed = false;
  let failure: Error | undefined;
  let pending = 0;
  let waiters: (() => void)[] = [];

  const fail = (error: unknown) => {
    if (closed || failure !== undefined) return;
    if (errorCode(error) === "EPIPE") closed = true;
    else failure = error instanceof Error ? error : new Error(String(error));
  };
  const done = () => {
    pending--;
    if (pending > 0) return;
    for (const resolve of waiters) resolve();
    waiters = [];
  };
  const settled = () =>
    pending === 0 ? Promise.resolve() : new Promise<void>((resolve) => waiters.push(resolve));
  if (writable) {
    const sink = errorSinks.get(stream);
    if (sink !== undefined) sink.current = fail;
    else {
      const created = { current: fail };
      errorSinks.set(stream, created);
      stream.on?.("error", (error) => created.current(error));
    }
  }

  return {
    get isTTY() {
      return stream.isTTY === true;
    },
    get closed() {
      return closed;
    },
    get failure() {
      return failure;
    },
    write(chunk: string) {
      if (closed || failure !== undefined) return false;
      try {
        if (!writable) return stream.write(chunk);
        pending++;
        return stream.write(chunk, (error) => {
          if (error) fail(error);
          done();
        });
      } catch (error) {
        if (writable) done();
        if (typeof errorCode(error) !== "string") throw error;
        fail(error);
        return false;
      }
    },
    settled,
  };
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

/** A file a write must not replace, identified by name and/or by device and inode. */
export interface ProtectedFile {
  /** The path as the user wrote it (for messages). */
  display: string;
  /** {@link destinationKey} of the file, if known. */
  key?: string;
  /** Device and inode of the file, if it exists. */
  identity?: FileIdentity;
}

/** The {@link ProtectedFile} for a resolved destination. */
export function protectedFile(destination: Destination): ProtectedFile {
  return {
    display: destination.display,
    key: destinationKey(destination),
    ...(destination.identity !== undefined && { identity: destination.identity }),
  };
}

export interface WriteDestinationOptions {
  /** Refuse the write if, just before the rename, the destination is one of these files. */
  protect?: readonly ProtectedFile[];
  /** Called after the temporary file is written, right before the final checks (tests only). */
  beforeCommit?: () => Promise<void>;
}

/** What {@link writeDestination} wrote. */
export interface WrittenFile {
  display: string;
  /** Absolute path of the file written (`dir/name`). */
  path: string;
  /** Device and inode of the file written. */
  identity: FileIdentity;
  /** Whether the file did not exist before this write. */
  created: boolean;
}

/**
 * Writes `content` to a resolved {@link Destination} atomically: to a
 * temporary file in `dir`, then renamed to `dir/name`, so readers never see a
 * partial file. An existing file keeps its permissions.
 *
 * The destination is not resolved again: `rename` replaces the entry
 * `dir/name` itself and never follows a link created there in the meantime.
 * Right before the rename, the write is refused if `dir` no longer resolves
 * to itself (a parent was swapped for a link) or the entry is now one of the
 * protected files. The identity check asks the file system itself, so it also
 * catches names that the file system folds together in ways
 * {@link destinationKey} does not model (e.g. `Σ` and `ς` on APFS) and hard
 * links. A failure is a {@link UsageError}.
 */
export async function writeDestination(
  destination: Destination,
  content: string,
  options: WriteDestinationOptions = {},
): Promise<WrittenFile> {
  const target = join(destination.dir, destination.name);
  const temp = join(destination.dir, `.${destination.name}.${randomBytes(6).toString("hex")}.tmp`);
  const { display } = destination;
  try {
    const existing = await stat(target).catch(() => undefined);
    await writeFile(temp, content, { encoding: "utf8", flag: "wx" });
    if (existing !== undefined) await chmod(temp, existing.mode & 0o7777);
    await options.beforeCommit?.();

    if ((await realpath(destination.dir).catch(() => undefined)) !== destination.dir) {
      throw new UsageError(`Cannot write ${display}: its directory changed while rendering.`);
    }
    const now = await lstat(target).then(
      (s): FileIdentity => `${s.dev}:${s.ino}`,
      () => undefined,
    );
    const key = destinationKey(destination);
    const hit = (options.protect ?? []).find(
      (p) => p.key === key || (now !== undefined && p.identity === now),
    );
    if (hit !== undefined) {
      throw new UsageError(`Cannot write ${display}: it is the same file as ${hit.display}.`);
    }
    await rename(temp, target);
    const written = await lstat(target);
    return {
      display,
      path: target,
      identity: `${written.dev}:${written.ino}`,
      created: now === undefined,
    };
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    if (error instanceof UsageError) throw error;
    throw new UsageError(`Cannot write ${display}: ${describeFsError(error)}`);
  }
}

/**
 * Removes a file this process wrote, but only if it is still that file: its
 * directory still resolves to itself and the entry still has the identity
 * recorded at write time. Returns `false` (and removes nothing) otherwise.
 */
export async function removeWritten(file: WrittenFile): Promise<boolean> {
  const dir = dirname(file.path);
  if ((await realpath(dir).catch(() => undefined)) !== dir) return false;
  const now = await lstat(file.path).then(
    (s): FileIdentity => `${s.dev}:${s.ino}`,
    () => undefined,
  );
  if (now !== file.identity) return false;
  await rm(file.path, { force: true });
  return true;
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
): Promise<WrittenFile> {
  return writeDestination(await resolveDestination(context, path), content);
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
