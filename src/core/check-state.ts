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
import type { FigureEdge, FigureGroup, FigureMeta, FigureNode, JsonValue } from "./figure/schema";
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
}

/** A readable element of the document with its key, path and diagnostic subject. */
export type ElementEntry =
  | (ElementEntryBase & { kind: "group"; element: FigureGroup })
  | (ElementEntryBase & { kind: "node"; element: FigureNode })
  | (ElementEntryBase & { kind: "edge"; element: FigureEdge });

/**
 * The readable elements of a document: groups, then nodes, then edges, each in
 * document order. Edges without an ID have the subject ID `edges[<index>]`.
 */
export function* figureElements(doc: PartialFigure): Generator<ElementEntry> {
  for (const [index, g] of (doc.groups ?? []).entries()) {
    if (g === undefined) continue;
    const subject = { kind: "group", id: g.id } as const;
    yield { kind: "group", key: groupKey(g.id), path: ["groups", index], subject, element: g };
  }
  for (const [index, n] of (doc.nodes ?? []).entries()) {
    if (n === undefined) continue;
    const subject = { kind: "node", id: n.id } as const;
    yield { kind: "node", key: nodeKey(n.id), path: ["nodes", index], subject, element: n };
  }
  for (const [index, e] of (doc.edges ?? []).entries()) {
    if (e === undefined) continue;
    const subject = { kind: "edge", id: e.id ?? `edges[${index}]` } as const;
    yield { kind: "edge", key: edgeKey(e.id, index), path: ["edges", index], subject, element: e };
  }
}

/**
 * Marks elements whose dependencies are invalid as invalid too, without
 * diagnostics: elements inside an invalid group (transitively) and edges with
 * an invalid endpoint. Stages call this after adding their own errors.
 */
export function invalidateDependents(state: CheckState): void {
  const { doc, invalid } = state;
  const contained = [
    ...(doc.groups ?? []).map((g) => g && { key: groupKey(g.id), parent: g.group }),
    ...(doc.nodes ?? []).map((n) => n && { key: nodeKey(n.id), parent: n.group }),
  ];
  let changed = true;
  while (changed) {
    changed = false;
    for (const element of contained) {
      if (!element || element.parent === undefined || invalid.has(element.key)) continue;
      if (invalid.has(groupKey(element.parent))) {
        invalid.add(element.key);
        changed = true;
      }
    }
  }
  const isInvalid = (id: string) => invalid.has(nodeKey(id)) || invalid.has(groupKey(id));
  for (const [index, edge] of (doc.edges ?? []).entries()) {
    if (edge && (isInvalid(edge.from) || isInvalid(edge.to))) invalid.add(edgeKey(edge.id, index));
  }
}
