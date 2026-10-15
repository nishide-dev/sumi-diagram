import { type CheckFigureOptions, checkFigureSource, type FigureCheck } from "./figure/check";
import { constrainFigure } from "./profile/constrain";
import { createBuiltinRegistry } from "./registry/builtins";
import type { Registry } from "./registry/registry";
import { resolveComponents } from "./registry/resolve";
import { labelFontUsages, styleFigure } from "./theme/resolve";

export interface CheckOptions extends CheckFigureOptions {
  /** Components to resolve against. Defaults to the built-in components. */
  registry?: Registry;
}

/**
 * Runs every diagnostic-collecting stage on a `*.sumi.yaml` source: `yaml`,
 * `schema`, `ref` (see {@link checkFigureSource}), `component`, `theme` and
 * `profile`. The returned state has `components` and `styles` set.
 *
 * The `profile` stage checks the font size of every styled element that has a
 * label (elements without a label draw no text).
 */
export function checkFigure(text: string, options: CheckOptions = {}): FigureCheck {
  const { registry = createBuiltinRegistry(), ...rest } = options;
  const check = checkFigureSource(text, rest);
  resolveComponents(check.state, registry, check.locate);
  styleFigure(check.state, check.locate);
  constrainFigure(check.state, check.locate, { fonts: labelFontUsages(check.state) });
  return check;
}
