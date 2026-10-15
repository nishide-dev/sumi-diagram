import type { CheckState, PartialFigure } from "../check-state";
import { type Result, toResult } from "../result";
import { linkFigure } from "./link";
import type { FigureDocument } from "./schema";
import { validateFigure } from "./validate";
import { type Locator, parseYaml } from "./yaml";

export interface CheckFigureOptions {
  /** File name recorded in diagnostic locations. */
  file?: string;
}

export interface FigureCheck {
  /** Normalized partial document, invalid elements and all diagnostics so far. */
  state: CheckState;
  /** Maps document paths to source locations for later stages. */
  locate: Locator;
}

/**
 * Runs the stages owned by the figure schema — `yaml` (parse), `schema`
 * (validate and normalize) and `ref` (link) — on a `*.sumi.yaml` source and
 * returns the {@link CheckState} for the following stages.
 *
 * YAML errors stop the pipeline (there is no document to check); later stages
 * keep going and skip elements whose dependencies are invalid.
 */
export function checkFigureSource(text: string, options: CheckFigureOptions = {}): FigureCheck {
  const parsed = parseYaml(text, options.file);
  const state: CheckState = { doc: {}, invalid: new Set(), diagnostics: parsed.diagnostics };
  if (parsed.source === undefined) return { state, locate: () => undefined };

  const { value, locate } = parsed.source;
  validateFigure(state, value, locate);
  linkFigure(state, locate);
  return { state, locate };
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
