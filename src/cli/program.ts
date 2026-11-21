import { Command, CommanderError, Option } from "commander";
import pkg from "../../package.json";
import { COMPONENT_KINDS } from "../core/registry/manifest";
import {
  type CatalogCommandOptions,
  catalogCommand,
  collectSection,
  parseTextScale,
  SIZE_DENSITY_CHOICES,
} from "./commands/catalog";
import { doctorCommand } from "./commands/doctor";
import { fmtCommand } from "./commands/fmt";
import { lintCommand, parseMaxWarnings } from "./commands/lint";
import { renderCommand } from "./commands/render";
import { updateCommand } from "./commands/update";
import { type CliContext, colorEnabled, EXIT, type ExitCode, guardStream, UsageError } from "./io";

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
files, failed doctor checks; update --check: an update is available), 2 usage or
internal error (for update: a failed or refused update). SUMI_DEBUG=1 prints
stack traces for internal errors. If the reader of the output exits early
(e.g. | head), the rest is discarded and the exit code is the command's own.`,
    );

  const colorFor = (command: Command, stream: "stdout" | "stderr") =>
    colorEnabled(context[stream], context.env, command.optsWithGlobals().color as boolean);

  program
    .command("render")
    .description(
      "render to SVG, PDF or picture PPTX (not individually editable) and check geometry",
    )
    .argument("<file>", "figure source (*.sumi.yaml)")
    .option(
      "-o, --out <file>",
      "output path; - for stdout (SVG only) (default: <file> with .svg, .pdf or .pptx)",
    )
    .option(
      "--format <format>",
      "svg, pdf or pptx (PPTX: one picture, not editable shapes; default: -o extension, else svg)",
    )
    .option(
      "--pptx-mode <mode>",
      "picture (default) or editable (EXPERIMENTAL: fonts required; no exact appearance, edit-layout or YAML round-trip guarantee)",
    )
    .option(
      "--pptx-connectors <mode>",
      "editable PPTX only: freeform keeps routes but is not glued (default); glued replaces routes with straight connectors; labels stay fixed",
    )
    .option("--emit-d2 <file>", "also write the generated D2 source")
    .option("--theme <name>", "use this built-in theme instead of figure.theme")
    .option("--background <mode>", "canvas or transparent; overrides figure.background")
    .option("--profile <name>", "use this built-in profile instead of figure.profile")
    .option("--no-geometry", "skip the geometry rules on the rendered SVG")
    .option(
      "--explain-width",
      "print where the width goes: natural widths, paddings and gaps per group and box (structured layout)",
    )
    .option("--json", "print a JSON report to stdout instead of text")
    .action(async (file: string, options, command: Command) => {
      setExitCode(
        await renderCommand(file, { ...options, color: colorFor(command, "stderr") }, context),
      );
    });

  program
    .command("lint")
    .description(
      "check figures (schema, references, components, lint rules); --geometry also renders and checks the drawing",
    )
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
    .option("--geometry", "also render with D2 and run the geometry rules (geometry/*)")
    .option("--background <mode>", "canvas or transparent; overrides figure.background")
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
    .option(
      "--no-update-check",
      "do not look for a newer release (also: SUMI_NO_UPDATE_CHECK=1, or CI set)",
    )
    .option(
      "--skill-version <version>",
      "the installed Skill's version: say which of the Skill and the CLI is older",
    )
    .action(async (options, command: Command) => {
      setExitCode(await doctorCommand({ ...options, color: colorFor(command, "stdout") }, context));
    });

  program
    .command("update")
    .description("update Sumi to the latest release (installs made by install.sh)")
    .option("--check", "only report: exit 0 if up to date, 1 if an update is available")
    // The program's own `--version` would swallow this flag; `execute()` renames it (see hoistUpdateVersion).
    .addOption(new Option("--target-version <version>").hideHelp())
    .addHelpText(
      "after",
      `
Options (continued):
  --version <version>  install this version instead of the latest (may be older)

Exit codes: 0 updated or already current (--check: up to date), 1 --check found an
update, 2 the update was refused or failed (the installed version is left as it was).`,
    )
    .action(async (options, command: Command) => {
      const { targetVersion, ...rest } = options;
      setExitCode(
        await updateCommand(
          {
            ...rest,
            ...(targetVersion !== undefined && { version: targetVersion }),
            color: colorFor(command, "stderr"),
          },
          context,
        ),
      );
    });

  program
    .command("catalog")
    .description("list components, themes, profiles, icon sets, placement targets and sets")
    .option("--json", "print the catalog as JSON (props use JSON Schema, including enum values)")
    .option(
      "--section <name>",
      "only this section: components, themes, profiles, icons, targets or sets (repeatable; default: all, or components with --kind)",
      collectSection,
    )
    .option(
      "--icons <words>",
      'list the bundled icons whose name contains every word, as icon: references ("" for all)',
    )
    .addOption(
      new Option("--kind <kind>", "only components of this kind").choices([...COMPONENT_KINDS]),
    )
    .option(
      "--sizes",
      "print the default sizes of a structured figure: text sizes, line widths, gaps, paddings and each node component's natural size",
    )
    .option(
      "--profile <id>",
      "with --sizes: this profile (default: paper-double, screen-doc and presentation-16x9)",
    )
    .option("--theme <id>", "with --sizes: this theme (default: sumi)")
    .addOption(
      new Option(
        "--density <density>",
        "with --sizes: the layout density (default: normal)",
      ).choices([...SIZE_DENSITY_CHOICES]),
    )
    .option(
      "--text-scale <n>",
      "with --sizes: figure.themeOverrides.textScale (default: what the theme needs for the profile)",
      parseTextScale,
    )
    .option(
      "--label <text>",
      'with --sizes: measure the components with this label (repeatable; default: "Encoder")',
      collect,
    )
    .option(
      "--component <id>",
      "with --sizes: only this node component (repeatable; default: all)",
      collect,
    )
    .option("--css", "with --sizes and --profile: print the mockup template's size variables (CSS)")
    .action((options: CatalogCommandOptions) => {
      setExitCode(catalogCommand(options, context));
    });

  return program;
}

