import type { CheckState, PartialFigure } from "../check-state";
import { type Result, toResult } from "../result";
import { checkLayout } from "./layout";
import { linkFigure } from "./link";
import type { FigureDocument } from "./schema";
import { validateFigure } from "./validate";
import { type Locator, parseYaml } from "./yaml";

export interface CheckFigureOptions {
  /** File name recorded in diagnostic locations. */
  file?: string;
  /**
   * Values that replace `figure.theme` / `figure.profile` without editing the
   * source (`sumi render --theme/--profile`). They are applied after schema
   * validation, so the source's own values must still be valid strings.
   * Diagnostics at an overridden path carry no source location, since the
   * value does not come from the file.
   */
  overrides?: FigureOverrides;
}

export interface FigureOverrides {
  theme?: string;
  profile?: string;
}

export interface FigureCheck {
  /** Normalized partial document, invalid elements and all diagnostics so far. */
  state: CheckState;
  /** Maps document paths to source locations for later stages. */
  locate: Locator;
}

/**
 * Runs the stages owned by the figure schema — `yaml` (parse), `schema`
 * (validate and normalize), `ref` (link) and `layout` (structured layout
 * fields and the group membership they imply) — on a `*.sumi.yaml` source and
 * returns the {@link CheckState} for the following stages.
 *
 * YAML errors stop the pipeline (there is no document to check); later stages
 * keep going and skip elements whose dependencies are invalid.
 */
export function checkFigureSource(text: string, options: CheckFigureOptions = {}): FigureCheck {
  const parsed = parseYaml(text, options.file);
  const state: CheckState = { doc: {}, invalid: new Set(), diagnostics: parsed.diagnostics };
  if (parsed.source === undefined) return { state, locate: () => undefined };

  const { value } = parsed.source;
  // The source's own values are validated where they are written; later stages see the overrides.
  validateFigure(state, value, parsed.source.locate);
  const locate = overrideLocator(parsed.source.locate, options.overrides);
  applyOverrides(state.doc, options.overrides);
  linkFigure(state, locate);
  checkLayout(state, locate);
  return { state, locate };
}

function applyOverrides(doc: PartialFigure, overrides: FigureOverrides | undefined): void {
  if (doc.figure === undefined || overrides === undefined) return;
  const { theme, profile } = overrides;
  doc.figure = {
    ...doc.figure,
    ...(theme !== undefined && { theme }),
    ...(profile !== undefined && { profile }),
  };
}

/** A locator that has no location for overridden fields (and their sub-paths). */
function overrideLocator(locate: Locator, overrides: FigureOverrides | undefined): Locator {
  const fields = Object.entries(overrides ?? {})
    .filter(([, value]) => value !== undefined)
    .map(([field]) => field);
  if (fields.length === 0) return locate;
  return (path, options) =>
    path[0] === "figure" && typeof path[1] === "string" && fields.includes(path[1])
      ? undefined
      : locate(path, options);
}

/**
 * Parses, validates and links a figure. Succeeds with the normalized document
 * (all defaults filled in) when no errors were reported.
 */
export function parseFigure(
  text: string,
  options: CheckFigureOptions = {},
): Result<FigureDocument> {
  const { state } = checkFigureSource(text, options);
  return toResult(state.diagnostics, () => completeFigure(state.doc));
}

/** Converts an error-free partial figure into a complete document. */
function completeFigure(doc: PartialFigure): FigureDocument {
  const { version, figure, groups, nodes, edges } = doc;
  if (version === undefined || figure === undefined || !groups || !nodes || !edges) {
    throw new Error("internal error: incomplete figure without error diagnostics");
  }
  const present = <T>(list: (T | undefined)[]): T[] =>
    list.filter((item): item is T => item !== undefined);
  return {
    version,
    ...(doc.requires !== undefined && { requires: doc.requires }),
    figure,
    groups: present(groups),
    nodes: present(nodes),
    edges: present(edges),
    ...(doc.metadata !== undefined && { metadata: doc.metadata }),
  };
}
