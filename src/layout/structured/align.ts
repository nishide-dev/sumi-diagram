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
 * target's path (it moves with the target).
 *
 * The candidates are laid out and the one with the smallest total residual
 * (the sum of every constraint's range) is kept if it is smaller than before;
 * on a tie, the one with the smaller canvas (#155), then the earlier. The
 * loop stops when every constraint is met (the largest single residual within
 * {@link ALIGN_EPSILON}: the sum is only the objective; many met constraints
 * must not hide an unmet one), when a round makes no progress, after
 * {@link MAX_ALIGN_ROUNDS} rounds, or when {@link MAX_ALIGN_LAYOUTS} layouts
 * are spent (then with
 * `layout/align-search-limit`, warning). Struts only grow, so constraints that
 * contradict each other or the trees stop with a residual, reported per
 * constraint as `layout/unsatisfied-align` (warning; the figure is drawn with
 * the best layout found). Struts can grow the figure: when a side of the
 * canvas grows by more than {@link ALIGN_GROWTH_MM} and
 * {@link ALIGN_GROWTH_RATIO} over the plain pass, `layout/align-grew-figure`
 * (info) says by how much (#155).
 *
 * Deterministic: constraints in document order, Map iteration in insertion
 * order, the engine's own rounding.
 */

import type { AlignIR, ArrangeBoxIR, ArrangeItemIR, FigureIR } from "../../compiler/ir";
import type { ElementKey } from "../../core/check-state";
import { type Diagnostic, formatDocPath, type RelatedInformation } from "../../core/diagnostics";
import type { LayoutIR, Rect } from "../ir";

/** Space added around arrange items, in units (see the module comment). */
export interface Struts {
  readonly lead: ReadonlyMap<ArrangeItemIR, number>;
  readonly trail: ReadonlyMap<ArrangeItemIR, number>;
}

export const NO_STRUTS: Struts = Object.freeze({ lead: new Map(), trail: new Map() });

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

interface MutableStruts {
  lead: Map<ArrangeItemIR, number>;
  trail: Map<ArrangeItemIR, number>;
}

/** Bounds of the search (tests lower them). */
export interface AlignLimits {
  /** Rounds of the loop; default {@link MAX_ALIGN_ROUNDS}. */
  readonly maxRounds?: number;
  /** Layouts computed in all, diagnostic probes included; default {@link MAX_ALIGN_LAYOUTS}. */
  readonly maxLayouts?: number;
}

type Trial = { struts: Struts; layout: LayoutIR; residuals: number[]; total: number };

/**
 * Solves `constraints` (the figure's `align`) with `layoutWith`, the engine's
 * pass with struts.
 */
export function solveAlignment(
  ir: FigureIR,
  constraints: readonly AlignIR[],
  layoutWith: (struts: Struts) => LayoutIR,
  limits: AlignLimits = {},
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
  /** The deepest step along `c.axis` on `key`'s path that can take a strut for `c`. */
  const stepFor = (key: ElementKey, c: AlignIR): Step | undefined => {
    const others = c.items.filter((k) => k !== key);
    const kind = c.axis === "y" ? "stack" : "row";
    return [...(pathOf.get(key) ?? [])]
      .reverse()
      .find(
        (s) =>
          s.box.kind === kind &&
          s.box.gapPt !== 0 &&
          !others.some((o) => (pathOf.get(o) ?? []).some((p) => p.item === s.item)),
      );
  };
  /** `base` plus struts of `kind` (each added to what is there). */
  const add = (
    base: Struts,
    kind: "lead" | "trail",
    struts: readonly (readonly [ArrangeItemIR, number])[],
  ): Struts => {
    const next: MutableStruts = { lead: new Map(base.lead), trail: new Map(base.trail) };
    for (const [item, value] of struts) next[kind].set(item, (next[kind].get(item) ?? 0) + value);
    return next;
  };
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
    if (a !== undefined) out.push(add(base, "lead", [[a.item, short]]));
    const b = stepFor(last.key, c);
    if (b !== undefined) out.push(add(base, "trail", [[b.item, short]]));
    if (ps.length > 2) {
      const all = (kind: "lead" | "trail", gapOf: (p: Coordinate) => number) => {
        const struts = ps.flatMap((p) => {
          const step = gapOf(p) > ALIGN_EPSILON ? stepFor(p.key, c) : undefined;
          return step === undefined ? [] : [[step.item, gapOf(p)] as const];
        });
        if (struts.length > 1) out.push(add(base, kind, struts));
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
    if (total >= before - TIE) break;
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
  const growth = grewFigure(ir, plain, layout);
  if (growth !== undefined) diagnostics.push(growth);
  const stats: AlignStats = {
    rounds,
    layouts,
    residuals: residuals.map((r) => Math.round(r * 1000) / 1000),
    struts: strutRecord(struts),
  };
  return { layout, diagnostics, stats };
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
    hint: "A strut only adds space, and the space it adds before an item moves the items after it and grows the boxes around it. If that space is not wanted, align an item that sits in a shorter branch (wrap it in a stack or row of its own so that it can move alone), put the items closer in the arrange trees, or drop the constraint.",
  };
}

function strutRecord(struts: Struts): Record<string, number> {
  const names = new Map<ArrangeBoxIR, string>();
  const nameOf = (item: ArrangeItemIR) => {
    if (typeof item === "string") return item;
    let name = names.get(item);
    if (name === undefined) {
      name = `box#${names.size + 1}`;
      names.set(item, name);
    }
    return name;
  };
  const out: Record<string, number> = {};
  for (const kind of ["lead", "trail"] as const) {
    for (const [item, value] of struts[kind]) {
      out[`${kind} ${nameOf(item)}`] = Math.round(value * 1000) / 1000;
    }
  }
  return out;
}

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
  const hint = movable
    ? `Other align constraints or the arrangement keep them apart: a strut only adds space, and it moves the items after it in its ${box} too. Check the constraints that share these elements (they may contradict each other), or align other elements.`
    : `"${id(first)}" and "${id(last)}" cannot be moved apart: a strut goes only in a ${box} that holds just one of them, never inside a box with gap: 0, and it moves the items after it in its ${box} too. Put them in different ${box}s, or align other elements.`;
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
    hint,
    ...(related.length > 0 && { related }),
  };
}
