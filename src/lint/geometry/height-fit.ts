/**
 * Height fitting for sequence diagrams (#640, design record
 * `docs/design/decisions/640-fit-hints.md`): a `sequence` box (#630) is as
 * tall as its rows, each `rowGap` below the previous one, below the
 * participants' boxes. "Turn the tallest stack into a row" does not apply to
 * it; what does: a smaller `rowGap`, participant icons beside their labels
 * instead of above them, messages on separate lifelines side by side in one
 * band, and (with `figure.fit: scale`, which shrinks the height with the
 * width) narrower lifeline gaps.
 *
 * The `rowGap` values are checked by doing them, like the width hints
 * (`width-fit.ts`): the edited copy is laid out, routed, drawn and linted,
 * and a value is suggested only if the printed height then fits and no new
 * error or warning appears. Values below 1mm are tried only when nothing
 * else fits, as a last resort.
 *
 * Cost, only when a sequence figure is too tall: at most
 * {@link MAX_HEIGHT_TRIALS} trial layouts (the unedited baseline included),
 * each linted once, for figures of at most `MAX_FIT_ELEMENTS` elements
 * without HTML or external assets.
 */
import { loadFigureAssets } from "../../assets/load";
import type { ArrangeBoxIR, FigureIR, SequenceRowIR } from "../../compiler/ir";
import { getProfile } from "../../core/profile/builtin";
import { spacedProfile } from "../../core/profile/schema";
import { formatMm, mmToPt, ptToMm } from "../../core/units";
import { asHintTrial, hintLayoutOptions, inHintTrial, mapBoxes } from "../../layout/hint-trials";
import type { GeometryContext } from "./context";
import { layoutTrial, newProblems, type Problems, problemsOf } from "./trial";
import { MAX_FIT_ELEMENTS, skippedInTrials } from "./width-fit";

/** Trial layouts per diagnostic, the unedited baseline included. */
export const MAX_HEIGHT_TRIALS = 4;
/** A `rowGap` the hint keeps before going lower: rows still read as separate steps. */
export const INTENT_ROW_GAP_MM = 1;

/**
 * Rules a trial is not linted by: the page-size rules (the trial's size is
 * checked directly), and `geometry/relocatable-node` at its default info
 * level, as in the width trials (`skippedInTrials`): configured as warning
 * or error it counts.
 */
function skippedRules(context: GeometryContext): ReadonlySet<string> {
  return new Set([...skippedInTrials(context), "geometry/exceeds-page-height"]);
}

/** The sequence boxes of a figure (root and group arranges, nested boxes included), with how messages name them. */
export function sequenceBoxes(ir: FigureIR): { box: ArrangeBoxIR; path: string }[] {
  const out: { box: ArrangeBoxIR; path: string }[] = [];
  const visit = (box: ArrangeBoxIR, path: string) => {
    const name = `${path}.${box.kind}`;
    if (box.kind === "sequence" && box.sequence !== undefined) out.push({ box, path: name });
    box.items.forEach((item, i) => {
      if (item !== null && typeof item !== "string") visit(item, `${name}.items[${i}]`);
    });
  };
  if (ir.arrange !== undefined) visit(ir.arrange, "figure.layout.arrange");
  for (const group of ir.groups)
    if (group.arrange !== undefined) visit(group.arrange, `group "${group.id}".arrange`);
  return out;
}

/** How many times a sequence's rows add its `rowGap` (about once per row, and once below the heads and the last row). */
function rowGapCount(rows: readonly SequenceRowIR[]): number {
  let count = 0;
  for (const row of rows) {
    count += 1;
    if (row.kind === "fragment") count += rowGapCount(row.rows);
  }
  return count;
}

