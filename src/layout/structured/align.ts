/**
 * Alignment across arrange trees (#132, design doc §6.31; #124 §3.5): solves
 * `figure.layout.align` with struts, without a constraint solver.
 *
 * The engine's single pass (`engine.ts`) takes struts: extra space before
 * (`lead`) or after (`trail`) an item along its box's main axis, in visual
 * order (above / below in a stack, left / right in a row, whatever the
 * `direction`). Without struts it is the plain pass. This module is a
 * fixed-point loop around it. Each round, for each constraint whose items are
 * not on one line yet (their `at` coordinate on the axis within
 * {@link ALIGN_EPSILON}):
 *
 * - a `lead` of the shortfall before the first item (the topmost /
 *   leftmost) on its path, which pushes it down / right;
 * - a `trail` of the shortfall after the last item, which pushes it up /
 *   left inside an end-aligned box (or, in a start-aligned one, grows the box
 *   and moves nothing);
 * - with three or more items, a `lead` before every item short of the last
 *   (each by its own shortfall), and a `trail` after every item beyond the
 *   first: items tied at an extreme move together (moving one of two items
 *   level at the top does not change the constraint's range, so the single
 *   moves alone would never make progress);
 *
 * where "on its path" is the deepest box along the axis (a stack for `y`, a
 * row for `x`) on the way from the root to the item whose item on that way
 * holds no other item of the constraint, and that is not a `gap: 0` box: its
 * items are drawn as one unit (a block and its Add & Norm), so the strut goes
 * to an ancestor, which keeps them touching. An attached node takes its
 * target's path (it moves with the target). Multi-line tokens take only the
 * path to their common arrange item: struts must not distort their lines.
 *
 * The candidates are laid out and the one with the smallest total residual
 * (the sum of every constraint's range) is kept if it is smaller than before;
 * on a tie, the one with the smaller canvas (#155), then the earlier. When the
 * greedy pass stalls, a two-step lookahead tries each current candidate and
 * generates second-step candidates from its trial layout. Only a pair whose
 * total strictly improves the original state is accepted, ranked by the same
 * residual / canvas rule. Every trial shares the layout budget. The loop
 * stops when every constraint is met (the largest single residual within
 * {@link ALIGN_EPSILON}: the sum is only the objective; many met constraints
 * must not hide an unmet one), when neither search makes progress, after
 * {@link MAX_ALIGN_ROUNDS} rounds, or when {@link MAX_ALIGN_LAYOUTS} layouts
 * are spent (then with
 * `layout/align-search-limit`, warning). Struts only grow, so constraints that
 * contradict each other or the trees stop with a residual, reported per
 * constraint as `layout/unsatisfied-align` (warning; the figure is drawn with
 * the best layout found). Centring can couple otherwise disjoint constraints:
 * growing one branch moves its other items too. Even doubling a strut to
 * compensate for its half-effect can worsen the total residual (#213,
 * design doc §6.58). Lookahead can escape this single-step minimum, but does
 * not guarantee convergence; a start-aligned parent can avoid this coupling
 * for table headings when the fallback cannot solve it.
 * Struts can grow the figure: when a side of the
 * canvas grows by more than {@link ALIGN_GROWTH_MM} and
 * {@link ALIGN_GROWTH_RATIO} over the plain pass, `layout/align-grew-figure`
 * (info) says by how much (#155).
 *
 * Side effects (#646): a strut lands in one gap and moves what follows it, so
 * the solve also reports, as infos, a gap between two items of a stack or row
 * that it widened well past its written neighbours (`layout/align-widened-gap`,
 * silenced with `alignGrowth: allow` like the growth) and frames that a box
 * with `align: stretch` gave one size and that no longer match
 * (`layout/align-uneven-stretch`). A constraint's `move` lists the items that
 * may take struts; the others never move for it, so a note can move to its
 * cell instead of the cell moving to the note.
 *
 * Deterministic: constraints in document order, Map iteration in insertion
 * order, the engine's own rounding.
 */

import type { AlignIR, ArrangeBoxIR, ArrangeItemIR, FigureIR } from "../../compiler/ir";
import type { ElementKey } from "../../core/check-state";
import { type Diagnostic, formatDocPath, type RelatedInformation } from "../../core/diagnostics";
import { SEPARATOR_ID } from "../../core/registry/builtins";
import type { LayoutIR, Rect } from "../ir";
import { crossStretchable } from "./sizing";

/** Space added around arrange items, in units (see the module comment). */
export interface Struts {
  readonly lead: ReadonlyMap<ArrangeItemIR, number>;
  readonly trail: ReadonlyMap<ArrangeItemIR, number>;
  /**
   * Space across the box's main axis (#545): left / right of an item in a
   * stack, above / below it in a row. For an item that sits in a stack and
   * must move sideways (an `x` constraint), without a one-item row around it.
   */
  readonly crossLead: ReadonlyMap<ArrangeItemIR, number>;
  readonly crossTrail: ReadonlyMap<ArrangeItemIR, number>;
  /**
   * The constraints whose accepted candidates put space of each kind at each
   * item (#646), in the order they did; read by the side-effect diagnostics
   * only. Keyed by kind as well as item: a constraint that adds space on the
   * other axis or side of the same item did not widen this gap.
   */
  readonly causes?: ReadonlyMap<StrutKind, ReadonlyMap<ArrangeItemIR, readonly AlignIR[]>>;
}

export const NO_STRUTS: Struts = Object.freeze({
  lead: new Map(),
  trail: new Map(),
  crossLead: new Map(),
  crossTrail: new Map(),
});

type StrutKind = "lead" | "trail" | "crossLead" | "crossTrail";

/** A strut: its kind and the item it is at. */
interface StrutAt {
  readonly kind: StrutKind;
  readonly item: ArrangeItemIR;
}

/** A constraint is met when its items' coordinates differ by at most this (units). */
export const ALIGN_EPSILON = 0.01;

/** Total residuals closer than this (units) tie: floating-point noise. */
const TIE = 1e-9;

/** The most rounds of the fixed-point loop. */
export const MAX_ALIGN_ROUNDS = 50;

/**
 * The most layouts one figure's alignment computes (candidates and diagnostic
 * probes included): a deterministic bound on the time.
 */
export const MAX_ALIGN_LAYOUTS = 1000;

/** How the constraints were solved (for tests and the design doc's measurements). */
export interface AlignStats {
  /** Rounds of the loop (0 if the first layout met every constraint). */
  readonly rounds: number;
  /** Layouts computed: the first, every candidate and the diagnostic probes. */
  readonly layouts: number;
  /** The residual of each constraint in units, rounded to 1/1000 (0 when met). */
  readonly residuals: readonly number[];
  /** Struts added: `lead <item>` / `trail <item>` (an element key, or `box#n`) → units. */
  readonly struts: Readonly<Record<string, number>>;
}

