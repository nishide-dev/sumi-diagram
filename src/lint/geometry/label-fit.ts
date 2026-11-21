/**
 * The size that fits a label (#614, design record
 * `docs/design/decisions/614-missing-parts.md`): for a node whose written
 * `props.width` / `props.height` are too small for its label
 * (`geometry/label-overflow`), the smallest written size on a 0.5mm grid that
 * holds the label in the shape's text area, found on the drawn geometry (the
 * label lines kept on the shape's label centre, the area of the shape at the
 * new size), then checked by doing it: the size is written into a copy of the
 * figure, which is laid out, routed, drawn and linted like the figure
 * (`trial.ts`). It is called verified only if the trial has no layout error,
 * the label no longer overflows and the geometry lint finds no new error or
 * warning.
 *
 * Candidates keep the other side where it is written: a taller shape (the
 * width kept), a wider one (the height kept) and both grown in proportion; the
 * smallest area wins (a taller one on a tie, as the width is usually what a
 * page limits). A fixed-aspect shape (circle, square) only grows as a whole.
 *
 * Cost: nothing unless an explicitly sized node overflows; then at most
 * {@link MAX_FIT_TRIALS} trial layouts per figure (in document order) plus one
 * of the figure as it is, only for figures `HintTrials` accepts and without
 * HTML or external assets.
 */

import { loadFigureAssets } from "../../assets/load";
import type { FigureIR, NodeIR } from "../../compiler/ir";
import { mmToPt } from "../../core/units";
import { asHintTrial, HintTrials, hintLayoutOptions, inHintTrial } from "../../layout/hint-trials";
import { labelCenter } from "../../layout/structured/sizing";
import type { Rect } from "../../render/geometry";
import type { GeometryContext, GeometryElement } from "./context";
import { labelArea, rectDepthInside } from "./shapes";
import { layoutTrial, newProblems, type Problems, problemsOf } from "./trial";

/** At most this many overflowing nodes are checked by a trial layout per figure. */
export const MAX_FIT_TRIALS = 4;

/** Sizes are tried on this grid (mm), as an author writes them. */
const STEP_MM = 0.5;

/** No suggestion grows a side beyond this many times its written length. */
const MAX_GROWTH = 6;

/** A written size in mm (on the 0.5mm grid) and the layout units it parses to. */
export interface FitSize {
  readonly widthMm: number;
  readonly heightMm: number;
  /** Which sides change from what is written. */
  readonly changes: { readonly width: boolean; readonly height: boolean };
}

/** Layout units of a length written in mm: rounded to the nearest 0.5pt, as props parse it. */
const unitsOfMm = (mm: number): number => Math.round(mmToPt(mm) * 2);

const ceilStep = (mm: number): number => Math.ceil(mm / STEP_MM - 1e-9) * STEP_MM;

/** Whether `element`'s label lines fit inside its shape drawn `width × height` units. */
function fits(
  element: GeometryElement,
  node: NodeIR,
  bbox: Rect,
  margin: number,
  width: number,
  height: number,
): boolean {
  if (node.shape === "text") return true;
  const centre = labelCenter(node.shape, bbox, node.capDepth);
  const own = labelCenter(node.shape, { x: 0, y: 0, width, height }, node.capDepth);
  const rect = { x: centre.x - own.x, y: centre.y - own.y, width, height };
  const area = labelArea(node.shape, rect, node.capDepth);
  return element.labels
    .flatMap((l) => l.visibleLines)
    .every((line) => rectDepthInside(area, line) >= margin);
}

/**
 * The smallest written size that holds the label of an explicitly sized node,
 * or `undefined` when none within {@link MAX_GROWTH} does (or the node is not
 * a plain shape). Measured on the drawn geometry, before any trial.
 */
export function fittingSize(element: GeometryElement, margin: number): FitSize | undefined {
  const node = element.ir;
  const bbox = element.bbox;
  if (node.kind !== "node" || bbox === undefined) return undefined;
  if (node.render !== undefined || node.shape === "text" || node.labelBelow === true)
    return undefined;
  if (node.autoSized === true || (node.width === undefined && node.height === undefined))
    return undefined;
  const writtenW = node.width === undefined ? undefined : node.width.pt / mmToPt(1);
  const writtenH = node.height === undefined ? undefined : node.height.pt / mmToPt(1);
  const drawnW = bbox.width;
  const drawnH = bbox.height;
  const ok = (wMm: number | undefined, hMm: number | undefined) =>
    fits(
      element,
      node,
      bbox,
      margin,
      wMm === undefined ? drawnW : unitsOfMm(wMm),
      hMm === undefined ? drawnH : unitsOfMm(hMm),
    );
  const candidates: { size: FitSize; area: number; order: number }[] = [];
  const add = (wMm: number | undefined, hMm: number | undefined, order: number) => {
    const w = wMm === undefined ? drawnW : unitsOfMm(wMm);
    const h = hMm === undefined ? drawnH : unitsOfMm(hMm);
    candidates.push({
      size: {
        widthMm: wMm ?? writtenW ?? drawnW / (2 * mmToPt(1)),
        heightMm: hMm ?? writtenH ?? drawnH / (2 * mmToPt(1)),
        changes: { width: wMm !== undefined, height: hMm !== undefined },
      },
      area: w * h,
      order,
    });
  };
  const grow = (from: number, test: (mm: number) => boolean): number | undefined => {
    for (let mm = ceilStep(from); mm <= from * MAX_GROWTH; mm += STEP_MM) if (test(mm)) return mm;
    return undefined;
  };
  if (node.sizing === "fixed-aspect-1") {
    const side = writtenW ?? writtenH;
    if (side === undefined) return undefined;
    const fit = grow(side, (mm) => ok(mm, mm));
    if (fit !== undefined) add(fit, fit, 0);
  } else {
    if (writtenH !== undefined) {
      const h = grow(writtenH, (mm) => ok(writtenW, mm));
      if (h !== undefined) add(undefined, h, 0);
    }
    if (writtenW !== undefined) {
      const w = grow(writtenW, (mm) => ok(mm, writtenH));
      if (w !== undefined) add(w, undefined, 1);
    }
    if (writtenW !== undefined && writtenH !== undefined) {
      for (let k = 1; k <= MAX_GROWTH; k += 0.02) {
        const w = ceilStep(writtenW * k);
        const h = ceilStep(writtenH * k);
        if (ok(w, h)) {
          add(w, h, 2);
          break;
        }
      }
    }
  }
  candidates.sort((a, b) => a.area - b.area || a.order - b.order);
  return candidates[0]?.size;
}

