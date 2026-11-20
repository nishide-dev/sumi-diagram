/**
 * Width fitting (#607, design `docs/design/decisions/607-width-fitting.md`):
 * the natural-width path that sets a structured figure's width, and edits
 * with concrete values (a gap, a group's padding, a node's width) that make
 * it fit the profile, each checked by doing it: the edited copy is laid out,
 * routed, drawn and linted like the figure (`trial.ts`), and only an edit
 * whose trial fits and adds no error or warning is suggested.
 *
 * Cost, only when a figure is too wide (or shrunk by `fit: scale`): one more
 * placement for the width tree, then at most {@link MAX_FIT_TRIALS} trial
 * layouts (the unedited baseline included), each linted once.
 */
import { loadFigureAssets } from "../../assets/load";
import type { ArrangeBoxIR, FigureIR } from "../../compiler/ir";
import type { ElementKey } from "../../core/check-state";
import { getProfile } from "../../core/profile/builtin";
import { spacedProfile } from "../../core/profile/schema";
import { formatMm, formatPt, mmToPt, ptToMm } from "../../core/units";
import { asHintTrial, hintLayoutOptions, inHintTrial, mapBoxes } from "../../layout/hint-trials";
import { structuredWidthTree } from "../../layout/structured/engine";
import { setsWidth, type WidthEntry, widest, widthPath } from "../../layout/structured/width-tree";
import type { GeometryContext } from "./context";
import { layoutTrial, newProblems, type Problems, problemsOf } from "./trial";

/** Trial layouts per diagnostic, the unedited baseline included. */
export const MAX_FIT_TRIALS = 8;
/** Larger figures get the width path only (each trial is linted in full). */
export const MAX_FIT_ELEMENTS = 240;

/**
 * Rules a trial is not linted by: the width rules themselves (the trial is
 * checked for fitting directly; a narrower figure scales less, so its text
 * only grows). `geometry/relocatable-node` is skipped only at its default
 * info level: configured as warning or error it runs in the trial too (it
 * then lays out its own candidates; the trials only change gaps, paddings
 * and widths, so its hint still points at the same YAML items).
 */
const WIDTH_RULES = ["geometry/exceeds-page-width", "geometry/heavy-scaling"];
const RELOCATABLE = "geometry/relocatable-node";

export function skippedInTrials(context: GeometryContext): ReadonlySet<string> {
  const configured = context.lintConfig?.rules.find((r) => r.rule.id === RELOCATABLE);
  const counts = configured !== undefined && configured.severity !== "info";
  return new Set(counts ? WIDTH_RULES : [...WIDTH_RULES, RELOCATABLE]);
}

/** The figure as it was laid out (before routing), whose arrange boxes the width tree refers to. */
const baseIr = (context: GeometryContext): FigureIR => context.placed?.ir ?? context.ir;

/**
 * The natural-width tree of a structured figure (one placement more), or
 * `undefined` for an auto figure, a context without render's placement,
 * inside another rule's trial, or when the layout cannot be repeated.
 */
export function explainWidth(context: GeometryContext): WidthEntry | undefined {
  // Only for a figure that was laid out (render's `placed`): the tree must describe that layout.
  if (context.placed === undefined || inHintTrial()) return undefined;
  const ir = context.placed.ir;
  if (ir.meta.engine !== "structured" || ir.arrange === undefined) return undefined;
  try {
    return asHintTrial(() => structuredWidthTree(ir, hintLayoutOptions.get(ir)));
  } catch {
    return undefined;
  }
}

const mm = (pt: number) => formatMm(pt);