/**
 * Runs the CLI with `argv` (the arguments after the executable and script)
 * and returns the exit code; never calls `process.exit`. Used by the `sumi`
 * entry point and by tests.
 *
 * Both streams are guarded ({@link guardStream}): if the reader of a pipe
 * exits early (EPIPE), the rest of that output is discarded without a
 * message and the command still finishes with its own exit code. Any other
 * failure to write is reported as one line with exit code 2.
 */
export async function run(
  argv: readonly string[],
  context: Partial<CliContext> = {},
): Promise<ExitCode> {
  const streams = {
    stdout: guardStream(context.stdout ?? process.stdout),
    stderr: guardStream(context.stderr ?? process.stderr),
  };
  const full: CliContext = {
    ...streams,
    cwd: context.cwd ?? process.cwd(),
    env: context.env ?? process.env,
    ...(context.hooks !== undefined && { hooks: context.hooks }),
    ...(context.update !== undefined && { update: context.update }),
  };
  let exitCode = await execute(argv, full);
  // Write errors arrive asynchronously: wait for every write to complete.
  await Promise.all([streams.stdout.settled(), streams.stderr.settled()]);
  for (const [name, stream] of Object.entries(streams)) {
    if (stream.failure !== undefined) {
      streams.stderr.write(`sumi: error: cannot write to ${name}: ${stream.failure.message}\n`);
      exitCode = EXIT.usage;
    } else if (stream.closed && full.env.SUMI_DEBUG === "1") {
      streams.stderr.write(
        `sumi: debug: ${name} was closed by its reader (EPIPE); the rest of the output was discarded.\n`,
      );
    }
  }
  // The lines above can fail too; a failed stderr is not reported to itself.
  await streams.stderr.settled();
  return streams.stderr.failure === undefined ? exitCode : EXIT.usage;
}

/**
 * `sumi update --version <x>`: commander hands every `--version` to the
 * program's own version flag, even after a subcommand. Renames it for the
 * `update` command's `--target-version` option.
 */
export function hoistUpdateVersion(argv: readonly string[]): string[] {
  const at = argv.findIndex((arg) => !arg.startsWith("-"));
  if (at < 0 || argv[at] !== "update") return [...argv];
  return argv.map((arg, i) =>
    i <= at
      ? arg
      : arg === "--version"
        ? "--target-version"
        : arg.startsWith("--version=")
          ? `--target-version=${arg.slice("--version=".length)}`
          : arg,
  );
}

async function execute(argv: readonly string[], full: CliContext): Promise<ExitCode> {
  let exitCode: ExitCode = EXIT.ok;
  const program = createProgram(full, (code) => {
    exitCode = code;
  });
  try {
    await program.parseAsync(hoistUpdateVersion(argv), { from: "user" });
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
