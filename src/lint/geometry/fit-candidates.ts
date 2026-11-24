/**
 * Width-fitting edits beyond gaps, paddings and widths (#640, design record
 * `docs/design/decisions/640-fit-hints.md`): the levers that made the
 * figures of the #639 dogfood fit, each an edit the width hint lays out and
 * lints before it suggests it (`width-fit.ts`):
 *
 * - a legend with `flow: row` that sets the width: fewer entries per line
 *   (`props.perRow`);
 * - a matrix on the width path: no padding inside its frame (`props.flush`,
 *   or `labelAt: above` for a matrix whose title is inside the frame), and
 *   narrower cells (`props.cellWidth`);
 * - a `place` box that sets the width (its written coordinates span it): the
 *   outermost items moved inward, or all x coordinates brought closer.
 *
 * Legend and matrix props are expanded when the figure is compiled, so those
 * edits are written into the YAML and compiled again (only when the YAML,
 * compiled with the same theme and profile, reproduces the figure as
 * compiled); `place` coordinates are edited in the compiled figure.
 */
import { type Document, parseDocument } from "yaml";
import { hasAssets, loadFigureAssets } from "../../assets/load";
import { compileFigure } from "../../compiler/compile";
import type { ArrangeBoxIR, FigureIR, GroupIR } from "../../compiler/ir";
import type { ElementKey } from "../../core/check-state";
import type { DocPath } from "../../core/diagnostics";
import { formatPt, mmToPt, parseLength } from "../../core/units";
import { mapBoxes } from "../../layout/hint-trials";
import { setsWidth, type WidthEntry, widthPath } from "../../layout/structured/width-tree";
import { withImageSizes } from "../../render/compose-assets";

/** One edit the width hint can try. */
export interface FitCandidate {
  /** What it edits, for the limit of fitting edits per kind: `legend`, `matrix`, `place`, … */
  readonly kind: string;
  /** The width-tree entry it edits (its name), for the edits of the widest contributor. */
  readonly target?: string;
  /** A value below what keeps the figure's intent (e.g. a gap under 2mm): tried last (#640). */
  readonly extreme: boolean;
  /**
   * The edited figure and the edit as text, for an edit that removes about
   * `needPt` of page width; `undefined` if it cannot remove that much.
   */
  readonly make: (needPt: number) => { readonly ir: FigureIR; readonly text: string } | undefined;
}

/** The entries `--explain-width` marks with `*`: everything that sets the width. */
export function widthSetters(tree: WidthEntry): WidthEntry[] {
  const out: WidthEntry[] = [];
  const visit = (entry: WidthEntry, sets: boolean) => {
    if (!sets) return;
    out.push(entry);
    for (const child of entry.children) visit(child, setsWidth(entry, child));
  };
  visit(tree, true);
  return out;
}

/** A recompiler of the figure's YAML with an edit, or `undefined` when the YAML does not reproduce the figure. */
type SourceEditor = (edit: (doc: Document) => void) => FigureIR | undefined;

/**
 * Compiles `source` again with an edit, with the theme and profile the
 * figure was compiled with (a `--theme` / `--profile` override included).
 * `undefined` without a source, or when the unedited source does not compile
 * to exactly the same figure: the whole compiled IR (meta, every node, group,
 * edge, set and arrange box with its styles, sizes and labels) must be equal,
 * source locations aside ({@link irFingerprint}), after the picture sizes
 * render gives it (`withImageSizes`). Otherwise (a custom
 * registry, a source that is not the rendered one) no YAML edit is tried.
 */
export function sourceEditor(ir: FigureIR, source: string | undefined): SourceEditor | undefined {
  if (source === undefined) return undefined;
  const overrides = {
    theme: ir.meta.themeId,
    profile: ir.meta.profileId,
    ...(ir.meta.transparentBackground === true && { background: "transparent" as const }),
  };
  const compile = (text: string): FigureIR | undefined => {
    try {
      const result = compileFigure(text, { overrides });
      if (!result.ok || result.value.engine !== "structured") return undefined;
      if (!hasAssets(result.value.ir)) return result.value.ir;
      // As render prepares it: pictures get the size their aspect ratio gives.
      const assets = loadFigureAssets(result.value.ir);
      return assets.ok ? withImageSizes(result.value, assets.value).ir : undefined;
    } catch {
      return undefined;
    }
  };
  const base = compile(source);
  if (base === undefined || irFingerprint(base) !== irFingerprint(ir)) return undefined;
  return (edit) => {
    const doc = parseDocument(source);
    if (doc.errors.length > 0) return undefined;
    edit(doc);
    return compile(String(doc));
  };
}

