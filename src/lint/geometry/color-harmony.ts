/**
 * `geometry/color-harmony` (#423): a figure whose colors clash.
 *
 * Three signals, each read off the colors the figure paints
 * ({@link paintedColors}, in OKLCH), so the rule judges what is drawn whatever
 * theme, palette or explicit color produced it:
 *
 * - **hues**: more than {@link MAX_HUES} hue families (30 degrees apart) among
 *   the chromatic colors;
 * - **fills**: pale fills whose chroma differs by {@link FILL_CHROMA_RATIO} or
 *   more (pastel next to saturated), or whose lightness differs by more than
 *   {@link FILL_LIGHTNESS_SPREAD} (a pale and a heavy fill side by side);
 * - **palette**: with `themeOverrides.palette`, chromatic colors that neither
 *   the palette nor the tones derived from it paint and that sit outside its
 *   lightness / chroma band (an explicit tone color that does not belong to
 *   the palette: the muddy mix of #412).
 *
 * The thresholds are calibrated on the LLaDA reproduction (`examples/llada`,
 * muted cool and warm fills of similar lightness and chroma) and
 * `examples/llama4-moe`, which must pass, and on the palette figure of #412,
 * which must be reported (docs/design/decisions/423-tone-harmony.md).
 */

import { getTheme } from "../../core/theme/builtin";
import { deltaE, toOklch } from "../../core/theme/color-math";
import { getPalette, type Palette } from "../../core/theme/palette";
import { defineGeometryRule, type LintFinding } from "../rule";
import { NEUTRAL_CHROMA, type PaintedColor, paintedColors } from "./color-census";

/**
 * The most hue families a figure paints before they read as a clash: the
 * seven chromatic tones, so a figure that uses only the theme's tones never
 * trips it, but one that adds colors of its own can.
 */
export const MAX_HUES = 7;
/** Hues closer than this (degrees) are one family. */
export const HUE_FAMILY = 30;
/** Pale fills whose chroma differs by this factor (at least {@link SATURATED_FILL}) are pastel next to saturated. */
export const FILL_CHROMA_RATIO = 3;
/** The chroma from which a fill counts as saturated. */
export const SATURATED_FILL = 0.1;
/** A pale fill and a heavier one: lightness (OKLCH L) spread among chromatic fills. */
export const FILL_LIGHTNESS_SPREAD = 0.3;
/** How much more vivid (a factor of the palette's tone chroma) a color may be, and how far (OKLCH L) a fill's lightness may leave the tint's. */
export const PALETTE_CHROMA_FACTOR = 1.4;
export const PALETTE_LIGHTNESS_TOLERANCE = 0.1;
/** A color within this CIE76 distance of one the palette paints is that color. */
const SAME_COLOR = 4;

export type HarmonySignal = "hues" | "fills" | "palette";

export interface HarmonyProblem {
  readonly signal: HarmonySignal;
  readonly message: string;
}

const distinct = (colors: readonly PaintedColor[]): PaintedColor[] => [
  ...new Map(colors.map((c) => [c.color, c])).values(),
];

/** The number of hue families: hues sorted around the circle, split at gaps wider than {@link HUE_FAMILY}. */
export function hueFamilies(hues: readonly number[]): number {
  if (hues.length === 0) return 0;
  const sorted = [...hues].sort((a, b) => a - b);
  let gaps = 0;
  for (let i = 0; i < sorted.length; i++) {
    const next = sorted[(i + 1) % sorted.length] as number;
    const gap = (next - (sorted[i] as number) + 360) % 360;
    if (gap > HUE_FAMILY || (sorted.length === 1 && i === 0)) gaps++;
  }
  return Math.max(1, gaps);
}

const list = (colors: readonly PaintedColor[], count = 3): string =>
  colors
    .slice(0, count)
    .map((c) => `${c.color} (${c.where})`)
    .join(", ") + (colors.length > count ? `, and ${colors.length - count} more` : "");

/** The colors a palette paints: its roles and the tones derived from it. */
function paletteColors(palette: Palette): string[] {
  return [
    ...Object.values(palette.roles),
    ...Object.values(palette.tones).flatMap((t) => [t.fill, t.line]),
  ];
}

