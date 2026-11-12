import { getTheme } from "../../core/theme/builtin";
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
          const a = (i * 2 * Math.PI) / 96;
          return { x: region.cx + region.rx * Math.cos(a), y: region.cy + region.ry * Math.sin(a) };
        });
  return points.length ? [...points, points[0] as Point] : [];
}

export const strokeContrast = defineGeometryRule({
  id: "geometry/low-stroke-contrast",
  description: "A line or outline has low contrast against its painted backdrop.",
  defaultSeverity: "info",
  fixable: false,
  run(context) {
    const items = paintItems(context);
    const canvas = getTheme(context.ir.meta.themeId)?.canvas ?? "#ffffff";
    const findings: LintFinding[] = [];
    for (const element of context.elements) {
      const style = element.ir.style;
      if (!/^#[0-9a-f]{6}$/i.test(style.stroke) || style.strokeWidth.units <= 0) continue;
      const lines =
        element.kind === "edge"
          ? (element.drawn ?? [])
          : element.outline
            ? [boundary(element.outline)]
            : [];
      const own = items.findIndex((item) => item.key === element.key);
      const surfaces =
        element.kind === "edge"
          ? items
          : own >= 0
            ? items.slice(0, own)
            : items.filter(
                (item) =>
                  item.kind === "group" &&
                  JSON.stringify(item.docPath) !== JSON.stringify(element.docPath),
              );
      let bad = 0;
      let worst = 3;
      let background = canvas;
      for (const line of lines)
        for (let i = 1; i < line.length; i++) {
          const a = line[i - 1];
          const b = line[i];
          if (!a || !b) continue;
          const length = Math.hypot(b.x - a.x, b.y - a.y);
          const count = Math.max(1, Math.ceil(length / 4));
          for (let j = 0; j < count; j++) {
            const t = (j + 0.5) / count;
            const point = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
            const fill = surfaceAt(surfaces, point, canvas);
            if (
              element.kind !== "edge" &&
              /^#[0-9a-f]{6}$/i.test(style.fill) &&
              contrastRatio(over(style.fill, style.opacity, fill), fill) >= 1.2
            )
              continue;
            const ratio = contrastRatio(over(style.stroke, style.opacity, fill), fill);
            if (ratio < 3) {
              bad += length / count;
              if (ratio < worst) {
                worst = ratio;
                background = fill;
              }
            }
          }
        }
      if (bad < 10) continue;
      findings.push({
        message: `${element.name} has a stroke contrast of ${worst.toFixed(2)}:1 against background ${background} (minimum 3:1).`,
        path: element.docPath,
        subject: element.subject,
        severity: worst < 1.5 ? "warning" : "info",
        hint: "Change the stroke or its backdrop to increase contrast.",
      });
    }
    return findings;
  },
});
