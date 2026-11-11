/**
 * Color composition of the painted fills (#440): three rules on the colors a
 * figure finally paints ({@link analysisOf}: every fill composited over what
 * lies beneath it, overlaps included).
 *
 * - `geometry/muddy-color` (warning): a chromatic fill whose final color has
 *   lost most of its chroma, darkened into a dull gray, or drifted in hue,
 *   compared with the same fill on white; mid-lightness, low-chroma yellow or
 *   orange fills are also flagged even when opaque (#455). Products painted
 *   for overlapping sets are still judged by chroma loss alone.
 * - `geometry/translucent-over-color` (warning): a fill with opacity below 1
 *   over a surface that is not white.
 * - `geometry/color-on-panel` (info): colored nodes and sets on a group that
 *   is filled with a non-white color. Not muddy in itself, but the two colors
 *   compete; paper figures are white with a few pale colors.
 *
 * The thresholds are calibrated on the figure of the third paper trial
 * (gray panels, translucent sets: reported by all three), `examples/llada` and
 * `examples/llama4-moe` (none), and every other example
 * (docs/design/decisions/440-color-composition.md).
 */

import { deltaE, type Oklch, toOklch } from "../../core/theme/color-math";
import { defineGeometryRule, type LintFinding } from "../rule";
import { type Analysis, analysisOf, type PaintItem, type Sample } from "./composite";

/** An item whose own color has at least this OKLCH chroma is a chromatic tone, not a gray. */
export const TONE_CHROMA = 0.03;
/** The final color keeps at least this share of the chroma it has on white. */
export const CHROMA_KEPT = 0.5;
/** Darker than on white by this much (OKLCH L) while staying below `DULL_CHROMA`: dimmed into gray. */
export const DULL_LIGHTNESS_DROP = 0.06;
export const DULL_CHROMA = 0.045;
/** A hue (degrees) that moved this far at a chroma below `DRIFT_CHROMA` has drifted. */
export const HUE_DRIFT = 30;
export const DRIFT_CHROMA = 0.05;
/** A surface within this CIE76 distance of white is white. */
export const WHITE_DISTANCE = 3;
/** The share of an item's visible samples that must be affected for it to be reported. */
export const SAMPLE_SHARE = 0.5;
/** Findings listed per rule before the rest is summarized. */
const MAX_FINDINGS = 6;

const WHITE = "#ffffff";
const isWhite = (color: string): boolean => deltaE(color, WHITE) < WHITE_DISTANCE;

const hueGap = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

const describe = (hex: string): string => {
  const { l, c, h } = toOklch(hex);
  return `${hex} (OKLCH L ${l.toFixed(2)}, C ${c.toFixed(3)}, h ${Math.round(h)})`;
};

/** Why a final color is muddy relative to its reference, or `undefined`. */
export function muddinessOf(
  reference: Oklch,
  final: Oklch,
): "chroma" | "dull" | "drift" | "khaki" | undefined {
  // The orange-to-olive boundary varies continuously: yellow-green can look
  // muddy at a higher chroma and lower lightness than orange.
  const oliveShare = Math.max(0, Math.min(1, (final.h - 72) / 28));
  const maxChroma = 0.065 + 0.07 * oliveShare;
  const minLightness = 0.7 - 0.15 * oliveShare;
  const maxLightness = 0.88 - 0.02 * oliveShare;
  if (
    (final.h >= 65 &&
      final.h <= 115 &&
      final.l < 0.58 - Math.max(0, 75 - final.h, final.h - 110) * 0.01 &&
      final.c >= 0.045) ||
    (final.h >= 52 &&
      final.h <= 115 &&
      final.l >= minLightness &&
      final.l < (final.h < 65 ? 0.85 : maxLightness) &&
      final.c >= 0.045 &&
      final.c < maxChroma) ||
    (final.h > 105 &&
      final.h <= 115 &&
      final.l >= 0.9 &&
      final.l < 0.94 &&
      final.c >= 0.045 &&
      final.c < 0.07)
  )
    return "khaki";
  if (final.c < reference.c * CHROMA_KEPT) return "chroma";
  if (reference.l - final.l >= DULL_LIGHTNESS_DROP && final.c < DULL_CHROMA) return "dull";
  if (hueGap(reference.h, final.h) >= HUE_DRIFT && final.c < DRIFT_CHROMA && reference.c > 0.005)
    return "drift";
  return undefined;
}

