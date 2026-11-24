/**
 * Side-by-side panels (#641, design record `docs/design/decisions/641-panel-rows.md`):
 * which items of a row are panels, shared by the layout engine (`row.panels`) and
 * the geometry lint (`geometry/panel-misaligned`).
 */

import type { ArrangeBoxIR, ArrangeItemIR, FigureIR, GroupIR } from "../../compiler/ir";
import type { ElementKey } from "../../core/check-state";
import type { DocPath } from "../../core/diagnostics";

/**
 * The group a direct item of a row is a panel for: a group, or the group of a
 * captioned group's stack (#130); `undefined` for nodes, other boxes and groups
 * drawn whole (a tilted plane, tokens, a matrix, a legend).
 */
export function panelGroupOf(
  item: ArrangeItemIR,
  groupOf: (key: ElementKey) => GroupIR | undefined,
): GroupIR | undefined {
  const key =
    typeof item === "string"
      ? item
      : item?.growFirst === true && typeof item.items[0] === "string"
        ? item.items[0]
        : undefined;
  const group = key === undefined ? undefined : groupOf(key);
  if (group === undefined) return undefined;
  if (group.plane !== undefined || group.tokens !== undefined) return undefined;
  if (group.matrix !== undefined || group.legend !== undefined) return undefined;
  return group;
}

/** A row of a figure's arrange trees, where it is written and its panels in order. */
export interface PanelRow {
  readonly box: ArrangeBoxIR;
  /** The row box's path (`[..., "row"]`), e.g. `figure.layout.arrange.row`. */
  readonly path: DocPath;
  readonly panels: readonly GroupIR[];
}

/**
 * Every row of the figure's arrange trees (the root's, then each group's in
 * document order) with its panels. `groupPath` gives a group's document path
 * (`["groups", i]`); the rows of a group without one are left out. The path of a box inside a grid cell written as `{item: ...}` is
 * known only when the cell has a span or an align.
 */
export function panelRows(
  ir: FigureIR,
  groupPath: (group: GroupIR) => DocPath | undefined,
): PanelRow[] {
  const groups = new Map(ir.groups.map((g) => [g.key, g]));
  const out: PanelRow[] = [];
  const walk = (box: ArrangeBoxIR, path: DocPath): void => {
    if (box.kind === "row") {
      const panels = box.items.flatMap((item) => panelGroupOf(item, (k) => groups.get(k)) ?? []);
      out.push({ box, path: [...path, "row"], panels });
    }
    for (const [index, item] of box.items.entries()) {
      if (item === null || typeof item === "string" || item.growFirst === true) continue;
      const wrapped =
        box.kind === "place" ||
        (box.kind === "grid" &&
          ((box.spans?.[index] ?? 1) !== 1 || box.cellAligns?.[index] !== undefined));
      walk(item, [...path, box.kind, "items", index, ...(wrapped ? ["item"] : [])]);
    }
  };
  if (ir.arrange !== undefined) walk(ir.arrange, ["figure", "layout", "arrange"]);
  for (const group of ir.groups) {
    const at = groupPath(group);
    if (group.arrange !== undefined && at !== undefined) walk(group.arrange, [...at, "arrange"]);
  }
  return out;
}