export interface AlignResult {
  readonly layout: LayoutIR;
  readonly diagnostics: Diagnostic[];
  readonly stats: AlignStats;
}

/** The stopping rule: every constraint within {@link ALIGN_EPSILON} (the largest, not the sum). */
export function converged(residuals: readonly number[]): boolean {
  return Math.max(0, ...residuals) <= ALIGN_EPSILON;
}

interface Step {
  readonly box: ArrangeBoxIR;
  readonly item: ArrangeItemIR;
}

/** A step that can take a strut, and whether it is a cross-axis one (#545). */
interface StrutStep extends Step {
  readonly cross: boolean;
}

type MutableStruts = { [K in StrutKind]: Map<ArrangeItemIR, number> } & {
  causes: Map<StrutKind, ReadonlyMap<ArrangeItemIR, readonly AlignIR[]>>;
};

/** Bounds of the search (tests lower them). */
export interface AlignLimits {
  /** Rounds of the loop; default {@link MAX_ALIGN_ROUNDS}. */
  readonly maxRounds?: number;
  /** Layouts computed in all, diagnostic probes included; default {@link MAX_ALIGN_LAYOUTS}. */
  readonly maxLayouts?: number;
}

type Trial = { struts: Struts; layout: LayoutIR; residuals: number[]; total: number };

/** Whether `key` may take a strut for `c`: every item, unless `move` (#646) names some. */
function mayMove(c: AlignIR, key: ElementKey): boolean {
  return c.move === undefined || c.move.includes(key);
}

/** Whether an element may take cross-axis space: not a cell of a `tokens` row or a matrix (#545). */
function holdsCross(ir: FigureIR, key: ElementKey): boolean {
  const element = ir.elements.get(key);
  return !(
    element?.kind === "node" &&
    (element.tokens !== undefined || element.matrix !== undefined)
  );
}

/**
 * Solves `constraints` (the figure's `align`) with `layoutWith`, the engine's
 * pass with struts. Space along the main axis only first; if a constraint is
 * still unmet and an item of it sits in a box of the other kind (an `x`
 * item in a stack), the search runs again with cross-axis struts (#545) and
 * keeps that result only if it leaves less distance. A figure that meets its
 * constraints without them is laid out exactly as before.
 */
export function solveAlignment(
  ir: FigureIR,
  constraints: readonly AlignIR[],
  layoutWith: (struts: Struts) => LayoutIR,
  limits: AlignLimits = {},
): AlignResult {
  const first = solveOnce(ir, constraints, layoutWith, limits, false);
  if (converged(first.stats.residuals)) return first;
  const budget = (limits.maxLayouts ?? MAX_ALIGN_LAYOUTS) - first.stats.layouts;
  if (budget <= 0) return first;
  // Only an item held directly by a box of the other kind can take one.
  const pathOf = paths(ir);
  const holdable = constraints.some((c) =>
    c.items.some((key) => {
      if (!mayMove(c, key)) return false;
      const own = pathOf.get(key)?.at(-1);
      return (
        holdsCross(ir, key) &&
        own?.item === key &&
        own.box.gapPt !== 0 &&
        own.box.kind === (c.axis === "y" ? "row" : "stack")
      );
    }),
  );
  if (!holdable) return first;
  const second = solveOnce(ir, constraints, layoutWith, { ...limits, maxLayouts: budget }, true);
  const spent = first.stats.layouts + second.stats.layouts;
  const better = sum(second.stats.residuals) < sum(first.stats.residuals) - TIE;
  const chosen = better ? second : first;
  return { ...chosen, stats: { ...chosen.stats, layouts: spent } };
}