export type FitVerdict =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason:
        | "budget"
        | "large"
        | "failed"
        | "error"
        | "baseline"
        | "overflow"
        | "problems";
      readonly problem?: string;
    };

const withSize = (ir: FigureIR, key: string, size: FitSize): FigureIR => ({
  ...ir,
  nodes: ir.nodes.map((n) => {
    if (n.key !== key) return n;
    const length = (mm: number) => {
      const units = unitsOfMm(mm);
      return { pt: units / 2, units };
    };
    return {
      ...n,
      ...(size.changes.width && { width: length(size.widthMm) }),
      ...(size.changes.height && { height: length(size.heightMm) }),
    };
  }),
});

/** Lays out each size (in order, within the budget) and checks it; `subjects` key the overflow findings. */
export function fitTrials(
  context: GeometryContext,
  fits: readonly { readonly key: string; readonly subject: unknown; readonly size: FitSize }[],
  /**
   * Whether the label of `subject` still overflows in a trial's lint context: the rule's own
   * findings at any configured level (an `info` or `off` label-overflow must not pass a trial).
   */
  overflows: (linted: GeometryContext, subject: unknown) => boolean,
): FitVerdict[] {
  const placed = context.placed;
  const failed = (reason: "failed" | "large") => fits.map(() => ({ ok: false, reason }) as const);
  if (fits.length === 0) return [];
  if (placed === undefined || inHintTrial()) return failed("failed");
  const original = placed.ir;
  if (original.meta.engine !== "structured") return failed("failed");
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
        baseline = problemsOf(context, base, assets.value, new Set(), context.source);
      return baseline;
    };
    return fits.map((fit, index): FitVerdict => {
      if (index >= MAX_FIT_TRIALS) return { ok: false, reason: "budget" };
      const trial = layoutTrial(withSize(original, fit.key, fit.size), options);
      if (trial === undefined) return { ok: false, reason: "failed" };
      if (trial.diagnostics.some((d) => d.severity === "error"))
        return { ok: false, reason: "error" };
      const before = baselineProblems();
      if (before === undefined) return { ok: false, reason: "baseline" };
      let still = true;
      const problems = problemsOf(
        context,
        trial,
        assets.value,
        new Set(),
        context.source,
        (linted) => {
          still = overflows(linted, fit.subject);
        },
      );
      if (problems === undefined) return { ok: false, reason: "failed" };
      if (still) return { ok: false, reason: "overflow" };
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

const REASONS: Record<Exclude<FitVerdict, { ok: true }>["reason"], string> = {
  budget: `not checked by a trial layout (at most ${MAX_FIT_TRIALS} nodes are laid out again per figure)`,
  large: "not checked by a trial layout (the figure is too large for trial layouts)",
  failed: "not checked by a trial layout (it could not be made or measured)",
  error: "the trial layout reports an error",
  baseline: "not checked by a trial layout (the figure could not be laid out again as rendered)",
  overflow: "the trial layout still finds the label too large (check the size by rendering)",
  problems: "the trial layout adds",
};

const mm = (value: number): string => `${Number(value.toFixed(2))}mm`;

/** The sentence a `label-overflow` hint ends with: the size, and whether a trial confirmed it. */
export function fitSentence(size: FitSize, verdict: FitVerdict): string {
  const sides = [
    ...(size.changes.width ? [`props.width: ${mm(size.widthMm)}`] : []),
    ...(size.changes.height ? [`props.height: ${mm(size.heightMm)}`] : []),
  ].join(", ");
  if (verdict.ok)
    return `Verified: ${sides} fits the label (laid out, routed and linted as a trial: the label fits, no new error or warning).`;
  if (verdict.reason === "problems")
    return `${sides} fits the label; ${REASONS.problems} ${verdict.problem ?? "a problem"}, so make room for it too.`;
  return `${sides} fits the label measured here; ${REASONS[verdict.reason]}.`;
}
