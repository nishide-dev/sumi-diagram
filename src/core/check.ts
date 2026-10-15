import { type CheckFigureOptions, checkFigureSource, type FigureCheck } from "./figure/check";
import { createBuiltinRegistry } from "./registry/builtins";
import type { Registry } from "./registry/registry";
import { resolveComponents } from "./registry/resolve";

export interface CheckOptions extends CheckFigureOptions {
  /** Components to resolve against. Defaults to the built-in components. */
  registry?: Registry;
}

/**
 * Runs every diagnostic-collecting stage implemented so far on a
 * `*.sumi.yaml` source: `yaml`, `schema`, `ref` (see {@link checkFigureSource})
 * and `component`. The returned state has `components` set.
 */
export function checkFigure(text: string, options: CheckOptions = {}): FigureCheck {
  const { registry = createBuiltinRegistry(), ...rest } = options;
  const check = checkFigureSource(text, rest);
  resolveComponents(check.state, registry, check.locate);
  return check;
}