function solveOnce(
  ir: FigureIR,
  constraints: readonly AlignIR[],
  layoutWith: (struts: Struts) => LayoutIR,
  limits: AlignLimits,
  allowCross: boolean,
): AlignResult {
  const maxRounds = limits.maxRounds ?? MAX_ALIGN_ROUNDS;
  const maxLayouts = limits.maxLayouts ?? MAX_ALIGN_LAYOUTS;
  const pathOf = paths(ir);
  let layouts = 0;
  /** Lays out with `struts`, or `undefined` once the budget is spent. */
  const run = (struts: Struts): LayoutIR | undefined => {
    if (layouts >= maxLayouts) return undefined;
    layouts++;
    return layoutWith(struts);
  };
  /**
   * The deepest step along `c.axis` on `key`'s path that can take a strut for
   * `c`; failing that (the item sits in a stack for `x`, in a row for `y`),
   * the box that holds the item itself, when it is the other kind of box,
   * which takes a cross-axis strut (#545).
   */
  const stepFor = (key: ElementKey, c: AlignIR): StrutStep | undefined => {
    if (!mayMove(c, key)) return undefined;
    const others = c.items.filter((k) => k !== key);
    const free = (s: Step) =>
      s.box.gapPt !== 0 &&
      !others.some((o) => (pathOf.get(o) ?? []).some((p) => p.item === s.item));
    const path = [...(pathOf.get(key) ?? [])].reverse();
    const along = path.find((s) => s.box.kind === (c.axis === "y" ? "stack" : "row") && free(s));
    if (along !== undefined) return { ...along, cross: false };
    if (!allowCross || !holdsCross(ir, key)) return undefined;
    // Only the box that holds the item itself: a branch moves as a unit otherwise.
    const own = path[0];
    const crossKind = c.axis === "y" ? "row" : "stack";
    return own !== undefined && own.item === key && own.box.kind === crossKind && free(own)
      ? { ...own, cross: true }
      : undefined;
  };
  /** `base` plus struts of `kind` (each added to what is there) for constraint `c`. */
  const add = (
    base: Struts,
    kind: StrutKind,
    struts: readonly (readonly [ArrangeItemIR, number])[],
    c: AlignIR,
  ): Struts => {
    const next: MutableStruts = {
      lead: new Map(base.lead),
      trail: new Map(base.trail),
      crossLead: new Map(base.crossLead),
      crossTrail: new Map(base.crossTrail),
      causes: new Map(base.causes),
    };
    const causes = new Map(next.causes.get(kind));
    for (const [item, value] of struts) {
      next[kind].set(item, (next[kind].get(item) ?? 0) + value);
      const known = causes.get(item) ?? [];
      if (!known.includes(c)) causes.set(item, [...known, c]);
    }
    next.causes.set(kind, causes);
    return next;
  };
  const kindOf = (step: StrutStep, side: "lead" | "trail"): StrutKind =>
    step.cross ? (side === "lead" ? "crossLead" : "crossTrail") : side;
  /**
   * The candidates for an unmet constraint, in trial order: a lead before the
   * first item, a trail after the last, and, with three or more items, a lead
   * before every item short of the last (each by its own shortfall) and a
   * trail after every item beyond the first. The last two move tied extremes
   * together: with two items level at the top, moving one alone does not
   * change the constraint's range.
   */
  const candidatesFor = (layout: LayoutIR, c: AlignIR, base: Struts): Struts[] => {
    const ps = coordinates(rectsOf(layout), c).sort((a, b) => a.value - b.value);
    const first = ps[0];
    const last = ps[ps.length - 1];
    if (first === undefined || last === undefined) return [];
    const short = last.value - first.value;
    if (short <= ALIGN_EPSILON) return [];
    const out: Struts[] = [];
    const a = stepFor(first.key, c);
    if (a !== undefined) out.push(add(base, kindOf(a, "lead"), [[a.item, short]], c));
    const b = stepFor(last.key, c);
    if (b !== undefined) out.push(add(base, kindOf(b, "trail"), [[b.item, short]], c));
    if (ps.length > 2) {
      const all = (side: "lead" | "trail", gapOf: (p: Coordinate) => number) => {
        // One candidate per strut kind (main-axis and cross-axis steps do not mix).
        const steps = ps.flatMap((p) => {
          const step = gapOf(p) > ALIGN_EPSILON ? stepFor(p.key, c) : undefined;
          return step === undefined ? [] : [{ step, value: gapOf(p) }];
        });
        for (const cross of [false, true]) {
          const struts = steps
            .filter((e) => e.step.cross === cross)
            .map((e) => [e.step.item, e.value] as const);
          const kind: StrutKind = cross ? (side === "lead" ? "crossLead" : "crossTrail") : side;
          if (struts.length > 1) out.push(add(base, kind, struts, c));
        }
      };
      all("lead", (p) => last.value - p.value);
      all("trail", (p) => p.value - first.value);
    }
    return out;
  };

  let struts: Struts = NO_STRUTS;
  const plain = run(struts) as LayoutIR;
  let layout = plain;
  let residuals = residualsOf(layout, constraints);
  let total = sum(residuals);
  let rounds = 0;
  let exhausted = false;
  while (!exhausted && rounds < maxRounds && !converged(residuals)) {
    rounds++;
    const before = total;
    for (const c of constraints) {
      let best: Trial | undefined;
      for (const candidate of candidatesFor(layout, c, struts)) {
        const l = run(candidate);
        if (l === undefined) {
          exhausted = true;
          break;
        }
        const r = residualsOf(l, constraints);
        const trial: Trial = { struts: candidate, layout: l, residuals: r, total: sum(r) };
        if (best === undefined || better(trial, best)) best = trial;
      }
      const chosen = best as Trial | undefined;
      if (chosen !== undefined && chosen.total < total - TIE) {
        struts = chosen.struts;
        layout = chosen.layout;
        residuals = chosen.residuals;
        total = chosen.total;
      }
      if (exhausted) break;
    }
    if (total < before - TIE) continue;
    if (exhausted) break;

    // Keep the original state until a whole pair improves it. The first
    // step may reopen a met constraint, so generate the second steps from
    // that trial, including constraints that had no candidates before it.
    let best: Trial | undefined;
    lookahead: for (const c of constraints) {
      for (const first of candidatesFor(layout, c, struts)) {
        const intermediate = run(first);
        if (intermediate === undefined) {
          exhausted = true;
          break lookahead;
        }
        for (const next of constraints) {
          for (const second of candidatesFor(intermediate, next, first)) {
            const l = run(second);
            if (l === undefined) {
              exhausted = true;
              break lookahead;
            }
            const r = residualsOf(l, constraints);
            const trial: Trial = { struts: second, layout: l, residuals: r, total: sum(r) };
            if (trial.total < total - TIE && (best === undefined || better(trial, best))) {
              best = trial;
            }
          }
        }
      }
    }
    const chosen = best as Trial | undefined;
    if (chosen === undefined) break;
    struts = chosen.struts;
    layout = chosen.layout;
    residuals = chosen.residuals;
    total = chosen.total;
  }

  const unsatisfiedDiagnostics: Diagnostic[] = [];
  for (const [index, c] of constraints.entries()) {
    const residual = residuals[index] ?? 0;
    if (residual <= ALIGN_EPSILON) continue;
    const ps = coordinates(rectsOf(layout), c).sort((x, y) => x.value - y.value);
    const first = (ps[0] as Coordinate).key;
    const last = (ps[ps.length - 1] as Coordinate).key;
    // Whether any candidate changes this constraint at all: if none does, the
    // items cannot be moved relative to each other. Probes count against the
    // budget; once it is spent the answer is unknown and the hint is the
    // general one.
    let movable = false;
    for (const candidate of candidatesFor(layout, c, struts)) {
      const l = run(candidate);
      if (l === undefined) exhausted = true;
      if (l === undefined || Math.abs(residualOf(rectsOf(l), c) - residual) > ALIGN_EPSILON) {
        movable = true;
        break;
      }
    }
    unsatisfiedDiagnostics.push(
      unsatisfied(ir, constraints, index, residual, first, last, movable),
    );
  }
  // After the probes, which can spend the budget too.
  const diagnostics: Diagnostic[] = [];
  if (exhausted && unsatisfiedDiagnostics.length > 0) {
    diagnostics.push({
      code: "layout/align-search-limit",
      severity: "warning",
      message: `The budget of ${maxLayouts} layouts for figure.layout.align ran out with ${unsatisfiedDiagnostics.length} of ${constraints.length} constraints unmet; the figure uses the best layout found.`,
      path: ["figure", "layout", "align"],
      subject: { kind: "figure", id: ir.meta.id },
      hint: "Use fewer align constraints, or arrange the elements so that fewer struts are needed (e.g. put the elements to align in boxes of their own).",
    });
  }
  diagnostics.push(...unsatisfiedDiagnostics);
  diagnostics.push(...splitTokens(ir, constraints, struts, pathOf));
  diagnostics.push(...unevenStretch(ir, constraints, struts, plain, layout, pathOf));
  if (ir.meta.alignGrowth !== "allow") {
    diagnostics.push(...widenedGaps(ir, constraints, struts, plain, layout, pathOf));
    const growth = grewFigure(ir, plain, layout);
    if (growth !== undefined) diagnostics.push(growth);
  }
  const stats: AlignStats = {
    rounds,
    layouts,
    residuals: residuals.map((r) => Math.round(r * 1000) / 1000),
    struts: strutRecord(struts),
  };
  return { layout, diagnostics, stats };
}

