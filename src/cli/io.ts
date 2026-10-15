/**
 * The CLI's view of the outside world, injected so commands can be tested in
 * process: output streams, working directory and environment.
 *
 * Stream roles: **stdout** carries results (reports, JSON, formatted text,
 * SVG with `-o -`); **stderr** carries diagnostics of a command whose result
 * is a file (`render`, `fmt`), usage errors and logs.
 */

import { randomBytes } from "node:crypto";
import { chmod, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
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

/**
 * Writes `content` to `path` (relative to the working directory) atomically:
 * to a temporary file in the same directory, then renamed over the target, so
 * readers never see a partial file. An existing file keeps its permissions.
 * A failure is a {@link UsageError}.
 */
export async function writeFileAtomic(
  context: CliContext,
  path: string,
  content: string,
): Promise<void> {
  const target = resolve(context.cwd, path);
  const temp = join(dirname(target), `.${basename(target)}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    const mode = await stat(target).then(
      (s) => s.mode & 0o7777,
      () => undefined,
    );
    await writeFile(temp, content, "utf8");
    if (mode !== undefined) await chmod(temp, mode);
    await rename(temp, target);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    throw new UsageError(`Cannot write ${path}: ${describeFsError(error)}`);
  }
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
