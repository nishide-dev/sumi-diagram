/**
 * Edge labels the router placed away from where they read as the line's
 * (#610, design record `docs/design/decisions/610-edge-labels.md`):
 *
 * - `geometry/edge-label-detached`: the letters sit farther from their own
 *   line than the label gap plus three quarters of the text size, so the
 *   label reads as free text (a label lifted off a short span past the boxes
 *   beside it, #332);
 * - `geometry/edge-label-touches-line`: the letters touch or cross their own
 *   line.
 *
 * Only labels the router places on its own are checked: an orthogonal edge
 * without `labelAt`, `labelSide` or `labelStyle: tag` (those stay where they
 * are asked to be, and their overlaps are `layout/edge-label-overlap`), not
 * `route: straight` / `curve` (their labels keep the gap by construction),
 * and not legend samples.
 *
 * The hint is checked by doing it: `labelAt: middle`, `start`, `end`, then
 * `labelStyle: tag` are set in turn on a copy of the figure as compiled,
 * which is routed again on the same placement, drawn and linted like the
 * figure (`trial.ts`). An edit is called verified only if the trial has no
 * error, the canvas does not grow, the label then sits within the gap (a
 * tag, on its line) and the geometry lint finds no new error or warning.
 *
 * Cost: nothing unless a label drifts; then at most
 * {@link MAX_LABEL_TRIALS} trial routings per figure (the edits of the
 * drifting labels in document order, stopping at the first verified one per
 * label) plus one of the figure as it is, each linted once; only for figures
 * `HintTrials` accepts and without HTML or external assets.
 */

import { loadFigureAssets } from "../../assets/load";
import type { EdgeIR, FigureIR } from "../../compiler/ir";
import type { ElementKey } from "../../core/check-state";
import { formatDocPath } from "../../core/diagnostics";
import { asHintTrial, HintTrials, inHintTrial } from "../../layout/hint-trials";
import { hasRequestedLabel, labelGap } from "../../layout/route/labels";
import { resolveLintConfig } from "../config";
import { defineGeometryRule, isGeometryRule, type LintFinding } from "../rule";
import { isDrawnEdge, isStructured, mmText } from "./common";
import type { GeometryContext, GeometryElement } from "./context";
import { inkGlyphs } from "./measure";
import { polylinesRectDistance } from "./proximity";
import { newProblems, type Problems, routeTrial, type Trial, trialContext } from "./trial";

export const EDGE_LABEL_DETACHED = "geometry/edge-label-detached";
export const EDGE_LABEL_TOUCHES_LINE = "geometry/edge-label-touches-line";

/** How far beyond the label gap, in font sizes, the letters may sit before the label counts as detached. */
export const DETACHED_FONT_SIZES = 0.75;

/** At most this many trial routings per figure (besides the one of the figure as it is). */
export const MAX_LABEL_TRIALS = 8;

/**
 * Trials are linted by every geometry rule but these, which would start trials of their own.
 * `geometry/edge-label-detached` and `geometry/edge-label-touches-line` are not run from the
 * configuration in a trial either: `lintTrial` detects drifting labels itself, at any level, so
 * a trial that moves another edge's label off or onto its line is turned down.
 */
const SKIP: ReadonlySet<string> = new Set([
  // By id, not imported: those modules sit in the rule list's import cycle.
  "geometry/relocatable-node",
  "geometry/content-band",
]);

/** An edit of an edge that moves its label, as written in YAML. */
export interface LabelEdit {
  readonly field: "labelAt" | "labelStyle";
  readonly value: string;
}

/** The edits tried, in order. */
export const LABEL_EDITS: readonly LabelEdit[] = [
  { field: "labelAt", value: "middle" },
  { field: "labelAt", value: "start" },
  { field: "labelAt", value: "end" },
  { field: "labelStyle", value: "tag" },
];

/** A drifting label: its edge, and how far its letters are from its line. */
export interface Drift {
  readonly edge: GeometryElement;
  readonly kind: "detached" | "touching";
  /** Stroke to letters, drawn units (≤ 0: touching or crossing). */
  readonly gap: number;
  /** The most the letters may be from the line before the label counts as detached. */
  readonly limit: number;
}

