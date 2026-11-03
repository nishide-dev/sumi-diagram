/**
 * Lint-time counterfactuals for width / empty-area hints (#306, #307). The
 * trial budget, size limits, recursion guard and the profile / measurer
 * carry-over come from `HintTrials` (layout/hint-trials.ts), shared with the
 * grid hints. The only extra step is writing and inspecting the SVG of the
 * trial layout: page width and painted group frames are measured there, not
 * in the layout IR. Copies only; nothing is written to disk.
 */
import type { ArrangeBoxIR, FigureIR, NodeIR } from "../../compiler/ir";
import { getProfile } from "../../core/profile/builtin";
import { spacedProfile } from "../../core/profile/schema";
import { SEPARATOR_ID } from "../../core/registry/builtins";
import { getFontSet } from "../../core/theme/fonts";
import { formatMm } from "../../core/units";
import { HintTrials, MAX_HINT_TRIALS, mapBoxes } from "../../layout/hint-trials";
import { unitsToPt } from "../../render/geometry";
import { inspectSvg } from "../../render/inspect";
import { writeStructuredSvg } from "../../render/structured";
import { createGeometryContext, type GeometryContext } from "./context";

interface Candidate {
  text: string;
  /** A copy of the figure with exactly one edit. */
  make: () => FigureIR;
  priority: number;
  /** Expected own contribution to the page width in pt (width mode); orders the budgeted trials. */
  impact: number;
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
        impact: (box[field] ?? 0) * Math.max(0, (box.columns ?? box.items.length) - 1),
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
          impact: 0,
          text: `set ${path}.${box.kind}.${key} to ${value}`,
          make: () => edit({ [key]: value }),
        });
      }
    }
  }
  const base = getProfile(original.meta.profileId);
  const padX = base ? spacedProfile(base, original.meta.density).layout.nodePaddingX.pt : 0;
  const withNodes = (replace: (n: NodeIR) => NodeIR) =>
    mapBoxes({ ...original, nodes: original.nodes.map(replace) }, (b) => b);
  for (const node of original.nodes) {
    // A separator is decoration whose size is not a layout choice.
    if (node.width === undefined || node.component === SEPARATOR_ID) continue;
    // Excess over the measured label: what removing the explicit width could free.
    const label = context.get(node.key)?.labels[0]?.box?.width ?? 0;
    const natural = unitsToPt(label) + padX * 2;
    candidates.push({
      priority: 1,
      impact: Math.max(0, node.width.pt - natural),
      text: `remove the explicit width of node "${node.id}"`,
      make: () =>
        withNodes((n) => {
          if (n !== node) return n;
          const { width: _width, ...rest } = n;
          return rest;
        }),
    });
  }
  if (mode === "width") {
    const attached = original.nodes.filter((n) => n.attach !== undefined && n.attach.gapPt > 0);
    const zero = (targets: readonly NodeIR[]) =>
      withNodes((n) =>
        targets.includes(n) && n.attach ? { ...n, attach: { ...n.attach, gapPt: 0 } } : n,
      );
    if (attached.length > 1)
      candidates.push({
        priority: 0,
        impact: attached.reduce((sum, n) => sum + (n.attach?.gapPt ?? 0), 0),
        text: `set attach.gap of all ${attached.length} attached nodes to 0mm`,
        make: () => zero(attached),
      });
    for (const node of attached)
      candidates.push({
        priority: 0,
        impact: node.attach?.gapPt ?? 0,
        text: `set attach.gap of node "${node.id}" to 0mm`,
        make: () => zero([node]),
      });
  }
  const fonts = getFontSet(original.meta.fontSetId);
  if (!fonts) return neutral;
  const verified: { text: string; reduction: number }[] = [];
  const baseline = score(context);
  const ordered = candidates.sort(
    (a, b) => b.impact - a.impact || a.priority - b.priority || a.text.localeCompare(b.text),
  );
  for (const candidate of ordered) {
    // Budget exhaustion ends the search; one failed trial does not.
    if (trials.count >= MAX_HINT_TRIALS) break;
    const ir = candidate.make();
    let result: ReturnType<HintTrials["run"]>;
    try {
      result = trials.run(ir);
    } catch {
      continue;
    }
    if (!result) continue;
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