/**
 * `layout/align-splits-tokens` (#517): a strut inside a single-line tokens
 * node pulls its cells apart (the row of cells gains a gap that its siblings
 * do not have). The constraint is met, but the sequence is no longer a
 * sequence, and nothing else says so.
 */
function splitTokens(
  ir: FigureIR,
  constraints: readonly AlignIR[],
  struts: Struts,
  pathOf: ReadonlyMap<ElementKey, Step[]>,
): Diagnostic[] {
  const out: Diagnostic[] = [];
  const reported = new Set<string>();
  for (const [kind, map] of [
    ["lead", struts.lead],
    ["trail", struts.trail],
  ] as const) {
    for (const [item, value] of map) {
      if (typeof item !== "string" || value <= ALIGN_EPSILON) continue;
      const element = ir.elements.get(item as ElementKey);
      const step = pathOf.get(item as ElementKey)?.at(-1);
      if (element?.kind !== "node" || element.tokens === undefined || step === undefined) continue;
      const tokens = element.tokens;
      if (reported.has(tokens.id)) continue;
      const cells = step.box.items.filter(
        (i): i is ElementKey =>
          typeof i === "string" && ir.elements.get(i)?.tokens?.id === tokens.id,
      );
      if (cells.length < 2 || cells.length !== step.box.items.length) continue;
      const reversed = step.box.direction === "left" || step.box.direction === "up";
      const index = cells.indexOf(item as ElementKey);
      const visual = reversed ? cells.length - 1 - index : index;
      const inside = kind === "lead" ? visual > 0 : visual < cells.length - 1;
      if (!inside) continue;
      reported.add(tokens.id);
      const cellRef = (key: string) => {
        const e = ir.elements.get(key as ElementKey);
        return e?.kind === "node" ? e.id.replace(`${tokens.id}-`, `${tokens.id}.`) : key;
      };
      const constraint = constraints.find((c) => c.items.includes(item as ElementKey));
      // `move` (#646): the constraint's other items can move instead of the cell.
      const others = constraint?.items.filter((k) => k !== item).map((k) => refOf(ir, k)) ?? [];
      const move =
        constraint !== undefined && constraint.move === undefined && others.length > 0
          ? ` To keep the cells and move ${others.map((r) => `"${r}"`).join(", ")} instead, add \`move: ${others.length === 1 ? others[0] : `[${others.join(", ")}]`}\` to the constraint (not checked by a trial layout).`
          : "";
      out.push({
        code: "layout/align-splits-tokens",
        severity: "warning",
        message: `figure.layout.align adds ${(value * MM_PER_UNIT).toFixed(2)}mm ${kind === "lead" ? "before" : "after"} cell "${cellRef(item)}" of the tokens "${tokens.id}", which pulls its cells apart.`,
        path: constraint?.srcAt.path ?? ["figure", "layout", "align"],
        ...(constraint?.srcAt.location !== undefined && { location: constraint.srcAt.location }),
        subject: { kind: "figure", id: ir.meta.id },
        hint: `Align the whole sequence instead (\`${tokens.id}\` in the constraint, with \`at: start\` or \`end\` for an edge), or give both sequences the same cell width and gap so the cells line up without align; one cell of a row cannot move without moving the cells next to it.${move}`,
      });
    }
  }
  return out;
}

/**
 * `layout/align-widened-gap` reports a gap between two items of a stack or
 * row that the struts widened by more than this (mm) and to more than
 * {@link ALIGN_GAP_RATIO} times its width without them (#646): a gap that
 * stands out from the written ones next to it (#639 run 6: SFT → RL). Smaller
 * struts (a fraction of a gap, half a box's difference in size) read as the
 * written spacing.
 */
export const ALIGN_GAP_MM = 3;

/** See {@link ALIGN_GAP_MM}. */
export const ALIGN_GAP_RATIO = 1.5;

/**
 * Whether a gap of `now` mm stands out from one of `was` mm: longer by more
 * than {@link ALIGN_GAP_MM} and more than {@link ALIGN_GAP_RATIO} times as long
 * (a negative `was` counts as 0). Unrounded values.
 */
export function widened(was: number, now: number): boolean {
  return now - was > ALIGN_GAP_MM && now > ALIGN_GAP_RATIO * Math.max(0, was);
}

/**
 * `layout/align-uneven-stretch` reports stretched frames whose sizes across
 * the box differ by more than this (mm) with the struts, though they were
 * equal without them (#646).
 */
export const ALIGN_UNEVEN_MM = 0.5;

/** The box each arrange item sits in, and the box's cross-axis alignment as the engine applies it. */
interface Placement {
  readonly parent: Map<ArrangeItemIR, ArrangeBoxIR>;
  readonly align: Map<ArrangeBoxIR, string>;
}

/** Every arrange box of the figure with its effective `align` (inherited along the same axis, as the engine does). */
function placementOf(ir: FigureIR): Placement {
  const parent = new Map<ArrangeItemIR, ArrangeBoxIR>();
  const align = new Map<ArrangeBoxIR, string>();
  const groups = new Map(ir.groups.map((g) => [g.key, g]));
  const walk = (box: ArrangeBoxIR, inherited: string) => {
    const own = box.align ?? inherited;
    align.set(box, own);
    for (const item of box.items) {
      if (item === null) continue;
      parent.set(item, box);
      if (typeof item === "string") {
        const arrange = groups.get(item)?.arrange;
        if (arrange !== undefined) walk(arrange, "center");
      } else {
        const line = box.kind === "stack" || box.kind === "row";
        walk(item, line && item.kind === box.kind ? own : "center");
      }
    }
  };
  if (ir.arrange !== undefined) walk(ir.arrange, "center");
  return { parent, align };
}

/** How an element is written in a constraint: its ID, or `<tokens>.<cell>` for a tokens cell. */
function refOf(ir: FigureIR, key: ElementKey): string {
  const element = ir.elements.get(key);
  if (element === undefined || element.kind === "edge") return key;
  if (element.kind === "node" && element.tokens !== undefined) {
    return element.id.replace(`${element.tokens.id}-`, `${element.tokens.id}.`);
  }
  return element.id;
}

/** The element keys inside an arrange item, in order (a group counts as itself). */
function keysIn(item: ArrangeItemIR): ElementKey[] {
  if (item === null) return [];
  if (typeof item === "string") return [item];
  return item.items.flatMap(keysIn);
}

/** An item for a message: `"id"`, or `the row of "a", "b"` for an unnamed box. */
function itemName(ir: FigureIR, item: ArrangeItemIR): string {
  if (typeof item === "string") return `"${refOf(ir, item)}"`;
  if (item === null) return "a blank cell";
  const keys = keysIn(item);
  const shown = keys.slice(0, 3).map((k) => `"${refOf(ir, k)}"`);
  return `the ${item.kind} of ${shown.join(", ")}${keys.length > 3 ? ", …" : ""}`;
}

