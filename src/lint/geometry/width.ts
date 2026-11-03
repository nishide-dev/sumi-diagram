/** Read-only width attribution from the same geometry that triggered the page limit. */
import type { ArrangeBoxIR, ArrangeItemIR } from "../../compiler/ir";
import type { ElementKey } from "../../core/check-state";
import { formatMm } from "../../core/units";
import { type Rect, unitsToPt } from "../../render/geometry";
import { printedSize } from "../../render/size";
import type { GeometryContext, GeometryElement } from "./context";
import { unionOf } from "./measure";

interface Footprint {
  name: string;
  rect: Rect;
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

export function widthBreakdown(context: GeometryContext): string {
  const mm = (units: number) => formatMm(unitsToPt(units * (context.inspection.scale ?? 1)));
  const byKey = new Map<ElementKey, Footprint>();
  for (const element of context.elements) {
    if (element.kind === "edge") continue;
    const rect = footprint(element);
    if (rect) byKey.set(element.key, { name: element.name, rect });
  }
  if (byKey.size === 0) return "";
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
    if (item.kind !== "stack") runs.push({ name, items, rect });
    return { name, rect };
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
  for (const container of containers) {
    const base = container.tree ? visit(container.tree, container.name) : undefined;
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
  if (!structured && root)
    runs.push({ name: "auto horizontal footprint", items: rootItems, rect: root });
  if (structured && runs.length === 0 && root)
    runs.push({ name: "structured horizontal footprint", items: rootItems, rect: root });
  // Stable path ordering resolves equal-width runs deterministically.
  const widest = runs.sort(
    (a, b) => b.rect.width - a.rect.width || a.name.localeCompare(b.name),
  )[0];
  const parts: string[] = [];
  const pageWidth = printedSize(context.inspection).widthPt;
  if (context.profile.maxWidthPt !== undefined)
    parts.push(
      `Width to remove: ${formatMm(Math.max(0, pageWidth - context.profile.maxWidthPt))}.`,
    );
  const candidates: { width: number; text: string }[] = [];
  if (widest) {
    const { widths, gaps, largestGap } = projection(widest.items);
    const items = [...widest.items].sort(
      (a, b) => b.rect.width - a.rect.width || a.name.localeCompare(b.name),
    );
    parts.push(
      `Widest horizontal run: ${widest.name} = ${mm(widest.rect.width)} (${mm(widths)} occupied x-projection + ${mm(gaps)} observed gaps). Items: ${items
        .slice(0, 6)
        .map((item) => `${item.name} ${mm(item.rect.width)}`)
        .join(", ")}${items.length > 6 ? `; ${items.length - 6} more` : ""}.`,
    );
    if (largestGap > 0)
      candidates.push({
        width: largestGap,
        text: `reduce the largest observed gap (${mm(largestGap)}) in ${widest.name}`,
      });
  }
  for (const attachment of attachments) {
    candidates.push({
      width: attachment.width,
      text: `move or shorten attach ${attachment.name} (horizontal overhang ${mm(attachment.width)})`,
    });
  }
  if (attachments.length)
    parts.push(
      `Attach expansion beyond arrange bounds: ${attachments.map((item) => `${item.name} +${mm(item.width)}`).join(", ")} (incremental within each container; nested containers are not additive).`,
    );
  const labels = context.elements
    .flatMap((element) =>
      element.labels.flatMap((label) =>
        label.box && label.label.text.length > 0 ? [{ element, width: label.box.width }] : [],
      ),
    )
    .sort((a, b) => b.width - a.width || a.element.name.localeCompare(b.element.name));
  const longest = labels[0];
  if (longest)
    candidates.push({
      width: longest.width,
      text: `shorten or wrap the label of ${longest.element.name} (${mm(longest.width)} measured; fixed widths may still dominate)`,
    });
  if (root) {
    const drawnWidthPt = unitsToPt(root.width * (context.inspection.scale ?? 1));
    parts.push(
      `Top-level bodies/labels span ${mm(root.width)}; page width also includes margins, strokes and edge/label extents (${formatMm(Math.max(0, pageWidth - drawnWidthPt))} outside that span).`,
    );
  }
  if (candidates.length)
    parts.push(
      `Largest measured candidates (not guaranteed savings): ${candidates
        .sort((a, b) => b.width - a.width || a.text.localeCompare(b.text))
        .slice(0, 3)
        .map((item) => item.text)
        .join("; ")}.`,
    );
  if (!structured)
    parts.push(
      "Auto reports observed geometry only; overlapping x-ranges are merged, and ELK layer spacing is not exposed.",
    );
  else
    parts.push(
      "Grid spans and overlapping x-ranges are merged; observed gaps may include alignment/stretch, not just the written gap. Blank tracks cannot be attributed from painted geometry.",
    );
  return parts.join(" ");
}
