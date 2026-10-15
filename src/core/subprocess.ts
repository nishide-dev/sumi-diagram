/**
 * Safe wrapper around `Bun.spawn` for invoking external commands (e.g. `d2`).
 *
 * The command is always given as an argv array and executed directly, never
 * through a shell, so arguments are passed verbatim without shell
 * interpretation.
 */

export type CommandArgv = readonly [command: string, ...args: string[]];

export interface RunCommandOptions {
  /** Working directory for the child process. Defaults to the current directory. */
  cwd?: string;
  /** Environment variables for the child process. Defaults to the current environment. */
  env?: Record<string, string | undefined>;
  /** Kill the process (SIGTERM) if it runs longer than this many milliseconds. */
  timeoutMs?: number;
}

export interface RunCommandResult {
  /** Exit code, or `null` if the process was terminated by a signal. */
  exitCode: number | null;
  /** Terminating signal name (e.g. `SIGTERM`), or `null` if the process exited normally. */
  signal: string | null;
  stdout: string;
  stderr: string;
  /** `true` if the process was killed because `timeoutMs` elapsed. */
  timedOut: boolean;
}

/**
 * Runs a command and captures its exit status, stdout and stderr.
 *
 * A non-zero exit code is reported in the result, not thrown. Throws if the
 * command cannot be started (e.g. the executable does not exist).
 */
export async function runCommand(
  argv: CommandArgv,
  options: RunCommandOptions = {},
): Promise<RunCommandResult> {
  const { timeoutMs } = options;
  if (timeoutMs !== undefined && !(Number.isFinite(timeoutMs) && timeoutMs > 0)) {
    throw new RangeError(`timeoutMs must be a positive finite number, got ${timeoutMs}`);
  }

  const proc = Bun.spawn([...argv], {
    ...(options.cwd !== undefined && { cwd: options.cwd }),
    ...(options.env !== undefined && { env: options.env }),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  let timedOut = false;
  const timer =
    timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          timedOut = true;
          proc.kill();
        }, timeoutMs);

  try {
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return {
      exitCode: proc.exitCode,
      signal: proc.signalCode,
      stdout,
      stderr,
      timedOut,
    };
  } finally {
    clearTimeout(timer);
  }
}
