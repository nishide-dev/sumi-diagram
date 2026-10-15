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
 * - Text mode: diagnostics → stderr; `Wrote …` → stdout (stderr with `-o -`).
 *   `--json`: `{ version, file, output, d2, diagnostics, summary }` → stdout.
 * - exit: 0 rendered (warnings allowed); 1 errors; 2 usage errors.
 */

import { basename, resolve } from "node:path";
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
  EXIT,
  type ExitCode,
  readTextFile,
  UsageError,
  writeFileAtomic,
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
  for (const [flag, path] of [
    ["--out", toStdout ? undefined : out],
    ["--emit-d2", options.emitD2],
  ] as const) {
    if (path !== undefined && resolve(context.cwd, path) === resolve(context.cwd, file)) {
      throw new UsageError(`${flag} must not overwrite the input file ${file}.`);
    }
  }
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
  if (options.emitD2 !== undefined) {
    const d2Source = result.ok
      ? result.value.compiled.d2Source
      : (() => {
          const compiled = compileFigure(text, { file, overrides });
          return compiled.ok ? compiled.value.d2Source : undefined;
        })();
    if (d2Source !== undefined) {
      await writeFileAtomic(context, options.emitD2, d2Source);
      d2Written = options.emitD2;
    }
  }

  let svgWritten: string | null = null;
  if (result.ok) {
    if (toStdout) context.stdout.write(result.value.svg);
    else {
      await writeFileAtomic(context, out, result.value.svg);
      svgWritten = out;
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

function checkName(kind: string, name: string, available: Iterable<string>): string {
  const names = [...available];
  if (names.includes(name)) return name;
  const suggestion = didYouMean(name, names);
  throw new UsageError(
    `Unknown ${kind} "${name}".${suggestion === undefined ? "" : ` ${suggestion}`} Available ${kind}s: ${names.join(", ")}.`,
  );
}
