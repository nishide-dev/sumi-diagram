/**
 * `sumi fmt <files...>`: formats `*.sumi.yaml` files in place without
 * changing their meaning (see `formatFigureSource()` for the rules).
 *
 * - default: rewrites files that change (atomically) and lists them on stdout.
 * - `--check`: writes nothing; lists files that would change on stdout.
 * - `--stdout`: writes the formatted text of a single file to stdout.
 * - stderr: YAML diagnostics of files that cannot be formatted.
 * - exit: 0 success; 1 a file has YAML errors, or `--check` found unformatted
 *   files; 2 usage errors (unreadable or unwritable file) or a failed safety
 *   check.
 */

import { FormatSafetyError, formatFigureSource } from "../../core/figure/format";
import { formatLintText, summarize } from "../../lint";
import {
  type CliContext,
  EXIT,
  type ExitCode,
  readTextFile,
  UsageError,
  writeFileAtomic,
} from "../io";

export interface FmtCommandOptions {
  check?: boolean;
  stdout?: boolean;
  canonicalOrder?: boolean;
  /** Color for diagnostics on stderr. */
  color: boolean;
}

export async function fmtCommand(
  files: readonly string[],
  options: FmtCommandOptions,
  context: CliContext,
): Promise<ExitCode> {
  if (options.check && options.stdout) {
    throw new UsageError("--check and --stdout cannot be used together.");
  }
  if (options.stdout && files.length !== 1) {
    throw new UsageError("--stdout formats exactly one file.");
  }

  let exit: ExitCode = EXIT.ok;
  const worse = (code: ExitCode) => {
    if (code > exit) exit = code;
  };
  for (const file of files) {
    try {
      worse(await formatFile(file, options, context));
    } catch (error) {
      if (!(error instanceof UsageError)) throw error;
      context.stderr.write(`sumi: error: ${error.message}\n`);
      worse(EXIT.usage);
    }
  }
  return exit;
}

async function formatFile(
  file: string,
  options: FmtCommandOptions,
  context: CliContext,
): Promise<ExitCode> {
  const text = await readTextFile(context, file);
  let result: ReturnType<typeof formatFigureSource>;
  try {
    result = formatFigureSource(text, { file, canonicalOrder: options.canonicalOrder ?? false });
  } catch (error) {
    if (error instanceof FormatSafetyError) {
      throw new UsageError(
        `Refusing to format ${file}: ${error.message} This is a bug in sumi fmt; please report it.`,
      );
    }
    throw error;
  }
  if (!result.ok) {
    const { diagnostics } = result;
    context.stderr.write(
      formatLintText(
        { file, diagnostics, summary: summarize(diagnostics) },
        { color: options.color },
      ),
    );
    return EXIT.failed;
  }

  if (options.stdout) {
    context.stdout.write(result.text);
    return EXIT.ok;
  }
  if (!result.changed) return EXIT.ok;
  if (options.check) {
    context.stdout.write(`${file}\n`);
    return EXIT.failed;
  }
  await writeFileAtomic(context, file, result.text);
  context.stdout.write(`${file}\n`);
  return EXIT.ok;
}
