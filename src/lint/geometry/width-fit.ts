/**
 * Width fitting (#607, design `docs/design/decisions/607-width-fitting.md`):
 * the natural-width path that sets a structured figure's width, and edits
 * with concrete values (a gap, a group's padding, a node's width) that make
 * it fit the profile, each checked by doing it: the edited copy is laid out,
 * routed, drawn and linted like the figure (`trial.ts`), and only an edit
 * whose trial fits and adds no error or warning is suggested.
 *
 * Since #640 (design `docs/design/decisions/640-fit-hints.md`) the edits also
 * include a legend's `perRow`, a matrix's `flush` / `cellWidth` and `place`
 * x coordinates (`fit-candidates.ts`), keep gaps of 2mm and paddings of 4pt
 * before going lower (a last resort), and combine the narrowest partial edit
 * with one value of the width path it leaves.
 *
 * Cost, only when a figure is too wide (or shrunk by `fit: scale`): one more
 * placement for the width tree, then at most {@link MAX_FIT_TRIALS} trial
 * layouts (the unedited baseline included), each that fits linted once, and
 * one placement more for the width tree of a partial edit.
 */
import { loadFigureAssets } from "../../assets/load";
import type { ArrangeBoxIR, FigureIR } from "../../compiler/ir";
import type { ElementKey } from "../../core/check-state";
import { getProfile } from "../../core/profile/builtin";
import { spacedProfile } from "../../core/profile/schema";
import { formatMm, formatPt, mmToPt, ptToMm } from "../../core/units";
import { asHintTrial, hintLayoutOptions, inHintTrial, mapBoxes } from "../../layout/hint-trials";
import type { PaddingGrowth } from "../../layout/route/padding";
import { structuredWidthTree } from "../../layout/structured/engine";
import { PARTICIPANT_GAP } from "../../layout/structured/sequence";
import { setsWidth, type WidthEntry, widest, widthPath } from "../../layout/structured/width-tree";
import { unitsToPt } from "../../render/geometry";
import type { GeometryContext } from "./context";
import { elementCandidates, type FitCandidate } from "./fit-candidates";
import { layoutTrial, newProblems, type Problems, problemsOf } from "./trial";

/** Trial layouts per diagnostic, the unedited baseline included. */
export const MAX_FIT_TRIALS = 10;
/** Larger figures get the width path only (each trial is linted in full). */
export const MAX_FIT_ELEMENTS = 240;

/**
 * Rules a trial is not linted by: the width rules themselves (the trial is
 * checked for fitting directly; a narrower figure scales less, so its text
 * only grows). `geometry/relocatable-node` is skipped only at its default
 * info level: configured as warning or error it runs in the trial too (it
 * then lays out its own candidates; the trials keep the arrange items, so
 * its hint still points at the same YAML items).
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
    case "sequence": {
      const gaps = entry.sequence?.gaps ?? [];
      const wide = [...gaps].sort((a, b) => b.pt - a.pt)[0];
      return `${entry.name} ${w}, ${gaps.length + 1} lifelines ${gaps.map((g) => mm(g.pt)).join(" + ")} apart${
        wide === undefined
          ? ""
          : ` (widest: "${wide.between[0]}" to "${wide.between[1]}" ${mm(wide.pt)}, set by ${
              wide.reason === PARTICIPANT_GAP
                ? `participantGap ${mm(entry.sequence?.participantGap.pt ?? 0)}${entry.sequence?.participantGap.written ? "" : " (profile default)"} between the participants' boxes`
                : wide.reason
            })`
      }`;
    }
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
      const pad = entry.padding ? ` + ${paddingText(entry.padding)}` : "";
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

/**
 * A group's padding as text: `padding 8pt + 8pt (profile default)`, and when
 * the layout grew it for the room before arrowheads (#171, #512), what was
 * written, by how much each side grew and why (#640).
 */
