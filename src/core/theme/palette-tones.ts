/**
 * Tone colors derived from a palette (#423).
 *
 * A tone (`blue`, `green`, ...) names a hue; the palette decides how light and
 * how colorful that hue is drawn. So each tone keeps its own hue (blue stays
 * blue) and takes its lightness and chroma from the palette, in OKLCH:
 *
 * - the fill sits at the lightness of the palette's tint (lightened where the
 *   palette's ink would not read on it at 4.5:1), with the chroma of
 *   the tint (never below {@link FILL_CHROMA}[0], so a tone is still told from
 *   the gray tone and from the other tones);
 * - the line (frame, text, solid fill, edge) sits at the lightness of the
 *   palette's strong color, with the chroma of its accent (kept within
 *   {@link LINE_CHROMA}), and is darkened until it reads at 4.5:1 on white and
 *   on the panel, so a solid fill keeps its white text and an outlined node its
 *   text;
 * - every hue is pulled up to {@link HUE_PULL} degrees toward the palette's
 *   hue (its temperature), never far enough to change which tone it is.
 *
 * The result is a pure function of the palette's roles: see
 * docs/design/decisions/423-tone-harmony.md.
 */

import { deltaE, fromOklch, toOklch } from "./color-math";
import { contrastRatio } from "./node-variants";
import type { Tone } from "./tones";

/** The tones a palette derives: every tone except the neutral `gray`. */
export type DerivedTone = Exclude<Tone, "gray">;

export interface DerivedToneColors {
  /** Fill of the tone (default and filled nodes, tinted nodes, groups). */
  readonly fill: string;
  /** Frame, text, solid fill and edge color of the tone. */
  readonly line: string;
}

/** The OKLCH hue (degrees) each tone is drawn at, before the palette's pull. */
export const TONE_HUES: Readonly<Record<DerivedTone, number>> = {
  red: 25,
  orange: 62,
  yellow: 100,
  green: 145,
  blue: 255,
  purple: 305,
  pink: 350,
};

/**
 * Lightness offsets (OKLCH L) of the lines from the palette's strong color.
 * Tones that read alike with a color vision deficiency (red, orange, yellow
 * and green) are spread over the range white text allows, so they differ in
 * lightness as well as in hue: yellow lightest, red and purple darkest.
 */
export const LINE_LIGHTNESS: Readonly<Record<DerivedTone, number>> = {
  red: -0.1,
  orange: -0.06,
  yellow: 0.07,
  green: 0.03,
  blue: -0.02,
  purple: -0.08,
  pink: -0.03,
};

/** Lightness offsets of the fills from the palette's tint: small, for the same reason. */
export const FILL_LIGHTNESS: Readonly<Record<DerivedTone, number>> = {
  red: -0.04,
  orange: 0,
  yellow: -0.04,
  green: 0,
  blue: 0.01,
  purple: -0.04,
  pink: 0.02,
};

/** Range of the fill chroma: pale palettes still give recognizable tones, rich ones are held back. */
export const FILL_CHROMA = [0.06, 0.1] as const;
/** Range of the line chroma. */
export const LINE_CHROMA = [0.09, 0.14] as const;
/**
 * Warm lines (#444): orange and yellow turn brown and olive when darkened for white text, so they
 * start from the lightest color that still reads (4.5:1 on white and on the panel), keep at least
 * this chroma (above the usual {@link LINE_CHROMA}) and lean a few degrees toward red.
 */
export const WARM_LINE_CHROMA: Readonly<Partial<Record<DerivedTone, number>>> = {
  orange: 0.17,
  yellow: 0.125,
};
/** The highest hue of a warm line: above these, orange reads brown and yellow reads olive. */
export const WARM_HUE_LIMIT: Readonly<Partial<Record<DerivedTone, number>>> = {
  orange: 40,
  yellow: 82,
};
/** Degrees a warm line's hue leans toward red (orange away from brown, yellow away from olive). */
export const WARM_HUE_LEAN: Readonly<Partial<Record<DerivedTone, number>>> = {
  orange: -18,
  yellow: -16,
};
/** The least CIE76 difference between a tone and the palette's gray tone (the tint and the strong color). */
export const GRAY_SEPARATION = 9;
/** The farthest a tone's lightness moves to keep clear of the gray tone. */
const SEPARATION_RANGE = 0.08;
/** The largest hue shift toward the palette's hue, in degrees. */
export const HUE_PULL = 8;

