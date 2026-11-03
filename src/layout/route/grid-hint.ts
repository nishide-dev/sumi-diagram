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

export function verifiedGridHints(
  ir: FigureIR,
  layout: LayoutIR,
  diagnostics: Diagnostic[],
): Diagnostic[] {
  return diagnostics.map((d) => {
    if (d.code !== "layout/straight-off-side" && d.code !== "layout/no-route") return d;
    const edge = ir.edges.find((e) => (e.id ?? `edges[${e.index}]`) === d.subject?.id);
    if (!edge) return d;
    const trials = new HintTrials(ir);
    for (const field of ["fromAnchor", "toAnchor"] as const) {
      if (
        edge[field] !== "straight" ||
        (d.code === "layout/straight-off-side" && d.path?.at(-1) !== field)
      )
        continue;
      const key = field === "fromAnchor" ? edge.from : edge.to;
      const other = field === "fromAnchor" ? edge.to : edge.from;
      const neutral = gridSpanHint(ir, layout, key, other);
      const cell = spanningCell(ir, key);
      const node = ir.nodes.find((n) => n.key === key);
      if (!neutral || !cell) continue;
      if (!trials.eligible) return { ...d, hint: neutral };
      if (node && (node.render || node.badge || !stretchableShape(node.shape)))
        return { ...d, hint: neutral };
      const candidate = mapBoxes(ir, (b) =>
        b.kind === "grid" && b.items.includes(key) ? { ...b, align: "stretch" } : b,
      );
      const nodes = candidate.nodes.map((n) => {
        if (n.key !== key) return n;
        const { width: _, ...rest } = n;
        return rest;
      });
      const copy = {
        ...candidate,
        nodes,
        elements: new Map(
          [...nodes, ...candidate.groups, ...candidate.edges].map((e) => [e.key, e]),
        ),
      };
      const result = trials.run(copy);
      const remains = result?.diagnostics.some(
        (next) =>
          next.subject?.id === d.subject?.id &&
          (next.code === "layout/no-route" ||
            (next.code === "layout/straight-off-side" && next.path?.at(-1) === field)),
      );
      if (result && !remains)
        return {
          ...d,
          hint: `"${ir.elements.get(key)?.id}" spans ${cell.span} grid columns; span reserves tracks rather than stretching the cell's item. With grid.align: ${cell.box.align ?? "center (default)"}, it keeps its natural width. Verified by structured layout and routing: ${node?.width !== undefined ? "remove props.width and set" : "set"} grid.align: stretch on its containing grid; this removes this diagnostic.`,
        };
      return { ...d, hint: neutral };
    }
    return d;
  });
}
