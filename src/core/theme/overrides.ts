/**
 * Per-figure tone colors (#380, `figure.themeOverrides.tones`).
 *
 * The overrides are merged into a copy of the theme: `fill` replaces the
 * tone's fill layer (`tones.<tone>`), `line` the stroke of its line layer
 * (`toneLines.<tone>`), and `text` (or else `line`) that layer's text color.
 * Every element that takes the tone (default/filled fills, outlined frames
 * and text, toned edges and arrowheads, hatches, matrix classes, legend
 * samples, inline tone runs) then reads the overridden colors; dimming runs
 * afterwards as usual. The tinted and solid node variants read
 * `toneOverrides` as well (see `resolveStyle`).
 */

import type { Theme, ToneOverride } from "./schema";
import type { StyleLayer } from "./style";
import type { Tone } from "./tones";

/** The theme with the figure's tone colors, or the theme itself without any. */
export function withToneOverrides(
  theme: Theme,
  overrides: Partial<Record<Tone, ToneOverride>> | undefined,
): Theme {
  const entries = Object.entries(overrides ?? {}) as [Tone, ToneOverride][];
  const effective = entries.filter(
    ([, o]) => o.fill !== undefined || o.line !== undefined || o.text !== undefined,
  );
  if (effective.length === 0) return theme;
  const tones = new Map(theme.tones);
  const toneLines = new Map(theme.toneLines);
  for (const [tone, o] of effective) {
    if (o.fill !== undefined) tones.set(tone, layer({ ...tones.get(tone), fill: o.fill }));
    const ink = o.text ?? o.line;
    if (ink !== undefined)
      toneLines.set(
        tone,
        layer({
          ...toneLines.get(tone),
          ...(o.line !== undefined && { stroke: o.line }),
          ...(ink !== undefined && { fontColor: ink }),
        }),
      );
  }
  return Object.freeze({
    ...theme,
    tones,
    toneLines,
    toneOverrides: new Map(effective.map(([tone, o]) => [tone, Object.freeze({ ...o })])),
  });
}

const layer = (values: StyleLayer): StyleLayer => Object.freeze(values);