/** The `rowGap` of a sequence box in pt: written, or a third of the profile's arrange gap. */
function rowGapOf(ir: FigureIR, box: ArrangeBoxIR): { pt: number; written: boolean } {
  const written = box.sequence?.rowGapPt;
  if (written !== undefined) return { pt: written, written: true };
  const base = getProfile(ir.meta.profileId);
  const gapUnits = base ? spacedProfile(base, ir.meta.density).layout.arrangeGap.pt * 2 : 0;
  return { pt: Math.round(gapUnits / 3) / 2, written: false };
}

const trim = (value: number) => String(Math.round(value * 100) / 100);

/**
 * The options of the `geometry/exceeds-page-height` hint for a figure with a
 * sequence box, most effective first; `undefined` without one.
 */
export function sequenceHeightOptions(context: GeometryContext): string[] | undefined {
  const ir = context.placed?.ir ?? context.ir;
  if (ir.meta.engine !== "structured") return undefined;
  const boxes = sequenceBoxes(ir);
  if (boxes.length === 0) return undefined;
  const options: string[] = [];
  for (const { box, path } of boxes) {
    const seq = box.sequence;
    if (seq === undefined) continue;
    const gap = rowGapOf(ir, box);
    options.push(
      `reduce the \`rowGap\` of ${boxes.length > 1 ? path : "the sequence"} (now ${formatMm(gap.pt)}${gap.written ? "" : ", a third of the profile's gap"}; it is added about ${rowGapCount(seq.rows) + 1} times, once per row)`,
    );
    const tall = seq.participants.flatMap((key) => {
      const node = ir.nodes.find((n) => n.key === key);
      return node?.icon !== undefined && node.iconAt === "top" ? [node.id] : [];
    });
    if (tall.length > 0)
      options.push(
        `put the participants' icons beside their labels (\`iconAt: left\` on ${tall.map((id) => `"${id}"`).join(", ")}; \`top\` makes every head taller)`,
      );
  }
  options.push(
    "put messages and notes that use different lifelines side by side in one band row (`[a, b]` in `rows`)",
    "keep message labels on one line (each extra line makes its row taller) and drop rows the reader does not need",
  );
  if (ir.meta.fit === "scale")
    options.push(
      "narrow the figure (`participantGap`, shorter labels between lifelines): with `figure.fit: scale` a narrower figure is shrunk less, but a wider one is shrunk more, so the height also follows the width",
    );
  options.push("split the protocol into several figures (e.g. one per phase)");
  return options;
}

/**
 * `rowGap` values that make a too-tall sequence figure fit, verified by
 * trials (see the module comment), as hint text (with the reason when no
 * trial could run); empty for a figure without a sequence box, or inside
 * another trial.
 */
