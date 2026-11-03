import type { ArrangeBoxIR, FigureIR } from "../../compiler/ir";
import type { ElementKey } from "../../core/check-state";
import type { Diagnostic } from "../../core/diagnostics";
import { HintTrials, mapBoxes } from "../hint-trials";
import { UNVERIFIED_ALIGN_TAIL } from "./align";

const pathKey = (path: readonly (string | number)[] | undefined) => path?.join(".");

/**
 * Recommend a wrapper for a grid-cell `layout/unsatisfied-align` only when a
 * trial layout of that edit removes the diagnostic (single cells, all cells,
 * then the whole grid). Never changes the placement itself.
 */
export function verifiedAlignHints(ir: FigureIR, diagnostics: readonly Diagnostic[]) {
  const known = new Set(diagnostics.map((d) => `${d.code}|${pathKey(d.path)}`));
  return diagnostics.map((d) => {
    if (d.code !== "layout/unsatisfied-align" || !d.hint?.endsWith(UNVERIFIED_ALIGN_TAIL)) return d;
    const c = ir.align?.find((a) => pathKey(a.srcAt.path) === pathKey(d.path));
    if (!c) return d;
    const grids: ArrangeBoxIR[] = [];
    const cells: ElementKey[] = [];
    const visit = (box: ArrangeBoxIR) => {
      if (box.kind === "grid")
        for (const item of box.items)
          if (typeof item === "string" && c.items.includes(item)) {
            cells.push(item);
            if (!grids.includes(box)) grids.push(box);
          }
      for (const item of box.items) if (item !== null && typeof item !== "string") visit(item);
    };
    if (ir.arrange) visit(ir.arrange);
    for (const g of ir.groups) if (g.arrange) visit(g.arrange);
    const trials = new HintTrials(ir);
    if (cells.length === 0 || !trials.eligible) return d;
    const wrapper = (items: ArrangeBoxIR["items"]): ArrangeBoxIR =>
      c.axis === "y"
        ? { kind: "stack", direction: "down", items }
        : { kind: "row", direction: "right", items };
    const word = c.axis === "y" ? "stack" : "row";
    const wrapCells = (keys: readonly ElementKey[]) =>
      mapBoxes(ir, (b) =>
        b.kind === "grid" && b.items.some((i) => typeof i === "string" && keys.includes(i))
          ? {
              ...b,
              items: b.items.map((i) =>
                typeof i === "string" && keys.includes(i) ? wrapper([i]) : i,
              ),
            }
          : b,
      );
    const label = (keys: readonly ElementKey[]) =>
      keys
        .map((k) => {
          const e = ir.elements.get(k);
          return `"${e && e.kind !== "edge" ? e.id : k}"`;
        })
        .join(" and ");
    const options: { text: string; ir: FigureIR }[] = [
      ...cells.map((k) => ({ text: `wrap ${label([k])} in a ${word}`, ir: wrapCells([k]) })),
      ...(cells.length > 1
        ? [{ text: `wrap each of ${label(cells)} in its own ${word}`, ir: wrapCells(cells) }]
        : []),
      ...grids.map((g) => ({
        text: `wrap the grid holding ${label(cells.filter((k) => g.items.includes(k)))} in a ${word}`,
        ir: mapBoxes(ir, (b, original) => (original === g ? wrapper([b]) : b)),
      })),
    ];
    for (const option of options) {
      const result = trials.run(option.ir, false);
      if (!result) return d;
      if (result.diagnostics.some((n) => n.code === d.code && pathKey(n.path) === pathKey(d.path)))
        continue;
      const added = [
        ...new Set(
          result.diagnostics
            .filter((n) => n.severity !== "info" && !known.has(`${n.code}|${pathKey(n.path)}`))
            .map((n) => n.code),
        ),
      ];
      const tail = `Verified by structured layout: ${option.text}; this removes this diagnostic. Re-run lint after applying${added.length > 0 ? `: the trial also produced ${added.join(", ")}` : ", as other diagnostics can change"}.`;
      return { ...d, hint: `${d.hint.slice(0, -UNVERIFIED_ALIGN_TAIL.length)}${tail}` };
    }
    return d;
  });
}