/** The bounding rectangle of an arrange item in `rects` (the union of its elements for a box). */
function extentOf(item: ArrangeItemIR, rects: ReadonlyMap<ElementKey, Rect>): Rect | undefined {
  if (item === null) return undefined;
  if (typeof item === "string") return rects.get(item);
  let out: Rect | undefined;
  for (const child of item.items) {
    const r = extentOf(child, rects);
    if (r === undefined) continue;
    if (out === undefined) {
      out = r;
      continue;
    }
    const x = Math.min(out.x, r.x);
    const y = Math.min(out.y, r.y);
    const right = Math.max(out.x + out.width, r.x + r.width);
    const bottom = Math.max(out.y + out.height, r.y + r.height);
    out = { x, y, width: right - x, height: bottom - y };
  }
  return out;
}

/**
 * The constraints whose accepted candidates put the struts `at` (kind and item)
 * (recorded by the solve in `struts.causes`), in document order. Only those
 * are blamed: a constraint that merely has an item nearby (or on the other
 * axis) added nothing there.
 */
function causesOf(
  constraints: readonly AlignIR[],
  struts: Struts,
  at: readonly StrutAt[],
): AlignIR[] {
  const found = new Set(at.flatMap(({ kind, item }) => struts.causes?.get(kind)?.get(item) ?? []));
  return constraints.filter((c) => found.has(c));
}

/** The item that holds each arrange item: its box, or for a group's arrange tree the group. */
function holders(ir: FigureIR): Map<ArrangeItemIR, ArrangeItemIR> {
  const out = new Map<ArrangeItemIR, ArrangeItemIR>();
  const groups = new Map(ir.groups.map((g) => [g.key, g]));
  const walk = (box: ArrangeBoxIR) => {
    for (const item of box.items) {
      if (item === null) continue;
      out.set(item, box);
      if (typeof item === "string") {
        const arrange = groups.get(item)?.arrange;
        if (arrange !== undefined) {
          out.set(arrange, item);
          walk(arrange);
        }
      } else walk(item);
    }
  };
  if (ir.arrange !== undefined) walk(ir.arrange);
  return out;
}

/** Whether arrange item `item` is `frame` or lies inside it. */
function inside(
  holder: ReadonlyMap<ArrangeItemIR, ArrangeItemIR>,
  item: ArrangeItemIR,
  frame: ArrangeItemIR,
): boolean {
  for (let at: ArrangeItemIR | undefined = item; at !== undefined; at = holder.get(at)) {
    if (at === frame) return true;
  }
  return false;
}

/** Whether `key` sits inside one of `items` of `box`. */
function under(
  pathOf: ReadonlyMap<ElementKey, Step[]>,
  key: ElementKey,
  box: ArrangeBoxIR,
  items: readonly ArrangeItemIR[],
): boolean {
  return (pathOf.get(key) ?? []).some((s) => s.box === box && items.includes(s.item));
}

/** `figure.layout.align[2] (x: [envs, rl])`, for messages. */
function constraintName(ir: FigureIR, c: AlignIR): string {
  const items = c.items.map((k) => refOf(ir, k)).join(", ");
  const at = c.at === "center" ? "" : `, at: ${c.at}`;
  return `${formatDocPath(c.srcAt.path)} (${c.axis}: [${items}]${at})`;
}

/** The diagnostic's place: the first constraint, the others as related. */
function placedAt(
  ir: FigureIR,
  causes: readonly AlignIR[],
): Pick<Diagnostic, "path" | "location" | "related"> {
  const first = causes[0];
  if (first === undefined) return { path: ["figure", "layout", "align"] };
  const related: RelatedInformation[] = causes.slice(1).map((c) => ({
    path: c.srcAt.path,
    ...(c.srcAt.location !== undefined && { location: c.srcAt.location }),
    message: `${constraintName(ir, c)} added space here too.`,
  }));
  return {
    path: first.srcAt.path,
    ...(first.srcAt.location !== undefined && { location: first.srcAt.location }),
    ...(related.length > 0 && { related }),
  };
}

/**
 * The `move` a hint suggests: the items of `c` outside the part that moved
 * (`moved`), when `c` has items on both sides and names no `move` yet.
 */
function moveSuggestion(
  ir: FigureIR,
  c: AlignIR | undefined,
  moved: (key: ElementKey) => boolean,
): string {
  if (c === undefined || c.move !== undefined) return "";
  const others = c.items.filter((k) => !moved(k));
  if (others.length === 0 || others.length === c.items.length) return "";
  const refs = others.map((k) => refOf(ir, k));
  const value = refs.length === 1 ? refs[0] : `[${refs.join(", ")}]`;
  return ` To move the other side instead, add \`move: ${value}\` to ${formatDocPath(c.srcAt.path)} (not checked by a trial layout).`;
}

/**
 * `layout/align-widened-gap` (#646): a gap between two items of a stack or
 * row that a strut made much wider than without it. The constraint is met, but
 * that gap no longer matches the written spacing of its neighbours, and
 * nothing else says why (#639 run 6).
 */
