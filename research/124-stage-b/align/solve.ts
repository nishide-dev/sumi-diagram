/**
 * Cross-tree alignment by struts (#124 §6, prototype).
 *
 * The product engine (`src/layout/structured/engine.ts`) is a one-pass box
 * model. A patched copy (`out/engine-variant.ts`) takes one extra input:
 * struts, i.e. space added before (`lead`) or after (`trail`) an item along
 * its box's main axis, in visual order ("above" / "below" in a stack, "left
 * of" / "right of" in a row, whatever the `direction`). Everything else is
 * the product engine; with no struts the copy returns byte-identical
 * layouts (checked in `run.ts`).
 *
 * The solver is a fixed-point loop around it, with no new dependency. Each
 * round, for each constraint whose items are not on one line yet (center /
 * start / end on the axis, within 0.01 unit):
 *
 *   - candidate A: a `lead` of the shortfall before the first (lowest /
 *     leftmost) item's step on its path: the deepest box along the axis (a
 *     stack for `y`, a row for `x`), not a `gap: 0` box (its items are one
 *     unit), whose item on the path holds no other item of the constraint,
 *     which pushes it down / right;
 *   - candidate B: a `trail` of the shortfall after the last item's step,
 *     which pushes it up / left inside an end-aligned box (or, in a
 *     start-aligned one, grows the box and moves nothing);
 *
 * lays out both and keeps the one with the smaller total residual over all
 * constraints (A on ties). It stops when every constraint is met, when a
 * round makes no progress, or after 50 rounds. Struts only grow, so a figure
 * whose constraints contradict the trees stops with a residual, which the
 * product would report as a diagnostic.
 */

import type { ArrangeBoxIR, ArrangeItemIR, FigureIR } from "../../../src/compiler/ir";
import type { LayoutIR, Rect } from "../../../src/layout/ir";
import { patch, readProduct, writeCopy } from "../patch";

export interface AlignConstraint {
  /** `y`: the items share a y coordinate (one horizontal line); `x`: a vertical line. */
  readonly axis: "x" | "y";
  /** Element IDs (nodes or groups). */
  readonly items: readonly string[];
  /** Which coordinate: the center (default), the start (top / left) or the end. */
  readonly at?: "center" | "start" | "end";
}

export interface AlignResult {
  readonly layout: LayoutIR;
  /** Layouts computed (including the first and every trial). */
  readonly layouts: number;
  readonly rounds: number;
  /** Largest remaining difference in units (0 when solved). */
  readonly residual: number;
  /** Struts added: `lead|trail <item>` (an element key, or `box#n` for a nested box) → units. */
  readonly struts: Record<string, number>;
}

type Struts = { lead: Map<ArrangeItemIR, number>; trail: Map<ArrangeItemIR, number> };
type EngineCopy = {
  layoutStructured(ir: FigureIR): LayoutIR;
  STRUTS: { value: Struts | null };
};

let engine: Promise<EngineCopy> | undefined;

/** The patched engine (see the module comment). */
export function loadEngineCopy(): Promise<EngineCopy> {
  engine ??= (async () => {
    const file = writeCopy("engine-variant.ts", engineSource());
    return (await import(file)) as EngineCopy;
  })();
  return engine;
}

/** The patched engine source (throws if a patch target no longer matches, see README). */
export function engineSource(): string {
  let src = readProduct("src/layout/structured/engine.ts");
  src = patch(
    src,
    "    const main = sizes.reduce((sum, s) => sum + (vertical ? s.height : s.width), 0);",
    `    const main =
      sizes.reduce((sum, s) => sum + (vertical ? s.height : s.width), 0) +
      box.items.reduce(
        (sum, item) =>
          sum + (STRUTS.value?.lead.get(item) ?? 0) + (STRUTS.value?.trail.get(item) ?? 0),
        0,
      );`,
  );
  src = patch(
    src,
    "      const rect: Rect = vertical\n",
    "      cursor += STRUTS.value?.lead.get(item) ?? 0;\n      const rect: Rect = vertical\n",
  );
  src = patch(
    src,
    "      cursor += (vertical ? size.height : size.width) + gap;",
    "      cursor += (vertical ? size.height : size.width) + gap + (STRUTS.value?.trail.get(item) ?? 0);",
  );
  return `export const STRUTS = { value: null };\n${src}`;
}

interface Step {
  readonly box: ArrangeBoxIR;
  readonly item: ArrangeItemIR;
}

