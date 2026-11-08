/** Rules on legends (#131, design doc §6.34) and the classes of matrices (#180, §6.56). */

import type { ResolvedComponent } from "../../core/registry/manifest";
import { defineRule, type LintFinding, type ValidElement } from "../rule";

/** The fields an entry's sample shares with what it explains, for messages. */
function describeFields(component: ResolvedComponent, tone: string | undefined): string {
  const fields = [component.id, `variant "${component.variant}"`];
  if (tone !== undefined) fields.push(`tone "${tone}"`);
  return fields.join(", ");
}

/** What a glyph sample has to share with the glyphs it explains: kind, strength and tones. */
function glyphSignature(glyph: {
  kind: string;
  strength?: string | undefined;
  tone?: string | undefined;
  tones?: readonly string[] | undefined;
}): string {
  // The tones in order without repeats: a vector of three blue cells has tone blue.
  const tones = [...new Set(glyph.tones ?? [glyph.tone ?? "none"])];
  return [glyph.kind, glyph.strength ?? "soft", ...tones].join(" ");
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
    // captions (the cells of tokens nodes, #181, and of matrices, #180, are
    // the author's nodes).
    const written = context.elements.filter(
      (e) => e.origin === undefined || e.origin.from === "tokens" || e.origin.from === "matrix",
    );
    const toneOf = (e: ValidElement) => e.element.tone;
    const findings: LintFinding[] = [];
    // The sets the author wrote (the swatches of legends are not).
    const swatches = new Set(legends.flatMap((l) => l.entries.map((e) => e.set?.id)));
    const writtenSets = (context.state.doc.sets ?? []).filter(
      (set) => set !== undefined && !swatches.has(set.id),
    );
    const writtenNodes = written.flatMap((e) => (e.kind === "node" ? [e.element] : []));
    const report = (
      legend: (typeof legends)[number],
      j: number,
      entry: (typeof legends)[number]["entries"][number],
      message: string,
      hint: string,
    ) =>
      findings.push({
        message: `Entry ${j + 1} of legend "${legend.id}" ("${entry.label}") ${message}`,
        path: entry.path,
        subject: { kind: "node", id: legend.id },
        hint,
      });
    for (const legend of legends) {
      for (const [j, entry] of legend.entries.entries()) {
        // A matrix class (#180) explains its cells: lint/unused-matrix-class
        // reports a class without cells.
        if (entry.class !== undefined) continue;
        if (entry.kind === "icon") {
          // An icon (#409) is explained by a node that draws it, as its icon or a badge.
          const used = writtenNodes.some(
            (n) => n.icon === entry.icon || n.badge?.icon === entry.icon,
          );
          if (!used) {
            report(
              legend,
              j,
              entry,
              `explains no icon: no node of the figure draws ${entry.icon}.`,
              "Remove the entry, or give it the icon of the nodes it explains.",
            );
          }
          continue;
        }
        if (entry.kind === "glyph" && entry.glyph !== undefined) {
          // A glyph (#409): a node with a glyph of the same kind, strength and tones.
          const wanted = glyphSignature(entry.glyph);
          const used = writtenNodes.some((n) =>
            (n.glyphs ?? []).some((g) => glyphSignature(g) === wanted),
          );
          if (!used) {
            report(
              legend,
              j,
              entry,
              `explains no glyph: no node of the figure has a ${entry.glyph.kind} glyph with the same ${entry.glyph.strength ?? "soft"} strength and tones.`,
              "Remove the entry, or give its glyph the kind, strength and tone (or tones) of the glyphs it explains.",
            );
          }
          continue;
        }
        if (entry.kind === "set" && entry.set !== undefined) {
          // A set swatch (#409): a set of the same variant and tone.
          const { variant, tone } = entry.set;
          const used = writtenSets.some((set) => set?.variant === variant && set.tone === tone);
          if (!used) {
            report(
              legend,
              j,
              entry,
              `explains no set: no set of the figure has variant "${variant}"${tone === undefined ? " and no tone" : ` and tone "${tone}"`}.`,
              "Remove the entry, or give its set fields the variant and tone of the sets it explains.",
            );
          }
          continue;
        }
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

export const unusedMatrixClass = defineRule({
  id: "lint/unused-matrix-class",
  description: "A class of a matrix is used by none of its cells.",
  defaultSeverity: "warning",
  fixable: false,
  run(context) {
    const { matrices } = context.state.doc;
    if (matrices === undefined) return [];
    const findings: LintFinding[] = [];
    for (const matrix of matrices) {
      const used = new Set(matrix.parts.map((p) => p.class));
      for (const name of Object.keys(matrix.classes)) {
        if (used.has(name)) continue;
        findings.push({
          message: `Class "${name}" of matrix "${matrix.id}" is used by none of its cells.`,
          path: [...matrix.path, "props", "classes", name],
          subject: { kind: "node", id: matrix.id },
          hint: "Remove the class, or write its name in the cells it stands for.",
        });
      }
    }
    return findings;
  },
});
