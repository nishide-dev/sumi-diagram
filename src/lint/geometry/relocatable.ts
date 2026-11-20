/**
 * `geometry/relocatable-node` (#621, design record
 * `docs/design/decisions/621-relocate-hint.md`): an edge bends more than its
 * ends' positions need (a Z or a U where an L or a straight line would do),
 * and moving one of its ends — the node, or the arrange item holding it — to
 * a nearby empty grid cell (`null`) or to another place in its stack / row
 * removes bends.
 *
 * Every suggestion is checked by doing it: the move is written into a copy
 * of the figure as compiled, which is laid out and routed again with the
 * render's own steps (`placeStructured`, `straighten` as configured, then
 * `routeStructured`), drawn and checked by the other geometry rules. A move
 * is reported only if the edges it is for bend less in total (or, with as
 * many bends, take a shorter detour), no edge bends more, no other edge's
 * detour grows by more than 1pt, no edge turns around, the canvas grows in
 * neither direction and the geometry lint (under the same configuration)
 * finds no new error or warning. Only the best
 * move is reported, as a YAML edit; nothing is changed: where a node sits
 * can carry meaning (failures below the main flow), so the author decides.
 *
 * Cost: at most {@link RELOCATE_TRIALS} candidate layouts per figure, plus
 * one layout of the figure as it is (once a candidate passes), and only for
 * figures `HintTrials` accepts (at most 80 elements) without HTML or
 * external assets. All of it, the lint of each trial included, runs as a
 * hint trial, so no other rule starts layouts inside it.
 */

import { parse, stringify } from "yaml";
import { loadFigureAssets } from "../../assets/load";
import type { ArrangeBoxIR, ArrangeItemIR, FigureIR } from "../../compiler/ir";
import type { ElementKey } from "../../core/check-state";
import type { Diagnostic, DocPath } from "../../core/diagnostics";
import { parseYaml } from "../../core/figure/yaml";
import { getFontSet } from "../../core/theme/fonts";
import { asHintTrial, HintTrials, hintLayoutOptions, mapBoxes } from "../../layout/hint-trials";
import type { LayoutIR } from "../../layout/ir";
import { routeStructured } from "../../layout/route/face-routes";
import { setOverlapDiagnostics } from "../../layout/set-overlap";
import { placeStructured } from "../../layout/structured/engine";
import type { Point, Rect } from "../../render/geometry";
import { inspectSvg } from "../../render/inspect";
import { writeStructuredSvg } from "../../render/structured";
import { resolveLintConfig } from "../config";
import { defineGeometryRule, isGeometryRule } from "../rule";
import { boxOf, corners, inGroup, orthogonal } from "./avoidable";
import { capitalize, isDrawnEdge, isStructured, mmText } from "./common";
import { createGeometryContext, type GeometryContext, type GeometryElement } from "./context";

export const RELOCATABLE_NODE = "geometry/relocatable-node";

/** At most this many candidate moves are laid out and routed per figure. */
export const RELOCATE_TRIALS = 6;

/** How far (in rows or columns) a grid item may move to an empty cell; a stack / row item, in places. */
const REACH = 2;

/** A shorter detour counts only from this much (1pt, in units). */
const DETOUR_GAIN = 2;

/** An item of an arrange box. */
interface Slot {
  readonly box: ArrangeBoxIR;
  readonly index: number;
}

export interface Candidate {
  readonly slot: Slot;
  /** Grid: the target item index (an empty cell); stack / row: the new index. */
  readonly target: number;
  /** The edges this move is for: they bend more than their ends need. */
  readonly edges: readonly ElementKey[];
  readonly score: number;
  readonly distance: number;
  readonly order: number;
}

/** A layout and route of a figure, as render does it. */
interface Trial {
  readonly ir: FigureIR;
  readonly layout: LayoutIR;
  /** The trial before routing, as `GeometryContext.placed`. */
  readonly placed: { readonly ir: FigureIR; readonly layout: LayoutIR };
  readonly diagnostics: readonly Diagnostic[];
}

const bendsOf = (points: readonly Point[] | undefined): number =>
  points === undefined || points.length < 2 ? Number.POSITIVE_INFINITY : corners(points).length - 2;