function widenedGaps(
  ir: FigureIR,
  constraints: readonly AlignIR[],
  struts: Struts,
  plain: LayoutIR,
  layout: LayoutIR,
  pathOf: ReadonlyMap<ElementKey, Step[]>,
): Diagnostic[] {
  const { parent } = placementOf(ir);
  const before = rectsOf(plain);
  const after = rectsOf(layout);
  // `owners`: the items whose struts widened the gap (the item after it for a lead, before it for a trail).
  const pairs: {
    box: ArrangeBoxIR;
    first: ArrangeItemIR;
    second: ArrangeItemIR;
    owners: StrutAt[];
  }[] = [];
  for (const [side, map] of [
    ["lead", struts.lead],
    ["trail", struts.trail],
  ] as const) {
    for (const [item, value] of map) {
      if (value <= ALIGN_EPSILON || item === null) continue;
      const box = parent.get(item);
      if (box === undefined || (box.kind !== "stack" && box.kind !== "row")) continue;
      const reversed = box.direction === "left" || box.direction === "up";
      const order = (reversed ? [...box.items].reverse() : [...box.items]).filter(
        (i) => i !== null,
      );
      const index = order.indexOf(item);
      const other = order[side === "lead" ? index - 1 : index + 1];
      if (index < 0 || other === undefined) continue;
      const [first, second] = side === "lead" ? [other, item] : [item, other];
      // Cells of one tokens row pulled apart are layout/align-splits-tokens already.
      const tokensOf = (i: ArrangeItemIR) =>
        typeof i === "string" ? ir.elements.get(i as ElementKey) : undefined;
      const a = tokensOf(first);
      const b = tokensOf(second);
      if (
        a?.kind === "node" &&
        b?.kind === "node" &&
        a.tokens !== undefined &&
        a.tokens.id === b.tokens?.id
      )
        continue;
      const known = pairs.find((p) => p.first === first && p.second === second);
      // Only this kind at this item widened the gap: a lead before the second, a trail after the first.
      const owner: StrutAt = { kind: side, item };
      if (known !== undefined) known.owners.push(owner);
      else pairs.push({ box, first, second, owners: [owner] });
    }
  }
  const out: Diagnostic[] = [];
  for (const { box, first, second, owners } of pairs) {
    const vertical = box.kind === "stack";
    const gapIn = (
      rects: ReadonlyMap<ElementKey, Rect>,
      x: ArrangeItemIR = first,
      y: ArrangeItemIR = second,
    ) => {
      const a = extentOf(x, rects);
      const b = extentOf(y, rects);
      if (a === undefined || b === undefined) return undefined;
      return vertical ? b.y - (a.y + a.height) : b.x - (a.x + a.width);
    };
    const was = gapIn(before);
    const now = gapIn(after);
    if (was === undefined || now === undefined) continue;
    // Thresholds on the measured values; rounding is for the message only.
    const [wasMm, nowMm] = [was * MM_PER_UNIT, now * MM_PER_UNIT];
    if (!widened(wasMm, nowMm)) continue;
    const [b, a] = [wasMm.toFixed(2), nowMm.toFixed(2)];
    // It must also stand out from the other gaps of its box: gaps that all grew alike (a
    // U-Net's levels pushed down for straight skips) read as one spacing.
    const reversed = box.direction === "left" || box.direction === "up";
    const order = (reversed ? [...box.items].reverse() : [...box.items]).filter((i) => i !== null);
    const siblings = order.slice(1).flatMap((item, i) => {
      const prev = order[i] as ArrangeItemIR;
      if (prev === first && item === second) return [];
      const g = gapIn(after, prev, item);
      return g === undefined ? [] : [g * MM_PER_UNIT];
    });
    if (siblings.length > 0) {
      const least = Math.min(...siblings);
      if (!widened(least, nowMm)) continue;
    }
    const causes = causesOf(constraints, struts, owners);
    const moved = (key: ElementKey) =>
      under(
        pathOf,
        key,
        box,
        owners.map((o) => o.item),
      );
    const why =
      causes.length > 0 ? `, for ${causes.map((c) => constraintName(ir, c)).join(" and ")}` : "";
    out.push({
      code: "layout/align-widened-gap",
      severity: "info",
      message:
        box.growFirst === true
          ? `figure.layout.align moves the caption of ${itemName(ir, first)} away from its frame: the gap between them grows from ${b}mm to ${a}mm${why}.`
          : `figure.layout.align widens the gap between ${itemName(ir, first)} and ${itemName(ir, second)} in their ${box.kind} from ${b}mm to ${a}mm${why}.`,
      ...placedAt(ir, causes),
      subject: { kind: "figure", id: ir.meta.id },
      hint: `The space that aligns the items lands in this one gap, so it is longer than the written gaps next to it.${moveSuggestion(ir, causes[0], moved)} If the longer gap is intended, set figure.layout.alignGrowth: allow. Otherwise write a gap that leaves room for the alignment, put the items closer in the arrange trees, or drop the constraint.`,
    });
  }
  return out;
}

/**
 * `layout/align-uneven-stretch` (#646): frames that a stack or row with
 * `align: stretch` gave one size across it (panels of one height) differ in
 * size after the struts, because space added inside one of them changed it
 * after the box set the size (#639 run 1: a strut after a panel in its
 * caption's stack). The constraint is met, but the frames no longer match.
 */
function unevenStretch(
  ir: FigureIR,
  constraints: readonly AlignIR[],
  struts: Struts,
  plain: LayoutIR,
  layout: LayoutIR,
  pathOf: ReadonlyMap<ElementKey, Step[]>,
): Diagnostic[] {
  const { align } = placementOf(ir);
  const holder = holders(ir);
  // Every strut, of any kind: space of any kind inside a stretched frame can change it.
  const all: StrutAt[] = (["lead", "trail", "crossLead", "crossTrail"] as const).flatMap((kind) =>
    [...struts[kind].entries()]
      .filter(([, value]) => value > ALIGN_EPSILON)
      .map(([item]) => ({ kind, item })),
  );
  const before = rectsOf(plain);
  const after = rectsOf(layout);
  const out: Diagnostic[] = [];
  for (const [box, effective] of align) {
    if (effective !== "stretch" || (box.kind !== "stack" && box.kind !== "row")) continue;
    const vertical = box.kind === "stack";
    const across = (r: Rect) => (vertical ? r.width : r.height);
    const frames: { item: ArrangeItemIR; key: ElementKey; was: number; now: number }[] = [];
    for (const item of box.items) {
      if (item === null) continue;
      // A group with a caption sits in its caption's stack (#130), whose first item is the group.
      const key =
        typeof item === "string"
          ? item
          : item.growFirst === true && typeof item.items[0] === "string"
            ? item.items[0]
            : undefined;
      if (key === undefined) continue;
      const element = ir.elements.get(key);
      if (element?.kind === "node" && element.component === SEPARATOR_ID) continue;
      // Only what the box really stretches (the engine's rule): a node with an explicit
      // size across the box, an outline, badge or glyphs, or a fixed shape keeps its own.
      if (
        typeof item === "string" &&
        !crossStretchable(element?.kind === "node" ? element : undefined, vertical)
      )
        continue;
      const was = before.get(key);
      const now = after.get(key);
      if (was === undefined || now === undefined) continue;
      frames.push({ item, key, was: across(was), now: across(now) });
    }
    if (frames.length < 2) continue;
    const stretched = frames;
    if (stretched.length < 2) continue;
    const full = Math.max(...frames.map((f) => f.was));
    const sizes = stretched.map((f) => f.now * MM_PER_UNIT);
    const top = Math.max(...sizes);
    if (top - Math.min(...sizes) <= ALIGN_UNEVEN_MM) continue;
    const off = stretched.filter((f) => f.now * MM_PER_UNIT < top - ALIGN_UNEVEN_MM);
    const rest = stretched.filter((f) => !off.includes(f));
    const list = (fs: typeof stretched) => fs.map((f) => `"${refOf(ir, f.key)}"`).join(", ");
    const word = vertical ? "wide" : "tall";
    const offSizes = [...new Set(off.map((f) => (f.now * MM_PER_UNIT).toFixed(2)))];
    const offText = `${list(off)} ${off.length === 1 ? "is" : "are"} ${offSizes.join("–")}mm ${word}`;
    // The struts that changed a frame lie inside one; blame the constraints that put them there.
    const hit = stretched.filter((f) => all.some((s) => inside(holder, s.item, f.item)));
    const causes = causesOf(
      constraints,
      struts,
      all.filter((s) => hit.some((f) => inside(holder, s.item, f.item))),
    );
    // The suggestion keeps the frames that fell short of the others still.
    const moved = (key: ElementKey) =>
      under(
        pathOf,
        key,
        box,
        off.map((f) => f.item),
      );
    const who =
      causes.length > 0
        ? causes.map((c) => constraintName(ir, c)).join(" and ")
        : "figure.layout.align";
    out.push({
      code: "layout/align-uneven-stretch",
      severity: "info",
      message: `${who} ${causes.length > 1 ? "leave" : "leaves"} the frames of a ${box.kind} with align: stretch uneven: ${offText}, ${list(rest)} ${top.toFixed(2)}mm (all ${(full * MM_PER_UNIT).toFixed(2)}mm without it).`,
      ...placedAt(ir, causes),
      subject: { kind: "figure", id: ir.meta.id },
      hint: `Space that align adds inside a stretched frame changes that frame after the ${box.kind} has given its items one size, so the frames no longer match.${moveSuggestion(ir, causes[0], moved)} Otherwise align items outside the stretched frames, place the content with contentAlign instead of align, or drop the constraint.`,
    });
  }
  return out;
}