/**
 * The compiled figure as a string, for comparing two compilations: every
 * field, maps as their entries, without where things are written in the
 * file (`location`, `file`), which do not change a layout.
 */
export function irFingerprint(ir: FigureIR): string {
  return JSON.stringify(ir, (key, value) => {
    if (key === "location" || key === "file") return undefined;
    if (value instanceof Map) return [...value.entries()];
    if (value instanceof Set) return [...value.values()];
    return value;
  });
}

/** The value at a document path of plain YAML data. */
function at(data: unknown, path: DocPath): unknown {
  let value = data;
  for (const step of path) {
    if (value === null || typeof value !== "object") return undefined;
    value = (value as Record<string | number, unknown>)[step];
  }
  return value;
}

/** The written node with this ID: its index in `nodes` and its props. */
function writtenNode(
  data: unknown,
  id: string,
): { index: number; node: Record<string, unknown>; props: Record<string, unknown> } | undefined {
  const nodes = at(data, ["nodes"]);
  if (!Array.isArray(nodes)) return undefined;
  const index = nodes.findIndex((n) => n !== null && typeof n === "object" && n.id === id);
  const node = nodes[index] as Record<string, unknown> | undefined;
  if (node === undefined) return undefined;
  const props = node.props;
  return {
    index,
    node,
    props: props !== null && typeof props === "object" ? (props as Record<string, unknown>) : {},
  };
}

const floorTo = (value: number, step: number) => Math.floor(value / step + 1e-9) * step;
const trim = (value: number) => String(Math.round(value * 100) / 100);

