/**
 * Internal state passed between the diagnostic-collecting stages
 * (validate → link → resolve → style → constrain; design doc §0).
 *
 * Rules every stage follows:
 * - keep going even if an earlier stage reported errors;
 * - skip elements that are themselves in `invalid`;
 * - never report a diagnostic caused by an invalid dependency (parent group,
 *   edge endpoint, component), but still report errors independent of it;
 * - add every element it reports an error for, and every element with an
 *   invalid dependency, to `invalid`.
 */

import type { Diagnostic, DiagnosticSubject, DocPath } from "./diagnostics";
import type { CaptionOrigin } from "./figure/caption";
import type { LegendExpansion } from "./figure/legend";
import {
  type FigureEdge,
  type FigureGroup,
  type FigureMeta,
  type FigureNode,
  type JsonValue,
  refOwner,
} from "./figure/schema";
import type { TokensExpansion } from "./figure/tokens";
import type { ResolvedComponent } from "./registry/manifest";
import type { ResolvedStyle } from "./theme/style";

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
  /**
   * Nodes expanded from `groups[].caption` (#130), by their index in `nodes`
   * (after the written ones). Set by `expandCaptions()`.
   */
  captions?: ReadonlyMap<number, CaptionOrigin>;
  /**
   * Legends expanded into a frame group and its parts (#131), in the order
   * of the legend nodes. Set by `expandLegends()`.
   */
  legends?: readonly LegendExpansion[];
  /**
   * Tokens nodes expanded into their cells (#181), in the order of the
   * tokens nodes. Set by `expandTokens()`.
   */
  tokens?: readonly TokensExpansion[];
  /**
   * Every element a check stage added in place of a field of another
   * element: the caption nodes (#130), the parts of legends (#131) and the
   * cells of tokens nodes (#181), by key. Diagnostics about such an element carry the origin's path and
   * subject (see {@link figureElements}).
   */
  expanded?: ReadonlyMap<ElementKey, ExpandedOrigin>;
}

/** Where an expanded element (see {@link PartialFigure.expanded}) is written. */
export interface ExpandedOrigin {
  /** What it was expanded from. */
  from: "caption" | "legend" | "tokens";
  /** The field it stands for, e.g. `["groups", 2, "caption"]` or a legend entry. */
  path: DocPath;
  /** Whom diagnostics about it name: the captioned group, or the legend or tokens node. */
  subject: DiagnosticSubject;
  /** How messages name it, e.g. `the caption of group "x"`. */
  name: string;
}

export interface CheckState {
  doc: PartialFigure;
  /** Elements an error was reported for. */
  invalid: Set<ElementKey>;
  diagnostics: Diagnostic[];
  /** Set by the `component` stage: the component of every element it resolved. */
  components?: Map<ElementKey, ResolvedComponent>;
  /** Set by the `theme` stage: the effective style of every element it styled. */
  styles?: Map<ElementKey, ResolvedStyle>;
}

interface ElementEntryBase {
  key: ElementKey;
  /** Path of the element in the document, e.g. `["nodes", 2]`. */
  path: DocPath;
  subject: DiagnosticSubject;
  /** Set when a check stage expanded the element from another one's field (#130, #131). */
  origin?: ExpandedOrigin;
}

/** A readable element of the document with its key, path and diagnostic subject. */
export type ElementEntry =
  | (ElementEntryBase & { kind: "group"; element: FigureGroup })
  | (ElementEntryBase & { kind: "node"; element: FigureNode })
  | (ElementEntryBase & { kind: "edge"; element: FigureEdge });

/**
 * The readable elements of a document: groups, then nodes, then edges, each in
 * document order. Edges without an ID have the subject ID `edges[<index>]`.
 * An element a check stage expanded from another one's field (a group's
 * caption, #130; the parts of a legend, #131) has the path and subject of
 * its origin (see {@link PartialFigure.expanded}).
 */
export function* figureElements(doc: PartialFigure): Generator<ElementEntry> {
  const at = (key: ElementKey, path: DocPath, subject: DiagnosticSubject): ElementEntryBase => {
    const origin = doc.expanded?.get(key);
    return origin === undefined
      ? { key, path, subject }
      : { key, path: [...origin.path], subject: { ...origin.subject }, origin };
  };
  for (const [index, g] of (doc.groups ?? []).entries()) {
    if (g === undefined) continue;
    const entry = at(groupKey(g.id), ["groups", index], { kind: "group", id: g.id });
    yield { kind: "group", ...entry, element: g };
  }
  for (const [index, n] of (doc.nodes ?? []).entries()) {
    if (n === undefined) continue;
    const entry = at(nodeKey(n.id), ["nodes", index], { kind: "node", id: n.id });
    yield { kind: "node", ...entry, element: n };
  }
  for (const [index, e] of (doc.edges ?? []).entries()) {
    if (e === undefined) continue;
    const subject = { kind: "edge", id: e.id ?? `edges[${index}]` } as const;
    const entry = at(edgeKey(e.id, index), ["edges", index], subject);
    yield { kind: "edge", ...entry, element: e };
  }
}

/**
 * Marks elements whose dependencies are invalid as invalid too, without
 * diagnostics: elements inside an invalid group, nodes attached to an invalid
 * element (structured layout, `attach.to`), both transitively, and edges with
 * an invalid endpoint. Stages call this after adding their own errors.
 */
export function invalidateDependents(state: CheckState): void {
  const { doc, invalid } = state;
  // A cell reference `<node>.<cell>` (#181) depends on its node until the
  // tokens expansion resolves it.
  const isInvalid = (ref: string) => {
    const id = refOwner(ref);
    return invalid.has(nodeKey(id)) || invalid.has(groupKey(id));
  };
  const dependents: (
    | { key: ElementKey; parent?: string | undefined; attached?: string | undefined }
    | undefined
  )[] = [
    ...(doc.groups ?? []).map((g) => g && { key: groupKey(g.id), parent: g.group }),
    ...(doc.nodes ?? []).map(
      (n) => n && { key: nodeKey(n.id), parent: n.group, attached: n.attach?.to },
    ),
  ];
  let changed = true;
  while (changed) {
    changed = false;
    for (const element of dependents) {
      if (!element || invalid.has(element.key)) continue;
      const parentInvalid = element.parent !== undefined && invalid.has(groupKey(element.parent));
      const targetInvalid = element.attached !== undefined && isInvalid(element.attached);
      if (parentInvalid || targetInvalid) {
        invalid.add(element.key);
        changed = true;
      }
    }
  }
  for (const [index, edge] of (doc.edges ?? []).entries()) {
    if (edge && (isInvalid(edge.from) || isInvalid(edge.to))) invalid.add(edgeKey(edge.id, index));
  }
}
