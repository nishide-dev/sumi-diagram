/**
 * `geometry/content-band` (#613, design record
 * `docs/design/decisions/613-content-align.md`): a group taller than its
 * content (a panel stretched to its neighbours' height by `align: stretch` or
 * `justify: stretch`) centres the content, so an empty band opens above it,
 * between the title and the first row, and another below it. The hint is
 * `contentAlign: top`, checked by doing it: the group's `contentAlign` is set
 * in a copy of the figure as laid out, which is laid out, routed, drawn and
 * linted like the figure (`trial.ts`). It is called verified only if the trial
 * has no error, the canvas keeps its size, the content then starts right under
 * the title and the geometry lint finds no new error or warning.
 *
 * Cost: nothing unless a group has both bands; then at most
 * {@link MAX_BAND_TRIALS} trial layouts per figure (one per group, in
 * document order) plus one of the figure as it is, each linted once, only
 * for figures `HintTrials` accepts and without HTML or external assets.
 */

import { loadFigureAssets } from "../../assets/load";
import type { FigureIR, GroupIR } from "../../compiler/ir";
import type { ElementKey } from "../../core/check-state";
import { formatDocPath } from "../../core/diagnostics";
import { mmToPt } from "../../core/units";
import { asHintTrial, HintTrials, hintLayoutOptions, inHintTrial } from "../../layout/hint-trials";
import type { LayoutIR, Rect } from "../../layout/ir";
import { panelRows } from "../../layout/structured/panels";
import { defineGeometryRule, type LintFinding } from "../rule";
import { capitalize, drawnUnits, mmText } from "./common";
import type { GeometryContext } from "./context";
import { layoutTrial, newProblems, type Problems, problemsOf } from "./trial";

export const CONTENT_BAND = "geometry/content-band";

/** The least band (printed, in units: 4mm) above and below the content that counts. */
export const MIN_BAND = mmToPt(4) * 2;

/** At most this many groups are checked by a trial layout per figure. */
export const MAX_BAND_TRIALS = 4;

/** A trial is linted by every geometry rule but this one. */
const SKIP: ReadonlySet<string> = new Set([CONTENT_BAND]);

/** A group with empty room above and below its content. */
export interface Band {
  readonly group: GroupIR;
  /** Empty room (units, drawn) between the top of the content area and the content. */
  readonly above: number;
  /** Empty room (units, drawn) between the content and the bottom of the content area. */
  readonly below: number;
}

/** The union of what a group's direct children take in `layout`: bodies and their texts. */
function contentBounds(layout: LayoutIR, key: ElementKey): Rect | undefined {
  const rects: Rect[] = [];
  for (const node of layout.nodes) {
    if (node.parent !== key) continue;
    rects.push(node.rect);
    if (node.label !== undefined) rects.push(node.label.box);
    if (node.sublabel !== undefined) rects.push(node.sublabel.box);
  }
  for (const group of layout.groups) {
    if (group.parent !== key) continue;
    rects.push(group.rect);
    if (group.label !== undefined) rects.push(group.label.box);
  }
  if (rects.length === 0) return undefined;
  const y0 = Math.min(...rects.map((r) => r.y));
  const y1 = Math.max(...rects.map((r) => r.y + r.height));
  const x0 = Math.min(...rects.map((r) => r.x));
  const x1 = Math.max(...rects.map((r) => r.x + r.width));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** The empty room above and below a group's content as placed (drawn units), or `undefined`. */
export function verticalBands(
  context: GeometryContext,
  key: ElementKey,
): { above: number; below: number } | undefined {
  const placed = context.placed;
  if (placed === undefined || placed.ir.meta.engine !== "structured") return undefined;
  return bandsOf(placed.layout, key);
}

/** The empty room above and below a group's content in `layout`, or `undefined`. */
function bandsOf(layout: LayoutIR, key: ElementKey): { above: number; below: number } | undefined {
  const group = layout.groups.find((g) => g.key === key);
  if (group === undefined || group.quad !== undefined) return undefined;
  const bounds = contentBounds(layout, key);
  if (bounds === undefined) return undefined;
  const { content } = group;
  return {
    above: bounds.y - content.y,
    below: content.y + content.height - (bounds.y + bounds.height),
  };
}

/**
 * The YAML that puts a group's content under its title (#641): `contentAlign: top`
 * at the group's path, and, when the group is one of two or more panels side by
 * side in a row that does not write `panels`, that row's `panels: true`.
 */
export function contentAlignYaml(
  context: GeometryContext,
  group: GroupIR,
): { readonly edit: string; readonly row?: string } | undefined {
  const element = context.get(group.key);
  if (element === undefined) return undefined;
  const path = formatDocPath([...element.docPath, "contentAlign"]);
  const edit = `writing contentAlign: top in ${element.name} (${path}; in YAML, the line "contentAlign: top" under "- id: ${group.id}")`;
  const placed = context.placed;
  if (placed === undefined) return { edit };
  const row = panelRows(placed.ir, (g) => context.get(g.key)?.docPath).find(
    (r) => r.box.panels !== true && r.panels.length > 1 && r.panels.includes(group),
  );
  return row === undefined ? { edit } : { edit, row: formatDocPath(row.path) };
}

/** The sentence pointing at a row's `panels: true` (#641) for the panels of `row`. */
export const panelsSentence = (row: string): string =>
  `To line up all the panels of ${row} at once (one height, content under the titles, one title band), write panels: true in that row instead.`;

/** Groups (document order) whose centred content leaves at least {@link MIN_BAND} above and below. */
export function contentBands(context: GeometryContext): Band[] {
  const placed = context.placed;
  if (placed === undefined || placed.ir.meta.engine !== "structured") return [];
  const least = drawnUnits(context, MIN_BAND);
  const out: Band[] = [];
  for (const group of placed.ir.groups) {
    // Written placements stay; a tilted plane, tokens, a matrix or a legend have no free content.
    if (group.contentAlign !== undefined || group.arrange === undefined) continue;
    if (group.plane !== undefined || group.tokens !== undefined) continue;
    if (group.matrix !== undefined || group.legend !== undefined) continue;
    const bands = bandsOf(placed.layout, group.key);
    if (bands === undefined || bands.above < least || bands.below < least) continue;
    out.push({ group, ...bands });
  }
  return out;
}

export type BandVerdict =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: "budget" | "large" | "failed" | "error" | "grows" | "baseline" | "problems";
      readonly problem?: string;
    };