/** The legend, matrix and place edits for the entries that set the width. */
export function elementCandidates(
  ir: FigureIR,
  tree: WidthEntry,
  source: string | undefined,
  /** The measured width of a node's label in pt, if it has one. */
  labelPt: (key: ElementKey) => number | undefined,
): FitCandidate[] {
  const setters = widthSetters(tree);
  const out: FitCandidate[] = [];
  const groupOf = (entry: WidthEntry): GroupIR | undefined =>
    entry.key === undefined ? undefined : ir.groups.find((g) => g.key === entry.key);
  const leaves = setters.filter((e) => e.leaf === "legend" || e.leaf === "matrix");
  let editor: SourceEditor | undefined | null = null;
  const edit = (change: (doc: Document) => void) => {
    if (editor === null) editor = sourceEditor(ir, source);
    return editor?.(change);
  };
  let data: unknown;
  if (leaves.length > 0 && source !== undefined) {
    try {
      data = parseDocument(source).toJS();
    } catch {
      data = undefined;
    }
  }
  for (const entry of leaves) {
    const group = groupOf(entry);
    if (group === undefined || data === undefined) continue;
    if (entry.leaf === "legend" && group.legend?.id === group.id) {
      const written = writtenNode(data, group.id);
      if (written === undefined || written.props.flow !== "row") continue;
      const entries = Array.isArray(written.props.entries) ? written.props.entries.length : 0;
      const perRow =
        typeof written.props.perRow === "number" ? written.props.perRow : Math.max(1, entries);
      if (perRow <= 1) continue;
      out.push({
        kind: "legend",
        target: entry.name,
        extreme: false,
        make: (need) => {
          let value = Math.floor((perRow * (entry.widthPt - need)) / entry.widthPt);
          if (value >= perRow) value = perRow - 1;
          if (value < 1) return undefined;
          const edited = edit((doc) =>
            doc.setIn(["nodes", written.index, "props", "perRow"], value),
          );
          return edited === undefined
            ? undefined
            : {
                ir: edited,
                text: `set props.perRow of ${entry.name} to ${value} (now ${
                  typeof written.props.perRow === "number"
                    ? perRow
                    : `unset: all ${entries} entries on one line`
                })`,
              };
        },
      });
    }
    if (entry.leaf === "matrix" && group.matrix !== undefined) {
      const written = writtenNode(data, group.matrix.id);
      if (written === undefined) continue;
      const { index, node, props } = written;
      if (group.matrix.flush !== true) {
        // A title inside the frame needs the padding: it moves above the frame instead.
        const titled = typeof node.label === "string" && node.label.trim() !== "";
        out.push({
          kind: "matrix",
          target: entry.name,
          extreme: false,
          make: () => {
            const edited = edit((doc) =>
              doc.setIn(
                ["nodes", index, "props", titled ? "labelAt" : "flush"],
                titled ? "above" : true,
              ),
            );
            return edited === undefined
              ? undefined
              : {
                  ir: edited,
                  text: titled
                    ? `set props.labelAt of ${entry.name} to above (its title above the frame, which then has no padding, as flush)`
                    : `set props.flush of ${entry.name} to true (no padding inside its frame)`,
                };
          },
        });
      }
      const columns = Array.isArray(props.columns) ? props.columns.length : 0;
      const parsed = props.cellWidth === undefined ? undefined : parseLength(props.cellWidth);
      if (columns === 0 || (parsed !== undefined && !parsed.ok)) continue;
      const cellPt = parsed?.ok ? parsed.length.pt : MATRIX_CELL_DEFAULT_PT;
      // Not below the widest text of a cell or column header (1pt of room each side).
      const matrixId = group.matrix.id;
      const texts = ir.nodes.flatMap((n) =>
        n.matrix?.id === matrixId && n.width !== undefined && Math.abs(n.width.pt - cellPt) < 0.01
          ? [labelPt(n.key) ?? 0]
          : [],
      );
      const leastPt = Math.max(1, Math.ceil((Math.max(0, ...texts) + 2) * 2) / 2);
      out.push({
        kind: "matrix",
        target: entry.name,
        extreme: false,
        make: (need) => {
          // At least the widest text: a partial narrowing is still worth knowing.
          const value = Math.max(leastPt, floorTo(cellPt - need / columns, 0.5));
          if (value >= cellPt) return undefined;
          const edited = edit((doc) =>
            doc.setIn(["nodes", index, "props", "cellWidth"], formatPt(value)),
          );
          return edited === undefined
            ? undefined
            : {
                ir: edited,
                text: `set props.cellWidth of ${entry.name} to ${formatPt(value)} (now ${formatPt(cellPt)}, ${columns} columns${props.cellHeight === undefined ? "; cellHeight follows it while unwritten" : ""})`,
              };
        },
      });
    }
  }
  const last = widthPath(tree).at(-1);
  if (last?.kind === "place" && last.box !== undefined)
    out.push(...placeCandidates(ir, last, source));
  return out;
}

/** Room kept between two columns of a `place` box when closing them up: an arrow and its head (#640). */
const INTENT_COLUMN_ROOM_MM = 4;

/** `props.cellWidth` of a matrix when omitted, in pt (`MATRIX_CELL_PT`). */
const MATRIX_CELL_DEFAULT_PT = 10;

/**
 * Edits of a `place` box's x coordinates that narrow it by about the need:
 * the outermost items moved inward (half the need from each side), then all
 * items brought closer about the middle. Values are in the written unit, on
 * a 0.5 step.
 */