/** One step of an entry on the width path, as text. */
function describe(entry: WidthEntry, next: WidthEntry | undefined): string {
  const w = mm(entry.widthPt);
  switch (entry.kind) {
    case "figure":
      return `arranged content ${w}${entry.attachPt ? ` (attached nodes reach ${mm(entry.attachPt)} beyond the arrange tree)` : ""}`;
    case "row":
    case "grid": {
      const gap = entry.gap;
      const items =
        entry.kind === "grid"
          ? `${entry.columnsPt?.length ?? 0} columns (${(entry.columnsPt ?? []).map(mm).join(" + ")})`
          : `${entry.children.length} item${entry.children.length === 1 ? "" : "s"} (${entry.children
              .filter((c) => c.widthPt > 0)
              .sort((a, b) => b.widthPt - a.widthPt)
              .slice(0, 3)
              .map((c) => `${c.name} ${mm(c.widthPt)}`)
              .join(", ")}${entry.children.length > 3 ? ", …" : ""})`;
      return `${entry.name} ${w} = ${items}${gap ? ` + ${gap.count} × ${mm(gap.pt)} ${gap.field}${gap.written ? "" : " (profile default)"}` : ""}`;
    }
    case "place":
      return `${entry.name} ${w}, spanned by the written place coordinates and the sizes of its ${entry.children.length} items (widest: ${widest(entry.children)?.name ?? "none"} ${mm(widest(entry.children)?.widthPt ?? 0)})`;
    case "chat":
      return `${entry.name} ${w}, the chat's width`;
    case "stack": {
      const others = entry.children.filter((c) => c !== next).sort((a, b) => b.widthPt - a.widthPt);
      const second = others[0];
      const stretched = entry.children.some((c) => c.placedPt !== undefined);
      return `${entry.name} ${w}, as wide as its widest item${second ? ` (next: ${second.name} ${mm(second.widthPt)})` : ""}${
        stretched
          ? `; its items are stretched to one width when drawn, natural widths: ${[
              ...entry.children,
            ]
              .sort((a, b) => b.widthPt - a.widthPt)
              .slice(0, 4)
              .map((c) => `${c.name} ${mm(c.widthPt)}`)
              .join(", ")}`
          : ""
      }`;
    }
    case "group": {
      if (entry.leaf !== undefined)
        return `${entry.name} ${w} (a ${entry.leaf} sized by its own props${entry.leaf === "legend" ? ", e.g. perRow" : entry.leaf === "plane" ? "" : ", e.g. cellWidth"})`;
      const p = entry.padding;
      const pad = p
        ? ` + padding ${formatPt(p.west)} + ${formatPt(p.east)}${p.written ? "" : " (profile default)"}`
        : "";
      const inner =
        entry.titlePt !== undefined
          ? `title ${mm(entry.titlePt)} (wider than its content ${mm(entry.contentPt ?? 0)})`
          : `content ${mm(entry.contentPt ?? 0)}`;
      return `${entry.name} ${w} = ${inner}${pad}${entry.placedPt !== undefined ? `, stretched to ${mm(entry.placedPt)}` : ""}`;
    }
    default:
      return `${entry.name} ${w}${
        entry.fixedPt !== undefined
          ? ` (props.width ${mm(entry.fixedPt)})`
          : entry.labelPt !== undefined
            ? ` (label ${mm(entry.labelPt)} + padding)`
            : ""
      }${entry.placedPt !== undefined ? `, stretched to ${mm(entry.placedPt)}` : ""}`;
  }
}

/** The headline: from the page to the item that sets the width, natural widths, at most 8 steps. */
export function describeWidthPath(
  tree: WidthEntry,
  pageWidthPt: number,
  marginPt?: number,
): string {
  const path = widthPath(tree);
  // A box with one item passes its width through: leave it out.
  const steps = path.flatMap((entry, i) =>
    entry.box !== undefined && entry.children.length === 1 && i < path.length - 1
      ? []
      : [describe(entry, path[i + 1])],
  );
  const shown = steps.length > 8 ? [...steps.slice(0, 3), "…", ...steps.slice(-4)] : steps;
  const rest = marginPt === undefined ? 0 : pageWidthPt - tree.widthPt - 2 * marginPt;
  const outside =
    rest > 0.5
      ? ` Edges, sets or labels reaching beyond the arranged content add ${mm(rest)}.`
      : "";
  const last = path.at(-1) as WidthEntry;
  return `Width path (natural widths, before stretch): page ${mm(pageWidthPt)}${marginPt === undefined ? " → " : ` = margins 2 × ${mm(marginPt)} + `}${shown.join(" → ")}. Widest contributor: ${last.name} (${mm(last.widthPt)}).${outside}`;
}

