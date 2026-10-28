/**
 * Geometry lint (stage `geometry`, #13): runs the `geometry/*` rules on a
 * rendered figure, and `lintRenderedFigure()`, which is `lintFigure()` plus
 * rendering and the geometry rules (what `sumi lint --geometry` runs).
 */

import { type Diagnostic, type DocPath, formatDocPath } from "../../core/diagnostics";
import { type CellFields, cellFieldPath } from "../../core/figure/tokens";
import { type Locator, parseYaml } from "../../core/figure/yaml";
import { type FontSet, getFontSet } from "../../core/theme/fonts";
import { type RenderedFigure, type RenderFigureOptions, renderFigure } from "../../render/render";
import { type LintConfig, type ResolvedLintConfig, resolveLintConfig } from "../config";
import {
  compareDiagnostics,
  LINT_EXIT_CODES,
  type LintOptions,
  type LintReport,
  lintFigure,
  summarize,
} from "../lint";
import { isGeometryRule, type LintFinding, toDiagnostic } from "../rule";
import { createGeometryContext, type GeometryContext } from "./context";

/** The parts of a render the geometry lint needs (a {@link RenderedFigure} has them). */
export type GeometryInput = Pick<RenderedFigure, "inspection" | "compiled">;

export interface GeometryLintOptions {
  /** Rule levels and options (`geometry/*` entries apply). Validated; throws `LintConfigError`. */
  config?: LintConfig;
  /** Rules to configure. Defaults to every built-in rule. */
  rules?: LintOptions["rules"];
  /**
   * The `*.sumi.yaml` text that was rendered. With it, diagnostics point at
   * exact fields (e.g. `props` or `label`); without it, at the element.
   */
  source?: string;
  /** File name for source locations. */
  file?: string;
  /** Font set to measure labels with. Defaults to the figure theme's font set. */
  fontSet?: FontSet;
}

/**
 * A locator for geometry findings: exact with the source text, otherwise the
 * location of the nearest element in the IR source map.
 */
function geometryLocator(input: GeometryInput, source?: string, file?: string): Locator {
  const parsed = source === undefined ? undefined : parseYaml(source, file).source;
  if (parsed !== undefined) return parsed.locate;
  const byPath = new Map<string, NonNullable<ReturnType<Locator>>>();
  for (const entry of input.compiled.sourceMap.values()) {
    if (entry.location !== undefined) byPath.set(formatDocPath(entry.path), entry.location);
  }
  return (path: DocPath) => {
    for (let n = path.length; n > 0; n--) {
      const location = byPath.get(formatDocPath(path.slice(0, n)));
      if (location !== undefined) return location;
    }
    return undefined;
  };
}

/** Builds the context geometry rules run on. */
export function geometryContextFor(input: GeometryInput, fontSet?: FontSet): GeometryContext {
  const { ir } = input.compiled;
  // The font set the figure was laid out and drawn with (its theme's).
  const fonts = fontSet ?? getFontSet(ir.meta.fontSetId);
  if (fonts === undefined) {
    throw new Error(
      `internal error: font set "${ir.meta.fontSetId}" of a compiled figure is unknown`,
    );
  }
  return createGeometryContext(ir, input.inspection, fonts);
}

/** Runs the enabled `geometry/*` rules of a resolved configuration. */
export function runGeometryRules(
  context: GeometryContext,
  config: ResolvedLintConfig,
  locate: Locator,
): Diagnostic[] {
  // A cell of a tokens node (#181) is located at its cell; its fields are
  // written in the cell or inherited from the tokens: point at those.
  // Likewise a part of a matrix (#180).
  const cells: CellFields[] = context.elements.flatMap(({ ir, docPath }) => {
    const part = ir.tokens ?? ir.matrix;
    return part === undefined ? [] : [{ path: docPath, fields: part.fields }];
  });
  const remap = (finding: LintFinding): LintFinding =>
    cells.length === 0
      ? finding
      : {
          ...finding,
          path: cellFieldPath(cells, finding.path),
          ...(finding.related !== undefined && {
            related: finding.related.map((r) => ({ ...r, path: cellFieldPath(cells, r.path) })),
          }),
        };
  return config.rules.flatMap(({ rule, severity, options }) =>
    isGeometryRule(rule)
      ? rule.run(context, options).map((f) => toDiagnostic(remap(f), rule.id, severity, locate))
      : [],
  );
}