export function paddingText(padding: NonNullable<WidthEntry["padding"]>): string {
  const { west, east, written, grown } = padding;
  const source = written ? "props.padding" : "profile default";
  if (grown === undefined)
    return `padding ${formatPt(west)} + ${formatPt(east)}${written ? "" : ` (${source})`}`;
  const base = west - grown.west;
  const amount =
    Math.abs(grown.west - grown.east) < 0.01
      ? `${formatPt(grown.west)} on both sides`
      : `${formatPt(grown.west)} west, ${formatPt(grown.east)} east`;
  return `padding ${formatPt(west)} + ${formatPt(east)} (${source} ${formatPt(base)}, grown automatically by ${amount}: ${growthText(grown.reasons)})`;
}

/** Why a padding grew, from `PaddingGrowth` records (#640). */
export function growthText(reasons: readonly PaddingGrowth[]): string {
  const quoted = (edges: Iterable<string>) => {
    const list = [...new Set(edges)];
    const shown = list.slice(0, 3).map((e) => `"${e}"`);
    return `${list.length === 1 ? "edge" : "edges"} ${shown.join(", ")}${list.length > 3 ? ` and ${list.length - 3} more` : ""}`;
  };
  const parts: string[] = [];
  const seen = new Set<string>();
  for (const reason of reasons) {
    const id = `${reason.kind}|${reason.side}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const same = reasons.filter((r) => r.kind === reason.kind && r.side === reason.side);
    const edges = quoted(same.flatMap((r) => r.edges));
    const side = `the ${reason.side} side`;
    switch (reason.kind) {
      case "fan-out":
        parts.push(
          `the arrowheads of ${edges}, which fan out from one port outside the group to its members, enter through ${side} and turn in its padding (#512)`,
        );
        break;
      case "fan-in":
        parts.push(
          `${edges} from outside the group join before one port of a member on ${side} and turn in its padding (#512)`,
        );
        break;
      case "u-turn":
        parts.push(`${edges} turn back into a member through ${side}`);
        break;
      case "inside":
        parts.push(`the arrowhead of ${edges} inside the group faces ${side} (#171)`);
        break;
      default:
        parts.push(
          `${side} grows as much as the opposite one, so the content stays centred in the frame (#247)`,
        );
    }
  }
  // Mirrored sides last: they follow from the others.
  parts.sort((a, b) => Number(a.includes("(#247)")) - Number(b.includes("(#247)")));
  return parts.length === 0 ? "room before arrowheads" : parts.join("; ");
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
  /**
   * The least value that keeps the figure's intent (#640): a gap of 2mm
   * still holds a line or an arrowhead, a padding of 4pt still reads as a
   * frame around its content. Values below it are tried last.
   */
  readonly floor: number;
  /** Values are multiples of this step. */
  readonly step: number;
  /** Page width removed per unit of the value, in pt (a row's gap counts once per gap). */
  readonly weight: number;
  readonly now: string;
  readonly patch:
    | { readonly box: ArrangeBoxIR; readonly field: "gapPt" | "columnGapPt" }
    | { readonly sequence: ArrangeBoxIR }
    | { readonly group: ElementKey }
    | { readonly node: ElementKey };
}

/** Spacing the hints keep before going lower (#640): a gap or `participantGap` of 2mm. */
export const INTENT_GAP_MM = 2;
/** A group padding the hints keep before going lower (#640). */
export const INTENT_PADDING_PT = 4;

/**
 * Values for `parts` that remove `overflowPt`, sharing it in proportion to
 * what each can give down to its intent floor (`extreme`: down to its least
 * valid value); `undefined` if they cannot.
 */