export function sequenceHeightFits(context: GeometryContext, overflowPt: number): string {
  const ir = context.placed?.ir ?? context.ir;
  const maxHeight = context.profile.maxHeightPt;
  const maxWidth = context.profile.maxWidthPt;
  const skipped = (reason: string) => `No rowGap verified: ${reason}.`;
  if (maxHeight === undefined || overflowPt <= 0) return "";
  if (inHintTrial() || ir.meta.engine !== "structured") return "";
  const boxes = sequenceBoxes(ir);
  if (boxes.length === 0) return "";
  if (context.placed === undefined) return skipped("the figure was not laid out by render");
  if (ir.elements.size > MAX_FIT_ELEMENTS)
    return skipped(`the figure has more than ${MAX_FIT_ELEMENTS} elements`);
  if (context.html?.size || ir.nodes.some((n) => n.image?.html !== undefined))
    return skipped("HTML assets require prepared rendering and measurements");
  if (
    ir.nodes.some((n) => n.image?.src !== undefined) ||
    [...(ir.assets?.values() ?? [])].some((a) => a.src !== undefined)
  )
    return skipped("external asset files are not loaded during trials");
  const assets = loadFigureAssets(ir);
  if (!assets.ok) return skipped("inline or bundled assets could not be prepared");
  const options = hintLayoutOptions.get(ir);
  const scale = context.inspection.scale ?? 1;
  const naturalHeight = context.inspection.canvas.height.pt;
  const printed = (layout: { canvas: { width: number; height: number } }) => {
    const width = layout.canvas.width / 2;
    const s = ir.meta.fit === "scale" && maxWidth !== undefined ? Math.min(1, maxWidth / width) : 1;
    return (layout.canvas.height / 2) * s;
  };
  // Candidates: one rowGap per sequence box, every box at its intent floor
  // first, then below the floors as a last resort (#640).
  const skip = skippedRules(context);
  const candidates = [false, true].flatMap((extreme) =>
    boxes.flatMap(({ box, path }) => {
      const seq = box.sequence;
      if (seq === undefined) return [];
      const gap = rowGapOf(ir, box);
      const count = rowGapCount(seq.rows) + 1;
      const floor = Math.min(gap.pt, mmToPt(INTENT_ROW_GAP_MM));
      return [{ box, path, gap, count, floor, extreme }];
    }),
  );
  return asHintTrial(() => {
    let trials = 0;
    let baseline: Problems | undefined | null = null;
    const baselineProblems = (): Problems | undefined => {
      if (baseline !== null) return baseline;
      baseline = undefined;
      trials++;
      const base = layoutTrial(ir, options);
      if (base !== undefined && Math.abs(base.layout.canvas.height / 2 - naturalHeight) < 0.01)
        baseline = problemsOf(context, base, assets.value, skip, context.source);
      return baseline;
    };
    const fits: string[] = [];
    const rejected: string[] = [];
    for (const candidate of candidates) {
      if (fits.length > 0 && candidate.extreme) break;
      if (fits.length > 0) continue;
      const least = candidate.extreme ? 0 : candidate.floor;
      // The natural height to remove, then once more by what the first try left.
      let need = overflowPt / scale;
      let previous: number | undefined;
      for (let round = 0; round < 2; round++) {
        if (trials >= MAX_HEIGHT_TRIALS - (baseline === null ? 1 : 0)) break;
        const valueMm =
          Math.floor(ptToMm(Math.max(least, candidate.gap.pt - need / candidate.count)) * 2) / 2;
        const value = mmToPt(valueMm);
        if (value < least - 1e-6 || value >= candidate.gap.pt - 1e-6 || value === previous) break;
        // The floor pass leaves a value under the floor to the last-resort pass.
        if (candidate.extreme && value >= candidate.floor - 1e-6) break;
        previous = value;
        const edited = mapBoxes(ir, (b, o) =>
          o === candidate.box && b.sequence !== undefined
            ? { ...b, sequence: { ...b.sequence, rowGapPt: value } }
            : b,
        );
        trials++;
        const trial = layoutTrial(edited, options);
        if (trial === undefined || trial.diagnostics.some((d) => d.severity === "error")) break;
        const height = printed(trial.layout);
        const text = `set the rowGap of ${candidate.path} to ${trim(valueMm)}mm (now ${formatMm(candidate.gap.pt)}) → ${formatMm(height)} tall${candidate.extreme ? " (last resort: rows nearly touch)" : ""}`;
        if (height > maxHeight + 1e-6) {
          if (!(height < naturalHeight * scale - 0.5)) break;
          need += (height - maxHeight) / scale;
          continue;
        }
        const before = baselineProblems();
        if (before === undefined) return "";
        const after = problemsOf(context, trial, assets.value, skip, context.source);
        if (after === undefined) break;
        const added = newProblems(before, after);
        if (added.length > 0)
          rejected.push(`${text} would fit but adds ${(added[0] as string).split(" ")[0]}`);
        else fits.push(text);
        break;
      }
    }
    if (fits.length > 0)
      return `Fits ${formatMm(maxHeight)} (verified: laid out, routed and linted as a trial, no new error or warning): ${fits.join("; ")}.`;
    return `No rowGap alone verified to fit (${trials} trial layouts)${rejected.length > 0 ? `; ${rejected[0]}` : ""}.`;
  });
}