/** Whether the router placed this edge's label on its own (the labels these rules check). */
function routerPlaced(element: GeometryElement): element is GeometryElement & { ir: EdgeIR } {
  const edge = element.ir;
  return (
    edge.kind === "edge" &&
    edge.legend === undefined &&
    edge.route === undefined &&
    edge.routing !== "zoom" &&
    !hasRequestedLabel(edge) &&
    isDrawnEdge(element) &&
    element.drawn !== undefined &&
    element.labels.length > 0
  );
}

/**
 * Stroke to letters (drawn units) of an edge's label from its own line, glyph by glyph
 * (`inkGlyphs`: a line through the space between words touches nothing), and the limit for it.
 */
function measure(element: GeometryElement): { gap: number; limit: number } | undefined {
  const edge = element.ir;
  const drawn = element.drawn;
  if (edge.kind !== "edge" || drawn === undefined || element.labels.length === 0) return undefined;
  const inks = element.labels.flatMap(inkGlyphs);
  if (inks.length === 0) return undefined;
  const gap =
    Math.min(...inks.map((ink) => polylinesRectDistance(drawn, ink))) - element.strokeInset;
  const size = Math.max(...element.labels.map((l) => l.label.fontSizeUnits));
  return { gap, limit: labelGap(edge.style) + DETACHED_FONT_SIZES * size };
}

/** The router-placed labels that sit too far from their line or touch it. */
export function drifts(context: GeometryContext): Drift[] {
  if (!isStructured(context)) return [];
  const out: Drift[] = [];
  for (const element of context.elements) {
    if (!routerPlaced(element)) continue;
    const m = measure(element);
    if (m === undefined) continue;
    if (m.gap <= 0) out.push({ edge: element, kind: "touching", ...m });
    else if (m.gap > m.limit) out.push({ edge: element, kind: "detached", ...m });
  }
  return out;
}

/** The outcome of trying the edits on one drifting label. */
export type LabelVerdict =
  | { readonly ok: true; readonly edit: LabelEdit; readonly gap?: number }
  | {
      readonly ok: false;
      readonly reason: "inside" | "large" | "failed" | "baseline" | "budget" | "none";
    };

/**
 * A trial's errors and warnings (as `problemsIn`), and every finding's rule by subject (any
 * level). Drifting labels are always detected here, whatever level the configuration gives
 * this file's rules (even off): a verified hint must not move another label off or onto its line.
 */
export interface TrialLint {
  readonly problems: Problems;
  readonly bySubject: ReadonlyMap<string, ReadonlySet<string>>;
}

export function lintTrial(linted: GeometryContext, trial: Trial): TrialLint {
  const config = linted.lintConfig ?? resolveLintConfig();
  const problems: Problems = new Map();
  const bySubject = new Map<string, Set<string>>();
  const add = (code: string, subject: unknown, counted: boolean) => {
    const key = JSON.stringify(subject ?? null);
    if (counted) problems.set(`${code} ${key}`, (problems.get(`${code} ${key}`) ?? 0) + 1);
    const codes = bySubject.get(key) ?? new Set<string>();
    codes.add(code);
    bySubject.set(key, codes);
  };
  for (const d of trial.diagnostics)
    add(d.code, d.subject, d.severity === "error" || d.severity === "warning");
  for (const { rule, severity, options, explicitSeverity } of config.rules) {
    if (!isGeometryRule(rule) || SKIP.has(rule.id) || DRIFT_CODES.includes(rule.id)) continue;
    for (const f of rule.run(linted, options)) {
      const level = explicitSeverity ? severity : (f.severity ?? severity);
      add(rule.id, f.subject, level === "error" || level === "warning");
    }
  }
  // Detection only, independent of the configuration (see above).
  for (const drift of drifts(linted)) {
    add(
      drift.kind === "detached" ? EDGE_LABEL_DETACHED : EDGE_LABEL_TOUCHES_LINE,
      drift.edge.subject,
      false,
    );
  }
  return { problems, bySubject };
}

const DRIFT_CODES: readonly string[] = [EDGE_LABEL_DETACHED, EDGE_LABEL_TOUCHES_LINE];

