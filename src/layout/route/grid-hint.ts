import type { ArrangeBoxIR, FigureIR } from "../../compiler/ir";
import type { ElementKey } from "../../core/check-state";
import type { Diagnostic } from "../../core/diagnostics";
import { HintTrials, mapBoxes } from "../hint-trials";
import type { LayoutIR } from "../ir";
import { stretchableShape } from "../structured/sizing";
import { straightPlacement } from "./ports";

function spanningCell(ir: FigureIR, key: ElementKey) {
  const find = (box: ArrangeBoxIR): { box: ArrangeBoxIR; span: number } | undefined => {
    for (const [i, item] of box.items.entries()) {
      if (item === key && box.kind === "grid" && (box.spans?.[i] ?? 1) > 1)
        return { box, span: box.spans?.[i] ?? 1 };
      if (item !== null && typeof item !== "string") {
        const found = find(item);
        if (found) return found;
      }
    }
  };
  return [ir.arrange, ...ir.groups.map((g) => g.arrange)]
    .flatMap((b) => (b ? [b] : []))
    .map(find)
    .find((c) => c !== undefined);
}

/** Neutral explanation used during routing; recommendations are verified after routing. */
export function gridSpanHint(
  ir: FigureIR,
  layout: LayoutIR,
  key: ElementKey,
  other: ElementKey,
): string | undefined {
  const rect = (k: ElementKey) =>
    layout.nodes.find((n) => n.key === k)?.rect ?? layout.groups.find((g) => g.key === k)?.rect;
  const a = rect(key),
    b = rect(other);
  if (
    !a ||
    !b ||
    !(a.y + a.height <= b.y || b.y + b.height <= a.y) ||
    !("off" in straightPlacement(a, b))
  )
    return;
  const cell = spanningCell(ir, key);
  const element = ir.elements.get(key);
  if (!cell || !element || element.kind === "edge") return;
  const prefix = `"${element.id}" spans ${cell.span} grid columns; span reserves tracks rather than stretching the cell's item.`;
  if (
    element.kind === "node" &&
    (element.render || element.badge || !stretchableShape(element.shape))
  )
    return `${prefix} This component keeps its width when grid cells stretch. No verified edit is available.`;
  return `${prefix} The current endpoint geometry does not support this straight anchor. No verified edit is available.`;
}

function stretchCopy(ir: FigureIR, keys: readonly ElementKey[]): FigureIR {
  const candidate = mapBoxes(ir, (b) =>
    b.kind === "grid" && keys.some((k) => b.items.includes(k)) ? { ...b, align: "stretch" } : b,
  );
  const nodes = candidate.nodes.map((n) => {
    if (!keys.includes(n.key)) return n;
    const { width: _, ...rest } = n;
    return rest;
  });
  return {
    ...candidate,
    nodes,
    elements: new Map([...nodes, ...candidate.groups, ...candidate.edges].map((e) => [e.key, e])),
  };
}

const diagnosticId = (d: Diagnostic) => `${d.code}|${d.subject?.id}|${d.path?.join(".")}`;

/**
 * Replace the neutral grid explanation with a recommendation only when a trial
 * layout of the edit (one end, then the other, then both for no-route) removes
 * the diagnostic. The generic advice around it is kept.
 */
export function verifiedGridHints(
  ir: FigureIR,
  layout: LayoutIR,
  diagnostics: Diagnostic[],
): Diagnostic[] {
  const known = new Set(diagnostics.map(diagnosticId));
  return diagnostics.map((d) => {
    if (d.code !== "layout/straight-off-side" && d.code !== "layout/no-route") return d;
    const edge = ir.edges.find((e) => (e.id ?? `edges[${e.index}]`) === d.subject?.id);
    if (!edge) return d;
    const ends = (["fromAnchor", "toAnchor"] as const).flatMap((field) => {
      if (
        edge[field] !== "straight" ||
        (d.code === "layout/straight-off-side" && d.path?.at(-1) !== field)
      )
        return [];
      const key = field === "fromAnchor" ? edge.from : edge.to;
      const other = field === "fromAnchor" ? edge.to : edge.from;
      const neutral = gridSpanHint(ir, layout, key, other);
      const cell = spanningCell(ir, key);
      const node = ir.nodes.find((n) => n.key === key);
      if (!neutral || !cell || !d.hint?.includes(neutral)) return [];
      return [{ field, key, neutral, cell, node }];
    });
    const trials = new HintTrials(ir);
    if (ends.length === 0 || !trials.eligible) return d;
    const fixable = ends.filter(
      ({ node }) => !(node && (node.render || node.badge || !stretchableShape(node.shape))),
    );
    const sets = fixable.map((end) => [end]);
    if (d.code === "layout/no-route" && fixable.length > 1) sets.push(fixable);
    for (const set of sets) {
      const result = trials.run(
        stretchCopy(
          ir,
          set.map((end) => end.key),
        ),
      );
      if (!result) return d;
      const remains = result.diagnostics.some(
        (next) =>
          next.subject?.id === d.subject?.id &&
          (d.code === "layout/no-route"
            ? next.code === "layout/no-route"
            : next.code === "layout/straight-off-side" && next.path?.at(-1) === set[0]?.field),
      );
      if (remains) continue;
      const added = [
        ...new Set(
          result.diagnostics
            .filter((next) => !known.has(diagnosticId(next)) && next.severity !== "info")
            .map((next) => next.code),
        ),
      ];
      const why = set
        .map(
          (end) =>
            `"${ir.elements.get(end.key)?.id}" spans ${end.cell.span} grid columns; span reserves tracks rather than stretching the cell's item. With grid.align: ${end.cell.box.align ?? "center (default)"}, it keeps its natural width.`,
        )
        .join(" ");
      const widths = set.filter((end) => end.node?.width !== undefined);
      const text = `${why} Verified by structured layout and routing: ${widths.length > 0 ? "remove props.width and set" : "set"} grid.align: stretch on ${set.length > 1 ? "their containing grids" : "its containing grid"}; this removes this diagnostic. Re-run lint after applying${added.length > 0 ? `: the trial also produced ${added.join(", ")}` : ", as other diagnostics can change"}.`;
      // Every end's neutral "No verified edit" sentence goes: the first verified end carries the
      // recommendation; an end outside the verified set would otherwise contradict it. The
      // two-end set is defensive: it applies only when stretching both grids is needed.
      const replaced = ends.reduce(
        (hint, end) => hint.replace(end.neutral, end === set[0] ? text : ""),
        d.hint ?? "",
      );
      return { ...d, hint: replaced.replace(/ {2,}/g, " ").trim() };
    }
    return d;
  });
}
