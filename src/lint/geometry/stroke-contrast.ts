import { contrastRatio } from "../../core/theme/node-variants";
import type { Point } from "../../render/geometry";
import { defineGeometryRule, type LintFinding } from "../rule";
import { over, paintItems, surfaceAt } from "./composite";
import type { Region } from "./shapes";

function boundary(region: Region): Point[] {
  const points =
    region.kind === "polygon"
      ? [...region.points]
      : Array.from({ length: 96 }, (_, i) => {
          const angle = (i * 2 * Math.PI) / 96;
          return {
            x: region.cx + region.rx * Math.cos(angle),
            y: region.cy + region.ry * Math.sin(angle),
          };
        });
  return points.length ? [...points, points[0] as Point] : [];
}

/** Sample visible strokes against the painted surfaces beneath them. */
export const strokeContrast = defineGeometryRule({
  id: "geometry/low-stroke-contrast",
  description: "A substantial part of a stroke has less than 3:1 contrast against its background.",
  defaultSeverity: "warning",
  fixable: false,
  run(context) {
    const items = paintItems(context);
    const findings: LintFinding[] = [];
    for (const edge of context.elements) {
      if (
        (edge.kind !== "edge" && edge.kind !== "node") ||
        !/^#[0-9a-f]{6}$/i.test(edge.ir.style.stroke) ||
        edge.ir.style.strokeWidth.units <= 0
      )
        continue;
      let badLength = 0;
      let worst = 3;
      let background = "";
      const lines =
        edge.kind === "edge" ? (edge.drawn ?? []) : edge.outline ? [boundary(edge.outline)] : [];
      const surfaces = items.filter((item) => item.kind !== "node");
      for (const line of lines) {
        for (let i = 1; i < line.length; i++) {
          const a = line[i - 1];
          const b = line[i];
          if (!a || !b) continue;
          const length = Math.hypot(b.x - a.x, b.y - a.y);
          const count = Math.max(1, Math.ceil(length / 4));
          for (let j = 0; j < count; j++) {
            const t = (j + 0.5) / count;
            const point = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
            const fill = surfaceAt(surfaces, point);
            // A distinguishable fill already reveals a node's silhouette; its
            // decorative frame does not need to provide the outline on its own.
            if (
              edge.ir.kind === "node" &&
              edge.ir.variant !== "outlined" &&
              /^#[0-9a-f]{6}$/i.test(edge.ir.style.fill)
            ) {
              const nodeFill = over(edge.ir.style.fill, edge.ir.style.opacity, fill);
              if (contrastRatio(nodeFill, fill) >= 1.3) continue;
            }
            const stroke = over(edge.ir.style.stroke, edge.ir.style.opacity, fill);
            const ratio = contrastRatio(stroke, fill);
            if (ratio < 3) {
              badLength += length / count;
              if (ratio < worst) {
                worst = ratio;
                background = fill;
              }
            }
          }
        }
      }
      if (badLength < 10) continue;
      findings.push({
        message: `${edge.name} has a stroke contrast of ${worst.toFixed(2)}:1 against background ${background} (minimum 3:1).`,
        path: edge.docPath,
        subject: edge.subject,
        hint: "Use a lighter panel or change the stroke color.",
      });
    }
    return findings;
  },
});