/** Whether `after` reports a drifting label for a subject `before` did not. */
export function driftsAdded(before: TrialLint, after: TrialLint): boolean {
  return [...after.bySubject].some(([subject, codes]) =>
    DRIFT_CODES.some((code) => codes.has(code) && !before.bySubject.get(subject)?.has(code)),
  );
}

const withEdit = (ir: FigureIR, key: ElementKey, edit: LabelEdit): FigureIR => {
  const changed = (e: EdgeIR): EdgeIR =>
    edit.field === "labelAt"
      ? { ...e, labelAt: edit.value as EdgeIR["labelAt"] & string }
      : { ...e, labelStyle: edit.value as NonNullable<EdgeIR["labelStyle"]> };
  const edges = ir.edges.map((e) => (e.key === key ? changed(e) : e));
  return {
    ...ir,
    edges,
    elements: new Map([...ir.groups, ...ir.nodes, ...edges].map((e) => [e.key, e])),
  };
};

/**
 * Tries the edits on each drifting label (in order, within the budget) by
 * routing the figure again, and returns a verdict per label.
 */
export function labelTrials(context: GeometryContext, found: readonly Drift[]): LabelVerdict[] {
  const none = (reason: Exclude<LabelVerdict, { ok: true }>["reason"]) =>
    found.map((): LabelVerdict => ({ ok: false, reason }));
  if (inHintTrial()) return none("inside");
  const placed = context.placed;
  const rendered = context.layout;
  if (placed === undefined || rendered === undefined) return none("failed");
  const original = placed.ir;
  if (!new HintTrials(original).eligible) return none("large");
  if (
    context.html?.size ||
    original.nodes.some((n) => n.image?.html !== undefined || n.image?.src !== undefined) ||
    [...(original.assets?.values() ?? [])].some((a) => a.src !== undefined)
  )
    return none("failed");
  const assets = loadFigureAssets(original);
  if (!assets.ok) return none("failed");
  const { width, height } = rendered.canvas;
  return asHintTrial(() => {
    let baseline: TrialLint | undefined | null = null;
    const baselineProblems = (): TrialLint | undefined => {
      if (baseline !== null) return baseline;
      baseline = undefined;
      const base = routeTrial(original, placed.layout);
      if (base === undefined) return baseline;
      // The trial must redraw the figure as rendered, or nothing it shows can be trusted.
      const same =
        base.layout.canvas.width === width &&
        base.layout.canvas.height === height &&
        rendered.edges.every((e) => {
          const again = base.layout.edges.find((x) => x.key === e.key)?.route?.label?.box;
          const box = e.route?.label?.box;
          if (again === undefined || box === undefined) return again === box;
          return again.x === box.x && again.y === box.y;
        });
      if (!same) return baseline;
      const linted = trialContext(context, base, assets.value, context.source);
      if (linted !== undefined) baseline = lintTrial(linted, base);
      return baseline;
    };
    let budget = MAX_LABEL_TRIALS;
    return found.map((drift): LabelVerdict => {
      for (const edit of LABEL_EDITS) {
        if (budget <= 0) return { ok: false, reason: "budget" };
        const before = baselineProblems();
        if (before === undefined) return { ok: false, reason: "baseline" };
        budget--;
        const trial = routeTrial(withEdit(original, drift.edge.key, edit), placed.layout);
        if (trial === undefined || trial.diagnostics.some((d) => d.severity === "error")) continue;
        const canvas = trial.layout.canvas;
        if (canvas.width > width + 1e-6 || canvas.height > height + 1e-6) continue;
        const linted = trialContext(context, trial, assets.value, context.source);
        if (linted === undefined) continue;
        const moved = linted.get(drift.edge.key);
        if (moved === undefined) continue;
        let gap: number | undefined;
        if (edit.field === "labelAt") {
          const m = measure(moved);
          if (m === undefined || m.gap <= 0 || m.gap > m.limit) continue;
          gap = m.gap;
        }
        const after = lintTrial(linted, trial);
        if (newProblems(before.problems, after.problems).length > 0) continue;
        // Nothing new about the edge itself either, infos included (a tag on a corner, a label
        // pressed against its line).
        const subject = JSON.stringify(drift.edge.subject ?? null);
        const had = before.bySubject.get(subject) ?? new Set<string>();
        if ([...(after.bySubject.get(subject) ?? [])].some((code) => !had.has(code))) continue;
        // No other label drifts that did not before (these rules' findings are infos, or
        // warnings counted above only by subject).
        if (driftsAdded(before, after)) continue;
        return { ok: true, edit, ...(gap !== undefined && { gap }) };
      }
      return { ok: false, reason: "none" };
    });
  });
}

