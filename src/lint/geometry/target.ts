/** Read-only placement budgets and printed diagram stroke checks (#347). */
import type { DocPath } from "../../core/diagnostics";
import { formatMm, formatPt, ptToMm } from "../../core/units";
import { unitsToPt } from "../../render/geometry";
import { printedSize } from "../../render/size";
import { defineGeometryRule } from "../rule";
import type { GeometryContext } from "./context";
import { unionOf } from "./measure";

const EPSILON = 1e-6;
const subject = (context: GeometryContext) => ({ kind: "figure", id: context.ir.meta.id }) as const;

/** Top-level vertical projections: overlaps are merged, never double counted. */
export function heightBreakdown(context: GeometryContext): string {
  const scale = context.inspection.scale ?? 1;
  const mm = (units: number) => formatMm(unitsToPt(units) * scale);
  const items = context.elements
    .flatMap((element) => {
      if (element.ir.kind === "edge" || element.ir.parent !== undefined) return [];
      const rect = unionOf([
        ...(element.bbox ? [element.bbox] : []),
        ...element.labels.flatMap((l) => (l.box ? [l.box] : [])),
        ...(element.badge ? [element.badge] : []),
      ]);
      return rect ? [{ name: element.name, rect }] : [];
    })
    .sort((a, b) => a.rect.y - b.rect.y || a.name.localeCompare(b.name));
  let end = items[0]?.rect.y ?? 0;
  let occupied = 0;
  let gaps = 0;
  for (const { rect } of items) {
    gaps += Math.max(0, rect.y - end);
    occupied += Math.max(0, rect.y + rect.height - Math.max(end, rect.y));
    end = Math.max(end, rect.y + rect.height);
  }
  const outer = Math.max(0, context.canvas.height - occupied - gaps);
  const names = [...items]
    .sort((a, b) => b.rect.height - a.rect.height || a.name.localeCompare(b.name))
    .slice(0, 3)
    .map(
      ({ name, rect }) => `${name}: ${mm(rect.height)} tall at y=${mm(rect.y - context.canvas.y)}`,
    );
  return `Height breakdown (printed vertical projection): top-level bodies/labels ${mm(occupied)}, gaps ${mm(gaps)}, margins and other overhang ${mm(outer)}.${names.length ? ` Largest: ${names.join("; ")}.` : ""}`;
}

export const exceedsTargetHeight = defineGeometryRule({
  id: "geometry/exceeds-target-height",
  description:
    "The printed height, including margins, exceeds figure.target.height (a budget, not a hard page limit).",
  defaultSeverity: "warning",
  fixable: false,
  run(context) {
    const budget = context.ir.meta.target?.height;
    const height = printedSize(context.inspection).heightPt;
    if (budget === undefined || height <= budget + EPSILON) return [];
    return [
      {
        message: `The figure is ${formatMm(height)} tall, exceeding the ${formatMm(budget)} target height budget (${Math.round((height / budget) * 1000) / 10}% of budget).`,
        path: ["figure", "target", "height"],
        subject: subject(context),
        hint: `${heightBreakdown(context)} Compare another arrangement or a different height budget; height never triggers automatic scaling.`,
      },
    ];
  },
});

export const placementUsage = defineGeometryRule({
  id: "geometry/placement-usage",
  description:
    "With figure.target, reports reserved profile-width × printed-height area and width utilization.",
  defaultSeverity: "info",
  fixable: false,
  run(context) {
    if (context.ir.meta.target === undefined) return [];
    const { widthPt, heightPt } = printedSize(context.inspection);
    const width = context.profile.maxWidthPt;
    if (width === undefined) return [];
    const budget = context.ir.meta.target.height;
    return [
      {
        message: `Placement reserves ${formatMm(width)} × ${formatMm(heightPt)} = ${Math.round(ptToMm(width) * ptToMm(heightPt))}mm² (profile width × printed height, margins included). Width use: ${formatMm(widthPt)} / ${formatMm(width)} = ${Math.round((widthPt / width) * 1000) / 10}%.${budget !== undefined ? ` Height budget use: ${Math.round((heightPt / budget) * 1000) / 10}% of ${formatMm(budget)}.` : ""}`,
        path: ["figure", "target"],
        subject: subject(context),
        hint: "Compare candidates at the same placement width and minimum final text size; reserved area is not an aspect-ratio quality score.",
      },
    ];
  },
});

export const lineTooThin = defineGeometryRule({
  id: "geometry/line-too-thin",
  description:
    "A visible diagram border or wire prints below figure.target.minLineWidth; image content is excluded.",
  defaultSeverity: "warning",
  fixable: false,
  run(context) {
    const min = context.ir.meta.target?.minLineWidth;
    if (min === undefined) return [];
    const scale = context.inspection.scale ?? 1;
    return context.inspection.elements.flatMap((geometry) => {
      const ir = context.ir.elements.get(geometry.key);
      if (!ir || (!geometry.bbox && !geometry.path)) return [];
      // These renderer branches paint no outline, regardless of the IR stroke style.
      if (
        ir.kind === "node" &&
        (ir.image !== undefined ||
          ir.mark?.type === "point" ||
          ir.tokens?.separator !== undefined ||
          ir.shape === "text")
      )
        return [];
      const style = ir.style;
      const pt = style.strokeWidth.pt * scale;
      if (style.stroke === "transparent" || style.opacity === 0 || pt <= 0 || pt >= min - EPSILON)
        return [];
      const path: DocPath = [...(context.ir.sourceMap.get(ir.key)?.path ?? ["figure"])];
      return [
        {
          message: `The ${ir.kind} ${JSON.stringify(ir.kind === "edge" ? (ir.id ?? `edges[${ir.index}]`) : ir.id)} line prints at ${formatPt(pt)}, below figure.target.minLineWidth ${formatPt(min)} (${Math.round(scale * 1000) / 10}% scale).`,
          path,
          subject: {
            kind: ir.kind,
            id: ir.kind === "edge" ? (ir.id ?? `edges[${ir.index}]`) : ir.id,
          },
          hint: "Use a theme with thicker strokes, reduce width-driven scaling, or choose a wider placement. Imported image/icon/HTML strokes are not measured.",
        },
      ];
    });
  },
});
