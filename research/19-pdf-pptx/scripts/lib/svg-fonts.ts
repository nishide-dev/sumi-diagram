/**
 * D2 embeds each font as a WOFF subset in an `@font-face` rule with a
 * per-diagram family name (`d2-<hash>-font-regular`) and selects it by class
 * (`.d2-<hash> .text { font-family: "d2-<hash>-font-regular" }`).
 *
 * Browsers read those rules; the non-browser converters evaluated in #19
 * (resvg/usvg → svg2pdf, librsvg, Inkscape) do not load `@font-face` fonts, so
 * they fall back to whatever system font matches the unknown family. This
 * rewrites each class rule to the real family and weight of the bundled font
 * set and removes the `@font-face` rules. The converter must then be given the
 * bundled TTFs (font database / fontconfig), never system fonts.
 */

/** Slot → real family / weight of `sumi/biz-ud-gothic` (design doc §4.2). */
const FAMILY_BY_SLOT: Record<string, { family: string; weight: number }> = {
  regular: { family: "BIZ UDPGothic", weight: 400 },
  italic: { family: "BIZ UDPGothic", weight: 400 },
  bold: { family: "BIZ UDPGothic", weight: 700 },
  semibold: { family: "BIZ UDPGothic", weight: 700 },
  mono: { family: "BIZ UDGothic", weight: 400 },
  "mono-bold": { family: "BIZ UDGothic", weight: 400 },
  "mono-italic": { family: "BIZ UDGothic", weight: 400 },
  "mono-semibold": { family: "BIZ UDGothic", weight: 400 },
};

const FONT_FACE = /@font-face\s*\{[^}]*\}\s*/g;
const CLASS_FAMILY = /font-family:\s*"d2-\d+-font-([a-z-]+)";/g;

export function resolveFontFamilies(svg: string): string {
  return svg.replace(FONT_FACE, "").replace(CLASS_FAMILY, (whole, slot: string) => {
    const resolved = FAMILY_BY_SLOT[slot];
    if (resolved === undefined) throw new Error(`unknown D2 font slot in ${whole}`);
    return `font-family: "${resolved.family}"; font-weight: ${resolved.weight};`;
  });
}