const tried = LABEL_EDITS.map((e) => `${e.field}: ${e.value}`).join(", ");

const REASONS: Record<Exclude<LabelVerdict, { ok: true }>["reason"], string> = {
  inside: "",
  large: "No edit was checked (the figure is too large for trial routings).",
  failed: "No edit was checked (the figure could not be routed again or measured).",
  baseline: "No edit was checked (the figure could not be routed again as rendered).",
  budget: `No edit was checked (at most ${MAX_LABEL_TRIALS} trial routings per figure).`,
  none: `None of ${tried} was clear when routed again (each grew the figure, left the label off its line, added an error or warning, or added a finding about the edge).`,
};

function findingsOf(context: GeometryContext, kind: Drift["kind"]): LintFinding[] {
  const all = drifts(context);
  if (all.length === 0) return [];
  // One set of trials serves both rules: run them once per context.
  let verdicts = cache.get(context);
  if (verdicts === undefined) {
    verdicts = labelTrials(context, all);
    cache.set(context, verdicts);
  }
  return all.flatMap((drift, i): LintFinding[] => {
    if (drift.kind !== kind) return [];
    const { edge } = drift;
    const verdict = verdicts[i] as LabelVerdict;
    let hint: string;
    if (verdict.ok) {
      const path = formatDocPath([...edge.docPath, verdict.edit.field]);
      const effect =
        verdict.edit.field === "labelStyle"
          ? "draws the label as a tag on its line"
          : `puts the label ${mmText(context, verdict.gap ?? 0, 2)} from its line`;
      hint = `Verified: setting ${path} to ${verdict.edit.value} ${effect} (routed again on the same placement and linted as a trial: the figure does not grow, no new error or warning, nothing new about the edge).`;
    } else {
      const general =
        kind === "detached"
          ? "Place the label with labelAt (start, middle, end or a fraction such as 0.3) and labelSide, draw it on the line with labelStyle: tag, or widen the gap so the span can hold it."
          : "Place the label with labelAt (start, middle, end or a fraction such as 0.3) and labelSide, draw it on the line with labelStyle: tag, or lengthen the segment it sits beside.";
      hint = [general, REASONS[verdict.reason]].filter(Boolean).join(" ");
    }
    const text = JSON.stringify(edge.labels.map((l) => l.texts.join(" ")).join(" "));
    return [
      {
        message:
          kind === "detached"
            ? `The label ${text} of ${edge.name} sits ${mmText(context, drift.gap, 1)} from its line (more than ${mmText(context, drift.limit, 1)}, the label gap plus three quarters of its text size), so it reads as free text rather than the line's label.`
            : `The label ${text} of ${edge.name} ${drift.gap < 0 ? "crosses" : "touches"} its own line.`,
        path: [...edge.docPath, "label"],
        subject: edge.subject,
        hint,
      },
    ];
  });
}

const cache = new WeakMap<GeometryContext, LabelVerdict[]>();

export const edgeLabelDetached = defineGeometryRule({
  id: EDGE_LABEL_DETACHED,
  description:
    "An edge label the router placed (no labelAt, labelSide or labelStyle) sits farther from its own line than the label gap plus three quarters of its text size; the hint is an edit checked by routing the figure again.",
  defaultSeverity: "info",
  fixable: false,
  run: (context) => findingsOf(context, "detached"),
});

export const edgeLabelTouchesLine = defineGeometryRule({
  id: EDGE_LABEL_TOUCHES_LINE,
  description:
    "The letters of an edge label the router placed (no labelAt, labelSide or labelStyle) touch or cross its own line; the hint is an edit checked by routing the figure again.",
  defaultSeverity: "warning",
  fixable: false,
  run: (context) => findingsOf(context, "touching"),
});
