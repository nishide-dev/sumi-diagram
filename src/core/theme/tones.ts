/**
 * Tone names (#92, design doc §6.20): the fixed vocabulary a figure uses to
 * pick a color category for a node or group (`tone: orange`). The colors live
 * only in themes (§4.3): each theme maps every tone name to a partial style,
 * e.g. a pastel fill in `color` and a gray step in the monochrome themes.
 *
 * The set is closed so a figure renders under every theme and editors can
 * complete the names from the JSON Schema. Names are generic hues; they carry
 * no domain meaning.
 */

export const TONE_NAMES = [
  "gray",
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
] as const;

export type Tone = (typeof TONE_NAMES)[number];

export function isTone(name: string): name is Tone {
  return (TONE_NAMES as readonly string[]).includes(name);
}
