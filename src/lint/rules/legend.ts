/** Rules on legends (#131, design doc §6.34). */

import type { ResolvedComponent } from "../../core/registry/manifest";
import { defineRule, type LintFinding, type ValidElement } from "../rule";

/** The fields an entry's sample shares with what it explains, for messages. */
function describeFields(component: ResolvedComponent, tone: string | undefined): string {
  const fields = [component.id, `variant "${component.variant}"`];
  if (tone !== undefined) fields.push(`tone "${tone}"`);
  return fields.join(", ");
}

export const unusedLegendEntry = defineRule({
  id: "lint/unused-legend-entry",
  description:
    "A legend entry explains a line or box style that no edge or node of the figure uses.",
  defaultSeverity: "warning",
  fixable: false,
  run(context) {
    const { legends } = context.state.doc;
    if (legends === undefined) return [];
    // What the author drew: the elements that are not parts of a legend or
    // captions (the cells of tokens nodes, #181, are the author's nodes).
    const written = context.elements.filter(
      (e) => e.origin === undefined || e.origin.from === "tokens",
    );
    const toneOf = (e: ValidElement) => e.element.tone;
    const findings: LintFinding[] = [];
    for (const legend of legends) {
      for (const [j, entry] of legend.entries.entries()) {
        const sample = context.elements.find((e) => e.key === entry.sample);
        const component = sample?.component;
        if (sample === undefined || component === undefined) continue;
        const tone = toneOf(sample);
        const used = written.some(
          (e) =>
            e.kind === entry.kind &&
            e.component?.id === component.id &&
            e.component.variant === component.variant &&
            toneOf(e) === tone,
        );
        if (used) continue;
        const what = entry.kind === "edge" ? "edge" : "node";
        findings.push({
          message: `Entry ${j + 1} of legend "${legend.id}" ("${entry.label}") explains no ${what}: no ${what} of the figure has ${describeFields(component, tone)}.`,
          path: entry.path,
          subject: { kind: "node", id: legend.id },
          hint: `Remove the entry, or give its ${what} fields the component, variant and tone of the ${what}s it explains.`,
        });
      }
    }
    return findings;
  },
});