function valuesFor(
  parts: readonly Part[],
  overflowPt: number,
  extreme = false,
): number[] | undefined {
  const low = (p: Part) => (extreme ? p.least : p.floor);
  const room = parts.reduce((sum, p) => sum + p.weight * (p.current - low(p)), 0);
  if (room < overflowPt - 1e-6 || room <= 0) return undefined;
  const share = overflowPt / room;
  const values = parts.map((p) =>
    Math.max(low(p), floorTo(p.current - share * (p.current - low(p)), p.step)),
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
  const sequences = new Map<ArrangeBoxIR, number>();
  const paddings = new Map<ElementKey, number>();
  const widths = new Map<ElementKey, number>();
  parts.forEach((part, i) => {
    const value = values[i] as number;
    const { patch } = part;
    if ("box" in patch)
      boxes.set(patch.box, { ...boxes.get(patch.box), [patch.field]: mmToPt(value) });
    else if ("sequence" in patch) sequences.set(patch.sequence, mmToPt(value));
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
      const participantGapPt = sequences.get(o);
      const out = patch === undefined ? b : { ...b, ...patch };
      return participantGapPt === undefined || out.sequence === undefined
        ? out
        : { ...out, sequence: { ...out.sequence, participantGapPt } };
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
        floor: Math.min(ptToMm(gap.pt), INTENT_GAP_MM),
        step: 0.5,
        weight: gap.count * mmToPt(1),
        now: `${mm(gap.pt)}${gap.written ? "" : ", the profile default"}`,
        patch: { box, field: gap.field === "gap" ? "gapPt" : "columnGapPt" },
      });
    // A sequence (#630): its participantGap narrows the gaps no label, note or frame widens.
    const set = entry.sequence?.gaps.filter((g) => g.reason === PARTICIPANT_GAP).length ?? 0;
    if (entry.kind === "sequence" && box && entry.sequence && set > 0)
      out.push({
        what: `${entry.name}.participantGap`,
        unit: "mm",
        current: ptToMm(entry.sequence.participantGap.pt),
        least: 0,
        floor: Math.min(ptToMm(entry.sequence.participantGap.pt), INTENT_GAP_MM),
        step: 0.5,
        weight: set * mmToPt(1),
        now: `${mm(entry.sequence.participantGap.pt)}${entry.sequence.participantGap.written ? "" : ", the profile default"}`,
        patch: { sequence: box },
      });
    // A padding the layout grew for arrowheads (#171, #512) stays as wide whatever is written.
    if (
      entry.kind === "group" &&
      entry.key &&
      entry.padding &&
      entry.padding.grown === undefined &&
      entry.leaf === undefined
    ) {
      const key = entry.key;
      const group = ir.groups.find((g) => g.key === key);
      const written = group?.paddingPt ?? groupPad;
      if (group !== undefined && written !== undefined && written > 0.5)
        out.push({
          what: `props.padding of group "${group.id}"`,
          unit: "pt",
          current: written,
          least: 0.5,
          floor: Math.min(written, INTENT_PADDING_PT),
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
        floor: least,
        step: 0.5,
        weight: mmToPt(1),
        now: mm(node.width.pt),
        patch: { node: key },
      });
    }
  }
  return out;
}

/**
 * Sequence message labels (#630) that set a gap between lifelines on the
 * width path, folded at the space nearest their middle: the widest alone,
 * then all of them together.
 */
function labelWraps(
  ir: FigureIR,
  tree: WidthEntry,
): { labels: Map<ElementKey, string>; text: string }[] {
  const found: { key: ElementKey; id: string; label: string; pt: number }[] = [];
  for (const entry of widthPath(tree))
    for (const gap of entry.sequence?.gaps ?? []) {
      const edge = gap.edge === undefined ? undefined : ir.edges.find((e) => e.key === gap.edge);
      if (edge === undefined || found.some((f) => f.key === edge.key)) continue;
      const label = foldLabel(edge.label);
      if (label !== undefined)
        found.push({ key: edge.key, id: edge.id ?? `edges[${edge.index}]`, label, pt: gap.pt });
    }
  found.sort((a, b) => b.pt - a.pt);
  const text = (list: typeof found) =>
    `fold the label${list.length > 1 ? "s" : ""} of ${list
      .map((f) => `message "${f.id}" onto two lines (label: ${JSON.stringify(f.label)})`)
      .join(", ")}`;
  const candidates = [found.slice(0, 1), ...(found.length > 1 ? [found] : [])];
  return candidates
    .filter((list) => list.length > 0)
    .map((list) => ({ labels: new Map(list.map((f) => [f.key, f.label])), text: text(list) }));
}