/** The path of boxes from the root to each element (attached nodes take their target's). */
function paths(ir: FigureIR): Map<string, Step[]> {
  const out = new Map<string, Step[]>();
  const groups = new Map(ir.groups.map((g) => [g.key as string, g]));
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

const EPS = 0.01;

export async function solveAlignment(
  ir: FigureIR,
  constraints: readonly AlignConstraint[],
  maxRounds = 50,
): Promise<AlignResult> {
  const copy = await loadEngineCopy();
  // Keys are `n:<id>` / `g:<id>`.
  const keyOf = new Map<string, string>(
    [...ir.nodes, ...ir.groups].map((e) => [e.key.slice(2), e.key as string]),
  );
  const keysOf = (c: AlignConstraint) =>
    c.items.map((id) => {
      const key = keyOf.get(id);
      if (key === undefined) throw new Error(`unknown element ${id}`);
      return key;
    });
  const pathOf = paths(ir);
  let struts: Struts = { lead: new Map(), trail: new Map() };
  let layouts = 0;
  const layoutWith = (s: Struts) => {
    layouts++;
    copy.STRUTS.value = s;
    try {
      return copy.layoutStructured(ir);
    } finally {
      copy.STRUTS.value = null;
    }
  };
  const coords = (layout: LayoutIR, c: AlignConstraint) => {
    const rects = new Map<string, Rect>([
      ...layout.nodes.map((n) => [n.key as string, n.rect] as [string, Rect]),
      ...layout.groups.map((g) => [g.key as string, g.rect] as [string, Rect]),
    ]);
    return keysOf(c).map((key) => {
      const r = rects.get(key) as Rect;
      const start = c.axis === "y" ? r.y : r.x;
      const size = c.axis === "y" ? r.height : r.width;
      const v = c.at === "start" ? start : c.at === "end" ? start + size : start + size / 2;
      return { key, v };
    });
  };
  const residualOf = (layout: LayoutIR) =>
    constraints.reduce((sum, c) => {
      const vs = coords(layout, c).map((p) => p.v);
      return sum + (Math.max(...vs) - Math.min(...vs));
    }, 0);
  /** The deepest step along `c.axis` on `key`'s path that holds no other item of `c`. */
  const stepFor = (key: string, c: AlignConstraint): Step | undefined => {
    const others = keysOf(c).filter((k) => k !== key);
    return [...(pathOf.get(key) ?? [])].reverse().find(
      (s) =>
        s.box.kind === (c.axis === "y" ? "stack" : "row") &&
        // Never inside a `gap: 0` box: its items are drawn as one unit.
        s.box.gapPt !== 0 &&
        !others.some((o) => (pathOf.get(o) ?? []).some((p) => p.item === s.item)),
    );
  };
  const add = (s: Struts, kind: "lead" | "trail", item: ArrangeItemIR, v: number): Struts => {
    const next = { lead: new Map(s.lead), trail: new Map(s.trail) };
    next[kind].set(item, (next[kind].get(item) ?? 0) + v);
    return next;
  };

  let layout = layoutWith(struts);
  let total = residualOf(layout);
  let rounds = 0;
  while (rounds < maxRounds && total > EPS * constraints.length) {
    rounds++;
    const before = total;
    for (const c of constraints) {
      const ps = coords(layout, c).sort((a, b) => a.v - b.v);
      const first = ps[0] as { key: string; v: number };
      const last = ps[ps.length - 1] as { key: string; v: number };
      const short = last.v - first.v;
      if (short <= EPS) continue;
      const trials: { struts: Struts; layout: LayoutIR; total: number }[] = [];
      const a = stepFor(first.key, c);
      if (a !== undefined) {
        const s = add(struts, "lead", a.item, short);
        const l = layoutWith(s);
        trials.push({ struts: s, layout: l, total: residualOf(l) });
      }
      const b = stepFor(last.key, c);
      if (b !== undefined) {
        const s = add(struts, "trail", b.item, short);
        const l = layoutWith(s);
        trials.push({ struts: s, layout: l, total: residualOf(l) });
      }
      const best = trials.reduce<(typeof trials)[number] | undefined>(
        (m, t) => (m === undefined || t.total < m.total - 1e-9 ? t : m),
        undefined,
      );
      if (best !== undefined && best.total < total - 1e-9) {
        struts = best.struts;
        layout = best.layout;
        total = best.total;
      }
    }
    if (total >= before - 1e-9) break;
  }
  let residual = 0;
  for (const c of constraints) {
    const vs = coords(layout, c).map((p) => p.v);
    residual = Math.max(residual, Math.max(...vs) - Math.min(...vs));
  }
  const names = new Map<ArrangeItemIR, string>();
  const nameOf = (item: ArrangeItemIR) => {
    if (typeof item === "string") return item;
    if (!names.has(item)) names.set(item, `box#${names.size + 1}`);
    return names.get(item) as string;
  };
  const out: Record<string, number> = {};
  for (const kind of ["lead", "trail"] as const) {
    for (const [item, v] of struts[kind])
      out[`${kind} ${nameOf(item)}`] = Math.round(v * 1000) / 1000;
  }
  return { layout, layouts, rounds, residual: Math.round(residual * 1000) / 1000, struts: out };
}
