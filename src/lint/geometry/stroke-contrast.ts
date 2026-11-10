import { contrastRatio } from "../../core/theme/node-variants";
import { defineGeometryRule, type LintFinding } from "../rule";
import { over, paintItems } from "./composite";
import { depthInside } from "./shapes";

/** Sample painted edge routes against the group fills beneath them. */
export const strokeContrast = defineGeometryRule({
  id: "geometry/low-stroke-contrast",
  description: "A substantial part of an edge has less than 3:1 contrast against its panel.",
  defaultSeverity: "warning",
  fixable: false,
  run(context) {
    const panels = paintItems(context).filter((item) => item.kind === "group");
    const findings: LintFinding[] = [];
    for (const edge of context.elements) {
      if (
        edge.kind !== "edge" ||
        !/^#[0-9a-f]{6}$/i.test(edge.ir.style.stroke) ||
        edge.ir.style.strokeWidth.units <= 0
      )
        continue;
      let badLength = 0;
      let worst = 3;
      let background = "";
      for (const line of edge.drawn ?? []) {
        for (let i = 1; i < line.length; i++) {
          const a = line[i - 1];
          const b = line[i];
          if (!a || !b) continue;
          const length = Math.hypot(b.x - a.x, b.y - a.y);
          const count = Math.max(1, Math.ceil(length / 4));
          for (let j = 0; j < count; j++) {
            const t = (j + 0.5) / count;
            const point = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
            const under = panels.filter((panel) => depthInside(panel.region, point) > 0);
            if (under.length === 0) continue;
            const fill = under.reduce(
              (color, panel) => over(panel.color, panel.alpha, color),
              "#ffffff",
            );
            // Near-white panels do not meaningfully change stroke contrast from the page.
            if (contrastRatio(fill, "#ffffff") < 1.2) continue;
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
        message: `${edge.name} has a stroke contrast of ${worst.toFixed(2)}:1 against panel fill ${background} (minimum 3:1).`,
        path: edge.docPath,
        subject: edge.subject,
        hint: "Use a lighter panel or override the tone's line color.",
      });
    }
    return findings;
  },
});