interface Coordinate {
  readonly key: ElementKey;
  readonly value: number;
}

/** The rectangles of a layout's nodes and groups by key. */
function rectsOf(layout: LayoutIR): Map<ElementKey, Rect> {
  const rects = new Map<ElementKey, Rect>();
  for (const n of layout.nodes) rects.set(n.key, n.rect);
  for (const g of layout.groups) rects.set(g.key, g.rect);
  return rects;
}

/** The `at` coordinate of each item of `c` on its axis, in the constraint's order. */
function coordinates(rects: ReadonlyMap<ElementKey, Rect>, c: AlignIR): Coordinate[] {
  return c.items.map((key) => {
    const r = rects.get(key);
    if (r === undefined) throw new Error(`internal error: ${key} was not placed`);
    const start = c.axis === "y" ? r.y : r.x;
    const size = c.axis === "y" ? r.height : r.width;
    const value = c.at === "start" ? start : c.at === "end" ? start + size : start + size / 2;
    return { key, value };
  });
}

/** How far apart the items of `c` are (0 for a met constraint). */
function residualOf(rects: ReadonlyMap<ElementKey, Rect>, c: AlignIR): number {
  const values = coordinates(rects, c).map((p) => p.value);
  return Math.max(...values) - Math.min(...values);
}

/** The residual of each constraint. */
function residualsOf(layout: LayoutIR, constraints: readonly AlignIR[]): number[] {
  const rects = rectsOf(layout);
  return constraints.map((c) => residualOf(rects, c));
}

/**
 * Whether candidate `a` beats `b`: a smaller total residual, or, on a tie, a
 * smaller canvas (area); otherwise the earlier candidate stays. A tie is the
 * same total up to floating-point noise ({@link TIE}), as the comparison was
 * before #155: a candidate that is better by any real amount still wins, so
 * figures that never tie keep their layout. Without the canvas rule the
 * earlier candidate won every tie, and in a center-aligned box the `lead`
 * before the upper item and the `trail` after the lower one tie each round
 * (each closes half the shortfall), so the `lead` kept pushing the upper
 * branch down and the figure grew (#155).
 */
function better(a: Trial, b: Trial): boolean {
  if (a.total < b.total - TIE) return true;
  if (a.total > b.total + TIE) return false;
  return area(a.layout) < area(b.layout);
}

function area(layout: LayoutIR): number {
  return layout.canvas.width * layout.canvas.height;
}

function sum(values: readonly number[]): number {
  return values.reduce((s, v) => s + v, 0);
}

/** The path of steps from the root to each element (an attached node takes its target's). */
function paths(ir: FigureIR): Map<ElementKey, Step[]> {
  const out = new Map<ElementKey, Step[]>();
  const groups = new Map(ir.groups.map((g) => [g.key, g]));
  const walk = (box: ArrangeBoxIR, prefix: Step[]) => {
    for (const item of box.items) {
      if (item === null) continue;
      const path = [...prefix, { box, item }];
      if (typeof item === "string") {
        out.set(item, path);
        const arrange = groups.get(item)?.arrange;
        if (arrange !== undefined) walk(arrange, path);
      } else {
        walk(item, path);
      }
    }
  };
  if (ir.arrange !== undefined) walk(ir.arrange, []);
  // Multi-line tokens are one rigid block (#305). Keep each cell's rectangle
  // as the align target, but allow struts only outside their common item.
  // Use written line indices: singleton runs collapse to cells and therefore
  // share an innermost box. Single-line tokens keep their existing behavior.
  // This also handles a whole-node frame.
  const tokenPaths = new Map<string, { paths: Step[][]; lines: Set<number> }>();
  for (const node of ir.nodes) {
    const path = out.get(node.key);
    if (node.tokens === undefined || path === undefined) continue;
    const block = tokenPaths.get(node.tokens.id) ?? { paths: [], lines: new Set<number>() };
    block.paths.push(path);
    block.lines.add(node.tokens.line ?? 0);
    tokenPaths.set(node.tokens.id, block);
  }
  for (const { paths: list, lines } of tokenPaths.values()) {
    if (lines.size < 2) continue;
    const first = list[0] as Step[];
    let length = first.length;
    for (const path of list.slice(1)) {
      let i = 0;
      while (i < length && path[i]?.item === first[i]?.item) i++;
      length = i;
    }
    // Mutate the shared path arrays before attachments inherit them below.
    for (const path of list) path.length = length;
  }
  // Attach chains: each pass resolves the nodes whose target has a path.
  for (let changed = true; changed; ) {
    changed = false;
    for (const n of ir.nodes) {
      if (n.attach === undefined || out.has(n.key)) continue;
      const target = out.get(n.attach.to);
      if (target !== undefined) {
        out.set(n.key, target);
        changed = true;
      }
    }
  }
  return out;
}

const MM_PER_UNIT = 0.5 * (25.4 / 72);