/** A one-line label broken at the space nearest its middle; `undefined` without one. */
function foldLabel(label: string): string | undefined {
  if (label.includes("\n")) return undefined;
  const middle = label.length / 2;
  let best = -1;
  for (let i = 0; i < label.length; i++)
    if (label[i] === " " && (best < 0 || Math.abs(i - middle) < Math.abs(best - middle))) best = i;
  return best <= 0 ? undefined : `${label.slice(0, best)}\n${label.slice(best + 1)}`;
}

export interface FitResult {
  /** Edits whose trial fits the profile and adds no error or warning, with the page width after. */
  readonly fits: readonly { text: string; widthPt: number; extreme?: boolean }[];
  /** Edits whose trial fits but adds problems (code of the first). */
  readonly rejected: readonly { text: string; problem: string; extreme?: boolean }[];
  /** Edits whose trial narrows the figure without making it fit (laid out, not linted), narrowest first. */
  readonly partial?: readonly { text: string; widthPt: number }[];
  /** Trial layouts run (the baseline included). */
  readonly trials: number;
  /** Why no trial ran, if none did. */
  readonly skipped?: string;
}

/** Fitting edits enough for a hint: the trials stop once this many fit. */
const ENOUGH_FITS = 3;

/**
 * Edits with concrete values that bring the natural page width to the
 * profile's maximum, each verified by a trial (see the module comment), in
 * this order (#640):
 *
 * 1. the legend, matrix or `place` edits for the item that ends the width
 *    path (`fit-candidates.ts`), then one value on the width path at a time
 *    (a gap, a padding, a width, a sequence's `participantGap`), smallest
 *    change first, keeping the intent floors (gaps 2mm, paddings 4pt);
 * 2. the legend and matrix edits for other items that set the width;
 * 3. the gaps and paddings together, then with the explicit widths, each
 *    giving its share down to its floor;
 * 4. sequence message labels folded onto two lines;
 * 5. only when nothing above fits, the same values below the floors (a gap
 *    of 0mm): reported as a last resort.
 *
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
  /** Values of `group` written into `base` (the figure, or a partial edit of it named by `prefix`). */
  const numeric = (
    group: readonly Part[],
    extreme: boolean,
    base: FigureIR = ir,
    prefix?: string,
  ): FitCandidate => ({
    kind: group.length > 1 ? "together" : (Object.keys((group[0] as Part).patch)[0] as string),
    extreme,
    make: (need) => {
      const values = valuesFor(group, need, extreme);
      if (values === undefined) return undefined;
      const text = [prefix, ...group.map((p, i) => valueText(p, values[i] as number))]
        .filter(Boolean)
        .join(", ");
      return {
        ir: edited(base, group, values),
        text: group.length > 1 || prefix !== undefined ? `${text} (together)` : text,
      };
    },
  });
  // One value at a time, the smallest change first: the share of the current value it removes.
  const singles = (extreme: boolean, list = parts, base = ir, prefix?: string, need = overflowPt) =>
    list
      .flatMap((part) => {
        const values = valuesFor([part], need, extreme);
        const c =
          values === undefined ? undefined : (part.current - (values[0] as number)) / part.current;
        // Extreme: only the values that cannot fit within the floor.
        return c === undefined || (extreme && valuesFor([part], need, false) !== undefined)
          ? []
          : [{ part, c }];
      })
      .sort((a, b) => a.c - b.c)
      .map(({ part }) => numeric([part], extreme, base, prefix));
  // Together: the spacing first (gaps and paddings), then with the explicit widths too.
  const spacing = parts.filter((p) => !("node" in p.patch));
  const combos = (extreme: boolean) =>
    [spacing, parts].flatMap((group, i) =>
      group.length < 2 ||
      (i === 1 && group.length === spacing.length) ||
      valuesFor(group, overflowPt, extreme) === undefined
        ? []
        : [numeric(group, extreme)],
    );
  const elements = elementCandidates(ir, tree, context.source, (key) => {
    const box = context.get(key)?.labels[0]?.box;
    return box === undefined ? undefined : unitsToPt(box.width);
  });
  const last = widthPath(tree).at(-1);
  // The edits of the item that ends the width path (the widest contributor) go first.
  const ending = (c: FitCandidate) => last !== undefined && c.target === last.name;
  const wraps = labelWraps(ir, tree).map(
    (wrap): FitCandidate => ({
      kind: "wrap",
      extreme: false,
      make: () => ({
        ir: mapBoxes(
          {
            ...ir,
            edges: ir.edges.map((e) => {
              const label = wrap.labels.get(e.key);
              return label === undefined ? e : { ...e, label };
            }),
          },
          (b) => b,
        ),
        text: wrap.text,
      }),
    }),
  );
  const stages: { candidates: FitCandidate[]; whileNone: boolean }[] = [
    {
      candidates: [
        ...elements.filter(ending),
        ...singles(false),
        ...elements.filter((c) => !ending(c)),
      ],
      whileNone: false,
    },
    { candidates: combos(false), whileNone: true },
    { candidates: wraps, whileNone: true },
    { candidates: [...singles(true), ...combos(true)], whileNone: true },
  ];
  if (stages.every((s) => s.candidates.length === 0))
    return none(
      parts.length === 0
        ? "nothing on the width path can be reduced by a trial (no gap, padding, explicit width, legend perRow, matrix cellWidth or flush, or place coordinate)"
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
    const left = () => MAX_FIT_TRIALS - trials - (baseline === null ? 1 : 0);
    const fits: { text: string; widthPt: number; extreme?: boolean }[] = [];
    const rejected: { text: string; problem: string; extreme?: boolean }[] = [];
    const partial: { text: string; widthPt: number; ir: FigureIR }[] = [];
    let broken = false;
    const attempt = (candidate: FitCandidate, first = overflowPt) => {
      let need = first;
      let delta = 0;
      let previous: string | undefined;
      let narrowest: { text: string; widthPt: number; ir: FigureIR } | undefined;
      // One refinement: an edit that removes part of the overflow is made again for the rest once.
      for (let round = 0; round < 2; round++) {
        if (left() <= 0) break;
        let made = candidate.make(need);
        // Values on a step (0.5mm, a whole perRow) may not move for a small rest: ask for more.
        for (let k = 0; k < 6 && made !== undefined && made.text === previous; k++) {
          delta *= 2;
          need += delta;
          made = candidate.make(need);
        }
        if (made === undefined || made.text === previous) break;
        previous = made.text;
        const trial = run(made.ir);
        if (trial === undefined || trial.diagnostics.some((d) => d.severity === "error")) break;
        const width = trial.layout.canvas.width / 2;
        if (width > max + 1e-6) {
          if (width < naturalPt - 0.5 && (narrowest === undefined || width < narrowest.widthPt))
            narrowest = { text: made.text, widthPt: width, ir: made.ir };
          if (!(width < naturalPt - 0.5)) break;
          delta = Math.max(width - max, 0.25);
          need += delta;
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
          rejected.push({
            text: made.text,
            problem: (added[0] as string).split(" ")[0] as string,
            ...(candidate.extreme && { extreme: true }),
          });
        else
          fits.push({
            text: made.text,
            widthPt: width,
            ...(candidate.extreme && { extreme: true }),
          });
        return;
      }
      if (narrowest !== undefined) partial.push(narrowest);
    };
    // Two fitting edits of a kind (gap, padding, width, legend, …) are enough: try the other kinds instead.
    const found = new Map<string, number>();
    for (const stage of stages) {
      if (stage.whileNone && fits.length > 0) break;
      for (const candidate of stage.candidates) {
        if (broken || left() <= 0 || fits.length >= ENOUGH_FITS) break;
        if ((found.get(candidate.kind) ?? 0) >= 2) continue;
        const before = fits.length;
        attempt(candidate);
        if (fits.length > before) found.set(candidate.kind, (found.get(candidate.kind) ?? 0) + 1);
      }
    }
    partial.sort((a, b) => a.widthPt - b.widthPt);
    // The narrowest partial edit with one value of its own width path (#640: a legend's
    // perRow and the gap of the row that then sets the width, run 2 of #639).
    const best = partial[0];
    if (!broken && fits.length === 0 && best !== undefined && left() > 0) {
      let next: WidthEntry | undefined;
      try {
        next = structuredWidthTree(best.ir, options);
      } catch {
        next = undefined;
      }
      const need = best.widthPt - max;
      if (next !== undefined)
        for (const candidate of singles(false, partsOf(best.ir, next), best.ir, best.text, need)) {
          if (broken || left() <= 0 || fits.length > 0) break;
          attempt(candidate, need);
        }
    }
    if (broken)
      return {
        fits: [],
        rejected: [],
        trials,
        skipped: "the unedited trial layout did not reproduce the figure",
      };
    return {
      fits,
      rejected,
      ...(partial.length > 0 && {
        partial: [...partial]
          .sort((a, b) => a.widthPt - b.widthPt)
          .filter((p) => !fits.some((f) => f.text.startsWith(p.text)))
          .map(({ text, widthPt }) => ({ text, widthPt })),
      }),
      trials,
    };
  });
}