const REASONS = {
  chroma: "it has lost most of its chroma",
  dull: "it is darkened into a dull gray",
  drift: "its hue has drifted",
  khaki: "its yellow or orange is ochre, khaki or olive",
} as const;

function namesOf(items: readonly PaintItem[], skip: ReadonlySet<string> = new Set()): string {
  const names = [...new Set(items.map((i) => i.name.replace(/ fill$/, "")))].filter(
    (n) => !skip.has(n),
  );
  return names.slice(0, 3).join(", ") + (names.length > 3 ? `, and ${names.length - 3} more` : "");
}

/** The most common reason across the samples of an item, if at least `SAMPLE_SHARE` of them are muddy. */
function muddyReason(a: Analysis): { reason: keyof typeof REASONS; sample: Sample } | undefined {
  const { item } = a;
  if (a.samples.length === 0) return undefined;
  // An overlap is judged against the sets it mixes; anything else against itself on white.
  const referenceColors = item.of ?? [a.onWhite];
  const chromatic = item.of !== undefined || toOklch(item.ink).c >= TONE_CHROMA;
  if (!chromatic) return undefined;
  const reference = referenceColors
    .map((c) => toOklch(c))
    .reduce((best, next) => (next.c > best.c ? next : best));
  const found: { reason: keyof typeof REASONS; sample: Sample }[] = [];
  for (const sample of a.samples) {
    const final = toOklch(sample.final);
    // A product of sets is darker by construction: only its chroma counts.
    const reason =
      item.of !== undefined
        ? final.c < reference.c * CHROMA_KEPT
          ? "chroma"
          : undefined
        : muddinessOf(reference, final);
    if (reason !== undefined) found.push({ reason, sample });
  }
  if (found.length < a.samples.length * SAMPLE_SHARE) return undefined;
  return found.sort((x, y) => toOklch(x.sample.final).c - toOklch(y.sample.final).c)[0];
}

function limited(findings: LintFinding[], what: string): LintFinding[] {
  if (findings.length <= MAX_FINDINGS) return findings;
  const [first] = findings as [LintFinding];
  return [
    ...findings.slice(0, MAX_FINDINGS),
    { ...first, message: `${findings.length - MAX_FINDINGS} more ${what} in the figure.` },
  ];
}

