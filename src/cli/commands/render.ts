/**
 * `sumi render <file>`: every stage, D2 included (`renderFigure()`), then
 * writes finalized SVG, vector PDF or a one-picture PPTX (#59, #61).
 *
 * - The format is `--format svg|pdf|pptx`, else the extension of `-o` (`.pdf` →
 *   PDF, `.pptx` → picture PPTX), else SVG. A contradictory known extension
 *   output name is a usage error. The default output is the input with
 *   `.svg`, `.pdf` or `.pptx`. Binary formats cannot go to stdout (`-o -`).
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
 *   `--json`: `{ version, file, diagnostics, summary, output, d2, size, format }`
 *   → stdout; `size` (#37) is the output size against the profile's limits,
 *   or `null` if nothing was rendered; `format` (#59) is `svg` or `pdf`.
 * - The rendered figure is checked by the geometry rules (`lintGeometry()`,
 *   #13; default configuration) unless `--no-geometry`, on the SVG stage for
 *   all formats. Their diagnostics are reported with the others. The output
 *   is written even when they contain errors (e.g. the figure is wider than
 *   the profile allows), so it can be inspected; the exit code is still 1.
 *   A failed conversion (`pdf/*` or `pptx/*` errors) writes no output.
 * - exit: 0 rendered without errors (warnings allowed); 1 errors (including
 *   geometry errors, with the SVG written); 2 usage errors.
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
  lintGeometry,
  summarize,
} from "../../lint";
import { type OutputSize, outputSize, renderFigure } from "../../render";
import { svgToPdf } from "../../render/pdf";
import { type PptxConnectors, svgToEditablePptx, svgToPptx } from "../../render/pptx";
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

/** Output formats of `sumi render`. */
export const OUTPUT_FORMATS = ["svg", "pdf", "pptx"] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

export interface RenderCommandOptions {
  out?: string;
  /** `--format`: wins over the output's extension; a contradiction is a usage error. */
  format?: string;
  pptxMode?: string;
  pptxConnectors?: string;
  emitD2?: string;
  theme?: string;
  profile?: string;
  json?: boolean;
  /** Run the geometry rules on the rendered figure (default; `--no-geometry` turns it off). */
  geometry?: boolean;
  color: boolean;
}

/** The `--json` output: the lint envelope plus the files written. */
export interface RenderJson extends LintJson {
  /** The SVG, PDF or picture PPTX written, or null if conversion failed/stdout. */
  output: string | null;
  /** The D2 source written with `--emit-d2`, or `null`. */
  d2: string | null;
  /** Output size and the profile's limits (#37), or `null` if rendering failed. */
  size: OutputSize | null;
  /** The output format (#59): added last, so earlier keys keep their order. */
  format: OutputFormat;
}

/** Default output: the input's YAML suffix replaced by the output format. */
export function defaultOutputPath(input: string, format: OutputFormat = "svg"): string {
  const stripped = input.replace(/(\.sumi)?\.ya?ml$/i, "");
  return `${stripped}.${format}`;
}

/**
 * The output format: `--format`, else the output's `.svg` / `.pdf` / `.pptx` extension
 * (any case), else SVG. Throws a {@link UsageError} for an unknown format or
 * one that contradicts the extension.
 */
export function outputFormat(out: string | undefined, format: string | undefined): OutputFormat {
  if (format !== undefined && !(OUTPUT_FORMATS as readonly string[]).includes(format)) {
    throw new UsageError(
      `Unknown format "${format}". Available formats: ${OUTPUT_FORMATS.join(", ")}.`,
    );
  }
  const extension =
    out === undefined || out === "-" ? undefined : /\.(svg|pdf|pptx)$/i.exec(out)?.[1];
  const fromName = extension?.toLowerCase() as OutputFormat | undefined;
  if (format !== undefined && fromName !== undefined && format !== fromName) {
    throw new UsageError(
      `--format ${format} contradicts the output file ${out}; use a .${format} name or drop --format.`,
    );
  }
  return (format as OutputFormat | undefined) ?? fromName ?? "svg";
}