/**
 * `layout/align-grew-figure` reports a side of the canvas that grew by more
 * than this (mm) and by more than {@link ALIGN_GROWTH_RATIO} of its length
 * without the struts. Aligning usually costs some space (a strut about a gap
 * or half a box: 2–4mm in the U-Net and side-KV figures of #132); the
 * runaway case of #155 grew the figure by 37–63mm (40–50%). Both bounds must
 * be passed: a few mm are noise in a large figure, a large fraction of a tiny
 * figure is still a small change on the page.
 */
export const ALIGN_GROWTH_MM = 5;

/** See {@link ALIGN_GROWTH_MM}. */
export const ALIGN_GROWTH_RATIO = 0.1;

/** `layout/align-grew-figure` (info) when the struts grew `plain` into `layout` notably. */
export function grewFigure(
  ir: FigureIR,
  plain: LayoutIR,
  layout: LayoutIR,
): Diagnostic | undefined {
  const sides: string[] = [];
  for (const [side, word] of [
    ["width", "wider"],
    ["height", "taller"],
  ] as const) {
    const before = plain.canvas[side] * MM_PER_UNIT;
    const after = layout.canvas[side] * MM_PER_UNIT;
    const grown = after - before;
    if (grown > ALIGN_GROWTH_MM && grown > ALIGN_GROWTH_RATIO * before) {
      const percent = Math.round((grown / before) * 100);
      const [b, a] = [before.toFixed(2), after.toFixed(2)];
      // The difference of the printed sizes, so that the message adds up.
      const d = (Number(a) - Number(b)).toFixed(2);
      sides.push(`${d}mm ${word} (${side} ${b}mm → ${a}mm, +${percent}%)`);
    }
  }
  if (sides.length === 0) return undefined;
  return {
    code: "layout/align-grew-figure",
    severity: "info",
    message: `figure.layout.align made the figure ${sides.join(" and ")} than the layout without it.`,
    path: ["figure", "layout", "align"],
    subject: { kind: "figure", id: ir.meta.id },
    hint: "A strut only adds space, and the space it adds before an item moves the items after it and grows the boxes around it. If that space is intended, set figure.layout.alignGrowth: allow. If it is not wanted, align an item that sits in a shorter branch (wrap it in a stack or row of its own so that it can move alone, and name it in the constraint's move), put the items closer in the arrange trees, or drop the constraint.",
  };
}

function strutRecord(struts: Struts): Record<string, number> {
  const names = new Map<ArrangeBoxIR, string>();
  const nameOf = (item: ArrangeItemIR) => {
    if (item === null) return "blank";
    if (typeof item === "string") return item;
    let name = names.get(item);
    if (name === undefined) {
      name = `box#${names.size + 1}`;
      names.set(item, name);
    }
    return name;
  };
  const out: Record<string, number> = {};
  for (const kind of ["lead", "trail", "crossLead", "crossTrail"] as const) {
    for (const [item, value] of struts[kind]) {
      out[`${kind} ${nameOf(item)}`] = Math.round(value * 1000) / 1000;
    }
  }
  return out;
}

/** Neutral advice of a grid-cell hint; the engine swaps it for a verified edit when a trial works. */
export const UNVERIFIED_ALIGN_TAIL =
  "No verified wrapper edit is available: check the parent row/stack alignment and competing constraints, or align other elements.";

/** `layout/unsatisfied-align` for constraint `index`. */
function unsatisfied(
  ir: FigureIR,
  constraints: readonly AlignIR[],
  index: number,
  residual: number,
  first: ElementKey,
  last: ElementKey,
  movable: boolean,
): Diagnostic {
  const c = constraints[index] as AlignIR;
  const id = (key: ElementKey) => {
    const element = ir.elements.get(key);
    return element !== undefined && element.kind !== "edge" ? element.id : key;
  };
  const names = c.items.map((key) => `"${id(key)}"`).join(", ");
  const line = c.axis === "y" ? "one horizontal line" : "one vertical line";
  const where = formatDocPath(c.srcAt.path);
  const box = c.axis === "y" ? "stack" : "row";
  const pathOf = paths(ir);
  const gridItems = c.items.filter((key) => pathOf.get(key)?.at(-1)?.box.kind === "grid");
  const boxes = new Set(gridItems.map((key) => pathOf.get(key)?.at(-1)?.box));
  const sameGrid = gridItems.length === c.items.length && boxes.size === 1;
  const gridNames = gridItems.map((key) => `"${id(key)}"`).join(", ");
  const explanation = `${gridNames} ${gridItems.length === 1 ? "is a direct grid cell (or attached to one)" : "are direct grid cells (or attached to them)"}: grid cells take no align struts, so they cannot move independently inside the grid.`;
  const hint =
    gridItems.length > 0
      ? sameGrid
        ? `${explanation} They are tracks of the same grid, so wrapping them or the grid cannot separate them: ${c.axis === "y" ? "put them in the same row of the grid" : "put them in the same column of the grid"}, or use another constraint.`
        : `${explanation} ${UNVERIFIED_ALIGN_TAIL}`
      : movable
        ? `Other align constraints or the arrangement keep them apart: a strut only adds space, and it moves the items after it in its ${box} too. Check the constraints that share these elements (they may contradict each other), or align other elements.`
        : `"${id(first)}" and "${id(last)}" cannot be moved apart: a strut goes only in a ${box} that holds just one of them, never inside a box with gap: 0, and it moves the items after it in its ${box} too. Put them in different ${box}s, or align other elements.`;
  // `move` (#646) keeps the other items still, which can leave no way to meet the constraint.
  // Not after a grid hint: its tail is swapped for a verified edit (align-hint.ts).
  const moveTail =
    c.move === undefined || gridItems.length > 0
      ? ""
      : ` Only ${c.move.map((k) => `"${refOf(ir, k)}"`).join(", ")} may move (move): a strut only adds space before or after an item, so an item that has to travel back toward the start of its box cannot; name another item in move, or drop move.`;
  const related: RelatedInformation[] = [];
  for (const [i, other] of constraints.entries()) {
    if (i === index || !other.items.some((k) => c.items.includes(k))) continue;
    related.push({
      path: other.srcAt.path,
      ...(other.srcAt.location !== undefined && { location: other.srcAt.location }),
      message: `${formatDocPath(other.srcAt.path)} shares elements with this constraint.`,
    });
  }
  return {
    code: "layout/unsatisfied-align",
    severity: "warning",
    message: `${where} cannot place ${names} on ${line} (${c.axis}, ${c.at}): "${id(first)}" and "${id(last)}" stay ${(residual * MM_PER_UNIT).toFixed(2)}mm apart.`,
    path: c.srcAt.path,
    ...(c.srcAt.location !== undefined && { location: c.srcAt.location }),
    subject: { kind: "figure", id: ir.meta.id },
    hint: `${hint}${moveTail}`,
    ...(related.length > 0 && { related }),
  };
}