export const muddyColor = defineGeometryRule({
  id: "geometry/muddy-color",
  description:
    "A chromatic fill comes out muddy: its chroma is lost, it darkens to gray, its hue drifts, or its yellow-orange color is khaki.",
  defaultSeverity: "warning",
  fixable: false,
  run: (context) => {
    const findings = muddyFindings(analysisOf(context));
    // Fills and lines, not text (#465): a small label in a dark tone of its hue reads as that
    // hue, while a dark yellow line or area reads as ochre.
    for (const element of [...context.elements, ...context.sets]) {
      for (const property of ["stroke"] as const) {
        const color = element.ir.style[property];
        if (!/^#[0-9a-f]{6}$/i.test(color)) continue;
        const value = toOklch(color);
        if (value.c >= TONE_CHROMA && muddinessOf(value, value) === "khaki") {
          findings.push({
            message: `${capitalize(element.name)} ${property} is ${describe(color)}: ${REASONS.khaki}.`,
            path: element.docPath,
            subject: element.subject,
            hint: "Use a clearer hue or neutral ink.",
          });
        }
      }
    }
    return limited(findings, "muddy colors");
  },
});

/** The findings of `geometry/muddy-color` on an analysis (also of one painted with translucent sets, to calibrate). */
export function muddyFindings(analysis: readonly Analysis[]): LintFinding[] {
  const findings: LintFinding[] = [];
  for (const a of analysis) {
    const muddy = muddyReason(a);
    if (muddy === undefined) continue;
    const { item } = a;
    const { sample } = muddy;
    const under = sample.under.filter((u) => !isWhite(u.color) || u.alpha < 1);
    findings.push({
      message:
        `${capitalize(item.name)} is painted ${describe(sample.final)}` +
        (item.of === undefined && muddy.reason !== "khaki"
          ? `, not the ${describe(a.onWhite)} it has on white`
          : item.of !== undefined
            ? `, from the fills ${item.of.join(" and ")}`
            : "") +
        `: ${REASONS[muddy.reason]}.` +
        (under.length > 0 ? ` It lies over ${namesOf(under)}.` : ""),
      path: item.docPath,
      subject: item.subject,
      hint:
        muddy.reason === "khaki"
          ? "Use a lighter yellow fill or a more distinct hue."
          : "Paint it on white (an unfilled or white panel), use opaque fills, or overlap fewer shapes: a translucent color over a gray or colored surface turns gray-brown.",
    });
  }
  return limited(findings, "muddy colors");
}

const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

export const translucentOverColor = defineGeometryRule({
  id: "geometry/translucent-over-color",
  description: "A fill with opacity below 1 is painted over a surface that is not white.",
  defaultSeverity: "warning",
  fixable: false,
  run: (context) => translucentFindings(analysisOf(context)),
});

/** The findings of `geometry/translucent-over-color` on an analysis. */
export function translucentFindings(analysis: readonly Analysis[]): LintFinding[] {
  const findings: LintFinding[] = [];
  for (const a of analysis) {
    const { item } = a;
    if (item.alpha >= 1 || a.samples.length === 0) continue;
    const over = a.samples.filter((s) => !isWhite(s.below));
    if (over.length < a.samples.length * SAMPLE_SHARE) continue;
    const surfaces = (over[0] as Sample).under.filter((u) => !isWhite(u.color));
    findings.push({
      message: `${capitalize(item.name)} is translucent (opacity ${item.alpha}) over ${namesOf(surfaces)}, so its color depends on what lies beneath it.`,
      path: item.docPath,
      subject: item.subject,
      hint: "Use an opaque pale color (a set's fill already is) and keep the panel white, or remove the opacity.",
    });
  }
  return limited(findings, "translucent fills over colors");
}

/** Colored nodes and sets have at least this chroma (OKLCH) in their own color. */
export const COLORED_CHROMA = 0.025;
/** A panel is reported from this many colored elements: one or two accents on a pale panel (Llama 4's shared expert, an emphasized pair) are normal. */
export const MIN_COLORED_ON_PANEL = 3;

export const colorOnPanel = defineGeometryRule({
  id: "geometry/color-on-panel",
  description:
    "Colored nodes or sets sit on a group filled with a color other than white: the two colors compete. Keep the panel white and color only what carries meaning.",
  defaultSeverity: "info",
  fixable: false,
  run: (context) => panelFindings(analysisOf(context)),
});

/** The findings of `geometry/color-on-panel` on an analysis. */
export function panelFindings(analysis: readonly Analysis[]): LintFinding[] {
  const byPanel = new Map<PaintItem, PaintItem[]>();
  for (const a of analysis) {
    const { item } = a;
    if ((item.kind !== "node" && item.kind !== "set") || a.samples.length === 0) continue;
    if (toOklch(item.ink).c < COLORED_CHROMA) continue;
    const onPanel = a.samples.filter((s) => !isWhite(s.panel));
    if (onPanel.length < a.samples.length * SAMPLE_SHARE) continue;
    const panel = [...(onPanel[0] as Sample).under].reverse().find((u) => u.kind === "group");
    if (panel === undefined) continue;
    byPanel.set(panel, [...(byPanel.get(panel) ?? []), item]);
  }
  const findings: LintFinding[] = [...byPanel]
    .filter(([, items]) => items.length >= MIN_COLORED_ON_PANEL)
    .map(([panel, items]) => ({
      message: `${capitalize(panel.name.replace(/ fill$/, ""))} is filled ${panel.color} and holds ${items.length} colored ${items.length === 1 ? "element" : "elements"} (${namesOf(items)}): the colors compete with the panel's.`,
      path: panel.docPath,
      subject: panel.subject,
      hint: "Make the panel white with a thin frame (the paper theme's default group), or color only what carries meaning: at most 2-3 hues and one accent on a white ground.",
    }));
  return limited(findings, "panels with colored elements");
}