/** One value an edit changes: a gap (mm), a group's padding (pt) or a node's width (mm). */
interface Part {
  readonly what: string;
  readonly unit: "mm" | "pt";
  readonly current: number;
  /** The least value that stays valid. */
  readonly least: number;
  /** Values are multiples of this step. */
  readonly step: number;
  /** Page width removed per unit of the value, in pt (a row's gap counts once per gap). */
  readonly weight: number;
  readonly now: string;
  readonly patch:
    | { readonly box: ArrangeBoxIR; readonly field: "gapPt" | "columnGapPt" }
    | { readonly group: ElementKey }
    | { readonly node: ElementKey };
}

/** Values for `parts` that remove `overflowPt`, sharing it in proportion to what each can give; `undefined` if they cannot. */
function valuesFor(parts: readonly Part[], overflowPt: number): number[] | undefined {
  const room = parts.reduce((sum, p) => sum + p.weight * (p.current - p.least), 0);
  if (room < overflowPt - 1e-6 || room <= 0) return undefined;
  const share = overflowPt / room;
  const values = parts.map((p) =>
    Math.max(p.least, floorTo(p.current - share * (p.current - p.least), p.step)),
  );
  return values.every((v, i) => v >= (parts[i] as Part).current - 1e-9) ? undefined : values;
}

const valueText = (part: Part, value: number) =>
  `set ${part.what} to ${part.unit === "mm" ? `${trim(value)}mm` : formatPt(value)} (now ${part.now})`;

const trim = (value: number) => String(Math.round(value * 100) / 100);

/** Floors to a step, with a tolerance for floating-point error. */
const floorTo = (value: number, step: number) => Math.floor(value / step + 1e-9) * step;

/** A copy of the figure with `values` written into `parts`. */
function edited(ir: FigureIR, parts: readonly Part[], values: readonly number[]): FigureIR {
  const boxes = new Map<ArrangeBoxIR, Partial<ArrangeBoxIR>>();
  const paddings = new Map<ElementKey, number>();
  const widths = new Map<ElementKey, number>();
  parts.forEach((part, i) => {
    const value = values[i] as number;
    const { patch } = part;
    if ("box" in patch)
      boxes.set(patch.box, { ...boxes.get(patch.box), [patch.field]: mmToPt(value) });
    else if ("group" in patch) paddings.set(patch.group, value);
    // Sizes are rounded to 0.5pt like a written `props.width`.
    else widths.set(patch.node, Math.max(1, Math.round(mmToPt(value) * 2)) / 2);
  });
  return mapBoxes(
    {
      ...ir,
      groups: ir.groups.map((g) => {
        const padding = paddings.get(g.key);
        return padding === undefined ? g : { ...g, paddingPt: padding };
      }),
      nodes: ir.nodes.map((n) => {
        const pt = widths.get(n.key);
        return pt === undefined ? n : { ...n, width: { pt, units: pt * 2 } };
      }),
    },
    (b, o) => {
      const patch = boxes.get(o);
      return patch === undefined ? b : { ...b, ...patch };
    },
  );
}

/**
 * The values on the width path an edit can change: the gaps of its rows and
 * grids, the padding of its groups, and explicit node widths on it (or in a
 * row on it, where every item adds up).
 */
