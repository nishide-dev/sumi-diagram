/**
 * The natural widths behind a structured figure's width (#607, design
 * `docs/design/decisions/607-width-fitting.md`): one entry per container,
 * arrange box, group and node, measured by the layout engine itself before
 * anything is stretched. The page width is the root's natural width plus the
 * margins (and whatever edges, sets or labels reach beyond the arranged
 * content), so the entries say exactly where the width goes, and which child
 * of a stack sets it even when `align: stretch` paints every child as wide.
 */
import type { ArrangeBoxIR } from "../../compiler/ir";
import type { ElementKey } from "../../core/check-state";

/** Contents whose arrangement the figure does not write: they are measured as a whole. */
export type WidthLeafKind = "legend" | "tokens" | "matrix" | "plane";

export interface WidthEntry {
  /** How messages name it: `node "a"`, `group "b"`, `figure.layout.arrange.row`, … */
  readonly name: string;
  readonly kind: "figure" | "group" | "node" | ArrangeBoxIR["kind"];
  /** Natural width in pt: what the entry needs, before a parent stretches it. */
  readonly widthPt: number;
  /** Placed width in pt, when a stretch (or justify) made it wider than its natural width. */
  readonly placedPt?: number;
  /** The arrange box, for edits of its gaps. */
  readonly box?: ArrangeBoxIR;
  /** The node or group. */
  readonly key?: ElementKey;
  /** Groups: padding per side in pt, and whether `props.padding` writes it. */
  readonly padding?: { readonly west: number; readonly east: number; readonly written: boolean };
  /** Groups: content width (arrange tree plus attached overhang) in pt. */
  readonly contentPt?: number;
  /** Groups: the title width in pt, when it is wider than the content and so sets the width. */
  readonly titlePt?: number;
  /** Rows and grids: the gap between columns, in pt, and how many there are. */
  readonly gap?: {
    readonly pt: number;
    readonly count: number;
    readonly field: "gap" | "columnGap";
    readonly written: boolean;
  };
  /** Grids: the column widths in pt. */
  readonly columnsPt?: readonly number[];
  /** Containers: how far attached nodes reach beyond the arrange tree, west + east, in pt. */
  readonly attachPt?: number;
  /** Nodes: the explicit `props.width` in pt. */
  readonly fixedPt?: number;
  /** Nodes: the measured label width in pt (text only, no padding). */
  readonly labelPt?: number;
  /** Grid items: the column (0-based) and how many columns the item spans. */
  readonly column?: number;
  readonly span?: number;
  /** Generated contents measured as a whole (their own props size them). */
  readonly leaf?: WidthLeafKind;
  readonly children: readonly WidthEntry[];
}

/** The widest entry; ties keep the first (document order). */
export function widest(entries: readonly WidthEntry[]): WidthEntry | undefined {
  let best: WidthEntry | undefined;
  for (const entry of entries)
    if (best === undefined || entry.widthPt > best.widthPt + 1e-6) best = entry;
  return best;
}

/**
 * The path from the root to the entry that sets the width: at each level the
 * widest child (in a row: the widest item, though all add up).
 */
export function widthPath(root: WidthEntry): WidthEntry[] {
  const path: WidthEntry[] = [root];
  let at = root;
  while (at.children.length > 0) {
    // A group whose title is wider than its content, and a place or chat box
    // (its written coordinates or chat width span it), end the path.
    if (at.kind === "group" && at.titlePt !== undefined) break;
    if (at.kind === "place" || at.kind === "chat") break;
    const next = widest(at.children);
    if (next === undefined) break;
    path.push(next);
    at = next;
  }
  return path;
}

/** Every entry, depth first. */
export function allEntries(root: WidthEntry): WidthEntry[] {
  const out: WidthEntry[] = [];
  const visit = (entry: WidthEntry) => {
    out.push(entry);
    for (const child of entry.children) visit(child);
  };
  visit(root);
  return out;
}

/**
 * Whether `child` sets `parent`'s width: every item of a row, the widest
 * single-column item of each grid column, the widest child otherwise.
 */
export function setsWidth(parent: WidthEntry, child: WidthEntry): boolean {
  if (parent.kind === "row") return true;
  if (parent.kind === "grid" && child.column !== undefined) {
    if (child.span !== 1) return false;
    return (
      widest(parent.children.filter((c) => c.column === child.column && c.span === 1)) === child
    );
  }
  return widest(parent.children) === child;
}
