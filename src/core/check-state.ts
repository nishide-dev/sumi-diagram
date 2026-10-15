/**
 * Internal state passed between the diagnostic-collecting stages
 * (validate → link → resolve → style → constrain; design doc §0).
 *
 * Rules every stage follows:
 * - keep going even if an earlier stage reported errors;
 * - check an element only if neither it nor any of its dependencies (parent
 *   group, edge endpoints, component) is in `invalid`, so errors never cascade;
 * - add every element it reports an error for to `invalid`.
 */

import type { Diagnostic } from "./diagnostics";
import type { FigureEdge, FigureGroup, FigureMeta, FigureNode, JsonValue } from "./figure/schema";

/**
 * Internal element identifier (design doc §2.4): `n:<id>`, `g:<id>`, and
 * `e:<id>` or `e:#<index>` for edges without an `id`.
 */
export type ElementKey = `n:${string}` | `g:${string}` | `e:${string}`;

export const nodeKey = (id: string): ElementKey => `n:${id}`;
export const groupKey = (id: string): ElementKey => `g:${id}`;
export const edgeKey = (id: string | undefined, index: number): ElementKey =>
  id === undefined ? `e:#${index}` : `e:${id}`;

/**
 * The structurally readable part of a figure, normalized (defaults applied).
 *
 * Collections keep their original indices so `DocPath`s stay valid: an element
 * that could not be read is `undefined`. A collection that is itself unreadable
 * (e.g. `nodes` is not a list) is `undefined`, and checks that depend on it are
 * skipped.
 */
export interface PartialFigure {
  version?: 1;
  requires?: string;
  figure?: FigureMeta;
  groups?: (FigureGroup | undefined)[];
  nodes?: (FigureNode | undefined)[];
  edges?: (FigureEdge | undefined)[];
  metadata?: JsonValue;
}

export interface CheckState {
  doc: PartialFigure;
  /** Elements an error was reported for. */
  invalid: Set<ElementKey>;
  diagnostics: Diagnostic[];
}