function partsOf(ir: FigureIR, tree: WidthEntry): Part[] {
  const out: Part[] = [];
  const base = getProfile(ir.meta.profileId);
  const profile = base === undefined ? undefined : spacedProfile(base, ir.meta.density);
  const padX = profile?.layout.nodePaddingX.pt ?? 0;
  const groupPad = profile?.layout.groupPadding.pt;
  const seen = new Set<ElementKey>();
  for (const entry of widthPath(tree)) {
    const { box, gap } = entry;
    if ((entry.kind === "row" || entry.kind === "grid") && box && gap && gap.pt > 0)
      out.push({
        what: `${entry.name}.${gap.field}`,
        unit: "mm",
        current: ptToMm(gap.pt),
        least: 0,
        step: 0.5,
        weight: gap.count * mmToPt(1),
        now: `${mm(gap.pt)}${gap.written ? "" : ", the profile default"}`,
        patch: { box, field: gap.field === "gap" ? "gapPt" : "columnGapPt" },
      });
    if (entry.kind === "group" && entry.key && entry.padding && entry.leaf === undefined) {
      const key = entry.key;
      const group = ir.groups.find((g) => g.key === key);
      const written = group?.paddingPt ?? groupPad;
      if (group !== undefined && written !== undefined && written > 0.5)
        out.push({
          what: `props.padding of group "${group.id}"`,
          unit: "pt",
          current: written,
          least: 0.5,
          step: 0.5,
          weight: 2,
          now: `${formatPt(written)}${group.paddingPt === undefined ? ", the profile default" : ""}; every side`,
          patch: { group: key },
        });
    }
    for (const child of entry.kind === "row" ? entry.children : [entry]) {
      if (child.kind !== "node" || child.fixedPt === undefined || !child.key || seen.has(child.key))
        continue;
      const key = child.key;
      const node = ir.nodes.find((n) => n.key === key);
      if (node?.width === undefined || node.image !== undefined) continue;
      seen.add(key);
      const current = ptToMm(node.width.pt);
      // Not below the label and the node padding: the label would overflow.
      const least = Math.min(current, Math.ceil(ptToMm((child.labelPt ?? 0) + 2 * padX) * 2) / 2);
      out.push({
        what: `props.width of node "${node.id}"`,
        unit: "mm",
        current,
        least,
        step: 0.5,
        weight: mmToPt(1),
        now: mm(node.width.pt),
        patch: { node: key },
      });
    }
  }
  return out;
}

export interface FitResult {
  /** Edits whose trial fits the profile and adds no error or warning, with the page width after. */
  readonly fits: readonly { text: string; widthPt: number }[];
  /** Edits whose trial fits but adds problems (code of the first). */
  readonly rejected: readonly { text: string; problem: string }[];
  /** Trial layouts run (the baseline included). */
  readonly trials: number;
  /** Why no trial ran, if none did. */
  readonly skipped?: string;
}

/**
 * Edits with concrete values that bring the natural page width to the
 * profile's maximum, each verified by a trial (see the module comment): one
 * value at a time, smallest change first; if none fits, every value on the
 * width path together, each giving its share of what it can give.
 * `overflowPt`: natural page width minus the profile's maximum.
 */