/** Route length beyond the Manhattan distance between its ends (a U's way back). */
function detourOf(points: readonly Point[] | undefined): number {
  if (points === undefined || points.length < 2) return 0;
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as Point;
    const b = points[i] as Point;
    length += Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }
  const first = points[0] as Point;
  const last = points.at(-1) as Point;
  return Math.max(0, length - Math.abs(first.x - last.x) - Math.abs(first.y - last.y));
}

/** Bends an edge between these boxes needs at least: none if they overlap on an axis, else one. */
function neededBends(a: Rect, b: Rect): number {
  const x = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const y = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return x > 0 || y > 0 ? 0 : 1;
}

/** Edges that bend more than their ends' positions need, with their routes. */
function excessEdges(context: GeometryContext): GeometryElement[] {
  const out: GeometryElement[] = [];
  for (const element of context.elements) {
    const edge = element.ir;
    if (edge.kind !== "edge" || !isDrawnEdge(element) || element.route === undefined) continue;
    if (edge.routing === "zoom" || edge.route === "curve" || edge.route === "straight") continue;
    if (edge.from === edge.to) continue;
    if (context.isAncestor(edge.from, edge.to) || context.isAncestor(edge.to, edge.from)) continue;
    const line = element.route[0];
    if (line === undefined || element.route.length !== 1) continue;
    const points = corners(line);
    if (points.length < 3 || !orthogonal(points)) continue;
    // A branch of a fan is drawn like its siblings: its bends are the group's shape.
    if (inGroup(context, element, points)) continue;
    const a = boxOf(context.get(edge.from));
    const b = boxOf(context.get(edge.to));
    if (a === undefined || b === undefined) continue;
    if (points.length - 2 > neededBends(a, b)) out.push(element);
  }
  return out;
}

/** The arrange boxes of the figure; nested boxes know their slot, a group's box its group. */
function arrangeSlots(ir: FigureIR) {
  const boxes: ArrangeBoxIR[] = [];
  /** A nested box → the slot holding it. */
  const parent = new Map<ArrangeBoxIR, Slot>();
  /** A group's own arrange box → the group. */
  const owner = new Map<ArrangeBoxIR, ElementKey>();
  const visit = (box: ArrangeBoxIR) => {
    boxes.push(box);
    box.items.forEach((item, index) => {
      if (item === null || typeof item === "string") return;
      parent.set(item, { box, index });
      // A caption stack (#130) stands for its group: not a box of its own.
      if (item.growFirst !== true) visit(item);
    });
  };
  if (ir.arrange !== undefined) visit(ir.arrange);
  for (const group of ir.groups) {
    if (group.arrange === undefined) continue;
    owner.set(group.arrange, group.key);
    visit(group.arrange);
  }
  /** The slot holding `key` directly (or as the group of a caption stack). */
  const slotOf = (key: ElementKey): Slot | undefined => {
    for (const box of boxes) {
      const index = box.items.findIndex(
        (item) =>
          item === key ||
          (item !== null &&
            typeof item !== "string" &&
            item.growFirst === true &&
            item.items[0] === key),
      );
      if (index >= 0) return { box, index };
    }
    return undefined;
  };
  /** The slot holding the box a slot is in: the next item out. */
  const outer = (slot: Slot): Slot | undefined => {
    const up = parent.get(slot.box);
    if (up !== undefined) return up;
    const group = owner.get(slot.box);
    return group === undefined ? undefined : slotOf(group);
  };
  return { boxes, slotOf, outer };
}

const ARRANGE_KINDS = ["stack", "row", "grid", "place", "chat"] as const;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** The kind of an arrange box as written, if `v` is one. */
const boxKind = (v: unknown) => (isRecord(v) ? ARRANGE_KINDS.find((k) => k in v) : undefined);

/** A cell or place wrapper `{ item, … }` as written: the item inside it. */
const unwrap = (v: unknown): unknown => (isRecord(v) && "item" in v ? v.item : v);

/** An `items` sequence of an arrange box in the source, where it is written. */
interface SourceItems {
  readonly kind: ArrangeBoxIR["kind"];
  /** The `items` field. */
  readonly path: DocPath;
  readonly items: readonly unknown[];
}

/**
 * Every `items` sequence of the arrange boxes written in the source: under
 * `figure.layout.arrange` and each group's `arrange`, through nested boxes
 * and the wrappers that hold them (a grid cell's or a place item's `item`).
 * A chat's items are messages, not arrange items.
 */
