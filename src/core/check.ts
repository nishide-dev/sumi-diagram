import { checkAssets } from "../assets/check";
import { captionLocator, clampCaptionPaths, expandCaptions } from "./figure/caption";
import { type CheckFigureOptions, checkFigureSource, type FigureCheck } from "./figure/check";
import { constrainFigure } from "./profile/constrain";
import { builtinRegistry } from "./registry/builtins";
import type { Registry } from "./registry/registry";
import { resolveComponents } from "./registry/resolve";
import { labelFontUsages, styleFigure } from "./theme/resolve";

export interface CheckOptions extends CheckFigureOptions {
  /** Components to resolve against. Defaults to the built-in components. */
  registry?: Registry;
}

/**
 * Runs every diagnostic-collecting stage on a `*.sumi.yaml` source: `yaml`,
 * `schema`, `ref`, `layout` (see {@link checkFigureSource}), the expansion of
 * group captions (`ref/reserved-id`, #130), `component`, `asset`
 * (icons and image paths, #94), `theme` and `profile`. The returned state has
 * `components` and `styles` set.
 *
 * The `profile` stage checks the font size of every styled element that has a
 * label (elements without a label draw no text).
 */
export function checkFigure(text: string, options: CheckOptions = {}): FigureCheck {
  const { registry = builtinRegistry(), ...rest } = options;
  const source = checkFigureSource(text, rest);
  const { state } = source;
  // Group captions (#130) become label nodes for the following stages; their
  // diagnostics point at the `caption` field.
  expandCaptions(state, source.locate);
  const check: FigureCheck = { state, locate: captionLocator(state.doc, source.locate) };
  resolveComponents(state, registry, check.locate);
  checkAssets(state, check.locate);
  styleFigure(state, check.locate);
  constrainFigure(state, check.locate, { fonts: labelFontUsages(state) });
  clampCaptionPaths(state.doc, state.diagnostics);
  return check;
}