export function fitHints(
  context: GeometryContext,
  tree: WidthEntry,
  overflowPt: number,
): FitResult {
  const none = (skipped: string): FitResult => ({ fits: [], rejected: [], trials: 0, skipped });
  const ir = baseIr(context);
  const max = context.profile.maxWidthPt;
  if (max === undefined || overflowPt <= 0) return none("the figure fits");
  if (inHintTrial()) return none("inside another trial");
  if (ir.elements.size > MAX_FIT_ELEMENTS)
    return none(
      `the figure has more than ${MAX_FIT_ELEMENTS} elements, the bound for trial layouts`,
    );
  if (context.html?.size || ir.nodes.some((n) => n.image?.html !== undefined))
    return none("HTML assets require prepared rendering and measurements");
  if (
    ir.nodes.some((n) => n.image?.src !== undefined) ||
    [...(ir.assets?.values() ?? [])].some((a) => a.src !== undefined)
  )
    return none("external asset files are not loaded during trials");
  const parts = partsOf(ir, tree);
  const singles = parts
    .flatMap((part) => {
      const values = valuesFor([part], overflowPt);
      return values === undefined ? [] : [{ parts: [part], values }];
    })
    // The smallest change first: the share of the current value it removes.
    .sort((a, b) => {
      const change = (c: { parts: Part[]; values: number[] }) =>
        ((c.parts[0] as Part).current - (c.values[0] as number)) / (c.parts[0] as Part).current;
      return change(a) - change(b);
    });
  // Together: the spacing first (gaps and paddings), then with the explicit widths too.
  const spacing = parts.filter((p) => !("node" in p.patch));
  const combos = [spacing, parts].flatMap((group, i) => {
    if (group.length < 2 || (i === 1 && group.length === spacing.length)) return [];
    const values = valuesFor(group, overflowPt);
    return values === undefined ? [] : [{ parts: group, values }];
  });
  if (singles.length === 0 && combos.length === 0)
    return none(
      parts.length === 0
        ? "the width path has no gap, padding or explicit width to reduce"
        : `the gaps, paddings and widths on the width path can remove at most ${mm(
            parts.reduce((sum, p) => sum + p.weight * (p.current - p.least), 0),
          )} together, even at their least: shorten labels, rearrange (fold a row into rows) or shrink`,
    );
  const assets = loadFigureAssets(ir);
  if (!assets.ok) return none("inline or bundled assets could not be prepared");
  const options = hintLayoutOptions.get(ir);
  const naturalPt = context.inspection.canvas.width.pt;
  const skip = skippedInTrials(context);
  return asHintTrial(() => {
    let trials = 0;
    const run = (copy: FigureIR) => {
      trials++;
      return layoutTrial(copy, options);
    };
    let baseline: Problems | undefined | null = null;
    const baselineProblems = (): Problems | undefined => {
      if (baseline !== null) return baseline;
      baseline = undefined;
      const base = run(ir);
      // The trial must redraw the figure as rendered, or nothing it shows can be trusted.
      if (base !== undefined && Math.abs(base.layout.canvas.width / 2 - naturalPt) < 0.01)
        baseline = problemsOf(context, base, assets.value, skip, context.source);
      return baseline;
    };
    const fits: { text: string; widthPt: number }[] = [];
    const rejected: { text: string; problem: string }[] = [];
    let broken = false;
    const attempt = (edit: readonly Part[], first: number[]) => {
      let values: number[] | undefined = first;
      let need = overflowPt;
      // One refinement: values that remove part of the overflow are lowered by the rest once.
      for (let round = 0; round < 2 && values !== undefined; round++) {
        if (trials >= MAX_FIT_TRIALS - (baseline === null ? 1 : 0)) return;
        const trial = run(edited(ir, edit, values));
        if (trial === undefined || trial.diagnostics.some((d) => d.severity === "error")) return;
        const width = trial.layout.canvas.width / 2;
        const text = edit.map((p, i) => valueText(p, values?.[i] as number)).join(", ");
        if (width > max + 1e-6) {
          need += width - max;
          values = naturalPt - width > 0 ? valuesFor(edit, need) : undefined;
          continue;
        }
        const before = baselineProblems();
        if (before === undefined) {
          broken = true;
          return;
        }
        const after = problemsOf(context, trial, assets.value, skip, context.source);
        if (after === undefined) return;
        const added = newProblems(before, after);
        if (added.length > 0)
          rejected.push({ text, problem: (added[0] as string).split(" ")[0] as string });
        else fits.push({ text: edit.length > 1 ? `${text} (together)` : text, widthPt: width });
        return;
      }
    };
    // Two fitting edits of a kind (gap, padding, width) are enough: try the other kinds instead.
    const kindOf = (part: Part) => Object.keys(part.patch)[0] as string;
    const found = new Map<string, number>();
    for (const single of singles) {
      if (broken || trials >= MAX_FIT_TRIALS) break;
      const kind = kindOf(single.parts[0] as Part);
      if ((found.get(kind) ?? 0) >= 2) continue;
      const before = fits.length;
      attempt(single.parts, single.values);
      if (fits.length > before) found.set(kind, (found.get(kind) ?? 0) + 1);
    }
    for (const combo of combos) {
      if (broken || fits.length > 0 || trials >= MAX_FIT_TRIALS) break;
      attempt(combo.parts, combo.values);
    }
    if (broken)
      return {
        fits: [],
        rejected: [],
        trials,
        skipped: "the unedited trial layout did not reproduce the figure",
      };
    return { fits, rejected, trials };
  });
}