function sourceItems(document: unknown): SourceItems[] {
  const out: SourceItems[] = [];
  const entry = (value: unknown, path: DocPath) => {
    if (isRecord(value) && "item" in value) entry(value.item, [...path, "item"]);
    else if (boxKind(value) !== undefined) box(value, path);
  };
  const box = (value: unknown, path: DocPath) => {
    const kind = boxKind(value);
    if (kind === undefined || kind === "chat" || !isRecord(value)) return;
    const spec = value[kind];
    if (!isRecord(spec) || !Array.isArray(spec.items)) return;
    const at: DocPath = [...path, kind, "items"];
    out.push({ kind, path: at, items: spec.items });
    for (const [i, item] of spec.items.entries()) entry(item, [...at, i]);
  };
  if (!isRecord(document)) return out;
  const figure = document.figure;
  if (isRecord(figure) && isRecord(figure.layout))
    box(figure.layout.arrange, ["figure", "layout", "arrange"]);
  if (Array.isArray(document.groups))
    document.groups.forEach((g, i) => {
      if (isRecord(g)) box(g.arrange, ["groups", i, "arrange"]);
    });
  return out;
}

/** Whether a source item (unwrapped) is the IR item. */
function sameItem(context: GeometryContext, ir: ArrangeItemIR, written: unknown): boolean {
  if (ir === null) return written === null;
  if (typeof ir === "string" || ir.growFirst === true) return written === itemName(context, ir);
  const kind = boxKind(written);
  if (kind !== ir.kind || !isRecord(written)) return false;
  if (kind === "chat") return true;
  const spec = written[kind];
  return isRecord(spec) && Array.isArray(spec.items) && sameItems(context, ir, spec.items);
}

function sameItems(
  context: GeometryContext,
  box: ArrangeBoxIR,
  items: readonly unknown[],
): boolean {
  return (
    items.length === box.items.length &&
    box.items.every((item, i) => sameItem(context, item, unwrap(items[i])))
  );
}

/** The one `items` sequence in the source that is this box's, or `undefined` (none, or several alike). */
function writtenItems(
  context: GeometryContext,
  box: ArrangeBoxIR,
  document: unknown,
): SourceItems | undefined {
  const found = sourceItems(document).filter(
    (s) => s.kind === box.kind && sameItems(context, box, s.items),
  );
  return found.length === 1 ? found[0] : undefined;
}

/** Whether `item` is `key` or holds it (a group around it, a box with it inside). */
function holds(context: GeometryContext, item: ArrangeItemIR, key: ElementKey): boolean {
  if (item === null) return false;
  if (typeof item === "string") return item === key || context.isAncestor(item, key);
  return item.items.some((i) => holds(context, i, key));
}

/** `groups[1].arrange.grid.items` */
function pathText(path: DocPath): string {
  return path.map((p, i) => (typeof p === "number" ? `[${p}]` : i === 0 ? p : `.${p}`)).join("");
}

/** Row and column (0-based) of each item of a grid, with spans. */
function gridCells(box: ArrangeBoxIR): { row: number; column: number }[] {
  const columns = box.columns ?? 1;
  let at = 0;
  return box.items.map((_, i) => {
    const cell = { row: Math.floor(at / columns), column: at % columns };
    at += box.spans?.[i] ?? 1;
    return cell;
  });
}

/** The box with the move done (grid: the item and the empty cell swap places). */
function movedBox(box: ArrangeBoxIR, from: number, to: number): ArrangeBoxIR {
  if (box.kind !== "grid") {
    const items = [...box.items];
    const [item] = items.splice(from, 1);
    items.splice(to, 0, item as ArrangeItemIR);
    return { ...box, items };
  }
  const swap = <T>(list: readonly T[] | undefined): T[] | undefined => {
    if (list === undefined) return undefined;
    const out = [...list];
    [out[from], out[to]] = [out[to] as T, out[from] as T];
    return out;
  };
  let items = swap(box.items) as ArrangeItemIR[];
  let spans = swap(box.spans);
  let cellAligns = swap(box.cellAligns);
  // The row the item left, if it was the last and is now empty, is dropped:
  // an empty row still takes a row gap.
  const cells = gridCells(box);
  const left = cells[from]?.row;
  const last = Math.max(...cells.map((c) => c.row));
  if (left === last && left > 0) {
    const keep = cells.map((c) => c.row !== last);
    if (items.every((item, i) => keep[i] || item === null)) {
      items = items.filter((_, i) => keep[i]);
      spans = spans?.filter((_, i) => keep[i]);
      cellAligns = cellAligns?.filter((_, i) => keep[i]);
    }
  }
  return {
    ...box,
    items,
    ...(spans !== undefined && { spans }),
    ...(cellAligns !== undefined && { cellAligns }),
  };
}