/**
 * Stage `geometry`: lints a rendered figure (e.g. the value of a successful
 * `renderFigure()`) and returns the diagnostics of the enabled `geometry/*`
 * rules, sorted. `sumi render` can call this on the figure it rendered.
 *
 * @throws LintConfigError if `options.config` is invalid.
 */
export function lintGeometry(
  input: GeometryInput,
  options: GeometryLintOptions = {},
): Diagnostic[] {
  const config = resolveLintConfig(options.config, options.rules);
  const context = geometryContextFor(input, options.fontSet);
  const locate = geometryLocator(input, options.source, options.file);
  return runGeometryRules(context, config, locate).sort(compareDiagnostics);
}

/** Stages whose diagnostics `lintFigure()` already reports (`checkFigure()`). */
const CHECK_STAGES = new Set(["yaml", "schema", "ref", "component", "theme", "profile"]);

/**
 * The `layout` and `asset` stages report both while checking (`lintFigure()`)
 * and while rendering (e.g. `layout/no-route`, `asset/not-found`), so their
 * rendering diagnostics are kept unless `lintFigure()` already reported the
 * same one.
 */
const MIXED_STAGES = new Set(["layout", "asset"]);

export type LintRenderedOptions = LintOptions &
  Pick<RenderFigureOptions, "backend" | "sourceName" | "assetBase"> & {
    /** Font set to measure labels with. Defaults to the figure theme's font set. */
    fontSet?: FontSet;
  };

export interface RenderedLintReport extends LintReport {
  /**
   * The rendered figure, when rendering succeeded. Absent when the figure has
   * errors that prevent compiling, or rendering failed (see the diagnostics).
   */
  rendered?: RenderedFigure;
}

/**
 * Lints a `*.sumi.yaml` source including its rendered geometry: everything
 * `lintFigure()` reports, then — if the figure compiles — renders it
 * (`renderFigure()`, D2 by default) and runs the `geometry/*` rules on the
 * result. Diagnostics of the `compile`, `backend` and `svg` stages are
 * included; the check stages are not repeated.
 *
 * @throws LintConfigError if `options.config` is invalid.
 */
export async function lintRenderedFigure(
  text: string,
  options: LintRenderedOptions = {},
): Promise<RenderedLintReport> {
  const { backend, sourceName, fontSet, assetBase, ...lintOptions } = options;
  const config = resolveLintConfig(lintOptions.config, lintOptions.rules);
  const structural = lintFigure(text, lintOptions);
  const diagnostics = [...structural.diagnostics];
  let rendered: RenderedFigure | undefined;
  const stageOf = (d: Diagnostic) => d.code.split("/")[0] ?? "";
  const checkFailed = structural.diagnostics.some(
    (d) => d.severity === "error" && (CHECK_STAGES.has(stageOf(d)) || MIXED_STAGES.has(stageOf(d))),
  );
  const reported = new Set(structural.diagnostics.map((d) => JSON.stringify(d)));
  if (!checkFailed) {
    const result = await renderFigure(text, {
      ...(lintOptions.file !== undefined && { file: lintOptions.file }),
      ...(lintOptions.registry !== undefined && { registry: lintOptions.registry }),
      ...(backend !== undefined && { backend }),
      ...(sourceName !== undefined && { sourceName }),
      ...(assetBase !== undefined && { assetBase }),
    });
    diagnostics.push(
      ...result.diagnostics.filter(
        (d) =>
          !CHECK_STAGES.has(stageOf(d)) &&
          !(MIXED_STAGES.has(stageOf(d)) && reported.has(JSON.stringify(d))),
      ),
    );
    if (result.ok) {
      rendered = result.value;
      const context = geometryContextFor(rendered, fontSet);
      const locate = geometryLocator(rendered, text, lintOptions.file);
      diagnostics.push(...runGeometryRules(context, config, locate));
    }
  }
  diagnostics.sort(compareDiagnostics);
  const summary = summarize(diagnostics);
  const failed =
    summary.errors > 0 ||
    (config.maxWarnings !== undefined && summary.warnings > config.maxWarnings);
  return {
    ...(lintOptions.file !== undefined && { file: lintOptions.file }),
    diagnostics,
    summary,
    exitCode: failed ? LINT_EXIT_CODES.failed : LINT_EXIT_CODES.ok,
    ...(rendered !== undefined && { rendered }),
  };
}
