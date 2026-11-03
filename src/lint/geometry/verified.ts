/** Bounded counterfactuals: copies only, no backend, assets or output writes. */
import { type ArrangeBoxIR, type FigureIR, readonlyMap } from "../../compiler/ir";
import { getFontSet } from "../../core/theme/fonts";
import { formatMm } from "../../core/units";
import { routeEdges } from "../../layout/route/router";
import { placeStructured } from "../../layout/structured/engine";
import { unitsToPt } from "../../render/geometry";
import { inspectSvg } from "../../render/inspect";
import { writeStructuredSvg } from "../../render/structured";
import { createGeometryContext, type GeometryContext } from "./context";

export const MAX_HINT_TRIALS = 6;
export const MAX_HINT_ELEMENTS = 100;
export const MAX_HINT_EDGES = 40;
interface Candidate {
  text: string;
  edit: (ir: FigureIR) => void;
  priority: number;
}

/** Mutable deep copy that keeps shared references (elements map, groups, arrange) shared. */
function cloneIr<T>(value: T, memo = new Map<unknown, unknown>()): T {
  if (typeof value !== "object" || value === null) return value;
  const known = memo.get(value);
  if (known) return known as T;
  let copy: unknown;
  if (Array.isArray(value)) {
    copy = [];
    memo.set(value, copy);
    for (const item of value) (copy as unknown[]).push(cloneIr(item, memo));
  } else if (typeof (value as { entries?: unknown }).entries === "function" && "get" in value) {
    const entries = [...(value as unknown as ReadonlyMap<unknown, unknown>).entries()];
    copy = readonlyMap(entries.map(([k, v]) => [k, cloneIr(v, memo)] as const));
    memo.set(value, copy);
  } else {
    copy = {};
    memo.set(value, copy);
    for (const [k, v] of Object.entries(value))
      (copy as Record<string, unknown>)[k] = cloneIr(v, memo);
  }
  return copy as T;
}

/** Stable breadth-first order gives outer constraints a turn before descendants. */
function boxes(ir: FigureIR): { box: ArrangeBoxIR; path: string }[] {
  const queue = [
    ...(ir.arrange ? [{ box: ir.arrange, path: "figure.layout.arrange" }] : []),
    ...ir.groups.flatMap((g) =>
      g.arrange ? [{ box: g.arrange, path: `group "${g.id}".arrange` }] : [],
    ),
  ];
  for (let i = 0; i < queue.length; i++) {
    const entry = queue[i];
    if (!entry) continue;
    entry.box.items.forEach((item, j) => {
      if (item && typeof item !== "string")
        queue.push({ box: item, path: `${entry.path}.${entry.box.kind}.items[${j}]` });
    });
  }
  return queue;
}

export function verifyHints(
  context: GeometryContext,
  mode: "width" | "empty",
  score: (trial: GeometryContext) => number,
): string {
  const neutral =
    "No remedy verified within the bounded layout trials; the measurements describe the current figure.";
  if (context.ir.meta.engine !== "structured")
    return "Observed geometry only; no trial layouts were run.";
  if (
    context.ir.elements.size > MAX_HINT_ELEMENTS ||
    context.ir.edges.length > MAX_HINT_EDGES ||
    context.html?.size ||
    context.ir.nodes.some((n) => n.image !== undefined)
  )
    return "Layout trials skipped for figure size or external assets; the measurements describe the current figure.";
  const candidates: Candidate[] = [];
  boxes(context.ir).forEach(({ box, path }, index) => {
    const field = box.kind === "grid" ? "columnGapPt" : "gapPt";
    if (mode === "width" && box.kind !== "stack" && box[field] !== 0)
      candidates.push({
        priority: 0,
        text: `set ${path}.${box.kind}.${box.kind === "grid" ? "columnGap" : "gap"} to 0mm`,
        edit(ir) {
          Object.assign(boxes(ir)[index]?.box ?? {}, { [field]: 0 });
        },
      });
    if (mode === "empty") {
      for (const [field, value] of [
        ["align", "stretch"],
        ["justify", "stretch"],
        ["justify", "space-between"],
      ] as const) {
        if (box[field] === value) continue;
        candidates.push({
          priority: field === "align" ? 0 : 2,
          text: `set ${path}.${box.kind}.${field} to ${value}`,
          edit(ir) {
            Object.assign(boxes(ir)[index]?.box ?? {}, { [field]: value });
          },
        });
      }
    }
  });
  for (const node of context.ir.nodes) {
    if (node.width === undefined) continue;
    candidates.push({
      priority: 1,
      text: `remove the explicit width of node "${node.id}"`,
      edit(ir) {
        const copy = ir.elements.get(node.key);
        if (copy) Reflect.deleteProperty(copy, "width");
      },
    });
  }
  const fonts = getFontSet(context.ir.meta.fontSetId);
  if (!fonts) return neutral;
  const verified: { text: string; reduction: number }[] = [];
  const baseline = score(context);
  for (const candidate of candidates
    .sort((a, b) => a.priority - b.priority)
    .slice(0, MAX_HINT_TRIALS)) {
    const ir = cloneIr(context.ir);
    candidate.edit(ir);
    try {
      const placed = placeStructured(ir);
      const routed = routeEdges(ir, placed.layout);
      if ([...placed.diagnostics, ...routed.diagnostics].some((d) => d.severity === "error"))
        continue;
      const inspected = inspectSvg(writeStructuredSvg(ir, routed.layout, fonts), ir);
      if (!inspected.ok) continue;
      const trial = createGeometryContext(ir, inspected.value, fonts);
      const reduction = baseline - score(trial);
      if (reduction > 1e-6 && (mode === "width" || score(trial) === 0))
        verified.push({ text: candidate.text, reduction });
    } catch {
      // A counterfactual may be invalid; it is never a recommendation.
    }
  }
  if (!verified.length) return neutral;
  return `Verified layout edits (independent trials): ${verified
    .sort((a, b) => b.reduction - a.reduction || a.text.localeCompare(b.text))
    .slice(0, 3)
    .map((v) =>
      mode === "width"
        ? `${v.text} (page width reduced by ${formatMm(unitsToPt(v.reduction) * (context.inspection.scale ?? 1))})`
        : `${v.text} (removes this diagnostic)`,
    )
    .join("; ")}.`;
}