/** What a trial layout leaves to check: per edge the bends and detour, the canvas, the problems. */
export function routesOf(layout: LayoutIR) {
  return new Map(
    layout.edges.map(
      (e) =>
        [e.key, { bends: bendsOf(e.route?.points), detour: detourOf(e.route?.points) }] as const,
    ),
  );
}

/**
 * Whether an edge points the other way in `after` than in `before`, along x
 * or y (its head was right of / below its tail and is now left of / above
 * it): a reorder that turns the reading direction around.
 */
function reversesAnEdge(ir: FigureIR, before: LayoutIR, after: LayoutIR): boolean {
  const centers = (layout: LayoutIR) =>
    new Map(
      [...layout.nodes, ...layout.groups].map(
        (e) =>
          [e.key, { x: e.rect.x + e.rect.width / 2, y: e.rect.y + e.rect.height / 2 }] as const,
      ),
    );
  const b = centers(before);
  const a = centers(after);
  return ir.edges.some((edge) => {
    const [bf, bt, af, at] = [b.get(edge.from), b.get(edge.to), a.get(edge.from), a.get(edge.to)];
    if (bf === undefined || bt === undefined || af === undefined || at === undefined) return false;
    return (["x", "y"] as const).some((axis) => {
      const d0 = bt[axis] - bf[axis];
      const d1 = at[axis] - af[axis];
      return Math.abs(d0) > 1 && Math.abs(d1) > 1 && Math.sign(d0) !== Math.sign(d1);
    });
  });
}

/** How an item is named in a hint: its ID, `null`, or the kind of nested box. */
function itemName(context: GeometryContext, item: ArrangeItemIR): string {
  if (item === null) return "null";
  if (typeof item === "string") {
    const ir = context.get(item)?.ir;
    return ir !== undefined && ir.kind !== "edge" ? ir.id : item;
  }
  if (item.growFirst === true && typeof item.items[0] === "string")
    return itemName(context, item.items[0]);
  return `a nested ${item.kind}`;
}

/**
 * The written `items` with the move done, as the IR box did it: a grid's
 * entry and the empty cell swap places (wrappers and all) and the emptied
 * last entries are dropped; a stack's or row's entry moves.
 */
function editedItems(
  written: readonly unknown[],
  kind: ArrangeBoxIR["kind"],
  from: number,
  to: number,
  dropped: number,
): unknown[] {
  const items = [...written];
  if (kind === "grid") {
    [items[from], items[to]] = [items[to], items[from]];
    if (dropped > 0) items.splice(items.length - dropped, dropped);
  } else {
    const [item] = items.splice(from, 1);
    items.splice(to, 0, item);
  }
  return items;
}

/**
 * The items as one YAML flow sequence, or `undefined` when the text does not
 * parse back to the same data (then the hint gives only the index edit).
 */
function itemsYaml(data: readonly unknown[]): string | undefined {
  const text = stringify(data, { collectionStyle: "flow", lineWidth: 0 }).trim();
  try {
    return Bun.deepEquals(parse(text), data, true) ? text : undefined;
  } catch {
    return undefined;
  }
}

type RouteMap = ReturnType<typeof routesOf>;

/** Why a trial was not kept, or what it gained. */
export type RouteVerdict =
  | { readonly ok: true; readonly bends: [number, number]; readonly detour: number }
  | {
      readonly ok: false;
      readonly reason: "lost-route" | "more-bends" | "longer-detour" | "no-gain";
    };

/**
 * Compares the routes of a trial with the rendered ones: kept only if no edge
 * loses its route or bends more, no other edge's detour grows by more than
 * 1pt, and `edges` (what the move is for) bend less in total, or as much
 * with a detour at least 1pt shorter.
 */