/** The fitting part of the hint. */
export function describeFits(result: FitResult, maxWidthPt: number): string {
  if (result.fits.length > 0)
    return `Fits ${mm(maxWidthPt)} (verified: laid out, routed and linted as a trial, no new error or warning; apply one): ${result.fits
      .slice(0, 3)
      .map((f) => `${f.text} → ${mm(f.widthPt)}`)
      .join("; ")}.${
      result.rejected.length > 0
        ? ` Rejected: ${result.rejected[0]?.text} fits but adds ${result.rejected[0]?.problem}.`
        : ""
    }`;
  const rejected =
    result.rejected.length > 0
      ? ` ${result.rejected
          .slice(0, 2)
          .map((r) => `${r.text} would fit but adds ${r.problem}`)
          .join("; ")}.`
      : "";
  return result.skipped !== undefined
    ? `No fitting edit verified: ${result.skipped}.${rejected}`
    : `No single gap, padding or width edit on the width path verified to fit (${result.trials} trial layouts).${rejected}`;
}

/**
 * The whole tree, one line per entry, `*` on what sets the width, for
 * `--explain-width`; first the page: margins and anything beyond the
 * arranged content (`marginUnits` in layout units).
 */
export function widthTreeLines(
  tree: WidthEntry,
  pageWidthPt?: number,
  marginUnits?: number,
): string[] {
  const lines: string[] = [];
  if (pageWidthPt !== undefined && marginUnits !== undefined) {
    const margin = marginUnits / 2;
    const rest = pageWidthPt - tree.widthPt - 2 * margin;
    lines.push(
      `page ${mm(pageWidthPt)} (before fit: scale) = margins 2 × ${mm(margin)} + arranged content ${mm(tree.widthPt)}${rest > 0.5 ? ` + edges, sets or labels beyond it ${mm(rest)}` : ""}`,
    );
  }
  const visit = (entry: WidthEntry, depth: number, sets: boolean) => {
    lines.push(
      `${"  ".repeat(depth)}${sets ? "* " : "  "}${describe(entry, widest(entry.children))}`,
    );
    for (const child of entry.children) visit(child, depth + 1, sets && setsWidth(entry, child));
  };
  visit(tree, 0, true);
  return lines;
}

/** The width tree as JSON (`sumi render --explain-width --json`): lengths in pt, no IR references. */
export interface WidthTreeJson {
  name: string;
  kind: WidthEntry["kind"];
  widthPt: number;
  placedPt?: number;
  padding?: { westPt: number; eastPt: number; written: boolean };
  contentPt?: number;
  titlePt?: number;
  gap?: { pt: number; count: number; field: "gap" | "columnGap"; written: boolean };
  columnsPt?: number[];
  attachPt?: number;
  fixedPt?: number;
  labelPt?: number;
  leaf?: string;
  /** Grid items: column (0-based) and span. */
  column?: number;
  span?: number;
  /** Whether it sets its parent's width (all items of a row, the widest otherwise). */
  setsWidth: boolean;
  children: WidthTreeJson[];
}

export function widthTreeJson(entry: WidthEntry, sets = true): WidthTreeJson {
  const round = (pt: number) => Math.round(pt * 1000) / 1000;
  return {
    name: entry.name,
    kind: entry.kind,
    widthPt: round(entry.widthPt),
    ...(entry.placedPt !== undefined && { placedPt: round(entry.placedPt) }),
    ...(entry.padding && {
      padding: {
        westPt: entry.padding.west,
        eastPt: entry.padding.east,
        written: entry.padding.written,
      },
    }),
    ...(entry.contentPt !== undefined && { contentPt: round(entry.contentPt) }),
    ...(entry.titlePt !== undefined && { titlePt: round(entry.titlePt) }),
    ...(entry.gap && { gap: { ...entry.gap, pt: round(entry.gap.pt) } }),
    ...(entry.columnsPt && { columnsPt: entry.columnsPt.map(round) }),
    ...(entry.attachPt !== undefined && { attachPt: round(entry.attachPt) }),
    ...(entry.fixedPt !== undefined && { fixedPt: entry.fixedPt }),
    ...(entry.labelPt !== undefined && { labelPt: round(entry.labelPt) }),
    ...(entry.leaf !== undefined && { leaf: entry.leaf }),
    setsWidth: sets,
    ...(entry.column !== undefined && { column: entry.column, span: entry.span ?? 1 }),
    children: entry.children.map((child) => widthTreeJson(child, sets && setsWidth(entry, child))),
  };
}
