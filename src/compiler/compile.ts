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

interface CompiledFigureBase {
  ir: FigureIR;
  /** The theme's font set and the `--font-*` CLI arguments for it. */
  fontSet: { id: FontSetId; args: string[] };
  /** ElementKey → document path and source location (same as `ir.sourceMap`). */
  sourceMap: SourceMap;
}

/** An `auto` figure: everything the D2 backend needs to render it. */
export interface CompiledD2Figure extends CompiledFigureBase {
  engine: "auto";
  /** Generated D2 source (an intermediate artifact; never edited by hand). */
  d2Source: string;
  /** Layout CLI arguments derived from the figure's profile. */
  layout: D2LayoutArgs;
}

/**
 * A `structured` figure (design doc §6.23): laid out and routed by Sumi
 * (`src/layout`) and drawn by the structured SVG writer when it is rendered.
 * It has no D2 source.
 */
export interface CompiledStructuredFigure extends CompiledFigureBase {
  engine: "structured";
}

/** A compiled figure, by its layout engine (`ir.meta.engine`). */
export type CompiledFigure = CompiledD2Figure | CompiledStructuredFigure;

/**
 * Compiles a `*.sumi.yaml` source: runs every checking stage
 * ({@link checkFigure}) and, only if none reported an error, builds the
 * {@link FigureIR} and, for an `auto` figure, generates D2 source. Pure: no
 * I/O, no D2 CLI (a structured figure is laid out when it is rendered).
 *
 * Diagnostics (including warnings on success) are returned in both cases.
 */
export function compileFigure(text: string, options: CompileOptions = {}): Result<CompiledFigure> {
  const check = checkFigure(text, options);
  const { diagnostics } = check.state;
  if (hasErrors(diagnostics)) return { ok: false, diagnostics };

  const ir = buildFigureIR(check);
  const theme = getTheme(ir.meta.themeId);
  const profile = getProfile(ir.meta.profileId);
  if (!theme || !profile) throw new Error("internal error: theme or profile vanished");
  const fontSet = { id: theme.fontSet.id, args: fontSetArgs(theme.fontSet) };
  if (ir.meta.engine === "structured") {
    return {
      ok: true,
      value: { engine: "structured", ir, fontSet, sourceMap: ir.sourceMap },
      diagnostics,
    };
  }
  return {
    ok: true,
    value: {
      engine: "auto",
      ir,
      d2Source: generateD2(ir),
      layout: toD2LayoutArgs(profile),
      fontSet,
      sourceMap: ir.sourceMap,
    },
    diagnostics,
  };
}

/** Narrows a compiled figure to an `auto` one; throws for a structured figure (tests and D2-only paths). */
export function expectD2Figure(compiled: CompiledFigure): CompiledD2Figure {
  if (compiled.engine !== "auto") {
    throw new Error(`internal error: figure "${compiled.ir.meta.id}" is not an auto (D2) figure`);
  }
  return compiled;
}