export function compareRoutes(
  before: RouteMap,
  after: RouteMap,
  edges: readonly ElementKey[],
): RouteVerdict {
  for (const [key, r] of before) {
    const a = after.get(key);
    if (a === undefined || !Number.isFinite(a.bends)) return { ok: false, reason: "lost-route" };
    if (a.bends > r.bends) return { ok: false, reason: "more-bends" };
    if (!edges.includes(key) && a.detour > r.detour + DETOUR_GAIN)
      return { ok: false, reason: "longer-detour" };
  }
  const sum = (map: RouteMap, field: "bends" | "detour") =>
    edges.reduce((s, key) => s + (map.get(key)?.[field] ?? 0), 0);
  const bends: [number, number] = [sum(before, "bends"), sum(after, "bends")];
  const detour = sum(before, "detour") - sum(after, "detour");
  if (bends[1] < bends[0] || (bends[1] === bends[0] && detour >= DETOUR_GAIN))
    return { ok: true, bends, detour };
  return { ok: false, reason: "no-gain" };
}

/** Errors and warnings of a lint run: by code and subject, counted. */
type Problems = Map<string, number>;

/**
 * Lints a trial the way the figure itself is linted: its layout's
 * diagnostics, then the geometry rules (all but this one) under the same
 * configuration and levels, on the trial's SVG with its placement and routes
 * (so rules that check a hint by routing again, such as
 * `geometry/avoidable-bend`, do so here too). Runs inside the hint-trial
 * guard, so no rule starts layouts of its own.
 */