const withContentAlign = (ir: FigureIR, key: ElementKey): FigureIR => ({
  ...ir,
  groups: ir.groups.map((g) => (g.key === key ? { ...g, contentAlign: "top" } : g)),
});

/** Lays out `contentAlign: top` for each band's group (in order, within the budget) and checks it. */
export function bandTrials(context: GeometryContext, bands: readonly Band[]): BandVerdict[] {
  const placed = context.placed;
  const failed = (reason: "failed" | "large") => bands.map(() => ({ ok: false, reason }) as const);
  if (placed === undefined || inHintTrial()) return failed("failed");
  const original = placed.ir;
  if (!new HintTrials(original).eligible) return failed("large");
  if (
    context.html?.size ||
    original.nodes.some((n) => n.image?.html !== undefined || n.image?.src !== undefined) ||
    [...(original.assets?.values() ?? [])].some((a) => a.src !== undefined)
  )
    return failed("failed");
  const assets = loadFigureAssets(original);
  if (!assets.ok) return failed("failed");
  const options = hintLayoutOptions.get(original);
  const { width, height } = placed.layout.canvas;
  return asHintTrial(() => {
    let baseline: Problems | undefined | null = null;
    const baselineProblems = (): Problems | undefined => {
      if (baseline !== null) return baseline;
      baseline = undefined;
      const base = layoutTrial(original, options);
      // The trial must redraw the figure as rendered, or nothing it shows can be trusted.
      if (base?.layout.canvas.width === width && base.layout.canvas.height === height)
        baseline = problemsOf(context, base, assets.value, SKIP, context.source);
      return baseline;
    };
    return bands.map((band, index): BandVerdict => {
      if (index >= MAX_BAND_TRIALS) return { ok: false, reason: "budget" };
      const trial = layoutTrial(withContentAlign(original, band.group.key), options);
      if (trial === undefined) return { ok: false, reason: "failed" };
      if (trial.diagnostics.some((d) => d.severity === "error"))
        return { ok: false, reason: "error" };
      const canvas = trial.layout.canvas;
      if (canvas.width !== width || canvas.height !== height) return { ok: false, reason: "grows" };
      const after = bandsOf(trial.placed.layout, band.group.key);
      if (after === undefined || after.above > 1) return { ok: false, reason: "failed" };
      const before = baselineProblems();
      if (before === undefined) return { ok: false, reason: "baseline" };
      const problems = problemsOf(context, trial, assets.value, SKIP, context.source);
      if (problems === undefined) return { ok: false, reason: "failed" };
      const added = newProblems(before, problems);
      if (added.length > 0)
        return {
          ok: false,
          reason: "problems",
          problem: (added[0] as string).split(" ")[0] as string,
        };
      return { ok: true };
    });
  });
}

const REASONS: Record<Exclude<BandVerdict, { ok: true }>["reason"], string> = {
  budget: `not checked (at most ${MAX_BAND_TRIALS} groups are laid out again per figure)`,
  large: "not checked (the figure is too large for trial layouts)",
  failed: "not checked (the trial layout could not be made or measured)",
  error: "not suggested: the trial layout reports an error",
  grows: "not suggested: the trial layout changes the figure's size",
  baseline: "not checked (the figure could not be laid out again as rendered)",
  problems: "not suggested: the trial adds",
};

export const contentBand = defineGeometryRule({
  id: CONTENT_BAND,
  description:
    "A group is taller than its content (stretched by its box) and centres it, leaving at least 4mm empty above and below; contentAlign: top, checked by laying the figure out again, puts the content under the title.",
  defaultSeverity: "info",
  fixable: false,
  run(context) {
    const bands = contentBands(context);
    if (bands.length === 0) return [];
    const verdicts = bandTrials(context, bands);
    return bands.flatMap((band, index): LintFinding[] => {
      const element = context.get(band.group.key);
      const yaml = contentAlignYaml(context, band.group);
      if (element === undefined || yaml === undefined) return [];
      const verdict = verdicts[index] as BandVerdict;
      const { edit } = yaml;
      const outcome = verdict.ok
        ? `Verified: ${edit} puts the content right under the title and leaves one ${mmText(context, band.above + band.below)} band at the bottom (laid out, routed and linted as a trial: same size, no new error or warning).`
        : `${capitalize(edit)} would put the content right under the title; ${REASONS[verdict.reason]}${verdict.reason === "problems" ? ` ${verdict.problem}` : ""}.`;
      return [
        {
          message: `${capitalize(element.name)} is taller than its content and centres it: ${mmText(context, band.above)} empty above the content and ${mmText(context, band.below)} below (the box stretches the group to its neighbours).`,
          path: element.docPath,
          subject: element.subject,
          hint: `${outcome} ${yaml.row === undefined ? "Sibling panels with contentAlign: top start their first rows on one line (matchLabelHeight evens out titles of different heights)." : panelsSentence(yaml.row)} Keep the centring if it is intended.`,
        },
      ];
    });
  },
});