function placeCandidates(
  ir: FigureIR,
  entry: WidthEntry,
  source: string | undefined,
): FitCandidate[] {
  const box = entry.box as ArrangeBoxIR;
  const positions = box.positionsPt;
  if (positions === undefined || entry.children.length !== box.items.length) return [];
  // The written x coordinates and unit (`place.unit`), for edits in the YAML's terms.
  let data: unknown;
  try {
    data = source === undefined ? undefined : parseDocument(source).toJS();
  } catch {
    data = undefined;
  }
  const sources = box.placementSources;
  if (data === undefined || sources === undefined || sources.length !== positions.length) return [];
  const writtenUnit = at(data, [...(sources[0]?.path ?? []).slice(0, -3), "unit"]);
  const parsedUnit = parseLength(writtenUnit);
  if (!parsedUnit.ok || !(parsedUnit.length.pt > 0)) return [];
  const u = parsedUnit.length.pt;
  const before = sources.map((s) => {
    const written = at(data, s.path);
    return Array.isArray(written) && typeof written[0] === "number" ? written[0] : Number.NaN;
  });
  if (before.some(Number.isNaN)) return [];
  const names = box.items.map((item, i) =>
    typeof item === "string" ? `"${item.slice(2)}"` : `items[${i}]`,
  );
  const extents = positions.map(([x], i) => {
    const half = (entry.children[i]?.widthPt ?? 0) / 2;
    return { lo: x - half, hi: x + half };
  });
  const lo = Math.min(...extents.map((e) => e.lo));
  const hi = Math.max(...extents.map((e) => e.hi));
  /** A length in pt as written units, on a 0.5 step away from zero. */
  const steps = (pt: number) => (Math.sign(pt) * Math.ceil((Math.abs(pt) / u) * 2 - 1e-9)) / 2;
  const make = (xs: readonly number[], text: string) => {
    const changed = xs.flatMap((x, i) => {
      const was = before[i] as number;
      return Math.abs(x - was) < 1e-9 ? [] : [`${names[i]} x ${trim(was)} → ${trim(x)}`];
    });
    if (changed.length === 0) return undefined;
    const patched = positions.map(
      ([x0, y], i) => [x0 + ((xs[i] as number) - (before[i] as number)) * u, y] as const,
    );
    return {
      ir: mapBoxes(ir, (b, o) => (o === box ? { ...b, positionsPt: patched } : b)),
      text: `${text}: ${changed.join(", ")} (place.items[].at, unit ${String(writtenUnit)})`,
    };
  };
  // Columns: the items at one written x, left to right, with the room between neighbours.
  const xsWritten = [...new Set(before)].sort((a, b) => a - b);
  const columns = xsWritten.map((x) => {
    const members = before.flatMap((b, i) => (b === x ? [i] : []));
    return {
      x,
      lo: Math.min(...members.map((i) => (extents[i] as { lo: number }).lo)),
      hi: Math.max(...members.map((i) => (extents[i] as { hi: number }).hi)),
    };
  });
  const free = columns
    .slice(1)
    .map((c, k) => Math.max(0, c.lo - (columns[k] as { hi: number }).hi));
  const keep = mmToPt(INTENT_COLUMN_ROOM_MM);
  return [
    {
      kind: "place",
      target: entry.name,
      extreme: false,
      make: (need) => {
        const half = need / 2;
        if (hi - lo <= need) return undefined;
        const xs = extents.map((e, i) => {
          const right = Math.max(0, e.hi - (hi - half));
          const left = Math.max(0, lo + half - e.lo);
          const shift = left > 0 && right > 0 ? Number.NaN : left - right;
          return (before[i] as number) + steps(shift);
        });
        return xs.some(Number.isNaN)
          ? undefined
          : make(xs, `move the outermost items of ${entry.name} inward`);
      },
    },
    {
      kind: "place",
      target: entry.name,
      extreme: false,
      make: (need) => {
        // The room between columns beyond what keeps an arrow readable, shared out.
        const room = free.reduce((sum, f) => sum + Math.max(0, f - keep), 0);
        // Less room than needed: all of it, a partial edit another value can complete.
        if (columns.length < 2 || room < 0.5) return undefined;
        const share = Math.min(1, need / room);
        let cumulative = 0;
        const shifts = new Map<number, number>([[columns[0]?.x as number, 0]]);
        free.forEach((f, k) => {
          cumulative += Math.max(0, f - keep) * share;
          shifts.set((columns[k + 1] as { x: number }).x, -cumulative);
        });
        // Keep the middle where it was: shift everything right by half.
        return make(
          before.map((x) => x + steps((shifts.get(x) ?? 0) + cumulative / 2)),
          `close up the room between the columns of ${entry.name} (items at one x move together)`,
        );
      },
    },
    {
      kind: "place",
      target: entry.name,
      extreme: false,
      make: (need) => {
        const xs = positions.map(([x]) => x);
        const min = Math.min(...xs);
        const max = Math.max(...xs);
        const span = max - min;
        if (span <= need) return undefined;
        const factor = (span - need) / span;
        const middle = (min + max) / 2;
        return make(
          xs.map((x, i) => (before[i] as number) + steps(middle + (x - middle) * factor - x)),
          `bring the items of ${entry.name} closer together (x about the middle × ${trim(factor)})`,
        );
      },
    },
  ];
}
