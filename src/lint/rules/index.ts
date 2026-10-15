import type { LintRule } from "../rule";
import { emptyLabel, longLabel, missingGlyph } from "./labels";
import { ancestorEdge, duplicateEdge, emptyFigure, noEdges, selfLoop } from "./structure";

export { LongLabelOptions } from "./labels";

/** The built-in structural lint rules, all enabled by default. */
export const BUILTIN_LINT_RULES: readonly LintRule[] = Object.freeze([
  emptyFigure,
  noEdges,
  ancestorEdge,
  selfLoop,
  duplicateEdge,
  emptyLabel,
  longLabel,
  missingGlyph,
] as LintRule[]);
