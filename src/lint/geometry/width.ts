/** Read-only width attribution from the same geometry that triggered the page limit. */
import type { ArrangeBoxIR, ArrangeItemIR } from "../../compiler/ir";
import type { ElementKey } from "../../core/check-state";
import { formatMm } from "../../core/units";
import { type Rect, unitsToPt } from "../../render/geometry";
import { printedSize } from "../../render/size";
import type { GeometryContext, GeometryElement } from "./context";
import { unionOf } from "./measure";
import { verifyHints } from "./verified";

interface Footprint {
  name: string;
  rect: Rect;
  key?: ElementKey;
  run?: Run;
}

/** Text-only nodes have no shape bbox; their measured label is their footprint. */
function footprint(element: GeometryElement): Rect | undefined {
  return unionOf([
    ...(element.bbox ? [element.bbox] : []),
    ...element.labels.flatMap((label) => (label.box ? [label.box] : [])),
    ...(element.badge ? [element.badge] : []),
  ]);
}

interface Run {
  name: string;
  items: Footprint[];
  rect: Rect;
  /** Prefer a detailed row/grid over an equally wide stack or root union. */
  priority: number;
}

/**
 * A projection is additive even when items overlap on x (grid spans, nested
 * stacks, auto layers). Overlaps are merged, never counted twice. These are
 * observed spaces, not a claim about configured gaps or ELK's constraints.
 */
function projection(items: Footprint[]): { widths: number; gaps: number; largestGap: number } {
  const sorted = [...items].sort((a, b) => a.rect.x - b.rect.x);
  let end = sorted[0]?.rect.x ?? 0;
  let widths = 0;
  let gaps = 0;
  let largestGap = 0;
  for (const { rect } of sorted) {
    const gap = Math.max(0, rect.x - end);
    gaps += gap;
    largestGap = Math.max(largestGap, gap);
    widths += Math.max(0, rect.x + rect.width - Math.max(end, rect.x));
    end = Math.max(end, rect.x + rect.width);
  }
  return { widths, gaps, largestGap };
}

/** `hint` leads with overflow, the widest run and verified edits; `details` is the fine-grained breakdown (#368). */
export interface WidthBreakdown {
  hint: string;
  details: string[];
}

