import { type CheckOptions, checkFigure } from "../core/check";
import { hasErrors } from "../core/diagnostics";
import { getProfile } from "../core/profile/builtin";
import { type D2LayoutArgs, toD2LayoutArgs } from "../core/profile/d2";
import type { Result } from "../core/result";
import { getTheme } from "../core/theme/builtin";
import { type FontSetId, fontSetArgs } from "../core/theme/fonts";
import { generateD2 } from "./d2";
import { buildFigureIR, type FigureIR, type SourceMap } from "./ir";

export type CompileOptions = CheckOptions;

/** Everything a backend needs to render a figure, plus what maps results back to the source. */
export interface CompiledFigure {
  ir: FigureIR;
  /** Generated D2 source (an intermediate artifact; never edited by hand). */
  d2Source: string;
  /** Layout CLI arguments derived from the figure's profile. */
  layout: D2LayoutArgs;
  /** The theme's font set and the `--font-*` CLI arguments for it. */
  fontSet: { id: FontSetId; args: string[] };
  /** ElementKey → document path and source location (same as `ir.sourceMap`). */
  sourceMap: SourceMap;
}

/**
 * Compiles a `*.sumi.yaml` source: runs every checking stage
 * ({@link checkFigure}) and, only if none reported an error, builds the
 * {@link FigureIR} and generates D2 source. Pure: no I/O, no D2 CLI.
 *
 * Diagnostics (including warnings on success) are returned in both cases.
 */
export function compileFigure(text: string, options: CompileOptions = {}): Result<CompiledFigure> {
  const check = checkFigure(text, options);
  const { diagnostics } = check.state;
  if (hasErrors(diagnostics)) return { ok: false, diagnostics };

  // The structured engine is checked (`sumi lint`) but not implemented yet
  // (#89–#91): fail clearly instead of laying the figure out with D2.
  const layout = check.state.doc.figure?.layout;
  if (layout?.engine === "structured") {
    const written = layout.arrange === undefined ? "engine" : "arrange";
    const path = ["figure", "layout", written];
    const location = check.locate(path, { key: true });
    return {
      ok: false,
      diagnostics: [
        ...diagnostics,
        {
          code: "layout/engine-unavailable",
          severity: "error",
          message:
            "The structured layout engine is not available in this Sumi version yet; the figure can be checked but not rendered.",
          path,
          ...(location !== undefined && { location }),
          subject: { kind: "figure", id: check.state.doc.figure?.id ?? "" },
          hint: 'Use "sumi lint" to check it, or remove the structured layout fields to render with the auto engine.',
        },
      ],
    };
  }

  const ir = buildFigureIR(check);
  const theme = getTheme(ir.meta.themeId);
  const profile = getProfile(ir.meta.profileId);
  if (!theme || !profile) throw new Error("internal error: theme or profile vanished");
  return {
    ok: true,
    value: {
      ir,
      d2Source: generateD2(ir),
      layout: toD2LayoutArgs(profile),
      fontSet: { id: theme.fontSet.id, args: fontSetArgs(theme.fontSet) },
      sourceMap: ir.sourceMap,
    },
    diagnostics,
  };
}