/** The fitting part of the hint. */
export function describeFits(result: FitResult, maxWidthPt: number): string {
  const lastResort = (f: { extreme?: boolean }) =>
    f.extreme ? " (last resort: below 2mm between items or 4pt of padding)" : "";
  if (result.fits.length > 0)
    return `Fits ${mm(maxWidthPt)} (verified: laid out, routed and linted as a trial, no new error or warning; apply one): ${result.fits
      .slice(0, 3)
      .map((f) => `${f.text} → ${mm(f.widthPt)}${lastResort(f)}`)
      .join("; ")}.${
      result.rejected.length > 0
        ? ` Rejected: ${result.rejected[0]?.text} fits but adds ${result.rejected[0]?.problem}.`
        : ""
    }`;
  const rejected =
    result.rejected.length > 0
      ? ` ${result.rejected
          .slice(0, 2)
          .map((r) => `${r.text}${lastResort(r)} would fit but adds ${r.problem}`)
          .join("; ")}.`
      : "";
  const partial =
    result.partial !== undefined && result.partial.length > 0
      ? ` Narrower but not enough alone (laid out, not linted; combine them or add another change): ${result.partial
          .slice(0, 2)
          .map((p) => `${p.text} → ${mm(p.widthPt)}`)
          .join("; ")}.`
      : "";
  return result.skipped !== undefined
    ? `No fitting edit verified: ${result.skipped}.${rejected}`
    : `No single edit on the width path verified to fit (${result.trials} trial layouts).${rejected}${partial}`;
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
  padding?: {
    westPt: number;
    eastPt: number;
    written: boolean;
    /** What the layout added for the room before arrowheads, and why (#640). */
    grown?: {
      westPt: number;
      eastPt: number;
      reasons: { side: string; kind: PaddingGrowth["kind"]; edges: string[]; pt: number }[];
    };
  };
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
        ...(entry.padding.grown && {
          grown: {
            westPt: round(entry.padding.grown.west),
            eastPt: round(entry.padding.grown.east),
            reasons: entry.padding.grown.reasons.map((r) => ({
              side: r.side,
              kind: r.kind,
              edges: [...r.edges],
              pt: round(r.units / 2),
            })),
          },
        }),
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