const clamp = (value: number, [low, high]: readonly [number, number]) =>
  Math.min(high, Math.max(low, value));

/** `hue` moved up to {@link HUE_PULL} degrees (a tenth of the gap) toward `target`. */
function pulled(hue: number, target: number): number {
  const gap = ((target - hue + 540) % 360) - 180;
  const shift = Math.min(HUE_PULL, Math.abs(gap) * 0.1);
  return (hue + Math.sign(gap) * shift + 360) % 360;
}

/** The palette colors the derivation reads. */
export interface ToneSource {
  readonly panel: string;
  readonly tint: string;
  readonly ink: string;
  readonly accent: string;
  readonly strong: string;
}

/** The eight palette-derived tones (all but `gray`), each as a fill and a line color. */
export function deriveTones(source: ToneSource): Record<DerivedTone, DerivedToneColors> {
  const tint = toOklch(source.tint);
  const accent = toOklch(source.accent);
  const strong = toOklch(source.strong);
  const fillChroma = clamp(tint.c, FILL_CHROMA);
  const lineChroma = clamp(accent.c, LINE_CHROMA);
  // The palette's hue: that of its most colorful role (the accent, or the tint of a pale palette).
  const temperature = accent.c >= tint.c ? accent.h : tint.h;
  const entries = (Object.keys(TONE_HUES) as DerivedTone[]).map((tone) => {
    const hue = pulled(TONE_HUES[tone], temperature);
    // The fill: the tint's lightness (and the tone's small offset), moved the least that lets the
    // palette's ink read on it (4.5:1) and, for the tone of the palette's own hue, tells it from
    // the gray tone (the tint): lighter first, darker where a lighter color would lose its chroma.
    const fillAt = (shift: number) =>
      fromOklch({ l: tint.l + FILL_LIGHTNESS[tone] + shift, c: fillChroma, h: hue });
    const usable = (color: string) =>
      contrastRatio(source.ink, color) >= 4.5 && deltaE(color, source.tint) >= GRAY_SEPARATION;
    let fill = fillAt(0);
    for (let step = 0; step <= SEPARATION_RANGE * 100 + 10 && !usable(fill); step++) {
      const candidates = [step, -step].map((d) => fillAt(d / 100));
      fill =
        candidates.find((c) => usable(c) && toOklch(c).c >= fillChroma * 0.9) ??
        (candidates[0] as string);
    }
    // The line: the strong color's lightness (and the tone's offset), moved the least that lets white
    // text and the panel's outlined text read (4.5:1) and, for the tone of the palette's own hue,
    // tells it from the gray tone's line (the strong color): darker first.
    const warmChroma = WARM_LINE_CHROMA[tone];
    const lineHue = Math.min(hue + (WARM_HUE_LEAN[tone] ?? 0), WARM_HUE_LIMIT[tone] ?? 360);
    const chroma = Math.max(lineChroma, warmChroma ?? 0);
    const lineAt = (shift: number) =>
      fromOklch({ l: strong.l + LINE_LIGHTNESS[tone] + shift, c: chroma, h: lineHue });
    const usableLine = (color: string) =>
      readable(color, source.panel) && deltaE(color, source.strong) >= GRAY_SEPARATION;
    let line = lineAt(0);
    if (warmChroma !== undefined) {
      // Warm tone: the lightest line that reads, not the strong color's lightness.
      line = fromOklch({ l: 0.75, c: chroma, h: lineHue });
      for (let l = 0.75; l > 0.2 && !readable(line, source.panel); l -= 0.005) {
        line = fromOklch({ l, c: chroma, h: lineHue });
      }
    }
    for (let step = 0; step <= 40 && !usableLine(line); step++) {
      const candidates = [-step, step].map((d) => lineAt(d / 100));
      line = candidates.find(usableLine) ?? (candidates[0] as string);
    }
    // Still short (a gamut edge): darken until it reads.
    for (let step = 1; step <= 100 && !readable(line, source.panel); step++) {
      line = fromOklch({ ...toOklch(line), c: chroma, h: lineHue, l: toOklch(line).l - 0.005 });
    }
    return [tone, { fill, line }] as const;
  });
  return Object.fromEntries(entries) as Record<DerivedTone, DerivedToneColors>;
}

const readable = (line: string, panel: string): boolean =>
  contrastRatio(line, "#ffffff") >= 4.5 && contrastRatio(line, panel) >= 4.5;
