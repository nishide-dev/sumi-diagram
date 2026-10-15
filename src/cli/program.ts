import { Command, CommanderError, Option } from "commander";
import pkg from "../../package.json";
import { COMPONENT_KINDS, type ComponentKind } from "../core/registry/manifest";
import { catalogCommand } from "./commands/catalog";
import { doctorCommand } from "./commands/doctor";
import { fmtCommand } from "./commands/fmt";
import { lintCommand, parseMaxWarnings } from "./commands/lint";
import { renderCommand } from "./commands/render";
import { type CliContext, colorEnabled, EXIT, type ExitCode, UsageError } from "./io";

const collect = (value: string, previous: string[] = []) => [...previous, value];

/**
 * Builds the `sumi` program. Every action stores its exit code through
 * `setExitCode`; commander's own errors are thrown (`exitOverride`) and output
 * goes to the context's streams.
 */
export function createProgram(
  context: CliContext,
  setExitCode: (code: ExitCode) => void = () => {},
): Command {
  const program = new Command()
    .name("sumi")
    .description("Diagram-as-Code CLI: build diagrams from predefined components and themes")
    .version(pkg.version, "-v, --version", "output the version number")
    .option("--no-color", "disable colored output (also: NO_COLOR=1)")
    .exitOverride()
    .configureOutput({
      writeOut: (text) => context.stdout.write(text),
      writeErr: (text) => context.stderr.write(text),
    })
    .showHelpAfterError("(run with --help for usage)")
    .addHelpText(
      "after",
      `
Output: results go to stdout; diagnostics of render/fmt, errors and logs go to stderr.
Exit codes: 0 success, 1 problems found (errors, too many warnings, unformatted
files, failed doctor checks), 2 usage or internal error. SUMI_DEBUG=1 prints
stack traces for internal errors.`,
    );

  const colorFor = (command: Command, stream: "stdout" | "stderr") =>
    colorEnabled(context[stream], context.env, command.optsWithGlobals().color as boolean);

  program
    .command("render")
    .description("render a figure to SVG (all stages, D2 included)")
    .argument("<file>", "figure source (*.sumi.yaml)")
    .option("-o, --out <file>", "SVG output path; - for stdout (default: <file> with .svg)")
    .option("--emit-d2 <file>", "also write the generated D2 source")
    .option("--theme <name>", "use this built-in theme instead of figure.theme")
    .option("--profile <name>", "use this built-in profile instead of figure.profile")
    .option("--json", "print a JSON report to stdout instead of text")
    .action(async (file: string, options, command: Command) => {
      setExitCode(
        await renderCommand(file, { ...options, color: colorFor(command, "stderr") }, context),
      );
    });

  program
    .command("lint")
    .description("check figures without rendering (schema, references, components, lint rules)")
    .argument("<files...>", "figure sources (*.sumi.yaml)")
    .option("--json", "print a JSON report")
    .option("--config <file>", "lint configuration (JSON: { rules?, maxWarnings? })")
    .option(
      "--max-warnings <n>",
      "fail when all files together have more warnings",
      parseMaxWarnings,
    )
    .option(
      "--rule <id=level>",
      "set a rule's level: off, error, warning or info (repeatable)",
      collect,
    )
    .addOption(new Option("--geometry", "reserved for geometry lint (#13)").hideHelp())
    .action(async (files: string[], options, command: Command) => {
      setExitCode(
        await lintCommand(files, { ...options, color: colorFor(command, "stdout") }, context),
      );
    });

  program
    .command("fmt")
    .description("format figure YAML in place, keeping comments and meaning")
    .argument("<files...>", "figure sources (*.sumi.yaml)")
    .option("--check", "write nothing; list files that are not formatted and exit 1")
    .option("--stdout", "print the formatted file to stdout instead of writing it")
    .option("--canonical-order", "also put known keys in Figure Schema field order")
    .action(async (files: string[], options, command: Command) => {
      setExitCode(
        await fmtCommand(files, { ...options, color: colorFor(command, "stderr") }, context),
      );
    });

  program
    .command("doctor")
    .description("check the environment: D2, bundled fonts, runtime")
    .option("--json", "print a JSON report")
    .action(async (options, command: Command) => {
      setExitCode(await doctorCommand({ ...options, color: colorFor(command, "stdout") }, context));
    });

  program
    .command("catalog")
    .description("list the available components")
    .option("--json", "print the catalog as JSON")
    .addOption(
      new Option("--kind <kind>", "only components of this kind").choices([...COMPONENT_KINDS]),
    )
    .action((options: { json?: boolean; kind?: ComponentKind }) => {
      setExitCode(catalogCommand(options, context));
    });

  return program;
}

/**
 * Runs the CLI with `argv` (the arguments after the executable and script)
 * and returns the exit code; never calls `process.exit`. Used by the `sumi`
 * entry point and by tests.
 */
export async function run(
  argv: readonly string[],
  context: Partial<CliContext> = {},
): Promise<ExitCode> {
  const full: CliContext = {
    stdout: context.stdout ?? process.stdout,
    stderr: context.stderr ?? process.stderr,
    cwd: context.cwd ?? process.cwd(),
    env: context.env ?? process.env,
    ...(context.hooks !== undefined && { hooks: context.hooks }),
  };
  let exitCode: ExitCode = EXIT.ok;
  const program = createProgram(full, (code) => {
    exitCode = code;
  });
  try {
    await program.parseAsync([...argv], { from: "user" });
    return exitCode;
  } catch (error) {
    if (error instanceof CommanderError) {
      // Commander has already printed the message (or the help / version).
      return error.exitCode === 0 ? EXIT.ok : EXIT.usage;
    }
    if (error instanceof UsageError) {
      full.stderr.write(`sumi: error: ${error.message}\n`);
      return EXIT.usage;
    }
    const message = error instanceof Error ? error.message : String(error);
    full.stderr.write(`sumi: internal error: ${message}\n`);
    if (full.env.SUMI_DEBUG === "1" && error instanceof Error && error.stack !== undefined) {
      full.stderr.write(`${error.stack}\n`);
    } else {
      full.stderr.write("Set SUMI_DEBUG=1 to print the stack trace.\n");
    }
    return EXIT.usage;
  }
}
