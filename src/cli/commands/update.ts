/**
 * `sumi update`: replaces the running install (made by `install.sh`) with the
 * latest release, or `--version <x>`, which may be older. stdout: progress and
 * the result. stderr: errors, printed like diagnostics.
 *
 * Exit codes: 0 updated, or already up to date; `--check`: 0 up to date and
 * 1 an update is available; 2 the update was refused (not an `install.sh`
 * layout) or failed (network, checksum, archive). A failed update leaves the
 * installed version untouched.
 */

import { runUpdate, UpdateError } from "../../core/update";
import { type CliContext, EXIT, type ExitCode } from "../io";

export interface UpdateCommandOptions {
  check?: boolean;
  version?: string;
  color: boolean;
}

export async function updateCommand(
  options: UpdateCommandOptions,
  context: CliContext,
): Promise<ExitCode> {
  const say = (line: string) => context.stdout.write(`${line}\n`);
  try {
    const outcome = await runUpdate({
      env: context.env,
      ...(options.version !== undefined && { version: options.version }),
      ...(options.check && { check: true }),
      log: say,
      ...(context.update !== undefined && { update: context.update }),
    });
    switch (outcome.status) {
      case "up-to-date":
        say(
          options.version !== undefined
            ? `Sumi ${outcome.current} is already installed.`
            : `Sumi ${outcome.current} is up to date.`,
        );
        return EXIT.ok;
      case "available":
        say(
          options.version !== undefined
            ? `Sumi ${outcome.latest} is available (you have ${outcome.current}); run \`sumi update --version ${outcome.latest}\``
            : `Sumi ${outcome.latest} is available (you have ${outcome.current}): run \`sumi update\``,
        );
        return EXIT.failed;
      case "updated":
        say(`Sumi ${outcome.to} is installed (${outcome.path}).`);
        if (!outcome.linked) {
          say(
            "The sumi link in SUMI_BIN_DIR was not pointing at the old install, so it was not changed; run the path above, or relink it.",
          );
        }
        say("Run `sumi doctor` to check the installation.");
        return EXIT.ok;
    }
  } catch (error) {
    if (!(error instanceof UpdateError)) throw error;
    context.stderr.write(formatUpdateError(error));
    return EXIT.usage;
  }
}

export function formatUpdateError(error: UpdateError): string {
  const { code, message, hint } = error.diagnostic;
  return `sumi: error[${code}]: ${message}\n${hint !== undefined ? `  hint: ${hint}\n` : ""}`;
}