export async function renderCommand(
  file: string,
  options: RenderCommandOptions,
  context: CliContext,
): Promise<ExitCode> {
  const format = outputFormat(options.out, options.format);
  if (options.pptxMode !== undefined && !["picture", "editable"].includes(options.pptxMode)) {
    throw new UsageError("--pptx-mode must be picture or editable (experimental).");
  }
  if (
    (options.pptxMode !== undefined || options.pptxConnectors !== undefined) &&
    format !== "pptx"
  ) {
    throw new UsageError("--pptx-mode and --pptx-connectors require PPTX output.");
  }
  if (options.pptxConnectors !== undefined && options.pptxMode !== "editable") {
    throw new UsageError("--pptx-connectors requires --pptx-mode editable.");
  }
  if (
    options.pptxConnectors !== undefined &&
    !["freeform", "glued"].includes(options.pptxConnectors)
  ) {
    throw new UsageError("--pptx-connectors must be freeform or glued.");
  }
  const out = options.out ?? defaultOutputPath(file, format);
  const toStdout = out === "-";
  if (toStdout && options.json) {
    throw new UsageError("--json cannot be combined with -o - (both write to stdout).");
  }
  if (toStdout && format !== "svg") {
    throw new UsageError(
      `A ${format.toUpperCase()} cannot be written to stdout (-o -); give an output file.`,
    );
  }
  const [input, outDestination, d2Destination] = await checkDestinations(
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
  const write = async (destination: Destination, content: string | Uint8Array) => {
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

  const diagnostics = [...result.diagnostics];
  let outputWritten: string | null = null;
  if (result.ok) {
    let content: string | Uint8Array | undefined = result.value.svg;
    if (format === "pdf") {
      const pdf = svgToPdf(result.value.svg);
      diagnostics.push(...pdf.diagnostics);
      content = pdf.ok ? pdf.value : undefined;
    } else if (format === "pptx") {
      const pptx =
        options.pptxMode === "editable"
          ? svgToEditablePptx(result.value.svg, result.value.compiled.ir, {
              connectors: (options.pptxConnectors ?? "freeform") as PptxConnectors,
            })
          : svgToPptx(result.value.svg);
      diagnostics.push(...pptx.diagnostics);
      content = pptx.ok ? pptx.value : undefined;
    }
    if (typeof content === "string" && toStdout) context.stdout.write(content);
    else if (content !== undefined) {
      if (outDestination === undefined) throw new Error("internal error: no output destination");
      await write(outDestination, content);
      outputWritten = outDestination.display;
    }
  }

  if (result.ok && options.geometry !== false) {
    diagnostics.push(...lintGeometry(result.value, { source: text, file }));
  }
  diagnostics.sort(compareDiagnostics);
  const summary = summarize(diagnostics);
  if (options.json) {
    const json: RenderJson = {
      version: LINT_JSON_VERSION,
      file,
      diagnostics,
      summary,
      output: outputWritten,
      d2: d2Written,
      size: result.ok ? outputSize(result.value.inspection) : null,
      format,
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
    if (result.ok && outputWritten !== null) {
      const { canvas, profile } = result.value.inspection;
      const limit =
        profile.maxWidthPt === undefined ? "" : `, max width ${formatMm(profile.maxWidthPt)}`;
      const tooWide = profile.maxWidthPt !== undefined && canvas.width.pt > profile.maxWidthPt;
      log.write(
        `Wrote ${outputWritten}: ${formatMm(canvas.width.pt)} × ${formatMm(canvas.height.pt)} ` +
          `(${profile.id}${limit}${tooWide ? ", TOO WIDE" : ""}; theme ${result.value.compiled.ir.meta.themeId}).\n`,
      );
    }
    if (d2Written !== null) log.write(`Wrote ${d2Written}.\n`);
  }
  return result.ok && summary.errors === 0 ? EXIT.ok : EXIT.failed;
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
