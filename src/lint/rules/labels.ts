/** Rules on element labels: presence, length and glyph coverage. */

import { z } from "zod";
import { markText } from "../../core/registry/manifest";
import { isBlankForD2 } from "../../core/registry/resolve";
import type { FontSet } from "../../core/theme/fonts";
import type { ResolvedStyle } from "../../core/theme/style";
import { loadGlyphCoverage } from "../cmap";
import { defineRule, type LintFinding, type ValidElement } from "../rule";
import { displayWidth, formatCodePoint, glyphCodePoints, labelLines } from "../text";

/** `node "api"`, `group "backend"`, `edge "e1"` or `edge edges[2]`. */
function describeElement(element: ValidElement): string {
  const { kind, subject } = element;
  const id = kind === "edge" && element.element.id === undefined ? subject.id : `"${subject.id}"`;
  return `${kind} ${id}`;
}

export const emptyLabel = defineRule({
  id: "lint/empty-label",
  description: "A node whose shape usually carries text has no label.",
  defaultSeverity: "warning",
  fixable: false,
  run(context) {
    const findings: LintFinding[] = [];
    for (const element of context.elements) {
      const manifest = element.component?.manifest;
      // Text-only shapes already require a label (`component/missing-label`);
      // marks (operator, junction) take none (`component/unexpected-label`).
      if (
        element.kind !== "node" ||
        manifest?.kind !== "node" ||
        manifest.shape === "text" ||
        manifest.mark !== undefined
      ) {
        continue;
      }
      if (!isBlankForD2(element.element.label)) continue;
      findings.push({
        message: `Node "${element.element.id}" has no label.`,
        path: [...element.path, "label"],
        subject: element.subject,
        hint: "Add a label, or turn off lint/empty-label if unlabeled shapes are intended.",
      });
    }
    return findings;
  },
});

export const LongLabelOptions = z.strictObject({
  /** Maximum display width of a line, in columns (wide characters count 2). */
  maxLineWidth: z.int().positive().default(40),
  /** Maximum number of lines. */
  maxLines: z.int().positive().default(4),
});

export const longLabel = defineRule({
  id: "lint/long-label",
  description:
    "A label has a line wider than maxLineWidth columns (default 40; East Asian wide characters and emoji count 2) or more than maxLines lines (default 4).",
  defaultSeverity: "warning",
  fixable: false,
  options: LongLabelOptions,
  run(context, { maxLineWidth, maxLines }) {
    const findings: LintFinding[] = [];
    for (const element of context.elements) {
      const { label } = element.element;
      if (label === "") continue;
      const lines = labelLines(label);
      const widest = Math.max(...lines.map(displayWidth));
      const problems: string[] = [];
      if (widest > maxLineWidth) {
        problems.push(`a line ${widest} columns wide (limit ${maxLineWidth})`);
      }
      if (lines.length > maxLines) problems.push(`${lines.length} lines (limit ${maxLines})`);
      if (problems.length === 0) continue;
      findings.push({
        message: `The label of ${describeElement(element)} has ${problems.join(" and ")}.`,
        path: [...element.path, "label"],
        subject: element.subject,
        hint: "Shorten the label, or break long lines with a newline (\\n).",
      });
    }
    return findings;
  },
});

type FontSlot = "regular" | "bold" | "italic" | "mono";

/**
 * The font file D2 draws a label with (design doc §4.2): mono for all mono
 * text, otherwise bold or italic, falling back to regular for missing slots.
 */
function labelFont(style: ResolvedStyle, fonts: FontSet): { slot: FontSlot; path: string } {
  if (style.mono) return { slot: "mono", path: fonts.mono ?? fonts.regular };
  if (style.bold) return { slot: "bold", path: fonts.bold };
  if (style.italic) return { slot: "italic", path: fonts.italic ?? fonts.regular };
  return { slot: "regular", path: fonts.regular };
}

/** Missing characters listed per diagnostic before summarizing the rest. */
const MAX_LISTED = 10;

export const missingGlyph = defineRule({
  id: "lint/missing-glyph",
  description: "A label contains characters that the theme's font set has no glyph for.",
  defaultSeverity: "warning",
  fixable: false,
  run(context) {
    const fonts = context.theme?.fontSet;
    if (fonts === undefined) return [];
    const findings: LintFinding[] = [];
    for (const element of context.elements) {
      // A mark (#92) draws its glyph instead of the label; check what is drawn.
      const component = element.component;
      const mark = component?.manifest.kind === "node" ? component.manifest.mark : undefined;
      const label =
        mark === undefined
          ? element.element.label
          : ((component && markText(mark, component.props)) ?? "");
      const at =
        mark?.type === "glyph" ? [...element.path, "props", mark.prop] : [...element.path, "label"];
      if (label === "" || element.style === undefined) continue;
      const font = labelFont(element.style, fonts);
      const coverage = loadGlyphCoverage(font.path);
      const missing = glyphCodePoints(label).filter((cp) => !coverage.has(cp));
      if (missing.length === 0) continue;
      const listed = missing
        .slice(0, MAX_LISTED)
        .map((cp) => `"${String.fromCodePoint(cp)}" (${formatCodePoint(cp)})`);
      if (missing.length > MAX_LISTED) listed.push(`and ${missing.length - MAX_LISTED} more`);
      const plural = missing.length === 1 ? "a character" : `${missing.length} characters`;
      findings.push({
        message: `The ${mark === undefined ? "label" : "symbol"} of ${describeElement(element)} has ${plural} missing from the ${font.slot} font of font set ${fonts.id}: ${listed.join(", ")}.`,
        path: at,
        subject: element.subject,
        hint: "Viewers draw missing characters with a fallback font or as empty boxes; replace them, or use a theme whose font set covers them.",
      });
    }
    return findings;
  },
});
