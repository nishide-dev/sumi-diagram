/**
 * Lint-time counterfactuals for width / empty-area hints (#306, #307). The
 * trial budget, size limits, recursion guard and the profile / measurer
 * carry-over come from `HintTrials` (layout/hint-trials.ts), shared with the
 * grid hints. The only extra step is writing and inspecting the SVG of the
 * trial layout: page width and painted group frames are measured there, not
 * in the layout IR. Copies only; nothing is written to disk.
 */
import type { ArrangeBoxIR, FigureIR } from "../../compiler/ir";
import { SEPARATOR_ID } from "../../core/registry/builtins";
import { getFontSet } from "../../core/theme/fonts";
import { formatMm } from "../../core/units";
import { HintTrials, mapBoxes } from "../../layout/hint-trials";
import { unitsToPt } from "../../render/geometry";
import { inspectSvg } from "../../render/inspect";
import { writeStructuredSvg } from "../../render/structured";
import { createGeometryContext, type GeometryContext } from "./context";

interface Candidate {
  text: string;
  /** A copy of the figure with exactly one edit. */
  make: () => FigureIR;
  priority: number;
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
  const original = context.ir;
  if (original.meta.engine !== "structured")
    return "Observed geometry only; no trial layouts were run.";
  const trials = new HintTrials(original);
  if (!trials.eligible || context.html?.size || original.nodes.some((n) => n.image !== undefined))
    return "Layout trials skipped for figure size or external assets; the measurements describe the current figure.";
  const candidates: Candidate[] = [];
  for (const { box, path } of boxes(original)) {
    const edit = (patch: Partial<ArrangeBoxIR>) =>
      mapBoxes(original, (b, o) => (o === box ? { ...b, ...patch } : b));
    const field = box.kind === "grid" ? "columnGapPt" : "gapPt";
    if (mode === "width" && box.kind !== "stack" && box[field] !== 0)
      candidates.push({
        priority: 0,
        text: `set ${path}.${box.kind}.${box.kind === "grid" ? "columnGap" : "gap"} to 0mm`,
        make: () => edit({ [field]: 0 }),
      });
    if (mode === "empty") {
      for (const [key, value] of [
        ["align", "stretch"],
        ["justify", "stretch"],
        ["justify", "space-between"],
      ] as const) {
        if (box[key] === value) continue;
        candidates.push({
          priority: key === "align" ? 0 : 2,
          text: `set ${path}.${box.kind}.${key} to ${value}`,
          make: () => edit({ [key]: value }),
        });
      }
    }
  }
  for (const node of original.nodes) {
    // A separator is decoration whose size is not a layout choice.
    if (node.width === undefined || node.component === SEPARATOR_ID) continue;
    candidates.push({
      priority: 1,
      text: `remove the explicit width of node "${node.id}"`,
      make: () =>
        mapBoxes(
          {
            ...original,
            nodes: original.nodes.map((n) => {
              if (n !== node) return n;
              const { width: _width, ...rest } = n;
              return rest;
            }),
          },
          (b) => b,
        ),
    });
  }
  const fonts = getFontSet(original.meta.fontSetId);
  if (!fonts) return neutral;
  const verified: { text: string; reduction: number }[] = [];
  const baseline = score(context);
  for (const candidate of candidates.sort((a, b) => a.priority - b.priority)) {
    const ir = candidate.make();
    const result = trials.run(ir);
    if (!result) break;
    if (result.diagnostics.some((d) => d.severity === "error")) continue;
    try {
      const inspected = inspectSvg(writeStructuredSvg(ir, result.layout, fonts), ir);
      if (!inspected.ok) continue;
      const trial = createGeometryContext(ir, inspected.value, fonts);
      const after = score(trial);
      const reduction = baseline - after;
      if (reduction > 1e-6 && (mode === "width" || after === 0))
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
