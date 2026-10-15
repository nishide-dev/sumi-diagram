/**
 * `sumi render <file>`: every stage, D2 included (`renderFigure()`), then
 * writes the finalized SVG.
 *
 * - `--theme` / `--profile` replace `figure.theme` / `figure.profile` without
 *   editing the file (applied after schema validation; see
 *   `CheckFigureOptions.overrides`). Unknown names are usage errors.
 * - `-o -` writes the SVG to stdout.
 * - `--emit-d2` writes the generated D2 source whenever compilation succeeds,
 *   even if D2 itself then fails (useful for debugging).
 * - Outputs that resolve to the input or to each other (symbolic links
 *   included) are usage errors; writing through a link replaces its target.
 *   Before the second output is committed, the file system confirms it is not
 *   the input or the first output (same device and inode); if it is, the
 *   first output is removed again when this run created it, and the command
 *   exits 2.
 * - Text mode: diagnostics → stderr; `Wrote …` → stdout (stderr with `-o -`).
 *   `--json`: `{ version, file, output, d2, diagnostics, summary }` → stdout.
 * - exit: 0 rendered (warnings allowed); 1 errors; 2 usage errors.
 */

import { basename } from "node:path";
import { createD2CliBackend } from "../../backends/d2/backend";
import { compileFigure } from "../../compiler/compile";
import { didYouMean } from "../../core/diagnostics";
import type { FigureOverrides } from "../../core/figure/check";
import { BUILTIN_PROFILES } from "../../core/profile/builtin";
import { BUILTIN_THEMES } from "../../core/theme/builtin";
import { formatMm } from "../../core/units";
import {
  compareDiagnostics,
  formatLintText,
  LINT_JSON_VERSION,
  type LintJson,
  summarize,
} from "../../lint";
import { renderFigure } from "../../render";
import {
  type CliContext,
  type Destination,
  EXIT,
  type ExitCode,
  protectedFile,
  readTextFile,
  removeWritten,
  resolveDestination,
  sameDestination,
  UsageError,
  type WrittenFile,
  writeDestination,
} from "../io";

export interface RenderCommandOptions {
  out?: string;
  emitD2?: string;
  theme?: string;
  profile?: string;
  json?: boolean;
  color: boolean;
}

/** The `--json` output: the lint envelope plus the files written. */
export interface RenderJson extends LintJson {
  /** The SVG written, or `null` if rendering failed or the SVG went to stdout. */
  output: string | null;
  /** The D2 source written with `--emit-d2`, or `null`. */
  d2: string | null;
}

/** Default output: the input with `.sumi.yaml` / `.yaml` / `.yml` replaced by `.svg`. */
export function defaultOutputPath(input: string): string {
  const stripped = input.replace(/(\.sumi)?\.ya?ml$/i, "");
  return `${stripped}.svg`;
}

