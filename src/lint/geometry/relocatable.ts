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
 * many bends, take a shorter detour), no edge bends more, the canvas grows
 * in neither direction and no new error or warning appears. Only the best
 * move is reported, as a YAML edit; nothing is changed: where a node sits
 * can carry meaning (failures below the main flow), so the author decides.
 *
 * Cost: at most {@link RELOCATE_TRIALS} candidate layouts per figure, plus
 * one layout of the figure as it is (once a candidate passes), and only for
 * figures `HintTrials` accepts (at most 80 elements) without HTML or
 * external assets.
 */

import { loadFigureAssets } from "../../assets/load";
import type { ArrangeBoxIR, ArrangeItemIR, FigureIR } from "../../compiler/ir";
import type { ElementKey } from "../../core/check-state";
import type { Diagnostic, DocPath } from "../../core/diagnostics";
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

/** An item of an arrange box, with where the box is written. */
interface Slot {
  readonly box: ArrangeBoxIR;
  readonly index: number;
  /** The box's `items` field in the source. */
  readonly itemsPath: DocPath;
  /** `the grid of group "active"`, `figure.layout.arrange`, … for messages. */
  readonly where: string;
}

interface Candidate {
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

/** The arrange boxes of the figure with where each is written; nested boxes know their slot. */
function arrangeSlots(context: GeometryContext, ir: FigureIR) {
  const boxes: { box: ArrangeBoxIR; itemsPath: DocPath; where: string }[] = [];
  /** A nested box → the slot holding it. */
  const parent = new Map<ArrangeBoxIR, { box: ArrangeBoxIR; index: number }>();
  /** A group's own arrange box → the group. */
  const owner = new Map<ArrangeBoxIR, ElementKey>();
  const visit = (box: ArrangeBoxIR, path: DocPath, where: string) => {
    boxes.push({ box, itemsPath: [...path, box.kind, "items"], where });
    box.items.forEach((item, index) => {
      if (item === null || typeof item === "string") return;
      parent.set(item, { box, index });
      // A caption stack (#130) stands for its group: not a box of its own.
      if (item.growFirst === true) return;
      const wrapped =
        box.kind === "grid" &&
        (box.spans?.[index] !== undefined || box.cellAligns?.[index] !== undefined);
      const at: DocPath = [...path, box.kind, "items", index, ...(wrapped ? ["item"] : [])];
      visit(item, at, `the ${item.kind} at ${pathText(at)}`);
    });
  };
  if (ir.arrange !== undefined)
    visit(ir.arrange, ["figure", "layout", "arrange"], "figure.layout.arrange");
  for (const group of ir.groups) {
    if (group.arrange === undefined) continue;
    const element = context.get(group.key);
    if (element === undefined) continue;
    owner.set(group.arrange, group.key);
    visit(group.arrange, [...element.docPath, "arrange"], `group "${group.id}"`);
  }
  const entry = (box: ArrangeBoxIR) => boxes.find((b) => b.box === box);
  /** The slot holding `key` directly (or as the group of a caption stack). */
  const slotOf = (key: ElementKey): Slot | undefined => {
    for (const b of boxes) {
      const index = b.box.items.findIndex(
        (item) =>
          item === key ||
          (item !== null &&
            typeof item !== "string" &&
            item.growFirst === true &&
            item.items[0] === key),
      );
      if (index >= 0) return { box: b.box, index, itemsPath: b.itemsPath, where: b.where };
    }
    return undefined;
  };
  /** The slot holding the box a slot is in: the next item out. */
  const outer = (slot: Slot): Slot | undefined => {
    const up = parent.get(slot.box);
    if (up !== undefined) {
      const e = entry(up.box);
      return e === undefined ? undefined : { ...e, index: up.index };
    }
    const group = owner.get(slot.box);
    return group === undefined ? undefined : slotOf(group);
  };
  return { slotOf, outer };
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

const yamlId = (id: string) => (/^[A-Za-z_][\w.-]*$/.test(id) ? id : JSON.stringify(id));

/** An item as written in `items`: its ID, `null`, or a nested box (elided). */
function itemText(context: GeometryContext, item: ArrangeItemIR): string {
  if (item === null) return "null";
  if (typeof item === "string") {
    const ir = context.get(item)?.ir;
    return yamlId(ir !== undefined && ir.kind !== "edge" ? ir.id : item);
  }
  if (item.growFirst === true && typeof item.items[0] === "string")
    return itemText(context, item.items[0]);
  return `{ ${item.kind}: … }`;
}

/** What a trial layout leaves to check: per edge the bends and detour, the canvas, the problems. */
function routesOf(layout: LayoutIR) {
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

/** Errors and warnings of a trial: its layout's and the other geometry rules', counted by code and subject. */
function problemsOf(trial: Trial, assets: Parameters<typeof writeStructuredSvg>[3]) {
  const fonts = getFontSet(trial.ir.meta.fontSetId);
  if (fonts === undefined) return undefined;
  const inspected = inspectSvg(writeStructuredSvg(trial.ir, trial.layout, fonts, assets), trial.ir);
  if (!inspected.ok) return undefined;
  const context = createGeometryContext(trial.ir, inspected.value, fonts);
  const counts = new Map<string, number>();
  const add = (code: string, subject: unknown) => {
    const key = `${code} ${JSON.stringify(subject ?? null)}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };
  for (const d of trial.diagnostics)
    if (d.severity === "error" || d.severity === "warning") add(d.code, d.subject);
  // The rules at their default levels (a rule's configured level is not known here).
  for (const { rule, severity, options } of resolveLintConfig().rules) {
    if (!isGeometryRule(rule) || rule.id === RELOCATABLE_NODE) continue;
    for (const f of rule.run(context, options)) {
      const level = f.severity ?? severity;
      if (level === "error" || level === "warning") add(rule.id, f.subject);
    }
  }
  return counts;
}

export const relocatableNode = defineGeometryRule({
  id: RELOCATABLE_NODE,
  description:
    "An edge bends more than its ends need, and moving an end (or the arrange item holding it) to a nearby empty grid cell or another place in its stack or row, checked by laying the figure out and routing it again, removes bends.",
  defaultSeverity: "info",
  fixable: false,
  run(context) {
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

    const { slotOf, outer } = arrangeSlots(context, original);
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
            const id = `${slot.itemsPath.join("/")}#${index}>${target}`;
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
    const trial = (ir: FigureIR): Trial | undefined => {
      try {
        return asHintTrial(() => {
          const laid = placeStructured(ir, options);
          const { ir: faced, routed } = routeStructured(ir, laid.layout, { hintTrials: false });
          return {
            ir: faced,
            layout: routed.layout,
            diagnostics: [
              ...laid.diagnostics,
              ...setOverlapDiagnostics(faced, laid.layout),
              ...routed.diagnostics,
            ],
          };
        });
      } catch {
        // A counterfactual may be invalid; it is never a recommendation.
        return undefined;
      }
    };
    const before = routesOf(rendered);
    const { width, height } = rendered.canvas;
    let baseline: Map<string, number> | undefined | null = null;
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
      if (same) baseline = problemsOf(base, assets.value);
      return baseline;
    };

    let best:
      | {
          candidate: Candidate;
          bends: [number, number];
          detour: number;
          shorter: number;
          narrower: number;
          box: ArrangeBoxIR;
        }
      | undefined;
    for (const candidate of ordered) {
      const { slot, target } = candidate;
      const box = movedBox(slot.box, slot.index, target);
      const result = trial(mapBoxes(original, (b, o) => (o === slot.box ? box : b)));
      if (result === undefined) continue;
      if (result.diagnostics.some((d) => d.severity === "error")) continue;
      const after = routesOf(result.layout);
      if (after.size !== before.size) continue;
      // No edge bends more, or loses its route.
      if ([...before].some(([key, r]) => (after.get(key)?.bends ?? Infinity) > r.bends)) continue;
      const sum = (map: typeof before, field: "bends" | "detour") =>
        candidate.edges.reduce((s, key) => s + (map.get(key)?.[field] ?? 0), 0);
      const bendsBefore = sum(before, "bends");
      const bendsAfter = sum(after, "bends");
      const detour = sum(before, "detour") - sum(after, "detour");
      if (!(bendsAfter < bendsBefore || (bendsAfter === bendsBefore && detour >= DETOUR_GAIN)))
        continue;
      // The reading direction stays: no edge comes to point the other way.
      if (reversesAnEdge(original, rendered, result.layout)) continue;
      const canvas = result.layout.canvas;
      if (canvas.width > width + 1e-6 || canvas.height > height + 1e-6) continue;
      const base = baselineProblems();
      if (base === undefined) break;
      const problems = problemsOf(result, assets.value);
      if (problems === undefined) continue;
      if ([...problems].some(([key, n]) => n > (base.get(key) ?? 0))) continue;
      const gain = bendsBefore - bendsAfter;
      const shorter = height - canvas.height;
      const narrower = width - canvas.width;
      if (
        best === undefined ||
        gain > best.bends[0] - best.bends[1] ||
        (gain === best.bends[0] - best.bends[1] &&
          (detour > best.detour + 1e-6 ||
            (Math.abs(detour - best.detour) <= 1e-6 &&
              shorter * width + narrower * height >
                best.shorter * width + best.narrower * height + 1e-6)))
      )
        best = { candidate, bends: [bendsBefore, bendsAfter], detour, shorter, narrower, box };
    }
    if (best === undefined) return [];

    const { candidate, box } = best;
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
    const endKey = edges[0]?.element.ir;
    const who =
      moved?.name ??
      (endKey?.kind === "edge" && item !== null
        ? `the ${typeof item === "string" ? "item" : item.kind} holding ${
            context.get(holds(context, item, endKey.from) ? endKey.from : endKey.to)?.name ?? "it"
          }`
        : "the item");
    // A nested box is named by its path ("the row at …"); a group's or the figure's by its owner.
    const where = slot.where.startsWith("the ")
      ? slot.where
      : `the ${slot.box.kind} of ${slot.where}`;
    const items = box.items.map((i) => itemText(context, i));
    let move: string;
    let change: string;
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
        .map(({ i }) => items[i]);
      const dropped = box.items.length < slot.box.items.length;
      move = `from row ${from.row + 1}, column ${from.column + 1} to the empty cell at row ${to.row + 1}, column ${to.column + 1} of ${where}`;
      change = `row ${to.row + 1}, columns ${lo + 1}–${hi + 1} become ${row.join(", ")}${dropped ? `, and the emptied last row ${from.row + 1} is dropped` : ""}`;
    } else {
      move = `from place ${slot.index + 1} to place ${target + 1} of ${where}`;
      change = `the order becomes ${items.join(", ")}`;
    }
    const list = edges.map((e) => e.text).join(" and ");
    const times = (n: number) => `${n} ${n === 1 ? "time" : "times"}`;
    const effect =
      best.bends[0] > best.bends[1]
        ? edges.length === 1
          ? `${list} bends ${times(best.bends[1])} instead of ${best.bends[0]}`
          : `${list} bend ${times(best.bends[1])} in total instead of ${best.bends[0]}`
        : `${list} ${edges.length === 1 ? "takes" : "take"} a ${mmText(context, best.detour)} shorter detour`;
    const size = [
      ...(best.shorter > 1e-6 ? [`${mmText(context, best.shorter)} shorter`] : []),
      ...(best.narrower > 1e-6 ? [`${mmText(context, best.narrower)} narrower`] : []),
    ];
    return [
      {
        message: `${capitalize(who)} could move ${move}: then ${effect}${size.length > 0 ? `, and the figure is ${size.join(" and ")}` : ""} (checked by laying the figure out and routing it again: no other edge bends more, the figure does not grow and no new error or warning appears).`,
        path: slot.itemsPath,
        ...(moved !== undefined && { subject: moved.subject }),
        hint: `In ${pathText(slot.itemsPath)}, ${change}: items: [ ${items.join(", ")} ]. Nothing is moved for you: keep the current place if it carries meaning (such as failures below the main flow).`,
        related: edges.map(({ element }) => ({
          path: element.docPath,
          message: `${capitalize(element.name)} is defined here.`,
        })),
      },
    ];
  },
});