function problemsOf(
  context: GeometryContext,
  trial: Trial,
  assets: Parameters<typeof writeStructuredSvg>[3],
): Problems | undefined {
  const fonts = getFontSet(trial.ir.meta.fontSetId);
  if (fonts === undefined) return undefined;
  const inspected = inspectSvg(writeStructuredSvg(trial.ir, trial.layout, fonts, assets), trial.ir);
  if (!inspected.ok) return undefined;
  const config = context.lintConfig ?? resolveLintConfig();
  const linted: GeometryContext = {
    ...createGeometryContext(trial.ir, inspected.value, fonts),
    layout: trial.layout,
    placed: trial.placed,
    lintConfig: config,
  };
  const counts: Problems = new Map();
  const add = (code: string, subject: unknown) => {
    const key = `${code} ${JSON.stringify(subject ?? null)}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };
  for (const d of trial.diagnostics)
    if (d.severity === "error" || d.severity === "warning") add(d.code, d.subject);
  for (const { rule, severity, options, explicitSeverity } of config.rules) {
    if (!isGeometryRule(rule) || rule.id === RELOCATABLE_NODE) continue;
    for (const f of rule.run(linted, options)) {
      const level = explicitSeverity ? severity : (f.severity ?? severity);
      if (level === "error" || level === "warning") add(rule.id, f.subject);
    }
  }
  return counts;
}

/** What became of one candidate move. */
export interface RelocationOutcome {
  readonly candidate: Candidate;
  /** The moved box. */
  readonly box: ArrangeBoxIR;
  readonly verdict:
    | RouteVerdict
    | {
        readonly ok: false;
        readonly reason: "failed" | "error" | "reversed" | "grows" | "problems";
      };
  /** The route comparison, for a move whose routes passed but that a later check turned down. */
  readonly routes?: RouteVerdict;
  /** Canvas shrink in units (kept moves only). */
  readonly shorter?: number;
  readonly narrower?: number;
}

/**
 * Finds the candidate moves of a figure and tries the first
 * {@link RELOCATE_TRIALS}, as the rule does: every layout, route and lint of
 * a trial runs inside the hint-trial guard. Empty when the rule does not
 * apply. Exported for tests.
 */
export function relocationTrials(context: GeometryContext): RelocationOutcome[] {
  if (!isStructured(context)) return [];
  const placed = context.placed;
  const rendered = context.layout;
  if (placed === undefined || rendered === undefined) return [];
  const original = placed.ir;
  const excess = excessEdges(context);
  if (excess.length === 0) return [];
  if (!new HintTrials(original).eligible) return [];
  if (context.html?.size || original.nodes.some((n) => n.image !== undefined)) return [];
  if ([...(original.assets?.values() ?? [])].some((a) => a.src !== undefined)) return [];

  const { boxes, slotOf, outer } = arrangeSlots(original);
  // Candidate moves, per end of each edge: its own slot, then the next item out.
  const candidates = new Map<string, Candidate>();
  let order = 0;
  for (const element of excess) {
    const edge = element.ir;
    if (edge.kind !== "edge") continue;
    for (const [end, other] of [
      [edge.from, edge.to],
      [edge.to, edge.from],
    ] as const) {
      let slot = slotOf(end);
      for (let level = 0; level < 2 && slot !== undefined; level++, slot = outer(slot)) {
        const { box, index } = slot;
        if (holds(context, box.items[index] ?? null, other)) break;
        if (box.kind !== "grid" && box.kind !== "stack" && box.kind !== "row") continue;
        if (box.growFirst === true) continue;
        // Other ends in this box, for ranking: the cells in line with them come first.
        const cells = box.kind === "grid" ? gridCells(box) : undefined;
        const lineUp = (target: number) => {
          if (cells === undefined) return 0;
          const t = cells[target];
          if (t === undefined) return 0;
          let n = 0;
          for (const e of excess) {
            if (e.ir.kind !== "edge") continue;
            const mine = holds(context, box.items[index] ?? null, e.ir.from)
              ? e.ir.to
              : holds(context, box.items[index] ?? null, e.ir.to)
                ? e.ir.from
                : undefined;
            if (mine === undefined) continue;
            const at = box.items.findIndex((item) => holds(context, item, mine));
            const c = at >= 0 ? cells[at] : undefined;
            if (c !== undefined && (c.row === t.row || c.column === t.column)) n++;
          }
          return n;
        };
        const targets: { target: number; distance: number }[] = [];
        if (cells !== undefined) {
          const here = cells[index];
          if (here === undefined || (box.spans?.[index] ?? 1) !== 1) continue;
          box.items.forEach((item, t) => {
            const c = cells[t];
            if (item !== null || t === index || c === undefined) return;
            if ((box.spans?.[t] ?? 1) !== 1) return;
            const d = Math.max(Math.abs(c.row - here.row), Math.abs(c.column - here.column));
            if (d <= REACH) targets.push({ target: t, distance: d });
          });
        } else {
          for (let d = 1; d <= REACH; d++)
            for (const t of [index - d, index + d])
              if (t >= 0 && t < box.items.length) targets.push({ target: t, distance: d });
        }
        for (const { target, distance } of targets) {
          const id = `${boxes.indexOf(box)}#${index}>${target}`;
          const known = candidates.get(id);
          if (known !== undefined) {
            if (!known.edges.includes(edge.key))
              candidates.set(id, { ...known, edges: [...known.edges, edge.key] });
            continue;
          }
          candidates.set(id, {
            slot,
            target,
            edges: [edge.key],
            score: lineUp(target),
            distance,
            order: order++,
          });
        }
      }
    }
  }
  const ordered = [...candidates.values()]
    .sort((a, b) => b.score - a.score || a.distance - b.distance || a.order - b.order)
    .slice(0, RELOCATE_TRIALS);
  if (ordered.length === 0) return [];

  const assets = loadFigureAssets(original);
  if (!assets.ok) return [];
  const options = hintLayoutOptions.get(original);
  // Everything below (layouts, routes and the lint of each trial) runs as a
  // hint trial: no rule or router starts trials of its own, so the layouts
  // are the candidates' and the baseline's only.
  return asHintTrial(() => {
    const trial = (ir: FigureIR): Trial | undefined => {
      try {
        const laid = placeStructured(ir, options);
        const { ir: faced, routed } = routeStructured(ir, laid.layout, { hintTrials: false });
        return {
          ir: faced,
          layout: routed.layout,
          placed: { ir, layout: laid.layout },
          diagnostics: [
            ...laid.diagnostics,
            ...setOverlapDiagnostics(faced, laid.layout),
            ...routed.diagnostics,
          ],
        };
      } catch {
        // A counterfactual may be invalid; it is never a recommendation.
        return undefined;
      }
    };
    const before = routesOf(rendered);
    const { width, height } = rendered.canvas;
    let baseline: Problems | undefined | null = null;
    const baselineProblems = () => {
      if (baseline !== null) return baseline;
      baseline = undefined;
      const base = trial(original);
      if (base === undefined) return baseline;
      // The trial must redraw the figure as rendered, or nothing it shows can be trusted.
      const again = routesOf(base.layout);
      const same =
        base.layout.canvas.width === width &&
        base.layout.canvas.height === height &&
        [...before].every(([key, r]) => again.get(key)?.bends === r.bends);
      if (same) baseline = problemsOf(context, base, assets.value);
      return baseline;
    };
    const outcomes: RelocationOutcome[] = [];
    for (const candidate of ordered) {
      const { slot, target } = candidate;
      const box = movedBox(slot.box, slot.index, target);
      const done = (verdict: RelocationOutcome["verdict"], extra = {}) =>
        outcomes.push({ candidate, box, verdict, ...extra });
      const result = trial(mapBoxes(original, (b, o) => (o === slot.box ? box : b)));
      if (result === undefined) {
        done({ ok: false, reason: "failed" });
        continue;
      }
      if (result.diagnostics.some((d) => d.severity === "error")) {
        done({ ok: false, reason: "error" });
        continue;
      }
      const verdict = compareRoutes(before, routesOf(result.layout), candidate.edges);
      if (!verdict.ok) {
        done(verdict);
        continue;
      }
      // The reading direction stays: no edge comes to point the other way.
      if (reversesAnEdge(original, rendered, result.layout)) {
        done({ ok: false, reason: "reversed" }, { routes: verdict });
        continue;
      }
      const canvas = result.layout.canvas;
      if (canvas.width > width + 1e-6 || canvas.height > height + 1e-6) {
        done({ ok: false, reason: "grows" }, { routes: verdict });
        continue;
      }
      const base = baselineProblems();
      if (base === undefined) break;
      const problems = problemsOf(context, result, assets.value);
      if (problems === undefined || [...problems].some(([key, n]) => n > (base.get(key) ?? 0))) {
        done({ ok: false, reason: "problems" }, { routes: verdict });
        continue;
      }
      done(verdict, { shorter: height - canvas.height, narrower: width - canvas.width });
    }
    return outcomes;
  });
}