export async function renderCommand(
  file: string,
  options: RenderCommandOptions,
  context: CliContext,
): Promise<ExitCode> {
  const out = options.out ?? defaultOutputPath(file);
  const toStdout = out === "-";
  if (toStdout && options.json) {
    throw new UsageError("--json cannot be combined with -o - (both write to stdout).");
  }
  const [input, svgDestination, d2Destination] = await checkDestinations(
    file,
    [
      ["--out", toStdout ? undefined : out],
      ["--emit-d2", options.emitD2],
    ],
    context,
  );
  // Each write must not replace the input or an output this run already wrote
  // (checked by the file system's own identity, right before the rename). If a
  // later write is refused, outputs this run newly created are removed again;
  // files that existed before keep their new content.
  const written: WrittenFile[] = [];
  const write = async (destination: Destination, content: string) => {
    try {
      written.push(
        await writeDestination(destination, content, {
          protect: [protectedFile(input), ...written],
          ...(context.hooks?.beforeCommit !== undefined && {
            beforeCommit: () =>
              context.hooks?.beforeCommit?.(destination.display) ?? Promise.resolve(),
          }),
        }),
      );
    } catch (error) {
      const kept: string[] = [];
      for (const file of written) {
        if (file.created && !(await removeWritten(file))) kept.push(file.display);
      }
      if (kept.length > 0 && error instanceof UsageError) {
        throw new UsageError(
          `${error.message} Did not remove ${kept.join(", ")}: it changed after it was written.`,
        );
      }
      throw error;
    }
  };
  const overrides: FigureOverrides = {
    ...(options.theme !== undefined && {
      theme: checkName("theme", options.theme, BUILTIN_THEMES.keys()),
    }),
    ...(options.profile !== undefined && {
      profile: checkName("profile", options.profile, BUILTIN_PROFILES.keys()),
    }),
  };

  const text = await readTextFile(context, file);
  const sourceName = `${basename(file)}.d2`;
  const result = await renderFigure(text, {
    file,
    overrides,
    sourceName,
    backend: createD2CliBackend({ projectRoot: context.cwd, env: context.env }),
  });

  let d2Written: string | null = null;
  if (d2Destination !== undefined) {
    const d2Source = result.ok
      ? result.value.compiled.d2Source
      : (() => {
          const compiled = compileFigure(text, { file, overrides });
          return compiled.ok ? compiled.value.d2Source : undefined;
        })();
    if (d2Source !== undefined) {
      await write(d2Destination, d2Source);
      d2Written = d2Destination.display;
    }
  }

  let svgWritten: string | null = null;
  if (result.ok) {
    if (toStdout) context.stdout.write(result.value.svg);
    else {
      if (svgDestination === undefined) throw new Error("internal error: no SVG destination");
      await write(svgDestination, result.value.svg);
      svgWritten = svgDestination.display;
    }
  }

  const diagnostics = [...result.diagnostics].sort(compareDiagnostics);
  const summary = summarize(diagnostics);
  if (options.json) {
    const json: RenderJson = {
      version: LINT_JSON_VERSION,
      file,
      diagnostics,
      summary,
      output: svgWritten,
      d2: d2Written,
    };
    context.stdout.write(`${JSON.stringify(json, null, 2)}\n`);
  } else {
    // With `-o -`, stdout holds the SVG only.
    const log = toStdout ? context.stderr : context.stdout;
    if (diagnostics.length > 0) {
      context.stderr.write(
        formatLintText({ file, diagnostics, summary }, { color: options.color }),
      );
    }
    if (result.ok && svgWritten !== null) {
      const { canvas, profile } = result.value.inspection;
      const limit =
        profile.maxWidthPt === undefined ? "" : `, max width ${formatMm(profile.maxWidthPt)}`;
      const tooWide = profile.maxWidthPt !== undefined && canvas.width.pt > profile.maxWidthPt;
      log.write(
        `Wrote ${svgWritten}: ${formatMm(canvas.width.pt)} × ${formatMm(canvas.height.pt)} ` +
          `(${profile.id}${limit}${tooWide ? ", TOO WIDE" : ""}; theme ${result.value.compiled.ir.meta.themeId}).\n`,
      );
    }
    if (d2Written !== null) log.write(`Wrote ${d2Written}.\n`);
  }
  return result.ok ? EXIT.ok : EXIT.failed;
}

/**
 * Resolves the input and every output once, and refuses outputs that would
 * overwrite the input or each other (see {@link sameDestination}: symbolic
 * links in the file or any parent resolved, existing files also compared by
 * device and inode, names case-folded on case-insensitive file systems).
 * Returns the input's destination followed by one per output (`undefined`
 * where no path is given); writes go to exactly these destinations.
 */
async function checkDestinations(
  input: string,
  outputs: readonly (readonly [flag: string, path: string | undefined])[],
  context: CliContext,
): Promise<[Destination, ...(Destination | undefined)[]]> {
  const source = await resolveDestination(context, input);
  const resolved: (Destination | undefined)[] = [];
  const seen: { flag: string; destination: Destination }[] = [];
  for (const [flag, path] of outputs) {
    if (path === undefined) {
      resolved.push(undefined);
      continue;
    }
    const destination = await resolveDestination(context, path);
    if (sameDestination(destination, source)) {
      throw new UsageError(`${flag} ${path} would overwrite the input file ${input}.`);
    }
    const clash = seen.find((other) => sameDestination(other.destination, destination));
    if (clash !== undefined) {
      throw new UsageError(
        `${flag} ${path} and ${clash.flag} ${clash.destination.display} are the same file; choose different paths.`,
      );
    }
    seen.push({ flag, destination });
    resolved.push(destination);
  }
  return [source, ...resolved];
}

function checkName(kind: string, name: string, available: Iterable<string>): string {
  const names = [...available];
  if (names.includes(name)) return name;
  const suggestion = didYouMean(name, names);
  throw new UsageError(
    `Unknown ${kind} "${name}".${suggestion === undefined ? "" : ` ${suggestion}`} Available ${kind}s: ${names.join(", ")}.`,
  );
}
