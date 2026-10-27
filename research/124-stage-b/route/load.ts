/**
 * Loads a structured figure the way `renderFigure()` does (compile, image
 * sizes, `layoutStructured`), stopping before routing so that the router
 * variants all start from the same placed layout.
 */

import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { type FigureAssets, hasAssets, loadFigureAssets } from "../../../src/assets/load";
import { compileFigure } from "../../../src/compiler/compile";
import type { FigureIR } from "../../../src/compiler/ir";
import type { FontSet } from "../../../src/core/theme/fonts";
import { getFontSet } from "../../../src/core/theme/fonts";
import type { LayoutIR } from "../../../src/layout/ir";
import { layoutStructured } from "../../../src/layout/structured/engine";
import { withImageSizes } from "../../../src/render/compose-assets";

export interface LoadedFigure {
  readonly ir: FigureIR;
  readonly placed: LayoutIR;
  readonly fonts: FontSet;
  readonly assets?: FigureAssets;
}

export function loadText(text: string, base?: string): LoadedFigure {
  const compiled = compileFigure(text);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics, null, 1));
  let figure = compiled.value;
  let assets: FigureAssets | undefined;
  if (hasAssets(figure.ir)) {
    const loaded = loadFigureAssets(figure.ir, base === undefined ? {} : { base });
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.diagnostics, null, 1));
    assets = loaded.value;
    figure = withImageSizes(figure, assets);
  }
  if (figure.engine !== "structured") throw new Error("not a structured figure");
  const fonts = getFontSet(figure.fontSet.id);
  if (fonts === undefined) throw new Error(`unknown font set ${figure.fontSet.id}`);
  return {
    ir: figure.ir,
    placed: layoutStructured(figure.ir),
    fonts,
    ...(assets !== undefined && { assets }),
  };
}

export function loadFile(path: string): LoadedFigure {
  return loadText(readFileSync(path, "utf8"), dirname(path));
}