/** What is wrong with the colors a figure paints; empty when they are in harmony. */
export function assessColors(
  painted: readonly PaintedColor[],
  palette?: Palette | undefined,
): HarmonyProblem[] {
  const problems: HarmonyProblem[] = [];
  const chromatic = distinct(painted.filter((c) => c.oklch.c >= NEUTRAL_CHROMA));

  const families = hueFamilies(chromatic.map((c) => c.oklch.h));
  if (families > MAX_HUES)
    problems.push({
      signal: "hues",
      message: `The figure paints ${families} hue families (more than ${MAX_HUES}).`,
    });

  const fills = chromatic.filter((c) => c.role === "fill");
  if (fills.length >= 3) {
    const chroma = fills.map((c) => c.oklch.c);
    const [low, high] = [Math.min(...chroma), Math.max(...chroma)];
    const lightness = fills.map((c) => c.oklch.l);
    const spread = Math.max(...lightness) - Math.min(...lightness);
    if (high >= SATURATED_FILL && high / low >= FILL_CHROMA_RATIO)
      problems.push({
        signal: "fills",
        message: `Pastel and saturated fills are mixed: fill chroma runs from ${low.toFixed(2)} to ${high.toFixed(2)} (OKLCH, ratio ${(high / low).toFixed(1)}).`,
      });
    else if (spread > FILL_LIGHTNESS_SPREAD)
      problems.push({
        signal: "fills",
        message: `Fill lightness spreads too wide: ${Math.min(...lightness).toFixed(2)} to ${Math.max(...lightness).toFixed(2)} (OKLCH L).`,
      });
  }

  if (palette !== undefined) {
    const own = paletteColors(palette);
    const foreign = chromatic.filter(
      (c) =>
        c.role !== "panel" &&
        !own.some((o) => deltaE(o, c.color) < SAME_COLOR) &&
        outsideBand(c, palette),
    );
    if (foreign.length >= 2)
      problems.push({
        signal: "palette",
        message: `${foreign.length} colors do not belong to the palette "${palette.id}" (lightness or chroma outside its band): ${list(foreign)}.`,
      });
  }
  return problems;
}

/**
 * Whether the color leaves the palette's band for its role: a pale fill that is
 * lighter or heavier than the palette's tint, or any color more vivid than the
 * palette's tones. (A line darker than the palette's, say a frame darkened to
 * read on its fill, stays in the band: contrast is checked elsewhere.)
 */
function outsideBand(color: PaintedColor, palette: Palette): boolean {
  const reference = bandOf(palette, color.role === "fill" ? "fill" : "line");
  const vivid = color.oklch.c > reference.c * PALETTE_CHROMA_FACTOR;
  return (
    vivid ||
    (color.role === "fill" && Math.abs(color.oklch.l - reference.l) > PALETTE_LIGHTNESS_TOLERANCE)
  );
}

function bandOf(palette: Palette, role: "fill" | "line"): { l: number; c: number } {
  const { l, c } = toOklch(role === "fill" ? palette.tones.blue.fill : palette.tones.blue.line);
  return { l, c };
}

export const colorHarmony = defineGeometryRule({
  id: "geometry/color-harmony",
  description:
    "The figure's colors clash: too many hue families, pastel and saturated fills mixed, or colors outside the palette's lightness and chroma.",
  defaultSeverity: "info",
  fixable: false,
  run(context) {
    const { ir } = context;
    const overrides = ir.meta.themeOverrides;
    // The palette as derived for the theme's canvas (its dark variant on a dark one).
    const palette =
      overrides?.palette === undefined
        ? undefined
        : getPalette(overrides.palette, getTheme(ir.meta.themeId)?.canvas);
    const problems = assessColors(paintedColors(ir), palette);
    return problems.map(
      ({ signal, message }): LintFinding => ({
        message,
        path:
          signal === "palette"
            ? ["figure", "themeOverrides", overrides?.tones === undefined ? "palette" : "tones"]
            : ["figure", "theme"],
        subject: { kind: "figure", id: ir.meta.id },
        hint:
          signal === "palette"
            ? "Drop the explicit themeOverrides.tones colors so the palette derives its own tones, or pick them at the palette's lightness and chroma."
            : "Use fewer hues, or colors of similar lightness and chroma (for example a palette: themeOverrides.palette derives the tones from one).",
      }),
    );
  },
});
