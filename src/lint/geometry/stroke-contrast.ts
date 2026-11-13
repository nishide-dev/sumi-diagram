import { getTheme } from "../../core/theme/builtin";
import { contrastRatio } from "../../core/theme/node-variants";
import type { Point } from "../../render/geometry";
import { defineGeometryRule, type LintFinding } from "../rule";
import { covers, normalized, over, paintItemsOf, surfaceAt } from "./composite";
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
    const items = paintItemsOf(context);
    const order = new Map(context.elements.map((element, index) => [element.key, index]));
    const canvas = getTheme(context.ir.meta.themeId)?.canvas ?? "#ffffff";
    const findings: LintFinding[] = [];
    // Dimming (#175) makes an element pale on purpose.
    const dimmed = new Set(context.ir.dimmed ?? []);
    for (const element of context.elements) {
      // Group frames are structure styled by the theme, and an operator or junction is read
      // by its symbol: neither is a line the figure depends on (#463).
      // A filled dashed group (#519) is the exception: its frame is the only border of its fill.
      if (
        (element.kind === "group" && element.ir.variant !== "filled-dashed") ||
        dimmed.has(element.key)
      )
        continue;
      // A zoom callout's guide lines are pale on purpose.
      if (
        element.ir.component === "sumi/operator" ||
        element.ir.component === "sumi/junction" ||
        element.ir.component === "sumi/zoom"
      )
        continue;
      const style = element.ir.style;
      const stroke = normalized(style.stroke);
      if (stroke === undefined || style.strokeWidth.units <= 0) continue;
      const lines =
        element.kind === "edge"
          ? (element.drawn ?? [])
          : element.outline
            ? [boundary(element.outline)]
            : [];
      const points = lines.flat();
      if (points.length === 0) continue;
      const xs = points.map((point) => point.x);
      const ys = points.map((point) => point.y);
      const left = Math.min(...xs),
        right = Math.max(...xs);
      const top = Math.min(...ys),
        bottom = Math.max(...ys);
      const surfaces = items.filter(
        (item) =>
          (element.kind === "edge" ||
            item.kind !== "node" ||
            (order.get(item.key as typeof element.key) ?? Infinity) <
              (order.get(element.key) ?? -1)) &&
          item.bbox.x <= right + 1e-6 &&
          item.bbox.x + item.bbox.width >= left - 1e-6 &&
          item.bbox.y <= bottom + 1e-6 &&
          item.bbox.y + item.bbox.height >= top - 1e-6,
      );
      // Opaque nodes painted after this node's frame hide it where they cover it.
      const occluders =
        element.kind === "edge"
          ? []
          : items.filter(
              (item) =>
                item.kind === "node" &&
                item.alpha >= 1 &&
                (order.get(item.key as typeof element.key) ?? -Infinity) >
                  (order.get(element.key) ?? Infinity),
            );
      // A node with a fill of its own is drawn by that fill; its frame is decoration.
      // Only an outline-only node (its fill matches what lies behind its centre) is checked.
      if (element.kind !== "edge") {
        const region = element.outline;
        const centre =
          region === undefined
            ? undefined
            : region.kind === "polygon"
              ? {
                  x: region.points.reduce((s, p) => s + p.x, 0) / Math.max(1, region.points.length),
                  y: region.points.reduce((s, p) => s + p.y, 0) / Math.max(1, region.points.length),
                }
              : { x: region.cx, y: region.cy };
        const fill = normalized(style.fill);
        // A dashed frame (#519) is the border of a filled shape: a fill does not carry it.
        if (centre !== undefined && fill !== undefined && !(Number(style.strokeDash) > 0)) {
          const behind = surfaceAt(surfaces, centre, canvas);
          if (contrastRatio(over(fill, style.opacity, behind), behind) >= 1.2) continue;
        }
      }
      // Lines carry the figure's relations: 3:1 (WCAG non-text contrast). An outline around
      // content that still reads is held to 2:1, which a theme's quiet frames clear.
      const minimum = element.kind === "edge" ? 3 : 2;
      let bad = 0;
      let severe = 0;
      let worst = minimum;
      let background = canvas;
      for (const line of lines)
        for (let i = 1; i < line.length; i++) {
          const a = line[i - 1];
          const b = line[i];
          if (!a || !b) continue;
          const length = Math.hypot(b.x - a.x, b.y - a.y);
          const count = Math.max(1, Math.ceil(length / 4));
          const segmentSurfaces = surfaces.filter(
            (item) =>
              item.bbox.x <= Math.max(a.x, b.x) + 1e-6 &&
              item.bbox.x + item.bbox.width >= Math.min(a.x, b.x) - 1e-6 &&
              item.bbox.y <= Math.max(a.y, b.y) + 1e-6 &&
              item.bbox.y + item.bbox.height >= Math.min(a.y, b.y) - 1e-6,
          );
          for (let j = 0; j < count; j++) {
            const t = (j + 0.5) / count;
            const point = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
            if (occluders.some((item) => covers(item, point))) continue;
            const fill = surfaceAt(segmentSurfaces, point, canvas);
            const ratio = contrastRatio(over(stroke, style.opacity, fill), fill);
            if (ratio < 1.5) severe += length / count;
            if (ratio < minimum) {
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
        message: `${element.name} has a stroke contrast of ${worst.toFixed(2)}:1 against background ${background} (minimum ${minimum}:1).`,
        path: element.docPath,
        subject: element.subject,
        // An edge that nearly disappears loses information; a faint outline around content
        // that still reads is a style, so it stays informational.
        severity: element.kind === "edge" && severe >= 10 ? "warning" : "info",
        hint: "Change the stroke or its backdrop to increase contrast.",
      });
    }
    return findings;
  },
});