export function widthBreakdown(context: GeometryContext): WidthBreakdown {
  const mm = (units: number) => formatMm(unitsToPt(units * (context.inspection.scale ?? 1)));
  const byKey = new Map<ElementKey, Footprint>();
  for (const element of context.elements) {
    if (element.kind === "edge") continue;
    const rect = footprint(element);
    if (rect) byKey.set(element.key, { name: element.name, rect, key: element.key });
  }
  if (byKey.size === 0) return { hint: "", details: [] };
  const runs: Run[] = [];
  const visit = (item: ArrangeItemIR, path: string): Footprint | undefined => {
    if (item === null) return undefined;
    if (typeof item === "string") return byKey.get(item);
    let cursor = 0;
    const items = item.items.flatMap((child, i) => {
      const found = visit(child, `${path}.${item.kind}.items[${i}]`);
      if (item.kind === "grid") {
        const column = (cursor % (item.columns as number)) + 1;
        const span = item.spans?.[i] ?? 1;
        cursor += span;
        if (found)
          return [
            {
              ...found,
              name: `column${span > 1 ? "s" : ""} ${column}${span > 1 ? `–${column + span - 1}` : ""}: ${found.name}`,
            },
          ];
      }
      return found ? [found] : [];
    });
    const rect = unionOf(items.map((child) => child.rect));
    if (!rect) return undefined;
    const name = `${path}.${item.kind}`;
    const run = { name, items, rect, priority: item.kind === "stack" ? 1 : 0 };
    runs.push(run);
    return { name, rect, run };
  };
  const containers: { name: string; tree: ArrangeBoxIR | undefined; parent?: ElementKey }[] = [
    { name: "figure.layout.arrange", tree: context.ir.arrange },
    ...context.ir.groups.map((group) => ({
      name: `group "${group.id}".arrange`,
      tree: group.arrange,
      parent: group.key,
    })),
  ];
  const attachments: { name: string; width: number }[] = [];
  const groupRuns = new Map<ElementKey, Run>();
  for (const container of containers) {
    const base = container.tree ? visit(container.tree, container.name) : undefined;
    if (container.parent && base?.run) groupRuns.set(container.parent, base.run);
    let bounds = base?.rect;
    for (const node of context.ir.nodes) {
      if (!node.attach || node.parent !== container.parent) continue;
      const attached = byKey.get(node.key);
      if (!attached || !bounds) continue;
      const expanded = unionOf([bounds, attached.rect]) as Rect;
      const width = expanded.width - bounds.width;
      if (width > 0) attachments.push({ name: attached.name, width });
      bounds = expanded;
    }
  }
  const rootItems = [...byKey].flatMap(([key, item]) => {
    const ir = context.ir.elements.get(key);
    return ir && ir.kind !== "edge" && ir.parent === undefined ? [item] : [];
  });
  const root = unionOf(rootItems.map((item) => item.rect));
  const structured = context.ir.meta.engine === "structured";
  if (root)
    runs.push({
      name: `${structured ? "structured" : "auto"} horizontal footprint`,
      items: rootItems,
      rect: root,
      priority: 2,
    });
  // Stable path ordering resolves equal-width runs deterministically.
  const widest = runs.sort(
    (a, b) =>
      b.rect.width - a.rect.width || a.priority - b.priority || a.name.localeCompare(b.name),
  )[0];
  const pageWidth = printedSize(context.inspection).widthPt;
  const bySize = (a: Footprint, b: Footprint) =>
    b.rect.width - a.rect.width || a.name.localeCompare(b.name);
  const describeRun = (run: Run, limit: number) => {
    const { widths, gaps } = projection(run.items);
    const items = [...run.items].sort(bySize);
    return {
      text: `${run.name} = ${mm(run.rect.width)} (${mm(widths)} occupied x-projection + ${mm(gaps)} observed gaps)`,
      items: `${items
        .slice(0, limit)
        .map((item) => `${item.name} ${mm(item.rect.width)}`)
        .join(", ")}${items.length > limit ? `; ${items.length - limit} more` : ""}`,
      gaps,
    };
  };
  // The headline is what an agent acts on: the overflow, the run that sets the
  // width and the trial-verified edits. Everything else goes to `details` (#368).
  const head: string[] = [];
  const details: string[] = [];
  if (context.profile.maxWidthPt !== undefined)
    head.push(`Width to remove: ${formatMm(Math.max(0, pageWidth - context.profile.maxWidthPt))}.`);
  const contributing: Run[] = [];
  const seen = new Set<Run>();
  const descend = (run: Run) => {
    if (seen.has(run)) return;
    seen.add(run);
    contributing.push(run);
    // Stack siblings compete for width; only the widest child drives it.
    // Row/grid descendants are observations, not evidence of track dominance.
    // Only counterfactual layouts below can establish useful edits.
    const children = run.priority !== 0 ? [...run.items].sort(bySize).slice(0, 1) : run.items;
    for (const child of children) {
      const nested = child.run ?? (child.key ? groupRuns.get(child.key) : undefined);
      if (nested) descend(nested);
    }
  };
  if (widest) {
    descend(widest);
    const top = describeRun(widest, 3);
    head.push(`Sets the width: ${widest.name} = ${mm(widest.rect.width)}; items ${top.items}.`);
    details.push(`Widest horizontal run: ${top.text}. Items: ${describeRun(widest, 6).items}.`);
  }
  for (const run of contributing.slice(1, 6)) {
    const described = describeRun(run, 6);
    details.push(`Descendant run: ${described.text}. Items: ${described.items}.`);
  }
  if (contributing.length > 6) details.push(`${contributing.length - 6} more descendant runs.`);
  if (contributing.length > 1)
    details.push(
      "Descendant breakdowns explain the outer footprint; parent and child widths are not additive.",
    );
  if (attachments.length)
    details.push(
      `Attach expansion beyond arrange bounds: ${attachments
        .slice(0, 6)
        .map((item) => `${item.name} +${mm(item.width)}`)
        .join(
          ", ",
        )}${attachments.length > 6 ? `; ${attachments.length - 6} more` : ""} (incremental within each container; nested containers are not additive).`,
    );
  const labels = context.elements
    .flatMap((element) =>
      element.labels.flatMap((label) => {
        if (!label.box || label.label.text.length === 0) return [];
        // A label inside an explicitly sized body cannot shrink that body.
        // For overflow, only the overhang is potentially removable, not the
        // entire measured text width. Auto-sized bodies remain uncertain.
        const fixed = element.ir.kind === "node" && element.ir.width !== undefined;
        const width =
          fixed && element.bbox
            ? (unionOf([element.bbox, label.box]) as Rect).width - element.bbox.width
            : label.box.width;
        return width > 0 ? [{ element, width, measured: label.box.width }] : [];
      }),
    )
    .sort((a, b) => b.width - a.width || a.element.name.localeCompare(b.element.name));
  const longest = labels[0];
  if (longest)
    details.push(
      `Largest label overhang/auto-sized footprint: ${longest.element.name} ${mm(longest.width)} (${mm(longest.measured)} measured label width).`,
    );
  if (root) {
    const drawnWidthPt = unitsToPt(root.width * (context.inspection.scale ?? 1));
    details.push(
      `Top-level bodies/labels span ${mm(root.width)}; page width also includes margins, strokes and edge/label extents (${formatMm(Math.max(0, pageWidth - drawnWidthPt))} outside that span).`,
    );
  }
  // Set enclosures (#407) take no space in the arrange trees but widen the canvas.
  const setBoxes = context.sets.flatMap((set) => [
    set.geometry.bbox,
    ...set.labels.flatMap((label) => (label.box ? [label.box] : [])),
  ]);
  const setSpan = unionOf(setBoxes);
  if (
    setSpan &&
    root &&
    (setSpan.x < root.x - 1 || setSpan.x + setSpan.width > root.x + root.width + 1)
  ) {
    const text = `Set enclosures (outlines and labels) span ${mm(setSpan.width)} and reach beyond the arrange items; they are not part of the arrange trees.`;
    head.push(text);
    details.push(
      "Reduce a set's padding, move its label (labelAt), shorten the label, or leave more room inside the page by moving the members closer.",
    );
  }
  head.push(verifyHints(context, "width", (trial) => trial.canvas.width));
  if (!structured)
    details.push(
      "Auto reports observed geometry only; overlapping x-ranges are merged, and ELK layer spacing is not exposed.",
    );
  else
    details.push(
      "Grid spans and overlapping x-ranges are merged; observed gaps may include alignment/stretch, not just the written gap. Blank tracks cannot be attributed from painted geometry.",
    );
  return { hint: head.join(" "), details };
}