export const relocatableNode = defineGeometryRule({
  id: RELOCATABLE_NODE,
  description:
    "An edge bends more than its ends need, and moving an end (or the arrange item holding it) to a nearby empty grid cell or another place in its stack or row, checked by laying the figure out and routing it again, removes bends.",
  defaultSeverity: "info",
  fixable: false,
  run(context) {
    const rendered = context.layout;
    // The hint names where to edit in the source: without it, nothing to say.
    if (rendered === undefined || context.source === undefined) return [];
    const document = parseYaml(context.source).source?.value;
    if (document === undefined) return [];
    const { width, height } = rendered.canvas;
    let best: (RelocationOutcome & { verdict: { ok: true } }) | undefined;
    const gainOf = (o: { verdict: { bends: [number, number] } }) =>
      o.verdict.bends[0] - o.verdict.bends[1];
    for (const outcome of relocationTrials(context)) {
      if (!outcome.verdict.ok) continue;
      const kept = outcome as RelocationOutcome & {
        verdict: { ok: true; bends: [number, number]; detour: number };
      };
      const area = (o: RelocationOutcome) => (o.shorter ?? 0) * width + (o.narrower ?? 0) * height;
      if (
        best === undefined ||
        gainOf(kept) > gainOf(best as typeof kept) ||
        (gainOf(kept) === gainOf(best as typeof kept) &&
          (kept.verdict.detour > (best as typeof kept).verdict.detour + 1e-6 ||
            (Math.abs(kept.verdict.detour - (best as typeof kept).verdict.detour) <= 1e-6 &&
              area(kept) > area(best) + 1e-6)))
      )
        best = kept;
    }
    if (best === undefined) return [];
    const won = best as RelocationOutcome & {
      verdict: { ok: true; bends: [number, number]; detour: number };
    };

    const { candidate, box } = won;
    const { slot, target } = candidate;
    const item = slot.box.items[slot.index] ?? null;
    const movedKey =
      typeof item === "string"
        ? item
        : item !== null && item.growFirst === true && typeof item.items[0] === "string"
          ? item.items[0]
          : undefined;
    const moved = movedKey === undefined ? undefined : context.get(movedKey);
    const edges = candidate.edges.flatMap((key) => {
      const e = context.get(key);
      if (e === undefined || e.ir.kind !== "edge") return [];
      const id = (k: ElementKey) => {
        const ir = context.get(k)?.ir;
        return ir !== undefined && ir.kind !== "edge" ? ir.id : k;
      };
      return [{ element: e, text: `${e.name} (${id(e.ir.from)} → ${id(e.ir.to)})` }];
    });
    const name = itemName(context, item);
    const who = moved?.name ?? name;
    // Where the box's items are written: the one sequence in the source that
    // holds exactly its items (through any wrapper), or no hint at all.
    const written = writtenItems(context, slot.box, document);
    if (written === undefined) return [];
    const boxPath = written.path.slice(0, -2);
    const group = context.placed?.ir.groups.find((g) => g.arrange === slot.box);
    const owner = group === undefined ? undefined : context.get(group.key)?.name;
    const where =
      boxPath.length === 3 && boxPath[0] === "figure"
        ? `the ${slot.box.kind} of figure.layout.arrange`
        : owner !== undefined
          ? `the ${slot.box.kind} of ${owner}`
          : `the ${slot.box.kind} at ${pathText(boxPath)}`;
    const field = pathText(written.path);
    let move: string;
    let edit: string;
    if (slot.box.kind === "grid") {
      const cells = gridCells(slot.box);
      const from = cells[slot.index];
      const to = cells[target];
      if (from === undefined || to === undefined) return [];
      const columns = slot.box.columns ?? 1;
      const lo = Math.max(0, to.column - 1);
      const hi = Math.min(columns - 1, to.column + 1);
      const row = gridCells(box)
        .map((c, i) => ({ c, i }))
        .filter(({ c }) => c.row === to.row && c.column >= lo && c.column <= hi)
        .map(({ i }) => itemName(context, box.items[i] ?? null));
      const dropped = slot.box.items.length - box.items.length;
      move = `from row ${from.row + 1}, column ${from.column + 1} to the empty cell at row ${to.row + 1}, column ${to.column + 1} of ${where}`;
      edit = `swap items[${slot.index}] (${name}) with items[${target}] (the null at row ${to.row + 1}, column ${to.column + 1}), so row ${to.row + 1}, columns ${lo + 1}–${hi + 1} become ${row.join(", ")}${
        dropped > 0
          ? `; then delete the last ${dropped} items (row ${from.row + 1}, now empty)`
          : ""
      }`;
    } else {
      move = `from place ${slot.index + 1} to place ${target + 1} of ${where}`;
      edit = `move items[${slot.index}] (${name}) to items[${target}], so the order becomes ${box.items.map((i) => itemName(context, i)).join(", ")}`;
    }
    const yaml = itemsYaml(
      editedItems(
        written.items,
        slot.box.kind,
        slot.index,
        target,
        slot.box.items.length - box.items.length,
      ),
    );
    const list = edges.map((e) => e.text).join(" and ");
    const times = (n: number) => `${n} ${n === 1 ? "time" : "times"}`;
    const [b0, b1] = won.verdict.bends;
    const effect =
      b0 > b1
        ? edges.length === 1
          ? `${list} bends ${times(b1)} instead of ${b0}`
          : `${list} bend ${times(b1)} in total instead of ${b0}`
        : `${list} ${edges.length === 1 ? "takes" : "take"} a ${mmText(context, won.verdict.detour)} shorter detour`;
    const size = [
      ...((won.shorter ?? 0) > 1e-6 ? [`${mmText(context, won.shorter ?? 0)} shorter`] : []),
      ...((won.narrower ?? 0) > 1e-6 ? [`${mmText(context, won.narrower ?? 0)} narrower`] : []),
    ];
    return [
      {
        message: `${capitalize(who)} could move ${move}: then ${effect}${size.length > 0 ? `, and the figure is ${size.join(" and ")}` : ""} (checked by laying the figure out and routing it again: no other edge bends more or has its detour grow by more than 1pt, the figure does not grow and the geometry lint finds no new error or warning).`,
        path: written.path,
        ...(moved !== undefined && { subject: moved.subject }),
        hint: `In ${field}, ${edit}${yaml === undefined ? "" : `: items: ${yaml}`}. Nothing is moved for you: keep the current place if it carries meaning (such as failures below the main flow).`,
        related: edges.map(({ element }) => ({
          path: element.docPath,
          message: `${capitalize(element.name)} is defined here.`,
        })),
      },
    ];
  },
});
